import { io } from 'socket.io-client';

const socket = io('http://localhost:3001', { transports: ['websocket'] });

socket.on('connect', () => {
  console.log('connected', socket.id);
  socket.emit('createRoom', { playerName: 'Tester' });
});

socket.on('roomCreated', (data) => {
  console.log('roomCreated', data);
  // Wait a bit then send /color command
  setTimeout(() => {
    console.log('Sending /color command');
    socket.emit('chatMessage', '/color red 45 FFFFFF C70000,FF5555');
  }, 1000);
});

socket.on('chatMessage', (m) => {
  console.log('CHAT:', m);
});

socket.on('teamColorsUpdated', (data) => {
  console.log('teamColorsUpdated:', data);
  process.exit(0);
});

socket.on('connect_error', (err) => {
  console.error('conn err', err.message);
  process.exit(1);
});
