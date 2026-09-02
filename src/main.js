/**
 * GokBall - Main Application Entry Point
 * Wires together UI, engine, and networking
 * All game logic runs on the server (host's machine), clients do prediction
 */
import { NetworkManager } from './network/NetworkManager.js';
import { Physics, CollisionFlags, Disc } from './engine/Physics.js';
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
import { SnapshotBuffer } from './network/SnapshotBuffer.js';

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

        // Map cache: hash -> mapData (avoids re-downloading identical maps)
        this._mapCache = new Map();
        this._currentMapId = null;
        this._currentMapHash = null;

        // Server game state tracking
        this._serverGameState = 'stopped';

        // Snapshot interpolation buffer for non-host clients
        this._snapshotBuffer = new SnapshotBuffer(30); // 30ms interpolation delay for low-latency rendering
        this._lastSnapshotTime = 0;

        // Host-authority mode (room creator runs physics)
        this._isHostAuthority = false;
        this._remoteInputs = new Map(); // playerId -> input
        this._hostScoreRed = 0;
        this._hostScoreBlue = 0;
        this._hostTimeElapsed = 0;
        this._hostGoalPauseTicks = 0;
        this._hostGameState = 'stopped';
        this._hostScoreLimit = 3;
        this._hostTimeLimit = 180;
        this._hostKickOffTeam = 'red';
        this._hostAuthoritySendCounter = 0;
        this._hostLastGoalTeam = null; // Track last scored team for authority state

        // Pause state
        this._isPaused = false;

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

        // P key for pause (host only)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') {
                if (this.gameRunning && this._isHost() && this._isHostAuthority) {
                    e.preventDefault();
                    this._togglePause();
                }
            }
        });

        // Setup FPS tracking
        this.frameCount = 0;
        this.lastFpsTime = performance.now();
        this.currentFps = 0;

        // Fix: When tab becomes visible again, reset physTime to avoid huge dt spike
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.gameRunning) {
                this.lastPhysTime = performance.now();
                this.accumulator = 0;
            }
            // Host: when tab is hidden, start a setInterval fallback so physics keeps running
            // When tab is visible again, clear the fallback (rAF takes over)
            if (this._isHost() && this._isHostAuthority) {
                this._toggleHostBackgroundLoop();
            }
        });
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
            alert('Sunucuya bağlanılamadı!\n\n' +
                  '1. Render sunucunuzun çalıştığından emin olun\n' +
                  '2. VITE_SERVER_URL ayarını kontrol edin\n' +
                  '3. Sayfayı yenileyin');
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
            <div class="stat-item stat-fps"><span class="stat-icon">🎮</span><span class="stat-value" id="fpsValue">0</span><span class="stat-unit">fps</span></div>
        `;
        document.body.appendChild(statsHUD);

        // Ping update listener with jitter
        this.network.on('pingUpdate', (data) => {
            const pingEl = document.getElementById('pingValue');
            if (pingEl) {
                // Combined ping: player's own + host's connection to server
                const combinedPing = data.ping + (this.network.hostPing || 0);
                pingEl.textContent = combinedPing;
            }
            // Dynamic interpolation delay: estimatedLatency + 20ms buffer, clamped 30-50ms
            if (this._snapshotBuffer) {
                const estimatedLatency = (data.ping + (this.network.hostPing || 0)) / 2;
                this._snapshotBuffer.interpolationDelay = Math.max(30, Math.min(50, estimatedLatency + 20));
            }
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
        this._firstStateReceived = false; // Wait for initial server state before client prediction
        this._stadiumReady = false; // Guard against gameState arriving before stadium loads

        // Load stadium immediately so render loop can draw the field
        const stadiumData = this.stadiumData || roomData?.stadium;
        if (stadiumData) {
            this.physics.loadStadium(stadiumData);
            this._currentStadium = stadiumData;
            this._stadiumReady = true;
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
        this._isPaused = false;
        this._removePauseOverlay();
        this.input.disable();
        this.renderer.hide();
        this.chat.hide();
        this.scoreboard.hide();
        this.inGameMenu.hide();
        this.settingsModal.hide();
        document.getElementById('gameUI')?.classList.add('hidden');
        document.getElementById('statsHUD')?.classList.add('hidden');
        document.getElementById('gameCanvas')?.classList.remove('paused');
        this.ui.showApp();

        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }

        // Clean up host background loop
        if (this._hostBgInterval) {
            clearInterval(this._hostBgInterval);
            this._hostBgInterval = null;
        }
    }


    _gameLoop() {
        if (!this.gameRunning) return;

        // Get local input
        const inputState = this.input.getInput();
        if (this.network.socket?.id) {
            this.physics.myPlayerId = this.network.socket.id;
        }

        // Send input to server
        this.network.sendInput(inputState);

        // Fixed Timestep Physics (60Hz)
        const now = performance.now();
        const dt = now - (this.lastPhysTime || now);
        this.lastPhysTime = now;
        this.accumulator = (this.accumulator || 0) + Math.min(dt, 100);

        // Cap accumulator to max 3 steps to prevent freeze on tab refocus
        const stepSize = 1000 / 60;
        const maxAccum = stepSize * 3;
        if (this.accumulator > maxAccum) this.accumulator = maxAccum;

        while (this.accumulator >= stepSize) {                // --- HOST MODE: Full authority game loop ---
            if (this._isHost() && this._isHostAuthority) {

                // Skip physics when paused
                if (this._isPaused) {
                    // Still send occasional authority state so non-host clients sync
                    this._hostAuthoritySendCounter = (this._hostAuthoritySendCounter || 0) + 1;
                    if (this._hostAuthoritySendCounter % 30 === 0) {
                        this._sendAuthorityState();
                    }
                    this.accumulator -= stepSize;
                    continue;
                }

                if (this._hostGameState === 'playing') {
                    // Apply inputs to ALL player discs
                    for (const disc of this.physics.discs) {
                        if (!disc.isPlayer) continue;
                        disc.input = { up: false, down: false, left: false, right: false, kick: false };
                    }

                    // Local player input
                    const myDisc = this.physics.discs.find(d => d.id === this.network.socket?.id);
                    if (myDisc) myDisc.input = inputState;

                    // Remote player inputs
                    for (const [playerId, remoteInput] of this._remoteInputs) {
                        const remoteDisc = this.physics.discs.find(d => d.id === playerId || d.ownerId === playerId);
                        if (remoteDisc) {
                            remoteDisc.input = remoteInput;
                        }
                    }

                    // Step physics
                    const result = this.physics.step();

                    // Track ball touches for goal attribution (host mode)
                    if (this.physics.ballDisc) {
                        const toucher = this.physics.ballDisc.lastTouchedBy;
                        if (toucher && toucher !== this._hostLastToucher) {
                            this._hostPrevToucher = this._hostLastToucher;
                            this._hostLastToucher = toucher;
                        }
                    }

                    // Play kick sound for host (clients get it via goalScored/authorityState)
                    if (result.kickHappened) {
                        const now = Date.now();
                        if (!this._lastKickSound || now - this._lastKickSound > 150) {
                            this.audio.playKick();
                            this._lastKickSound = now;
                        }
                    }

                    // Track saves (kick near own goal line)
                    if (result.saveDetected) {
                        const savePlayer = this.currentRoomData?.players?.find(p => p.id === result.saveDetected);
                        const saveName = savePlayer?.name || '';
                        if (!this._hostMatchStats[result.saveDetected]) {
                            this._hostMatchStats[result.saveDetected] = { goals: 0, assists: 0, saves: 0, name: saveName, team: savePlayer?.team };
                        }
                        this._hostMatchStats[result.saveDetected].saves++;
                    }

                    // Check for goals
                    if (result.goalTeam && this._hostGameState === 'playing') {
                        this._hostHandleGoal(result.goalTeam);
                    }

                    // Advance time
                    if (!this.physics.kickOffReset) {
                        this._hostTimeElapsed++;
                    }

                    // Check time limit
                    if (this._hostTimeLimit > 0 && this._hostTimeElapsed / 60 >= this._hostTimeLimit) {
                        if (this._hostScoreRed !== this._hostScoreBlue) {
                            this._hostGameOver();
                        }
                    }

                    // Update scoreboard
                    this.scoreboard.update(this._hostScoreRed, this._hostScoreBlue, Math.floor(this._hostTimeElapsed / 60));

                    // Send authority state to server (relayed to other players)
                    this._sendAuthorityState();
                }

                else if (this._hostGameState === 'goal') {
                    // Goal pause: clear all player inputs so they don't keep moving
                    for (const disc of this.physics.discs) {
                        if (disc.isPlayer) {
                            disc.input = { up: false, down: false, left: false, right: false, kick: false };
                            disc.kicking = false;
                        }
                    }
                    // Physics still runs (for ball momentum), but players don't move
                    this.physics.step();
                    this._hostGoalPauseTicks--;

                    // Send authority state during goal pause so non-host clients see the ball
                    this._sendAuthorityState();

                    if (this._hostGoalPauseTicks <= 0) {
                        // Reset ball to center
                        if (this.physics.ballDisc) {
                            this.physics.ballDisc.pos.x = 0;
                            this.physics.ballDisc.pos.y = 0;
                            this.physics.ballDisc.speed.x = 0;
                            this.physics.ballDisc.speed.y = 0;
                            this.physics.ballDisc.color = 'FFB82E';
                        }

                        // Check score limit
                        if (this._hostScoreLimit > 0 &&
                            (this._hostScoreRed >= this._hostScoreLimit || this._hostScoreBlue >= this._hostScoreLimit)) {
                            this._hostGameOver();
                            this.accumulator -= stepSize;
                            continue;
                        }

                        // Reset for next kickoff (use resetPositions to keep disc IDs intact)
                        this.physics.kickOffReset = true;
                        this.physics.kickOffTeam = this._hostKickOffTeam;
                        this.physics.inGoalPause = false;
                        this.physics.resetPositions();
                        this._hostGameState = 'playing';
                        this._serverGameState = 'playing';
                        
                        // Send authority state immediately so non-host clients see the reset
                        this._sendAuthorityState();
                    }
                }

            } else {
                // --- CLIENT MODE: Local prediction + remote interpolation ---
                // Wait for first server state before running client prediction
                if (!this._firstStateReceived) {
                    this.accumulator -= stepSize;
                    continue;
                }
                if (this._serverGameState === 'playing' || this._serverGameState === 'goal') {
                    const myId = this.network.socket?.id;
                    const myDisc = this.physics.discs.find(d => d.id === myId);

                    // Interpolate remote players from snapshot buffer
                    const interp = this._snapshotBuffer.getInterpolatedState(Date.now());
                    if (interp && interp.physics && interp.physics.discs) {
                        // Build lookup of local player discs by ID for fast matching
                        const localById = {};
                        for (const d of this.physics.discs) {
                            if (d.isPlayer && d.id) localById[d.id] = d;
                        }

                        for (let si = 0; si < interp.physics.discs.length; si++) {
                            const sd = interp.physics.discs[si];
                            // Match player discs by ID, others by index
                            let localDisc = null;
                            if (sd.isPlayer && sd.id && localById[sd.id]) {
                                localDisc = localById[sd.id];
                            } else if (!sd.isPlayer) {
                                localDisc = this.physics.discs[si]; // Ball & static: index
                            }
                            if (!localDisc) continue;

                            if (sd.isPlayer && sd.id === myId) {
                                // Local player: reconcile against server position
                                const dx = sd.x - localDisc.pos.x;
                                const dy = sd.y - localDisc.pos.y;
                                const distSq = dx * dx + dy * dy;
                                // Dynamic thresholds based on ping
                                const ping = this.network.ping || 0;
                                const snapThreshold = Math.max(100, Math.min(200, ping + 50));
                                const driftThreshold = Math.max(20, Math.min(50, ping / 2 + 15));
                                if (distSq > snapThreshold * snapThreshold) {
                                    // Large desync: snap to server
                                    localDisc.pos.x = sd.x;
                                    localDisc.pos.y = sd.y;
                                    localDisc.speed.x = sd.sx;
                                    localDisc.speed.y = sd.sy;
                                } else if (distSq > driftThreshold * driftThreshold) {
                                    // Medium desync: moderate correction
                                    localDisc.pos.x += dx * 0.3;
                                    localDisc.pos.y += dy * 0.3;
                                } else if (distSq > 2 * 2) {
                                    // Small drift: gentle correction
                                    localDisc.pos.x += dx * 0.1;
                                    localDisc.pos.y += dy * 0.1;
                                }
                            } else if (!sd.isPlayer) {
                                // Ball & non-player discs: interpolate from snapshot
                                localDisc.pos.x += (sd.x - localDisc.pos.x) * 0.4;
                                localDisc.pos.y += (sd.y - localDisc.pos.y) * 0.4;
                                localDisc.speed.x = sd.sx;
                                localDisc.speed.y = sd.sy;
                                if (sd.color !== undefined) localDisc.color = sd.color;
                            } else {
                                // Remote players: smooth but responsive interpolation
                                localDisc.pos.x += (sd.x - localDisc.pos.x) * 0.5;
                                localDisc.pos.y += (sd.y - localDisc.pos.y) * 0.5;
                                localDisc.speed.x = sd.sx;
                                localDisc.speed.y = sd.sy;
                                localDisc.kicking = sd.kicking;
                            }
                        }
                    }

                    // Local player: immediate prediction (runs AFTER reconciliation)
                    if (myDisc && myDisc.isPlayer) {
                        myDisc.input = inputState;
                        let ax = 0, ay = 0;
                        if (inputState.up) ay -= 1;
                        if (inputState.down) ay += 1;
                        if (inputState.left) ax -= 1;
                        if (inputState.right) ax += 1;
                        const accelMag = Math.sqrt(ax * ax + ay * ay);
                        if (accelMag > 0) {
                            const currentAccel = myDisc.kicking ? (myDisc.kickingAcceleration || 0.07) : (myDisc.acceleration || 0.1);
                            myDisc.speed.x += (ax / accelMag) * currentAccel;
                            myDisc.speed.y += (ay / accelMag) * currentAccel;
                        }
                        const damp = myDisc.kicking ? (myDisc.kickingDamping || 0.96) : (myDisc.damping || 0.96);
                        myDisc.speed.x *= damp;
                        myDisc.speed.y *= damp;
                        myDisc.pos.x += myDisc.speed.x;
                        myDisc.pos.y += myDisc.speed.y;
                        myDisc.input = { up: false, down: false, left: false, right: false, kick: false };
                    }
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
            this.renderer.render(this.camera, this._currentStadium, this.physics, {
                kickOffReset: this.physics.kickOffReset,
                kickOffTeam: this.physics.kickOffTeam
            });
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

    /** Check if this client is the room creator/host */
    _isHost() {
        return this.currentRoomData?.creatorId === this.network.socket?.id;
    }

    /**
     * When the host's tab is hidden, browsers throttle requestAnimationFrame.
     * This backup interval keeps the physics game loop running even when rAF is paused.
     */
    _toggleHostBackgroundLoop() {
        if (document.hidden && this.gameRunning && this._isHost() && this._isHostAuthority) {
            // Start backup interval if not already running
            if (!this._hostBgInterval) {
                this._hostBgInterval = setInterval(() => {
                    if (!this.gameRunning) {
                        clearInterval(this._hostBgInterval);
                        this._hostBgInterval = null;
                        return;
                    }
                    // Run a mini game loop tick (same as _gameLoop but without rAF)
                    const now = performance.now();
                    const dt = now - (this.lastPhysTime || now);
                    this.lastPhysTime = now;
                    this.accumulator = (this.accumulator || 0) + Math.min(dt, 100);
                    const stepSize = 1000 / 60;
                    while (this.accumulator >= stepSize) {
                        // Only run host physics steps (simplified)
                        if (this._isHost() && this._isHostAuthority && !this._isPaused) {
                            if (this._hostGameState === 'playing') {
                                for (const disc of this.physics.discs) {
                                    if (!disc.isPlayer) continue;
                                    disc.input = disc.input || { up: false, down: false, left: false, right: false, kick: false };
                                }
                                // Apply remote inputs
                                for (const [playerId, remoteInput] of this._remoteInputs) {
                                    const remoteDisc = this.physics.discs.find(d => d.id === playerId || d.ownerId === playerId);
                                    if (remoteDisc) remoteDisc.input = remoteInput;
                                }
                                const result = this.physics.step();
                                if (result.kickHappened) this.audio.playKick();
                                if (result.goalTeam && this._hostGameState === 'playing') {
                                    this._hostHandleGoal(result.goalTeam);
                                }
                                if (!this.physics.kickOffReset) this._hostTimeElapsed++;
                                this.scoreboard.update(this._hostScoreRed, this._hostScoreBlue, Math.floor(this._hostTimeElapsed / 60));
                                this._sendAuthorityState();
                            } else if (this._hostGameState === 'goal') {
                                for (const disc of this.physics.discs) {
                                    if (disc.isPlayer) { disc.input = { up: false, down: false, left: false, right: false, kick: false }; disc.kicking = false; }
                                }
                                this.physics.step();
                                this._hostGoalPauseTicks--;
                                this._sendAuthorityState();
                                if (this._hostGoalPauseTicks <= 0) {
                                    if (this.physics.ballDisc) {
                                        this.physics.ballDisc.pos.x = 0; this.physics.ballDisc.pos.y = 0;
                                        this.physics.ballDisc.speed.x = 0; this.physics.ballDisc.speed.y = 0;
                                        this.physics.ballDisc.color = 'FFB82E';
                                    }
                                    if (this._hostScoreLimit > 0 && (this._hostScoreRed >= this._hostScoreLimit || this._hostScoreBlue >= this._hostScoreLimit)) {
                                        this._hostGameOver();
                                        this.accumulator -= stepSize; continue;
                                    }
                                    this.physics.kickOffReset = true;
                                    this.physics.kickOffTeam = this._hostKickOffTeam;
                                    this.physics.inGoalPause = false;
                                    this.physics.resetPositions();
                                    this._hostGameState = 'playing';
                                    this._serverGameState = 'playing';
                                    this._sendAuthorityState();
                                }
                            }
                        }
                        this.accumulator -= stepSize;
                    }
                }, 1000 / 60); // ~60fps
                console.log('[GokBall] Host background loop started (tab hidden)');
            }
        } else if (!document.hidden && this._hostBgInterval) {
            // Tab is visible again, rAF takes over — clear the interval
            clearInterval(this._hostBgInterval);
            this._hostBgInterval = null;
            console.log('[GokBall] Host background loop stopped (tab visible)');
        }
    }

    /** Initialize host-authority game mode (state only, spawning happens after startGame) */
    _initHostGame() {
        this._hostScoreRed = 0;
        this._hostScoreBlue = 0;
        this._hostTimeElapsed = 0;
        this._hostGoalPauseTicks = 0;
        this._hostGameState = 'playing';
        this._hostKickOffTeam = 'red';
        this._hostScoreLimit = this.currentRoomData?.game?.scoreLimit || 3;
        this._hostTimeLimit = this.currentRoomData?.game?.timeLimit || 180;
        this._hostLastToucher = null;
        this._hostPrevToucher = null;
        this._hostMatchStats = {};
        this._remoteInputs.clear();
        console.log('[GokBall] Host game state initialized');
    }

    /** Spawn discs for ALL players in host mode */
    _hostSpawnAllPlayers() {
        // Remove existing player discs
        const toRemove = [];
        for (let i = 0; i < this.physics.discs.length; i++) {
            if (this.physics.discs[i].isPlayer) toRemove.push(i);
        }
        for (const idx of toRemove.sort((a, b) => b - a)) {
            this.physics.discs.splice(idx, 1);
        }

        const basePP = this._currentStadium?.playerPhysics || {
            radius: 15, bCoef: 0.5, invMass: 0.5, damping: 0.96,
            acceleration: 0.10, kickingAcceleration: 0.065, kickingDamping: 0.96, kickStrength: 5
        };
        // Apply speed multiplier from room settings
        const speedMult = this.currentRoomData?.playerSpeedMultiplier || 1.0;
        const pp = {
            ...basePP,
            acceleration: (basePP.acceleration || 0.1) * speedMult,
            kickingAcceleration: (basePP.kickingAcceleration || 0.065) * speedMult,
        };
        const spawnDist = this._currentStadium?.spawnDistance || 170;

        const players = this.currentRoomData?.players || [];
        // Separate by team
        const redPlayers = players.filter(p => p.team === 'red');
        const bluePlayers = players.filter(p => p.team === 'blue');

        const spacing = 40;
        const spawnTeam = (teamPlayers, team, dir) => {
            const tc = this.currentRoomData?.teamColors?.[team];
            for (let i = 0; i < teamPlayers.length; i++) {
                const p = teamPlayers[i];
                const y = (i - (teamPlayers.length - 1) / 2) * spacing;
                const disc = this.physics.addPlayerDisc(pp, team, dir * spawnDist, y);
                disc.id = p.id;
                disc.ownerId = p.id;
                disc._playerName = p.name;
                disc._avatar = p.avatar || '1';
                if (tc && tc.colors && tc.colors.length > 0) {
                    disc.color = tc.colors[0];
                    disc.colors = tc.colors;
                    disc.colorAngle = tc.angle || 0;
                    disc.avatarColor = tc.avatarColor || tc.textColor || 'FFFFFF';
                } else {
                    disc.color = team === 'red' ? 'c70000' : '00008c';
                    disc.colors = [disc.color];
                    disc.colorAngle = 0;
                    disc.avatarColor = 'FFFFFF';
                }
            }
        };

        spawnTeam(redPlayers, 'red', -1);
        spawnTeam(bluePlayers, 'blue', 1);
    }

    /** Handle goal in host mode */
    _hostHandleGoal(scoredOnTeam) {
        const scoringTeam = scoredOnTeam === 'red' ? 'blue' : 'red';

        if (scoringTeam === 'red') this._hostScoreRed++;
        else this._hostScoreBlue++;

        this._hostGameState = 'goal';
        this._hostGoalPauseTicks = 3 * 60; // 3 seconds at 60Hz
        this._hostKickOffTeam = scoredOnTeam; // conceded team gets kickoff

        this.physics.kickOffReset = true;
        this.physics.kickOffTeam = scoredOnTeam;
        this.physics.inGoalPause = true;

        // Record scorer and assister
        const scorerName = this._hostLastToucher ? (this.currentRoomData?.players?.find(p => p.id === this._hostLastToucher)?.name || '') : '';
        // Assister: last toucher on same team as scorer, before the scorer
        let assisterName = '';
        if (this._hostPrevToucher && this._hostPrevToucher !== this._hostLastToucher) {
            const prevPlayer = this.currentRoomData?.players?.find(p => p.id === this._hostPrevToucher);
            if (prevPlayer && prevPlayer.team === scoringTeam) {
                assisterName = prevPlayer.name || '';
            }
        }

        // Track match stats locally
        if (this._hostLastToucher) {
            if (!this._hostMatchStats[this._hostLastToucher]) this._hostMatchStats[this._hostLastToucher] = { goals: 0, assists: 0, saves: 0, name: scorerName, team: scoringTeam };
            this._hostMatchStats[this._hostLastToucher].goals++;
        }
        if (assisterName) {
            if (!this._hostMatchStats[this._hostPrevToucher]) this._hostMatchStats[this._hostPrevToucher] = { goals: 0, assists: 0, saves: 0, name: assisterName, team: scoringTeam };
            this._hostMatchStats[this._hostPrevToucher].assists++;
        }

        // Reset touch tracking for next goal
        this._hostLastToucher = null;
        this._hostPrevToucher = null;

        // Update scoreboard locally
        this.scoreboard.update(this._hostScoreRed, this._hostScoreBlue, Math.floor(this._hostTimeElapsed / 60));
        this.scoreboard.showGoal(scoringTeam);
        this.audio.playGoal();

        // Format: 🔴 GOL! PlayerName ⚽ PlayerName 👟
        const teamEmoji = scoringTeam === 'red' ? '🔴' : '🔵';
        let goalMsg = `${teamEmoji} GOL!`;
        if (scorerName) goalMsg += ` ${scorerName} ⚽`;
        if (assisterName) goalMsg += ` ${assisterName} 👟`;
        goalMsg += ` (${this._hostScoreRed} - ${this._hostScoreBlue})`;
        this.chat.addMessage({ message: goalMsg, system: true });

        // Send goalScored event to server for relay to other players
        this.network.socket?.emit('hostGoalEvent', {
            team: scoringTeam,
            scoreRed: this._hostScoreRed,
            scoreBlue: this._hostScoreBlue,
            scorer: scorerName,
            assister: assisterName
        });
    }

    /** Handle game over in host mode */
    _hostGameOver() {
        const winner = this._hostScoreRed > this._hostScoreBlue ? 'red' : 'blue';
        this._hostGameState = 'ended';

        const winTeamStr = winner === 'red' ? 'K\u0131rm\u0131z\u0131' : 'Mavi';
        const winColor = winner === 'red' ? '#c70000' : '#00008c';

        // Calculate points: goals=3, assists=1, saves=0.25
        const ranked = Object.entries(this._hostMatchStats)
            .filter(([_, s]) => s.goals > 0 || s.assists > 0 || s.saves > 0)
            .map(([id, s]) => ({
                id, name: s.name, team: s.team,
                goals: s.goals || 0, assists: s.assists || 0, saves: s.saves || 0,
                points: (s.goals || 0) * 3 + (s.assists || 0) * 1 + (s.saves || 0) * 0.25
            }))
            .sort((a, b) => b.points - a.points);

        const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32']; // gold, silver, bronze
        const medalEmojis = ['🥇', '🥈', '🥉'];

        // Send game over to server for relay to other players
        this.network.socket?.emit('hostGameOverEvent', {
            winner: winner,
            scoreRed: this._hostScoreRed,
            scoreBlue: this._hostScoreBlue,
            matchStats: this._hostMatchStats
        });

        const overlay = document.createElement('div');
        overlay.className = 'game-over-overlay';
        overlay.innerHTML = `
            <div class="game-over-card">
                <div class="game-over-trophy">🏆</div>
                <div class="game-over-winner" style="color: ${winColor};">${winTeamStr} TAKIM KAZANDI!</div>
                <div class="game-over-scores">
                    <span class="game-over-score game-over-score-red">${this._hostScoreRed}</span>
                    <span class="game-over-separator">—</span>
                    <span class="game-over-score game-over-score-blue">${this._hostScoreBlue}</span>
                </div>
                <div class="game-over-label">MAÇ SKORU</div>
                ${ranked.length > 0 ? `<div class="game-over-rankings">
                    ${ranked.map((p, i) => {
                        const color = medalColors[i] || 'rgba(255,255,255,0.7)';
                        const medal = medalEmojis[i] || '';
                        const mvp = i === 0 ? '<span class="mvp-badge">⭐ MVP</span>' : '';
                        const stats = [];
                        if (p.goals > 0) stats.push(`⚽${p.goals}`);
                        if (p.assists > 0) stats.push(`👟${p.assists}`);
                        if (p.saves > 0) stats.push(`🧤${p.saves}`);
                        return `<div class="ranking-row" style="color:${color}">
                            <span class="ranking-medal">${medal}</span>
                            <span class="ranking-name">${p.name}</span>
                            ${mvp}
                            <span class="ranking-stats">${stats.join(' ')}</span>
                            <span class="ranking-points">${p.points} puan</span>
                        </div>`;
                    }).join('')}
                </div>` : '<div class="game-over-no-stats">İstatistik bulunamadı.</div>'}
            </div>
        `;
        document.body.appendChild(overlay);

        // Show simplified stats in chat (no saves in chat)
        if (ranked.length > 0) {
            let statsMsg = '📊 MAÇ İSTATİSTİKLERİ:\n';
            for (const p of ranked) {
                const parts = [];
                if (p.goals > 0) parts.push(`⚽${p.goals} Gol`);
                if (p.assists > 0) parts.push(`👟${p.assists} Asist`);
                statsMsg += `${p.name}: ${parts.join(' | ')} (${p.points} puan)\n`;
            }
            this.chat.addMessage({ message: statsMsg, system: true });
        }

        setTimeout(() => {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            // Notify server that host-authority game has ended
            this.network.socket?.emit('stopGame');
            this._isHostAuthority = false;
            this._hostGameState = 'stopped';
            this.stopGame();
            if (this.currentRoomData) {
                this.ui.showScreen('roomLobby', this.currentRoomData);
            } else {
                this.ui.showScreen('roomList');
            }
        }, 5000);
    }

    /** Toggle pause state (host only) */
    _togglePause() {
        if (!this._isHost() || !this._isHostAuthority) return;
        if (this._hostGameState !== 'playing' && !this._isPaused) return;
        
        // If resume animation is playing, cancel it and re-pause
        if (this._resumeAnimating) {
            this._cancelResumeAnimation();
            this._showPauseOverlay();
            this.network.socket?.emit('pauseGame', { paused: true });
            if (this.inGameMenu.isVisible) this.inGameMenu.render(this.currentRoomData);
            return;
        }
        
        if (this._isPaused) {
            // Resume: show shrink animation first, then actually resume
            this._showResumeAnimation();
        } else {
            // Pause immediately
            this._isPaused = true;
            this._showPauseOverlay();
            this.network.socket?.emit('pauseGame', { paused: true });
        }
        
        // Update InGameMenu if visible
        if (this.inGameMenu.isVisible) {
            this.inGameMenu.render(this.currentRoomData);
        }
    }

    _showPauseOverlay() {
        document.getElementById('gameCanvas')?.classList.add('paused');
        
        // Remove existing overlay
        this._removePauseOverlay();
        
        const overlay = document.createElement('div');
        overlay.id = 'pauseOverlay';
        overlay.className = 'pause-overlay';
        overlay.innerHTML = `
            <div class="pause-text-container">
                <span class="pause-title">OYUN</span>
                <span class="pause-subtitle">DURDURULDU</span>
            </div>
            <div class="pause-hint">Devam etmek için P tuşuna basın</div>
        `;
        document.body.appendChild(overlay);
    }

    _showResumeAnimation() {
        this._resumeAnimating = true;
        document.getElementById('gameCanvas')?.classList.add('paused');
        this._removePauseOverlay();
        
        const overlay = document.createElement('div');
        overlay.id = 'pauseOverlay';
        overlay.className = 'pause-overlay';
        overlay.innerHTML = `
            <div class="pause-text-container">
                <span class="pause-title">OYUN</span>
                <span class="pause-subtitle">DURDURULDU</span>
            </div>
            <div class="pause-hint">Devam etmek için P tuşuna basın</div>
            <div class="resume-rect" id="resumeRect"></div>
        `;
        document.body.appendChild(overlay);
        
        const rect = document.getElementById('resumeRect');
        if (rect) {
            void rect.offsetWidth;
            rect.classList.add('animating');
            
            // After animation completes, THEN resume the game
            this._resumeTimeout = setTimeout(() => {
                this._resumeAnimating = false;
                this._isPaused = false;
                this._removePauseOverlay();
                document.getElementById('gameCanvas')?.classList.remove('paused');
                this.network.socket?.emit('pauseGame', { paused: false });
                this._sendAuthorityState();
            }, 3200);
        }
    }

    _cancelResumeAnimation() {
        this._resumeAnimating = false;
        if (this._resumeTimeout) {
            clearTimeout(this._resumeTimeout);
            this._resumeTimeout = null;
        }
    }

    _removePauseOverlay() {
        const existing = document.getElementById('pauseOverlay');
        if (existing) existing.remove();
        document.getElementById('gameCanvas')?.classList.remove('paused');
    }



    /** Update a player's disc when team changes mid-game (host only) */
    _hostUpdatePlayerDisc(playerId, players) {
        if (!players) return;
        const playerData = players.find(p => p.id === playerId);
        if (!playerData) return;
        
        // Find existing disc
        const existingDisc = this.physics.discs.find(d => d.id === playerId || d.ownerId === playerId);
        
        if (playerData.team === 'spectator') {
            // Remove player disc
            if (existingDisc) {
                this.physics.removePlayerDisc(existingDisc);
            }
        } else {
            // Update or create player disc for new team
            if (existingDisc) {
                // Move to new team's spawn position
                const spawnDist = this._currentStadium?.spawnDistance || 170;
                const dir = playerData.team === 'red' ? -1 : 1;
                existingDisc.pos.x = dir * spawnDist;
                existingDisc.pos.y = 0;
                existingDisc.speed.x = 0;
                existingDisc.speed.y = 0;
                
                // Update existing disc's team and color
                existingDisc.team = playerData.team;
                existingDisc._playerName = playerData.name;
                existingDisc._avatar = playerData.avatar || '1';
                existingDisc._spawnPos.x = existingDisc.pos.x;
                existingDisc._spawnPos.y = existingDisc.pos.y;
                
                // Apply team colors from room settings
                const tc = this.currentRoomData?.teamColors?.[playerData.team];
                if (tc && tc.colors && tc.colors.length > 0) {
                    existingDisc.color = tc.colors[0];
                    existingDisc.colors = tc.colors;
                    existingDisc.colorAngle = tc.angle || 0;
                    existingDisc.avatarColor = tc.avatarColor || tc.textColor || 'FFFFFF';
                } else {
                    existingDisc.color = playerData.team === 'red' ? 'c70000' : '00008c';
                    existingDisc.colors = [existingDisc.color];
                    existingDisc.colorAngle = 0;
                    existingDisc.avatarColor = 'FFFFFF';
                }
                
                // Update collision group for new team
                existingDisc.cGroup = CollisionFlags[playerData.team] || CollisionFlags.all;
            } else {
                // Create new disc for player
                const pp = this._currentStadium?.playerPhysics || {
                    radius: 15, bCoef: 0.5, invMass: 0.5, damping: 0.96,
                    acceleration: 0.10, kickingAcceleration: 0.065, kickingDamping: 0.96, kickStrength: 5
                };
                const spawnDist = this._currentStadium?.spawnDistance || 170;
                const dir = playerData.team === 'red' ? -1 : 1;
                const disc = this.physics.addPlayerDisc(pp, playerData.team, dir * spawnDist, 0);
                disc.id = playerId;
                disc.ownerId = playerId;
                disc._playerName = playerData.name;
                disc._avatar = playerData.avatar || '1';
                // Apply team colors if available
                const tc = this.currentRoomData?.teamColors?.[playerData.team];
                if (tc && tc.colors && tc.colors.length > 0) {
                    disc.color = tc.colors[0];
                    disc.colors = tc.colors;
                    disc.colorAngle = tc.angle || 0;
                    disc.avatarColor = tc.avatarColor || tc.textColor || 'FFFFFF';
                } else {
                    disc.color = playerData.team === 'red' ? 'c70000' : '00008c';
                    disc.colors = [disc.color];
                    disc.avatarColor = 'FFFFFF';
                }
            }
        }
    }

    /** Send authoritative state to server (relayed to other players) */
    _sendAuthorityState() {
        this._hostAuthoritySendCounter = (this._hostAuthoritySendCounter || 0) + 1;
        // Send every frame for responsive non-host clients (~60fps)
        // if (this._hostAuthoritySendCounter % 2 !== 0) return;


        this.network.socket?.emit('authorityState', {
            state: this._hostGameState,
            physics: this.physics.getState(),
            scoreRed: this._hostScoreRed,
            scoreBlue: this._hostScoreBlue,
            time: Math.floor(this._hostTimeElapsed / 60),
            scoreLimit: this._hostScoreLimit,
            timeLimit: this._hostTimeLimit,
            kickOffTeam: this._hostKickOffTeam
        });

        // Broadcast host ping to room every 2 seconds (120 frames at 60fps)
        if (this._hostAuthoritySendCounter % 120 === 0) {
            this.network.socket?.emit('hostPing', { ping: this.network.ping || 0 });
        }
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
            this._currentMapId = data.mapId || null;
            this._currentMapHash = data.mapHash || null;
            this.physics.myPlayerId = this.network.socket?.id;

            // Request authoritative map data from server (hash-based dedup)
            if (data.mapId) {
                this.network.requestMap(data.mapId);
            }

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
            // HOST MODE: Update player disc when team changes mid-game
            if (this._isHost() && this._isHostAuthority && this.gameRunning && data.playerId) {
                this._hostUpdatePlayerDisc(data.playerId, data.players || this.currentRoomData?.players);
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

            // Check if this is host-authority mode
            if (data?.isHostAuthority) {
                this._isHostAuthority = true;
                if (this._isHost()) {
                    console.log('[GokBall] HOST: I am the game host, running physics locally');
                    this._initHostGame();
                }
            }

            this._serverGameState = 'playing';
            this.startGame(this.currentRoomData); // Loads stadium

            // IMPORTANT: Spawn player discs AFTER startGame loaded the stadium
            // Otherwise startGame's loadStadium clears all discs
            if (this._isHost() && this._isHostAuthority) {
                this._hostSpawnAllPlayers();
                this.physics.kickOffReset = true;
                this.physics.kickOffTeam = 'red';
                this.physics.inGoalPause = false;
                console.log('[GokBall] Host players spawned:', this.currentRoomData?.players?.length);
            }

            if (data?.state) this._handleGameState(data.state);
        });

        // Remote inputs from other players (relayed by server)
        this.network.on('remoteInput', (data) => {
            if (this._isHost() && this._isHostAuthority && data?.playerId && data?.input) {
                this._remoteInputs.set(data.playerId, data.input);
            }
        });

        this.network.on('gameState', (state) => {
            // Host ignores server gameState in host-authority mode (host IS the authority)
            if (this._isHost() && this._isHostAuthority) return;
            if (this.gameRunning) this._handleGameState(state);
        });

        this.network.on('goalScored', (data) => {
            if (this.scoreboard) {
                this.scoreboard.update(data.scoreRed, data.scoreBlue, 0);
                this.scoreboard.showGoal(data.team);
            }
            this.audio.playGoal();
            // Format: 🔴 GOL! PlayerName ⚽ PlayerName 👟
            const teamEmoji = data.team === 'red' ? '🔴' : '🔵';
            let goalMsg = `${teamEmoji} GOL!`;
            if (data.scorer) goalMsg += ` ${data.scorer} ⚽`;
            if (data.assister) goalMsg += ` ${data.assister} 👟`;
            goalMsg += ` (${data.scoreRed} - ${data.scoreBlue})`;
            this.chat.addMessage({ message: goalMsg, system: true });
        });

        this.network.on('gameOver', (data) => {
            const winnerStr = data.winner === 'red' ? 'K\u0131rm\u0131z\u0131' : 'Mavi';
            const winnerColor = data.winner === 'red' ? '#c70000' : '#00008c';

            // Calculate points: goals=3, assists=1, saves=0.25
            const ranked = [];
            if (data.matchStats && Object.keys(data.matchStats).length > 0) {
                for (const [id, s] of Object.entries(data.matchStats)) {
                    if (s.goals > 0 || s.assists > 0 || s.saves > 0) {
                        ranked.push({
                            id, name: s.name, team: s.team,
                            goals: s.goals || 0, assists: s.assists || 0, saves: s.saves || 0,
                            points: (s.goals || 0) * 3 + (s.assists || 0) * 1 + (s.saves || 0) * 0.25
                        });
                    }
                }
                ranked.sort((a, b) => b.points - a.points);
            }

            const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
            const medalEmojis = ['🥇', '🥈', '🥉'];

            const overlay = document.createElement('div');
            overlay.className = 'game-over-overlay';
            overlay.innerHTML = `
                <div class="game-over-card">
                    <div class="game-over-trophy">🏆</div>
                    <div class="game-over-winner" style="color: ${winnerColor};">${winnerStr} TAKIM KAZANDI!</div>
                    <div class="game-over-scores">
                        <span class="game-over-score game-over-score-red">${data.scoreRed}</span>
                        <span class="game-over-separator">—</span>
                        <span class="game-over-score game-over-score-blue">${data.scoreBlue}</span>
                    </div>
                    <div class="game-over-label">MAÇ SKORU</div>
                    ${ranked.length > 0 ? `<div class="game-over-rankings">
                        ${ranked.map((p, i) => {
                            const color = medalColors[i] || 'rgba(255,255,255,0.7)';
                            const medal = medalEmojis[i] || '';
                            const mvp = i === 0 ? '<span class="mvp-badge">⭐ MVP</span>' : '';
                            const stats = [];
                            if (p.goals > 0) stats.push(`⚽${p.goals}`);
                            if (p.assists > 0) stats.push(`👟${p.assists}`);
                            if (p.saves > 0) stats.push(`🧤${p.saves}`);
                            return `<div class="ranking-row" style="color:${color}">
                                <span class="ranking-medal">${medal}</span>
                                <span class="ranking-name">${p.name}</span>
                                ${mvp}
                                <span class="ranking-stats">${stats.join(' ')}</span>
                                <span class="ranking-points">${p.points} puan</span>
                            </div>`;
                        }).join('')}
                    </div>` : '<div class="game-over-no-stats">İstatistik bulunamadı.</div>'}
                </div>
            `;
            document.body.appendChild(overlay);

            // Show simplified stats in chat (no saves)
            if (ranked.length > 0) {
                let statsMsg = '📊 MAÇ İSTATİSTİKLERİ:\n';
                for (const p of ranked) {
                    const parts = [];
                    if (p.goals > 0) parts.push(`⚽${p.goals} Gol`);
                    if (p.assists > 0) parts.push(`👟${p.assists} Asist`);
                    statsMsg += `${p.name}: ${parts.join(' | ')} (${p.points} puan)\n`;
                }
                this.chat.addMessage({ message: statsMsg, system: true });
            }

            setTimeout(() => {
                if (document.body.contains(overlay)) document.body.removeChild(overlay);
                this.stopGame();
                // Transition back to room lobby
                if (this.currentRoomData) {
                    this.ui.showScreen('roomLobby', this.currentRoomData);
                } else {
                    this.ui.showScreen('roomList');
                }
            }, 5000);
        });

        // Chat messages (in-game)
        this.network.on('chatMessage', (data) => {
            if (this.gameRunning) {
                this.chat.addMessage(data);
            }
        });
        
        // Game stopped (admin clicked stop)
        this.network.on('gameStopped', (data) => {
            this._isHostAuthority = false;
            this._hostGameState = 'stopped';
            if (this.gameRunning) {
                this.stopGame();
                if (this.currentRoomData) {
                    this.ui.showScreen('roomLobby', this.currentRoomData);
                } else {
                    this.ui.showScreen('roomList');
                }
            }
        });
        
        // Player kicked / disconnected
        this.network.on('playerKicked', (data) => {
            const reason = data.reason || 'Ba\u011flant\u0131 koptu';
            this.stopGame();
            // Show connection lost dialog
            const overlay = document.createElement('div');
            overlay.id = 'connectionLostOverlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;';
            overlay.innerHTML = `
                <div style="background:var(--bg-card);padding:40px;border-radius:16px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid var(--border-color);min-width:320px;">
                    <div style="font-size:48px;margin-bottom:16px;">\u26A0\uFE0F</div>
                    <h2 style="color:var(--text-primary);margin:0 0 8px;font-size:22px;">Ba\u011flant\u0131 Koptu</h2>
                    <p style="color:var(--text-secondary);margin:0 0 24px;font-size:14px;">${reason}</p>
                    <button id="btnConnOk" class="btn btn-primary" style="padding:10px 40px;font-size:16px;font-weight:700;border-radius:8px;">Tamam</button>
                </div>
            `;
            document.body.appendChild(overlay);
            document.getElementById('btnConnOk')?.addEventListener('click', () => {
                overlay.remove();
                this.currentRoomData = null;
                this.ui.showScreen('roomList');
            });
        });

        // Pause state for non-host players
        this.network.on('gamePaused', (data) => {
            if (this._isHost()) return; // Host handles pause locally
            if (data.paused) {
                this._isPaused = true;
                this._showPauseOverlay();
            } else {
                this._isPaused = false;
                // Keep text visible + show resume rectangle animation
                this._showPauseOverlay(true);
            }
            if (this.inGameMenu.isVisible) {
                this.inGameMenu.render(this.currentRoomData);
            }
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

        // Team Colors Updated (from /colors command or setTeamColors)
        this.network.on('teamColorsUpdated', (data) => {
            if (this.currentRoomData) {
                if (!this.currentRoomData.teamColors) this.currentRoomData.teamColors = {};
                if (data.team && data.teamColors) {
                    this.currentRoomData.teamColors[data.team] = data.teamColors;
                }
                // Apply to local physics discs if game is running
                if (this.gameRunning && data.team && data.teamColors) {
                    const team = data.team;
                    const tc = data.teamColors;
                    for (const disc of this.physics.discs) {
                        if (disc.isPlayer && disc.team === team) {
                            disc.color = tc.colors[0];
                            disc.colors = tc.colors;
                            disc.colorAngle = tc.angle;
                            disc.avatarColor = tc.avatarColor || tc.textColor || 'FFFFFF';
                        }
                    }
                }
            }
        });

        // Stadium Changed (legacy) - kept for backward compat
        this.network.on('stadiumChanged', (data) => {
            if (data.stadium) {
                this._applyMapData(data.stadium);
            }
        });

        // Map Changed (new server-authoritative system)
        // Server notifies all clients that the active map has changed.
        // The event includes the full stadium data for atomic swap.
        this.network.on('mapChanged', (data) => {
            if (data.stadium) {
                // Cache the map by hash for future dedup
                if (data.mapHash && data.mapData) {
                    this._mapCache.set(data.mapHash, data.mapData);
                }
                this._currentMapId = data.mapId || null;
                this._currentMapHash = data.mapHash || null;
                this._applyMapData(data.stadium);
            }
        });

        // Map Sync - server sends full map data (on join or requestMap response)
        // Includes dedup: if client already has the hash, skip loading
        this.network.on('mapSync', (data) => {
            if (!data.mapData) return;

            // Hash-based dedup: if we already have this exact map, skip reload
            if (data.mapHash && this._mapCache.has(data.mapHash)) {
                console.log(`[MapSystem] Map ${data.mapId} already cached (hash: ${data.mapHash}), skipping reload`);
                // Still update references even if skipping reload
                this._currentMapId = data.mapId;
                this._currentMapHash = data.mapHash;
                const cachedData = this._mapCache.get(data.mapHash);
                this._applyMapData(cachedData);
                return;
            }

            // Cache and apply
            if (data.mapHash) {
                this._mapCache.set(data.mapHash, data.mapData);
            }
            this._currentMapId = data.mapId;
            this._currentMapHash = data.mapHash;
            this._applyMapData(data.mapData);
        });

        // Map List - available maps for room creation / lobby UI
        this.network.on('mapList', (data) => {
            this._availableMaps = data;
        });
    }

    /**
     * Apply map data atomically: update roomData, physics, and renderer.
     * This is the single point where map geometry changes on the client.
     */
    _applyMapData(stadium) {
        this.stadiumData = stadium;
        if (this.currentRoomData) {
            this.currentRoomData.stadium = stadium;
        }
        // If a game is already running, atomically swap the stadium
        if (this.gameRunning) {
            this.physics.loadStadium(stadium);
            this._currentStadium = stadium;
            this.renderer._stadiumDirty = true;
        }
    }

    _handleGameState(state) {
        // Skip if stadium hasn't loaded yet (race condition guard)
        if (this.gameRunning && !this._stadiumReady) return;

        // Mark first state received for client prediction guard
        if (!this._firstStateReceived) this._firstStateReceived = true;

        // Clear interpolation buffer on state transitions to prevent stale data
        if (this._serverGameState !== state.state) {
            this._snapshotBuffer.clear();
        }
        this._serverGameState = state.state;

        // Set goal pause flag
        this.physics.inGoalPause = (state.state === 'goal');

        // Add to interpolation buffer for non-host clients
        if (!this._isHost() || !this._isHostAuthority) {
            this._snapshotBuffer.addSnapshot(Date.now(), state);
        }

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

        // Sync metadata (colors, physics params, kickoff state) without overwriting positions.
        // Positions are handled by the interpolation buffer in the game loop.
        if (state.physics) {
            this._syncPhysicsMetadata(state.physics);
        }

        // Update scoreboard
        this.scoreboard.update(state.scoreRed, state.scoreBlue, state.time);
    }

    /**
     * Sync physics metadata from server without touching positions.
     * Positions are handled by the interpolation buffer to prevent
     * teleporting and player overlap on clients.
     */
    _syncPhysicsMetadata(physicsState) {
        if (!physicsState.discs) return;

        // Sync kickoff state
        if (physicsState.kickOffReset !== undefined) this.physics.kickOffReset = physicsState.kickOffReset;
        if (physicsState.kickOffTeam !== undefined) this.physics.kickOffTeam = physicsState.kickOffTeam;

        // Sync disc array length
        while (this.physics.discs.length < physicsState.discs.length) {
            this.physics.discs.push(new Disc());
        }
        while (this.physics.discs.length > physicsState.discs.length) {
            this.physics.discs.pop();
        }

        // Match player discs by ID (not index) to handle team changes correctly.
        // When a player changes teams, the server removes a disc and adds a new one
        // at a different index. Matching by index would apply colors to wrong discs.
        for (let i = 0; i < physicsState.discs.length; i++) {
            const sd = physicsState.discs[i];
            let disc = this.physics.discs[i];
            if (!disc) continue;

            // For player discs, find the matching client disc by ID
            if (sd.isPlayer && sd.id) {
                const matched = this.physics.discs.find(d => d.isPlayer && d.id === sd.id);
                if (matched) {
                    disc = matched;
                } else {
                    // New player disc not yet on client - use slot and set ID
                    disc.id = sd.id;
                }
            }

            // Sync metadata only (team, colors, physics params for prediction accuracy)
            if (sd.isPlayer !== undefined) {
                disc.isPlayer = sd.isPlayer;
                disc.team = sd.team;
                if (sd.name) disc._playerName = sd.name;
                if (sd.avatar) disc.avatar = sd.avatar;
                if (sd.id) disc.id = sd.id;
                if (sd.color !== undefined) disc.color = sd.color;
                if (sd.colors !== undefined) disc.colors = sd.colors;
                if (sd.colorAngle !== undefined) disc.colorAngle = sd.colorAngle;
                if (sd.avatarColor !== undefined) disc.avatarColor = sd.avatarColor;
                if (sd.damping !== undefined) disc.damping = sd.damping;
                if (sd.acceleration !== undefined) disc.acceleration = sd.acceleration;
                if (sd.kickingAcceleration !== undefined) disc.kickingAcceleration = sd.kickingAcceleration;
                if (sd.kickingDamping !== undefined) disc.kickingDamping = sd.kickingDamping;
                if (sd.kickStrength !== undefined) disc.kickStrength = sd.kickStrength;
                if (sd.bCoef !== undefined) disc.bCoef = sd.bCoef;
                if (sd.invMass !== undefined) disc.invMass = sd.invMass;
                if (sd.cMask !== undefined) disc.cMask = sd.cMask;
                if (sd.cGroup !== undefined) disc.cGroup = sd.cGroup;
                if (sd.radius !== undefined) disc.radius = sd.radius;
            } else if (sd.color !== undefined) {
                disc.color = sd.color;
            }
            // Sync collision params for ALL discs (ball, posts, etc.)
            if (sd.cMask !== undefined) disc.cMask = sd.cMask;
            if (sd.cGroup !== undefined) disc.cGroup = sd.cGroup;
            if (sd.bCoef !== undefined) disc.bCoef = sd.bCoef;
            if (sd.invMass !== undefined) disc.invMass = sd.invMass;
            if (sd.damping !== undefined) disc.damping = sd.damping;
            if (sd.radius !== undefined) disc.radius = sd.radius;
            if (sd.kicking !== undefined) disc.kicking = sd.kicking;
            if (sd.typing !== undefined) disc.typing = sd.typing;
        }
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
