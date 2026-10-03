/**
 * PeerLink - a direct WebRTC data channel between the room host and a guest.
 *
 * The central server is used only to introduce the two peers and to carry the
 * SDP offer/answer and ICE candidates. Once the channel is open, input,
 * snapshots and chat travel straight between the two browsers, so the latency
 * players feel is the host-to-player distance, not the server's.
 *
 * Negotiation uses the "perfect negotiation" pattern: the peer that knows both
 * ids (the newcomer) creates the offer, the host answers. If the direct
 * connection cannot be established (symmetric NAT, closed UPnP, filtered
 * networks) both sides fall back to relaying the same messages through the
 * signaling socket, so a game is still playable - only with server latency.
 */

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

// How long to wait for a direct data channel before giving up on P2P.
const CONNECT_TIMEOUT = 15000;
// A peer we have not heard from in this long is considered gone.
const PEER_STALE_MS = 10000;

export class PeerLink {
    /**
     * @param {object} opts
     * @param {import('socket.io-client').Socket} opts.socket  signaling socket
     * @param {(msg: object) => void} opts.onMessage  inbound peer messages
     * @param {(state: object) => void} [opts.onState]   connection state changes
     */
    constructor({ socket, onMessage, onState }) {
        this.socket = socket;
        this.onMessage = onMessage || (() => {});
        this.onState = onState || (() => {});

        this.peerId = null;
        this.isInitiator = false;
        this.pc = null;
        this.channel = null;
        this._pendingIce = [];
        this._iceServers = null;

        this.connected = false;
        // True when we could not open a direct channel and are relaying.
        this.relaying = false;

        this._lastRecv = 0;
        this._connectTimer = null;

        this._bindSignaling();
    }

    // ============================================
    // Signaling
    // ============================================

    _bindSignaling() {
        this.socket.on('p2pReady', (data) => this._onReady(data));
        this.socket.on('p2pPeerJoined', (data) => this._onPeerJoined(data));
        this.socket.on('p2pSignal', (data) => this._onSignal(data));
        this.socket.on('p2pPeerReady', (data) => this._onPeerReady(data));
        this.socket.on('p2pRelay', ({ from, payload }) => {
            if (from) this.peerId = from;
            this._lastRecv = Date.now();
            let msg;
            try {
                msg = JSON.parse(payload);
            } catch {
                return;
            }
            this.onMessage(msg);
        });
    }

    /** Ask the host to open a direct channel with us. */
    join(roomId) {
        this.socket.emit('p2pJoin', { roomId });
    }

    _onReady({ initiator, hostId, iceServers, solo }) {
        if (solo) {
            // Nobody else in the room yet: nothing to connect to.
            this._emitState({ status: 'solo' });
            return;
        }
        this.isInitiator = !!initiator;
        this._iceServers = (iceServers && iceServers.length) ? iceServers : DEFAULT_ICE_SERVERS;
        if (hostId) this.peerId = hostId;
        this._emitState({ status: 'negotiating' });
        this._startConnectTimer();
    }

    /** The host hears about a waiting guest and starts answering it. */
    _onPeerJoined({ peerId }) {
        if (this.peerId === peerId) return;
        // The host never offers: it waits for the guest's offer.
        this.peerId = peerId;
        this._emitState({ status: 'negotiating' });
        this._startConnectTimer();
    }

    /** If no direct channel opens in time, keep playing over the relay. */
    _startConnectTimer() {
        clearTimeout(this._connectTimer);
        this._connectTimer = setTimeout(() => {
            if (!this.connected) this._fallbackToRelay('direct connection timed out');
        }, CONNECT_TIMEOUT);
    }

    async _onSignal({ from, type, payload }) {
        this.peerId = from;
        this._lastRecv = Date.now();

        const pc = this._ensureConnection();

        try {
            if (type === 'offer') {
                await pc.setRemoteDescription(payload);
                await this._flushPendingIce();
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this._signal('answer', answer);
            } else if (type === 'answer') {
                await pc.setRemoteDescription(payload);
                await this._flushPendingIce();
            } else if (type === 'ice') {
                // A candidate can arrive before the remote description is set
                if (pc.remoteDescription && pc.remoteDescription.type) {
                    await pc.addIceCandidate(payload);
                } else {
                    this._pendingIce.push(payload);
                }
            }
        } catch (err) {
            console.warn('[PeerLink] signal handling failed:', err?.message || err);
        }
    }

