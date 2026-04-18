/**
 * Server-side Game manager
 * Manages game state, scoring, and physics simulation
 */
import { GamePhysics } from './physics/GamePhysics.js';

export class Game {
    constructor(room) {
        this.room = room;
        this.physics = new GamePhysics();
        this.state = 'stopped'; // 'stopped' | 'countdown' | 'playing' | 'goal' | 'ended'
        this.scoreRed = 0;
        this.scoreBlue = 0;
        this.timeElapsed = 0;       // in ticks
        this.scoreLimit = 3;
        this.timeLimit = 3 * 60;    // seconds
        this.tickRate = 60;         // FPS
        this.tickInterval = null;
        this.countdownTicks = 0;
        this.goalPauseTicks = 0;
        this.overtimeEnabled = true;
        this.playerDiscs = new Map(); // playerId -> disc index
    }

    rebuildPlayerDiscMap() {
        this.playerDiscs.clear();
        for (let i = 0; i < this.physics.discs.length; i++) {
            const disc = this.physics.discs[i];
            if (disc.isPlayer && disc.ownerId) {
                this.playerDiscs.set(disc.ownerId, i);
                const player = this.room.players.get(disc.ownerId);
                if (player) {
                    player.discIndex = i;
                }
            }
        }
    }

    /**
     * Load stadium into physics
     */
    setStadium(stadiumData) {
        this.physics.loadStadium(stadiumData);
        this.stadiumData = stadiumData;
    }

    /**
     * Start the game
     */
    start() {
        if (this.state === 'playing') return;

        this.scoreRed = 0;
        this.scoreBlue = 0;
        this.timeElapsed = 0;
        this.state = 'countdown';
        this.countdownTicks = 0; // Starts immediately without waiting

        // Reset physics
        this.physics.loadStadium(this.stadiumData);

        // Add player discs
        this._spawnPlayers();

        // Red team starts the game
        this.physics.setKickOffTeam('red');

        // Start game loop
        this._startLoop();

        return { scoreRed: 0, scoreBlue: 0 };
    }

    /**
     * Stop the game
     */
    stop() {
        this.state = 'stopped';
        this._stopLoop();
        this._removeAllPlayerDiscs();
    }

    _spawnPlayers() {
        this._removeAllPlayerDiscs();
        const playerPhysics = this.stadiumData.playerPhysics || {};
        const spawnDist = this.stadiumData.spawnDistance || 170;

        const redPlayers = this.room.getTeamPlayers('red');
        const bluePlayers = this.room.getTeamPlayers('blue');

        // Spawn red team
        const redSpacing = 40;
        for (let i = 0; i < redPlayers.length; i++) {
            const p = redPlayers[i];
            const y = (i - (redPlayers.length - 1) / 2) * redSpacing;
            const discIdx = this.physics.addPlayerDisc(playerPhysics, 'red', -spawnDist, y, p.id);
            this.playerDiscs.set(p.id, discIdx);
            p.discIndex = discIdx;

            // Assign name/avatar for client rendering
            const disc = this.physics.discs[discIdx];
            if (disc) {
                disc._playerName = p.name;
                disc._avatar = p.avatar;
                if (this.room.teamColors && this.room.teamColors['red']) {
                    disc.color = this.room.teamColors['red'].colors[0];
                    disc.avatarColor = this.room.teamColors['red'].textColor;
                } else {
                    disc.color = 'c70000'; // Default Red
                    disc.avatarColor = 'FFFFFF';
                }
            }
        }

        // Spawn blue team
        const blueSpacing = 40;
        for (let i = 0; i < bluePlayers.length; i++) {
            const p = bluePlayers[i];
            const y = (i - (bluePlayers.length - 1) / 2) * blueSpacing;
            const discIdx = this.physics.addPlayerDisc(playerPhysics, 'blue', spawnDist, y, p.id);
            this.playerDiscs.set(p.id, discIdx);
            p.discIndex = discIdx;

            // Assign name/avatar for client rendering
            const disc = this.physics.discs[discIdx];
            if (disc) {
                disc._playerName = p.name;
                disc._avatar = p.avatar;
                if (this.room.teamColors && this.room.teamColors['blue']) {
                    disc.color = this.room.teamColors['blue'].colors[0];
                    disc.avatarColor = this.room.teamColors['blue'].textColor;
                } else {
                    disc.color = '00008c'; // Default Blue
                    disc.avatarColor = 'FFFFFF';
                }
            }
        }
        
        // Ensure ball color starts as FFB82E
        if (this.physics.ballDisc) {
            this.physics.ballDisc.color = 'FFB82E';
        }
    }

    _removeAllPlayerDiscs() {
        // Remove from end to avoid index shifting
        const indices = [...this.playerDiscs.values()].sort((a, b) => b - a);
        for (const idx of indices) {
            this.physics.removeDisc(idx);
        }
        this.playerDiscs.clear();
    }

    /**
     * Update player input
     */
    setPlayerInput(playerId, input) {
        const discIdx = this.playerDiscs.get(playerId);
        if (discIdx === undefined) return;

        const disc = this.physics.discs[discIdx];
        if (disc) {
            disc.input = input;
        }
    }

    _startLoop() {
        this._stopLoop();
        this.physics.setKickOffTeam('red'); // Red gets the first kickoff
        const interval = 1000 / this.tickRate;
        this.tickInterval = setInterval(() => this._tick(), interval);
    }

