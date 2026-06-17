import { io } from 'socket.io-client';
const socket = io('http://127.0.0.1:3001');
socket.on('connect', () => {
    console.log('Connected');
    socket.emit('listRooms');
});
socket.on('roomList', (rooms) => {
    console.log('Rooms:', rooms);
    process.exit(0);
});
setTimeout(() => {
    console.log('Timeout');
    process.exit(1);
}, 2000);
