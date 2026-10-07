import { Physics } from '../engine/Physics.js';
import { NETWORK_PROTOCOL_VERSION } from './Protocol.js';

const STEP_MS = 1000 / 60;
// Physics still advances at 60 Hz. 30 Hz snapshots are enough for the
// interpolation buffer and avoid flooding Socket.IO fallback connections.
const SNAPSHOT_EVERY_TICKS = 2;
const INPUT_TIMEOUT_MS = 250;
const GOAL_PAUSE_TICKS = 180;
const EMPTY_INPUT = Object.freeze({ up: false, down: false, left: false, right: false, kick: false });

let physics;
let players = [];
let inputByPlayer = new Map();
let lastProcessedSeq = new Map();
let matchEpoch = '';
let tick = 0;
let snapshotSeq = 0;
let accumulator = 0;
let lastTime = 0;
let timer = null;
let paused = false;
let goalPauseTicks = 0;
let gameState = 'playing';
let scoreRed = 0;
let scoreBlue = 0;
let elapsedTicks = 0;
let scoreLimit = 3;
let timeLimit = 180;
let overtimeEnabled = true;
let overtime = false;
let positionResetId = 0;
let lastToucher = null;
let previousToucher = null;
let matchStats = {};

function addStats(playerId, field, player, name = null) {
    if (!playerId || !player) return;
    const entry = matchStats[playerId] || {
        goals: 0, assists: 0, saves: 0, ownGoals: 0,
        name: name || player.name || '', team: player.team
    };
    entry[field]++;
    matchStats[playerId] = entry;
}

function spawnPlayers() {
    const base = physics.stadium?.playerPhysics || {};
    const multiplier = self.settings?.playerSpeedMultiplier || 1;
    const pp = {
        ...base,
        acceleration: (base.acceleration || 0.1) * multiplier,
        kickingAcceleration: (base.kickingAcceleration || 0.065) * multiplier
    };
    for (const team of ['red', 'blue']) {
        const teamPlayers = players.filter(player => player.team === team);
        const x = (team === 'red' ? -1 : 1) * (physics.stadium?.spawnDistance || 170);
        teamPlayers.forEach((player, index) => {
            const disc = physics.addPlayerDisc(pp, team, x, (index - (teamPlayers.length - 1) / 2) * 40);
            disc.id = player.id;
            disc.ownerId = player.id;
            disc._playerName = player.name || '';
            disc._avatar = player.avatar || '1';
            applyColors(disc, player.team);
        });
    }
}

function applyColors(disc, team) {
    const colors = self.settings?.teamColors?.[team];
    if (colors?.colors?.length) {
        disc.color = colors.colors[0];
        disc.colors = colors.colors;
        disc.colorAngle = colors.angle || 0;
        disc.avatarColor = colors.avatarColor || colors.textColor || 'FFFFFF';
    } else {
        disc.color = team === 'red' ? 'c70000' : '00008c';
        disc.colors = [disc.color];
        disc.colorAngle = 0;
        disc.avatarColor = 'FFFFFF';
    }
}

function applyPlayerUpdate(player) {
    if (!player?.id) return;
    players = players.filter(item => item.id !== player.id).concat(player);
    let disc = physics.discs.find(item => item.isPlayer && item.id === player.id);
    if (disc && (!['red', 'blue'].includes(player.team) || disc.team !== player.team)) {
        physics.discs.splice(physics.discs.indexOf(disc), 1);
        disc = null;
    }
    if (!disc && ['red', 'blue'].includes(player.team)) {
        const base = physics.stadium?.playerPhysics || {};
        const mult = self.settings?.playerSpeedMultiplier || 1;
        const dir = player.team === 'red' ? -1 : 1;
        disc = physics.addPlayerDisc({
            ...base,
            acceleration: (base.acceleration || 0.1) * mult,
            kickingAcceleration: (base.kickingAcceleration || 0.065) * mult
        }, player.team, dir * (physics.stadium?.spawnDistance || 170), 0);
        disc.id = player.id;
        disc.ownerId = player.id;
    }
    if (disc) {
        disc._playerName = player.name || '';
        disc._avatar = player.avatar || '1';
        applyColors(disc, player.team);
    }
}