    /** Add ICE candidates that arrived before the remote description was ready. */
    async _flushPendingIce() {
        const queued = this._pendingIce;
        this._pendingIce = [];
        for (const candidate of queued) {
            try {
                await this.pc.addIceCandidate(candidate);
            } catch {
                // A stale candidate is not fatal: the rest still apply
            }
        }
    }

    /** The other side says its channel is open. */
    _onPeerReady({ peerId }) {
        this.peerId = peerId;
        this._lastRecv = Date.now();
    }

    _signal(type, payload) {
        if (!this.peerId) return;
        this.socket.emit('p2pSignal', { to: this.peerId, type, payload });
    }

    // ============================================
    // Peer connection
    // ============================================

    _ensureConnection() {
        if (this.pc) return this.pc;

        const pc = new RTCPeerConnection({ iceServers: this._iceServers || DEFAULT_ICE_SERVERS });
        this.pc = pc;
        this._pendingIce = [];

        pc.onicecandidate = (e) => {
            if (e.candidate) this._signal('ice', e.candidate.toJSON());
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === 'failed' || state === 'closed') {
                this._fallbackToRelay('connection ' + state);
            }
        };

        // The initiator creates the data channel; the answerer receives it.
        if (this.isInitiator) {
            this._attachChannel(pc.createDataChannel('gokball', { ordered: false, maxRetransmits: 0 }));
            this._startNegotiation();
        } else {
            pc.ondatachannel = (e) => this._attachChannel(e.channel);
        }

        return pc;
    }

    async _startNegotiation() {
        const pc = this.pc;
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this._signal('offer', offer);
        } catch (err) {
            console.warn('[PeerLink] could not create an offer:', err?.message || err);
            this._fallbackToRelay('offer failed');
        }
    }

    _attachChannel(channel) {
        this.channel = channel;

        channel.onopen = () => {
            this.connected = true;
            this.relaying = false;
            this._lastRecv = Date.now();
            clearTimeout(this._connectTimer);
            // Let the other side know we can talk directly
            if (this.peerId) this.socket.emit('p2pPeerReady', { to: this.peerId });
            this._emitState({ status: 'connected' });
        };

        channel.onclose = () => this._fallbackToRelay('channel closed');

        channel.onmessage = (e) => {
            this._lastRecv = Date.now();
            let msg;
            try {
                msg = JSON.parse(e.data);
            } catch {
                return;
            }
            this.onMessage(msg);
        };
    }

    /**
     * The direct channel could not be set up. Keep playing by relaying the
     * same messages over the signaling socket instead of dropping the peer.
     */
    _fallbackToRelay(reason) {
        if (this.relaying) return;
        this.relaying = true;
        clearTimeout(this._connectTimer);
        console.warn('[PeerLink] falling back to server relay:', reason);
        this._emitState({ status: 'relay', reason });
    }

    // ============================================
    // Sending
    // ============================================

    /**
     * Send a message to the peer. Uses the direct data channel when it is open
     * and otherwise relays it, so callers never have to care which is active.
     */
    send(msg) {
        const payload = JSON.stringify(msg);

        if (this.connected && this.channel?.readyState === 'open') {
            try {
                this.channel.send(payload);
                return true;
            } catch {
                // fall through to the relay
            }
        }

        // Reverse connection / fallback: the host's traffic reaches the guest
        // through the server when a direct path could not be established.
        if (this.peerId) {
            this.socket.emit('p2pRelay', { to: this.peerId, payload });
        }
        return false;
    }

    /** True when the peer has gone quiet for too long. */
    isStale() {
        return this.peerId !== null && Date.now() - this._lastRecv > PEER_STALE_MS;
    }

    close() {
        clearTimeout(this._connectTimer);
        try { this.channel?.close(); } catch { /* already closed */ }
        try { this.pc?.close(); } catch { /* already closed */ }
        this.channel = null;
        this.pc = null;
        this.connected = false;
        this.peerId = null;
    }

    _emitState(state) {
        this.onState({ peerId: this.peerId, connected: this.connected, relaying: this.relaying, ...state });
    }
}