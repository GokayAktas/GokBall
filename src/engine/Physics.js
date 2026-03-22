/**
 * GokBall 2D Physics Engine
 * Haxball-compatible disc-based physics with collision masks
 */

export const CollisionFlags = {
    ball: 1,
    red: 2,
    blue: 4,
    wall: 8,
    redKO: 16,
    blueKO: 32,
    all: 63
};

export function parseCollisionFlag(flags) {
    if (typeof flags === 'number') return flags;
    if (Array.isArray(flags)) {
        return flags.reduce((acc, f) => acc | (CollisionFlags[f] || 0), 0);
    }
    return CollisionFlags[flags] || 0;
}

export class Disc {
    constructor(opts = {}) {
        this.pos = { x: opts.x || 0, y: opts.y || 0 };
        this.speed = { x: opts.sx || 0, y: opts.sy || 0 };
        this.radius = opts.radius || 10;
        this.invMass = opts.invMass ?? 1;
        this.bCoef = opts.bCoef ?? 0.5;
        this.damping = opts.damping ?? 0.99;
        this.color = opts.color || 'FFFFFF';
        this.cMask = opts.cMask ?? CollisionFlags.all;
        this.cGroup = opts.cGroup ?? CollisionFlags.all;

        // Player-specific
        this.acceleration = opts.acceleration || 0.1;
        this.kickingAcceleration = opts.kickingAcceleration || 0.07;
        this.kickingDamping = opts.kickingDamping || 0.96;
        this.kickStrength = opts.kickStrength || 5;
        this.isPlayer = opts.isPlayer || false;
        this.team = opts.team || null; // 'red' | 'blue' | null
        this.kicking = false;
        this.typing = false;
        this.id = opts.id || null; // Player ID (ownerId from server)
        this._playerName = opts.name || "";
        this.avatar = opts.avatar || "";

        // Input state (for player discs)
        this.input = { up: false, down: false, left: false, right: false, kick: false };

        // Store spawn position
        this._spawnPos = { x: this.pos.x, y: this.pos.y };
    }

    reset() {
        this.pos.x = this._spawnPos.x;
        this.pos.y = this._spawnPos.y;
        this.speed.x = 0;
        this.speed.y = 0;
        this.kicking = false;
    }
}

export class Segment {
    constructor(opts = {}) {
        this.v0 = opts.v0 || 0;
        this.v1 = opts.v1 || 1;
        this.curve = opts.curve || 0; // degrees
        this.bCoef = opts.bCoef ?? 1;
        this.vis = opts.vis !== false;
        this.color = opts.color || 'C7E6BD';
        this.cMask = opts.cMask ?? CollisionFlags.all;
        this.cGroup = opts.cGroup ?? CollisionFlags.all;
    }
}

export class Vertex {
    constructor(opts = {}) {
        this.x = opts.x || 0;
        this.y = opts.y || 0;
        this.bCoef = opts.bCoef ?? 1;
        this.cMask = opts.cMask ?? CollisionFlags.all;
        this.cGroup = opts.cGroup ?? CollisionFlags.all;
    }
}

export class Plane {
    constructor(opts = {}) {
        this.normal = { x: opts.normal?.[0] || 0, y: opts.normal?.[1] || 0 };
        this.dist = opts.dist || 0;
        this.bCoef = opts.bCoef ?? 1;
        this.cMask = opts.cMask ?? CollisionFlags.all;
        this.cGroup = opts.cGroup ?? CollisionFlags.all;
    }
}

export class Goal {
    constructor(opts = {}) {
        this.p0 = { x: opts.p0?.[0] || 0, y: opts.p0?.[1] || 0 };
        this.p1 = { x: opts.p1?.[0] || 0, y: opts.p1?.[1] || 0 };
        this.team = opts.team || 'red'; // scoring team
    }
}

export class Physics {
    constructor() {
        this.discs = [];
        this.vertexes = [];
        this.segments = [];
        this.planes = [];
        this.goals = [];
        this.isLocalAuthorityMode = false; // New: To skip server sync for Admin authority rooms
        this.predictionThreshold = 30; // New: Smoothing threshold
        this.ballDisc = null;
        this.myPlayerId = null; // Local player ID for self-highlighting
        
        // Kickoff state (mirrors server for prediction)
        this.stadium = null;
        this.kickOffReset = false;
        this.kickOffTeam = null; 
    }

