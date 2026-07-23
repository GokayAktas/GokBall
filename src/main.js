/**
 * GokBall - Main Application Entry Point
 * Wires together UI, engine, and networking
 * All game logic runs on the server (host's machine), clients do prediction
 */
import { NetworkManager } from './network/NetworkManager.js';
import { Physics } from './engine/Physics.js';
import { Renderer } from './engine/Renderer.js';
import { Camera } from './engine/Camera.js';
import { InputManager } from './engine/InputManager.js';
import { Stadium } from './engine/Stadium.js';
import { UIManager } from './ui/UIManager.js';
import { MainMenu } from './ui/screens/MainMenu.js';
import { RoomList } from './ui/screens/RoomList.js';
import { CreateRoom } from './ui/screens/CreateRoom.js';
import { RoomLobby } from './ui/screens/RoomLobby.js';
import { Settings } from './ui/screens/Settings.js';
import { Chat } from './ui/components/Chat.js';
import { Scoreboard } from './ui/components/Scoreboard.js';
import { InGameMenu } from './ui/components/InGameMenu.js';
import { SettingsModal } from './ui/components/SettingsModal.js';
import { AudioManager } from './engine/AudioManager.js';

class GokBallApp {
    constructor() {
        this.network = new NetworkManager();
        this.physics = new Physics();
        this.renderer = new Renderer(document.getElementById('gameCanvas'));
        this.camera = new Camera();
        this.input = new InputManager();
        this.ui = new UIManager();
        this.chat = new Chat(this);
        this.scoreboard = new Scoreboard();
        this.inGameMenu = new InGameMenu(this);
        this.settingsModal = new SettingsModal(this);
        this.audio = new AudioManager();

        this.playerName = localStorage.getItem('gokball_nickname') || 'Player';
        this.currentRoomData = null;
        this.myDisc = null;
        this.gameRunning = false;
        this.stadiumData = null;

        // Server game state tracking
        this._serverGameState = 'stopped';

        // Load saved zoom
        const savedZoom = localStorage.getItem('gokball_zoom');
        if (savedZoom) this.camera.setZoom(parseFloat(savedZoom));

        // Load keybindings
        this.input.loadBindings();

        // Global Enter to Chat
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.gameRunning) {
                const chatInput = document.getElementById('gameChatInput');
                if (chatInput && document.activeElement !== chatInput) {
                    e.preventDefault();
                    if (this.chat.collapsed) this.chat._toggleCollapse();
                    chatInput.focus();
                }
            }
        });

        // Setup FPS tracking
        this.frameCount = 0;
        this.lastFpsTime = performance.now();
        this.currentFps = 0;
    }

    async init() {
        // Register UI screens
        this.ui.registerScreen('mainMenu', new MainMenu(this));
        this.ui.registerScreen('roomList', new RoomList(this));
        this.ui.registerScreen('createRoom', new CreateRoom(this));
        this.ui.registerScreen('roomLobby', new RoomLobby(this));
        this.ui.registerScreen('settings', new Settings(this));

        // Connect to game server (host's machine or remote)
        try {
            await this.network.connect();
            this.physics.myPlayerId = this.network.playerId;
            console.log('[GokBall] Connected to server:', this.network.playerId);
        } catch (err) {
            console.error('[GokBall] Connection failed:', err?.message || err);
            alert('Sunucuya bağlanılamadı! Lütfen sunucunun çalıştığından emin olun.\n\n' +
                  'Host: node server/index.js\n' +
                  'Ardından sayfayı yenileyin.');
            return;
        }

        // Setup network callbacks
        this._setupNetworkCallbacks();

        // Esc Menu Keyboard shortcut & Settings button binding
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.gameRunning) {
                if (this.settingsModal.isVisible) {
                    this.settingsModal.hide();
                    return;
                }
                this.inGameMenu.toggle();
            }
        });

        window.addEventListener('toggleInGameMenu', () => {
            if (this.gameRunning) this.inGameMenu.toggle();
        });

        window.addEventListener('toggleSettings', () => {
            if (this.gameRunning) {
                this.settingsModal.toggle();
            } else {
                this.ui.showScreen('settings');
            }
        });

        // Add Stats HUD dynamically
        const statsHUD = document.createElement('div');
        statsHUD.id = 'statsHUD';
        statsHUD.className = 'stats-hud hidden';
        statsHUD.innerHTML = `
            <div class="stat-item stat-ping"><span class="stat-icon">📶</span><span class="stat-value" id="pingValue">--</span><span class="stat-unit">ms</span></div>
            <div class="stat-item stat-fps"><span class="stat-icon">⚡</span><span class="stat-value" id="fpsValue">0</span><span class="stat-unit">fps</span></div>
        `;
        document.body.appendChild(statsHUD);

        // Ping update listener
        this.network.on('pingUpdate', (data) => {
            const pingEl = document.getElementById('pingValue');
            if (!pingEl) return;
            pingEl.textContent = data.ping;
        });

        // Room Update -> Update InGameMenu if visible
        this.network.on('roomUpdate', (data) => {
            this.currentRoomData = this.currentRoomData ? { ...this.currentRoomData, ...data } : data;
            if (data.name) this.scoreboard.updateRoomName(data.name);
            if (this.inGameMenu.isVisible) {
                this.inGameMenu.render(this.currentRoomData);
            }
        });

        this.scoreboard.onSettingsClick = () => {
            this.inGameMenu.toggle();
        };

        // Show main menu
        this.ui.showScreen('mainMenu');
    }

    // ============================================
    // Room Actions
    // ============================================

    createRoom(options) {
        if (!this.network.connected) {
            alert('Sunucuya bağlı değilsiniz! Lütfen sayfayı yenileyin.');
            return;
        }
        this.network.createRoom(options);
    }

    joinRoom(roomId, password) {
        this.network.joinRoom(roomId, password, this.playerName);
    }

    leaveRoom() {
        this.network.leaveRoom();
        this.stopGame();
        this.currentRoomData = null;
        this.ui.showScreen('mainMenu');
    }

    // ============================================
    // Game Lifecycle
    // ============================================

    startGame(roomData) {
        if (this.gameRunning) return;

        this.gameRunning = true;
        this.currentRoomData = roomData;

        // Load stadium
        const stadiumData = this.stadiumData || roomData?.stadium;
        if (stadiumData) {
            this.physics.loadStadium(stadiumData);
            this._currentStadium = stadiumData;
        }

        // Hide UI, show game
        this.ui.hideAll();
        this.renderer.show();
        document.getElementById('gameUI')?.classList.remove('hidden');

        // Show in-game components
        this.scoreboard.show();
        this.chat.show();
        if (roomData?.chatHistory?.length) {
            this.chat.loadHistory(roomData.chatHistory);
        }
        document.getElementById('statsHUD')?.classList.remove('hidden');

        // Enable input
        this.input.enable();

        // Start render loop
        this._gameLoop();
    }

    stopGame() {
        this.gameRunning = false;
        this.input.disable();
        this.renderer.hide();
        this.chat.hide();
        this.scoreboard.hide();
        this.inGameMenu.hide();
        this.settingsModal.hide();
        document.getElementById('gameUI')?.classList.add('hidden');
        document.getElementById('statsHUD')?.classList.add('hidden');
        this.ui.showApp();

        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
    }


    _gameLoop() {
        if (!this.gameRunning) return;

        // Get input
        const inputState = this.input.getInput();
        if (this.network.socket?.id) {
            this.physics.myPlayerId = this.network.socket.id;
        }

        // Send input to server
        this.network.sendInput(inputState);

        // Fixed Timestep Physics (60Hz) - Client-side prediction
        const now = performance.now();
        const dt = now - (this.lastPhysTime || now);
        this.lastPhysTime = now;
        this.accumulator = (this.accumulator || 0) + Math.min(dt, 100);

        const stepSize = 1000 / 60;
        while (this.accumulator >= stepSize) {
            if (this._serverGameState === 'playing') {
                // Client-side prediction
                for (const disc of this.physics.discs) {
                    if (disc.isPlayer) {
                        disc.input = { up: false, down: false, left: false, right: false, kick: false };
                    }
                }
                const myDisc = this.physics.discs.find(d => d.id === this.network.socket?.id);
                if (myDisc) myDisc.input = inputState;
                this.physics.step();
            }

            this.accumulator -= stepSize;
        }

        // Update camera
        this.camera.targetX = 0;
        this.camera.targetY = 0;
        this.camera.update();

        // Render
        if (this._currentStadium) {
            this.renderer.render(this.camera, this._currentStadium, this.physics, {});
        }

        // Calculate FPS
        this.frameCount++;
        if (now - this.lastFpsTime >= 1000) {
            this.currentFps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsTime = now;
            const fpsEl = document.getElementById('fpsValue');
            if (fpsEl) fpsEl.textContent = this.currentFps;
        }

        this._animFrame = requestAnimationFrame(() => this._gameLoop());
    }

    /** Setup callback handlers for network events */
    _setupNetworkCallbacks() {
        this.network.on('roomCreated', (data) => {
            this.currentRoomData = data;
            this.currentRoomData.creatorId = data.creatorId;
            this.stadiumData = data.stadium;
            this.physics.myPlayerId = this.network.socket?.id;
            this.ui.showScreen('roomLobby', data);
        });

        this.network.on('roomJoined', (data) => {
            this.currentRoomData = data;
            this.currentRoomData.creatorId = data.creatorId;
            this.stadiumData = data.stadium;
            this.physics.myPlayerId = this.network.socket?.id;
            if (data.game && (data.game.state === 'playing' || data.game.state === 'countdown' || data.game.state === 'goal')) {
                this.startGame(data);
            } else {
                this.ui.showScreen('roomLobby', data);
            }
        });

        this.network.on('roomError', (data) => {
            alert(data.error || 'Bir hata olu\u015ftu');
        });

        this.network.on('playerJoined', (data) => {
            if (this.currentRoomData && data.players) {
                this.currentRoomData.players = data.players;
                if (this.inGameMenu.isVisible) this.inGameMenu.render(this.currentRoomData);
            }
        });

        this.network.on('playerLeft', (data) => {
            if (this.currentRoomData && data.players) {
                this.currentRoomData.players = data.players;
                if (this.inGameMenu.isVisible) this.inGameMenu.render(this.currentRoomData);
            }
        });

        this.network.on('teamChanged', (data) => {
            if (this.currentRoomData && data.players) {
                this.currentRoomData.players = data.players;
                if (this.inGameMenu.isVisible) this.inGameMenu.render(this.currentRoomData);
            }
        });

        this.network.on('adminUpdate', (data) => {
            if (this.currentRoomData) {
                if (data.players) this.currentRoomData.players = data.players;
                this.currentRoomData.adminId = data.playerId;
                if (this.inGameMenu.isVisible) this.inGameMenu.render(this.currentRoomData);
            }
        });

        this.network.on('gameStarted', (data) => {
            if (data?.roomData) {
                this.currentRoomData = data.roomData;
                this.stadiumData = data.roomData.stadium || this.stadiumData;
            }
            this._serverGameState = 'playing'; // Start predicting immediately
            this.startGame(this.currentRoomData);
            if (data?.state) this._handleGameState(data.state);
        });

        this.network.on('gameState', (state) => {
            if (this.gameRunning) this._handleGameState(state);
        });

        this.network.on('goalScored', (data) => {
            if (this.scoreboard) {
                this.scoreboard.update(data.scoreRed, data.scoreBlue, 0);
                this.scoreboard.showGoal(data.team);
            }
            this.audio.playGoal();
            this.chat.addMessage({
                message: `\u26bd GOL! ${data.team === 'red' ? 'K\u0131rm\u0131z\u0131' : 'Mavi'} tak\u0131m skoru: ${data.scoreRed} - ${data.scoreBlue}`,
                system: true
            });
        });

        this.network.on('gameOver', (data) => {
            const winnerStr = data.winner === 'red' ? 'K\u0131rm\u0131z\u0131' : 'Mavi';
            const winnerColor = data.winner === 'red' ? '#c70000' : '#00008c';
            const overlay = document.createElement('div');
            overlay.className = 'game-over-overlay';
            overlay.innerHTML = `
                <h1 style="color: ${winnerColor}; text-shadow: 2px 2px 0 rgba(0,0,0,0.6); font-size: 48px; margin: 0; font-weight: bold;">${winnerStr} TAKIM KAZANDI!</h1>
                <p style="color: var(--text-primary); font-size: 24px; text-shadow: 1px 1px 0 rgba(0,0,0,0.6); margin-top: 10px;">Maç Skoru: ${data.scoreRed} - ${data.scoreBlue}</p>
            `;
            document.body.appendChild(overlay);
            setTimeout(() => {
                if (document.body.contains(overlay)) document.body.removeChild(overlay);
                this.stopGame();
            }, 3000);
        });

        this.network.on('teamLockChanged', (data) => {
            if (this.currentRoomData) {
                this.currentRoomData.teamsLocked = data.locked;
                if (this.inGameMenu.isVisible) this.inGameMenu.render(this.currentRoomData);
            }
        });

        this.network.on('roomUpdate', (data) => {
            if (this.currentRoomData) {
                if (data.scoreLimit !== undefined) this.currentRoomData.game.scoreLimit = data.scoreLimit;
                if (data.timeLimit !== undefined) this.currentRoomData.game.timeLimit = data.timeLimit;
                if (data.teamsLocked !== undefined) this.currentRoomData.teamsLocked = data.teamsLocked;
                if (data.players) this.currentRoomData.players = data.players;
                if (this.inGameMenu.isVisible) this.inGameMenu.render(this.currentRoomData);
            }
        });
    }

    _handleGameState(state) {
        this._serverGameState = state.state;

        // Set goal pause flag
        this.physics.inGoalPause = (state.state === 'goal');

        // Detect kicks for sound effects
        if (state.physics && state.physics.discs) {
            const ball = state.physics.discs[0];
            const players = state.physics.discs.filter(d => d.isPlayer);

            for (const p of players) {
                if (p.kicking) {
                    const dx = ball.x - p.x;
                    const dy = ball.y - p.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minDist = (p.radius || 15) + (ball.radius || 10) + 8;

                    if (dist < minDist) {
                        const now = Date.now();
                        if (!this._lastKickSound || now - this._lastKickSound > 150) {
                            this.audio.playKick();
                            this._lastKickSound = now;
                        }
                        break;
                    }
                }
            }
        }

        // Apply physics state from server
        if (state.physics) {
            this.physics.applyState(state.physics);
        }

        // Update scoreboard
        this.scoreboard.update(state.scoreRed, state.scoreBlue, state.time);
    }
}

// ============================================
// Bootstrap
// ============================================
window.addEventListener('DOMContentLoaded', () => {
    const app = new GokBallApp();
    app.init();
    window.gokball = app; // Dev access
});
