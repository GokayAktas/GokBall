import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStepClock } from '../src/network/FixedStepClock.js';
import { InputHistory } from '../src/network/InputHistory.js';
import { SnapshotBuffer } from '../src/network/SnapshotBuffer.js';
import { isValidFullGameState } from '../src/network/AuthorityProtocol.js';

test('fixed clock runs all due 60 Hz simulation steps without dropping elapsed time', () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    let count = 0;
    assert.equal(clock.advance(1000, () => count++), 60);
    assert.equal(count, 60);
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

test('snapshot buffer extrapolates briefly during packet loss and clamps the prediction', () => {
    const buffer = new SnapshotBuffer(50);
    const state = {
        matchEpoch: 'match-a', snapshotSeq: 1, tick: 1, physicsTick: 1,
        physics: { discs: [{ isPlayer: true, id: 'player', x: 0, y: 0, sx: 2, sy: 0 }] }
    };
    buffer.addSnapshot(0, state);
    const extrapolated = buffer.getInterpolatedState(1000).physics.discs[0];
    assert.ok(Math.abs(extrapolated.x - 30) < 1e-9); // 250 ms / 60 Hz * 2 units per tick
});

test('snapshot buffer starts with a low two-tick render delay', () => {
    assert.ok(new SnapshotBuffer().getDelay() <= 1000 / 30 + 1e-9);
});

test('full state validation requires match identity, tick, scores and finite disc physics', () => {
    const valid = {
        fullState: true, matchEpoch: 'match-a', snapshotSeq: 10, physicsTick: 9,
        scoreRed: 1, scoreBlue: 0, time: 12, scoreLimit: 3, timeLimit: 180,
        physics: { discs: [{ x: 1, y: 2, sx: 0, sy: 0 }] }
    };
    assert.equal(isValidFullGameState(valid), true);
    assert.equal(isValidFullGameState({ ...valid, matchEpoch: undefined }), false);
    assert.equal(isValidFullGameState({ ...valid, physics: { discs: [{ x: NaN, y: 2, sx: 0, sy: 0 }] } }), false);
});
