/**
 * Stadium loader and HBS file parser
 * Supports Haxball-compatible .hbs JSON5 format
 */
import JSON5 from 'json5';
import { parseCollisionFlag, CollisionFlags } from './Physics.js';

// Default player physics
export const DEFAULT_PLAYER_PHYSICS = {
    radius: 15,
    bCoef: 0.1,
    invMass: 0.3,
    damping: 0.96,
    acceleration: 0.06,
    kickingAcceleration: 0.04,
    kickingDamping: 0.96,
    kickStrength: 5
};

export class Stadium {
    constructor() {
        this.name = '';
        this.width = 420;
        this.height = 200;
        this.spawnDistance = 170;
        this.bg = {
            type: 'grass',
            width: 370,
            height: 170,
            kickOffRadius: 75,
            cornerRadius: 0,
            color: null
        };
        this.vertexes = [];
        this.segments = [];
        this.goals = [];
        this.discs = [];
        this.planes = [];
        this.playerPhysics = { ...DEFAULT_PLAYER_PHYSICS };
        this.ballPhysics = 'disc0';
    }

    /**
     * Parse an HBS file string
     */
    static parse(hbsString) {
        const data = JSON5.parse(hbsString);
        const stadium = new Stadium();

        stadium.name = data.name || 'Unnamed';
        stadium.width = data.width ?? 420;
        stadium.height = data.height ?? 200;
        stadium.spawnDistance = data.spawnDistance ?? 170;

        // Background
        if (data.bg) {
            stadium.bg = {
                type: data.bg.type || 'grass',
                width: data.bg.width ?? stadium.width - 50,
                height: data.bg.height ?? stadium.height - 30,
                kickOffRadius: data.bg.kickOffRadius ?? 75,
                cornerRadius: data.bg.cornerRadius ?? 0,
                color: data.bg.color || null
            };
        }

        // Vertexes
        stadium.vertexes = (data.vertexes || []).map(v => ({
            x: v.x || 0,
            y: v.y || 0,
            bCoef: v.bCoef ?? 1,
            cMask: v.cMask ? parseCollisionFlag(v.cMask) : CollisionFlags.all,
            cGroup: v.cGroup ? parseCollisionFlag(v.cGroup) : CollisionFlags.all
        }));

        // Segments
        stadium.segments = (data.segments || []).map(s => ({
            v0: s.v0 ?? 0,
            v1: s.v1 ?? 1,
            curve: s.curve || 0,
            bCoef: s.bCoef ?? 1,
            vis: s.vis !== false,
            color: Stadium.parseColor(s.color) || 'C7E6BD',
            cMask: s.cMask ? parseCollisionFlag(s.cMask) : CollisionFlags.all,
            cGroup: s.cGroup ? parseCollisionFlag(s.cGroup) : CollisionFlags.all
        }));

        // Goals
        stadium.goals = (data.goals || []).map(g => ({
            p0: g.p0 || [0, 0],
            p1: g.p1 || [0, 0],
            team: g.team || 'red'
        }));

        // Discs
        stadium.discs = (data.discs || []).map(d => ({
            pos: d.pos || [0, 0],
            radius: d.radius || 10,
            invMass: d.invMass ?? 0,
            bCoef: d.bCoef ?? 0.5,
            damping: d.damping ?? 0.99,
            color: Stadium.parseColor(d.color) || 'FFFFFF',
            cMask: d.cMask ? parseCollisionFlag(d.cMask) : CollisionFlags.all,
            cGroup: d.cGroup ? parseCollisionFlag(d.cGroup) : CollisionFlags.all
        }));

        // Planes
        stadium.planes = (data.planes || []).map(p => ({
            normal: p.normal || [0, 1],
            dist: p.dist || 0,
            bCoef: p.bCoef ?? 1,
            cMask: p.cMask ? parseCollisionFlag(p.cMask) : CollisionFlags.all,
            cGroup: p.cGroup ? parseCollisionFlag(p.cGroup) : CollisionFlags.all
        }));

        // Player physics
        if (data.playerPhysics) {
            stadium.playerPhysics = {
                ...DEFAULT_PLAYER_PHYSICS,
                ...data.playerPhysics
            };
        }

        // Ball physics
        stadium.ballPhysics = data.ballPhysics || 'disc0';

        return stadium;
    }

    /**
     * Parse color from HBS format (hex string or [r,g,b] array)
     */
    static parseColor(color) {
        if (!color) return null;
        if (typeof color === 'string') return color.replace('#', '');
        if (Array.isArray(color)) {
            return color.map(c => c.toString(16).padStart(2, '0')).join('');
        }
        return null;
    }

    /**
     * Get spawn positions for a team
     */
    getSpawnPositions(team, count) {
        const positions = [];
        const xSign = team === 'red' ? -1 : 1;
        const xBase = this.spawnDistance * xSign;
        const spacing = 40;

        for (let i = 0; i < count; i++) {
            const yOffset = (i - (count - 1) / 2) * spacing;
            positions.push({ x: xBase, y: yOffset });
        }

        return positions;
    }

    /**
     * Convert to raw data (for network)
     */
    toJSON() {
        return {
            name: this.name,
            width: this.width,
            height: this.height,
            spawnDistance: this.spawnDistance,
            bg: this.bg,
            vertexes: this.vertexes,
            segments: this.segments,
            goals: this.goals,
            discs: this.discs,
            planes: this.planes,
            playerPhysics: this.playerPhysics,
            ballPhysics: this.ballPhysics
        };
    }
}
