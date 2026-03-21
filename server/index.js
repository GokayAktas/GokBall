/**
 * GokBall Game Server
 * Express + Socket.io with room management
 */
import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { Room } from './Room.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
});

app.get('/', (req, res) => {
    res.send('<h1>GokBall Server is running!</h1><p>Use Vite (port 3000) for the game client.</p>');
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

    // --- Room Listing ---
    socket.on('listRooms', () => {
        const roomList = [...rooms.values()]
            .filter(r => !r.isEmpty())
            .map(r => r.getInfo());
        socket.emit('roomList', roomList);
    });

    // --- Ping/Pong ---
    socket.on('ping', () => {
        socket.emit('pong');
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
            stadium: options.stadium || null
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

    // --- Game Input ---
    socket.on('input', (input) => {
        const room = getPlayerRoom(socket.id);
        if (room && room.game.state === 'playing') {
            room.game.setPlayerInput(socket.id, input);
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
        if (red === 0 || blue === 0) {
            socket.emit('roomError', { error: 'Both teams need at least one player' });
            return;
        }

        room.game.start();
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
        const remaining = room.removePlayer(socket.id);
        socket.leave(roomId);

        // Delete empty rooms
        if (remaining === 0) {
            room.game.stop();
            rooms.delete(roomId);
            console.log(`[Server] Room deleted: ${roomId}`);
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
