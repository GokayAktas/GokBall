/**
 * Network Manager - Socket.io client wrapper
 * Handles connection, room management, and game state sync
 */
import { io } from 'socket.io-client';

export class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.playerId = null;
        this.callbacks = {};
        this.ping = 0;
        this.hostPing = 0; // Host's ping to server (received via hostPing event)
        this._lastPingTime = 0;
        this.pingHistory = [];
        this.minPing = Infinity;
        this.maxPing = 0;
        this.jitter = 0;
        this.packetLoss = 0;
        this._sentPackets = 0;
        this._lostPackets = 0;
        this._lastSentPingId = 0;
        this._pendingPings = new Map(); // pingId -> sendTime
    }

    /**
     * Connect to the game server
     */
    connect(serverUrl) {
        return new Promise((resolve, reject) => {
            // Default: connect to current host (production) or use provided URL
            const url = serverUrl || import.meta.env.VITE_SERVER_URL || '';
            console.log('[Network] Connecting to:', url || 'Current Host');

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
                if (this._pingInterval) {
                    clearInterval(this._pingInterval);
                    this._pingInterval = null;
                }
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

            // Custom Ping tracking with jitter/avg/min stats
            this.socket.on('pong', () => {
                if (this._lastPingTime) {
                    const rtt = Date.now() - this._lastPingTime;
                    this.ping = rtt;
                    
                    // Track history for jitter/min/avg (rolling 20 samples)
                    this.pingHistory.push(rtt);
                    if (this.pingHistory.length > 20) this.pingHistory.shift();
                    this.minPing = Math.min(...this.pingHistory);
                    this.maxPing = Math.max(...this.pingHistory);
                    
                    // Calculate jitter (avg deviation from mean)
                    const avg = this.pingHistory.reduce((a, b) => a + b, 0) / this.pingHistory.length;
                    let jitterSum = 0;
                    for (const p of this.pingHistory) jitterSum += Math.abs(p - avg);
                    this.jitter = Math.round(jitterSum / this.pingHistory.length);
                    
                    this._trigger('pingUpdate', {
                        ping: this.ping,
                        jitter: this.jitter,
                        minPing: this.minPing,
                        maxPing: this.maxPing,
                        avgPing: Math.round(avg)
                    });
                }
            });

            this._pingInterval = setInterval(() => {
                if (this.socket.connected) {
                    this._lastPingTime = Date.now();
                    this.socket.emit('ping');
                }
            }, 500); // 500ms ping interval for more responsive stats

            // Host ping broadcast (host -> server -> all clients)
            this.socket.on('hostPing', (data) => {
                this.hostPing = data.ping || 0;
            });

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
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
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
