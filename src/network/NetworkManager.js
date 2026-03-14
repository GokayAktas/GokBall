/**
 * Network Manager - Socket.io client wrapper
 * Handles connection, room management, and game state sync
 */
import { io } from 'socket.io-client';

export class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.playerId = null;
        this.callbacks = {};
    }

    /**
     * Connect to the game server
     */
    connect() {
        return new Promise((resolve, reject) => {
            this.socket = io({
                transports: ['websocket'],
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionAttempts: 10
            });

            this.socket.on('connect', () => {
                this.connected = true;
                this.playerId = this.socket.id;
                console.log('[Network] Connected:', this.playerId);
                resolve(this.playerId);
            });

            this.socket.on('disconnect', (reason) => {
                this.connected = false;
                console.log('[Network] Disconnected:', reason);
                this._trigger('disconnect', reason);
            });

            this.socket.on('connect_error', (err) => {
                console.error('[Network] Connection error:', err.message);
                reject(err);
            });

            // Game events
            this.socket.on('roomList', (rooms) => this._trigger('roomList', rooms));
            this.socket.on('roomCreated', (data) => this._trigger('roomCreated', data));
            this.socket.on('roomJoined', (data) => this._trigger('roomJoined', data));
            this.socket.on('roomError', (data) => this._trigger('roomError', data));
            this.socket.on('playerJoined', (data) => this._trigger('playerJoined', data));
            this.socket.on('playerLeft', (data) => this._trigger('playerLeft', data));
            this.socket.on('teamChanged', (data) => this._trigger('teamChanged', data));
            this.socket.on('gameState', (state) => this._trigger('gameState', state));
            this.socket.on('gameStarted', (data) => this._trigger('gameStarted', data));
            this.socket.on('gameStopped', (data) => this._trigger('gameStopped', data));
            this.socket.on('goalScored', (data) => this._trigger('goalScored', data));
            this.socket.on('gameOver', (data) => this._trigger('gameOver', data));
            this.socket.on('chatMessage', (data) => this._trigger('chatMessage', data));
            this.socket.on('adminUpdate', (data) => this._trigger('adminUpdate', data));

            // Custom Ping tracking
            this.ping = 0;
            this.socket.on('pong', () => {
                if (this._lastPingTime) {
                    this.ping = Date.now() - this._lastPingTime;
                    this._trigger('pingUpdate', { ping: this.ping });
                }
            });

            this._pingInterval = setInterval(() => {
                if (this.socket.connected) {
                    this._lastPingTime = Date.now();
                    this.socket.emit('ping');
                }
            }, 1000);

            this.socket.on('playerKicked', (data) => this._trigger('playerKicked', data));
            this.socket.on('stadiumChanged', (data) => this._trigger('stadiumChanged', data));
            this.socket.on('roomUpdate', (data) => this._trigger('roomUpdate', data));
            this.socket.on('countdown', (data) => this._trigger('countdown', data));
            this.socket.on('playerTyping', (data) => this._trigger('playerTyping', data));
        });
    }

    // === Room Management ===

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
        this.socket.emit('leaveRoom');
    }

    // === Team Management ===

    changeTeam(team) {
        this.socket.emit('changeTeam', team);
    }

    // === Game Actions ===

    sendInput(input) {
        this.socket.emit('input', input);
    }

    startGame() {
        this.socket.emit('startGame');
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

    banPlayer(playerId, reason) {
        this.socket.emit('banPlayer', { playerId, reason });
    }

    giveAdmin(playerId) {
        this.socket.emit('giveAdmin', playerId);
    }

    changeStadium(stadiumData) {
        this.socket.emit('changeStadium', stadiumData);
    }

    setScoreLimit(limit) {
        this.socket.emit('setScoreLimit', limit);
    }

    setTimeLimit(limit) {
        this.socket.emit('setTimeLimit', limit);
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
            cb(data);
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.connected = false;
    }
}
