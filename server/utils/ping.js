/**
 * Ping helpers - how GokBall measures and displays latency.
 *
 * Rules we replicate:
 *  - the value shown in the player list increments in steps of 16 ms
 *  - it reflects the *effective* ping: noisy connections are shown slightly
 *    higher than their raw average
 *  - the authority measures the round trip, players do not report their own ping
 */

/** Displayed ping increments in 16 ms steps. */
export const PING_STEP = 16;
/** How many round trips are averaged into the effective ping. */
export const PING_SAMPLE_COUNT = 10;
/**
 * Round to the nearest 16 ms step, like the player list display does.
 * Returns null when there is no measurement yet - never invent a value.
 */
export function quantizePing(ms) {
    if (ms == null || !Number.isFinite(ms)) return null;
    return Math.round(ms / PING_STEP) * PING_STEP;
}

/**
 * Effective ping from raw round trip samples.
 *
 * Averages the samples and adds the average absolute deviation (jitter), so a
 * connection that swings around is shown slightly higher than a steady one -
 * the same "noisy ping looks worse" rule we apply.
 */
export function effectivePing(samples) {
    if (!samples || samples.length === 0) return null;

    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    let deviation = 0;
    for (const s of samples) deviation += Math.abs(s - avg);
    const jitter = deviation / samples.length;

    return quantizePing(avg + jitter);
}

/** Color band of a ping value, shared with the client HUD. */
export function pingLevel(ms) {
    if (ms == null || !Number.isFinite(ms)) return 'unknown';
    if (ms < 100) return 'good';
    if (ms < 200) return 'fair';
    return 'bad';
}
