/**
 * Server-side Game manager
 * Manages game state, scoring, and physics simulation
 */
import { GamePhysics } from './physics/GamePhysics.js';

export class Game {
    constructor(room) {
        this.room = room;
        this.physics = new GamePhysics();
        this._goalCooldownUntil = 0; // tick count until we ignore further goals
        this._forceKickOffIgnoreUntil = 0; // timestamp to ignore incoming kickOffTeam from admin right after start
        this._lastGoalTeam = null; // track last detected goal team from authority to avoid duplicates
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

        // Start immediately without countdown
        this.state = 'playing';

        // Reset physics and spawn players
        this.physics.loadStadium(this.stadiumData);
        this._spawnPlayers();

        // Set kickoff team (red by default)
        this.physics.setKickOffTeam('red');

        // Do NOT automatically lock teams on start - keep current room.teamsLocked state

        // Start game loop
        this._startLoop();

        // Ignore incoming kick-off team updates briefly to avoid race with restart
        // Increase window to avoid accepting stale client-authoritative kickoff team
        this._forceKickOffIgnoreUntil = Date.now() + 2000; // 2s

        // Clear last goal tracker so local-authority goal detection from previous match
        // cannot leak into the new match
        this._lastGoalTeam = null;

        // Broadcast start immediately to clients
        this.room.broadcast('gameStarted', {
            scoreRed: this.scoreRed,
            scoreBlue: this.scoreBlue,
            roomData: this.room.getRoomData(),
            state: this._getGameState()
        });

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
                    disc.colors = this.room.teamColors['red'].colors;
                    disc.colorAngle = this.room.teamColors['red'].angle;
                    disc.avatarColor = this.room.teamColors['red'].textColor;
                } else {
                    disc.color = 'c70000'; // Default Red
                    disc.colors = ['c70000'];
                    disc.colorAngle = 0;
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
                    disc.colors = this.room.teamColors['blue'].colors;
                    disc.colorAngle = this.room.teamColors['blue'].angle;
                    disc.avatarColor = this.room.teamColors['blue'].textColor;
                } else {
                    disc.color = '00008c'; // Default Blue
                    disc.colors = ['00008c'];
                    disc.colorAngle = 0;
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
        // Server-side guard: ignore inputs from non-playing players (spectators)
        const player = this.room.players.get(playerId);
        if (!player) return;
        if (player.team !== 'red' && player.team !== 'blue') return;

        const discIdx = this.playerDiscs.get(playerId);
        if (discIdx === undefined) return;

        const disc = this.physics.discs[discIdx];
        // Extra safety: ensure the disc actually belongs to this player
        if (!disc || disc.ownerId !== playerId) return;

        // Apply input
        disc.input = input;
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
                    scoreBlue: this.scoreBlue,
                    roomData: this.room.getRoomData(),
                    state: this._getGameState()
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

        let goalTeam = null;

        while (this.accumulator >= stepSize) {
            const result = this.physics.step();
            if (result.goalTeam) goalTeam = result.goalTeam;

            // Increment time logic safely within loop
            // Do not advance match clock while kickoff reset is active (waiting for kickoff touch)
            // Auto-release kickoff reset if ball moves (in case client missed the touch)
            if (this.physics.kickOffReset && this.physics.ballDisc) {
                const b = this.physics.ballDisc;
                const speed = Math.sqrt((b.speed.x || 0) ** 2 + (b.speed.y || 0) ** 2);
                const kickOffRadius = this.stadium?.bg?.kickOffRadius || 75;
                const dist = Math.sqrt((b.pos.x || 0) * (b.pos.x || 0) + (b.pos.y || 0) * (b.pos.y || 0));
                if (speed > 0.5 || dist > (kickOffRadius + (b.radius || 0))) {
                    this.physics.kickOffReset = false;
                }
            }

            if (!this.physics.kickOffReset) {
                this.timeElapsed++;
            }
            this.accumulator -= stepSize;
        }

        // Check goal (guard against rapid re-triggering)
        if (goalTeam) {
            if (this.timeElapsed > this._goalCooldownUntil) {
                this._handleGoal(goalTeam);
            }
        }

        // Notify clients to release held kick if server-side physics auto-triggered a kick
        // Iterate discs and if disc._autoKickReleased is set, inform the owning player
        try {
            for (const disc of this.physics.discs) {
                if (disc._autoKickReleased && disc.ownerId) {
                    const player = this.room.players.get(disc.ownerId);
                    if (player && player.socket) {
                        player.socket.emit('kickReleased');
                    }
                    disc._autoKickReleased = false;
                }
            }
        } catch (e) {
            // swallow errors here to avoid crashing server loop
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

        // Broadcast state
        this._broadcastCounter = (this._broadcastCounter || 0) + 1;
        if (this._broadcastCounter % 2 === 0) {
            this.room.broadcast('gameState', this._getGameState());
        }
    }

    _handleGoal(scoredOnTeam) {

        // Basic scoring handler
        // Prevent duplicate handling: ignore if we've recently handled a goal
        const nowTicks = this.timeElapsed;
        if (nowTicks <= this._goalCooldownUntil) return;
        // `scoredOnTeam` is the team whose goal line the ball crossed (i.e. the
        // team that conceded). The scoring team is the opposite team.
        const scoringTeam = scoredOnTeam === 'red' ? 'blue' : 'red';
        if (scoringTeam === 'red') this.scoreRed++;
        else this.scoreBlue++;
        this.state = 'goal';
        this.physics.kickOffReset = true;
        // set cooldown until we allow next goal to be counted (score pause length in ticks)
        // Add a small safety margin to avoid re-processing due to rounding or
        // tick-edge conditions.
        const pauseTicks = 60; // 1 second at 60Hz
        const safetyMargin = 2; // extra ticks
        this._goalCooldownUntil = this.timeElapsed + pauseTicks + safetyMargin;
        // Broadcast goal
        this.room.broadcast('goalScored', { team: scoredOnTeam === 'red' ? 'blue' : 'red', scoreRed: this.scoreRed, scoreBlue: this.scoreBlue });

        this.state = 'goal';
        this.goalPauseTicks = 2 * this.tickRate; // 2 second pause

        // The team conceded the goal gets the next kick-off
        this.physics.setKickOffTeam(scoredOnTeam);
        // Ensure kickoff reset so clock doesn't advance
        this.physics.kickOffReset = true;

        // Immediately teleport the ball to center and zero its velocity so
        // clients see the center reset right away instead of waiting for the
        // pause to expire.
        if (this.physics.ballDisc) {
            this.physics.ballDisc.pos.x = 0;
            this.physics.ballDisc.pos.y = 0;
            this.physics.ballDisc.speed.x = 0;
            this.physics.ballDisc.speed.y = 0;
            // Restore default ball color
            this.physics.ballDisc.color = 'FFB82E';
        }

        // Send immediate gameState so clients reflect the teleported ball
        this.room.broadcast('gameState', this._getGameState());
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
        // No-op: local mode removed
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
