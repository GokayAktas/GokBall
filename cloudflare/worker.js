import { Room } from '../server/Room.js';
import { MapManager } from '../server/MapManager.js';
import { normalizeAngle, normalizeHex } from '../server/utils/colors.js';
import { isValidFullGameState } from '../src/network/AuthorityProtocol.js';
import { isProtocolPacket, NETWORK_PROTOCOL_VERSION } from '../src/network/Protocol.js';

const RESUME_WINDOW_MS = 20_000;
const MAX_ROOMS_PER_IP = 2;
const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
];

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/ws' || url.pathname.startsWith('/admin/rooms/')) {
            const origin = request.headers.get('Origin');
            const allowedOrigins = (env.ALLOWED_ORIGINS || '')
                .split(',')
                .map(value => value.trim())
                .filter(Boolean);
            if (origin && (allowedOrigins.length
                ? !allowedOrigins.includes(origin)
                : new URL(origin).host !== url.host)) {
                return new Response('Origin not allowed', { status: 403 });
            }

            const server = env.GAME_SERVER.getByName('gokball-global');
            return server.fetch(request);
        }
        return env.ASSETS.fetch(request);
    }
};

export class GameServerDurableObject {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.rooms = new Map();
        this.playerRooms = new Map();
        this.resumeTickets = new Map();
        this.sockets = new Map();
        this.timer = setInterval(() => this._probeConnections(), 2000);
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/admin/rooms/')) {
            return this._handleAdminRequest(request, url);
        }
        if (url.pathname !== '/ws' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
            return new Response('WebSocket upgrade required', { status: 426 });
        }

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        server.accept();

        const socket = new GameSocket(this, server, request.headers.get('CF-Connecting-IP') || 'unknown');
        this.sockets.set(socket.id, socket);
        server.addEventListener('message', event => this._onMessage(socket, event.data));
        server.addEventListener('close', () => this._onDisconnect(socket));
        server.addEventListener('error', () => this._onDisconnect(socket));
        socket.emit('connect', { id: socket.id });
        return new Response(null, { status: 101, webSocket: client });
    }

    async _onMessage(socket, raw) {
        if (!socket.connected || typeof raw !== 'string' ||
            new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) {
            socket.disconnect(1009, 'Message too large');
            return;
        }

        let packet;
        try {
            packet = JSON.parse(raw);
        } catch {
            return;
        }
        if (!Array.isArray(packet) || typeof packet[0] !== 'string' || packet[0].length > 64) return;

        try {
            await this._handleEvent(socket, packet[0], packet[1]);
        } catch (error) {
            console.error(`[Cloudflare] Event '${packet[0]}' failed:`, error);
            socket.emit('roomError', { error: 'Sunucu isteği işlerken hata oluştu.' });
        }
    }

    async _handleEvent(socket, event, data) {
        switch (event) {
            case 'listRooms':
                socket.emit('roomList', [...this.rooms.values()]
                    .filter(room => !room.isEmpty() && !room.bannedIPs.has(socket.handshake.address))
                    .map(room => room.getInfo()));
                break;
            case 'ping':
                socket.emit('pong', { n: typeof data?.n === 'number' ? data.n : null });
                break;
            case 'netProbeAck':
                this._handleProbeAck(socket, data);
                break;
            case 'createRoom':
                this._createRoom(socket, data || {});
                break;
            case 'joinRoom':
                this._joinRoom(socket, data || {});
                break;
            case 'resumeRoom':
                this._resumeRoom(socket, data || {});
                break;
            case 'leaveRoom':
                this._leaveRoom(socket);
                break;
            case 'changeTeam':
                this._roomFor(socket)?.changeTeam(socket.id, data);
                break;
            case 'setTeamColors':
                this._setTeamColors(socket, data || {});
                break;
            case 'randomizeTeams':
                this._roomFor(socket)?.randomizeTeams(socket.id);
                break;
            case 'clearTeam':
                this._roomFor(socket)?.clearTeam(socket.id, data);
                break;
            case 'releasePlayerKick': {
                const room = this._roomFor(socket);
                if (room?.hostId === socket.id && data?.playerId) {
                    room.players.get(data.playerId)?.socket?.emit('kickReleased');
                }
                break;
            }
            case 'requestFullState':
                this._requestFullState(socket, data || {});
                break;
            case 'fullGameState':
                this._sendFullGameState(socket, data || {});
                break;
            case 'pauseGame':
                this._pauseGame(socket, data || {});
                break;
            case 'hostMatchStarted': {
                const room = this._roomFor(socket);
                if (room?.hostId === socket.id && data?.protocolVersion === NETWORK_PROTOCOL_VERSION &&
                    typeof data.matchEpoch === 'string' && data.matchEpoch.length <= 100) {
                    room.game.matchEpoch = data.matchEpoch;
                }
                break;
            }
            case 'hostGoalEvent':
                this._hostGoalEvent(socket, data || {});
                break;
            case 'hostMatchState':
                this._hostMatchState(socket, data || {});
                break;
            case 'hostGameOverEvent':
                this._hostGameOverEvent(socket, data || {});
                break;
            case 'startGame':
                this._startGame(socket);
                break;
            case 'stopGame':
                this._stopGame(socket);
                break;
            case 'chatMessage':
                this._roomFor(socket)?.chat(socket.id, typeof data === 'string' ? data : '');
                break;
            case 'setTyping':
                this._roomFor(socket)?.setTyping(socket.id, data);
                break;
            case 'kickPlayer':
                this._roomFor(socket)?.kickPlayer(socket.id, data?.playerId, data?.reason);
                break;
            case 'banPlayer':
                this._roomFor(socket)?.banPlayer(socket.id, data?.playerId, data?.reason);
                break;
            case 'giveAdmin':
                this._roomFor(socket)?.toggleAdmin(socket.id, data);
                break;
            case 'toggleTeamLock':
                this._roomFor(socket)?.toggleTeamLock(socket.id);
                break;
            case 'adminMovePlayer':
                this._roomFor(socket)?.adminMovePlayer(socket.id, data?.playerId, data?.team);
                break;
            case 'getRoomUpdate':
                this._sendRoomUpdate(socket);
                break;
            case 'changeMap':
                this._roomFor(socket)?.changeMap(socket.id, data);
                break;
            case 'requestMap':
                this._requestMap(socket, data || {});
                break;
            case 'getMapList':
                socket.emit('mapList', MapManager.getMapList());
                break;
            case 'changeStadium':
                this._roomFor(socket)?.changeStadium(socket.id, data);
                break;
            case 'setScoreLimit':
                this._setRoomNumber(socket, 'scoreLimit', data, 3);
                break;
            case 'setTimeLimit':
                this._setRoomNumber(socket, 'timeLimit', data, 180);
                break;
            case 'setOvertime':
                this._setRoomValue(socket, 'overtimeEnabled', !!data);
                break;
            case 'setSpeedMultiplier':
                this._setMultiplier(socket, 'playerSpeedMultiplier', data);
                break;
            case 'setBallSpeedMultiplier':
                this._setMultiplier(socket, 'ballSpeedMultiplier', data);
                break;
            case 'p2pJoin':
                this._p2pJoin(socket, data || {});
                break;
            case 'p2pSignal':
                this._p2pSignal(socket, data || {});
                break;
            case 'p2pPeerReady':
                this._p2pPeerReady(socket, data || {});
                break;
            case 'p2pRelay':
                this._p2pRelay(socket, data || {});
                break;
            default:
                break;
        }
    }

    _createRoom(socket, options) {
        const roomName = typeof options.name === 'string' ? options.name.trim() : 'GokBall Room';
        const hostedByIp = [...this.rooms.values()].filter(room => room.creatorIp === socket.handshake.address).length;
        if (hostedByIp >= MAX_ROOMS_PER_IP) {
            socket.emit('roomError', { error: `Bir IP adresinden en fazla ${MAX_ROOMS_PER_IP} oda açılabilir.` });
            return;
        }
        if ([...this.rooms.values()].some(room => room.name.toLowerCase() === roomName.toLowerCase())) {
            socket.emit('roomError', { error: 'Bu isimde bir oda zaten mevcut!' });
            return;
        }

        const room = new Room({
            name: roomName || 'GokBall Room',
            password: options.password || '',
            maxPlayers: options.maxPlayers || 12,
            scoreLimit: options.scoreLimit !== undefined ? options.scoreLimit : 3,
            timeLimit: options.timeLimit !== undefined ? options.timeLimit : 180,
            playerSpeedMultiplier: options.playerSpeedMultiplier || 1,
            ballSpeedMultiplier: options.ballSpeedMultiplier || 1,
            stadium: options.stadium || null,
            roomType: 'host'
        });
        room.creatorIp = socket.handshake.address;
        this.rooms.set(room.id, room);

        const result = room.addPlayer(socket, options.playerName || 'Player');
        if (result.error) {
            this.rooms.delete(room.id);
            socket.emit('roomError', result);
            return;
        }
        this.playerRooms.set(socket.id, room.id);
        result.resumeToken = this._issueResumeTicket(room, socket.id);
        socket.emit('roomCreated', result);
    }

    _joinRoom(socket, { roomId, password, playerName } = {}) {
        const room = this.rooms.get(roomId);
        if (!room) return socket.emit('roomError', { error: 'Room not found' });
        if (room.password && room.password !== password) return socket.emit('roomError', { error: 'Incorrect password' });
        if (room.bannedIPs.has(socket.handshake.address)) return socket.emit('roomError', { error: 'You are banned from this room' });

        const result = room.addPlayer(socket, playerName || 'Player');
        if (result.error) return socket.emit('roomError', result);
        this.playerRooms.set(socket.id, room.id);
        result.roomId = room.id;
        result.creatorId = room.creatorId;
        result.resumeToken = this._issueResumeTicket(room, socket.id);
        socket.emit('roomJoined', result);
        if (['playing', 'countdown', 'goal'].includes(room.game.state)) {
            socket.emit('gameStarted', {
                scoreRed: room.game.scoreRed,
                scoreBlue: room.game.scoreBlue,
                roomData: room.getRoomData(),
                protocolVersion: NETWORK_PROTOCOL_VERSION,
                hostId: room.hostId
            });
        }
    }

    _resumeRoom(socket, { token, roomId } = {}) {
        if (typeof token !== 'string' || token.length > 128 || typeof roomId !== 'string') return;
        const ticket = this.resumeTickets.get(token);
        const room = this.rooms.get(roomId);
        if (!ticket || ticket.roomId !== roomId || ticket.expiresAt < Date.now() ||
            !room || !room.players.has(ticket.playerId) || room.players.get(ticket.playerId)?.socket?.connected) {
            socket.emit('resumeRoomError', { error: 'Odaya devam etme süresi doldu.' });
            return;
        }

        clearTimeout(ticket.timer);
        this.resumeTickets.delete(token);
        this.playerRooms.delete(ticket.playerId);
        const resumed = room.resumePlayer(ticket.playerId, socket);
        if (!resumed) return;
        this.playerRooms.set(socket.id, room.id);
        const payload = {
            ...room.getRoomData(),
            roomId: room.id,
            creatorId: room.creatorId,
            previousId: ticket.playerId,
            playerId: socket.id,
            player: resumed.player.toJSON(),
            resumeToken: this._issueResumeTicket(room, socket.id)
        };
        socket.emit('roomResumed', payload);
        room.broadcast('playerReconnected', {
            previousId: ticket.playerId,
            playerId: socket.id,
            player: resumed.player.toJSON(),
            players: room.getPlayerList(),
            hostId: room.hostId,
            creatorId: room.creatorId
        }, socket.id);
        if (['playing', 'goal', 'countdown'].includes(room.game.state)) {
            socket.emit('gameStarted', { roomData: payload, protocolVersion: NETWORK_PROTOCOL_VERSION, hostId: room.hostId });
        }
    }

    _leaveRoom(socket) {
        const roomId = this.playerRooms.get(socket.id);
        if (!roomId) return;
        const room = this.rooms.get(roomId);
        const player = room?.players.get(socket.id);
        if (player?.resumeToken) {
            const ticket = this.resumeTickets.get(player.resumeToken);
            if (ticket) clearTimeout(ticket.timer);
            this.resumeTickets.delete(player.resumeToken);
            player.resumeToken = null;
        }
        if (room && (socket.id === room.creatorId || socket.id === room.hostId)) {
            room.close('Oda sahibi ayrıldı');
            this._removeRoom(roomId);
        } else if (room) {
            const remaining = room.removePlayer(socket.id);
            if (remaining === 0) {
                room.close('Oda boşaldı');
                this._removeRoom(roomId);
            }
        }
        this.playerRooms.delete(socket.id);
    }

    _onDisconnect(socket) {
        if (socket.disconnected) return;
        socket.disconnected = true;
        socket.connected = false;
        this.sockets.delete(socket.id);
        const room = this._roomFor(socket);
        if (room?.players.has(socket.id)) {
            this._issueResumeTicket(room, socket.id, true);
        } else {
            this._leaveRoom(socket);
        }
    }

    _issueResumeTicket(room, playerId, disconnected = false) {
        const player = room.players.get(playerId);
        if (!player) return null;
        if (player.resumeToken) {
            const old = this.resumeTickets.get(player.resumeToken);
            if (old) {
                clearTimeout(old.timer);
                if (!disconnected) return player.resumeToken;
                old.expiresAt = Date.now() + RESUME_WINDOW_MS;
                old.timer = setTimeout(() => this._expireResumeTicket(old), RESUME_WINDOW_MS);
                return player.resumeToken;
            }
        }

        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const ticket = {
            token,
            roomId: room.id,
            playerId,
            expiresAt: disconnected ? Date.now() + RESUME_WINDOW_MS : Infinity,
            timer: null
        };
        if (disconnected) ticket.timer = setTimeout(() => this._expireResumeTicket(ticket), RESUME_WINDOW_MS);
        player.resumeToken = token;
        this.resumeTickets.set(token, ticket);
        return token;
    }

    _expireResumeTicket(ticket) {
        if (this.resumeTickets.get(ticket.token) !== ticket) return;
        this.resumeTickets.delete(ticket.token);
        const room = this.rooms.get(ticket.roomId);
        const player = room?.players.get(ticket.playerId);
        if (!room || !player || player.socket?.connected) return;
        if (room.hostId === ticket.playerId || room.creatorId === ticket.playerId) {
            room.close('Oda sahibi bağlantıyı yeniden kuramadı');
            this._removeRoom(room.id);
        } else if (room.removePlayer(ticket.playerId) === 0) {
            room.close('Oda boşaldı');
            this._removeRoom(room.id);
        }
        this.playerRooms.delete(ticket.playerId);
    }

    _removeRoom(roomId) {
        this.rooms.delete(roomId);
        for (const [token, ticket] of this.resumeTickets) {
            if (ticket.roomId !== roomId) continue;
            clearTimeout(ticket.timer);
            this.resumeTickets.delete(token);
        }
        for (const [playerId, id] of this.playerRooms) {
            if (id === roomId) this.playerRooms.delete(playerId);
        }
    }

    _roomFor(socket) {
        const roomId = this.playerRooms.get(socket.id);
        return roomId ? this.rooms.get(roomId) || null : null;
    }

    _handleProbeAck(socket, data) {
        const n = typeof data?.n === 'number' ? data.n : null;
        const sentAt = n === null ? null : socket.data.net.pending.get(n);
        if (sentAt === undefined || sentAt === null) return;
        socket.data.net.pending.delete(n);
        this._roomFor(socket)?.recordPing(socket.id, Date.now() - sentAt, socket.data.net.lost);
        socket.data.net.lost = 0;
    }

    _probeConnections() {
        const now = Date.now();
        for (const socket of this.sockets.values()) {
            for (const [id, sentAt] of socket.data.net.pending) {
                if (now - sentAt > 6000) {
                    socket.data.net.pending.delete(id);
                    socket.data.net.lost++;
                }
            }
            const n = ++socket.data.net.seq;
            socket.data.net.pending.set(n, now);
            socket.emit('netProbe', { n });
        }
        for (const room of this.rooms.values()) {
            if (!room.isEmpty()) this._broadcastRoom(room, 'playerPings', { pings: room.getPingList() });
        }
    }

    _setTeamColors(socket, payload) {
        const room = this._roomFor(socket);
        const player = room?.players.get(socket.id);
        if (!room) return;
        if (!player?.isAdmin) return socket.emit('roomError', { error: 'Yetkisiz: Bu komutu yalnızca adminler kullanabilir.' });
        const team = typeof payload.team === 'string' ? payload.team.toLowerCase() : '';
        if (!['red', 'blue'].includes(team)) return;
        const colors = Array.isArray(payload.colors) ? payload.colors.map(normalizeHex).filter(Boolean) : [];
        if (!colors.length) return socket.emit('roomError', { error: 'En az bir renk sağlanmalıdır. HEX 6 haneli olmalı (örn: FF0000).' });
        room.teamColors[team] = {
            angle: normalizeAngle(payload.angle),
            avatarColor: normalizeHex(payload.avatarColor || payload.textColor) || 'FFFFFF',
            colors,
            random: payload.random === true,
            jerseyId: typeof payload.jerseyId === 'string' && /^[a-z0-9-]{1,48}$/.test(payload.jerseyId)
                ? payload.jerseyId
                : null
        };
        this._broadcastRoom(room, 'teamColorsUpdated', {
            team,
            teamColors: room.teamColors[team],
            allTeamColors: room.teamColors
        });
        this._broadcastRoom(room, 'chatMessage', {
            playerName: 'SİSTEM',
            message: `${team.toUpperCase()} takım renkleri güncellendi.`,
            system: true
        });
    }

    _requestFullState(socket, { matchEpoch, protocolVersion } = {}) {
        const room = this._roomFor(socket);
        if (!room || !room.players.has(socket.id)) return;
        if (protocolVersion !== NETWORK_PROTOCOL_VERSION) {
            socket.emit('protocolMismatch', { expected: NETWORK_PROTOCOL_VERSION, received: protocolVersion });
            return;
        }
        if (!['playing', 'goal', 'countdown'].includes(room.game.state)) return;
        if (socket._lastFullStateRequestAt && Date.now() - socket._lastFullStateRequestAt < 900) return;
        socket._lastFullStateRequestAt = Date.now();
        if (room.hostId === socket.id) return;
        room.players.get(room.hostId)?.socket?.emit('fullStateRequest', {
            playerId: socket.id,
            protocolVersion: NETWORK_PROTOCOL_VERSION,
            matchEpoch: typeof matchEpoch === 'string' ? matchEpoch.slice(0, 100) : null
        });
    }

    _sendFullGameState(socket, { playerId, state } = {}) {
        const room = this._roomFor(socket);
        if (!room || room.hostId !== socket.id || !playerId || playerId === socket.id ||
            state?.protocolVersion !== NETWORK_PROTOCOL_VERSION) return;
        if (!room.game.matchEpoch && typeof state.matchEpoch === 'string') room.game.matchEpoch = state.matchEpoch;
        if (state.matchEpoch !== room.game.matchEpoch || !room.players.has(playerId) || !isValidFullGameState(state)) return;
        room.players.get(playerId)?.socket?.emit('fullGameState', state);
    }

    _pauseGame(socket, data) {
        const room = this._roomFor(socket);
        if (!room || room.hostId !== socket.id) return;
        room.game.paused = !!data.paused;
        room.game.resuming = !!data.resuming;
        if (room.game.paused && room.game.resuming && Number.isFinite(data.durationMs)) {
            clearTimeout(room.game._resumeTimer);
            room.game._resumeTimer = setTimeout(() => {
                room.game.paused = false;
                room.game.resuming = false;
            }, Math.max(1000, Math.min(5000, data.durationMs)));
        } else if (!room.game.paused) {
            clearTimeout(room.game._resumeTimer);
            room.game._resumeTimer = null;
        }
        this._broadcastRoom(room, 'gamePaused', {
            paused: !!data.paused,
            resuming: !!data.resuming,
            durationMs: Number.isFinite(data.durationMs) ? Math.max(1000, Math.min(5000, data.durationMs)) : 3200
        }, socket.id);
    }

    _hostGoalEvent(socket, data) {
        const room = this._roomFor(socket);
        if (!room || room.hostId !== socket.id || data.protocolVersion !== NETWORK_PROTOCOL_VERSION ||
            data.matchEpoch !== room.game.matchEpoch || !Number.isFinite(data.scoreRed) ||
            !Number.isFinite(data.scoreBlue) || !['red', 'blue'].includes(data.team)) return;
        room.game.scoreRed = data.scoreRed;
        room.game.scoreBlue = data.scoreBlue;
        room.game.state = 'goal';
        this._broadcastRoom(room, 'goalScored', {
            team: data.team,
            scoreRed: data.scoreRed,
            scoreBlue: data.scoreBlue,
            scorer: data.scorer || '',
            assister: data.assister || '',
            ownGoal: !!data.ownGoal
        }, socket.id);
    }

    _hostMatchState(socket, data) {
        const room = this._roomFor(socket);
        if (!room || room.hostId !== socket.id || data.protocolVersion !== NETWORK_PROTOCOL_VERSION ||
            data.state !== 'playing' || data.matchEpoch !== room.game.matchEpoch) return;
        if (room.game.state === 'goal') room.game.state = 'playing';
    }

    _hostGameOverEvent(socket, data) {
        const room = this._roomFor(socket);
        if (!room || room.hostId !== socket.id || data.protocolVersion !== NETWORK_PROTOCOL_VERSION ||
            data.matchEpoch !== room.game.matchEpoch || !Number.isFinite(data.scoreRed) ||
            !Number.isFinite(data.scoreBlue)) return;
        room.game.scoreRed = data.scoreRed;
        room.game.scoreBlue = data.scoreBlue;
        room.game.state = 'ended';
        this._broadcastRoom(room, 'gameOver', {
            winner: data.winner,
            scoreRed: data.scoreRed,
            scoreBlue: data.scoreBlue,
            matchStats: data.matchStats || {}
        }, socket.id);
    }

    _startGame(socket) {
        const room = this._roomFor(socket);
        const player = room?.players.get(socket.id);
        if (!room || !player?.isAdmin) return;
        if (!room.getTeamPlayers('red').length && !room.getTeamPlayers('blue').length) {
            return socket.emit('roomError', { error: 'Oyunu başlatmak için en az 1 kişi takıma geçmelidir!' });
        }
        room.game.start();
    }

    _stopGame(socket) {
        const room = this._roomFor(socket);
        if (!room?.players.get(socket.id)?.isAdmin) return;
        room.game.stop();
        room.broadcast('gameStopped', { reason: 'Stopped by admin', roomData: room.getRoomData() });
    }

    _sendRoomUpdate(socket) {
        const room = this._roomFor(socket);
        if (!room) return;
        socket.emit('roomUpdate', {
            name: room.name,
            players: room.getPlayerList(),
            teamsLocked: room.teamsLocked,
            scoreLimit: room.game.scoreLimit,
            timeLimit: room.game.timeLimit,
            stadiumName: room.stadium.name,
            playerSpeedMultiplier: room.playerSpeedMultiplier,
            ballSpeedMultiplier: room.ballSpeedMultiplier,
            overtimeEnabled: room.game.overtimeEnabled
        });
    }

    _requestMap(socket, data) {
        const room = this._roomFor(socket);
        if (!room) return;
        const mapId = data.mapId || room.mapId;
        socket.emit('mapSync', {
            mapId,
            mapHash: MapManager.getHash(mapId),
            mapData: MapManager.getMap(mapId),
            senderMapHash: room.mapHash
        });
    }

    _setRoomNumber(socket, field, value, fallback) {
        const room = this._roomFor(socket);
        if (!room?.players.get(socket.id)?.isAdmin) return;
        room.game[field] = value === '0' ? 0 : (parseInt(value, 10) || fallback);
        room.broadcast('roomUpdate', { [field]: room.game[field] });
    }

    _setRoomValue(socket, field, value) {
        const room = this._roomFor(socket);
        if (!room?.players.get(socket.id)?.isAdmin) return;
        room.game[field] = value;
        room.broadcast('roomUpdate', { [field]: value });
    }

    _setMultiplier(socket, field, value) {
        const room = this._roomFor(socket);
        if (!room?.players.get(socket.id)?.isAdmin) return;
        const number = Number.parseFloat(value);
        if (!Number.isFinite(number) || number <= 0 || number > 3) return;
        room[field] = Math.round(number * 100) / 100;
        room.broadcast('roomUpdate', { [field]: room[field] });
    }

    _p2pJoin(socket, data) {
        if (data.protocolVersion !== NETWORK_PROTOCOL_VERSION) {
            socket.emit('p2pError', { error: 'Uyumsuz ağ protokolü', expected: NETWORK_PROTOCOL_VERSION, received: data.protocolVersion });
            return;
        }
        const room = this._roomFor(socket);
        if (!room || room.id !== data.roomId) return socket.emit('p2pError', { error: 'Oda bulunamadı' });
        const host = this.sockets.get(room.hostId);
        if (!host || room.hostId === socket.id) {
            socket.emit('p2pReady', { initiator: false, solo: true, protocolVersion: NETWORK_PROTOCOL_VERSION });
            return;
        }
        socket.emit('p2pReady', {
            initiator: true,
            hostId: room.hostId,
            iceServers: this._iceServers(),
            protocolVersion: NETWORK_PROTOCOL_VERSION
        });
        host.emit('p2pPeerJoined', {
            peerId: socket.id,
            name: room.players.get(socket.id)?.name || 'Oyuncu',
            iceServers: this._iceServers(),
            protocolVersion: NETWORK_PROTOCOL_VERSION
        });
    }

    _p2pSignal(socket, data) {
        const { to, type, payload, protocolVersion } = data;
        if (protocolVersion !== NETWORK_PROTOCOL_VERSION) {
            socket.emit('p2pError', { error: 'Uyumsuz ağ protokolü', expected: NETWORK_PROTOCOL_VERSION, received: protocolVersion });
            return;
        }
        if (!to || !['offer', 'answer', 'ice'].includes(type) || payload === undefined ||
            this._byteLength(payload) > MAX_MESSAGE_BYTES) return;
        const room = this._peerRoom(socket.id, to);
        if (!room) return;
        this.sockets.get(to)?.emit('p2pSignal', { from: socket.id, protocolVersion: NETWORK_PROTOCOL_VERSION, type, payload });
    }

    _p2pPeerReady(socket, { to } = {}) {
        if (!this._peerRoom(socket.id, to)) return;
        this.sockets.get(to)?.emit('p2pPeerReady', { peerId: socket.id, protocolVersion: NETWORK_PROTOCOL_VERSION });
    }

    _p2pRelay(socket, { to, payload } = {}) {
        if (!to || typeof payload !== 'string' || this._byteLength(payload) > MAX_MESSAGE_BYTES) return;
        let packet;
        try {
            packet = JSON.parse(payload);
        } catch {
            return;
        }
        if (!isProtocolPacket(packet) || !this._peerRoom(socket.id, to)) return;
        this.sockets.get(to)?.volatile.emit('p2pRelay', { from: socket.id, payload });
    }

    _peerRoom(firstId, secondId) {
        if (!secondId) return null;
        const room = this.rooms.get(this.playerRooms.get(firstId));
        return room && room.players.has(firstId) && room.players.has(secondId) &&
            (room.hostId === firstId || room.hostId === secondId) ? room : null;
    }

    _iceServers() {
        const urls = (this.env.ICE_SERVERS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);
        const servers = urls.map(value => ({ urls: value }));
        const turnUrls = (this.env.TURN_URLS || '').split(',').map(value => value.trim()).filter(Boolean);
        if (turnUrls.length && this.env.TURN_USERNAME && this.env.TURN_CREDENTIAL) {
            servers.push({
                urls: turnUrls,
                username: this.env.TURN_USERNAME,
                credential: this.env.TURN_CREDENTIAL
            });
        }
        return servers.length ? servers : DEFAULT_ICE_SERVERS;
    }

    _broadcastRoom(room, event, data, excludeId) {
        room.broadcast(event, data, excludeId);
    }

    _byteLength(value) {
        try {
            return new TextEncoder().encode(JSON.stringify(value)).byteLength;
        } catch {
            return Infinity;
        }
    }

    async _handleAdminRequest(request, url) {
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        if (!this.env.ADMIN_SECRET || request.headers.get('X-Admin-Secret') !== this.env.ADMIN_SECRET) {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        const roomId = url.pathname.split('/')[3];
        const room = this.rooms.get(roomId);
        if (!room) return Response.json({ error: 'Room not found' }, { status: 404 });

        let payload;
        try {
            payload = await request.json();
        } catch {
            return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const team = typeof payload.team === 'string' ? payload.team.toLowerCase() : '';
        if (!['red', 'blue'].includes(team)) return Response.json({ error: 'Invalid team' }, { status: 400 });
        const colors = Array.isArray(payload.colors) ? payload.colors.map(normalizeHex).filter(Boolean) : [];
        if (!colors.length) return Response.json({ error: 'At least one valid HEX color required' }, { status: 400 });
        room.teamColors[team] = {
            angle: normalizeAngle(payload.angle),
            avatarColor: normalizeHex(payload.avatarColor || payload.textColor) || 'FFFFFF',
            colors
        };
        this._broadcastRoom(room, 'teamColorsUpdated', {
            team,
            teamColors: room.teamColors[team],
            allTeamColors: room.teamColors
        });
        return Response.json({ ok: true, teamColors: room.teamColors[team] });
    }
}

class GameSocket {
    constructor(server, websocket, ip) {
        this.server = server;
        this.websocket = websocket;
        this.id = crypto.randomUUID();
        this.connected = true;
        this.disconnected = false;
        this.handshake = { address: ip };
        this.data = { net: { seq: 0, pending: new Map(), lost: 0 } };
        this.volatile = { emit: (event, data) => this.emit(event, data, true) };
    }

    emit(event, data, volatile = false) {
        if (!this.connected || this.websocket.readyState !== WebSocket.OPEN) return;
        if (volatile && this.websocket.bufferedAmount > 64 * 1024) return;
        try {
            this.websocket.send(JSON.stringify([event, data]));
        } catch (error) {
            console.warn('[Cloudflare] WebSocket send failed:', error);
        }
    }

    disconnect(code = 1000, reason = 'Disconnected') {
        if (this.disconnected) return;
        this.websocket.close(code, reason);
    }
}
