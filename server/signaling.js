import { isProtocolPacket } from '../src/network/Protocol.js';

/**
 * WebRTC signaling and real-time relay fallback for a match.
 *
 * The server runs no match physics. It helps browsers find each other and
 * relays gameplay only while a direct peer channel is unavailable:
 *
 *   guest -> server: p2pJoin { roomId }
 *   server -> host : p2pPeerJoined { peerId, name }
 *   guest -> host : p2pSignal { to, type, payload }   (offer/answer/ICE)
 *   host  -> guest : p2pSignal { to, type, payload }
 *   server -> guest: p2pReady { initiator: true|false }
 *
 * Once the data channel is open, inputs and physics snapshots travel directly
 * between the host and guests. The relay remains available as a fallback.
 */

/** Public STUN servers used to discover the host's public address. */
const ICE_SERVERS = (process.env.ICE_SERVERS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(url => ({ urls: url }));
const TURN_URLS = (process.env.TURN_URLS || '').split(',').map(url => url.trim()).filter(Boolean);
if (TURN_URLS.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    ICE_SERVERS.push({
        urls: TURN_URLS,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
    });
}
const MAX_SIGNAL_BYTES = 64 * 1024;
const MAX_RELAY_BYTES = 64 * 1024;
const NETWORK_PROTOCOL_VERSION = 2;

function packetSize(value) {
    try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { return Infinity; }
}
function isPeerPair(room, firstId, secondId) {
    return !!room && room.players.has(firstId) && room.players.has(secondId) &&
        (firstId === room.hostId || secondId === room.hostId);
}

export function getIceServers() {
    return ICE_SERVERS;
}

/**
 * Register the signaling handlers on a socket.
 *
 * @param {import('socket.io').Server} io
 * @param {object} ctx  { getPlayerRoom }
 */
export function attachSignaling(io, ctx) {
    io.on('connection', (socket) => {
        // --- Ask to be connected to the room host ---
        socket.on('p2pJoin', (data = {}) => {
            const { roomId, protocolVersion } = data || {};
            if (protocolVersion !== NETWORK_PROTOCOL_VERSION) {
                socket.emit('p2pError', { error: 'Uyumsuz ağ protokolü', expected: NETWORK_PROTOCOL_VERSION, received: protocolVersion });
                return;
            }
            const room = ctx.getPlayerRoom(socket.id);
            // Only a real member of that room may ask to be meshed into it
            if (!room || room.id !== roomId) {
                socket.emit('p2pError', { error: 'Oda bulunamadı' });
                return;
            }

            const hostSocket = io.sockets.sockets.get(room.hostId);
            if (!hostSocket || room.hostId === socket.id) {
                // Nobody to connect to: a solo host does not need a peer link
                socket.emit('p2pReady', { initiator: false, solo: true, protocolVersion: NETWORK_PROTOCOL_VERSION });
                return;
            }

            // Tell the guest it must create the offer (it is the newcomer, so
            // it knows the host's id before the host knows the guest's).
            socket.emit('p2pReady', {
                initiator: true,
                hostId: room.hostId,
                iceServers: ICE_SERVERS,
                protocolVersion: NETWORK_PROTOCOL_VERSION
            });

            // Tell the host a peer is waiting so it can answer later
            hostSocket.emit('p2pPeerJoined', {
                peerId: socket.id,
                name: room.players.get(socket.id)?.name || 'Oyuncu',
                iceServers: ICE_SERVERS,
                protocolVersion: NETWORK_PROTOCOL_VERSION
            });
        });

        // --- Relay offer / answer / ICE between two peers ---
        // The server forwards the payload untouched and never inspects it.
        socket.on('p2pSignal', (data = {}) => {
            const { to, type, payload, protocolVersion } = data || {};
            if (protocolVersion !== NETWORK_PROTOCOL_VERSION) {
                socket.emit('p2pError', { error: 'Uyumsuz ağ protokolü', expected: NETWORK_PROTOCOL_VERSION, received: protocolVersion });
                return;
            }
            if (!to || !['offer', 'answer', 'ice'].includes(type) || typeof payload === 'undefined' || packetSize(payload) > MAX_SIGNAL_BYTES) return;

            // Only relay inside the same room, so a peer cannot use the
            // signaling server to reach arbitrary connected users.
            const senderRoom = ctx.getPlayerRoom(socket.id);
            const targetRoom = ctx.getPlayerRoom(to);
            if (!senderRoom || !targetRoom || senderRoom.id !== targetRoom.id || !isPeerPair(senderRoom, socket.id, to)) return;

            const target = io.sockets.sockets.get(to);
            if (!target) return;

            target.emit('p2pSignal', { from: socket.id, protocolVersion: NETWORK_PROTOCOL_VERSION, type, payload });
        });

        // --- Either side reports the direct channel is usable ---
        socket.on('p2pPeerReady', (data = {}) => {
            const { to } = data || {};
            const room = ctx.getPlayerRoom(socket.id);
            if (!isPeerPair(room, socket.id, to)) return;
            const target = to && io.sockets.sockets.get(to);
            if (target) target.emit('p2pPeerReady', { peerId: socket.id, protocolVersion: NETWORK_PROTOCOL_VERSION });
        });

        // --- Reverse connection / relay fallback ---
        // When a direct channel cannot be opened (symmetric NAT, UPnP disabled,
        // a filtering safe-browsing profile), the same messages are relayed
        // here instead. Gameplay keeps working; only the latency is the server's.
        socket.on('p2pRelay', (data = {}) => {
            const { to, payload } = data || {};
            if (!to || typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > MAX_RELAY_BYTES) return;
            let packet;
            try { packet = JSON.parse(payload); } catch { return; }
            if (!isProtocolPacket(packet)) return;

            const senderRoom = ctx.getPlayerRoom(socket.id);
            const targetRoom = ctx.getPlayerRoom(to);
            if (!senderRoom || !targetRoom || senderRoom.id !== targetRoom.id || !isPeerPair(senderRoom, socket.id, to)) return;

            const target = io.sockets.sockets.get(to);
            // Input and snapshots are replaceable real-time state. Dropping an
            // old relay is better than queueing it behind newer game frames.
            if (target) target.volatile.emit('p2pRelay', { from: socket.id, payload });
        });
    });
}
