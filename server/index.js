import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { Room } from './Room.js';
import { MapManager } from './MapManager.js';
import { normalizeHex, normalizeAngle } from './utils/colors.js';
import { attachSignaling, getIceServers } from './signaling.js';
import { isValidFullGameState } from '../src/network/AuthorityProtocol.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { NETWORK_PROTOCOL_VERSION } from '../src/network/Protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// If running behind a reverse proxy (NGINX, Cloud Run, Heroku), enable trust proxy
// so Express can correctly read client IPs and TLS state.
app.set('trust proxy', process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1');
const httpServer = createServer(app);
// Configure allowed client origins. Use environment variable CLIENT_ORIGINS as comma-separated list
const CLIENT_ORIGINS = process.env.CLIENT_ORIGINS
    ? process.env.CLIENT_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

const allowAllOrigins = process.env.ALLOW_ALL_ORIGINS === 'true' || process.env.NODE_ENV === 'development';

const io = new SocketServer(httpServer, {
    cors: {
        origin: allowAllOrigins ? true : CLIENT_ORIGINS,
        methods: ['GET', 'POST'],
        credentials: true
    },
    // Allow polling fallback before upgrading to websocket — improves reliability behind proxies
    transports: process.env.FORCE_WEBSOCKET === 'true' ? ['websocket'] : ['polling', 'websocket'],
    // Keepalive tuning: allow slightly longer timeouts for slow mobile networks
    pingInterval: Number(process.env.SOCKET_PING_INTERVAL) || 25000,
    pingTimeout: Number(process.env.SOCKET_PING_TIMEOUT) || 60000
});

// Serve static client files if built
app.use(express.static(path.join(__dirname, '../dist')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'), (err) => {
        if (err) {
            res.send('<h1>GokBall Server is running!</h1><p>Use Vite (port 3000) for the game client or run "npm run build" to serve local client files.</p>');
        }
    });
});

// ============================================
// Room Storage
// ============================================
const rooms = new Map(); // roomId -> Room
const playerRooms = new Map(); // socketId -> roomId
const resumeTickets = new Map(); // opaque room-scoped token -> short-lived disconnected player
const RESUME_WINDOW_MS = 20000;

// ============================================
// Rooms per IP limit
// ============================================
// A single IP may host at most this many rooms, which keeps one connection from
// flooding the room list. Raise it with MAX_ROOMS_PER_IP if you run a proxy.
const MAX_ROOMS_PER_IP = Number(process.env.MAX_ROOMS_PER_IP) || 2;

/** How many rooms the given IP currently hosts. */
function countRoomsByIp(ip) {
    let count = 0;
    for (const room of rooms.values()) {
        if (room.creatorIp === ip) count++;
    }
    return count;
}

