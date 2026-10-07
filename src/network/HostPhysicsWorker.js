import { Physics } from '../engine/Physics.js';
import { NETWORK_PROTOCOL_VERSION } from './Protocol.js';

const STEP_MS = 1000 / 60;
const SNAPSHOT_EVERY_TICKS = 1;

let physics;
let players = [];
let inputByPlayer = new Map();
let lastProcessedSeq = new Map();
let matchEpoch = '';
let tick = 0;
let accumulator = 0;
let lastTime = 0;
let timer = null;
let paused = false;
let goalPauseTicks = 0;

function spawnPlayers() {
    const base = physics.stadium?.playerPhysics || {};
    const multiplier = self.settings?.playerSpeedMultiplier || 1;
    const pp = {
        ...base,
        acceleration: (base.acceleration || 0.1) * multiplier,
        kickingAcceleration: (base.kickingAcceleration || 0.065) * multiplier
    };
    const spawn = (team) => {
        const teamPlayers = players.filter(player => player.team === team);
        const x = (team === 'red' ? -1 : 1) * (physics.stadium?.spawnDistance || 170);
        teamPlayers.forEach((player, index) => {
            const disc = physics.addPlayerDisc(pp, team, x, (index - (teamPlayers.length - 1) / 2) * 40);
            disc.id = player.id;
            disc.ownerId = player.id;
            disc._playerName = player.name || '';
            disc._avatar = player.avatar || '1';
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
        });
    };
    spawn('red');
    spawn('blue');
}

function applyPlayerUpdate(player) {
    if (!player?.id) return;
    players = players.filter(item => item.id !== player.id).concat(player);
    let disc = physics.discs.find(item => item.isPlayer && item.id === player.id);
    if (disc && player.team !== 'red' && player.team !== 'blue') {
        physics.discs.splice(physics.discs.indexOf(disc), 1);
        disc = null;
    } else if (disc && disc.team !== player.team) {
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
        const colors = self.settings?.teamColors?.[player.team];
        if (colors?.colors?.length) {
            disc.color = colors.colors[0];
            disc.colors = colors.colors;
            disc.colorAngle = colors.angle || 0;
            disc.avatarColor = colors.avatarColor || colors.textColor || 'FFFFFF';
        } else {
            disc.color = player.team === 'red' ? 'c70000' : '00008c';
            disc.colors = [disc.color];
            disc.colorAngle = 0;
            disc.avatarColor = 'FFFFFF';
        }
    }
}

function emitSnapshot(extra = {}) {
    self.postMessage({
        v: NETWORK_PROTOCOL_VERSION,
        type: 'snapshot',
        matchEpoch,
        tick,
        lastProcessedSeq: Object.fromEntries(lastProcessedSeq),
        state: physics.getState(),
        lastTouchedBy: physics.ballDisc?.lastTouchedBy || null,
        lastTouchedTeam: physics.ballDisc?.lastTouchedTeam || null,
        paused,
        goalPauseTicks,
        ...extra
    });
}

function step() {
    if (paused) return;
    let kickHappened = false;
    let saveDetected = null;
    if (goalPauseTicks > 0) {
        for (const disc of physics.discs) if (disc.isPlayer) {
            disc.input = { up: false, down: false, left: false, right: false, kick: false };
        }
        physics.step();
        goalPauseTicks--;
        tick++;
        if (goalPauseTicks === 0) {
            physics.kickOffReset = true;
            physics.inGoalPause = false;
            if (physics.ballDisc) {
                physics.ballDisc.pos.x = 0; physics.ballDisc.pos.y = 0;
                physics.ballDisc.speed.x = 0; physics.ballDisc.speed.y = 0;
                physics.ballDisc.color = 'FFB82E';
                physics.ballDisc.lastTouchedBy = null;
                physics.ballDisc.lastTouchedTeam = null;
            }
            physics.resetPositions();
            self.postMessage({ v: NETWORK_PROTOCOL_VERSION, type: 'goalPauseEnded', matchEpoch, tick });
        }
    } else {
        for (const disc of physics.discs) if (disc.isPlayer) {
            const playerId = disc.id;
            const record = inputByPlayer.get(playerId);
            const stale = !record || performance.now() - record.receivedAt > 250;
            disc.input = stale ? { up: false, down: false, left: false, right: false, kick: false } : record.input;
            if (record) lastProcessedSeq.set(playerId, record.seq);
        }
        const result = physics.step();
        kickHappened = !!result.kickHappened;
        saveDetected = result.saveDetected || null;
        tick++;
        if (result.goalTeam) {
            goalPauseTicks = 180;
            physics.kickOffReset = true;
            physics.kickOffTeam = result.goalTeam;
            physics.inGoalPause = true;
            self.postMessage({ v: NETWORK_PROTOCOL_VERSION, type: 'goal', matchEpoch, tick, team: result.goalTeam, lastTouchedBy: physics.ballDisc?.lastTouchedBy || null, lastTouchedTeam: physics.ballDisc?.lastTouchedTeam || null });
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
        tick = data.tick || 0;
        players = data.players || [];
        self.settings = data;
        spawnPlayers();
        physics.setKickOffTeam('red');
        inputByPlayer.clear();
        lastProcessedSeq.clear();
        paused = false;
        goalPauseTicks = 0;
        accumulator = 0;
        lastTime = performance.now();
        emitSnapshot({ fullState: true });
        timer = setInterval(() => {
            const now = performance.now();
            accumulator += Math.max(0, now - lastTime);
            lastTime = now;
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
    } else if (data.type === 'pause') {
        paused = !!data.paused;
        if (paused) for (const id of inputByPlayer.keys()) inputByPlayer.set(id, { seq: lastProcessedSeq.get(id) || 0, input: {} });
        emitSnapshot();
    } else if (data.type === 'addPlayer') {
        applyPlayerUpdate(data.player);
        emitSnapshot();
    } else if (data.type === 'updatePlayer') {
        players = data.players || players;
        const player = players.find(item => item.id === data.playerId);
        applyPlayerUpdate(player);
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
        emitSnapshot();
    } else if (data.type === 'rekeyPlayer') {
        const disc = physics.discs.find(item => item.isPlayer && item.id === data.previousId);
        if (disc) { disc.id = data.playerId; disc.ownerId = data.playerId; }
        players = data.players || players;
        const oldInput = inputByPlayer.get(data.previousId);
        inputByPlayer.delete(data.previousId);
        inputByPlayer.set(data.playerId, { seq: 0, input: oldInput?.input || {} });
        lastProcessedSeq.delete(data.previousId);
        lastProcessedSeq.set(data.playerId, 0);
        emitSnapshot({ fullState: true });
    } else if (data.type === 'stop') {
        clearInterval(timer);
        timer = null;
        physics = null;
    }
};
