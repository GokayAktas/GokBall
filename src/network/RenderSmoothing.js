/** Limit a rendered position correction so reconciliation cannot jump frames. */
export function limitRenderPosition(previous, target, maxDistance) {
    if (!previous || !Number.isFinite(maxDistance) || maxDistance <= 0) {
        return { x: target.x, y: target.y };
    }

    const dx = target.x - previous.x;
    const dy = target.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= maxDistance || distance === 0) {
        return { x: target.x, y: target.y };
    }

    const scale = maxDistance / distance;
    return {
        x: previous.x + dx * scale,
        y: previous.y + dy * scale
    };
}