// ============================================
// Socket.io Event Handling
// ============================================
io.on('connection', (socket) => {
    console.log(`[Server] Player connected: ${socket.id}`);

    // Server-side latency measurement state (the server measures, players don't)
    socket.data.net = { seq: 0, pending: new Map(), lost: 0 };

    // Log remote address in a standardized way (works with trust proxy)
    try {
        const remote = socket.handshake.address || (socket.request && socket.request.connection && socket.request.connection.remoteAddress) || 'unknown';
        console.log(`[Server] Connection from ${remote}`);
    } catch (e) {}

    // --- Room Listing ---
    socket.on('listRooms', () => {
        const ip = socket.handshake.address;
        const roomList = [...rooms.values()]
            .filter(r => !r.isEmpty())
            .filter(r => !r.bannedIPs.has(ip))
            .map(r => r.getInfo());
        socket.emit('roomList', roomList);
    });

    // --- Ping/Pong ---
    // Client sends { n: <sequence> } so it can match the reply to a specific
    // request instead of guessing from a single shared timestamp.
    socket.on('ping', (data) => {
        const n = data && typeof data.n === 'number' ? data.n : null;
        socket.emit('pong', { n });
    });

    // --- Latency probes (the server measures the round trip itself) ---
    // The server sends a probe, the client answers immediately, and the round
    // trip is measured here so a client can never report a fake value.
    socket.on('netProbeAck', (data) => {
        const net = socket.data.net;
        const n = data && typeof data.n === 'number' ? data.n : null;
        if (!net || n === null || !net.pending.has(n)) return;

        const sentAt = net.pending.get(n);
        net.pending.delete(n);

        const room = getPlayerRoom(socket.id);
        if (!room) return;
        room.recordPing(socket.id, Date.now() - sentAt, net.lost);
        net.lost = 0;
    });

    // --- Create Room ---
    socket.on('createRoom', (options = {}) => {
        const roomName = (options.name || 'GokBall Room').trim();
        const creatorIp = socket.handshake.address;

        // Per-IP room limit
        const hostedByIp = countRoomsByIp(creatorIp);
        if (hostedByIp >= MAX_ROOMS_PER_IP) {
            socket.emit('roomError', {
                error: `Bir IP adresinden en fazla ${MAX_ROOMS_PER_IP} oda açılabilir.`
            });
            return;
        }

        // Duplicate name check
        for (const r of rooms.values()) {
            if (r.name.toLowerCase() === roomName.toLowerCase()) {
                socket.emit('roomError', { error: 'Bu isimde bir oda zaten mevcut!' });
                return;
            }
        }

        const room = new Room({
            name: roomName,
            password: options.password || '',
            maxPlayers: options.maxPlayers || 12,
            scoreLimit: options.scoreLimit !== undefined ? options.scoreLimit : 3,
            timeLimit: options.timeLimit !== undefined ? options.timeLimit : 180,
            playerSpeedMultiplier: options.playerSpeedMultiplier || 1.0,
            ballSpeedMultiplier: options.ballSpeedMultiplier || 1.0,
            stadium: options.stadium || null,
            roomType: 'host'
        });

        room.creatorIp = creatorIp;
        rooms.set(room.id, room);

        const result = room.addPlayer(socket, options.playerName || 'Player');
        if (result.error) {
            socket.emit('roomError', result);
            return;
        }

        playerRooms.set(socket.id, room.id);
        socket.join(room.id);

        result.resumeToken = issueResumeTicket(room, socket.id);
        socket.emit('roomCreated', result);
        console.log(`[Server] Room created: ${room.name} (${room.id}) by ${socket.id}`);
    });

    // --- Join Room ---
    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('roomError', { error: 'Room not found' });
            return;
        }

        // Check password
        if (room.password && room.password !== password) {
            socket.emit('roomError', { error: 'Incorrect password' });
            return;
        }

        // Check ban
        const ip = socket.handshake.address;
        if (room.bannedIPs.has(ip)) {
            socket.emit('roomError', { error: 'You are banned from this room' });
            return;
        }

        const result = room.addPlayer(socket, playerName || 'Player');
        if (result.error) {
            socket.emit('roomError', result);
            return;
        }

        playerRooms.set(socket.id, room.id);
        socket.join(room.id);

        result.resumeToken = issueResumeTicket(room, socket.id);
        socket.emit('roomJoined', result);
        console.log(`[Server] Player ${socket.id} joined room ${room.name}`);

        // If game is running, send full state snapshot immediately for sync
        if (room.game && (room.game.state === 'playing' || room.game.state === 'countdown' || room.game.state === 'goal')) {
            socket.emit('gameStarted', {
                scoreRed: room.game.scoreRed,
                scoreBlue: room.game.scoreBlue,
                roomData: room.getRoomData(),
                protocolVersion: NETWORK_PROTOCOL_VERSION,
                hostId: room.hostId
            });
        }
    });

    socket.on('resumeRoom', (data = {}) => {
        const { roomId, token } = data || {};
        if (typeof token !== 'string' || token.length > 128 || typeof roomId !== 'string') return;
        const ticket = resumeTickets.get(token);
        if (!ticket || ticket.roomId !== roomId || ticket.expiresAt <= Date.now()) {
            socket.emit('resumeRoomError', { error: 'Odaya devam etme süresi doldu.' });
            return;
        }
        const room = rooms.get(roomId);
        const previous = room?.players.get(ticket.playerId);
        if (!room || !previous || previous.socket?.connected) {
            socket.emit('resumeRoomError', { error: 'Oda bağlantısı artık kullanılamıyor.' });
            return;
        }
        clearTimeout(ticket.timer);
        resumeTickets.delete(token);
        playerRooms.delete(ticket.playerId);
        const resumed = room.resumePlayer(ticket.playerId, socket);
        if (!resumed) return;
        playerRooms.set(socket.id, room.id);
        socket.join(room.id);
        const nextToken = issueResumeTicket(room, socket.id);
        const roomData = room.getRoomData();
        const payload = {
            ...roomData,
            roomId: room.id,
            creatorId: room.creatorId,
            previousId: ticket.playerId,
            playerId: socket.id,
            player: resumed.player.toJSON(),
            resumeToken: nextToken
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
        if (room.game.state === 'playing' || room.game.state === 'goal' || room.game.state === 'countdown') {
            socket.emit('gameStarted', { roomData: payload, protocolVersion: NETWORK_PROTOCOL_VERSION, hostId: room.hostId });
        }
    });

    // --- Leave Room ---
    socket.on('leaveRoom', () => {
        leaveCurrentRoom(socket);
    });

    // --- Change Team ---
    socket.on('changeTeam', (team) => {
        const room = getPlayerRoom(socket.id);
        if (room) room.changeTeam(socket.id, team);
    });

    // --- Admin: Set Team Colors at runtime ---
    // Team color config: { team, angle, avatarColor, colors[] }
    socket.on('setTeamColors', (payload) => {
        try {
            const room = getPlayerRoom(socket.id);
            if (!room) return;

            const player = room.players.get(socket.id);
            if (!player || !player.isAdmin) {
                socket.emit('roomError', { error: 'Yetkisiz: Bu komutu yalnızca adminler kullanabilir.' });
                return;
            }

            const team = (payload.team || '').toLowerCase();
            if (!['red', 'blue'].includes(team)) return;

            const angle = normalizeAngle(payload.angle);
            // Accept both avatarColor (current) and textColor (legacy)
            const avatarColor = normalizeHex(payload.avatarColor || payload.textColor) || 'FFFFFF';
            const colors = Array.isArray(payload.colors)
                ? payload.colors.map(c => normalizeHex(c)).filter(Boolean)
                : [];
            if (colors.length === 0) {
                socket.emit('roomError', { error: 'En az bir renk sağlanmalıdır. HEX 6 haneli olmalı (örn: FF0000).' });
                return;
            }

            if (!room.teamColors) room.teamColors = { red: null, blue: null };
            room.teamColors[team] = {
                angle,
                avatarColor,
                colors,
                random: payload.random === true,
                jerseyId: typeof payload.jerseyId === 'string' && /^[a-z0-9-]{1,48}$/.test(payload.jerseyId)
                    ? payload.jerseyId
                    : null
            };

            io.to(room.id).emit('teamColorsUpdated', { team, teamColors: room.teamColors[team], allTeamColors: room.teamColors });
            io.to(room.id).emit('chatMessage', { playerName: 'SİSTEM', message: `${team.toUpperCase()} takım renkleri güncellendi.`, system: true });
        } catch (e) {
            console.error('[Server] setTeamColors error', e);
        }
    });

    socket.on('randomizeTeams', () => {
        const room = getPlayerRoom(socket.id);
        if (room) room.randomizeTeams(socket.id);
    });

    socket.on('clearTeam', (team) => {
        const room = getPlayerRoom(socket.id);
        if (room) room.clearTeam(socket.id, team);
    });

    socket.on('releasePlayerKick', ({ playerId } = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room || socket.id !== room.hostId || !playerId) return;
        room.players.get(playerId)?.socket?.emit('kickReleased');
    });

    // Full-state transfer is reliable and unicast to any room member.
    socket.on('requestFullState', (data = {}) => {
        const { matchEpoch, protocolVersion } = data || {};
        const room = getPlayerRoom(socket.id);
        if (!room || !room.players.has(socket.id)) return;
        if (protocolVersion !== NETWORK_PROTOCOL_VERSION) {
            socket.emit('protocolMismatch', { expected: NETWORK_PROTOCOL_VERSION, received: protocolVersion });
            return;
        }
        if (!['playing', 'goal', 'countdown'].includes(room.game?.state)) return;
        const now = Date.now();
        if (socket._lastFullStateRequestAt && now - socket._lastFullStateRequestAt < 900) return;
        socket._lastFullStateRequestAt = now;
        const host = io.sockets.sockets.get(room.hostId);
        if (!host || host.id === socket.id) return;
        host.emit('fullStateRequest', {
            playerId: socket.id,
            protocolVersion: NETWORK_PROTOCOL_VERSION,
            matchEpoch: typeof matchEpoch === 'string' ? matchEpoch.slice(0, 100) : null
        });
    });

    socket.on('fullGameState', (data = {}) => {
        const { playerId, state } = data || {};
        const room = getPlayerRoom(socket.id);
        if (!room || socket.id !== room.hostId || !playerId || playerId === socket.id) return;
        if (state?.protocolVersion !== NETWORK_PROTOCOL_VERSION) return;
        if (!room.game.matchEpoch && typeof state.matchEpoch === 'string') room.game.matchEpoch = state.matchEpoch;
        if (state.matchEpoch !== room.game.matchEpoch) return;
        if (!room.players.has(playerId) || !isValidFullGameState(state)) return;
        const target = room.players.get(playerId)?.socket;
        if (target) target.emit('fullGameState', state);
    });

    // --- Host Pause Event (relay to non-host players) ---
    socket.on('pauseGame', (data) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        if (socket.id !== room.hostId) return;
        room.game.paused = !!data?.paused;
        room.game.resuming = !!data?.resuming;
        if (room.game.paused && room.game.resuming && Number.isFinite(data?.durationMs)) {
            clearTimeout(room.game._resumeTimer);
            room.game._resumeTimer = setTimeout(() => {
                room.game.paused = false;
                room.game.resuming = false;
            }, Math.max(1000, Math.min(5000, data.durationMs)));
        } else if (!room.game.paused) {
            clearTimeout(room.game._resumeTimer);
            room.game._resumeTimer = null;
        }
        socket.to(room.id).emit('gamePaused', {
            paused: !!data?.paused,
            resuming: !!data?.resuming,
            durationMs: Number.isFinite(data?.durationMs)
                ? Math.max(1000, Math.min(5000, data.durationMs))
                : 3200
        });
    });

    // --- Host Goal Event (relay to non-host players) ---
    socket.on('hostMatchStarted', (data = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room || socket.id !== room.hostId || data?.protocolVersion !== NETWORK_PROTOCOL_VERSION || typeof data.matchEpoch !== 'string' || data.matchEpoch.length > 100) return;
        room.game.matchEpoch = data.matchEpoch;
    });

    socket.on('hostGoalEvent', (data) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        if (socket.id !== room.hostId) return;
        if (data?.protocolVersion !== NETWORK_PROTOCOL_VERSION || data.matchEpoch !== room.game.matchEpoch || !Number.isFinite(data?.scoreRed) || !Number.isFinite(data?.scoreBlue) || !['red', 'blue'].includes(data?.team)) return;
        room.game.scoreRed = data.scoreRed;
        room.game.scoreBlue = data.scoreBlue;
        room.game.state = 'goal';
        socket.to(room.id).emit('goalScored', { 
            team: data.team, 
            scoreRed: data.scoreRed, 
            scoreBlue: data.scoreBlue,
            scorer: data.scorer || '',
            assister: data.assister || '',
            ownGoal: !!data.ownGoal
        });
    });

    socket.on('hostMatchState', (data = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room || socket.id !== room.hostId) return;
        if (data?.protocolVersion !== NETWORK_PROTOCOL_VERSION || data.state !== 'playing' || data.matchEpoch !== room.game.matchEpoch) return;
        if (room.game.state === 'goal') room.game.state = 'playing';
    });

    // --- Host Game Over Event (relay to non-host players) ---
    socket.on('hostGameOverEvent', (data) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        if (socket.id !== room.hostId) return;
        if (data?.protocolVersion !== NETWORK_PROTOCOL_VERSION || data.matchEpoch !== room.game.matchEpoch || !Number.isFinite(data?.scoreRed) || !Number.isFinite(data?.scoreBlue)) return;
        room.game.scoreRed = data.scoreRed;
        room.game.scoreBlue = data.scoreBlue;
        room.game.state = 'ended';
        socket.to(room.id).emit('gameOver', {
            winner: data.winner,
            scoreRed: data.scoreRed,
            scoreBlue: data.scoreBlue,
            matchStats: data.matchStats || {}
        });
    });

    // --- Start/Stop Game ---
    socket.on('startGame', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;

        const player = room.players.get(socket.id);
        if (!player || !player.isAdmin) return;

        const red = room.getTeamPlayers('red').length;
        const blue = room.getTeamPlayers('blue').length;
        if (red === 0 && blue === 0) {
            socket.emit('roomError', { error: 'Oyunu başlatmak için en az 1 kişi takıma geçmelidir!' });
            return;
        }

        try {
            room.game.start();
            console.log(`[Server] Host-authority game started in room ${room.id}`);
        } catch (err) {
            console.error('[Server] Error starting game:', err);
            socket.emit('roomError', { error: 'Oyun başlatılırken bir hata oluştu.' });
        }
    });

    socket.on('stopGame', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;

        const player = room.players.get(socket.id);
        if (!player || !player.isAdmin) return;

        room.game.stop();
        room.broadcast('gameStopped', { reason: 'Stopped by admin', roomData: room.getRoomData() });
    });

    // --- Chat ---
    socket.on('chatMessage', (message) => {
        const room = getPlayerRoom(socket.id);
        if (room) room.chat(socket.id, message);
    });

    socket.on('setTyping', (state) => {
        const room = getPlayerRoom(socket.id);
        if (room) room.setTyping(socket.id, state);
    });

    // --- Admin Actions ---
    socket.on('kickPlayer', ({ playerId, reason }) => {
        const room = getPlayerRoom(socket.id);
        if (room) room.kickPlayer(socket.id, playerId, reason);
    });

    socket.on('banPlayer', ({ playerId, reason }) => {
        const room = getPlayerRoom(socket.id);
        if (room) room.banPlayer(socket.id, playerId, reason);
    });

    socket.on('giveAdmin', (playerId) => {
        const room = getPlayerRoom(socket.id);
        if (room) room.toggleAdmin(socket.id, playerId);
    });

    socket.on('toggleTeamLock', () => {
        const room = getPlayerRoom(socket.id);
        if (room) room.toggleTeamLock(socket.id);
    });

    socket.on('adminMovePlayer', ({ playerId, team }) => {
        const room = getPlayerRoom(socket.id);
        if (room) room.adminMovePlayer(socket.id, playerId, team);
    });

    socket.on('getRoomUpdate', () => {
        const room = getPlayerRoom(socket.id);
        if (room) {
            socket.emit('roomUpdate', {
                name: room.name,
                players: room.getPlayerList(),
                teamsLocked: room.teamsLocked,
                scoreLimit: room.game.scoreLimit,
                timeLimit: room.game.timeLimit,
                stadiumName: room.stadium.name
            });
        }
    });

    // --- Map (new server-authoritative system) ---
    socket.on('changeMap', (mapId) => {
        const room = getPlayerRoom(socket.id);
        if (room) room.changeMap(socket.id, mapId);
    });

    // --- Map Sync: client requests full map data by ID ---
    socket.on('requestMap', (data) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const mapId = data?.mapId || room.mapId;
        const mapData = MapManager.getMap(mapId);
        const mapHash = MapManager.getHash(mapId);
        socket.emit('mapSync', {
            mapId,
            mapHash,
            mapData,
            senderMapHash: room.mapHash // for client-side dedup check
        });
    });

    // --- Map List: get all available maps ---
    socket.on('getMapList', () => {
        socket.emit('mapList', MapManager.getMapList());
    });

    // --- Stadium (legacy) ---
    socket.on('changeStadium', (stadiumData) => {
        const room = getPlayerRoom(socket.id);
        if (room) room.changeStadium(socket.id, stadiumData);
    });

    // --- Score/Time Limits ---
    socket.on('setScoreLimit', (limit) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const player = room.players.get(socket.id);
        if (player?.isAdmin) {
            room.game.scoreLimit = limit === "0" ? 0 : (parseInt(limit) || 3);
            room.broadcast('roomUpdate', { scoreLimit: room.game.scoreLimit });
        }
    });

    socket.on('setTimeLimit', (limit) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const player = room.players.get(socket.id);
        if (player?.isAdmin) {
            room.game.timeLimit = limit === "0" ? 0 : (parseInt(limit) || 180);
            room.broadcast('roomUpdate', { timeLimit: room.game.timeLimit });
        }
    });

    socket.on('setOvertime', (enabled) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const player = room.players.get(socket.id);
        if (player?.isAdmin) {
            room.game.overtimeEnabled = !!enabled;
            room.broadcast('roomUpdate', { overtimeEnabled: room.game.overtimeEnabled });
        }
    });

    // --- Speed Multiplier ---
    socket.on('setSpeedMultiplier', (multiplier) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const player = room.players.get(socket.id);
        if (player?.isAdmin) {
            const val = parseFloat(multiplier);
            if (isFinite(val) && val > 0 && val <= 3) {
                const normalized = Math.round(val * 100) / 100;
                room.playerSpeedMultiplier = normalized;
                room.broadcast('roomUpdate', { playerSpeedMultiplier: room.playerSpeedMultiplier });
            }
        }
    });

    socket.on('setBallSpeedMultiplier', (multiplier) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const player = room.players.get(socket.id);
        if (player?.isAdmin) {
            const val = parseFloat(multiplier);
            if (isFinite(val) && val > 0 && val <= 3) {
                room.ballSpeedMultiplier = Math.round(val * 100) / 100;
                room.broadcast('roomUpdate', { ballSpeedMultiplier: room.ballSpeedMultiplier });
            }
        }
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
        console.log(`[Server] Player disconnected: ${socket.id}`);
        const room = getPlayerRoom(socket.id);
        if (room?.players.has(socket.id)) {
            issueResumeTicket(room, socket.id, true);
        } else {
            leaveCurrentRoom(socket);
        }
    });
});

