/**
 * Network Manager - Socket.io client wrapper
 * Handles connection, room management, and game state sync
 */
import { io } from 'socket.io-client';
import { PeerLink } from './PeerLink.js';
import { NETWORK_PROTOCOL_VERSION, encodeProtocolPacket, isProtocolPacket, MAX_NETWORK_PACKET_BYTES } from './Protocol.js';

// A ping that is never answered within this window counts as lost.
const PING_TIMEOUT = 3000;
// Rolling window (in samples) used for the packet loss percentage.
const PING_WINDOW = 20;
const PEER_PING_INTERVAL = 500;
const PEER_PING_TIMEOUT = 1200;
const PEER_PING_FAILURE_THRESHOLD = 2;
const AUTHORITY_STATE_TIMEOUT = 1200;
const AUTHORITY_METADATA_INTERVAL = 15; // refresh static metadata 4 times per second
const AUTHORITY_METADATA_FIELDS = [
    'colors', 'colorAngle', 'avatarColor', 'name', 'avatar',
    'damping', 'acceleration', 'kickingAcceleration', 'kickingDamping',
    'kickStrength', 'bCoef', 'invMass', 'cMask', 'cGroup'
];

export class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.playerId = null;
        this._resumeToken = null;
        this._resumeRoomId = null;
        this._hasConnectedOnce = false;
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

        this._pingSeq = 0;
        this._pendingPings = new Map(); // pingId -> sendTime
        this._pingWindow = []; // last PING_WINDOW results: 'ack' | 'lost'
        this._pingInterval = null;
        this._pingTimeoutInterval = null;

        // WebRTC gameplay links: one host-to-guest data channel per guest.
        this._peerLinks = new Map();
        this._peerSignals = new Map();
        this._peerRoomId = null;
        this._peerHostId = null;
        this._isPeerHost = false;
        this._peerPingTimer = null;
        this._peerPingSeq = 0;
        this._peerPingPending = new Map();
        this._peerPingFailures = new Map();
        this._lastInputRelayAt = -Infinity;
        this._authorityStreamActive = false;
        this._authorityStateAt = null;
        this._lastPeerAuthorityTick = -1;
        this._peerAuthorityEpoch = null;
        this._authorityMetadataSignatures = new Map();
        this._lastAuthorityTick = -1;
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
                reconnectionAttempts: Infinity,
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
                if (this._hasConnectedOnce && this._resumeToken && this._resumeRoomId) {
                    this.socket.emit('resumeRoom', { token: this._resumeToken, roomId: this._resumeRoomId });
                }
                this._hasConnectedOnce = true;
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
            this.socket.on('roomCreated', (data) => { this._rememberResume(data); this._trigger('roomCreated', data); });
            this.socket.on('roomJoined', (data) => { this._rememberResume(data); this._trigger('roomJoined', data); });
            this.socket.on('roomResumed', (data) => { this._rememberResume(data); this._trigger('roomResumed', data); });
            this.socket.on('resumeRoomError', (data) => this._trigger('resumeRoomError', data));
            this.socket.on('playerReconnected', (data) => this._trigger('playerReconnected', data));
            this.socket.on('protocolMismatch', (data) => this._trigger('protocolMismatch', data));
            this.socket.on('roomError', (data) => this._trigger('roomError', data));
            this.socket.on('playerJoined', (data) => this._trigger('playerJoined', data));
            this.socket.on('playerLeft', (data) => {
                if (data?.playerId) this._removePeerLink(data.playerId);
                this._trigger('playerLeft', data);
            });
            this.socket.on('teamChanged', (data) => this._trigger('teamChanged', data));
            this.socket.on('teamLockChanged', (data) => this._trigger('teamLockChanged', data));
            this.socket.on('gameState', (state) => this._trigger('serverGameState', state));
            this.socket.on('fullStateRequest', (data) => this._trigger('fullStateRequest', data));
            this.socket.on('fullGameState', (state) => {
                this._noteAuthorityState(state);
                this._trigger('fullGameState', state);
            });
            this.socket.on('gameStarted', (data) => this._trigger('gameStarted', data));
            this.socket.on('gameStopped', (data) => this._trigger('gameStopped', data));
            this.socket.on('roomClosed', (data) => {
                this.disconnectRoomPeers();
                this._trigger('roomClosed', data);
            });
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
            // report a ping they do not have.
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

            // WebRTC signaling is centralized; game input and snapshots are
            // routed through the peer links once a room is joined.
            this.socket.on('p2pReady', (data) => this._onPeerReady(data));
            this.socket.on('p2pPeerJoined', (data) => this._onPeerJoined(data));
            this.socket.on('p2pSignal', (data) => this._onPeerSignal(data));
            this.socket.on('p2pRelay', (data) => this._onPeerRelay(data));
            this.socket.on('p2pError', (data) => {
                if (data?.expected !== undefined) this._trigger('protocolMismatch', data);
                this._trigger('peerError', data);
            });
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
            packetLoss: this.packetLoss
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

    _rememberResume(data) {
        if (!data?.resumeToken) return;
        this._resumeToken = data.resumeToken;
        this._resumeRoomId = data.roomId || data.id || null;
    }

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
        this._resumeToken = null;
        this._resumeRoomId = null;
        this.socket.emit('leaveRoom');
    }

    // === Team Management ===

    changeTeam(team) {
        this.socket.emit('changeTeam', team);
    }

    // === Game Actions ===

    sendInput(input) {
        this._inputSeqNum = (this._inputSeqNum || 0) + 1;
        const packet = { v: NETWORK_PROTOCOL_VERSION, type: 'input', epoch: this._peerAuthorityEpoch, seq: this._inputSeqNum, input };
        if (!this._isPeerHost && this._peerHostId) {
            const link = this._peerLinks.get(this._peerHostId);
            if (!link) {
                this.socket?.volatile.emit('p2pRelay', { to: this._peerHostId, payload: encodeProtocolPacket(packet) });
            } else if (!link.send(packet)) {
                link.useRelay('input channel backlog');
                link.send(packet);
            }
        }
        return this._inputSeqNum;
    }

    requestFullState(matchEpoch = null) {
        this.socket?.emit('requestFullState', { protocolVersion: NETWORK_PROTOCOL_VERSION, matchEpoch });
    }

    sendFullGameState(playerId, state) {
        this.socket?.emit('fullGameState', { playerId, state });
    }

    setNetworkSimulation(config = {}) {
        this._networkSimulation = {
            latencyMs: Math.max(0, Number(config.latencyMs) || 0),
            jitterMs: Math.max(0, Number(config.jitterMs) || 0),
            packetLoss: Math.max(0, Math.min(1, Number(config.packetLoss) || 0))
        };
        for (const link of this._peerLinks.values()) link.setNetworkSimulation(this._networkSimulation);
    }

    /** Join the host's peer mesh after the room has been confirmed by server. */
    connectRoomPeers(roomData) {
        this.disconnectRoomPeers();
        const roomId = roomData?.roomId || roomData?.id;
        const hostId = roomData?.creatorId || roomData?.adminId;
        if (!roomId || !hostId || !this.socket?.connected) return;

        this._peerRoomId = roomId;
        this._peerHostId = hostId;
        this._isPeerHost = hostId === this.playerId;
        this._inputSeqNum = 0;
        this._authorityStreamActive = false;
        this._authorityStateAt = null;
        this._lastPeerAuthorityTick = -1;
        this._peerAuthorityEpoch = null;
        this._lastInputRelayAt = -Infinity;
        if (!this._isPeerHost) this.socket.emit('p2pJoin', { roomId, protocolVersion: NETWORK_PROTOCOL_VERSION });
        this._peerPingTimer = setInterval(() => this._sendPeerPings(), PEER_PING_INTERVAL);
    }

    /** Stop all peer channels when leaving or replacing a room. */
    disconnectRoomPeers() {
        if (this._peerPingTimer) {
            clearInterval(this._peerPingTimer);
            this._peerPingTimer = null;
        }
        for (const link of this._peerLinks.values()) link.close();
        this._peerLinks.clear();
        this._peerSignals.clear();
        this._peerPingPending.clear();
        this._peerPingFailures.clear();
        this._peerRoomId = null;
        this._peerHostId = null;
        this._isPeerHost = false;
        this._authorityStreamActive = false;
        this._authorityStateAt = null;
        this._lastPeerAuthorityTick = -1;
        this._peerAuthorityEpoch = null;
        this._lastInputRelayAt = -Infinity;
        this._authorityMetadataSignatures.clear();
        this._lastAuthorityTick = -1;
    }

    setAuthorityStreamActive(active) {
        this._authorityStreamActive = !!active;
        this._authorityStateAt = active ? performance.now() : null;
        if (active) this._lastPeerAuthorityTick = -1;
    }

    _noteAuthorityState(state) {
        if (state?.matchEpoch && state.matchEpoch !== this._peerAuthorityEpoch) {
            this._peerAuthorityEpoch = state.matchEpoch;
            this._lastPeerAuthorityTick = -1;
        }
        const seq = Number.isFinite(state?.snapshotSeq) ? state.snapshotSeq : state?.tick;
        if (Number.isFinite(seq)) {
            if (seq <= this._lastPeerAuthorityTick) return;
            this._lastPeerAuthorityTick = seq;
        }
        this._authorityStateAt = performance.now();
    }

    /** Broadcast one current authoritative snapshot to connected guests. */
    sendAuthorityState(state, roomPlayerIds = []) {
        if (state?.matchEpoch) this._peerAuthorityEpoch = state.matchEpoch;
        if (state?.matchEpoch && this._lastAuthorityEpoch !== state.matchEpoch) {
            this._lastAuthorityEpoch = state.matchEpoch;
            this._lastAuthorityTick = -1;
            this._authorityMetadataSignatures.clear();
        }
        const tick = Number.isFinite(state?.tick) ? state.tick : 0;
        if (tick <= this._lastAuthorityTick) {
            this._authorityMetadataSignatures.clear();
        }
        this._lastAuthorityTick = tick;

        const seenMetadataKeys = new Set();
        const refreshMetadata = state?.fullState || tick % AUTHORITY_METADATA_INTERVAL === 1;
        const discs = state?.physics?.discs || [];
        const compactDiscs = discs.map((disc, index) => {
            const compact = {
                x: disc.x,
                y: disc.y,
                sx: disc.sx,
                sy: disc.sy,
                isPlayer: !!disc.isPlayer,
                kicking: !!disc.kicking,
                radius: disc.radius
            };
            if (disc.isPlayer) {
                compact.id = disc.id;
                compact.team = disc.team;
                compact.color = disc.color;
            } else if (disc.color !== undefined) {
                compact.color = disc.color;
            }

            const metadata = {};
            for (const field of AUTHORITY_METADATA_FIELDS) {
                if (disc[field] !== undefined) metadata[field] = disc[field];
            }
            const metadataKey = disc.isPlayer ? `player:${disc.id}` : `static:${index}`;
            const signature = JSON.stringify(metadata);
            seenMetadataKeys.add(metadataKey);
            if (refreshMetadata || this._authorityMetadataSignatures.get(metadataKey) !== signature) {
                Object.assign(compact, metadata);
                this._authorityMetadataSignatures.set(metadataKey, signature);
            }
            return compact;
        });
        for (const key of this._authorityMetadataSignatures.keys()) {
            if (!seenMetadataKeys.has(key)) this._authorityMetadataSignatures.delete(key);
        }

        const compactState = {
            ...state,
            physics: {
                kickOffReset: state?.physics?.kickOffReset,
                kickOffTeam: state?.physics?.kickOffTeam,
                discs: compactDiscs
            }
        };
        const payload = encodeProtocolPacket({ type: 'state', epoch: state?.matchEpoch, tick, seq: state?.snapshotSeq || tick, state: compactState });
        // WebRTC remains the fast path, but a missing/late PeerLink must not
        // freeze the match. Relay to room members without a link through the
        // server's validated, volatile gameplay channel.
        const targets = new Set(roomPlayerIds.filter(id => typeof id === 'string' && id !== this.playerId));
        if (targets.size === 0) {
            for (const disc of discs) if (disc.isPlayer && disc.id && disc.id !== this.playerId) targets.add(disc.id);
        }
        for (const peerId of targets) {
            const link = this._peerLinks.get(peerId);
            if (link) {
                if (link.sendSerialized(payload, true)) continue;
            }
            if (this.socket?.connected) {
                this.socket.volatile.emit('p2pRelay', { to: peerId, payload });
            }
        }
    }

    _onPeerReady(data = {}) {
        if (data.protocolVersion !== NETWORK_PROTOCOL_VERSION) {
            this._trigger('protocolMismatch', { expected: NETWORK_PROTOCOL_VERSION, received: data.protocolVersion });
            return;
        }
        if (data.solo || !data.initiator || !data.hostId || this._isPeerHost) return;
        this._peerHostId = data.hostId;

        let link = this._peerLinks.get(data.hostId);
        if (!link) {
            link = this._createPeerLink(data.hostId);
        }
        link.initiate(data.hostId, data.iceServers);
        this._flushPeerSignals(data.hostId, link);
    }

    _onPeerJoined(data = {}) {
        if (data.protocolVersion !== NETWORK_PROTOCOL_VERSION) {
            this._trigger('protocolMismatch', { expected: NETWORK_PROTOCOL_VERSION, received: data.protocolVersion });
            return;
        }
        const peerId = data.peerId;
        if (!this._isPeerHost || !peerId || peerId === this.playerId) return;

        let link = this._peerLinks.get(peerId);
        if (!link) link = this._createPeerLink(peerId);
        link.acceptPeer(peerId, data.iceServers);
        this._flushPeerSignals(peerId, link);
    }

    _createPeerLink(peerId) {
        const link = new PeerLink({
            socket: this.socket,
            peerId,
            onMessage: (message) => this._onPeerMessage(peerId, message),
            onState: (state) => this._trigger('peerState', state)
        });
        link.setNetworkSimulation(this._networkSimulation || {});
        this._peerLinks.set(peerId, link);
        return link;
    }

    _onPeerSignal(data = {}) {
        if (data.protocolVersion !== NETWORK_PROTOCOL_VERSION) {
            this._trigger('protocolMismatch', { expected: NETWORK_PROTOCOL_VERSION, received: data.protocolVersion });
            return;
        }
        const peerId = data.from;
        if (!peerId) return;
        const link = this._peerLinks.get(peerId);
        if (link) {
            link.receiveSignal(data);
            return;
        }

        // A guest offer can race the host's p2pPeerJoined notification.
        const pending = this._peerSignals.get(peerId) || [];
        if (pending.length < 32) pending.push(data);
        this._peerSignals.set(peerId, pending);
    }

    _flushPeerSignals(peerId, link) {
        const pending = this._peerSignals.get(peerId) || [];
        this._peerSignals.delete(peerId);
        for (const signal of pending) link.receiveSignal(signal);
    }

    _onPeerRelay(data = {}) {
        const peerId = data.from;
        if (!peerId) return;
        const link = this._peerLinks.get(peerId);
        if (link) {
            link.receiveRelay(data);
            return;
        }

        // A valid Socket.IO relay can beat the signaling notification that
        // creates its PeerLink. Do not lose the match stream during that race.
        if (typeof data.payload !== 'string' || new TextEncoder().encode(data.payload).byteLength > MAX_NETWORK_PACKET_BYTES) return;
        try {
            const packet = JSON.parse(data.payload);
            if (isProtocolPacket(packet)) this._onPeerMessage(peerId, packet);
        } catch {
            // Ignore malformed relay payloads.
        }
    }

    _onPeerMessage(peerId, message) {
        if (message?.type === 'ping') {
            if (message.relayRequested) {
                this._peerLinks.get(peerId)?.useRelay('peer requested relay');
            }
            this._peerLinks.get(peerId)?.send({ type: 'pong', id: message.id });
        } else if (message?.type === 'pong') {
            const key = `${peerId}:${message.id}`;
            const sentAt = this._peerPingPending.get(key);
            if (sentAt === undefined) return;
            this._peerPingPending.delete(key);
            this._peerPingFailures.set(peerId, 0);
            this._trigger('peerPingUpdate', {
                peerId,
                ping: performance.now() - sentAt,
                direct: !!this._peerLinks.get(peerId)?.connected && !this._peerLinks.get(peerId)?.relaying
            });
        } else if (message?.type === 'input' && this._isPeerHost && message.v === NETWORK_PROTOCOL_VERSION &&
            message.epoch === this._peerAuthorityEpoch && Number.isSafeInteger(message.seq)) {
            this._trigger('remoteInput', {
                playerId: peerId,
                input: { ...message.input, _seq: message.seq }
            });
        } else if (message?.type === 'state' && !this._isPeerHost && message.v === NETWORK_PROTOCOL_VERSION &&
            message.epoch === message.state?.matchEpoch && Number.isSafeInteger(message.tick)) {
            this._noteAuthorityState(message.state);
            this._trigger('gameState', message.state);
        }
    }

    _sendPeerPings() {
        const now = performance.now();
        if (!this._isPeerHost && this._authorityStreamActive && this._authorityStateAt != null &&
            now - this._authorityStateAt > AUTHORITY_STATE_TIMEOUT) {
            const hostLink = this._peerHostId && this._peerLinks.get(this._peerHostId);
            if (hostLink && !hostLink.relaying) {
                hostLink.useRelay('authority snapshots stalled');
            }
        }

        for (const [key, sentAt] of this._peerPingPending) {
            if (now - sentAt <= PEER_PING_TIMEOUT) continue;
            this._peerPingPending.delete(key);

            const separator = key.lastIndexOf(':');
            const peerId = key.slice(0, separator);
            const failures = (this._peerPingFailures.get(peerId) || 0) + 1;
            this._peerPingFailures.set(peerId, failures);
            if (failures >= PEER_PING_FAILURE_THRESHOLD) {
                this._peerLinks.get(peerId)?.useRelay('peer heartbeat timed out');
            }
        }

        for (const [peerId, link] of this._peerLinks) {
            const id = ++this._peerPingSeq;
            this._peerPingPending.set(`${peerId}:${id}`, now);
            // Keep only recent probes so a disconnected peer cannot grow this map.
            if (this._peerPingPending.size > 32) {
                const oldest = this._peerPingPending.keys().next().value;
                this._peerPingPending.delete(oldest);
            }
            link.send({ type: 'ping', id, relayRequested: link.relaying });
        }
    }

    _removePeerLink(peerId) {
        const link = this._peerLinks.get(peerId);
        if (!link) return;
        link.close();
        this._peerLinks.delete(peerId);
        this._peerSignals.delete(peerId);
        this._peerPingFailures.delete(peerId);
        for (const key of this._peerPingPending.keys()) {
            if (key.startsWith(`${peerId}:`)) this._peerPingPending.delete(key);
        }
    }

    getInputSeqNum() {
        return this._inputSeqNum || 0;
    }

    startGame() {
        this.socket.emit('startGame');
    }

    sendResumeRoom(token, roomId) {
        this.socket?.emit('resumeRoom', { token, roomId });
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

    releasePlayerKick(playerId) {
        this.socket.emit('releasePlayerKick', { playerId });
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

    // === Admin: Update team colors at runtime ===
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

    setBallSpeedMultiplier(multiplier) {
        this.socket.emit('setBallSpeedMultiplier', multiplier);
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
        this.disconnectRoomPeers();
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
