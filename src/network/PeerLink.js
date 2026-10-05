/**
 * One direct WebRTC data channel between a room guest and the room host.
 * Socket.IO carries signaling and volatile relay traffic only when the direct
 * channel is unavailable. Gameplay snapshots are intentionally not queued.
 */

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const CONNECT_TIMEOUT = 15000;
const MAX_BUFFERED_SNAPSHOT_BYTES = 32 * 1024;

export class PeerLink {
    constructor({ socket, peerId = null, onMessage, onState }) {
        this.socket = socket;
        this.peerId = peerId;
        this.onMessage = onMessage || (() => {});
        this.onState = onState || (() => {});

        this.isInitiator = false;
        this.pc = null;
        this.channel = null;
        this._pendingIce = [];
        this._iceServers = DEFAULT_ICE_SERVERS;
        this._connectTimer = null;
        this._closed = false;

        this.connected = false;
        this.relaying = false;
    }

    /** The guest creates the offer after p2pReady identifies its host. */
    initiate(peerId, iceServers) {
        this.peerId = peerId;
        this.isInitiator = true;
        if (iceServers?.length) this._iceServers = iceServers;
        this._emitState({ status: 'negotiating' });
        this._startConnectTimer();
        try {
            this._ensureConnection();
        } catch (err) {
            this._fallbackToRelay(err?.message || 'WebRTC is unavailable');
        }
    }

    /** The host waits for the guest's offer. */
    acceptPeer(peerId, iceServers) {
        this.peerId = peerId;
        this.isInitiator = false;
        if (iceServers?.length) this._iceServers = iceServers;
        this._emitState({ status: 'negotiating' });
        this._startConnectTimer();
    }

    async receiveSignal({ from, type, payload } = {}) {
        if (this._closed || !from || !type) return;
        if (this.peerId && from !== this.peerId) return;
        this.peerId = from;

        let pc;
        try {
            pc = this._ensureConnection();
        } catch (err) {
            this._fallbackToRelay(err?.message || 'WebRTC is unavailable');
            return;
        }

        try {
            if (type === 'offer') {
                await pc.setRemoteDescription(payload);
                await this._flushPendingIce();
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this._signal('answer', pc.localDescription);
            } else if (type === 'answer') {
                await pc.setRemoteDescription(payload);
                await this._flushPendingIce();
            } else if (type === 'ice') {
                if (pc.remoteDescription?.type) {
                    await pc.addIceCandidate(payload);
                } else {
                    this._pendingIce.push(payload);
                }
            }
        } catch (err) {
            console.warn('[PeerLink] signal handling failed:', err?.message || err);
            if (type === 'offer' || type === 'answer') this._fallbackToRelay('negotiation failed');
        }
    }

    receiveRelay({ from, payload } = {}) {
        if (this._closed || !from || (this.peerId && from !== this.peerId)) return;
        this.peerId = from;

        let msg;
        try {
            msg = JSON.parse(payload);
        } catch {
            return;
        }
        this.onMessage(msg);
    }

    _startConnectTimer() {
        clearTimeout(this._connectTimer);
        this._connectTimer = setTimeout(() => {
            if (!this.connected) this._fallbackToRelay('direct connection timed out');
        }, CONNECT_TIMEOUT);
    }

    async _flushPendingIce() {
        const queued = this._pendingIce;
        this._pendingIce = [];
        for (const candidate of queued) {
            try {
                await this.pc?.addIceCandidate(candidate);
            } catch {
                // A stale candidate does not invalidate the other candidates.
            }
        }
    }

    _signal(type, payload) {
        if (!this.peerId || !this.socket?.connected) return;
        this.socket.emit('p2pSignal', { to: this.peerId, type, payload });
    }

    _ensureConnection() {
        if (this.pc) return this.pc;
        if (typeof RTCPeerConnection === 'undefined') {
            throw new Error('WebRTC is unavailable in this browser');
        }

        const pc = new RTCPeerConnection({ iceServers: this._iceServers });
        this.pc = pc;
        this._pendingIce = [];

        pc.onicecandidate = (event) => {
            if (event.candidate) this._signal('ice', event.candidate.toJSON());
        };
        pc.onconnectionstatechange = () => {
            if (this._closed) return;
            if (pc.connectionState === 'connected' && this.channel?.readyState === 'open') {
                this._markConnected();
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this._fallbackToRelay(`connection ${pc.connectionState}`);
            }
        };

        if (this.isInitiator) {
            const channel = pc.createDataChannel('gokball', {
                ordered: false,
                maxRetransmits: 0
            });
            this._attachChannel(channel);
            this._startNegotiation();
        } else {
            pc.ondatachannel = (event) => this._attachChannel(event.channel);
        }

        return pc;
    }

    async _startNegotiation() {
        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            this._signal('offer', this.pc.localDescription);
        } catch (err) {
            console.warn('[PeerLink] could not create an offer:', err?.message || err);
            this._fallbackToRelay('offer failed');
        }
    }

    _attachChannel(channel) {
        if (this._closed) {
            channel.close();
            return;
        }
        this.channel = channel;
        channel.onopen = () => {
            if (this._closed) return;
            this._markConnected();
        };
        channel.onclose = () => {
            if (!this._closed) this._fallbackToRelay('channel closed');
        };
        channel.onerror = () => {
            if (!this._closed) this._fallbackToRelay('channel error');
        };
        channel.onmessage = (event) => {
            if (this._closed) return;
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }
            this.onMessage(msg);
        };
    }

    _fallbackToRelay(reason) {
        if (this._closed || this.relaying) return;
        this.relaying = true;
        clearTimeout(this._connectTimer);
        console.warn('[PeerLink] using server relay:', reason);
        this._emitState({ status: 'relay', reason });
    }

    _markConnected() {
        this.connected = true;
        this.relaying = false;
        clearTimeout(this._connectTimer);
        this._emitState({ status: 'connected' });
    }

    /**
     * Send real-time traffic without building a queue of stale positions.
     * Inputs may use the relay while negotiating; congested direct snapshot
     * queues drop the current snapshot and wait for the next one.
     */
    send(msg) {
        return this.sendSerialized(JSON.stringify(msg), msg?.type === 'state');
    }

    sendSerialized(payload, isSnapshot = false) {
        if (this._closed || !this.peerId) return false;

        if (this.connected && !this.relaying && this.channel?.readyState === 'open' &&
            this.pc?.connectionState !== 'failed' && this.pc?.connectionState !== 'closed') {
            if (isSnapshot && this.channel.bufferedAmount > MAX_BUFFERED_SNAPSHOT_BYTES) {
                return true;
            }
            try {
                this.channel.send(payload);
                return true;
            } catch {
                this._fallbackToRelay('data channel send failed');
            }
        }

        if (this.socket?.connected) {
            this.socket.volatile.emit('p2pRelay', {
                to: this.peerId,
                payload
            });
            return true;
        }
        return false;
    }

    close() {
        this._closed = true;
        clearTimeout(this._connectTimer);
        if (this.channel) {
            this.channel.onopen = null;
            this.channel.onclose = null;
            this.channel.onerror = null;
            this.channel.onmessage = null;
            try { this.channel.close(); } catch { /* already closed */ }
        }
        try { this.pc?.close(); } catch { /* already closed */ }
        this.channel = null;
        this.pc = null;
        this.connected = false;
        this.peerId = null;
    }

    _emitState(state) {
        this.onState({
            peerId: this.peerId,
            connected: this.connected,
            relaying: this.relaying,
            ...state
        });
    }
}
