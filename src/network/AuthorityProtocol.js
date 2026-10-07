export function isValidFullGameState(state) {
    if (!state || state.protocolVersion !== 2 || state.fullState !== true || typeof state.matchEpoch !== 'string' ||
        state.matchEpoch.length < 1 || state.matchEpoch.length > 100 ||
        !Number.isSafeInteger(state.tick) || state.tick < 0 ||
        !Number.isSafeInteger(state.physicsTick) || state.physicsTick < 0 || state.physicsTick !== state.tick ||
        !Number.isSafeInteger(state.snapshotSeq) || state.snapshotSeq < 0 ||
        !['playing', 'goal', 'countdown', 'ended'].includes(state.state) ||
        !Array.isArray(state.physics?.discs) || state.physics.discs.length > 128) return false;
    if (![state.scoreRed, state.scoreBlue, state.time, state.scoreLimit, state.timeLimit].every(Number.isFinite)) return false;
    if (typeof state.paused !== 'boolean' || !state.lastProcessedSeq || typeof state.lastProcessedSeq !== 'object') return false;
    if (Object.values(state.lastProcessedSeq).some(seq => !Number.isSafeInteger(seq) || seq < 0)) return false;
    const playerIds = new Set();
    const valid = state.physics.discs.every((disc) => {
        if (disc?.isPlayer) {
            if (typeof disc.id !== 'string' || !disc.id || playerIds.has(disc.id)) return false;
            playerIds.add(disc.id);
        }
        return Number.isFinite(disc.x) && Number.isFinite(disc.y) &&
            Number.isFinite(disc.sx) && Number.isFinite(disc.sy);
    });
    if (!valid) return false;
    try { return new TextEncoder().encode(JSON.stringify(state)).byteLength <= 64 * 1024; } catch { return false; }
}
