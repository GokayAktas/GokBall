// Version 2 requires explicit epoch/tick/sequence metadata for gameplay.
export const NETWORK_PROTOCOL_VERSION = 2;
export const MAX_NETWORK_PACKET_BYTES = 64 * 1024;

export function isProtocolPacket(packet) {
    if (!packet || packet.v !== NETWORK_PROTOCOL_VERSION || typeof packet.type !== 'string' || packet.type.length > 32) return false;
    if (packet.type === 'input') {
        return typeof packet.epoch === 'string' && packet.epoch.length > 0 && packet.epoch.length <= 100 &&
            Number.isSafeInteger(packet.seq) && packet.seq > 0 && packet.input && typeof packet.input === 'object';
    }
    if (packet.type === 'state') {
        return typeof packet.epoch === 'string' && packet.epoch.length > 0 && packet.epoch.length <= 100 &&
            Number.isSafeInteger(packet.tick) && packet.tick >= 0 && Number.isSafeInteger(packet.seq) && packet.seq >= 0 &&
            packet.state?.protocolVersion === NETWORK_PROTOCOL_VERSION && packet.state.matchEpoch === packet.epoch &&
            packet.state.physicsTick === packet.tick && packet.state.snapshotSeq === packet.seq;
    }
    if (packet.type === 'ping' || packet.type === 'pong') return Number.isSafeInteger(packet.id) && packet.id >= 0;
    return false;
}

export function encodeProtocolPacket(packet) {
    const encoded = JSON.stringify({ ...packet, v: NETWORK_PROTOCOL_VERSION });
    if (new TextEncoder().encode(encoded).byteLength > MAX_NETWORK_PACKET_BYTES) throw new RangeError('Network packet too large');
    return encoded;
}