function makeState(sequence, fullState = false) {
    return {
        protocolVersion: NETWORK_PROTOCOL_VERSION,
        matchEpoch,
        tick,
        physicsTick: tick,
        snapshotSeq: sequence,
        positionResetId,
        paused,
        state: gameState,
        scoreRed,
        scoreBlue,
        time: Math.floor(elapsedTicks / 60),
        scoreLimit,
        timeLimit,
        overtime,
        matchStats,
        physics: physics.getState(),
        lastProcessedSeq: Object.fromEntries(lastProcessedSeq),
        fullState
    };
}

function emitSnapshot(extra = {}) {
    const state = makeState(++snapshotSeq, !!extra.fullState);
    self.postMessage({
        v: NETWORK_PROTOCOL_VERSION,
        type: 'snapshot',
        matchEpoch,
        tick,
        lastProcessedSeq: state.lastProcessedSeq,
        state,
        lastTouchedBy: physics.ballDisc?.lastTouchedBy || null,
        lastTouchedTeam: physics.ballDisc?.lastTouchedTeam || null,
        goalPauseTicks,
        ...extra
    });
}

function updateTouchTracking() {
    const toucher = physics.ballDisc?.lastTouchedBy;
    if (toucher && toucher !== lastToucher) {
        previousToucher = lastToucher;
        lastToucher = toucher;
    }
}

function finishMatch(reason) {
    if (gameState === 'ended') return;
    gameState = 'ended';
    paused = true;
    self.postMessage({
        v: NETWORK_PROTOCOL_VERSION,
        type: 'gameOver',
        matchEpoch,
        tick,
        reason,
        winner: scoreRed === scoreBlue ? null : scoreRed > scoreBlue ? 'red' : 'blue',
        scoreRed,
        scoreBlue,
        time: Math.floor(elapsedTicks / 60),
        matchStats
    });
}

function handleGoal(concededTeam) {
    const scoringTeam = concededTeam === 'red' ? 'blue' : 'red';
    if (scoringTeam === 'red') scoreRed++;
    else scoreBlue++;

    const scorer = players.find(player => player.id === lastToucher) || null;
    const ownGoal = !!scorer && scorer.team === concededTeam;
    if (scorer && (ownGoal || scorer.team === scoringTeam)) {
        addStats(scorer.id, ownGoal ? 'ownGoals' : 'goals', scorer);
    }
    let assister = null;
    if (!ownGoal && previousToucher && previousToucher !== lastToucher) {
        assister = players.find(player => player.id === previousToucher) || null;
        if (assister?.team === scoringTeam) addStats(assister.id, 'assists', assister);
        else assister = null;
    }

    gameState = 'goal';
    goalPauseTicks = GOAL_PAUSE_TICKS;
    physics.kickOffReset = true;
    physics.kickOffTeam = concededTeam;
    physics.inGoalPause = true;
    self.postMessage({
        v: NETWORK_PROTOCOL_VERSION,
        type: 'goal',
        matchEpoch,
        tick,
        team: scoringTeam,
        concededTeam,
        scoreRed,
        scoreBlue,
        time: Math.floor(elapsedTicks / 60),
        scorer: scorer?.name || '',
        assister: assister?.name || '',
        ownGoal,
        overtime,
        matchStats
    });
}

