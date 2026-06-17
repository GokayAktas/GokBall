import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { Room } from './Room.js';
import path from 'path';
import { fileURLToPath } from 'url';

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

// ============================================
// Socket.io Event Handling
// ============================================
io.on('connection', (socket) => {
    console.log(`[Server] Player connected: ${socket.id}`);

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
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // --- Host Ping Broadcast (for Local rooms)
    socket.on('hostPing', (payload) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        // Only accept host pings from the room creator/admin
        if (socket.id !== room.creatorId && socket.id !== room.adminId) return;
        // Broadcast host ping to everyone in room (including sender for sync)
        io.to(room.id).emit('hostPing', { ping: payload.ping });
    });

    // --- Create Room ---
    socket.on('createRoom', (options = {}) => {
        const roomName = (options.name || 'GokBall Room').trim();

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
            stadium: options.stadium || null,
            roomType: options.roomType || 'cloud'
        });

        rooms.set(room.id, room);

        const result = room.addPlayer(socket, options.playerName || 'Player');
        if (result.error) {
            socket.emit('roomError', result);
            return;
        }

        playerRooms.set(socket.id, room.id);
        socket.join(room.id);

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

        socket.emit('roomJoined', result);
        console.log(`[Server] Player ${socket.id} joined room ${room.name}`);
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
    // Payload: { team: 'red'|'blue', angle?: number, textColor?: 'FFFFFF', colors: ['C70000','FF5555'] }
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

            const angle = Number.isFinite(Number(payload.angle)) ? Number(payload.angle) : 0;
            const textColor = (payload.textColor || '').replace('#','').trim().toUpperCase() || 'FFFFFF';
            const colors = Array.isArray(payload.colors) ? payload.colors.map(c => (c||'').replace('#','').trim().toUpperCase()).filter(Boolean) : [];
            if (colors.length === 0) {
                socket.emit('roomError', { error: 'En az bir renk sağlanmalıdır.' });
                return;
            }

            if (!room.teamColors) room.teamColors = { red: null, blue: null };
            room.teamColors[team] = {
                angle,
                textColor,
                colors
            };

            // Apply to active discs if game running
            if (room.game && (room.game.state === 'playing' || room.game.state === 'countdown' || room.game.state === 'goal')) {
                room.game.physics.discs.forEach(d => {
                    if (d.isPlayer && d.team === team) {
                        d.color = colors[0];
                        d.colors = colors;
                        d.colorAngle = angle;
                        d.avatarColor = textColor;
                    }
                });
                // Notify clients with updated game state for immediate sync
                io.to(room.id).emit('gameState', room.game._getGameState());
            }

            // Broadcast team colors update to room so UIs can update CSS vars
            io.to(room.id).emit('teamColorsUpdated', { team, teamColors: room.teamColors[team], allTeamColors: room.teamColors });

            // Inform room via chat
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

    // --- Game Input ---
    socket.on('input', (input) => {
        const room = getPlayerRoom(socket.id);
        if (room && room.game.state === 'playing') {
            room.game.setPlayerInput(socket.id, input);
        }
    });

    // --- Authority Update (Local/P2P Host Mode) ---
    // In local mode, the Admin's client calculates physics and sends the authoritative state here.
    socket.on('authorityState', (state) => {
        const room = getPlayerRoom(socket.id);
        if (room && room.roomType === 'local' && socket.id === room.hostId) {
            // Apply admin's state to server and broadcast to everyone else
            room.game.applyAuthorityState(state);
            // Optimization: We could skip server tick in local mode, but for now we just sync.
        }
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

    // --- Stadium ---
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

    // --- Disconnect ---
    socket.on('disconnect', () => {
        console.log(`[Server] Player disconnected: ${socket.id}`);
        leaveCurrentRoom(socket);
    });
});

// ============================================
// Helpers
// ============================================
function getPlayerRoom(socketId) {
    const roomId = playerRooms.get(socketId);
    return roomId ? rooms.get(roomId) : null;
}

function leaveCurrentRoom(socket) {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (room) {
        // For local rooms: if creator leaves, Room.removePlayer kicks everyone
        // We need to clean up all those players' entries from playerRooms
        const isLocalCreator = room.roomType === 'local' && socket.id === room.creatorId;

        if (isLocalCreator) {
            // Collect all player socket IDs before removal
            const allPlayerIds = [...room.players.keys()];

            const remaining = room.removePlayer(socket.id);
            socket.leave(roomId);

            // Clean up playerRooms for all players in the closed room
            for (const pid of allPlayerIds) {
                playerRooms.delete(pid);
            }

            // Always delete the room since creator left
            room.game.stop();
            rooms.delete(roomId);
            console.log(`[Server] Local room closed (host left): ${roomId}`);
        } else {
            const remaining = room.removePlayer(socket.id);
            socket.leave(roomId);

            // Delete empty rooms
            if (remaining === 0) {
                room.game.stop();
                rooms.delete(roomId);
                console.log(`[Server] Room deleted: ${roomId}`);
            }
        }
    }

    playerRooms.delete(socket.id);
}

// ============================================
// Start Server
// ============================================
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`[GokBall Server] Running on port ${PORT}`);
});
