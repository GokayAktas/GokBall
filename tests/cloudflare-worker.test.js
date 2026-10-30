import test from 'node:test';
import assert from 'node:assert/strict';
import { GameServerDurableObject } from '../cloudflare/worker.js';

function createSocket(id, ip = '127.0.0.1') {
    const socket = {
        id,
        connected: true,
        handshake: { address: ip },
        data: { net: { seq: 0, pending: new Map(), lost: 0 } },
        events: [],
        emit(event, data) {
            this.events.push({ event, data });
        },
        disconnect() {
            this.connected = false;
        }
    };
    socket.volatile = { emit: socket.emit.bind(socket) };
    return socket;
}

function emitted(socket, event) {
    return socket.events.filter(item => item.event === event).map(item => item.data);
}

test('Cloudflare room lifecycle and WebRTC signaling preserve room membership checks', async (t) => {
    const server = new GameServerDurableObject({}, {});
    t.after(() => clearInterval(server.timer));

    const host = createSocket('host');
    const guest = createSocket('guest', '127.0.0.2');
    server.sockets.set(host.id, host);
    server.sockets.set(guest.id, guest);

    await server._handleEvent(host, 'createRoom', { name: 'Cloudflare test', playerName: 'Host' });
    const created = emitted(host, 'roomCreated')[0];
    assert.ok(created?.roomId);
    assert.equal(created.player.isAdmin, true);

    await server._handleEvent(guest, 'joinRoom', {
        roomId: created.roomId,
        playerName: 'Guest'
    });
    assert.equal(emitted(guest, 'roomJoined').length, 1);
    assert.equal(emitted(host, 'playerJoined').length, 1);

    await server._handleEvent(guest, 'p2pJoin', {
        roomId: created.roomId,
        protocolVersion: 2
    });
    assert.equal(emitted(guest, 'p2pReady')[0]?.initiator, true);
    assert.equal(emitted(host, 'p2pPeerJoined')[0]?.peerId, guest.id);

    await server._handleEvent(guest, 'p2pSignal', {
        to: host.id,
        type: 'offer',
        payload: { type: 'offer', sdp: 'test-offer' },
        protocolVersion: 2
    });
    assert.equal(emitted(host, 'p2pSignal')[0]?.from, guest.id);

    await server._handleEvent(guest, 'p2pSignal', {
        to: 'not-a-room-member',
        type: 'offer',
        payload: { type: 'offer', sdp: 'test-offer' },
        protocolVersion: 2
    });
    assert.equal(emitted(host, 'p2pSignal').length, 1);
});

test('Cloudflare resume tickets restore the original player and host roles', async (t) => {
    const server = new GameServerDurableObject({}, {});
    t.after(() => {
        clearInterval(server.timer);
        for (const ticket of server.resumeTickets.values()) clearTimeout(ticket.timer);
    });

    const host = createSocket('resume-host');
    server.sockets.set(host.id, host);
    await server._handleEvent(host, 'createRoom', { name: 'Resume test', playerName: 'Host' });
    const created = emitted(host, 'roomCreated')[0];

    server._onDisconnect(host);
    const resumedSocket = createSocket('resumed-host');
    server.sockets.set(resumedSocket.id, resumedSocket);
    await server._handleEvent(resumedSocket, 'resumeRoom', {
        roomId: created.roomId,
        token: created.resumeToken
    });

    const resumed = emitted(resumedSocket, 'roomResumed')[0];
    assert.equal(resumed.playerId, resumedSocket.id);
    assert.equal(resumed.creatorId, resumedSocket.id);
    assert.equal(server.rooms.get(created.roomId).hostId, resumedSocket.id);
});
