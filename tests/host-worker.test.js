import test from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK_PROTOCOL_VERSION } from '../src/network/Protocol.js';

test('host worker owns ticks and emits fresh full-state sequences while paused', async (t) => {
    const messages = [];
    globalThis.self = {
        settings: {},
        postMessage(message) { messages.push(message); }
    };
    await import('../src/network/HostPhysicsWorker.js?node-test');
    const send = (data) => globalThis.self.onmessage({ data: { v: NETWORK_PROTOCOL_VERSION, matchEpoch: 'test-match', ...data } });
    const stadium = {
        name: 'test', width: 420, height: 200, spawnDistance: 170,
        vertexes: [], segments: [], planes: [], goals: [],
        discs: [{ pos: [0, 0], radius: 10, invMass: 1, bCoef: 0.5, damping: 0.99 }],
        playerPhysics: { radius: 15, invMass: 0.5, acceleration: 0.1, kickingAcceleration: 0.065 }
    };
    t.after(() => {
        send({ type: 'stop' });
        delete globalThis.self;
    });

    send({
        type: 'init', stadium, matchEpoch: 'test-match',
        players: [{ id: 'host', name: 'Host', team: 'red' }, { id: 'guest', name: 'Guest', team: 'blue' }],
        scoreLimit: 3, timeLimit: 180
    });
    const initial = messages.at(-1);
    assert.equal(initial.type, 'snapshot');
    assert.equal(initial.state.fullState, true);
    assert.equal(initial.state.protocolVersion, NETWORK_PROTOCOL_VERSION);
    assert.equal(initial.state.snapshotSeq, 1);
    assert.equal(initial.state.physicsTick, 0);
    assert.deepEqual(initial.state.lastProcessedSeq, { host: 0, guest: 0 });
    send({ type: 'input', playerId: 'guest', seq: 2, input: { right: true } });
    send({ type: 'input', playerId: 'guest', seq: 1, input: { left: true } });

    await new Promise(resolve => setTimeout(resolve, 70));
    const advanced = messages.at(-1);
    assert.ok(advanced.tick > 0);
    assert.ok(advanced.state.snapshotSeq > initial.state.snapshotSeq);
    assert.equal(advanced.state.lastProcessedSeq.guest, 2);

    send({ type: 'pause', paused: true });
    const paused = messages.at(-1).state;
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(messages.at(-1).state.physicsTick, paused.physicsTick);
    assert.equal(messages.at(-1).state.paused, true);

    send({ type: 'fullState' });
    const resync = messages.at(-1).state;
    assert.equal(resync.fullState, true);
    assert.equal(resync.physicsTick, paused.physicsTick);
    assert.ok(resync.snapshotSeq > paused.snapshotSeq);
});