    /**
     * Load stadium data into the physics engine
     */
    loadStadium(stadium) {
        this.stadium = stadium;
        this.vertexes = (stadium.vertexes || []).map(v => new Vertex({
            ...v,
            cMask: v.cMask ? parseCollisionFlag(v.cMask) : CollisionFlags.all,
            cGroup: v.cGroup ? parseCollisionFlag(v.cGroup) : CollisionFlags.all
        }));

        this.segments = (stadium.segments || []).map(s => new Segment({
            ...s,
            cMask: s.cMask ? parseCollisionFlag(s.cMask) : CollisionFlags.all,
            cGroup: s.cGroup ? parseCollisionFlag(s.cGroup) : CollisionFlags.all
        }));

        this.planes = (stadium.planes || []).map(p => new Plane({
            ...p,
            cMask: p.cMask ? parseCollisionFlag(p.cMask) : CollisionFlags.all,
            cGroup: p.cGroup ? parseCollisionFlag(p.cGroup) : CollisionFlags.all
        }));

        this.goals = (stadium.goals || []).map(g => new Goal(g));

        // Create stadium discs
        this.discs = [];
        const stadiumDiscs = stadium.discs || [];
        for (const d of stadiumDiscs) {
            const disc = new Disc({
                x: d.pos?.[0] || 0,
                y: d.pos?.[1] || 0,
                radius: d.radius || 10,
                invMass: d.invMass ?? 0,
                bCoef: d.bCoef ?? 0.5,
                damping: d.damping ?? 0.99,
                color: d.color || 'FFFFFF',
                cMask: d.cMask ? parseCollisionFlag(d.cMask) : CollisionFlags.all,
                cGroup: d.cGroup ? parseCollisionFlag(d.cGroup) : CollisionFlags.all
            });
            this.discs.push(disc);
        }

        // The ball is the first disc (convention) or disc0
        if (this.discs.length > 0) {
            this.ballDisc = this.discs[0];
        }

        // Apply ballPhysics if set
        if (stadium.ballPhysics && stadium.ballPhysics !== 'disc0' && this.ballDisc) {
            Object.assign(this.ballDisc, {
                radius: stadium.ballPhysics.radius ?? this.ballDisc.radius,
                bCoef: stadium.ballPhysics.bCoef ?? this.ballDisc.bCoef,
                invMass: stadium.ballPhysics.invMass ?? this.ballDisc.invMass,
                damping: stadium.ballPhysics.damping ?? this.ballDisc.damping,
                color: stadium.ballPhysics.color ?? this.ballDisc.color,
            });
        }
    }

    /**
     * Add a player disc
     */
    addPlayerDisc(playerPhysics, team, x, y) {
        const disc = new Disc({
            x, y,
            radius: playerPhysics.radius || 15,
            invMass: playerPhysics.invMass ?? 0.5,
            bCoef: playerPhysics.bCoef ?? 0.5,
            damping: playerPhysics.damping ?? 0.96,
            acceleration: playerPhysics.acceleration ?? 0.08,
            kickingAcceleration: playerPhysics.kickingAcceleration ?? 0.05,
            kickingDamping: playerPhysics.kickingDamping ?? 0.96,
            kickStrength: playerPhysics.kickStrength ?? 5,
            isPlayer: true,
            team: team,
            cMask: CollisionFlags.all,
            cGroup: CollisionFlags[team] || CollisionFlags.all
        });
        this.discs.push(disc);
        return disc;
    }

    /**
     * Remove a player disc
     */
    removePlayerDisc(disc) {
        const idx = this.discs.indexOf(disc);
        if (idx > -1) this.discs.splice(idx, 1);
    }

