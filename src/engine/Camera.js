/**
 * Camera system - follows the player disc with smooth interpolation
 */
export class Camera {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.zoom = 1.5;
        this.targetX = 0;
        this.targetY = 0;
        this.smoothing = 0.08;   // Interpolation factor
        this.minZoom = 0.5;
        this.maxZoom = 3;
    }

    /**
     * Set the target the camera should follow (player disc position)
     */
    follow(disc, stadium) {
        if (!disc) return;

        // Average between player and ball for better view
        this.targetX = disc.pos.x;
        this.targetY = disc.pos.y;
    }

    /**
     * Update camera position (call each frame)
     */
    update() {
        this.x += (this.targetX - this.x) * this.smoothing;
        this.y += (this.targetY - this.y) * this.smoothing;
    }

    /**
     * Adjust zoom level
     */
    setZoom(level) {
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, level));
    }

    zoomIn() {
        this.setZoom(this.zoom + 0.1);
    }

    zoomOut() {
        this.setZoom(this.zoom - 0.1);
    }

    /**
     * Convert screen coordinates to world coordinates
     */
    screenToWorld(screenX, screenY, canvasWidth, canvasHeight) {
        const wx = (screenX - canvasWidth / 2) / this.zoom + this.x;
        const wy = (screenY - canvasHeight / 2) / this.zoom + this.y;
        return { x: wx, y: wy };
    }
}
