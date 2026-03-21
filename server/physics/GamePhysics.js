/**
 * Server-side Game Physics (authoritative)
 * Simplified re-implementation of client physics for server validation
 */

export const CollisionFlags = {
    ball: 1, red: 2, blue: 4, wall: 8, redKO: 16, blueKO: 32, all: 63
};

export function parseCollisionFlag(flags) {
    if (typeof flags === 'number') return flags;
    if (Array.isArray(flags)) return flags.reduce((a, f) => a | (CollisionFlags[f] || 0), 0);
    return CollisionFlags[flags] || 0;
}

class Disc {
    constructor(opts = {}) {
        this.pos = { x: opts.x || 0, y: opts.y || 0 };
        this.speed = { x: 0, y: 0 };
        this.radius = opts.radius || 10;
        this.invMass = opts.invMass ?? 1;
        this.bCoef = opts.bCoef ?? 0.5;
        this.damping = opts.damping ?? 0.99;
        this.cMask = opts.cMask ?? CollisionFlags.all;
        this.cGroup = opts.cGroup ?? CollisionFlags.all;
        this.acceleration = opts.acceleration || 0.1;
        this.kickingAcceleration = opts.kickingAcceleration || 0.07;
        this.kickingDamping = opts.kickingDamping || 0.96;
        this.kickStrength = opts.kickStrength || 5;
        this.isPlayer = opts.isPlayer || false;
        this.ownerId = opts.ownerId || null;
        this.team = opts.team || null;
        this.kicking = false;
        this.typing = false;
        this.input = { up: false, down: false, left: false, right: false, kick: false };
        this._spawnX = this.pos.x;
        this._spawnY = this.pos.y;
    }

    reset() {
        this.pos.x = this._spawnX;
        this.pos.y = this._spawnY;
        this.speed.x = 0;
        this.speed.y = 0;
        this.kicking = false;
    }
}

export class GamePhysics {
    constructor() {
        this.discs = [];
        this.vertexes = [];
        this.segments = [];
        this.planes = [];
        this.goals = [];
        this.ballDisc = null;
    }

    loadStadium(stadium) {
        this.vertexes = (stadium.vertexes || []).map(v => ({
            x: v.x || 0, y: v.y || 0,
            bCoef: v.bCoef ?? 1,
            cMask: v.cMask ? parseCollisionFlag(v.cMask) : CollisionFlags.all,
            cGroup: v.cGroup ? parseCollisionFlag(v.cGroup) : CollisionFlags.all
        }));

        this.segments = (stadium.segments || []).map(s => ({
            v0: s.v0 ?? 0, v1: s.v1 ?? 1,
            curve: s.curve || 0,
            bCoef: s.bCoef ?? 1,
            cMask: s.cMask ? parseCollisionFlag(s.cMask) : CollisionFlags.all,
            cGroup: s.cGroup ? parseCollisionFlag(s.cGroup) : CollisionFlags.all
        }));

        this.planes = (stadium.planes || []).map(p => ({
            normal: { x: p.normal?.[0] || 0, y: p.normal?.[1] || 0 },
            dist: p.dist || 0,
            bCoef: p.bCoef ?? 1,
            cMask: p.cMask ? parseCollisionFlag(p.cMask) : CollisionFlags.all,
            cGroup: p.cGroup ? parseCollisionFlag(p.cGroup) : CollisionFlags.all
        }));

        this.goals = (stadium.goals || []).map(g => ({
            p0: { x: g.p0?.[0] || 0, y: g.p0?.[1] || 0 },
            p1: { x: g.p1?.[0] || 0, y: g.p1?.[1] || 0 },
            team: g.team || 'red'
        }));

        this.discs = [];
        for (const d of (stadium.discs || [])) {
            this.discs.push(new Disc({
                x: d.pos?.[0] || 0, y: d.pos?.[1] || 0,
                radius: d.radius || 10,
                invMass: d.invMass ?? 0,
                bCoef: d.bCoef ?? 0.5,
                damping: d.damping ?? 0.99,
                cMask: d.cMask ? parseCollisionFlag(d.cMask) : CollisionFlags.all,
                cGroup: d.cGroup ? parseCollisionFlag(d.cGroup) : CollisionFlags.all
            }));
        }

        this.ballDisc = this.discs.length > 0 ? this.discs[0] : null;

        // Kickoff state
        this.kickOffTeam = null;
        this.kickOffReset = false;
    }

