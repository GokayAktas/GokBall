/**
 * GokBall Canvas Renderer
 * Renders stadium, discs, players, and HUD elements
 */
export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false }); // Performance optimization
        this.resize();
        window.addEventListener('resize', () => {
            this.resize();
            this._stadiumDirty = true; // Redraw offscreen on resize
        });

        // Offscreen canvas for static stadium elements (Optimization)
        this.offscreen = document.createElement('canvas');
        this.offCtx = this.offscreen.getContext('2d');
        this._stadiumDirty = true;
        this._lastStadiumName = null;

        // Assets
        this.starballImg = new Image();
        this.starballImg.src = '/assets/starball.png';
        this.starballImg.onload = () => { this._stadiumDirty = true; };
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    /**
     * Main render call
     */
    render(camera, stadium, physics, gameState) {
        const ctx = this.ctx;

        // Clear screen with a solid color instead of clearRect (faster on some browsers)
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.save();
        // Apply camera transform
        ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);

        // Optimization: Pre-render stadium background and segments to offscreen canvas
        if (this._stadiumDirty || this._lastStadiumName !== stadium.name) {
            this._renderOffscreen(stadium, physics);
            this._stadiumDirty = false;
            this._lastStadiumName = stadium.name;
        }

        // Draw the cached stadium
        ctx.drawImage(this.offscreen, -2000, -2000);

        // Draw dynamic elements
        this._drawDiscs(physics, gameState);

        ctx.restore();
    }

    _renderOffscreen(stadium, physics) {
        // Size the offscreen canvas to a large enough area to cover the stadium
        this.offscreen.width = 4000;
        this.offscreen.height = 4000;
        this.offCtx.save();
        this.offCtx.translate(2000, 2000); // Center

        this._drawBackground(this.offCtx, stadium);
        this._drawFieldLines(this.offCtx, stadium);
        this._drawGoals(this.offCtx, stadium);
        this._drawSegments(this.offCtx, stadium, physics);

        this.offCtx.restore();
    }

    _drawBackground(ctx, stadium) {
        const bg = stadium.bg;
        const w = bg.width;
        const h = bg.height;

        // Outer area color
        ctx.fillStyle = '#' + (bg.bgColor || '718d5a');
        ctx.fillRect(-2000, -2000, 4000, 4000);

        // Inner field stripes
        ctx.save();
        ctx.beginPath();
        if (bg.cornerRadius > 0) {
            this._roundRect(ctx, -w, -h, w * 2, h * 2, bg.cornerRadius);
        } else {
            ctx.rect(-w, -h, w * 2, h * 2);
        }
        ctx.clip();

        ctx.fillStyle = '#' + (bg.color || '718C5A');
        ctx.fill();

        // Diagonal stripes (Matching image pattern)
        ctx.fillStyle = '#' + (bg.stripeColor || '779461');
        ctx.save();
        ctx.rotate(Math.PI / 4);
        const stripeWidth = 50;
        const extent = 2000;
        for (let i = -extent; i < extent; i += stripeWidth * 2) {
            ctx.fillRect(i, -extent, stripeWidth, extent * 2);
        }
        ctx.restore();
        ctx.restore();
    }

    _drawFieldLines(ctx, stadium) {
        const bg = stadium.bg;
        const w = bg.width;
        const h = bg.height;

        // Use custom line color if provided, otherwise default based on dark background
        if (bg.lineColor) {
            ctx.strokeStyle = '#' + bg.lineColor;
        } else {
            const isDark = bg.color === '404040' || bg.color === '333333';
            ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.4)';
        }
        
        ctx.lineWidth = 2.5;

        // Outer Boundary
        ctx.beginPath();
        ctx.rect(-w, -h, w * 2, h * 2);
        ctx.stroke();

        // Midfield Line (Optional)
        if (bg.showCenterLine !== false) {
            ctx.save();
            if (bg.centerLineColor) {
                ctx.strokeStyle = '#' + bg.centerLineColor;
            }
            ctx.beginPath();
            const r = (bg.kickOffRadius || 0) + 2;
            // Draw upper part
            ctx.moveTo(0, -h);
            ctx.lineTo(0, -r);
            // Draw lower part
            ctx.moveTo(0, r);
            ctx.lineTo(0, h);
            ctx.stroke();
            ctx.restore();
        }

        // Starball Image or Kickoff Circle
        if (bg.kickOffRadius > 0) {
            if (bg.useStarballImage && this.starballImg && this.starballImg.complete) {
                // Draw Starball image
                const r = bg.kickOffRadius;
                ctx.save();
                ctx.globalAlpha = 0.6; // Slightly transparent to blend in
                ctx.drawImage(this.starballImg, -r, -r, r * 2, r * 2);
                ctx.restore();
            } else if (bg.showKickOffCircle !== false) {
                // Draw standard circle
                ctx.beginPath();
                ctx.arc(0, 0, bg.kickOffRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    _drawGoals(ctx, stadium) { }

    _drawSegments(ctx, stadium, physics) {
        for (const seg of stadium.segments) {
            if (!seg.vis) continue;
            const v0 = stadium.vertexes[seg.v0];
            const v1 = stadium.vertexes[seg.v1];
            if (!v0 || !v1) continue;

            const color = (seg.color && seg.color.startsWith('#')) ? seg.color : '#' + (seg.color || '000000');
            ctx.strokeStyle = color;
            ctx.lineWidth = 3.5;
            ctx.beginPath();

            if (seg.curve !== 0 && seg.curve !== undefined) {
                this._drawCurvedSegment(ctx, v0, v1, seg.curve);
            } else {
                ctx.moveTo(v0.x, v0.y);
                ctx.lineTo(v1.x, v1.y);
            }
            ctx.stroke();
        }
    }

    _drawCurvedSegment(ctx, v0, v1, curveDeg) {
        const curveRad = (curveDeg * Math.PI) / 180;
        const mx = (v0.x + v1.x) / 2;
        const my = (v0.y + v1.y) / 2;
        const dx = v1.x - v0.x;
        const dy = v1.y - v0.y;
        const halfLen = Math.sqrt(dx * dx + dy * dy) / 2;
        if (halfLen === 0) return;
        const d = halfLen / Math.tan(curveRad / 2);
        const nx = -dy / (halfLen * 2);
        const ny = dx / (halfLen * 2);
        const cx = mx + nx * d;
        const cy = my + ny * d;
        const arcRadius = Math.sqrt(halfLen * halfLen + d * d);
        const startAngle = Math.atan2(v0.y - cy, v0.x - cx);
        const endAngle = Math.atan2(v1.y - cy, v1.x - cx);
        ctx.arc(cx, cy, arcRadius, startAngle, endAngle, curveDeg < 0);
    }

    _drawDiscs(physics, gameState) {
        const ctx = this.ctx;
        const myId = physics.myPlayerId;

        for (const disc of physics.discs) {
            const isSelf = disc.isPlayer && disc.id === myId;

            // Self-identifier: translucent white glow circle (always visible)
            if (isSelf) {
                ctx.beginPath();
                ctx.arc(disc.pos.x, disc.pos.y, disc.radius + 10, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            // Main disc
            ctx.beginPath();
            ctx.arc(disc.pos.x, disc.pos.y, disc.radius, 0, Math.PI * 2);

            let fill, border, lw;
            if (disc.isPlayer) {
                fill = disc.team === 'red' ? '#E74C3C' : '#3498DB';
                border = disc.kicking ? '#FFFFFF' : '#000000';
                lw = 2.5;
            } else {
                fill = '#' + (disc.color || 'FFFFFF');
                border = '#000000';
                lw = 1.5; // Thinner outline for ball
            }

            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = border;
            ctx.lineWidth = lw;
            ctx.stroke();

            // Avatar (Centered bold text)
            if (disc.avatar || disc.isPlayer) {
                ctx.fillStyle = '#FFFFFF';
                ctx.font = `900 ${disc.radius * 1.1}px Inter, "Segoe UI", Tahoma, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(disc.avatar || "", disc.pos.x, disc.pos.y + (disc.radius * 0.05));
            }

            // Name label BELOW other players (NOT self)
            if (disc.isPlayer && !isSelf && (disc._playerName || disc.name)) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(disc._playerName || disc.name || "", disc.pos.x, disc.pos.y + disc.radius + 5);
            }

            // Typing Bubble
            if (disc.isPlayer && disc.typing) {
                this._drawTypingBubble(disc.pos.x, disc.pos.y - disc.radius - 12);
            }
        }
    }

    _drawTypingBubble(x, y) {
        const ctx = this.ctx;
        const w = 24;
        const h = 14;
        const r = 4;

        ctx.save();
        ctx.translate(x - w / 2, y - h);

        // Bubble body
        ctx.beginPath();
        this._roundRect(ctx, 0, 0, w, h, r);
        ctx.fillStyle = 'white';
        ctx.fill();
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Pointer
        ctx.beginPath();
        ctx.moveTo(w / 2 - 4, h);
        ctx.lineTo(w / 2, h + 4);
        ctx.lineTo(w / 2 + 4, h);
        ctx.fillStyle = 'white';
        ctx.fill();
        ctx.strokeStyle = 'black';
        ctx.stroke();

        // Remove the line between bubble and pointer
        ctx.beginPath();
        ctx.moveTo(w / 2 - 3.5, h);
        ctx.lineTo(w / 2 + 3.5, h);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // "..." dots
        ctx.fillStyle = 'black';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('...', w / 2, h / 2 + 3);

        ctx.restore();
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
    }

    drawGoalEffect(team, progress) {
        const alpha = Math.sin(progress * Math.PI) * 0.3;
        const color = team === 'red' ? `rgba(231, 76, 60, ${alpha})` : `rgba(52, 152, 219, ${alpha})`;
        this.ctx.fillStyle = color;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    show() {
        this.canvas.style.display = 'block';
    }

    hide() {
        this.canvas.style.display = 'none';
    }
}
