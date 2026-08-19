/**
 * Binary Protocol for GokBall Network
 * Replaces JSON serialization with compact binary format
 * 
 * Snapshot format (per disc):
 *   id:       Uint16Array (2 bytes) - player socket id hash
 *   x:        Int16Array  (2 bytes) - position x * 10 (fixed-point)
 *   y:        Int16Array  (2 bytes) - position y * 10
 *   sx:       Int8Array   (1 byte)  - speed x * 10
 *   sy:       Int8Array   (1 byte)  - speed y * 10
 *   flags:    Uint8Array  (1 byte)  - isPlayer, team, kicking, typing, etc.
 *   color:    Uint8Array  (3 bytes) - RGB color
 *   radius:   Uint8Array  (1 byte)  - radius
 * 
 * Total per disc: ~12 bytes (vs ~200+ bytes JSON)
 * 
 * Header:
 *   tick:     Uint32Array (4 bytes) - server tick
 *   discCount:Uint8Array  (1 byte)  - number of discs
 *   kickoffReset: Uint8Array (1 byte)
 *   kickoffTeam:  Uint8Array (1 byte) - 0=none, 1=red, 2=blue
 *   state:    Uint8Array  (1 byte)  - 0=stopped,1=playing,2=goal,3=ended
 *   scoreRed: Uint8Array  (1 byte)
 *   scoreBlue:Uint8Array  (1 byte)
 *   time:     Uint16Array (2 bytes)
 *   lastInputRed:  Uint16Array (2 bytes) - last processed input seq for red team
 *   lastInputBlue: Uint16Array (2 bytes) - last processed input seq for blue team
 */

// Flag bits for the flags byte
export const DISC_FLAG_IS_PLAYER = 1;
export const DISC_FLAG_KICKING   = 2;
export const DISC_FLAG_TYPING    = 4;
export const DISC_FLAG_TEAM_RED  = 8;
export const DISC_FLAG_TEAM_BLUE = 16;
export const DISC_FLAG_HAS_COLOR = 32;

// State constants
export const STATE_STOPPED = 0;
export const STATE_PLAYING = 1;
export const STATE_GOAL    = 2;
export const STATE_ENDED   = 3;

// Team constants for kickoffTeam byte
export const TEAM_NONE  = 0;
export const TEAM_RED   = 1;
export const TEAM_BLUE  = 2;

/**
 * Encode a game state into a compact binary ArrayBuffer
 * @param {Object} state - The game state object from physics.getState()
 * @param {Object} meta - Extra metadata (score, time, tick, etc.)
 * @returns {ArrayBuffer}
 */
export function encodeSnapshot(state, meta = {}) {
    const discs = state.discs || [];
    const count = Math.min(discs.length, 255); // Max 255 discs
    const headerSize = 14; // bytes
    const discSize = 13;   // bytes per disc
    const totalSize = headerSize + count * discSize;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    
    let offset = 0;
    
    // Header
    view.setUint32(offset, meta.tick || 0, true); offset += 4;       // tick
    view.setUint8(offset, count); offset += 1;                        // discCount
    view.setUint8(offset, state.kickOffReset ? 1 : 0); offset += 1;  // kickoffReset
    view.setUint8(offset, 
        state.kickOffTeam === 'red' ? TEAM_RED : 
        state.kickOffTeam === 'blue' ? TEAM_BLUE : TEAM_NONE
    ); offset += 1;                                                   // kickoffTeam
    view.setUint8(offset, 
        meta.state === 'playing' ? STATE_PLAYING :
        meta.state === 'goal' ? STATE_GOAL :
        meta.state === 'ended' ? STATE_ENDED : STATE_STOPPED
    ); offset += 1;                                                   // state
    view.setUint8(offset, Math.min(meta.scoreRed || 0, 255)); offset += 1;   // scoreRed
    view.setUint8(offset, Math.min(meta.scoreBlue || 0, 255)); offset += 1;  // scoreBlue
    view.setUint16(offset, Math.min(meta.time || 0, 65535), true); offset += 2; // time
    view.setUint16(offset, meta.lastInputRed || 0, true); offset += 2;  // lastInputRed
    view.setUint16(offset, meta.lastInputBlue || 0, true); offset += 2; // lastInputBlue
    
    // Discs
    for (let i = 0; i < count; i++) {
        const d = discs[i];
        
        // ID: hash the string socket id to a uint16
        const idNum = typeof d.id === 'string' ? _hashString(d.id) : (d.id || 0);
        view.setUint16(offset, idNum & 0xFFFF, true); offset += 2;
        
        // Position: fixed-point * 10 (range: -3276.7 to 3276.7)
        view.setInt16(offset, Math.round((d.x || 0) * 10), true); offset += 2;
        view.setInt16(offset, Math.round((d.y || 0) * 10), true); offset += 2;
        
        // Speed: fixed-point * 10 (range: -127.5 to 127.5)
        view.setInt8(offset, Math.max(-127, Math.min(127, Math.round((d.sx || 0) * 10)))); offset += 1;
        view.setInt8(offset, Math.max(-127, Math.min(127, Math.round((d.sy || 0) * 10)))); offset += 1;
        
        // Flags
        let flags = 0;
        if (d.isPlayer) flags |= DISC_FLAG_IS_PLAYER;
        if (d.kicking) flags |= DISC_FLAG_KICKING;
        if (d.typing) flags |= DISC_FLAG_TYPING;
        if (d.team === 'red') flags |= DISC_FLAG_TEAM_RED;
        if (d.team === 'blue') flags |= DISC_FLAG_TEAM_BLUE;
        if (d.color) flags |= DISC_FLAG_HAS_COLOR;
        view.setUint8(offset, flags); offset += 1;
        
        // Color (RGB from hex string)
        if (d.color) {
            const hex = typeof d.color === 'string' ? d.color.replace('#', '') : 'FFFFFF';
            const r = parseInt(hex.substring(0, 2), 16) || 0;
            const g = parseInt(hex.substring(2, 4), 16) || 0;
            const b = parseInt(hex.substring(4, 6), 16) || 0;
            view.setUint8(offset, r); offset += 1;
            view.setUint8(offset, g); offset += 1;
            view.setUint8(offset, b); offset += 1;
        } else {
            view.setUint8(offset, 255); offset += 1;
            view.setUint8(offset, 255); offset += 1;
            view.setUint8(offset, 255); offset += 1;
        }
        
        // Radius (clamped to 0-255, actual = value / 1)
        view.setUint8(offset, Math.min(255, Math.round(d.radius || 10))); offset += 1;
    }
    
    return buffer;
}

