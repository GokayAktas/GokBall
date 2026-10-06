export function isValidFullGameState(state) {
    if (!state || state.fullState !== true || typeof state.matchEpoch !== 'string' ||
        state.matchEpoch.length < 1 || state.matchEpoch.length > 100 ||
        !Number.isSafeInteger(state.physicsTick) || state.physicsTick < 0 ||
        !Number.isSafeInteger(state.snapshotSeq) || state.snapshotSeq < 0 ||
        !Array.isArray(state.physics?.discs) || state.physics.discs.length > 128) return false;
    if (![state.scoreRed, state.scoreBlue, state.time, state.scoreLimit, state.timeLimit].every(Number.isFinite)) return false;
    return state.physics.discs.every((disc) =>
        Number.isFinite(disc.x) && Number.isFinite(disc.y) &&
        Number.isFinite(disc.sx) && Number.isFinite(disc.sy)
    );
}
