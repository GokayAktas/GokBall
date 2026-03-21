/**
 * GokBall - Main Application Entry Point
 * Wires together UI, engine, and networking
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

        // Connect to server
        try {
            await this.network.connect();
            this.physics.myPlayerId = this.network.playerId;
            console.log('[GokBall] Connected to server');
        } catch (err) {
            console.error('[GokBall] Failed to connect:', err);
        }

        // Setup network callbacks
        this._setupNetworkCallbacks();

        // Esc Menu Keyboard shortcut & Settings button binding
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.gameRunning) {
                // If modal settings is open, close it first
                if (this.settingsModal.isVisible) {
                    this.settingsModal.hide();
                    return;
                }
                this.inGameMenu.toggle();
            }
        });

        // Listen for HUD events
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
            <div class="stat-item"><span class="stat-icon" style="color:var(--success)">📶</span> <span id="pingValue">--</span> ms</div>
            <div class="stat-item"><span class="stat-icon" style="color:var(--warning)">⚡</span> <span id="fpsValue">0</span> fps</div>
        `;
        document.body.appendChild(statsHUD);

        // Ping update listener
        this.network.on('pingUpdate', (data) => {
            const pingEl = document.getElementById('pingValue');
            if (pingEl) pingEl.textContent = data.ping;
        });

        // Room Update -> Update InGameMenu if visible
        this.network.on('roomUpdate', (data) => {
            this.currentRoomData = data;
            if (data.name) this.scoreboard.updateRoomName(data.name);
            if (this.inGameMenu.isVisible) {
                this.inGameMenu.render(data);
            }
        });

        this.scoreboard.onSettingsClick = () => {
            this.inGameMenu.toggle();
        };

        // Show main menu
        this.ui.showScreen('mainMenu');
    }

    _setupNetworkCallbacks() {
        // Room created -> go to lobby
        this.network.on('roomCreated', (data) => {
            this.currentRoomData = data;
            this.stadiumData = data.stadium;
            this.ui.showScreen('roomLobby', data);
        });

        // Room joined -> go to lobby
        this.network.on('roomJoined', (data) => {
            this.currentRoomData = data;
            this.stadiumData = data.stadium;

            // If game is active, jump in as spectator/player
            if (data.game && (data.game.state === 'playing' || data.game.state === 'countdown' || data.game.state === 'goal')) {
                this.startGame(data);
            } else {
                this.ui.showScreen('roomLobby', data);
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

        this.network.on('teamLockChanged', (data) => {
            if (this.currentRoomData) {
                this.currentRoomData.teamsLocked = data.locked;
                if (this.inGameMenu.isVisible) {
                    this.inGameMenu.render(this.currentRoomData);
                }
            }
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
            if (this.currentRoomData && data.players) {
                this.currentRoomData.players = data.players;
                if (this.inGameMenu.isVisible) this.inGameMenu.render(this.currentRoomData);
            }
        });

        // Room error
        this.network.on('roomError', (data) => {
            alert(data.error || 'Bir hata oluştu');
        });

        // Game started -> enter game
        this.network.on('gameStarted', (data) => {
            this.startGame(this.currentRoomData);
        });

        // Game state update (during game)
        this.network.on('gameState', (state) => {
            if (!this.gameRunning) return;
            this._handleGameState(state);
        });

        // Goal scored
        this.network.on('goalScored', (data) => {
            if (this.scoreboard) {
                this.scoreboard.update(data.scoreRed, data.scoreBlue, 0);
                this.scoreboard.showGoal(data.team);
                this.audio.playGoal();
            }
            this.chat.addMessage({
                message: `⚽ GOL! ${data.team === 'red' ? 'Kırmızı' : 'Mavi'} takım skoru: ${data.scoreRed} - ${data.scoreBlue}`,
                system: true
            });
        });

        // Game over
        this.network.on('gameOver', (data) => {
            const winTeamStr = data.winner === 'red' ? 'Kırmızı' : 'Mavi';
            const color = data.winner === 'red' ? '#E74C3C' : '#3498DB';

            // Create nice on-screen overlay instead of alert
            const overlay = document.createElement('div');
            overlay.className = 'game-over-overlay';
            overlay.innerHTML = `
                <h1 style="color: ${color}; text-shadow: 2px 2px 0 #000; font-size: 48px; margin: 0; font-weight: bold;">${winTeamStr} TAKIM KAZANDI!</h1>
                <p style="color: white; font-size: 24px; text-shadow: 1px 1px 0 #000; margin-top: 10px;">Maç Skoru: ${data.scoreRed} - ${data.scoreBlue}</p>
            `;
            document.body.appendChild(overlay);

            // Wait 3 seconds, then return to lobby
            setTimeout(() => {
                if (document.body.contains(overlay)) {
                    document.body.removeChild(overlay);
                }
                this.stopGame();
                if (data.roomData) this.currentRoomData = data.roomData;
                this.ui.showScreen('roomLobby', this.currentRoomData);
            }, 3000);
        });

        // Game stopped
        this.network.on('gameStopped', (data) => {
            this.stopGame();
            if (data.roomData) this.currentRoomData = data.roomData;
            this.ui.showScreen('roomLobby', this.currentRoomData);
        });

        // Player kicked
        this.network.on('playerKicked', (data) => {
            this.stopGame();
            alert(data.reason || 'Odadan atıldınız');
            this.ui.showScreen('mainMenu');
        });

        // Chat messages during game
        this.network.on('chatMessage', (data) => {
            if (this.gameRunning) {
                this.chat.addMessage(data);
            }
        });

        // Disconnect
        this.network.on('disconnect', () => {
            this.stopGame();
            this.ui.showApp();
            this.ui.showScreen('mainMenu');
        });

        // Stadium changed
        this.network.on('stadiumChanged', (data) => {
            this.stadiumData = data.stadium;
        });
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

        // Send input to server
        const inputState = this.input.getInput();
        this.network.sendInput(inputState);

        // Update camera: Fixed static camera centered on stadium
        this.camera.targetX = 0;
        this.camera.targetY = 0;
        this.camera.update();

        // Render
        if (this._currentStadium) {
            this.renderer.render(this.camera, this._currentStadium, this.physics, {});
        }

        // Calculate FPS
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsTime >= 1000) {
            this.currentFps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsTime = now;
            const fpsEl = document.getElementById('fpsValue');
            if (fpsEl) fpsEl.textContent = this.currentFps;
        }

        this._animFrame = requestAnimationFrame(() => this._gameLoop());
    }

    _handleGameState(state) {
        // Detect kicks for sound effects
        if (state.physics && state.physics.discs) {
            const ball = state.physics.discs[0];
            const players = state.physics.discs.filter(d => d.isPlayer);

            for (const p of players) {
                if (p.kicking) {
                    const dx = ball.x - p.x;
                    const dy = ball.y - p.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    // More lenient distance check for sound trigger (radius sum + 8)
                    const minDist = (p.radius || 15) + (ball.radius || 10) + 8;

                    if (dist < minDist) {
                        // Debounce sound to avoid multiple plays in few frames
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
        this.physics.applyState(state.physics);

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
