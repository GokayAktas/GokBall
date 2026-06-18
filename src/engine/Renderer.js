/**
 * GokBall Canvas Renderer
 * Renders stadium, discs, players, and HUD elements
 * Sharp, professional, crisp 2D vector-style rendering
 */
export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.resize();
        window.addEventListener('resize', () => {
            this.resize();
            this._stadiumDirty = true;
        });

        // Offscreen canvas for static stadium elements
        this.offscreen = document.createElement('canvas');
        this.offCtx = this.offscreen.getContext('2d');
        this._stadiumDirty = true;
        this._lastStadiumName = null;

        // Assets
        this.starballImg = new Image();
        this.starballImg.src = '/assets/starball.png';
        this.starballImg.onload = () => { this._stadiumDirty = true; };

        // Theme cache
        this._theme = {
            bgPrimary: '#000000',
            bgSecondary: '#000000',
            redTeam: 'c70000',
            blueTeam: '00008c',
            textPrimary: '#FFFFFF'
        };

        // Enable sub-pixel rendering for sharper lines
        this._pixelRatio = window.devicePixelRatio || 1;
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        this._pixelRatio = dpr;
    }

    render(camera, stadium, physics, gameState) {
        const ctx = this.ctx;
        this._updateTheme();

        // Clear with crisp full canvas fill
        ctx.fillStyle = this._theme.bgPrimary || '#000';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.save();
        ctx.scale(this._pixelRatio, this._pixelRatio);

        // Apply camera transform
        ctx.translate(window.innerWidth / 2, window.innerHeight / 2);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);

        // Pre-render static elements
        if (this._stadiumDirty || this._lastStadiumName !== stadium.name) {
            this._renderOffscreen(stadium, physics);
            this._stadiumDirty = false;
            this._lastStadiumName = stadium.name;
        }

        ctx.drawImage(this.offscreen, -2000, -2000);

        // Draw dynamic elements
        this._drawDiscs(physics, gameState);

        ctx.restore();
    }

    _renderOffscreen(stadium, physics) {
        this.offscreen.width = 4000;
        this.offscreen.height = 4000;
        this.offCtx.save();
        this.offCtx.translate(2000, 2000);

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

        // Outer area
        ctx.fillStyle = bg && bg.bgColor ? '#' + bg.bgColor : (this._theme.bgSecondary || '#071022');
        ctx.fillRect(-2000, -2000, 4000, 4000);

        // Inner field with crisp clipping
        ctx.save();
        ctx.beginPath();
        if (bg.cornerRadius > 0) {
            this._roundRect(ctx, -w, -h, w * 2, h * 2, bg.cornerRadius);
        } else {
            ctx.rect(-w, -h, w * 2, h * 2);
        }
        ctx.clip();

        // Inner field base color
        ctx.fillStyle = bg && bg.color ? '#' + bg.color : (this._theme.bgPrimary || '#071022');
        ctx.fill();

        // Diagonal stripes with clean edges
        ctx.fillStyle = bg && bg.stripeColor ? '#' + bg.stripeColor : (this._theme.bgSecondary || '#0d2540');
        ctx.save();
        ctx.rotate(Math.PI / 4);
        const stripeWidth = 50;
        const extent = 2000;
        for (let i = -extent; i < extent; i += stripeWidth * 2) {
            ctx.fillRect(i, -extent, stripeWidth, extent * 2);
        }
        ctx.restore();

        // Subtle inner shadow on field edges for depth
        ctx.restore();
    }

    _drawFieldLines(ctx, stadium) {
        const bg = stadium.bg;
        const w = bg.width;
        const h = bg.height;

        // Crisp white lines with slight opacity for field lines
        if (bg.lineColor) {
            ctx.strokeStyle = '#' + bg.lineColor;
        } else {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        }
        ctx.lineWidth = 2.5;

        // Outer boundary - cleaner, more visible
        ctx.beginPath();
        ctx.rect(-w, -h, w * 2, h * 2);
        ctx.stroke();

        // Center line
        if (bg.showCenterLine !== false) {
            ctx.save();
            if (bg.centerLineColor) {
                ctx.strokeStyle = '#' + bg.centerLineColor;
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            }
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            const r = (bg.kickOffRadius || 0) + 8;
            // Upper part
            ctx.moveTo(0, -h);
            ctx.lineTo(0, -r);
            // Lower part
            ctx.moveTo(0, r);
            ctx.lineTo(0, h);
            ctx.stroke();
            ctx.restore();
        }

        // Center circle
        if (bg.kickOffRadius > 0) {
            if (bg.useStarballImage && this.starballImg && this.starballImg.complete) {
                const r = bg.kickOffRadius;
                ctx.save();
                ctx.globalAlpha = 0.5;
                ctx.drawImage(this.starballImg, -r, -r, r * 2, r * 2);
                ctx.restore();
            } else if (bg.showKickOffCircle !== false) {
                // Clean center circle
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.beginPath();
                ctx.arc(0, 0, bg.kickOffRadius, 0, Math.PI * 2);
                ctx.stroke();

                // Center dot
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.beginPath();
                ctx.arc(0, 0, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    _drawGoals(ctx, stadium) {
        // Draw goal areas (netting) with clean semi-transparent look
        const goals = stadium.goals || [];
        const segs = stadium.segments || [];
        const verts = stadium.vertexes || [];

        for (const g of goals) {
            const gx = (g.p0[0] + g.p1[0]) / 2;
            const gy0 = Math.min(g.p0[1], g.p1[1]);
            const gy1 = Math.max(g.p0[1], g.p1[1]);

            // Draw goal background with subtle net pattern
            const isLeft = gx < 0;
            const goalDepth = 35;

            ctx.save();
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = '#FFFFFF';
            if (isLeft) {
                ctx.fillRect(gx - goalDepth, gy0, goalDepth, gy1 - gy0);
            } else {
                ctx.fillRect(gx, gy0, goalDepth, gy1 - gy0);
            }
            ctx.restore();

            // Draw goal posts with clear outlines
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            if (isLeft) {
                ctx.beginPath();
                ctx.moveTo(gx, gy0);
                ctx.lineTo(gx - goalDepth, gy0);
                ctx.lineTo(gx - goalDepth, gy1);
                ctx.lineTo(gx, gy1);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.moveTo(gx, gy0);
                ctx.lineTo(gx + goalDepth, gy0);
                ctx.lineTo(gx + goalDepth, gy1);
                ctx.lineTo(gx, gy1);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }
    }

    _drawSegments(ctx, stadium, physics) {
        for (const seg of stadium.segments) {
            if (!seg.vis) continue;
            const v0 = stadium.vertexes[seg.v0];
            const v1 = stadium.vertexes[seg.v1];
            if (!v0 || !v1) continue;

            const color = (seg.color && seg.color.startsWith('#')) ? seg.color : '#' + (seg.color || '000000');
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
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
            const isBall = !disc.isPlayer;

            // --- Self indicator ring ---
            if (isSelf) {
                ctx.beginPath();
                ctx.arc(disc.pos.x, disc.pos.y, disc.radius + 12, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.lineWidth = 2.5;
                ctx.stroke();
            }

            let border, lw;
            let colors = [];
            let angle = 0;

            if (disc.isPlayer) {
                // Player colors
                if (disc.colors && disc.colors.length > 0) {
                    colors = disc.colors;
                    angle = disc.colorAngle || 0;
                } else if (disc.color) {
                    colors = [disc.color];
                } else {
                    colors = [disc.team === 'red' ? (this._theme.redTeam || 'c70000') : (this._theme.blueTeam || '00008c')];
                }
                border = disc.kicking ? '#FFFFFF' : '#000000';
                lw = 2.5;
            } else {
                // Ball: white with black outline
                colors = ['FFFFFF'];
                border = '#000000';
                lw = 3;
            }

            // --- Draw player body ---
            if (disc.isPlayer && colors.length > 1) {
                // Striped player
                ctx.save();
                ctx.translate(disc.pos.x, disc.pos.y);
                const rot = (angle - 90) * Math.PI / 180;
                ctx.rotate(rot);

                ctx.beginPath();
                ctx.arc(0, 0, disc.radius, 0, Math.PI * 2);
                ctx.clip();

                const w = disc.radius * 2;
                const h = disc.radius * 2;
                const num = colors.length;
                const stripeW = w / num;

                for (let i = 0; i < num; i++) {
                    ctx.fillStyle = '#' + colors[i];
                    ctx.fillRect(-disc.radius + i * stripeW, -disc.radius, stripeW + 1, h);
                }
                ctx.restore();
            } else {
                // Single color disc
                ctx.beginPath();
                ctx.arc(disc.pos.x, disc.pos.y, disc.radius, 0, Math.PI * 2);
                ctx.fillStyle = colors[0].startsWith('#') ? colors[0] : '#' + colors[0];
                ctx.fill();
            }

            // --- Draw border ---
            ctx.beginPath();
            ctx.arc(disc.pos.x, disc.pos.y, disc.radius, 0, Math.PI * 2);
            ctx.strokeStyle = border;
            ctx.lineWidth = lw;
            ctx.stroke();

            // --- Player inner shadow for depth ---
            if (disc.isPlayer) {
                ctx.beginPath();
                ctx.arc(disc.pos.x, disc.pos.y, disc.radius - 2, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // --- Avatar text ---
            if (disc.avatar || disc.isPlayer) {
                ctx.fillStyle = disc.avatarColor ? '#' + disc.avatarColor : '#FFFFFF';
                ctx.font = `900 ${disc.radius * 1.15}px Inter, "Segoe UI", Tahoma, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                // Slight text shadow for readability
                ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
                ctx.shadowBlur = 1;
                ctx.fillText(disc.avatar || "", disc.pos.x, disc.pos.y + (disc.radius * 0.05));
                ctx.shadowBlur = 0;
            }

            // --- Name label below ---
            if (disc.isPlayer && !isSelf && (disc._playerName || disc.name)) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.font = 'bold 12px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
                ctx.shadowBlur = 2;
                ctx.fillText(disc._playerName || disc.name || "", disc.pos.x, disc.pos.y + disc.radius + 6);
                ctx.shadowBlur = 0;
            }

            // --- Typing bubble ---
            if (disc.isPlayer && disc.typing) {
                this._drawTypingBubble(disc.pos.x, disc.pos.y - disc.radius - 14);
            }
        }
    }

    _drawTypingBubble(x, y) {
        const ctx = this.ctx;
        const w = 26;
        const h = 14;
        const r = 6;

        ctx.save();
        ctx.translate(x, y - h - 10);

        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 3;

        ctx.beginPath();
        this._roundRect(ctx, -w / 2, 0, w, h, r);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Pointer
        ctx.beginPath();
        ctx.moveTo(-4, h);
        ctx.lineTo(0, h + 5);
        ctx.lineTo(4, h);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fill();

        // Dots
        const dotSize = 2.5;
        const spacing = 5.5;
        ctx.fillStyle = '#555';
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc((i - 1) * spacing, h / 2, dotSize, 0, Math.PI * 2);
            ctx.fill();
        }

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
        const alpha = Math.sin(progress * Math.PI) * 0.25;
        const base = team === 'red' ? (this._theme.redTeam || 'c70000') : (this._theme.blueTeam || '00008c');
        const color = this._hexToRgba(base, alpha);
        this.ctx.fillStyle = color;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    _updateTheme() {
        try {
            const s = getComputedStyle(document.documentElement);
            const pick = v => (s.getPropertyValue(v) || '').trim();
            const bgPrimary = pick('--bg-primary') || pick('--deep-navy') || '#000000';
            const bgSecondary = pick('--bg-secondary') || bgPrimary;
            const red = pick('--red-team') || 'c70000';
            const blue = pick('--blue-team') || '00008c';
            const textPrimary = pick('--text-primary') || '#FFFFFF';

            this._theme.bgPrimary = bgPrimary.replace(/"/g, '');
            this._theme.bgSecondary = bgSecondary.replace(/"/g, '');
            this._theme.redTeam = red.replace('#', '').trim();
            this._theme.blueTeam = blue.replace('#', '').trim();
            this._theme.textPrimary = textPrimary.replace(/"/g, '');
        } catch (e) {}
    }

    _hexToRgba(hex, alpha) {
        if (!hex) return `rgba(0,0,0,${alpha})`;
        const h = hex.replace('#', '').trim();
        if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
        const r = parseInt(h.substring(0,2),16);
        const g = parseInt(h.substring(2,4),16);
        const b = parseInt(h.substring(4,6),16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    show() {
        this.canvas.style.display = 'block';
    }

    hide() {
        this.canvas.style.display = 'none';
    }
}