    _stopLoop() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
    }

    _tick() {
        if (this.state === 'countdown') {
            this.countdownTicks--;
            if (this.countdownTicks <= 0) {
                this.state = 'playing';
                this.room.broadcast('gameStarted', {
                    scoreRed: this.scoreRed,
                    scoreBlue: this.scoreBlue
                });
            } else {
                const secondsLeft = Math.ceil(this.countdownTicks / this.tickRate);
                if (this.countdownTicks % this.tickRate === 0) {
                    this.room.broadcast('countdown', { seconds: secondsLeft });
                }
            }
            return;
        }

        if (this.state === 'goal') {
            this.goalPauseTicks--;
            if (this.goalPauseTicks <= 0) {
                // Check if game should end
                if (this._checkGameEnd()) {
                    this.state = 'ended';
                    this.room.broadcast('gameOver', {
                        scoreRed: this.scoreRed,
                        scoreBlue: this.scoreBlue,
                        winner: this.scoreRed > this.scoreBlue ? 'red' : 'blue',
                        roomData: this.room.getRoomData()
                    });
                    this._stopLoop();
                    return;
                }

                // Reset for next kickoff
                this.physics.resetPositions();
                this._spawnPlayers();
                this.state = 'playing';
            }
            // Still broadcast state during goal pause
            this.room.broadcast('gameState', this._getGameState());
            return;
        }

        if (this.state !== 'playing') {
            this.lastPhysTime = performance.now();
            return;
        }

        // Fixed Timestep Accumulator for Server Physics (Matches Client exactly!)
        const now = performance.now();
        const dt = now - (this.lastPhysTime || now);
        this.lastPhysTime = now;
        
        this.accumulator = (this.accumulator || 0) + Math.min(dt, 100);
        const stepSize = 1000 / this.tickRate; // Exact 60Hz step

        const isLocalMode = this.room.roomType === 'local';
        let goalTeam = null;

        while (this.accumulator >= stepSize) {
            if (!isLocalMode) {
                const result = this.physics.step();
                if (result.goalTeam) goalTeam = result.goalTeam;
            } else {
                // Local mode handles physics via auth packets
            }

            // Increment time logic safely within loop
            this.timeElapsed++;
            this.accumulator -= stepSize;
        }

        // Check goal
        if (goalTeam) {
            this._handleGoal(goalTeam);
        }

        // Check time limit
        if (this.timeLimit > 0 && this.timeElapsed / this.tickRate >= this.timeLimit) {
            if (this.scoreRed !== this.scoreBlue) {
                this.state = 'ended';
                this.room.broadcast('gameOver', {
                    scoreRed: this.scoreRed,
                    scoreBlue: this.scoreBlue,
                    winner: this.scoreRed > this.scoreBlue ? 'red' : 'blue'
                });
                this._stopLoop();
                return;
            }
            // Overtime - continue until a goal
        }

        // Broadcast state (only in cloud mode — local mode is handled by applyAuthorityState)
        if (!isLocalMode) {
            this.room.broadcast('gameState', this._getGameState());
        }
    }

    _handleGoal(scoredOnTeam) {
        // The team that was scored ON loses, opposite team scores
        if (scoredOnTeam === 'red') {
            this.scoreBlue++;
        } else {
            this.scoreRed++;
        }

        this.state = 'goal';
        this.goalPauseTicks = 2 * this.tickRate; // 2 second pause

        // The team conceded the goal gets the next kick-off
        this.physics.setKickOffTeam(scoredOnTeam);

        this.room.broadcast('goalScored', {
            team: scoredOnTeam === 'red' ? 'blue' : 'red',
            scoreRed: this.scoreRed,
            scoreBlue: this.scoreBlue
        });
    }

    _checkGameEnd() {
        if (this.scoreLimit > 0) {
            if (this.scoreRed >= this.scoreLimit || this.scoreBlue >= this.scoreLimit) {
                return true;
            }
        }
        return false;
    }

    /**
     * Apply state from an authoritative client (Admin in Local mode)
     */
    applyAuthorityState(state) {
        if (!state) return;
        
        // Sync physics discs
        if (state.physics) {
            this.physics.applyState(state.physics);
        }

        // Sync score and time
        if (state.scoreRed !== undefined) this.scoreRed = state.scoreRed;
        if (state.scoreBlue !== undefined) this.scoreBlue = state.scoreBlue;
        if (state.time !== undefined) this.timeElapsed = state.time * (this.tickRate || 60);

        // Broadcast to others immediately
        this.room.broadcast('gameState', this._getGameState());
    }

    _getGameState() {
        // Sync typing status from players to physics discs
        for (const player of this.room.players.values()) {
            if (player.discIndex >= 0 && this.physics.discs[player.discIndex]) {
                this.physics.discs[player.discIndex].typing = player.typing;
            }
        }

        return {
            state: this.state,
            physics: this.physics.getState(),
            scoreRed: this.scoreRed,
            scoreBlue: this.scoreBlue,
            time: Math.floor(this.timeElapsed / this.tickRate)
        };
    }

    getInfo() {
        return {
            state: this.state,
            scoreRed: this.scoreRed,
            scoreBlue: this.scoreBlue,
            time: Math.floor(this.timeElapsed / this.tickRate),
            scoreLimit: this.scoreLimit,
            timeLimit: this.timeLimit
        };
    }
}
