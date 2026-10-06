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
import { FixedStepClock } from './network/FixedStepClock.js';
import { InputHistory } from './network/InputHistory.js';
import { NetworkDebugPanel } from './ui/components/NetworkDebugPanel.js';
import { pingLevel } from './ui/components/PingBadge.js';

const REMOTE_INPUT_TIMEOUT_MS = 1500;

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
        this._snapshotBuffer = new SnapshotBuffer(50); // Buffer three host ticks to absorb packet jitter
        this._lastSnapshotTime = 0;
        this._lastAuthorityTick = -1;

        // Client-side prediction infrastructure
        this._inputSequence = 0;
        this._inputHistory = new InputHistory();
        this._lastConfirmedServerSeq = 0;
        this._reconciliationPending = false;
        this._localRenderCorrection = { x: 0, y: 0, updatedAt: performance.now() };
        this._lastServerBallState = null; // {x, y, sx, sy} for collision reconciliation

        // Host-authority mode (room creator runs physics)
        this._isHostAuthority = false;
        this._remoteInputs = new Map(); // playerId -> {input, seq}
        this._lastRemoteInputSeq = new Map(); // playerId -> last processed seq
        this._hostScoreRed = 0;
        this._hostScoreBlue = 0;
        this._hostTimeElapsed = 0;
        this._hostGoalPauseTicks = 0;
        this._hostGameState = 'stopped';
        this._hostScoreLimit = 3;
        this._hostTimeLimit = 180;
        this._hostKickOffTeam = 'red';
        this._hostAuthoritySendCounter = 0;

        // Latency data published by the server (every 2s)
        this._peerHostRtt = null; // measured host RTT over the active WebRTC route
        this._pingSignature = null;
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

    }

    async init() {
        // Register UI screens
        this.ui.registerScreen('mainMenu', new MainMenu(this));
        this.ui.registerScreen('roomList', new RoomList(this));
        this.ui.registerScreen('createRoom', new CreateRoom(this));
        this.ui.registerScreen('roomLobby', new RoomLobby(this));
        this.ui.registerScreen('settings', new Settings(this));

        // Connect to game server. Show the menu even if the connection fails,
        // so users can still see the UI and retry instead of a blank background.
        try {
            await this.network.connect();
            this.physics.myPlayerId = this.network.playerId;
            console.log('[GokBall] Connected to server:', this.network.playerId);
        } catch (err) {
            console.error('[GokBall] Connection failed:', err?.message || err);
            this.ui.showScreen('mainMenu');
            alert('Sunucuya bağlanılamadı!\n\n' +
                  'Oda oluşturma/odaya katılma çalışmayacak.\n\n' +
                  '1. Game sunucusunun (npm run server) çalıştığından emin olun\n' +
                  '2. Sayfayı yenileyin');
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
                // Show a number ONLY when a real round trip was measured
                const hostPing = this._getPeerHostRtt();
                const shownPing = hostPing ?? data.ping;
                pingEl.textContent = shownPing != null ? Math.round(shownPing) : '--';
                this._applyPingColor(pingEl, shownPing);
            }

        });

        this.network.on('peerPingUpdate', (data) => {
            if (data.peerId !== this.currentRoomData?.creatorId) return;
            this._peerHostRtt = data.direct
                ? { ping: data.ping, ts: Date.now() }
                : null;
            const pingEl = document.getElementById('pingValue');
            if (pingEl && data.direct) {
                pingEl.textContent = Math.round(data.ping);
                this._applyPingColor(pingEl, data.ping);
            }
        });

        // Latency snapshot published by the server every 2 seconds.
        // Values are measured by the server, not self-reported.
        this.network.on('playerPings', (data) => this._applyPlayerPings(data));

        this.network.on('disconnect', () => {
            this._peerHostRtt = null;
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
        this.network.disconnectRoomPeers();
        this.network.leaveRoom();
        this.stopGame();
        this._isHostAuthority = false;
        this._peerHostRtt = null;
        this.currentRoomData = null;
        this.ui.showScreen('mainMenu');
    }

    // ============================================
    // Game Lifecycle
    // ============================================

    startGame(roomData) {
        if (this.gameRunning) return;

        this._cancelResumeAnimation();
        this._resumeAnimating = false;
        this._isPaused = false;
        this._removePauseOverlay();
        this.gameRunning = true;
        this.currentRoomData = roomData;
        this.network.setAuthorityStreamActive(!this._isHost());
        this._firstStateReceived = false; // Wait for initial server state before client prediction
        this._stadiumReady = false; // Guard against gameState arriving before stadium loads
        this._snapshotBuffer.clear();
        this._lastAuthorityTick = -1;
        this._lastAuthoritySnapshotSeq = -1;
        this._lastConfirmedServerState = null;
        this._inputHistory.reset();
        this._lastConfirmedServerSeq = 0;
        this._reconciliationPending = false;
        this._fullStateReady = this._isHost() && this._isHostAuthority;
        this._lastAuthorityReceivedAt = 0;
        this._localRenderCorrection = { x: 0, y: 0, updatedAt: performance.now() };

        // Load stadium immediately so render loop can draw the field
        const stadiumData = this.stadiumData || roomData?.stadium;
        if (stadiumData) {
            this.physics.loadStadium(stadiumData);
            this._networkStaticDiscCount = this.physics.discs.length;
            this._currentStadium = stadiumData;
            this._stadiumReady = true;
        }
        this.physics.ballSpeedMultiplier = roomData?.ballSpeedMultiplier || 1;

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

        this._physicsClock = new FixedStepClock();
        this._physicsClock.reset(performance.now());
        clearInterval(this._physicsTimer);
        this._physicsTimer = setInterval(() => this._physicsLoop(), 1000 / 60);
        clearInterval(this._resyncTimer);
        if (!this._fullStateReady) {
            this.network.requestFullState();
            this._resyncTimer = setInterval(() => {
                if (!this.gameRunning || this._isHost()) return;
                if (!this._fullStateReady || performance.now() - this._lastAuthorityReceivedAt > 1200) {
                    this._fullStateReady = false;
                    this.network.requestFullState(this._matchEpoch || null);
                }
            }, 500);
        }

        // Start render loop
        this._gameLoop();
    }

    stopGame() {
        this.gameRunning = false;
        clearInterval(this._physicsTimer);
        clearInterval(this._resyncTimer);
        this._physicsTimer = null;
        this._resyncTimer = null;
        this._physicsClock = null;
        this.network.setAuthorityStreamActive(false);
        this._cancelResumeAnimation();
        this._resumeAnimating = false;
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

    }


    _physicsLoop() {
        if (!this.gameRunning || !this._physicsClock) return;
        const now = performance.now();
        this._physicsClock.advance(now, () => {
            if (!this.gameRunning) return;
            const inputState = this.input.getInput();
            if (this.network.socket?.id) this.physics.myPlayerId = this.network.socket.id;
            if (!this._fullStateReady && !(this._isHost() && this._isHostAuthority)) return;
            const inputSeq = this.network.sendInput(inputState, inputState);
            this._physicsTick(inputState, inputSeq);
        });
    }

    _physicsTick(inputState, inputSeq) {
        this._physicsTickCount = (this._physicsTickCount || 0) + 1;
        const peerInput = inputState;
        const stepSize = 1000 / 60;
        // --- HOST MODE: Full authority game loop ---
            if (this._isHost() && this._isHostAuthority) {

                // Skip physics when paused
                if (this._isPaused) {
                    // Still send occasional authority state so non-host clients sync
                    this._hostAuthoritySendCounter = (this._hostAuthoritySendCounter || 0) + 1;
                    if (this._hostAuthoritySendCounter % 30 === 0) {
                        this._sendAuthorityState();
                    }
                    return;
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
                    for (const [playerId, ri] of this._remoteInputs) {
                        const remoteDisc = this.physics.discs.find(d => d.id === playerId || d.ownerId === playerId);
                        if (remoteDisc) {
                            remoteDisc.input = performance.now() - ri.receivedAt > REMOTE_INPUT_TIMEOUT_MS
                                ? { up: false, down: false, left: false, right: false, kick: false }
                                : ri.input;
                            this._lastRemoteInputSeq.set(playerId, ri.seq);
                        }
                    }

                    // Step physics
                    if (this.network.socket?.id) this._lastRemoteInputSeq.set(this.network.socket.id, inputSeq);
                    const result = this.physics.step();
                    this._hostPhysicsTick++;
                    this._releaseConsumedKickInputs();

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
                            this._hostMatchStats[result.saveDetected] = { goals: 0, assists: 0, saves: 0, ownGoals: 0, name: saveName, team: savePlayer?.team };
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
                    this.scoreboard.update(
                        this._hostScoreRed,
                        this._hostScoreBlue,
                        Math.floor(this._hostTimeElapsed / 60),
                        this._hostTimeLimit
                    );

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
                    this._hostPhysicsTick++;
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
                            return;
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
                // --- CLIENT MODE: Local physics + server reconciliation ---
                // Wait for first server state before running client prediction
                if (!this._firstStateReceived) {
                    return;
                }
                if (this._serverGameState === 'playing' && !this._isPaused) {
                    const myId = this.network.socket?.id;
                    const myDisc = this.physics.discs.find(d => d.id === myId);

                    if (myDisc && myDisc.isPlayer) {
                        const predictionLeadTicks = this._snapshotBuffer.getDelay() / stepSize + 1;
                        this._inputHistory.push(inputSeq, peerInput);

                        let reconciled = false;
                        if (this._reconciliationPending && this._lastConfirmedServerState) {
                            const confirmed = this._lastConfirmedServerState.discs.find(d => d.id === myId);
                            if (confirmed) {
                                const predictedX = myDisc.pos.x;
                                const predictedY = myDisc.pos.y;
                                myDisc.pos.x = confirmed.x;
                                myDisc.pos.y = confirmed.y;
                                myDisc.speed.x = confirmed.sx;
                                myDisc.speed.y = confirmed.sy;

                                // Replay this player's inputs against the latest
                                // interpolated world without advancing other discs.
                                for (const h of this._inputHistory.unconfirmed()) {
                                    this.physics.predictPlayerStep(myDisc, h.input, predictionLeadTicks);
                                }
                                const correctionX = this._localRenderCorrection.x + predictedX - myDisc.pos.x;
                                const correctionY = this._localRenderCorrection.y + predictedY - myDisc.pos.y;
                                const now = performance.now();
                                this._localRenderCorrection = {
                                    x: correctionX,
                                    y: correctionY,
                                    updatedAt: now
                                };
                                reconciled = true;
                            }
                            this._reconciliationPending = false;
                        }

                        if (!reconciled) this.physics.predictPlayerStep(myDisc, peerInput, predictionLeadTicks);
                        myDisc.input = { up: false, down: false, left: false, right: false, kick: false };
                    }
                }
            }

    }

    _gameLoop() {
        if (!this.gameRunning) return;
        const now = performance.now();
        // Rendering follows the display refresh rate; simulation has its own 60 Hz clock.
        this._applyInterpolatedSnapshots(now);

        // Render remote discs and the ball at every display frame. The
        // snapshot buffer already interpolates positions between host ticks.
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

    _applyInterpolatedSnapshots(localTime) {
        for (const disc of this.physics.discs) disc._renderPosition = null;
        const snapshots = this._snapshotBuffer.getInterpolatedState(localTime)?.physics?.discs;
        if (!snapshots) return;

        const myId = this.network.socket?.id;
        const localById = new Map();
        for (const disc of this.physics.discs) {
            if (disc.isPlayer && disc.id) localById.set(disc.id, disc);
        }

        for (let i = 0; i < snapshots.length; i++) {
            const snapshot = snapshots[i];
            if (snapshot.isPlayer && snapshot.id === myId && this._serverGameState === 'playing' && !this._isPaused) continue;

            const disc = snapshot.isPlayer
                ? localById.get(snapshot.id)
                : this.physics.discs[i];
            if (!disc) continue;

            disc.pos.x = snapshot.x;
            disc.pos.y = snapshot.y;
            disc.speed.x = snapshot.sx;
            disc.speed.y = snapshot.sy;
            disc._renderPosition = { x: snapshot.x, y: snapshot.y };
            if (snapshot.kicking !== undefined) disc.kicking = snapshot.kicking;
            if (snapshot.color !== undefined) disc.color = snapshot.color;
        }

        const localDisc = localById.get(myId);
        if (localDisc && this._localRenderCorrection) {
            const elapsed = Math.max(0, Math.min(100, localTime - this._localRenderCorrection.updatedAt));
            const decay = Math.exp(-elapsed / 90);
            this._localRenderCorrection.x *= decay;
            this._localRenderCorrection.y *= decay;
            this._localRenderCorrection.updatedAt = localTime;
            localDisc._renderPosition = {
                x: localDisc.pos.x + this._localRenderCorrection.x,
                y: localDisc.pos.y + this._localRenderCorrection.y
            };
        }

        // Independent interpolation can briefly place the ball inside a
        // player's disc between two collision-resolved host snapshots. Keep
        // the rendered positions tangent while leaving simulation state intact.
        const ball = this.physics.ballDisc;
        if (!ball) return;
        const ballPos = { ...(ball._renderPosition || ball.pos) };
        for (let pass = 0; pass < 2; pass++) {
            for (const player of this.physics.discs) {
                if (!player.isPlayer) continue;
                const playerPos = player._renderPosition || player.pos;
                let dx = ballPos.x - playerPos.x;
                let dy = ballPos.y - playerPos.y;
                let distance = Math.hypot(dx, dy);
                const minDistance = ball.radius + player.radius;
                if (distance >= minDistance) continue;
                if (distance < 0.001) {
                    dx = player.speed.x - ball.speed.x;
                    dy = player.speed.y - ball.speed.y;
                    distance = Math.hypot(dx, dy);
                    if (distance < 0.001) {
                        dx = player.team === 'red' ? 1 : -1;
                        dy = 0;
                        distance = 1;
                    }
                }
                const correction = minDistance - distance + 0.1;
                ballPos.x += (dx / distance) * correction;
                ballPos.y += (dy / distance) * correction;
            }
        }
        if (ball._renderPosition) ball._renderPosition = ballPos;
    }

    /** Check if this client is the room creator/host */
    _isHost() {
        return this.currentRoomData?.creatorId === this.network.socket?.id;
    }

    /** Latest measured RTT to the host over WebRTC, or null if unavailable. */
    _getPeerHostRtt() {
        if (!this._peerHostRtt || Date.now() - this._peerHostRtt.ts > 3000) return null;
        return this._peerHostRtt.ping;
    }

    /** Color a ping value by quality; unmeasured values stay neutral */
    _applyPingColor(el, ping) {
        el.classList.remove('is-good', 'is-fair', 'is-bad');
        const level = pingLevel(ping);
        if (level === 'unknown') return;
        el.classList.add(`is-${level}`);
    }

    

    /**
     * Merge the latency snapshot the server publishes every 2 seconds into the
     * current player list and refresh whichever list is visible.
     */
    _applyPlayerPings(data) {
        const players = this.currentRoomData?.players;
        if (!players || !data?.pings) return;

        for (const entry of data.pings) {
            const player = players.find(p => p.id === entry.id);
            if (player) Object.assign(player, entry);
        }

        // Only rebuild the lists when a value actually changed, so an in
        // progress admin drag is not interrupted every 2 seconds
        const signature = data.pings.map(p => `${p.id}:${p.ping}:${p.pingLoss}`).join('|');
        if (signature === this._pingSignature) return;
        this._pingSignature = signature;

        const lobby = this.ui.screens.roomLobby;
        if (this.ui.currentScreen === 'roomLobby' && lobby) lobby.updatePlayers(players);
        if (this.inGameMenu.isVisible) this.inGameMenu.render(this.currentRoomData);
    }

    /** Initialize host-authority game mode (state only, spawning happens after startGame) */
    _initHostGame() {
        this._hostScoreRed = 0;
        this._hostScoreBlue = 0;
        this._hostTimeElapsed = 0;
        this._hostGoalPauseTicks = 0;
        this._hostGameState = 'playing';
        this._hostPhysicsTick = 0;
        this._matchEpoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        this._hostKickOffTeam = 'red';
        this._hostScoreLimit = this.currentRoomData?.game?.scoreLimit || 3;
        this._hostTimeLimit = this.currentRoomData?.game?.timeLimit ?? 180;
        this._hostLastToucher = null;
        this._hostPrevToucher = null;
        this._hostMatchStats = {};
        this._remoteInputs.clear();
        this._lastRemoteInputSeq.clear();
        this._hostAuthoritySendCounter = 0;
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

        // Attribute an own goal to the last toucher from the team that
        // conceded, and deduct the matching three player points.
        const lastTouchPlayer = this.currentRoomData?.players?.find(p => p.id === this._hostLastToucher);
        const ownGoal = !!lastTouchPlayer && lastTouchPlayer.team === scoredOnTeam;
        const scorerName = this._hostLastToucher ? (lastTouchPlayer?.name || '') : '';
        // Assister: last toucher on same team as scorer, before the scorer
        let assisterName = '';
        if (!ownGoal && this._hostPrevToucher && this._hostPrevToucher !== this._hostLastToucher) {
            const prevPlayer = this.currentRoomData?.players?.find(p => p.id === this._hostPrevToucher);
            if (prevPlayer && prevPlayer.team === scoringTeam) {
                assisterName = prevPlayer.name || '';
            }
        }

        // Track match stats locally
        if (this._hostLastToucher && (ownGoal || lastTouchPlayer?.team === scoringTeam)) {
            if (!this._hostMatchStats[this._hostLastToucher]) this._hostMatchStats[this._hostLastToucher] = { goals: 0, assists: 0, saves: 0, ownGoals: 0, name: lastTouchPlayer.name, team: lastTouchPlayer.team };
            if (ownGoal) this._hostMatchStats[this._hostLastToucher].ownGoals++;
            else this._hostMatchStats[this._hostLastToucher].goals++;
        }
        if (assisterName) {
            if (!this._hostMatchStats[this._hostPrevToucher]) this._hostMatchStats[this._hostPrevToucher] = { goals: 0, assists: 0, saves: 0, ownGoals: 0, name: assisterName, team: scoringTeam };
            this._hostMatchStats[this._hostPrevToucher].assists++;
        }

        // Reset touch tracking for next goal
        this._hostLastToucher = null;
        this._hostPrevToucher = null;

        // Update scoreboard locally
        this.scoreboard.update(
            this._hostScoreRed,
            this._hostScoreBlue,
            Math.floor(this._hostTimeElapsed / 60),
            this._hostTimeLimit
        );
        this.scoreboard.showGoal(scoringTeam);
        this.audio.playGoal();

        // Format: 🔴 GOL! PlayerName ⚽ PlayerName 👟
        const teamEmoji = scoringTeam === 'red' ? '🔴' : '🔵';
        let goalMsg = `${teamEmoji} GOL!`;
        if (ownGoal) goalMsg += ` 😂 ${scorerName} kendi kalesine attı!`;
        else if (scorerName) goalMsg += ` ${scorerName} ⚽`;
        if (assisterName) goalMsg += ` ${assisterName} 👟`;
        goalMsg += ` (${this._hostScoreRed} - ${this._hostScoreBlue})`;
        this.chat.addMessage({ message: goalMsg, system: true });

        // Send goalScored event to server for relay to other players
        this.network.socket?.emit('hostGoalEvent', {
            team: scoringTeam,
            scoreRed: this._hostScoreRed,
            scoreBlue: this._hostScoreBlue,
            scorer: scorerName,
            assister: assisterName,
            ownGoal
        });
    }

    /** Handle game over in host mode */
    _hostGameOver() {
        const winner = this._hostScoreRed > this._hostScoreBlue ? 'red' : 'blue';
        this._hostGameState = 'ended';

        const winTeamStr = winner === 'red' ? 'K\u0131rm\u0131z\u0131' : 'Mavi';
        const winColor = winner === 'red' ? 'var(--red)' : 'var(--blue)';

        // Calculate points: goals=3, assists=1, saves=0.25
        const ranked = Object.entries(this._hostMatchStats)
            .filter(([_, s]) => s.goals > 0 || s.assists > 0 || s.saves > 0 || s.ownGoals > 0)
            .map(([id, s]) => ({
                id, name: s.name, team: s.team,
                goals: s.goals || 0, assists: s.assists || 0, saves: s.saves || 0, ownGoals: s.ownGoals || 0,
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
                        if (p.ownGoals > 0) stats.push(`<span class="ranking-own-goals">-⚽ ${p.ownGoals}</span>`);
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
                if (p.ownGoals > 0) parts.push(`-⚽ ${p.ownGoals}`);
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
                const basePP = this._currentStadium?.playerPhysics || {
                    radius: 15, bCoef: 0.5, invMass: 0.5, damping: 0.96,
                    acceleration: 0.10, kickingAcceleration: 0.065, kickingDamping: 0.96, kickStrength: 5
                };
                const speedMultiplier = this.currentRoomData?.playerSpeedMultiplier || 1;
                const pp = {
                    ...basePP,
                    acceleration: (basePP.acceleration || 0.1) * speedMultiplier,
                    kickingAcceleration: (basePP.kickingAcceleration || 0.065) * speedMultiplier
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

    /** Send authoritative state directly to guests through the peer mesh. */
    _sendAuthorityState(targetPlayerId = null) {
        this._hostAuthoritySendCounter = (this._hostAuthoritySendCounter || 0) + 1;
        // Collect last processed input seq for client reconciliation
        const lastProcessedSeq = {};
        for (const [pid, seq] of this._lastRemoteInputSeq) {
            lastProcessedSeq[pid] = seq;
        }

        const state = {
            matchEpoch: this._matchEpoch,
            tick: this._hostPhysicsTick,
            snapshotSeq: this._hostAuthoritySendCounter,
            physicsTick: this._hostPhysicsTick,
            paused: this._isPaused,
            state: this._hostGameState,
            physics: this.physics.getState(),
            scoreRed: this._hostScoreRed,
            scoreBlue: this._hostScoreBlue,
            time: Math.floor(this._hostTimeElapsed / 60),
            scoreLimit: this._hostScoreLimit,
            timeLimit: this._hostTimeLimit,
            kickOffTeam: this._hostKickOffTeam,
            lastProcessedSeq
        };
        if (targetPlayerId) {
            state.fullState = true;
            this.network.sendFullGameState(targetPlayerId, state);
        } else {
            this.network.sendAuthorityState(state);
        }
    }

    _releaseConsumedKickInputs() {
        for (const disc of this.physics.discs) {
            if (!disc.isPlayer || !disc._autoKickReleased) continue;
            disc._autoKickReleased = false;
            if (disc.id === this.network.socket?.id) {
                this.input.suppressKickUntilKeyUp();
            } else if (disc.id) {
                this.network.releasePlayerKick(disc.id);
            }
        }
    }

    /** Setup callback handlers for network events */
    _setupNetworkCallbacks() {
        this.network.on('roomCreated', (data) => {
            this.currentRoomData = data;
            this.currentRoomData.creatorId = data.creatorId;
            this._isHostAuthority = false;
            this._peerHostRtt = null;
            this.network.connectRoomPeers(data);
            this.stadiumData = data.stadium;
            this.physics.myPlayerId = this.network.socket?.id;
            this.ui.showScreen('roomLobby', data);
        });

        this.network.on('roomJoined', (data) => {
            this.currentRoomData = data;
            this.currentRoomData.creatorId = data.creatorId;
            this._isHostAuthority = ['playing', 'countdown', 'goal'].includes(data.game?.state);
            this._peerHostRtt = null;
            this.network.connectRoomPeers(data);
            // New room: force the next ping snapshot to repaint the player list
            this._pingSignature = null;
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
            if (this._isHost() && data?.playerId) {
                this._remoteInputs.delete(data.playerId);
                this._lastRemoteInputSeq.delete(data.playerId);
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
            // Host transfer: keep creatorId in sync so _isHost() stays correct
            if (this.currentRoomData && data.playerId && data.playerId === this.network.playerId) {
                this.currentRoomData.creatorId = data.playerId;
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

            // A late join receives the server's placeholder physics state
            // before the host's live authority stream. It has no host tick and
            // must not seed prediction or the guest interpolation timeline.
            if (data?.state && (!data?.isHostAuthority || Number.isFinite(data.state.tick))) {
                this._handleGameState(data.state);
            }
        });

        // Remote inputs from other players (relayed by server)
        this.network.on('fullStateRequest', ({ playerId } = {}) => {
            if (!this._isHost() || !this._isHostAuthority || !this.gameRunning || !playerId) return;
            this._sendAuthorityState(playerId);
        });

        this.network.on('remoteInput', (data) => {
            if (this._isHost() && this._isHostAuthority && data?.playerId && data?.input) {
                const seq = data.input._seq || 0;
                const current = this._remoteInputs.get(data.playerId);
                const confirmedSeq = this._lastRemoteInputSeq.get(data.playerId) || 0;
                if (seq <= Math.max(current?.seq || 0, confirmedSeq)) return;
                this._remoteInputs.set(data.playerId, {
                    input: data.input,
                    seq,
                    receivedAt: performance.now()
                });
            }
        });

        this.network.on('gameState', (state) => {
            if (this._isHost() && this._isHostAuthority) return;
            if (this.gameRunning) this._handleGameState(state);
        });

        this.network.on('fullGameState', (state) => {
            if (this._isHost() && this._isHostAuthority) return;
            if (this.gameRunning) this._handleGameState(state, true);
        });

        this.network.on('kickReleased', () => {
            this.input.suppressKickUntilKeyUp();
            const localDisc = this.physics.discs.find(d => d.id === this.network.socket?.id);
            if (localDisc) {
                localDisc.kicking = false;
                localDisc._autoKickReleased = false;
            }
        });

        // Server state events are control-path leftovers (for example map or
        // kit updates). In host-authority matches, only host peer snapshots
        // may enter prediction/interpolation.
        this.network.on('serverGameState', (state) => {
            if (this._isHostAuthority || !this.gameRunning) return;
            this._handleGameState(state);
        });

        this.network.on('goalScored', (data) => {
            if (this.scoreboard) {
                this.scoreboard.updateScore(data.scoreRed, data.scoreBlue);
                this.scoreboard.showGoal(data.team);
            }
            this.audio.playGoal();
            if (data.ownGoal) {
                this.chat.addMessage({
                    message: `😂 ${data.scorer || 'Oyuncu'} kendi kalesine attı! (${data.scoreRed} - ${data.scoreBlue})`,
                    system: true
                });
                return;
            }
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
            const winnerColor = data.winner === 'red' ? 'var(--red)' : 'var(--blue)';

            // Calculate points: goals=3, assists=1, saves=0.25
            const ranked = [];
            if (data.matchStats && Object.keys(data.matchStats).length > 0) {
                for (const [id, s] of Object.entries(data.matchStats)) {
                    if (s.goals > 0 || s.assists > 0 || s.saves > 0 || s.ownGoals > 0) {
                        ranked.push({
                            id, name: s.name, team: s.team,
                            goals: s.goals || 0, assists: s.assists || 0, saves: s.saves || 0, ownGoals: s.ownGoals || 0,
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
                            if (p.ownGoals > 0) stats.push(`<span class="ranking-own-goals">-⚽ ${p.ownGoals}</span>`);
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
                    if (p.ownGoals > 0) parts.push(`-⚽ ${p.ownGoals}`);
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
        
        // Room closed (the host left, so the room is gone)
        this.network.on('roomClosed', (data) => {
            this._isHostAuthority = false;
            this._peerHostRtt = null;
            this.stopGame();
            this.currentRoomData = null;

            const reason = data?.reason || 'Oda sahibi ayrıldı';
            alert(`${reason}.\n\nOda kapatıldı, ana menüye dönüyorsun.`);
            this.ui.showScreen('mainMenu');
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
                <div style="background:var(--panel);padding:40px;border-radius:var(--radius-sm);text-align:center;box-shadow:var(--shadow-xl);border:2px solid var(--stroke);min-width:320px;">
                    <div style="font-size:48px;margin-bottom:16px;">\u26A0\uFE0F</div>
                    <h2 style="color:var(--text-primary);margin:0 0 8px;font-size:22px;text-transform:uppercase;letter-spacing:1px;">Ba\u011flant\u0131 Koptu</h2>
                    <p style="color:var(--text-secondary);margin:0 0 24px;font-size:14px;">${reason}</p>
                    <button id="btnConnOk" class="btn btn-primary" style="padding:10px 40px;font-size:16px;font-weight:700;">Tamam</button>
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
                this._removePauseOverlay();
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
                if (data.players) {
                    this.currentRoomData.players = data.players;
                    for (const player of data.players) {
                        if (player.avatar == null) continue;
                        const disc = this.physics.discs.find(d => d.isPlayer && d.id === player.id);
                        if (disc) {
                            disc.avatar = player.avatar;
                            disc._avatar = player.avatar;
                        }
                    }
                }
                if (data.playerSpeedMultiplier !== undefined) {
                    const previous = this.currentRoomData.playerSpeedMultiplier || 1;
                    const ratio = data.playerSpeedMultiplier / previous;
                    this.currentRoomData.playerSpeedMultiplier = data.playerSpeedMultiplier;
                    for (const disc of this.physics.discs) {
                        if (!disc.isPlayer) continue;
                        disc.acceleration *= ratio;
                        disc.kickingAcceleration *= ratio;
                    }
                }
                if (data.ballSpeedMultiplier !== undefined) {
                    this.currentRoomData.ballSpeedMultiplier = data.ballSpeedMultiplier;
                    this.physics.ballSpeedMultiplier = data.ballSpeedMultiplier;
                }
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
                const lobby = this.ui.screens.roomLobby;
                if (this.ui.currentScreen === 'roomLobby' && lobby) {
                    lobby.updateTeamColors(this.currentRoomData.teamColors);
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
            this._networkStaticDiscCount = this.physics.discs.length;
            this._currentStadium = stadium;
            this.renderer._stadiumDirty = true;
        }
    }

    _handleGameState(state, isFullState = false) {
        // Skip if stadium hasn't loaded yet (race condition guard)
        if (this.gameRunning && !this._stadiumReady) return;

        if (!state?.matchEpoch) return; // Untrusted server placeholders cannot seed host-authority simulation.
        if (isFullState) {
            if (this._matchEpoch !== state.matchEpoch) {
                this._snapshotBuffer.clear();
                this._lastAuthoritySnapshotSeq = -1;
                this._lastAuthorityTick = -1;
                this._inputHistory.reset();
            }
            this._matchEpoch = state.matchEpoch;
            this._fullStateReady = true;
        } else {
            if (!this._fullStateReady) return;
            if (state.matchEpoch !== this._matchEpoch) {
                this._fullStateReady = false;
                this.network.requestFullState(this._matchEpoch || null);
                return;
            }
        }

        // The WebRTC channel is unordered and may lose packets. Ignore an old
        // snapshot that arrives after a newer one so it cannot rewind a client.
        const snapshotSeq = Number.isFinite(state.snapshotSeq) ? state.snapshotSeq : state.tick;
        if (Number.isFinite(snapshotSeq) && snapshotSeq <= this._lastAuthoritySnapshotSeq) return;
        if (Number.isFinite(snapshotSeq)) this._lastAuthoritySnapshotSeq = snapshotSeq;
        if (Number.isFinite(state.physicsTick)) {
            if (!isFullState && state.physicsTick < this._lastAuthorityTick) return;
            this._lastAuthorityTick = Math.max(this._lastAuthorityTick, state.physicsTick);
        }
        this._lastAuthorityReceivedAt = performance.now();

        // Mark first state received for client prediction guard
        if (!this._firstStateReceived) this._firstStateReceived = true;

        // Store server state for reconciliation (host-authority mode)
        if (state.physics && state.physics.discs && state.lastProcessedSeq) {
            const myId = this.network.socket?.id;
            const mySeq = state.lastProcessedSeq[myId] || 0;
            this._lastConfirmedServerState = state.physics;
            this._lastConfirmedServerSeq = mySeq;
            this._inputHistory.acknowledge(mySeq);
            this._reconciliationPending = true;
        }

        // Pause/restart state travels with snapshots so a stale overlay cannot
        // remain visible when a new match starts.
        this._isPaused = !!state.paused;
        if (this._isPaused) this._showPauseOverlay();
        else this._removePauseOverlay();

        // Clear interpolation buffer on state transitions to prevent stale data
        if (this._serverGameState !== state.state) {
            this._snapshotBuffer.clear();
        }
        this._serverGameState = state.state;

        // Set goal pause flag
        this.physics.inGoalPause = (state.state === 'goal');

        // Add to interpolation buffer for non-host clients
        if (!this._isHost() || !this._isHostAuthority) {
            this._snapshotBuffer.addSnapshot(performance.now(), state);
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
        this.scoreboard.update(
            state.scoreRed,
            state.scoreBlue,
            state.time,
            state.timeLimit ?? this.currentRoomData?.game?.timeLimit ?? 0
        );
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

        const stateDiscs = physicsState.discs;
        const firstPlayerIndex = stateDiscs.findIndex(d => d.isPlayer);
        const staticCount = firstPlayerIndex >= 0
            ? firstPlayerIndex
            : (this._networkStaticDiscCount ?? this.physics.discs.length);
        const staticDiscs = this.physics.discs.slice(0, staticCount);
        while (staticDiscs.length < staticCount) staticDiscs.push(new Disc());

        // Team changes remove and re-add player discs, shifting array indices.
        // Rebuild the dynamic tail by ID so a length change cannot drop or reuse
        // another player's disc at its stale position.
        const existingPlayers = new Map();
        for (const disc of this.physics.discs) {
            if (disc.isPlayer && disc.id != null) existingPlayers.set(disc.id, disc);
        }
        const playerStates = stateDiscs.filter(d => d.isPlayer);
        const playerDiscs = playerStates.map(sd => {
            const existing = sd.id != null ? existingPlayers.get(sd.id) : null;
            if (existing) {
                if (existing.team !== sd.team) {
                    existing.pos.x = sd.x;
                    existing.pos.y = sd.y;
                    existing.speed.x = sd.sx;
                    existing.speed.y = sd.sy;
                    existing._spawnPos = { x: sd.x, y: sd.y };
                    if (sd.id === this.network.socket?.id) {
                        this._localRenderCorrection = { x: 0, y: 0, updatedAt: performance.now() };
                    }
                }
                return existing;
            }

            const disc = new Disc();
            disc.pos.x = sd.x;
            disc.pos.y = sd.y;
            disc.speed.x = sd.sx;
            disc.speed.y = sd.sy;
            disc._spawnPos = { x: sd.x, y: sd.y };
            if (sd.id === this.network.socket?.id) {
                this._inputHistory.reset(this._lastConfirmedServerSeq);
                this._localRenderCorrection = { x: 0, y: 0, updatedAt: performance.now() };
            }
            return disc;
        });
        this.physics.discs = [...staticDiscs, ...playerDiscs];

        for (let i = 0; i < stateDiscs.length; i++) {
            const sd = stateDiscs[i];
            const disc = i < staticCount ? staticDiscs[i] : playerDiscs[i - staticCount];
            if (!disc) continue;

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
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('netdebug') === '1') {
        app.networkDebugPanel = new NetworkDebugPanel(app);
    }
    app.init();
    window.gokball = app; // Dev access
});
