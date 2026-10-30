export class CloudflareSocketClient {
    constructor(url, { reconnectionDelay = 1000 } = {}) {
        this.url = url;
        this.reconnectionDelay = reconnectionDelay;
        this.id = null;
        this.connected = false;
        this.handlers = new Map();
        this.closedByUser = false;
        this.reconnectTimer = null;
        this.volatile = { emit: (event, data) => this.emit(event, data, true) };
        this._connect();
    }

    on(event, handler) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event).add(handler);
        return this;
    }

    emit(event, data, volatile = false) {
        if (this.ws?.readyState !== WebSocket.OPEN) return false;
        if (volatile && this.ws.bufferedAmount > 64 * 1024) return false;
        try {
            this.ws.send(JSON.stringify([event, data]));
            return true;
        } catch (error) {
            console.warn('[Network] Could not send WebSocket event:', error);
            return false;
        }
    }

    disconnect() {
        this.closedByUser = true;
        clearTimeout(this.reconnectTimer);
        this.ws?.close(1000, 'Client disconnect');
    }

    _connect() {
        if (this.closedByUser) return;
        const wsUrl = new URL('/ws', this.url);
        wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(wsUrl);
        this.ws = ws;

        ws.addEventListener('open', () => {
            this.connected = true;
        });
        ws.addEventListener('message', (message) => {
            let packet;
            try {
                packet = JSON.parse(message.data);
            } catch {
                return;
            }
            if (!Array.isArray(packet) || typeof packet[0] !== 'string') return;
            const [event, data] = packet;
            if (event === 'connect') {
                this.id = data?.id || null;
                this.connected = true;
            }
            this._dispatch(event, data);
        });
        ws.addEventListener('error', () => {
            if (!this.connected) this._dispatch('connect_error', new Error('WebSocket connection failed'));
        });
        ws.addEventListener('close', (event) => {
            const wasConnected = this.connected;
            this.connected = false;
            this.id = null;
            if (wasConnected) this._dispatch('disconnect', event.reason || 'transport close');
            if (!this.closedByUser) {
                this.reconnectTimer = setTimeout(() => this._connect(), this.reconnectionDelay);
            }
        });
    }

    _dispatch(event, data) {
        for (const handler of this.handlers.get(event) || []) {
            try {
                handler(data);
            } catch (error) {
                console.error(`[Network] WebSocket '${event}' handler failed:`, error);
            }
        }
    }
}
