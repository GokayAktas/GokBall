/**
 * WebRTC signaling - the ONLY thing the central server does for a match.
 *
 * The server never relays game traffic and never runs physics. It only helps
 * two browsers find each other so they can open a direct peer connection:
 *
 *   guest -> server: p2pJoin { roomId }
 *   server -> host : p2pPeerJoined { peerId, name }
 *   guest -> host : p2pSignal { to, type, payload }   (offer/answer/ICE)
 *   host  -> guest : p2pSignal { to, type, payload }
 *   server -> guest: p2pReady { initiator: true|false }
 *
 * Once the data channel is open, everything else (input, snapshots, chat,
 * physics) travels directly between the host and the guest.
 */

/** Public STUN servers used to discover the host's public address. */
const ICE_SERVERS = (process.env.ICE_SERVERS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(url => ({ urls: url }));

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
        socket.on('p2pJoin', ({ roomId } = {}) => {
            const room = ctx.getPlayerRoom(socket.id);
            // Only a real member of that room may ask to be meshed into it
            if (!room || room.id !== roomId) {
                socket.emit('p2pError', { error: 'Oda bulunamadı' });
                return;
            }

            const hostSocket = io.sockets.sockets.get(room.hostId);
            if (!hostSocket || room.hostId === socket.id) {
                // Nobody to connect to: a solo host does not need a peer link
                socket.emit('p2pReady', { initiator: false, solo: true });
                return;
            }

            // Tell the guest it must create the offer (it is the newcomer, so
            // it knows the host's id before the host knows the guest's).
            socket.emit('p2pReady', {
                initiator: true,
                hostId: room.hostId,
                iceServers: ICE_SERVERS
            });

            // Tell the host a peer is waiting so it can answer later
            hostSocket.emit('p2pPeerJoined', {
                peerId: socket.id,
                name: room.players.get(socket.id)?.name || 'Oyuncu'
            });
        });

        // --- Relay offer / answer / ICE between two peers ---
        // The server forwards the payload untouched and never inspects it.
        socket.on('p2pSignal', ({ to, type, payload } = {}) => {
            if (!to || typeof payload === 'undefined') return;

            // Only relay inside the same room, so a peer cannot use the
            // signaling server to reach arbitrary connected users.
            const senderRoom = ctx.getPlayerRoom(socket.id);
            const targetRoom = ctx.getPlayerRoom(to);
            if (!senderRoom || !targetRoom || senderRoom.id !== targetRoom.id) return;

            const target = io.sockets.sockets.get(to);
            if (!target) return;

            target.emit('p2pSignal', { from: socket.id, type, payload });
        });

        // --- Either side reports the direct channel is usable ---
        socket.on('p2pPeerReady', ({ to } = {}) => {
            const target = to && io.sockets.sockets.get(to);
            if (target) target.emit('p2pPeerReady', { peerId: socket.id });
        });

        // --- Reverse connection / relay fallback ---
        // When a direct channel cannot be opened (symmetric NAT, UPnP disabled,
        // a filtering safe-browsing profile), the same messages are relayed
        // here instead. Gameplay keeps working; only the latency is the server's.
        socket.on('p2pRelay', ({ to, payload } = {}) => {
            if (!to || typeof payload === 'undefined') return;

            const senderRoom = ctx.getPlayerRoom(socket.id);
            const targetRoom = ctx.getPlayerRoom(to);
            if (!senderRoom || !targetRoom || senderRoom.id !== targetRoom.id) return;

            const target = io.sockets.sockets.get(to);
            if (target) target.emit('p2pRelay', { from: socket.id, payload });
        });
    });
}