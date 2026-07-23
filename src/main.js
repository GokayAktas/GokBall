/**
 * GokBall - Main Application Entry Point
 * Wires together UI, engine, and networking
 * All game logic runs on the server (host's machine), clients do prediction
 */
import { NetworkManager } from './network/NetworkManager.js';
import { Physics, CollisionFlags } from './engine/Physics.js';
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

        const stepSize = 1000 / 60;
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
                    // Goal pause: physics still runs
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
                // --- CLIENT MODE: Normal prediction ---
                if (this._serverGameState === 'playing' || this._serverGameState === 'goal') {
                    for (const disc of this.physics.discs) {
                        if (disc.isPlayer) {
                            disc.input = { up: false, down: false, left: false, right: false, kick: false };
                        }
                    }
                    const myDisc = this.physics.discs.find(d => d.id === this.network.socket?.id);
                    if (myDisc) myDisc.input = inputState;
                    this.physics.step();
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

    /** Check if this client is the room creator/host */
    _isHost() {
        return this.currentRoomData?.creatorId === this.network.socket?.id;
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

        const pp = this._currentStadium?.playerPhysics || {
            radius: 15, bCoef: 0.5, invMass: 0.5, damping: 0.96,
            acceleration: 0.10, kickingAcceleration: 0.065, kickingDamping: 0.96, kickStrength: 5
        };
        const spawnDist = this._currentStadium?.spawnDistance || 170;

        const players = this.currentRoomData?.players || [];
        // Separate by team
        const redPlayers = players.filter(p => p.team === 'red');
        const bluePlayers = players.filter(p => p.team === 'blue');

        const spacing = 40;
        const spawnTeam = (teamPlayers, team, dir) => {
            for (let i = 0; i < teamPlayers.length; i++) {
                const p = teamPlayers[i];
                const y = (i - (teamPlayers.length - 1) / 2) * spacing;
                const disc = this.physics.addPlayerDisc(pp, team, dir * spawnDist, y);
                disc.id = p.id;
                disc.ownerId = p.id;
                disc._playerName = p.name;
                disc._avatar = p.avatar || '1';
                disc.color = team === 'red' ? 'c70000' : '00008c';
                disc.colors = [disc.color];
                disc.avatarColor = 'FFFFFF';
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

        // Update scoreboard locally
        this.scoreboard.update(this._hostScoreRed, this._hostScoreBlue, Math.floor(this._hostTimeElapsed / 60));
        this.scoreboard.showGoal(scoringTeam);
        this.audio.playGoal();

        this.chat.addMessage({
            message: `\u26bd GOL! ${scoringTeam === 'red' ? 'K\u0131rm\u0131z\u0131' : 'Mavi'} tak\u0131m skoru: ${this._hostScoreRed} - ${this._hostScoreBlue}`,
            system: true
        });

        // Send goalScored event to server for relay to other players
        this.network.socket?.emit('hostGoalEvent', {
            team: scoringTeam,
            scoreRed: this._hostScoreRed,
            scoreBlue: this._hostScoreBlue
        });
    }

    /** Handle game over in host mode */
    _hostGameOver() {
        const winner = this._hostScoreRed > this._hostScoreBlue ? 'red' : 'blue';
        this._hostGameState = 'ended';

        const winTeamStr = winner === 'red' ? 'K\u0131rm\u0131z\u0131' : 'Mavi';
        const winColor = winner === 'red' ? '#c70000' : '#00008c';

        // Send game over to server for relay to other players
        this.network.socket?.emit('hostGameOverEvent', {
            winner: winner,
            scoreRed: this._hostScoreRed,
            scoreBlue: this._hostScoreBlue
        });

        const overlay = document.createElement('div');
        overlay.className = 'game-over-overlay';
        overlay.innerHTML = `
            <h1 style="color: ${winColor}; text-shadow: 2px 2px 0 rgba(0,0,0,0.6); font-size: 48px; margin: 0; font-weight: bold;">${winTeamStr} TAKIM KAZANDI!</h1>
            <p style="color: var(--text-primary); font-size: 24px; text-shadow: 1px 1px 0 rgba(0,0,0,0.6); margin-top: 10px;">Maç Skoru: ${this._hostScoreRed} - ${this._hostScoreBlue}</p>
        `;
        document.body.appendChild(overlay);

        setTimeout(() => {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            this.stopGame();
        }, 3000);
    }

    /** Toggle pause state (host only) */
    _togglePause() {
        if (!this._isHost() || !this._isHostAuthority) return;
        if (this._hostGameState !== 'playing' && !this._isPaused) return;
        
        this._isPaused = !this._isPaused;
        
        if (this._isPaused) {
            this._showPauseOverlay();
            // Notify non-host players via server
            this.network.socket?.emit('pauseGame', { paused: true });
        } else {
            this._resumeGame();
        }
        
        // Update InGameMenu if visible
        if (this.inGameMenu.isVisible) {
            this.inGameMenu.render(this.currentRoomData);
        }
    }

    _showPauseOverlay(showResumeRect) {
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
            ${showResumeRect ? '<div class="resume-rect" id="resumeRect"></div>' : ''}
        `;
        document.body.appendChild(overlay);
        
        if (showResumeRect) {
            // Start rectangle shrink animation
            const rect = document.getElementById('resumeRect');
            if (rect) {
                // Force reflow
                void rect.offsetWidth;
                rect.classList.add('animating');
                
                // After animation completes (3s), remove everything
                setTimeout(() => {
                    this._removePauseOverlay();
                    document.getElementById('gameCanvas')?.classList.remove('paused');
                }, 3200);
            }
        }
    }

    _removePauseOverlay() {
        const existing = document.getElementById('pauseOverlay');
        if (existing) existing.remove();
        document.getElementById('gameCanvas')?.classList.remove('paused');
    }

    _resumeGame() {
        this._isPaused = false;
        
        // Notify non-host players via server
        this.network.socket?.emit('pauseGame', { paused: false });
        
        // Send authority state immediately
        this._sendAuthorityState();
        
        // Keep text visible during animation, show rectangle below hint
        this._showPauseOverlay(true);
    }

    _playResumeAnimation() {
        // No longer used - handled by _showPauseOverlay(true)
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
                existingDisc.color = playerData.team === 'red' ? 'c70000' : '00008c';
                existingDisc.colors = [existingDisc.color];
                existingDisc._playerName = playerData.name;
                existingDisc._avatar = playerData.avatar || '1';
                existingDisc._spawnPos.x = existingDisc.pos.x;
                existingDisc._spawnPos.y = existingDisc.pos.y;
                
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
                disc.color = playerData.team === 'red' ? 'c70000' : '00008c';
                disc.colors = [disc.color];
                disc.avatarColor = 'FFFFFF';
            }
        }
    }

    /** Send authoritative state to server (relayed to other players) */
    _sendAuthorityState() {
        this._hostAuthoritySendCounter = (this._hostAuthoritySendCounter || 0) + 1;
        // Send at ~30fps (every other frame at 60fps)
        if (this._hostAuthoritySendCounter % 2 !== 0) return;

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

        // Chat messages (in-game)
        this.network.on('chatMessage', (data) => {
            if (this.gameRunning) {
                this.chat.addMessage(data);
            }
        });
        
        // Game stopped (admin clicked stop)
        this.network.on('gameStopped', (data) => {
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