    setKickOffTeam(team) {
        this.kickOffTeam = team;
        this.kickOffReset = true;
    }

    addPlayerDisc(playerPhysics, team, x, y, ownerId) {
        const disc = new Disc({
            x, y,
            radius: playerPhysics.radius || 15,
            invMass: playerPhysics.invMass ?? 0.5,
            bCoef: playerPhysics.bCoef ?? 0.5,
            damping: playerPhysics.damping ?? 0.96,
            acceleration: playerPhysics.acceleration ?? 0.1,
            kickingAcceleration: playerPhysics.kickingAcceleration ?? 0.07,
            kickingDamping: playerPhysics.kickingDamping ?? 0.96,
            kickStrength: playerPhysics.kickStrength ?? 5,
            isPlayer: true,
            ownerId,
            team,
            cMask: CollisionFlags.all,
            cGroup: CollisionFlags[team] || CollisionFlags.all
        });
        this.discs.push(disc);
        return this.discs.length - 1; // return index
    }

    removeDisc(index) {
        if (index >= 0 && index < this.discs.length) {
            this.discs.splice(index, 1);
        }
    }

    step() {
        for (const disc of this.discs) {
            if (!disc.isPlayer) continue;
            const accel = disc.kicking ? disc.kickingAcceleration : disc.acceleration;
            if (disc.input.up) disc.speed.y -= accel;
            if (disc.input.down) disc.speed.y += accel;
            if (disc.input.left) disc.speed.x -= accel;
            if (disc.input.right) disc.speed.x += accel;
            if (disc.input.kick && !disc.kicking) {
                disc.kicking = true;
                this._performKick(disc);
            } else if (!disc.input.kick) {
                disc.kicking = false;
            }
        }

        for (const disc of this.discs) {
            if (disc.invMass === 0) continue;
            const damp = disc.isPlayer && disc.kicking ? disc.kickingDamping : disc.damping;
            disc.speed.x *= damp;
            disc.speed.y *= damp;
            disc.pos.x += disc.speed.x;
            disc.pos.y += disc.speed.y;
        }

        this._applyKickOffConstraints();

        for (let i = 0; i < this.discs.length; i++) {
            for (let j = i + 1; j < this.discs.length; j++) {
                this._collideDiscs(this.discs[i], this.discs[j]);
            }
        }

        for (const disc of this.discs) {
            if (disc.invMass === 0) continue;
            for (const v of this.vertexes) {
                if (!(disc.cMask & v.cGroup) || !(v.cMask & disc.cGroup)) continue;
                this._collideDiscVertex(disc, v);
            }
        }

        for (const disc of this.discs) {
            if (disc.invMass === 0) continue;
            for (const seg of this.segments) {
                if (!(disc.cMask & seg.cGroup) || !(seg.cMask & disc.cGroup)) continue;
                this._collideDiscSegment(disc, seg);
            }
        }

        for (const disc of this.discs) {
            if (disc.invMass === 0) continue;
            for (const plane of this.planes) {
                if (!(disc.cMask & plane.cGroup) || !(plane.cMask & disc.cGroup)) continue;
                this._collideDiscPlane(disc, plane);
            }
        }

        return this._checkGoals();
    }