function step() {
    if (paused || gameState === 'ended') return;
    let kickHappened = false;
    let saveDetected = null;

    if (goalPauseTicks > 0) {
        for (const disc of physics.discs) if (disc.isPlayer) {
            disc.input = EMPTY_INPUT;
            disc.kicking = false;
        }
        physics.step();
        goalPauseTicks--;
        tick++;
        if (goalPauseTicks === 0) {
            if (scoreLimit > 0 && (scoreRed >= scoreLimit || scoreBlue >= scoreLimit)) {
                finishMatch('scoreLimit');
            } else {
                if (physics.ballDisc) {
                    physics.ballDisc.pos.x = 0;
                    physics.ballDisc.pos.y = 0;
                    physics.ballDisc.speed.x = 0;
                    physics.ballDisc.speed.y = 0;
                    physics.ballDisc.color = 'FFB82E';
                    physics.ballDisc.lastTouchedBy = null;
                    physics.ballDisc.lastTouchedTeam = null;
                }
                physics.resetPositions();
                physics.kickOffReset = true;
                physics.kickOffTeam = physics.kickOffTeam || 'red';
                physics.inGoalPause = false;
                positionResetId++;
                lastToucher = null;
                previousToucher = null;
                gameState = 'playing';
                self.postMessage({ v: NETWORK_PROTOCOL_VERSION, type: 'goalPauseEnded', matchEpoch, tick, positionResetId });
            }
        }
    } else {
        for (const disc of physics.discs) if (disc.isPlayer) {
            const record = inputByPlayer.get(disc.id);
            const stale = !record || performance.now() - record.receivedAt > INPUT_TIMEOUT_MS;
            disc.input = stale ? EMPTY_INPUT : record.input;
            if (record) lastProcessedSeq.set(disc.id, record.seq);
        }
        const result = physics.step();
        kickHappened = !!result.kickHappened;
        saveDetected = result.saveDetected || null;
        tick++;
        updateTouchTracking();

        const kickReleasedPlayers = physics.discs.filter(disc => disc.isPlayer && disc._autoKickReleased).map(disc => disc.id);
        if (kickReleasedPlayers.length) {
            const kickReleasedSet = new Set(kickReleasedPlayers);
            for (const disc of physics.discs) if (kickReleasedSet.has(disc.id)) disc._autoKickReleased = false;
            self.postMessage({ v: NETWORK_PROTOCOL_VERSION, type: 'kickReleased', matchEpoch, tick, playerIds: kickReleasedPlayers });
        }

        if (saveDetected) {
            const player = players.find(item => item.id === saveDetected);
            if (player) addStats(saveDetected, 'saves', player);
        }
        if (result.goalTeam && gameState === 'playing') handleGoal(result.goalTeam);
        else if (!physics.kickOffReset) elapsedTicks++;

        if (timeLimit > 0 && elapsedTicks >= timeLimit * 60) {
            if (scoreRed === scoreBlue && overtimeEnabled) {
                overtime = true;
            } else if (gameState === 'playing') {
                finishMatch('timeLimit');
            }
        }
    }

    if (tick % SNAPSHOT_EVERY_TICKS === 0) emitSnapshot({ kickHappened, saveDetected });
}

