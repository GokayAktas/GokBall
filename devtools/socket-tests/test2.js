import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');

socket.on('connect', () => {
    console.log('Connected', socket.id);
    socket.emit('createRoom', 'Test Room', { roomType: 'local', stadium: 'classic' });
});

socket.on('roomCreated', (res) => {
    if (res.roomId) {
        console.log('Room created', res.roomId);
        socket.emit('joinTeam', 'red');
    }
});

socket.on('teamChanged', (res) => {
    if (res.playerId === socket.id) {
        console.log('Joined team, sending empty authorityState...');
        // We simulate the admin's empty state before start
        socket.emit('authorityState', {
            physics: { discs: [] },
            scoreRed: 0, scoreBlue: 0, time: 0
        });
        setTimeout(() => {
            console.log('Starting game...');
            socket.emit('startGame');
        }, 1000);
    }
});

socket.on('gameStarted', () => {
    console.log('Game Started event received!');
});

let stateCount = 0;
socket.on('gameState', (state) => {
    stateCount++;
    if (stateCount <= 3) {
        console.log(`State [${state.state}] Discs:`, JSON.stringify(state.physics.discs));
    }
});

setTimeout(() => process.exit(0), 4000);