// ============================================
// Helpers
// ============================================
function getPlayerRoom(socketId) {
    const roomId = playerRooms.get(socketId);
    return roomId ? rooms.get(roomId) : null;
}

function issueResumeTicket(room, playerId, disconnected = false) {
    const player = room.players.get(playerId);
    if (!player) return null;
    if (player.resumeToken) {
        const previous = resumeTickets.get(player.resumeToken);
        if (previous) {
            clearTimeout(previous.timer);
            if (!disconnected) return player.resumeToken;
            previous.expiresAt = Date.now() + RESUME_WINDOW_MS;
            previous.timer = setTimeout(() => expireResumeTicket(previous), RESUME_WINDOW_MS);
            previous.timer.unref?.();
            return player.resumeToken;
        }
    }
    const token = randomBytes(32).toString('base64url');
    const ticket = { token, roomId: room.id, playerId, expiresAt: disconnected ? Date.now() + RESUME_WINDOW_MS : Infinity, timer: null };
    if (disconnected) ticket.timer = setTimeout(() => expireResumeTicket(ticket), RESUME_WINDOW_MS);
    ticket.timer?.unref?.();
    player.resumeToken = token;
    resumeTickets.set(token, ticket);
    return token;
}

function expireResumeTicket(ticket) {
    if (resumeTickets.get(ticket.token) !== ticket) return;
    resumeTickets.delete(ticket.token);
    const room = rooms.get(ticket.roomId);
    const player = room?.players.get(ticket.playerId);
    if (!room || !player || player.socket?.connected) return;
    if (room.hostId === ticket.playerId || room.creatorId === ticket.playerId) {
        room.close('Oda sahibi bağlantıyı yeniden kuramadı');
        rooms.delete(room.id);
        clearRoomResumeTickets(room.id);
        for (const [id, idRoom] of playerRooms) if (idRoom === room.id) playerRooms.delete(id);
    } else {
        const remaining = room.removePlayer(ticket.playerId);
        playerRooms.delete(ticket.playerId);
        if (remaining === 0) {
            room.close('Oda boşaldı');
            rooms.delete(room.id);
            clearRoomResumeTickets(room.id);
        }
    }
}