self.onmessage = ({ data }) => {
    if (!data || data.v !== NETWORK_PROTOCOL_VERSION) return;
    if (data.type === 'init') {
        clearInterval(timer);
        physics = new Physics();
        physics.loadStadium(data.stadium);
        physics.ballSpeedMultiplier = data.ballSpeedMultiplier || 1;
        matchEpoch = data.matchEpoch;
        tick = 0;
        snapshotSeq = 0;
        positionResetId = 0;
        players = data.players || [];
        self.settings = data;
        scoreRed = 0;
        scoreBlue = 0;
        elapsedTicks = 0;
        scoreLimit = data.scoreLimit ?? 3;
        timeLimit = data.timeLimit ?? 180;
        overtimeEnabled = data.overtimeEnabled !== false;
        overtime = false;
        spawnPlayers();
        physics.kickOffReset = true;
        physics.kickOffTeam = 'red';
        inputByPlayer = new Map();
        lastProcessedSeq = new Map(players.map(player => [player.id, 0]));
        paused = false;
        gameState = 'playing';
        goalPauseTicks = 0;
        lastToucher = null;
        previousToucher = null;
        matchStats = {};
        accumulator = 0;
        lastTime = performance.now();
        emitSnapshot({ fullState: true });
        timer = setInterval(() => {
            const now = performance.now();
            accumulator += Math.max(0, now - lastTime);
            lastTime = now;
            // Consume every due step; do not let a delayed timer silently skip
            // host ticks and make guests extrapolate over an unknown gap.
            while (accumulator >= STEP_MS) {
                step();
                accumulator -= STEP_MS;
            }
        }, 4);
        return;
    }
    if (!physics || data.matchEpoch !== matchEpoch) return;
    if (data.type === 'input' && typeof data.playerId === 'string' && Number.isSafeInteger(data.seq)) {
        const current = inputByPlayer.get(data.playerId);
        if (!current || data.seq > current.seq) inputByPlayer.set(data.playerId, {
            seq: data.seq,
            receivedAt: performance.now(),
            input: {
                up: !!data.input?.up, down: !!data.input?.down,
                left: !!data.input?.left, right: !!data.input?.right,
                kick: !!data.input?.kick
            }
        });
    } else if (data.type === 'fullState') {
        emitSnapshot({ fullState: true });
    } else if (data.type === 'pause') {
        paused = !!data.paused;
        if (paused) for (const id of inputByPlayer.keys()) inputByPlayer.set(id, {
            seq: lastProcessedSeq.get(id) || 0,
            receivedAt: performance.now(),
            input: EMPTY_INPUT
        });
        emitSnapshot();
    } else if (data.type === 'addPlayer') {
        applyPlayerUpdate(data.player);
        lastProcessedSeq.set(data.player.id, 0);
        emitSnapshot();
    } else if (data.type === 'updatePlayer') {
        players = data.players || players;
        applyPlayerUpdate(players.find(item => item.id === data.playerId));
        emitSnapshot();
    } else if (data.type === 'teamColors') {
        self.settings.teamColors = data.teamColors || {};
        for (const disc of physics.discs) if (disc.isPlayer) applyPlayerUpdate(players.find(player => player.id === disc.id));
        emitSnapshot();
    } else if (data.type === 'settings') {
        const previousSpeed = self.settings.playerSpeedMultiplier || 1;
        const nextSpeed = data.playerSpeedMultiplier || 1;
        const ratio = nextSpeed / previousSpeed;
        for (const disc of physics.discs) if (disc.isPlayer) {
            disc.acceleration *= ratio;
            disc.kickingAcceleration *= ratio;
        }
        self.settings.playerSpeedMultiplier = nextSpeed;
        physics.ballSpeedMultiplier = data.ballSpeedMultiplier || physics.ballSpeedMultiplier;
    } else if (data.type === 'removePlayer') {
        physics.discs = physics.discs.filter(disc => !disc.isPlayer || disc.id !== data.playerId);
        inputByPlayer.delete(data.playerId);
        lastProcessedSeq.delete(data.playerId);
        players = players.filter(player => player.id !== data.playerId);
        emitSnapshot();
    } else if (data.type === 'rekeyPlayer') {
        const disc = physics.discs.find(item => item.isPlayer && item.id === data.previousId);
        if (disc) { disc.id = data.playerId; disc.ownerId = data.playerId; }
        players = data.players || players;
        inputByPlayer.delete(data.previousId);
        inputByPlayer.set(data.playerId, { seq: 0, receivedAt: performance.now(), input: EMPTY_INPUT });
        lastProcessedSeq.delete(data.previousId);
        lastProcessedSeq.set(data.playerId, 0);
        emitSnapshot({ fullState: true });
    } else if (data.type === 'stop') {
        clearInterval(timer);
        timer = null;
        physics = null;
    }
};