    step() {
        let kickHappened = false;

        // 1. Apply player input
        for (const disc of this.discs) {
            if (!disc.isPlayer) continue;
            
            let ax = 0;
            let ay = 0;
            if (disc.input.up) ay -= 1;
            if (disc.input.down) ay += 1;
            if (disc.input.left) ax -= 1;
            if (disc.input.right) ax += 1;

            // 2. Normalize diagonal movement (Haxball standard)
            const accelMag = Math.sqrt(ax * ax + ay * ay);
            if (accelMag > 0) {
                const currentAccel = disc.acceleration || 0.11; // Haxball punchy value
                disc.speed.x += (ax / accelMag) * currentAccel;
                disc.speed.y += (ay / accelMag) * currentAccel;
            }

            // 3. Kick (Standard Haxball logic - no movement slowdown)
            if (disc.input.kick && !disc.kicking) {
                disc.kicking = true;
                if (this._performKick(disc)) kickHappened = true;
            } else if (!disc.input.kick) {
                disc.kicking = false;
            }
        }

    // 4. Move and Damping
    for (const disc of this.discs) {
        if (disc.invMass === 0) continue;
        // Haxball players use fixed damping regardless of kicking state
        disc.speed.x *= disc.damping;
        disc.speed.y *= disc.damping;
        disc.pos.x += disc.speed.x;
        disc.pos.y += disc.speed.y;
    }

        // Apply KickOff Constraints (Prediction)
        this._applyKickOffConstraints();

        // Disc-disc collisions
        for (let i = 0; i < this.discs.length; i++) {
            for (let j = i + 1; j < this.discs.length; j++) {
                this._collideDiscs(this.discs[i], this.discs[j]);
            }
        }

        // Disc-vertex collisions
        for (const disc of this.discs) {
            if (disc.invMass === 0) continue;
            for (const v of this.vertexes) {
                if (!(disc.cMask & v.cGroup) && !(v.cMask & disc.cGroup)) continue;
                this._collideDiscVertex(disc, v);
            }
        }

        // Disc-segment collisions
        for (const disc of this.discs) {
            if (disc.invMass === 0) continue;
            for (const seg of this.segments) {
                if (!(disc.cMask & seg.cGroup) && !(seg.cMask & disc.cGroup)) continue;
                this._collideDiscSegment(disc, seg);
            }
        }

        // Disc-plane collisions
        for (const disc of this.discs) {
            if (disc.invMass === 0) continue;
            for (const plane of this.planes) {
                if (!(disc.cMask & plane.cGroup) && !(plane.cMask & disc.cGroup)) continue;
                this._collideDiscPlane(disc, plane);
            }
        }

        // Check goals
        const goalTeam = this._checkGoals();
        return { goalTeam, kickHappened };
    }

    /**
     * Lightweight local-only prediction step.
     * Only moves the local player's disc (applies input + damping + boundary collisions).
     * Does NOT move other discs, ball, or check goals.
     * This prevents double-simulation conflicts with the server.
     */
    stepLocalOnly(localPlayerId) {
        if (!localPlayerId) return;
        
        const disc = this.discs.find(d => d.id === localPlayerId);
        if (!disc || !disc.isPlayer) return;

        // Apply input acceleration (same as full step)
        if (disc.input) {
            let ax = 0, ay = 0;
            if (disc.input.up) ay -= 1;
            if (disc.input.down) ay += 1;
            if (disc.input.left) ax -= 1;
            if (disc.input.right) ax += 1;

            // Normalize diagonal
            const len = Math.sqrt(ax * ax + ay * ay);
            if (len > 0) {
                ax /= len;
                ay /= len;
            }

            const accel = disc.acceleration || 0.11;
            disc.speed.x += ax * accel;
            disc.speed.y += ay * accel;
        }

        // Damping
        disc.speed.x *= disc.damping;
        disc.speed.y *= disc.damping;

        // Move
        disc.pos.x += disc.speed.x;
        disc.pos.y += disc.speed.y;

        // Apply KickOff Constraints (Prediction)
        this._applyKickOffConstraints();

        // Boundary collisions (planes) for local player only
        for (const plane of this.planes) {
            if (!(disc.cMask & plane.cGroup) && !(plane.cMask & disc.cGroup)) continue;
            this._collideDiscPlane(disc, plane);
        }

        // Segment collisions for local player
        for (const seg of this.segments) {
            if (!(disc.cMask & seg.cGroup) && !(seg.cMask & disc.cGroup)) continue;
            this._collideDiscSegment(disc, seg);
        }

        // --- NEW: Local Player vs Ball Collision for Prediction ---
        if (this.ballDisc) {
            this._collideDiscs(disc, this.ballDisc);
        }
    }