function clearRoomResumeTickets(roomId) {
    for (const [token, ticket] of resumeTickets) {
        if (ticket.roomId !== roomId) continue;
        clearTimeout(ticket.timer);
        resumeTickets.delete(token);
    }
}

function leaveCurrentRoom(socket) {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (room) {
        const player = room.players.get(socket.id);
        if (player?.resumeToken) {
            const ticket = resumeTickets.get(player.resumeToken);
            if (ticket) clearTimeout(ticket.timer);
            resumeTickets.delete(player.resumeToken);
            player.resumeToken = null;
        }
        // HOST MODE: the room does not outlive its host. When the host leaves
        // the room is closed for everyone instead of transferring ownership.
        if (socket.id === room.creatorId || socket.id === room.hostId) {
            socket.leave(roomId);
            room.close('Oda sahibi ayrıldı');
            rooms.delete(roomId);
            clearRoomResumeTickets(roomId);

            // Everyone still in the closed room must forget it, otherwise they
            // would be treated as members of a room that no longer exists.
            for (const [otherId, otherRoomId] of playerRooms) {
                if (otherRoomId === roomId) playerRooms.delete(otherId);
            }

            console.log(`[Server] Host left, room closed: ${roomId}`);
            return;
        }

        const remaining = room.removePlayer(socket.id);
        socket.leave(roomId);

        // Delete empty rooms
        if (remaining === 0) {
            room.close('Oda boşaldı');
            rooms.delete(roomId);
            clearRoomResumeTickets(roomId);
            console.log(`[Server] Room deleted: ${roomId}`);
        }
    }

    playerRooms.delete(socket.id);
}

