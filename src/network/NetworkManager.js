/**
 * Network Manager - Socket.io client wrapper
 * Handles connection, room management, and game state sync
 */
import { io } from 'socket.io-client';

// A ping that is never answered within this window counts as lost.
const PING_TIMEOUT = 3000;
// Rolling window (in samples) used for the packet loss percentage.
const PING_WINDOW = 20;
// Samples kept for the HUD ping graph (a lost sample is stored as null).
const GRAPH_SAMPLES = 60;

export class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.playerId = null;
        this.callbacks = {};

        // RTT to the server. `null` means "not measured yet" - never fake a value.
        // This is the player's own precise measurement (shown in the HUD).
        // The coarser per-player value in the lists is measured by the server.
        this.ping = null;
        this.pingHistory = [];
        this.minPing = null;
        this.maxPing = null;
        this.jitter = null;
        this.packetLoss = 0;
        this.pingGraph = []; // last GRAPH_SAMPLES: round trip in ms, null = lost

        this._pingSeq = 0;
        this._pendingPings = new Map(); // pingId -> sendTime
        this._pingWindow = []; // last PING_WINDOW results: 'ack' | 'lost'
        this._pingInterval = null;
        this._pingTimeoutInterval = null;
    }

    /**
     * Connect to the game server
     */
    connect(serverUrl) {
        return new Promise((resolve, reject) => {
            // Default: connect to the same host the site is served from.
            // In production the Express server (server/index.js) serves the site
            // AND socket.io on the same port, so same-origin works everywhere
            // (localhost, LAN, deployed URL) without extra config.
            // Set VITE_SERVER_URL env var only for split dev setups (client on :3000, server on :3001).
            const url = serverUrl || import.meta.env.VITE_SERVER_URL || window.location.origin;
            console.log('[Network] Connecting to:', url);

            // Connection timeout
            const connectTimeout = setTimeout(() => {
                this._cleanupConnection();
                reject(new Error('Connection timeout (5s)'));
            }, 5000);
            
            this.socket = io(url, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 3,
                reconnectionDelay: 1000,
                timeout: 5000
            });

            const cleanupAll = () => {
                clearTimeout(connectTimeout);
                this._stopPingTimers();
            };

            this.socket.on('connect', () => {
                cleanupAll();
                this.connected = true;
                this.playerId = this.socket.id;
                console.log('[Network] Connected:', this.playerId);
                resolve(this.playerId);
            });

            this.socket.on('disconnect', (reason) => {
                this.connected = false;
                // A dead connection has no latency: drop the numbers instead of
                // leaving a stale value on screen.
                this.resetMeasurements();
                console.log('[Network] Disconnected:', reason);
                this._trigger('disconnect', reason);
            });

            this.socket.on('connect_error', (err) => {
                cleanupAll();
                console.error('[Network] Connection error:', err.message);
                reject(err);
            });

            // Game events
            this.socket.on('roomList', (rooms) => this._trigger('roomList', rooms));
            this.socket.on('roomCreated', (data) => this._trigger('roomCreated', data));
            this.socket.on('roomJoined', (data) => this._trigger('roomJoined', data));
            this.socket.on('roomError', (data) => this._trigger('roomError', data));
            this.socket.on('playerJoined', (data) => this._trigger('playerJoined', data));
            this.socket.on('playerLeft', (data) => this._trigger('playerLeft', data));
            this.socket.on('teamChanged', (data) => this._trigger('teamChanged', data));
            this.socket.on('teamLockChanged', (data) => this._trigger('teamLockChanged', data));
            this.socket.on('gameState', (state) => this._trigger('gameState', state));
            this.socket.on('gameStarted', (data) => this._trigger('gameStarted', data));
            this.socket.on('gameStopped', (data) => this._trigger('gameStopped', data));
            this.socket.on('goalScored', (data) => this._trigger('goalScored', data));
            this.socket.on('gameOver', (data) => this._trigger('gameOver', data));
            this.socket.on('chatMessage', (data) => this._trigger('chatMessage', data));
            this.socket.on('adminUpdate', (data) => this._trigger('adminUpdate', data));
            // Map system events
            this.socket.on('mapChanged', (data) => this._trigger('mapChanged', data));
            this.socket.on('mapSync', (data) => this._trigger('mapSync', data));
            this.socket.on('mapList', (data) => this._trigger('mapList', data));
            // Legacy
            this.socket.on('stadiumChanged', (data) => this._trigger('stadiumChanged', data));

            // Custom Ping tracking with jitter/avg/min stats.
            // Every ping carries a sequence number so a late/lost pong never
            // corrupts the measurement of another request.
            this.socket.on('pong', (data) => {
                const id = data && typeof data.n === 'number' ? data.n : null;
                if (id === null || !this._pendingPings.has(id)) return;
                const sentAt = this._pendingPings.get(id);
                this._pendingPings.delete(id);

                const rtt = Date.now() - sentAt;
                this.ping = rtt;
                this._pushGraphSample(rtt);

                // Track history for jitter/min/avg (rolling 20 samples)
                this.pingHistory.push(rtt);
                if (this.pingHistory.length > PING_WINDOW) this.pingHistory.shift();
                this.minPing = Math.min(...this.pingHistory);
                this.maxPing = Math.max(...this.pingHistory);

                // Calculate jitter (avg deviation from mean)
                const avg = this.pingHistory.reduce((a, b) => a + b, 0) / this.pingHistory.length;
                let jitterSum = 0;
                for (const p of this.pingHistory) jitterSum += Math.abs(p - avg);
                this.jitter = Math.round(jitterSum / this.pingHistory.length);

                this._pushPingResult('ack');
                this._emitPingUpdate();
            });

            this._pingInterval = setInterval(() => this._sendPing(), 500); // 500ms ping interval
            this._pingTimeoutInterval = setInterval(() => this._expirePings(), 1000);

            // Server-initiated latency probe. We only echo the sequence number
            // back - the round trip is measured by the server so nobody can
            // report a ping they do not have (this is how HaxBall does it).
            this.socket.on('netProbe', (data) => {
                const n = data && typeof data.n === 'number' ? data.n : null;
                if (n === null) return;
                this.socket.emit('netProbeAck', { n });
            });

            this.socket.on('playerPings', (data) => this._trigger('playerPings', data));

            this.socket.on('playerKicked', (data) => this._trigger('playerKicked', data));
            this.socket.on('stadiumChanged', (data) => this._trigger('stadiumChanged', data));
            this.socket.on('roomUpdate', (data) => this._trigger('roomUpdate', data));
            this.socket.on('countdown', (data) => this._trigger('countdown', data));
            this.socket.on('playerTyping', (data) => this._trigger('playerTyping', data));
            this.socket.on('teamColorsUpdated', (data) => this._trigger('teamColorsUpdated', data));
            this.socket.on('kickReleased', (data) => this._trigger('kickReleased', data));
            this.socket.on('remoteInput', (data) => this._trigger('remoteInput', data));
            this.socket.on('gamePaused', (data) => this._trigger('gamePaused', data));
        });
    }

    // === Ping / Latency ===

    _sendPing() {
        if (!this.socket || !this.socket.connected) return;
        const n = ++this._pingSeq;
        this._pendingPings.set(n, Date.now());
        this.socket.emit('ping', { n });
    }

    /** Mark unanswered pings as lost so packet loss is actually measured */
    _expirePings() {
        if (this._pendingPings.size === 0) return;
        const now = Date.now();
        let changed = false;
        for (const [id, sentAt] of this._pendingPings) {
            if (now - sentAt > PING_TIMEOUT) {
                this._pendingPings.delete(id);
                this._pushPingResult('lost');
                this._pushGraphSample(null); // red bar for the lost packet
                changed = true;
            }
        }
        if (changed) this._emitPingUpdate();
    }

    _pushPingResult(result) {
        this._pingWindow.push(result);
        if (this._pingWindow.length > PING_WINDOW) this._pingWindow.shift();
        const lost = this._pingWindow.filter(r => r === 'lost').length;
        this.packetLoss = Math.round((lost / this._pingWindow.length) * 100);
    }

    /** Keep a bounded history for the HUD ping graph (null marks a lost packet) */
    _pushGraphSample(sample) {
        this.pingGraph.push(sample);
        if (this.pingGraph.length > GRAPH_SAMPLES) this.pingGraph.shift();
    }

    _emitPingUpdate() {
        const avg = this.pingHistory.length
            ? this.pingHistory.reduce((a, b) => a + b, 0) / this.pingHistory.length
            : null;
        this._trigger('pingUpdate', {
            ping: this.ping, // null until a real pong arrives
            jitter: this.jitter,
            minPing: this.minPing,
            maxPing: this.maxPing,
            avgPing: avg != null ? Math.round(avg) : null,
            packetLoss: this.packetLoss,
            pingGraph: this.pingGraph
        });
    }

    /** Forget every RTT measurement (disconnect / reconnect) */
    resetMeasurements() {
        this.ping = null;
        this.pingHistory = [];
        this.minPing = null;
        this.maxPing = null;
        this.jitter = null;
        this.packetLoss = 0;
        this.pingGraph = [];
        this._pendingPings.clear();
        this._pingWindow = [];
        this._emitPingUpdate();
    }

    _stopPingTimers() {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
        if (this._pingTimeoutInterval) {
            clearInterval(this._pingTimeoutInterval);
            this._pingTimeoutInterval = null;
        }
    }

    // === Room Management ===

    listRooms() {
        this.socket.emit('listRooms');
    }

    createRoom(options) {
        this.socket.emit('createRoom', options);
    }

    joinRoom(roomId, password, playerName) {
        this.socket.emit('joinRoom', { roomId, password, playerName });
    }

    leaveRoom() {
        this.socket.emit('leaveRoom');
    }

    // === Team Management ===

    changeTeam(team) {
        this.socket.emit('changeTeam', team);
    }

    // === Game Actions ===

    sendInput(input) {
        this._inputSeqNum = (this._inputSeqNum || 0) + 1;
        // Send with sequence number for reconciliation
        this.socket.emit('input', { ...input, _seq: this._inputSeqNum });
        return this._inputSeqNum;
    }

    getInputSeqNum() {
        return this._inputSeqNum || 0;
    }

    startGame() {
        this.socket.emit('startGame');
    }

    stopGame() {
        this.socket.emit('stopGame');
    }

    // === Chat ===

    sendChat(message) {
        this.socket.emit('chatMessage', message);
    }

    // === Admin ===

    kickPlayer(playerId, reason) {
        this.socket.emit('kickPlayer', { playerId, reason });
    }

    banPlayer(playerId, reason) {
        this.socket.emit('banPlayer', { playerId, reason });
    }

    giveAdmin(playerId) {
        this.socket.emit('giveAdmin', playerId);
    }

    changeStadium(stadiumData) {
        this.socket.emit('changeStadium', stadiumData);
    }

    changeMap(mapId) {
        this.socket.emit('changeMap', mapId);
    }

    requestMap(mapId) {
        this.socket.emit('requestMap', { mapId });
    }

    getMapList() {
        this.socket.emit('getMapList');
    }

    // === Admin: Update team colors at runtime (HaxBall-compatible) ===
    setTeamColors(payload) {
        // payload: { team: 'red'|'blue', angle, avatarColor, colors: [] }
        if (!this.socket) return;
        this.socket.emit('setTeamColors', payload);
    }

    setScoreLimit(limit) {
        this.socket.emit('setScoreLimit', limit);
    }

    setTimeLimit(limit) {
        this.socket.emit('setTimeLimit', limit);
    }

    setSpeedMultiplier(multiplier) {
        this.socket.emit('setSpeedMultiplier', multiplier);
    }

    // === Event system ===

    on(event, callback) {
        if (!this.callbacks[event]) this.callbacks[event] = [];
        this.callbacks[event].push(callback);
    }

    off(event, callback) {
        if (!this.callbacks[event]) return;
        this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
    }

    _trigger(event, data) {
        if (!this.callbacks[event]) return;
        for (const cb of this.callbacks[event]) {
            try {
                cb(data);
            } catch (err) {
                console.error(`[Network] Error in callback for ${event}:`, err);
            }
        }
    }

    /** Clean up connection resources */
    _cleanupConnection() {
        this._stopPingTimers();
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    disconnect() {
        this._cleanupConnection();
        this.connected = false;
    }
}