    _performKick(playerDisc) {
        if (!this.ballDisc) return false;
        const dx = this.ballDisc.pos.x - playerDisc.pos.x;
        const dy = this.ballDisc.pos.y - playerDisc.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = playerDisc.radius + this.ballDisc.radius + 6;

        if (dist < minDist && dist > 0) {
            // Kickoff team touched via kick
            if (this.kickOffReset && playerDisc.team === this.kickOffTeam) {
                this.kickOffReset = false;
            }

            // Change ball color to White on kick
            if (this.ballDisc) this.ballDisc.color = 'FFFFFF';

            const nx = dx / dist;
            const ny = dy / dist;
            this.ballDisc.speed.x += nx * playerDisc.kickStrength;
            this.ballDisc.speed.y += ny * playerDisc.kickStrength;
            return true;
        }
        return false;
    }

    _collideDiscs(a, b) {
        if (a.invMass === 0 && b.invMass === 0) return;
        if (!(a.cMask & b.cGroup) && !(b.cMask & a.cGroup)) return;

        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.radius + b.radius;

        if (dist >= minDist || dist === 0) return;

        const nx = dx / dist;
        const ny = dy / dist;

        // Separate discs
        const overlap = minDist - dist;
        const totalInvMass = a.invMass + b.invMass;
        if (totalInvMass === 0) return;

        a.pos.x -= nx * overlap * (a.invMass / totalInvMass);
        a.pos.y -= ny * overlap * (a.invMass / totalInvMass);
        b.pos.x += nx * overlap * (b.invMass / totalInvMass);
        b.pos.y += ny * overlap * (b.invMass / totalInvMass);

        // Change ball color to White on touch
        if (a === this.ballDisc || b === this.ballDisc) {
            this.ballDisc.color = 'FFFFFF';
        }

        // Relative velocity
        const dvx = b.speed.x - a.speed.x;
        const dvy = b.speed.y - a.speed.y;
        const dvn = dvx * nx + dvy * ny;

        if (dvn > 0) return; // already separating

        const bCoef = Math.min(a.bCoef, b.bCoef);
        const j = -(1 + bCoef) * dvn / totalInvMass;

        a.speed.x -= j * a.invMass * nx;
        a.speed.y -= j * a.invMass * ny;
        b.speed.x += j * b.invMass * nx;
        b.speed.y += j * b.invMass * ny;
    }

    _collideDiscVertex(disc, vertex) {
        const dx = disc.pos.x - vertex.x;
        const dy = disc.pos.y - vertex.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= disc.radius || dist === 0) return;

        const nx = dx / dist;
        const ny = dy / dist;

        // Push disc out
        disc.pos.x = vertex.x + nx * disc.radius;
        disc.pos.y = vertex.y + ny * disc.radius;

        // Reflect velocity
        const vn = disc.speed.x * nx + disc.speed.y * ny;
        if (vn >= 0) return;

