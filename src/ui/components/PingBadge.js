/**
 * Ping badge for the player lists - every player's ping is shown next to
 * their nickname in the room player list ("Update: Ping vision!", 2012).
 *
 * The value the server sends is already quantized to 16 ms steps and inflated
 * by jitter, so the displayed value is the effective ping, not the raw one.
 */

const PING_GOOD_MAX = 100; // < 100 ms -> good
const PING_FAIR_MAX = 200; // < 200 ms -> fair, otherwise bad

/** Color band of a ping value. */
export function pingLevel(ms) {
    if (ms == null || !Number.isFinite(ms)) return 'unknown';
    if (ms < PING_GOOD_MAX) return 'good';
    if (ms < PING_FAIR_MAX) return 'fair';
    return 'bad';
}

/**
 * HTML for the badge shown next to a player's name.
 *
 * @param {object} player     room player entry (ping, pingLoss, handicap)
 * @param {number|null} ownPing  locally measured ping, used for the own entry
 *                              so it updates instantly instead of every 2s
 */
export function renderPingBadge(player, ownPing = null) {
    const ping = ownPing != null ? ownPing : player.ping;
    const level = pingLevel(ping);

    const parts = [];
    if (level === 'unknown') {
        parts.push('<span class="ping-badge ping-unknown" title="Ping ölçülmedi">--</span>');
    } else {
        const jittery = player.pingLoss > 0
            ? `<span class="ping-bars" title="${player.pingLoss} kayıp ping">▮</span>`
            : '';
        const handicap = player.handicap > 0
            ? `<span class="ping-handicap" title="Handicap: ${player.handicap}ms">⏱${player.handicap}</span>`
            : '';
        parts.push(`<span class="ping-badge ping-${level}" title="Ping">${ping}</span>${jittery}${handicap}`);
    }
    return parts.join('');
}