// ============================================
// Latency measurement loop
// ============================================
// Every 2 seconds: probe every socket and publish the measured pings, which is
// the same cadence used for the values shown in the player list.
const NET_PROBE_INTERVAL = 2000;
// A probe unanswered after this long counts as a lost packet ("red bar").
const NET_PROBE_TIMEOUT = 6000;

const netProbeTimer = setInterval(() => {
    const now = Date.now();

    for (const socket of io.sockets.sockets.values()) {
        const net = socket.data.net;
        if (!net) continue;

        for (const [id, sentAt] of net.pending) {
            if (now - sentAt > NET_PROBE_TIMEOUT) {
                net.pending.delete(id);
                net.lost++;
            }
        }

        const n = ++net.seq;
        net.pending.set(n, now);
        socket.emit('netProbe', { n });
    }

    for (const room of rooms.values()) {
        if (room.isEmpty()) continue;
        io.to(room.id).emit('playerPings', { pings: room.getPingList() });
    }
}, NET_PROBE_INTERVAL);
netProbeTimer.unref();

// ============================================
// Start Server
// ============================================
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`[GokBall Server] Running on port ${PORT}`);
    console.log(`[GokBall Server] Max rooms per IP: ${MAX_ROOMS_PER_IP}`);
    console.log(`[GokBall Server] ICE servers: ${getIceServers().map(s => s.urls).join(', ')}`);
});

