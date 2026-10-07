import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStepClock } from '../src/network/FixedStepClock.js';
import { InputHistory } from '../src/network/InputHistory.js';
import { SnapshotBuffer } from '../src/network/SnapshotBuffer.js';
import { isValidFullGameState } from '../src/network/AuthorityProtocol.js';
import { limitRenderPosition } from '../src/network/RenderSmoothing.js';
import { pingLevel } from '../src/ui/components/PingBadge.js';
import { JERSEY_PRESETS, pickRandomJersey } from '../src/ui/screens/JerseyPresets.js';
import { Room } from '../server/Room.js';
import { NETWORK_PROTOCOL_VERSION } from '../src/network/Protocol.js';

test('fixed clock runs all due 60 Hz simulation steps without dropping elapsed time', () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    let count = 0;
    const batchSizes = new Set();
    assert.equal(clock.advance(1000, (stepIndex, dueSteps) => {
        count++;
        assert.equal(stepIndex, count - 1);
        batchSizes.add(dueSteps);
    }), 60);
    assert.equal(count, 60);
    assert.deepEqual([...batchSizes], [60]);
});

test('input ACK removes confirmed inputs and leaves only replayable inputs', () => {
    const history = new InputHistory();
    history.push(1, { left: true });
    history.push(2, { right: true });
    history.push(3, { kick: true });
    history.acknowledge(2);
    assert.deepEqual(history.unconfirmed(), [{ seq: 3, input: { kick: true } }]);
    history.push(2, { up: true });
    assert.deepEqual(history.unconfirmed().map((entry) => entry.seq), [3]);
});

test('snapshot buffer rejects duplicate and reordered packets while continuing after gaps', () => {
    const buffer = new SnapshotBuffer(50);
    const snapshot = (seq, tick, x) => ({
        matchEpoch: 'match-a', snapshotSeq: seq, tick: tick, physicsTick: tick,
        physics: { discs: [{ id: 'player', isPlayer: true, x, y: 0, sx: 1, sy: 0 }] }
    });
    assert.equal(buffer.addSnapshot(0, snapshot(1, 1, 0)), true);
    assert.equal(buffer.addSnapshot(16, snapshot(3, 3, 2)), true);
    assert.equal(buffer.addSnapshot(17, snapshot(2, 2, 1)), false);
    assert.equal(buffer.addSnapshot(80, snapshot(6, 6, 5)), true);
    assert.equal(buffer.getSize(), 3);
    assert.equal(buffer.getInterpolatedState(110).physics.discs[0].x >= 2, true);
});

test('snapshot buffer rejects states from a different match epoch', () => {
    const buffer = new SnapshotBuffer();
    const snapshot = (matchEpoch, seq) => ({
        matchEpoch, snapshotSeq: seq, tick: seq, physicsTick: seq,
        physics: { discs: [{ id: 'player', isPlayer: true, x: seq, y: 0, sx: 0, sy: 0 }] }
    });
    assert.equal(buffer.addSnapshot(0, snapshot('epoch-a', 1)), true);
    assert.equal(buffer.addSnapshot(20, snapshot('epoch-b', 2)), false);
    assert.equal(buffer.getSize(), 1);
});

test('snapshot buffer only extrapolates a few ticks during packet loss', () => {
    const buffer = new SnapshotBuffer(50);
    const state = {
        matchEpoch: 'match-a', snapshotSeq: 1, tick: 1, physicsTick: 1,
        physics: { discs: [{ isPlayer: true, id: 'player', x: 0, y: 0, sx: 2, sy: 0 }] }
    };
    buffer.addSnapshot(0, state);
    const extrapolated = buffer.getInterpolatedState(1000).physics.discs[0];
    assert.ok(Math.abs(extrapolated.x - 6) < 1e-9); // 50 ms / 60 Hz * 2 units per tick
});

test('snapshot buffer starts with a low two-tick render delay', () => {
    assert.ok(new SnapshotBuffer().getDelay() <= 1000 / 30 + 1e-9);
});

test('local rendering bounds large network corrections without changing small steps', () => {
    assert.deepEqual(limitRenderPosition({ x: 0, y: 0 }, { x: 6, y: 8 }, 5), { x: 3, y: 4 });
    assert.deepEqual(limitRenderPosition({ x: 1, y: -1 }, { x: 2, y: 3 }, 5), { x: 2, y: 3 });
    assert.deepEqual(limitRenderPosition(null, { x: 6, y: 8 }, 1), { x: 6, y: 8 });
});

test('full state validation requires match identity, tick, scores and finite disc physics', () => {
    const valid = {
        protocolVersion: NETWORK_PROTOCOL_VERSION, fullState: true, state: 'playing', matchEpoch: 'match-a', snapshotSeq: 10, tick: 9, physicsTick: 9,
        paused: false, lastProcessedSeq: { player: 3 },
        scoreRed: 1, scoreBlue: 0, time: 12, scoreLimit: 3, timeLimit: 180,
        physics: { discs: [{ x: 1, y: 2, sx: 0, sy: 0 }] }
    };
    assert.equal(isValidFullGameState(valid), true);
    assert.equal(isValidFullGameState({ ...valid, matchEpoch: undefined }), false);
    assert.equal(isValidFullGameState({ ...valid, protocolVersion: NETWORK_PROTOCOL_VERSION - 1 }), false);
    assert.equal(isValidFullGameState({ ...valid, lastProcessedSeq: { player: -1 } }), false);
    assert.equal(isValidFullGameState({ ...valid, physics: { discs: [{ x: NaN, y: 2, sx: 0, sy: 0 }] } }), false);
});

test('remote players cannot switch teams while a match is active', () => {
    const room = new Room();
    const messages = [];
    const player = {
        id: 'guest-1',
        isAdmin: false,
        team: 'red',
        socket: { emit: (event, payload) => messages.push({ event, payload }) }
    };
    room.players.set(player.id, player);
    room.game.state = 'playing';

    room.changeTeam(player.id, 'blue');

    assert.equal(player.team, 'red');
    assert.equal(messages[0]?.event, 'roomError');
});

test('random jersey is the first choice and rerolls do not repeat the previous kit', () => {
    assert.equal(JERSEY_PRESETS[0].name, 'Rastgele');
    assert.equal(JERSEY_PRESETS[0].flag, null);
    for (let i = 0; i < 20; i++) {
        assert.notEqual(pickRandomJersey('galatasaray').id, 'galatasaray');
    }
});

test('ping badges use quality colors based on the measured value', () => {
    assert.equal(pingLevel(45), 'good');
    assert.equal(pingLevel(130), 'fair');
    assert.equal(pingLevel(240), 'bad');
    assert.equal(pingLevel(null), 'unknown');
});