/**
 * Decode a binary ArrayBuffer back into a game state object
 * @param {ArrayBuffer} buffer
 * @returns {Object} { state, physics: { discs, kickOffReset, kickOffTeam }, scoreRed, scoreBlue, time, lastInputRed, lastInputBlue, tick }
 */
export function decodeSnapshot(buffer) {
    const view = new DataView(buffer);
    let offset = 0;
    
    // Header
    const tick = view.getUint32(offset, true); offset += 4;
    const count = view.getUint8(offset); offset += 1;
    const kickoffReset = view.getUint8(offset) === 1; offset += 1;
    const kickoffTeamByte = view.getUint8(offset); offset += 1;
    const kickoffTeam = kickoffTeamByte === TEAM_RED ? 'red' : kickoffTeamByte === TEAM_BLUE ? 'blue' : null;
    const stateByte = view.getUint8(offset); offset += 1;
    const state = stateByte === STATE_PLAYING ? 'playing' : stateByte === STATE_GOAL ? 'goal' : stateByte === STATE_ENDED ? 'ended' : 'stopped';
    const scoreRed = view.getUint8(offset); offset += 1;
    const scoreBlue = view.getUint8(offset); offset += 1;
    const time = view.getUint16(offset, true); offset += 2;
    const lastInputRed = view.getUint16(offset, true); offset += 2;
    const lastInputBlue = view.getUint16(offset, true); offset += 2;
    
    // Discs
    const discs = [];
    for (let i = 0; i < count; i++) {
        const idHash = view.getUint16(offset, true); offset += 2;
        const x = view.getInt16(offset, true) / 10; offset += 2;
        const y = view.getInt16(offset, true) / 10; offset += 2;
        const sx = view.getInt8(offset) / 10; offset += 1;
        const sy = view.getInt8(offset) / 10; offset += 1;
        const flags = view.getUint8(offset); offset += 1;
        const r = view.getUint8(offset); offset += 1;
        const g = view.getUint8(offset); offset += 1;
        const b = view.getUint8(offset); offset += 1;
        const radius = view.getUint8(offset); offset += 1;
        
        const isPlayer = !!(flags & DISC_FLAG_IS_PLAYER);
        const team = (flags & DISC_FLAG_TEAM_RED) ? 'red' : (flags & DISC_FLAG_TEAM_BLUE) ? 'blue' : null;
        
        discs.push({
            id: idHash, // Will be matched by the client using idHash
            x, y, sx, sy,
            isPlayer,
            team,
            kicking: !!(flags & DISC_FLAG_KICKING),
            typing: !!(flags & DISC_FLAG_TYPING),
            color: (flags & DISC_FLAG_HAS_COLOR) ? _rgbToHex(r, g, b) : null,
            radius,
        });
    }
    
    return {
        tick,
        state,
        physics: { discs, kickOffReset, kickOffTeam },
        scoreRed, scoreBlue, time,
        lastInputRed, lastInputBlue,
    };
}

/**
 * Encode player input into compact binary
 * Format: seqNum(2) | flags(1) = 3 bytes
 * flags bits: up, down, left, right, kick
 */
export function encodeInput(input, seqNum) {
    const buffer = new ArrayBuffer(3);
    const view = new DataView(buffer);
    view.setUint16(0, seqNum & 0xFFFF, true);
    
    let flags = 0;
    if (input.up)    flags |= 1;
    if (input.down)  flags |= 2;
    if (input.left)  flags |= 4;
    if (input.right) flags |= 8;
    if (input.kick)  flags |= 16;
    view.setUint8(2, flags);
    
    return buffer;
}

/**
 * Decode a player input from binary
 */
export function decodeInput(buffer) {
    const view = new DataView(buffer);
    const seqNum = view.getUint16(0, true);
    const flags = view.getUint8(2);
    
    return {
        seqNum,
        input: {
            up:    !!(flags & 1),
            down:  !!(flags & 2),
            left:  !!(flags & 4),
            right: !!(flags & 8),
            kick:  !!(flags & 16),
        }
    };
}

// Helper: simple string hash to uint16
function _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash & 0xFFFF;
}

// Helper: RGB to hex string
function _rgbToHex(r, g, b) {
    return ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase();
}
