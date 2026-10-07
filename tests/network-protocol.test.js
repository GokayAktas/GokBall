import test from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK_PROTOCOL_VERSION, encodeProtocolPacket, isProtocolPacket } from '../src/network/Protocol.js';
import { attachSignaling } from '../server/signaling.js';
import { Game } from '../server/Game.js';
import { Room } from '../server/Room.js';

function makeSocket(id) {
    const handlers = new Map();
    const sent = [];
    return {
        id,
        handlers,
        sent,
        data: {},
        volatile: { emit: (event, payload) => sent.push({ event, payload, volatile: true }) },
        emit: (event, payload) => sent.push({ event, payload }),
        on: (event, callback) => handlers.set(event, callback),
        trigger(event, payload) { handlers.get(event)?.(payload); }
    };
}

function makeSignalingHarness(roomFor) {
    const sockets = new Map();
    let connectionHandler;
    const io = {
        sockets: { sockets },
        on(event, callback) { if (event === 'connection') connectionHandler = callback; }
    };
    attachSignaling(io, { getPlayerRoom: (id) => roomFor.get(id) || null });
    const add = (id) => {
        const socket = makeSocket(id);
        sockets.set(id, socket);
        connectionHandler(socket);
        return socket;
    };
    return { add };
}

test('protocol packets require the current explicit version and stay under the wire limit', () => {
    const encoded = encodeProtocolPacket({ type: 'input', seq: 4 });
    assert.equal(isProtocolPacket(JSON.parse(encoded)), true);
    assert.equal(isProtocolPacket({ v: NETWORK_PROTOCOL_VERSION + 1, type: 'input' }), false);
    assert.throws(() => encodeProtocolPacket({ type: 'state', value: 'x'.repeat(70_000) }), RangeError);
});

test('signaling rejects guests signaling to one another and relays only versioned host pairs', () => {
    const room = { id: 'r1', hostId: 'host', players: new Map([['host', {}], ['guest', {}], ['other', {}]]) };
    const memberships = new Map([['host', room], ['guest', room], ['other', room]]);
    const harness = makeSignalingHarness(memberships);
    const host = harness.add('host');
    const guest = harness.add('guest');
    const other = harness.add('other');

    guest.trigger('p2pJoin', { roomId: 'r1', protocolVersion: 1 });
    assert.equal(guest.sent.some(item => item.event === 'p2pReady' && item.payload.protocolVersion === 1), true);
    assert.equal(host.sent.some(item => item.event === 'p2pPeerJoined' && item.payload.peerId === 'guest'), true);

    guest.trigger('p2pRelay', { to: 'other', payload: JSON.stringify({ v: 1, type: 'input', seq: 1 }) });
    assert.equal(other.sent.some(item => item.event === 'p2pRelay'), false);

    guest.trigger('p2pRelay', { to: 'host', payload: JSON.stringify({ v: 1, type: 'input', seq: 1 }) });
    assert.equal(host.sent.some(item => item.event === 'p2pRelay' && item.volatile), true);

    guest.trigger('p2pRelay', { to: 'host', payload: JSON.stringify({ v: 0, type: 'input', seq: 2 }) });
    assert.equal(host.sent.filter(item => item.event === 'p2pRelay').length, 1);

    guest.trigger('p2pSignal', { to: 'other', type: 'offer', payload: { type: 'offer', sdp: 'x' } });
    assert.equal(other.sent.some(item => item.event === 'p2pSignal'), false);
});

test('room Game lifecycle publishes metadata without constructing a physics simulation', () => {
    const broadcasts = [];
    const room = {
        hostId: 'host',
        getRoomData: () => ({ id: 'r1' }),
        broadcast: (event, data) => broadcasts.push({ event, data })
    };
    const game = new Game(room);
    game.setStadium({ name: 'test' });
    game.start();
    assert.equal(game.state, 'playing');
    assert.equal(game.physics, undefined);
    assert.equal(broadcasts[0].event, 'gameStarted');
    assert.equal(broadcasts[0].data.protocolVersion, 1);
    game.stop();
    assert.equal(game.state, 'stopped');
});

test('short room resume keeps the same player role and host identity on the new socket', () => {
    const room = new Room();
    const hostSocket = makeSocket('old-host');
    const guestSocket = makeSocket('guest');
    const hostJoin = room.addPlayer(hostSocket, 'Host');
    const guestJoin = room.addPlayer(guestSocket, 'Guest');
    room.changeTeam('guest', 'red');
    const host = room.players.get('old-host');
    const resumedSocket = makeSocket('new-host');

    const resumed = room.resumePlayer('old-host', resumedSocket);

    assert.equal(resumed.player, host);
    assert.equal(resumed.player.isAdmin, true);
    assert.equal(room.hostId, 'new-host');
    assert.equal(room.creatorId, 'new-host');
    assert.equal(room.players.has('old-host'), false);
    assert.equal(room.players.get('new-host').name, hostJoin.player.name);
    assert.equal(room.players.get('guest').team, 'red');
    assert.equal(guestJoin.player.id, 'guest');
});
