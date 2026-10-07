export const NETWORK_PROTOCOL_VERSION = 1;
export const MAX_NETWORK_PACKET_BYTES = 64 * 1024;

export function isProtocolPacket(packet) {
    return !!packet && packet.v === NETWORK_PROTOCOL_VERSION &&
        typeof packet.type === 'string' && packet.type.length <= 32;
}

export function encodeProtocolPacket(packet) {
    const encoded = JSON.stringify({ v: NETWORK_PROTOCOL_VERSION, ...packet });
    if (new TextEncoder().encode(encoded).byteLength > MAX_NETWORK_PACKET_BYTES) throw new RangeError('Network packet too large');
    return encoded;
}
