/**
 * HaxBall-compatible HEX color utilities for GokBall (server-side).
 * 
 * Normalizes color input to uppercase 6-char hex (no # prefix).
 * Accepts: FFFFFF, #FFFFFF, ffffff, #ffffff
 * Returns null for invalid hex.
 */

const HEX6 = /^[0-9A-F]{6}$/;

/**
 * Normalize a HEX color string to uppercase 6-char hex without #.
 * Returns null if invalid.
 * @param {string} value
 * @returns {string|null} Uppercase 6-char hex, e.g. "FFFFFF", or null
 */
export function normalizeHex(value) {
    if (typeof value !== 'string') return null;
    const cleaned = value.replace('#', '').trim().toUpperCase();
    return HEX6.test(cleaned) ? cleaned : null;
}

/**
 * Normalize a color, adding # prefix if valid.
 * @param {string} value
 * @returns {string|null} "#FFFFFF" or null
 */
export function normalizeHexWithHash(value) {
    const hex = normalizeHex(value);
    return hex ? '#' + hex : null;
}

/**
 * Parse a normalized hex to [r, g, b] integer array.
 * @param {string} hex - 6-char hex without # (e.g. "FF0000")
 * @returns {[number, number, number]|null}
 */
export function hexToRgb(hex) {
    const h = normalizeHex(hex);
    if (!h) return null;
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16)
    ];
}

/**
 * Validate that an angle is a finite number.
 * @param {any} angle
 * @returns {number} Validated angle (0 if invalid)
 */
export function normalizeAngle(angle) {
    const n = Number(angle);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize a HaxBall team color config.
 * Handles both old { textColor } and new { avatarColor } formats.
 * 
 * @param {object} raw - { angle, textColor?, avatarColor?, colors }
 * @returns {object|null} { angle, avatarColor, colors } or null if invalid
 */
export function normalizeTeamColors(raw) {
    if (!raw || typeof raw !== 'object') return null;
    
    const angle = normalizeAngle(raw.angle);
    
    // Support both textColor (old) and avatarColor (HaxBall format)
    const avatarColor = normalizeHex(raw.avatarColor || raw.textColor);
    if (!avatarColor) return null;
    
    const colors = Array.isArray(raw.colors)
        ? raw.colors.map(c => normalizeHex(c)).filter(Boolean)
        : [];
    
    if (colors.length === 0) return null;
    
    return { angle, avatarColor, colors };
}