    _performKick(playerDisc) {
        if (!this.ballDisc) return false;

        // Kickoff rule: ONLY the kickoff team can kick the ball during reset
        if (this.kickOffReset && playerDisc.team !== this.kickOffTeam) {
            return false;
        }

        const dx = this.ballDisc.pos.x - playerDisc.pos.x;
        const dy = this.ballDisc.pos.y - playerDisc.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = playerDisc.radius + this.ballDisc.radius + 4;

        if (dist < minDist && dist > 0) {
            // Kickoff team touched via kick
            if (this.kickOffReset && playerDisc.team === this.kickOffTeam) {
                this.kickOffReset = false;
            }

            const nx = dx / dist;
            const ny = dy / dist;
            this.ballDisc.speed.x += nx * playerDisc.kickStrength;
            this.ballDisc.speed.y += ny * playerDisc.kickStrength;
            return true;
        }
        return false;
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
                
                // Defending team is pushed OUT of the circle (radius + disc radius)
                const defendMinDist = kickOffRadius + disc.radius;

                if (isDefending) {
                    // 1. Defending team (scored) strictly in their half
                    if (isRed && disc.pos.x + disc.radius > 0) {
                        disc.pos.x = -disc.radius;
                        if (disc.speed.x > 0) disc.speed.x = 0;
                    } else if (!isRed && disc.pos.x - disc.radius < 0) {
                        disc.pos.x = disc.radius;
                        if (disc.speed.x < 0) disc.speed.x = 0;
                    }

                    // 2. Defending team blocked FROM center circle
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
                    // 3. Kickoff team (conceded)
                    // If center of player is OUTSIDE the center circle, apply half-line constraint
                    const inCircle = dist < kickOffRadius;
                    if (!inCircle) {
                        if (isRed && disc.pos.x + disc.radius > 0) {
                            disc.pos.x = -disc.radius;
                            if (disc.speed.x > 0) disc.speed.x = 0;
                        } else if (!isRed && disc.pos.x - disc.radius < 0) {
                            disc.pos.x = disc.radius;
                            if (disc.speed.x < 0) disc.speed.x = 0;
                        }
                    }
                }
            }
        }
    }

    _collideDiscs(a, b) {
        if (a.invMass === 0 && b.invMass === 0) return;

        // Kickoff rule handling: NO collision with ball for defending team
        if (this.kickOffReset) {
            const isBall = (a === this.ballDisc || b === this.ballDisc);
            if (isBall) {
                const playerDisc = a === this.ballDisc ? b : a;
                if (playerDisc.isPlayer) {
                    if (playerDisc.team === this.kickOffTeam) {
                        // Allow collision, will reset kickoff state in _performKick or here if it's a touch
                        // Actually, Haxball reset only happens on 'touch' or 'kick'
                        // If it's a touch (not kick), we reset here:
                        // Since _collideDiscs handles physical response, we check if they are close enough
                        const dx = b.pos.x - a.pos.x;
                        const dy = b.pos.y - a.pos.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < a.radius + b.radius) {
                            this.kickOffReset = false;
                        }
                    } else {
                        return; // Non-kickoff team ignores collision completely (ghost ball)
                    }
                }
            }
        }

        if (!(a.cMask & b.cGroup) || !(b.cMask & a.cGroup)) return;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.radius + b.radius;
        if (dist >= minDist || dist === 0) return;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        const totalInvMass = a.invMass + b.invMass;
        if (totalInvMass === 0) return;
        a.pos.x -= nx * overlap * (a.invMass / totalInvMass);
        a.pos.y -= ny * overlap * (a.invMass / totalInvMass);
        b.pos.x += nx * overlap * (b.invMass / totalInvMass);
        b.pos.y += ny * overlap * (b.invMass / totalInvMass);
        const dvx = b.speed.x - a.speed.x;
        const dvy = b.speed.y - a.speed.y;
        const dvn = dvx * nx + dvy * ny;
        if (dvn > 0) return;
        const bCoef = Math.min(a.bCoef, b.bCoef);
        const j = -(1 + bCoef) * dvn / totalInvMass;
        a.speed.x -= j * a.invMass * nx;
        a.speed.y -= j * a.invMass * ny;
        b.speed.x += j * b.invMass * nx;
        b.speed.y += j * b.invMass * ny;
    }

    _collideDiscVertex(disc, v) {
        const dx = disc.pos.x - v.x;
        const dy = disc.pos.y - v.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= disc.radius || dist === 0) return;
        const nx = dx / dist;
        const ny = dy / dist;
        disc.pos.x = v.x + nx * disc.radius;
        disc.pos.y = v.y + ny * disc.radius;
        const vn = disc.speed.x * nx + disc.speed.y * ny;
        if (vn >= 0) return;
        const bCoef = Math.min(disc.bCoef, v.bCoef);
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
        const nx = -uy;
        const ny = ux;
        const dx = disc.pos.x - v0.x;
        const dy = disc.pos.y - v0.y;
        const dist = dx * nx + dy * ny;
        if (Math.abs(dist) >= disc.radius) return;
        const proj = dx * ux + dy * uy;
        if (proj < 0 || proj > len) return;
        const sign = dist >= 0 ? 1 : -1;
        disc.pos.x += (disc.radius * sign - dist) * nx;
        disc.pos.y += (disc.radius * sign - dist) * ny;
        const vn = disc.speed.x * nx + disc.speed.y * ny;
        if (vn * sign >= 0) return;
        const bCoef = Math.min(disc.bCoef, seg.bCoef);
        disc.speed.x -= (1 + bCoef) * vn * nx;
        disc.speed.y -= (1 + bCoef) * vn * ny;
    }

    _collideDiscCurvedSegment(disc, v0, v1, seg) {
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
        const ddx = disc.pos.x - cx;
        const ddy = disc.pos.y - cy;
        const distToCenter = Math.sqrt(ddx * ddx + ddy * ddy);
        if (distToCenter === 0) return;
        const distFromArc = Math.abs(distToCenter - arcRadius);
        if (distFromArc >= disc.radius) return;
        const a0 = Math.atan2(v0.y - cy, v0.x - cx);
        const a1 = Math.atan2(v1.y - cy, v1.x - cx);
        const ad = Math.atan2(disc.pos.y - cy, disc.pos.x - cx);
        if (!this._isAngleBetween(ad, a0, a1, curveRad > 0)) return;
        const sign = distToCenter > arcRadius ? 1 : -1;
        const cnx = ddx / distToCenter;
        const cny = ddy / distToCenter;
        if (sign > 0) {
            disc.pos.x = cx + cnx * (arcRadius + disc.radius);
            disc.pos.y = cy + cny * (arcRadius + disc.radius);
        } else {
            disc.pos.x = cx + cnx * (arcRadius - disc.radius);
            disc.pos.y = cy + cny * (arcRadius - disc.radius);
        }
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
        return clockwise ? a <= e : (a >= e || e === 0);
    }

    _collideDiscPlane(disc, plane) {
        const dot = disc.pos.x * plane.normal.x + disc.pos.y * plane.normal.y;
        const dist = dot - plane.dist;
        if (dist >= disc.radius) return;
        disc.pos.x += (disc.radius - dist) * plane.normal.x;
        disc.pos.y += (disc.radius - dist) * plane.normal.y;
        const vn = disc.speed.x * plane.normal.x + disc.speed.y * plane.normal.y;
        if (vn >= 0) return;
        const bCoef = Math.min(disc.bCoef, plane.bCoef);
        disc.speed.x -= (1 + bCoef) * vn * plane.normal.x;
        disc.speed.y -= (1 + bCoef) * vn * plane.normal.y;
    }

    _checkGoals() {
        if (!this.ballDisc) return null;
        for (const goal of this.goals) {
            const gx = (goal.p0.x + goal.p1.x) / 2;
            const gy0 = Math.min(goal.p0.y, goal.p1.y);
            const gy1 = Math.max(goal.p0.y, goal.p1.y);

            // Ball y must be within goal width
            if (this.ballDisc.pos.y < gy0 || this.ballDisc.pos.y > gy1) continue;

            // Full ball entry check: entire ball must cross the goal line (gx)
            if (gx < 0) { // Left Goal (Red defending, Blue scoring)
                if (this.ballDisc.pos.x < gx - this.ballDisc.radius) return goal.team;
            } else { // Right Goal (Blue defending, Red scoring)
                if (this.ballDisc.pos.x > gx + this.ballDisc.radius) return goal.team;
            }
        }
        return null;
    }

    getState() {
        return {
            discs: this.discs.map(d => ({
                x: Math.round(d.pos.x * 100) / 100,
                y: Math.round(d.pos.y * 100) / 100,
                sx: Math.round(d.speed.x * 100) / 100,
                sy: Math.round(d.speed.y * 100) / 100,
                kicking: d.kicking,
                isPlayer: d.isPlayer,
                ...(d.isPlayer ? { team: d.team, radius: d.radius, name: d._playerName, avatar: d._avatar, typing: d.typing, id: d.ownerId || d.id } : { radius: d.radius, color: d.color })
            }))
        };
    }

    applyState(state) {
        if (!state.discs) return;

        // Ensure disc array size matches
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

            // Apply metadata
            if (sd.isPlayer !== undefined) {
                disc.isPlayer = sd.isPlayer;
                disc.team = sd.team;
                if (sd.name) disc._playerName = sd.name;
                if (sd.avatar) disc._avatar = sd.avatar;
                if (sd.id) disc.ownerId = sd.id; // Server uses ownerId instead of id
            } else if (sd.color) {
                disc.color = sd.color;
            }
            if (sd.kicking !== undefined) disc.kicking = sd.kicking;
            if (sd.typing !== undefined) disc.typing = sd.typing;
            if (sd.radius) disc.radius = sd.radius;

            // Apply position and speed directly
            disc.pos.x = sd.x;
            disc.pos.y = sd.y;
            disc.speed.x = sd.sx;
            disc.speed.y = sd.sy;
        }
    }

    resetPositions() {
        for (const disc of this.discs) disc.reset();
    }
}