        const bCoef = Math.min(disc.bCoef, vertex.bCoef);
        disc.speed.x -= (1 + bCoef) * vn * nx;
        disc.speed.y -= (1 + bCoef) * vn * ny;
    }

    _collideDiscSegment(disc, seg) {
        const v0 = this.vertexes[seg.v0];
        const v1 = this.vertexes[seg.v1];
        if (!v0 || !v1) return;

        if (seg.curve !== 0) {
            this._collideDiscCurvedSegment(disc, v0, v1, seg);
        } else {
            this._collideDiscStraightSegment(disc, v0, v1, seg);
        }
    }

    _collideDiscStraightSegment(disc, v0, v1, seg) {
        const ex = v1.x - v0.x;
        const ey = v1.y - v0.y;
        const len = Math.sqrt(ex * ex + ey * ey);
        if (len === 0) return;

        const ux = ex / len;
        const uy = ey / len;

        // Normal (perpendicular)
        const nx = -uy;
        const ny = ux;

        // Distance from disc center to line
        const dx = disc.pos.x - v0.x;
        const dy = disc.pos.y - v0.y;
        const dist = dx * nx + dy * ny;

        if (Math.abs(dist) >= disc.radius) return;

        // Projection along segment
        const proj = dx * ux + dy * uy;
        if (proj < 0 || proj > len) return;

        // Push out
        const sign = dist >= 0 ? 1 : -1;
        disc.pos.x += (disc.radius * sign - dist) * nx;
        disc.pos.y += (disc.radius * sign - dist) * ny;

        // Reflect
        const vn = disc.speed.x * nx + disc.speed.y * ny;
        if (vn * sign >= 0) return;

        const bCoef = Math.min(disc.bCoef, seg.bCoef);
        disc.speed.x -= (1 + bCoef) * vn * nx;
        disc.speed.y -= (1 + bCoef) * vn * ny;
    }

    _collideDiscCurvedSegment(disc, v0, v1, seg) {
        // Calculate arc center and radius from curve angle
        const curveRad = (seg.curve * Math.PI) / 180;
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

        // Check disc distance to arc center
        const ddx = disc.pos.x - cx;
        const ddy = disc.pos.y - cy;
        const distToCenter = Math.sqrt(ddx * ddx + ddy * ddy);

        if (distToCenter === 0) return;

        // Check if disc is near the arc surface
        const distFromArc = Math.abs(distToCenter - arcRadius);
        if (distFromArc >= disc.radius) return;

        // Check angle bounds
        const a0 = Math.atan2(v0.y - cy, v0.x - cx);
        const a1 = Math.atan2(v1.y - cy, v1.x - cx);
        const ad = Math.atan2(disc.pos.y - cy, disc.pos.x - cx);

        if (!this._isAngleBetween(ad, a0, a1, curveRad > 0)) return;

        // Normal direction
        const sign = distToCenter > arcRadius ? 1 : -1;
        const cnx = ddx / distToCenter;
        const cny = ddy / distToCenter;

        // Push out
        if (sign > 0) {
            disc.pos.x = cx + cnx * (arcRadius + disc.radius);
            disc.pos.y = cy + cny * (arcRadius + disc.radius);
        } else {
            disc.pos.x = cx + cnx * (arcRadius - disc.radius);
            disc.pos.y = cy + cny * (arcRadius - disc.radius);
        }

        // Reflect velocity
        const vn = disc.speed.x * cnx * sign + disc.speed.y * cny * sign;
        if (vn >= 0) return;

        const bCoef = Math.min(disc.bCoef, seg.bCoef);
        disc.speed.x -= (1 + bCoef) * vn * cnx * sign;
        disc.speed.y -= (1 + bCoef) * vn * cny * sign;
    }

    _isAngleBetween(angle, start, end, clockwise) {
        const twoPi = Math.PI * 2;
        const normalize = a => ((a % twoPi) + twoPi) % twoPi;
        const a = normalize(angle - start);
        const e = normalize(end - start);
        if (clockwise) {
            return a <= e;
        } else {
            return a >= e || e === 0;
        }
    }

    _collideDiscPlane(disc, plane) {
        const dot = disc.pos.x * plane.normal.x + disc.pos.y * plane.normal.y;
        const dist = dot - plane.dist;

        if (dist >= disc.radius) return;

        // Push out
        disc.pos.x += (disc.radius - dist) * plane.normal.x;
        disc.pos.y += (disc.radius - dist) * plane.normal.y;

        // Reflect velocity
        const vn = disc.speed.x * plane.normal.x + disc.speed.y * plane.normal.y;
        if (vn >= 0) return;

        const bCoef = Math.min(disc.bCoef, plane.bCoef);
        disc.speed.x -= (1 + bCoef) * vn * plane.normal.x;
        disc.speed.y -= (1 + bCoef) * vn * plane.normal.y;
    }

    _applyKickOffConstraints() {
        if (!this.kickOffReset || !this.kickOffTeam) return;

        const kickOffRadius = this.stadium?.bg?.kickOffRadius || 75;

        for (const disc of this.discs) {
            if (disc.isPlayer && disc.team) {
                const isRed = disc.team === 'red';
                const isDefending = disc.team !== this.kickOffTeam;
                const dx = disc.pos.x;
                const dy = disc.pos.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                const defendMinDist = kickOffRadius + disc.radius;

                if (isDefending) {
                    // 1. Defending team wall at mid-line
                    if (isRed) {
                        if (disc.pos.x > -disc.radius) {
                            disc.pos.x = -disc.radius;
                            if (disc.speed.x > 0) disc.speed.x = 0;
                        }
                    } else {
                        if (disc.pos.x < disc.radius) {
                            disc.pos.x = disc.radius;
                            if (disc.speed.x < 0) disc.speed.x = 0;
                        }
                    }

                    // 2. Defending team blocked from circle
                    if (dist < defendMinDist && dist > 0) {
                        const nx = dx / dist;
                        const ny = dy / dist;
                        disc.pos.x = nx * defendMinDist;
                        disc.pos.y = ny * defendMinDist;

                        const dot = disc.speed.x * nx + disc.speed.y * ny;
                        if (dot < 0) {
                            disc.speed.x -= dot * nx;
                            disc.speed.y -= dot * ny;
                        }
                    }
                } else {
                    // 3. Kickoff team (can enter entire circle but blocked outside)
                    const inCircle = dist < kickOffRadius;
                    if (!inCircle) {
                        if (isRed) {
                            if (disc.pos.x > -disc.radius) {
                                disc.pos.x = -disc.radius;
                                if (disc.speed.x > 0) disc.speed.x = 0;
                            }
                        } else {
                            if (disc.pos.x < disc.radius) {
                                disc.pos.x = disc.radius;
                                if (disc.speed.x < 0) disc.speed.x = 0;
                            }
                        }
                    }
                }
            }
        }
    }

    _checkGoals() {
        if (!this.ballDisc) return null;

        for (const goal of this.goals) {
            if (this._isBallCrossingGoalLine(this.ballDisc, goal)) {
                return goal.team; // Team that gets scored ON
            }
        }
        return null;
    }

    _isBallCrossingGoalLine(ball, goal) {
        // Check if ball center is past the goal line (simplified)
        const gx = (goal.p0.x + goal.p1.x) / 2;
        const gy0 = Math.min(goal.p0.y, goal.p1.y);
        const gy1 = Math.max(goal.p0.y, goal.p1.y);

        // Ball must be within goal y-range
        if (ball.pos.y < gy0 || ball.pos.y > gy1) return false;

        // Ball must cross the goal x position
        const distToLine = Math.abs(ball.pos.x - gx);
        return distToLine < ball.radius;
    }

    /**
     * Serialize current state for network sync
     */
    getState() {
        return {
            discs: this.discs.map(d => ({
                x: Math.round(d.pos.x * 100) / 100,
                y: Math.round(d.pos.y * 100) / 100,
                sx: Math.round(d.speed.x * 100) / 100,
                sy: Math.round(d.speed.y * 100) / 100,
                kicking: d.kicking
            }))
        };
    }

    /**
     * Apply state from server
     * MODIFIED: Added interpolation for others and prediction support for local player
     */
    applyState(state) {
        if (!state.discs) return;

        // Sync kickoff state for prediction
        if (state.kickOffReset !== undefined) this.kickOffReset = state.kickOffReset;
        if (state.kickOffTeam !== undefined) this.kickOffTeam = state.kickOffTeam;

        // Keep local player ID
        const localId = this.myPlayerId;

        // Sync disc array length
        while (this.discs.length < state.discs.length) {
            this.discs.push(new Disc());
        }
        while (this.discs.length > state.discs.length) {
            this.discs.pop();
        }

        for (let i = 0; i < state.discs.length; i++) {
            const sd = state.discs[i];
            const disc = this.discs[i];
            if (!disc) continue;

            // Set metadata first
            if (sd.isPlayer !== undefined) {
                disc.isPlayer = sd.isPlayer;
                disc.team = sd.team;
                if (sd.name) disc._playerName = sd.name;
                if (sd.avatar) disc.avatar = sd.avatar;
                if (sd.id) disc.id = sd.id;
            } else if (sd.color) {
                disc.color = sd.color;
            }
            if (sd.kicking !== undefined) disc.kicking = sd.kicking;
            if (sd.typing !== undefined) disc.typing = sd.typing;
            if (sd.radius) disc.radius = sd.radius;

            // --- Smart Server State Application ---
            const isMe = (disc.id === this.myPlayerId && this.myPlayerId !== null);
            
            if (isMe) {
                // Reconciliation for local player: only snap if error is too large
                const dx = sd.x - disc.pos.x;
                const dy = sd.y - disc.pos.y;
                const distSq = dx * dx + dy * dy;
                if (distSq > this.predictionThreshold * this.predictionThreshold) {
                    disc.pos.x = sd.x;
                    disc.pos.y = sd.y;
                }
                // Always sync speed from server for physics stability
                disc.speed.x = sd.sx;
                disc.speed.y = sd.sy;
            } else {
                // For others (remote players and ball), snap to server position
                disc.pos.x = sd.x;
                disc.pos.y = sd.y;
                disc.speed.x = sd.sx;
                disc.speed.y = sd.sy;
            }
        }
    }

    /**
     * Admin uses this to receive player metadata/inputs from the Server without replacing positions.
     * Also detects when players join/spawn and captures their initial coordinates.
     */
    applyMetadata(state) {
        if (!state.discs) return;

        while (this.discs.length < state.discs.length) this.discs.push(new Disc());
        while (this.discs.length > state.discs.length) this.discs.pop();

        for (let i = 0; i < state.discs.length; i++) {
            const sd = state.discs[i];
            const disc = this.discs[i];
            if (!disc) continue;

            const isNewAssignment = (sd.isPlayer && disc.id !== sd.id);
            const isMe = (sd.id === this.myPlayerId && this.myPlayerId !== null);

            // Apply metadata and physics attributes!
            if (sd.isPlayer !== undefined) {
                disc.isPlayer = sd.isPlayer;
                disc.team = sd.team;
                if (sd.name) disc._playerName = sd.name;
                if (sd.avatar) disc.avatar = sd.avatar;
                if (sd.id) disc.id = sd.id;
                
                // Physics properties from server (crucial for local admin!)
                if (sd.cMask !== undefined) disc.cMask = sd.cMask;
                if (sd.cGroup !== undefined) disc.cGroup = sd.cGroup;
                if (sd.bCoef !== undefined) disc.bCoef = sd.bCoef;
                if (sd.invMass !== undefined) disc.invMass = sd.invMass;
                if (sd.damping !== undefined) disc.damping = sd.damping;
                if (sd.acceleration !== undefined) disc.acceleration = sd.acceleration;
                if (sd.kickingAcceleration !== undefined) disc.kickingAcceleration = sd.kickingAcceleration;
                if (sd.kickingDamping !== undefined) disc.kickingDamping = sd.kickingDamping;
                if (sd.kickStrength !== undefined) disc.kickStrength = sd.kickStrength;
            } else if (sd.color) {
                disc.color = sd.color;
            }
            if (sd.radius) disc.radius = sd.radius;
            if (sd.typing !== undefined) disc.typing = sd.typing;

            // Apply inputs from server (except for my own input)
            if (sd.input && !isMe) {
                disc.input = sd.input;
            }

            // Only copy positions if it's a newly assigned player (initial spawn location)
            if (isNewAssignment) {
                disc.pos.x = sd.x;
                disc.pos.y = sd.y;
                disc.speed.x = sd.sx || 0;
                disc.speed.y = sd.sy || 0;
            }
        }
    }

    /**
     * Reset all discs to spawn positions
     */
    resetPositions() {
        for (const disc of this.discs) {
            disc.reset();
        }
    }
}