// --- WebRTC signaling (room discovery + SDP/ICE relay only) ---
// Game traffic and physics never pass through here: once the peers negotiate a
// data channel, the host talks to each guest directly.
attachSignaling(io, { getPlayerRoom });

// --- Optional Admin HTTP Endpoint to change team colors (requires ADMIN_SECRET header) ---
// POST /admin/rooms/:id/teamColors
// Body: { team: 'red'|'blue', angle, avatarColor, colors: [] }
app.post('/admin/rooms/:id/teamColors', express.json(), (req, res) => {
    const secret = req.header('X-Admin-Secret') || req.header('x-admin-secret');
    if (!process.env.ADMIN_SECRET || !secret || secret !== process.env.ADMIN_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const room = rooms.get(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const payload = req.body;
    const team = (payload.team || '').toLowerCase();
    if (!['red','blue'].includes(team)) return res.status(400).json({ error: 'Invalid team' });
    const angle = normalizeAngle(payload.angle);
    const avatarColor = normalizeHex(payload.avatarColor || payload.textColor) || 'FFFFFF';
    const colors = Array.isArray(payload.colors) ? payload.colors.map(c => normalizeHex(c)).filter(Boolean) : [];
    if (!colors.length) return res.status(400).json({ error: 'At least one valid HEX color required' });

    if (!room.teamColors) room.teamColors = { red: null, blue: null };
    room.teamColors[team] = { angle, avatarColor, colors };

    io.to(room.id).emit('teamColorsUpdated', { team, teamColors: room.teamColors[team], allTeamColors: room.teamColors });
    return res.json({ ok: true, teamColors: room.teamColors[team] });
});

app.get('*', (req, res) => {
    res.status(404).sendFile(path.join(__dirname, '../dist/404.html'), (error) => {
        if (error) res.status(404).send('404 - Sayfa bulunamadı');
    });
});
