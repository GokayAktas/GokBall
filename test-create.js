import { io } from 'socket.io-client';
const socket = io('http://127.0.0.1:3001');
socket.on('connect', () => {
    console.log('Connected');
    socket.emit('createRoom', { name: 'TestRoom', playerName: 'Tester' });
});
socket.on('roomCreated', (data) => {
    console.log('Room Created:', data.roomName);
    socket.emit('listRooms');
});
socket.on('roomList', (rooms) => {
    console.log('Room List:', rooms);
    process.exit(0);
});
socket.on('roomError', (err) => {
    console.error('Room Error:', err);
    process.exit(1);
});
setTimeout(() => {
    console.log('Timeout');
    process.exit(1);
}, 2000);
