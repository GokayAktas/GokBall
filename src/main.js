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

        // Local game state (for offline/local mode)
        this._localGameState = 'stopped'; // 'stopped' | 'playing' | 'goal' | 'ended'
        this._localTimeElapsed = 0;       // in ticks (60Hz)
        this._localScoreRed = 0;
        this._localScoreBlue = 0;
        this._localGoalPauseTicks = 0;    // countdown during goal celebration
        this._localGoalCooldownTicks = 0; // prevent duplicate goals
        this._localScoreLimit = 3;
        this._localTimeLimit = 180;       // seconds
        this._localKickOffTeam = 'red';
        this._localKickOffReset = false;

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

        // Connect to server (or fallback to local/offline mode)
        try {
            await this.network.connect();
            this.physics.myPlayerId = this.network.playerId;
            console.log('[GokBall] Connected to server');
        } catch (err) {
            console.warn('[GokBall] Server unavailable, switching to local/offline mode:', err.message);
            try {
                await this.network.connectLocal();
                this.physics.myPlayerId = this.network.playerId;
                console.log('[GokBall] Local mode active');
            } catch (localErr) {
                console.error('[GokBall] Local connection also failed:', localErr);
            }
        }

        // Local mode initialization
        if (this.network.isLocal) {
            this._initLocalMode();
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

    /** Initialize local mode event overrides */
    _initLocalMode() {
        console.log('[GokBall] Local mode initialized');

        // Override network changeTeam to work locally
        this.network.changeTeam = (team) => {
            if (!['red', 'blue', 'spectator'].includes(team)) return;
            if (this.currentRoomData?.players) {
                const myPlayer = this.currentRoomData.players.find(p => p.id === this.network.playerId);
                if (myPlayer) {
                    myPlayer.team = team;
                    this._triggerLocalEvent('teamChanged', {
                        playerId: this.network.playerId,
                        team,
                        players: this.currentRoomData.players
                    });
                    this._triggerLocalEvent('roomUpdate', {
                        players: this.currentRoomData.players
                    });
                }
            }
        };

        // Override startGame
        this.network.startGame = () => {
            this._localStartGame();
        };

        // Override stopGame
        this.network.stopGame = () => {
            this._localStopGame();
        };

        // Override changeStadium (handles both string keys and HBS objects)
        this.network.changeStadium = (stadiumData) => {
            if (this._localGameState === 'playing' || this._localGameState === 'goal') return;
            
            let finalStadium = stadiumData;
            
            // String stadium name -> try to load a pre-generated one via the server's _loadLocalStadium
            if (typeof stadiumData === 'string') {
                this._loadLocalStadium(stadiumData);
                return;
            }
            
            if (typeof finalStadium === 'object') {
                this.stadiumData = finalStadium;
                this._currentStadium = finalStadium;
                if (this.currentRoomData) this.currentRoomData.stadium = finalStadium;
                this._triggerLocalEvent('stadiumChanged', { stadium: finalStadium });
                this._triggerLocalEvent('chatMessage', {
                    playerName: '🏟 SİSTEM', message: `Saha değiştirildi: ${finalStadium?.name || 'Custom'}`,
                    team: 'spectator', system: true
                });
            }
        };

        // Handle socket.emit calls from RoomLobby and other components
        if (this.network.socket) {
            const origEmit = this.network.socket.emit.bind(this.network.socket);
            this.network.socket.emit = (event, data) => {
                switch (event) {
                    case 'toggleTeamLock':
                        if (this.currentRoomData) {
                            const locked = !this.currentRoomData.teamsLocked;
                            this.currentRoomData.teamsLocked = locked;
                            this._triggerLocalEvent('teamLockChanged', { locked });
                            this._triggerLocalEvent('chatMessage', {
                                playerName: '🏟 SİSTEM',
                                message: locked ? '🔒 Takımlar kilitlendi' : '🔓 Takım kilidi açıldı',
                                system: true, team: 'spectator'
                            });
                        }
                        break;

                    case 'setScoreLimit':
                        if (this.currentRoomData?.game) {
                            const limit = data === '0' ? 0 : (parseInt(data) || 3);
                            this.currentRoomData.game.scoreLimit = limit;
                            this._localScoreLimit = limit;
                            this._triggerLocalEvent('roomUpdate', { scoreLimit: limit });
                        }
                        break;

                    case 'setTimeLimit':
                        if (this.currentRoomData?.game) {
                            const limit = data === '0' ? 0 : (parseInt(data) || 180);
                            this.currentRoomData.game.timeLimit = limit;
                            this._localTimeLimit = limit;
                            this._triggerLocalEvent('roomUpdate', { timeLimit: limit });
                        }
                        break;

                    case 'setOvertime':
                        if (this.currentRoomData?.game) {
                            this.currentRoomData.game.overtimeEnabled = !!data;
                            this._triggerLocalEvent('roomUpdate', { overtimeEnabled: !!data });
                        }
                        break;

                    case 'randomizeTeams':
                        // Single player - just a fun notification
                        this._triggerLocalEvent('chatMessage', {
                            playerName: '[SİSTEM]',
                            message: '🎲 Tek oyuncu modunda takımlar karıştırılamaz!',
                            team: 'spectator', system: true
                        });
                        break;

                    case 'clearTeam':
                        // Move admin to spectator
                        if (this.currentRoomData?.players) {
                            const myP = this.currentRoomData.players.find(p => p.id === this.network.playerId);
                            if (myP && myP.team === data) {
                                myP.team = 'spectator';
                                this._triggerLocalEvent('teamChanged', {
                                    playerId: this.network.playerId,
                                    team: 'spectator',
                                    players: this.currentRoomData.players
                                });
                            }
                        }
                        break;

                    default:
                        console.log('[Network][Local] emit:', event, data);
                }
            };
        }
    }

    /** Generate small stadium */
    _generateSmallStadium() { return this._generateClassicStadium(); } // Simplified — reuse classic

    _loadLocalStadium(stadiumKey) {
        // All stadiums use the same classic structure (simplified for local mode)
        const stadium = this._generateClassicStadium();
        
        const names = {
            small: 'Küçük', classic: 'Klasik', futsal: 'Futsal 3v3',
            big: 'Büyük', huge: 'Devasa'
        };
        stadium.name = names[stadiumKey] || 'Klasik';

        this.stadiumData = stadium;
        this._currentStadium = stadium;
        if (this.currentRoomData) this.currentRoomData.stadium = stadium;
        this._triggerLocalEvent('stadiumChanged', { stadium });
        this._triggerLocalEvent('chatMessage', {
            playerName: '🏟 SİSTEM', message: `Saha değiştirildi: ${stadium.name}`,
            team: 'spectator', system: true
        });
    }

    /** Trigger a local event (simulates server event) */
    _triggerLocalEvent(event, data) {
        // Use setTimeout to simulate async server response
        setTimeout(() => {
            this.network._trigger(event, data);
        }, 0);
    }

    // ============================================
    // Local Room Creation
    // ============================================

    /** Generate a full classic stadium with physics data */
    _generateClassicStadium() {
        const fieldW = 370, fieldH = 170, spawnDist = 170;
        const goalDepth = 40, goalWidth = 64, goalBackWidth = 44;
        return {
            name: 'Klasik', width: fieldW + goalDepth + 10, height: fieldH + 30, spawnDistance: spawnDist,
            bg: { type: 'grass', width: fieldW, height: fieldH, kickOffRadius: 75, cornerRadius: 0,
                color: '699057', stripeColor: '7B9F6C', bgColor: '718D5A', lineColor: 'C7E6BD',
                showCenterLine: true, showKickOffCircle: true },
            vertexes: [
                { x: -fieldW, y: fieldH, bCoef: 0.1, cMask: ['ball'] },
                { x: -fieldW, y: goalWidth, bCoef: 0.1, cMask: ['ball'] },
                { x: -fieldW, y: -goalWidth, bCoef: 0.1, cMask: ['ball'] },
                { x: -fieldW, y: -fieldH, bCoef: 0.1, cMask: ['ball'] },
                { x: fieldW, y: fieldH, bCoef: 0.1, cMask: ['ball'] },
                { x: fieldW, y: goalWidth, bCoef: 0.1, cMask: ['ball'] },
                { x: fieldW, y: -goalWidth, bCoef: 0.1, cMask: ['ball'] },
                { x: fieldW, y: -fieldH, bCoef: 0.1, cMask: ['ball'] },
                { x: 0, y: fieldH, bCoef: 0.1, cMask: [], cGroup: [] },
                { x: 0, y: -fieldH, bCoef: 0.1, cMask: [], cGroup: [] },
                { x: -(fieldW + goalDepth), y: goalBackWidth, bCoef: 0.1, cMask: ['ball'] },
                { x: -(fieldW + goalDepth), y: -goalBackWidth, bCoef: 0.1, cMask: ['ball'] },
                { x: (fieldW + goalDepth), y: goalBackWidth, bCoef: 0.1, cMask: ['ball'] },
                { x: (fieldW + goalDepth), y: -goalBackWidth, bCoef: 0.1, cMask: ['ball'] }
            ],
            segments: [
                { v0: 0, v1: 8, curve: 0, vis: true, color: 'C7E6BD', bCoef: 1, cMask: ['ball'] },
                { v0: 8, v1: 4, curve: 0, vis: true, color: 'C7E6BD', bCoef: 1, cMask: ['ball'] },
                { v0: 3, v1: 9, curve: 0, vis: true, color: 'C7E6BD', bCoef: 1, cMask: ['ball'] },
                { v0: 9, v1: 7, curve: 0, vis: true, color: 'C7E6BD', bCoef: 1, cMask: ['ball'] },
                { v0: 0, v1: 1, curve: 0, vis: true, color: 'C7E6BD', bCoef: 1, cMask: ['ball'] },
                { v0: 2, v1: 3, curve: 0, vis: true, color: 'C7E6BD', bCoef: 1, cMask: ['ball'] },
                { v0: 4, v1: 5, curve: 0, vis: true, color: 'C7E6BD', bCoef: 1, cMask: ['ball'] },
                { v0: 6, v1: 7, curve: 0, vis: true, color: 'C7E6BD', bCoef: 1, cMask: ['ball'] },
                { v0: 1, v1: 10, curve: 90, vis: true, color: '000000', bCoef: 0.1, cMask: ['ball'] },
                { v0: 10, v1: 11, curve: 0, vis: true, color: '000000', bCoef: 0.1, cMask: ['ball'] },
                { v0: 11, v1: 2, curve: 90, vis: true, color: '000000', bCoef: 0.1, cMask: ['ball'] },
                { v0: 5, v1: 12, curve: -90, vis: true, color: '000000', bCoef: 0.1, cMask: ['ball'] },
                { v0: 12, v1: 13, curve: 0, vis: true, color: '000000', bCoef: 0.1, cMask: ['ball'] },
                { v0: 13, v1: 6, curve: -90, vis: true, color: '000000', bCoef: 0.1, cMask: ['ball'] }
            ],
            goals: [
                { p0: [-fieldW, goalWidth], p1: [-fieldW, -goalWidth], team: 'red' },
                { p0: [fieldW, goalWidth], p1: [fieldW, -goalWidth], team: 'blue' }
            ],
            discs: [
                { pos: [0, 0], radius: 10, invMass: 1, bCoef: 0.5, damping: 0.99, color: 'FFFFFF', cMask: ['all'], cGroup: ['ball'] },
                { pos: [-fieldW, goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: 'CCCCFF', cMask: ['all'] },
                { pos: [-fieldW, -goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: 'CCCCFF', cMask: ['all'] },
                { pos: [fieldW, goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: 'CCCCFF', cMask: ['all'] },
                { pos: [fieldW, -goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: 'CCCCFF', cMask: ['all'] }
            ],
            planes: [
                { normal: [0, 1], dist: -(fieldH + 30), bCoef: 0.1, cMask: ['all'] },
                { normal: [0, -1], dist: -(fieldH + 30), bCoef: 0.1, cMask: ['all'] },
                { normal: [1, 0], dist: -(fieldW + goalDepth + 10), bCoef: 0.1, cMask: ['all'] },
                { normal: [-1, 0], dist: -(fieldW + goalDepth + 10), bCoef: 0.1, cMask: ['all'] }
            ],
            playerPhysics: {
                radius: 15, bCoef: 0.5, invMass: 0.5, damping: 0.96,
                acceleration: 0.10, kickingAcceleration: 0.065, kickingDamping: 0.96, kickStrength: 5
            },
            ballPhysics: 'disc0'
        };
    }

    _createLocalRoom(options) {
        const localId = this.network.playerId;
        const roomId = 'local_room_' + Date.now();

        // Current player data
        const playerData = {
            id: localId,
            name: this.playerName || 'Player',
            team: 'spectator',
            isAdmin: true,
            avatar: Math.floor(Math.random() * 99 + 1).toString()
        };

        // Generate full stadium data with physics
        let stadium = null;
        if (options.stadium && typeof options.stadium === 'object') {
            stadium = options.stadium;
        } else {
            stadium = this._generateClassicStadium();
        }

        // Room data (mimics server roomCreated response)
        const roomData = {
            roomId: roomId,
            roomName: options.name || 'Yerel Oda',
            roomType: 'local',
            creatorId: localId,
            adminId: localId,
            player: playerData,
            players: [playerData],
            stadium: stadium,
            teamsLocked: false,
            teamColors: {
                red: { angle: 0, textColor: 'FFFFFF', colors: ['D32F2F'] },
                blue: { angle: 0, textColor: 'FFFFFF', colors: ['1565C0'] }
            },
            game: {
                state: 'stopped',
                scoreRed: 0,
                scoreBlue: 0,
                time: 0,
                scoreLimit: options.scoreLimit !== undefined ? options.scoreLimit : 3,
                timeLimit: options.timeLimit !== undefined ? options.timeLimit : 180
            },
            chatHistory: []
        };

        this.stadiumData = stadium;

        // Trigger local roomCreated event
        this._triggerLocalEvent('roomCreated', roomData);
    }

    // ============================================
    // Local Game Management
    // ============================================

    _localStartGame() {
        if (this._localGameState === 'playing') return;

        this._localGameState = 'playing';
        this._localTimeElapsed = 0;
        this._localScoreRed = 0;
        this._localScoreBlue = 0;
        this._localGoalCooldownTicks = 0;
        this._localKickOffReset = true;
        this._localKickOffTeam = 'red';
        this._serverGameState = 'playing';

        // Start game first (loads stadium, clears UI, starts game loop)
        this.startGame(this.currentRoomData);

        // Spawn player discs AFTER stadium is loaded (fixes disc clearing bug)
        this._localSpawnPlayers();

        // Set kickoff state for physics
        this.physics.kickOffReset = true;
        this.physics.kickOffTeam = 'red';

        // Broadcast start locally
        this._triggerLocalEvent('gameStarted', {
            scoreRed: 0,
            scoreBlue: 0,
            roomData: this.currentRoomData,
            state: {
                state: 'playing',
                physics: this.physics.getState(),
                scoreRed: 0,
                scoreBlue: 0,
                time: 0
            }
        });

        // Chat message
        this._triggerLocalEvent('chatMessage', {
            playerName: '🏟 SİSTEM', message: '🎮 Maç başladı!',
            team: 'spectator', system: true
        });
    }

    _localSpawnPlayers() {
        // Remove existing player discs
        const toRemove = [];
        for (let i = 0; i < this.physics.discs.length; i++) {
            if (this.physics.discs[i].isPlayer) toRemove.push(i);
        }
        for (const idx of toRemove.sort((a, b) => b - a)) {
            this.physics.discs.splice(idx, 1);
        }

        // Find which team the local player is on
        const myPlayer = this.currentRoomData?.players?.find(p => p.id === this.network.playerId);
        // Default to 'red' if spectator (spectators don't get a disc)
        const myTeam = (myPlayer?.team === 'red' || myPlayer?.team === 'blue') ? myPlayer.team : 'red';

        const playerPhysics = {
            radius: 15, bCoef: 0.5, invMass: 0.5, damping: 0.96,
            acceleration: 0.10, kickingAcceleration: 0.065, kickingDamping: 0.96, kickStrength: 5
        };

        const spawnDist = this._currentStadium?.spawnDistance || 170;

        // Spawn the local player's disc
        const spawnX = myTeam === 'red' ? -spawnDist : spawnDist;
        const disc = this.physics.addPlayerDisc(playerPhysics, myTeam, spawnX, 0);
        disc.id = this.network.playerId;
        disc._playerName = this.playerName;
        disc.color = myTeam === 'red' ? 'c70000' : '00008c';
        disc.colors = [disc.color];
        disc.avatarColor = 'FFFFFF';
        disc.ownerId = this.network.playerId;
    }

    _localStopGame() {
        this._localGameState = 'stopped';
        this._triggerLocalEvent('gameStopped', {
            reason: 'Stopped by admin',
            roomData: this.currentRoomData
        });
    }

    /** Handle goal scoring in local mode (called from _gameLoop) */
    _localHandleGoal(scoredOnTeam) {
        // scoredOnTeam = the team whose goal was scored on (they conceded)
        const scoringTeam = scoredOnTeam === 'red' ? 'blue' : 'red';

        if (scoringTeam === 'red') this._localScoreRed++;
        else this._localScoreBlue++;

        // Set goal state
        this._localGameState = 'goal';
        this._localGoalPauseTicks = 3 * 60; // 3 seconds at 60Hz
        this._localGoalCooldownTicks = this._localTimeElapsed + 60 + 2;
        this._localKickOffReset = true;
        this._localKickOffTeam = scoredOnTeam; // conceded team gets kickoff

        // Set physics state
        this.physics.kickOffReset = true;
        this.physics.kickOffTeam = scoredOnTeam;
        this.physics.inGoalPause = true;

        // Update scoreboard
        this.scoreboard.update(this._localScoreRed, this._localScoreBlue, Math.floor(this._localTimeElapsed / 60));
        this.scoreboard.showGoal(scoringTeam);
        this.audio.playGoal();

        // Chat message
        this.chat.addMessage({
            message: `⚽ GOL! ${scoringTeam === 'red' ? 'Kırmızı' : 'Mavi'} takım skoru: ${this._localScoreRed} - ${this._localScoreBlue}`,
            system: true
        });
    }

    /** Handle game over in local mode */
    _localGameOver() {
        const winner = this._localScoreRed > this._localScoreBlue ? 'red' : 'blue';
        this._localGameState = 'ended';

        const winTeamStr = winner === 'red' ? 'Kırmızı' : 'Mavi';
        const root = document.documentElement;
        const color = winner === 'red'
            ? (getComputedStyle(root).getPropertyValue('--red-team') || '#c70000')
            : (getComputedStyle(root).getPropertyValue('--blue-team') || '#00008c');

        const overlay = document.createElement('div');
        overlay.className = 'game-over-overlay';
        overlay.innerHTML = `
            <h1 style="color: ${color}; text-shadow: 2px 2px 0 rgba(0,0,0,0.6); font-size: 48px; margin: 0; font-weight: bold;">${winTeamStr} TAKIM KAZANDI!</h1>
            <p style="color: var(--text-primary); font-size: 24px; text-shadow: 1px 1px 0 rgba(0,0,0,0.6); margin-top: 10px;">Maç Skoru: ${this._localScoreRed} - ${this._localScoreBlue}</p>
        `;
        document.body.appendChild(overlay);

        setTimeout(() => {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            this.stopGame();
            this._localGameState = 'stopped';
            this._localTimeElapsed = 0;
            if (this.currentRoomData) {
                this.currentRoomData.game = {
                    ...this.currentRoomData.game,
                    state: 'stopped',
                    scoreRed: this._localScoreRed,
                    scoreBlue: this._localScoreBlue
                };
                this.ui.showScreen('roomLobby', this.currentRoomData);
            } else {
                this.ui.showScreen('mainMenu');
            }
        }, 3000);
    }

    // ============================================
    // Room Actions
    // ============================================

    createRoom(options) {
        if (!this.network.connected) {
            alert('Sunucuya bağlı değilsiniz! Lütfen sayfayı yenileyin.');
            return;
        }

        // Local mode: create room entirely on the client side
        if (this.network.isLocal) {
            this._createLocalRoom(options);
            return;
        }

        // Server mode: send to server
        this.network.createRoom(options);
    }

    joinRoom(roomId, password) {
        this.network.joinRoom(roomId, password, this.playerName);
    }

    leaveRoom() {
        if (!this.network.isLocal) {
            this.network.leaveRoom();
        }
        this.stopGame();
        this.currentRoomData = null;
        this._localGameState = 'stopped';
        this._localTimeElapsed = 0;
        this._localScoreRed = 0;
        this._localScoreBlue = 0;
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

        // Send input (no-op in local mode with fake socket)
        this.network.sendInput(inputState);

        // Fixed Timestep Physics (60Hz)
        const now = performance.now();
        const dt = now - (this.lastPhysTime || now);
        this.lastPhysTime = now;
        this.accumulator = (this.accumulator || 0) + Math.min(dt, 100);

        const stepSize = 1000 / 60;
        while (this.accumulator >= stepSize) {
            if (this._localGameState === 'playing' || this._serverGameState === 'playing') {
                // --- LOCAL MODE: Full game state management ---
                if (this.network.isLocal) {
                    // Local mode game loop
                    for (const disc of this.physics.discs) {
                        if (disc.isPlayer) {
                            disc.input = { up: false, down: false, left: false, right: false, kick: false };
                        }
                    }
                    const myDisc = this.physics.discs.find(d => d.id === this.network.socket?.id);
                    if (myDisc) myDisc.input = inputState;

                    const result = this.physics.step();

                    // Check for goals
                    if (result.goalTeam && this._localGameState === 'playing') {
                        if (this._localTimeElapsed >= this._localGoalCooldownTicks) {
                            this._localHandleGoal(result.goalTeam);
                        }
                    }

                    // Advance time
                    if (!this.physics.kickOffReset) {
                        this._localTimeElapsed++;
                    }

                    // Check time limit
                    if (this._localTimeLimit > 0 && this._localTimeElapsed / 60 >= this._localTimeLimit) {
                        if (this._localScoreRed !== this._localScoreBlue) {
                            this._localGameOver();
                        }
                    }

                    // Update scoreboard
                    this.scoreboard.update(this._localScoreRed, this._localScoreBlue, Math.floor(this._localTimeElapsed / 60));

                } else {
                    // --- SERVER MODE: prediction only ---
                    for (const disc of this.physics.discs) {
                        if (disc.isPlayer) {
                            disc.input = { up: false, down: false, left: false, right: false, kick: false };
                        }
                    }
                    const myDisc = this.physics.discs.find(d => d.id === this.network.socket?.id);
                    if (myDisc) myDisc.input = inputState;
                    this.physics.step();
                }
            } else if (this._localGameState === 'goal') {
                // Goal pause: physics still runs (ball keeps moving)
                this.physics.step();
                this._localGoalPauseTicks--;

                if (this._localGoalPauseTicks <= 0) {
                    // Reset ball to center
                    if (this.physics.ballDisc) {
                        this.physics.ballDisc.pos.x = 0;
                        this.physics.ballDisc.pos.y = 0;
                        this.physics.ballDisc.speed.x = 0;
                        this.physics.ballDisc.speed.y = 0;
                        this.physics.ballDisc.color = 'FFB82E';
                    }

                    // Check score limit
                    if (this._localScoreLimit > 0 &&
                        (this._localScoreRed >= this._localScoreLimit || this._localScoreBlue >= this._localScoreLimit)) {
                        this._localGameOver();
                        this.accumulator -= stepSize;
                        continue;
                    }

                    // Reset positions for next kickoff
                    this.physics.kickOffReset = true;
                    this.physics.kickOffTeam = this._localKickOffTeam;
                    this.physics.inGoalPause = false;
                    this.physics.resetPositions();
                    this._localSpawnPlayers();
                    this._localGameState = 'playing';
                    this._serverGameState = 'playing';
                }
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

    _handleGameState(state) {
        this._serverGameState = state.state; // Track game state locally

        // Set goal pause flag to prevent teleportation during goal celebration
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
