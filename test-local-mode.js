import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');
let roomId;

socket.on('connect', () => {
    console.log('Connected', socket.id);
    socket.emit('createRoom', 'Test Room', { roomType: 'local', stadium: 'classic' });
});

socket.on('roomCreated', (res) => {
    if (res.roomId) {
        roomId = res.roomId;
        console.log('Room created', roomId);
        socket.emit('joinTeam', 'red');
    }
});

socket.on('teamChanged', (res) => {
    if (res.playerId === socket.id) {
        console.log('Joined team, starting game...');
        socket.emit('startGame');
    }
});

let frameCount = 0;
socket.on('gameStarted', () => {
    console.log('Game Started!');
    // Send authority state loop
    setInterval(() => {
        socket.emit('authorityState', {
            physics: {
                discs: [ { x: 0, y: 0, sx: 0, sy: 0 } ] // Mock ball
            },
            scoreRed: 0, scoreBlue: 0, time: 0
        });
    }, 16);
});

socket.on('gameState', (state) => {
    frameCount++;
    if (frameCount % 60 === 0) {
        console.log('Received Game State: ' + state.state, JSON.stringify(state.physics.discs).substring(0, 150) + '...');
    }
});

setTimeout(() => process.exit(0), 5000);
