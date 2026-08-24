/**
 * MapManager - Server-authoritative map registry
 *
 * - All built-in maps are defined here (single source of truth).
 * - Each map has an ID, display name, and a content hash for dedup.
 * - External .hbs maps can be loaded from the maps/ directory at startup.
 * - Clients never supply raw map geometry; they reference map IDs.
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Built-in map definitions ────────────────────────────────────────────────

const classicFieldW = 370;
const classicFieldH = 170;

function createStadium(name, fieldW, fieldH, spawnDist = 170) {
    const goalDepth = Math.round(fieldW * (40 / classicFieldW));
    const goalWidth = Math.round(fieldH * (64 / classicFieldH));
    const goalBackWidth = Math.round(goalWidth * (44 / 64));
    const kickOffRadius = Math.round(fieldH * (75 / classicFieldH));

    return {
        name,
        width: fieldW + goalDepth + 10,
        height: fieldH + 30,
        spawnDistance: spawnDist,
        bg: {
            type: "grass", width: fieldW, height: fieldH,
            kickOffRadius, cornerRadius: 0,
            color: "699057", stripeColor: "7B9F6C", bgColor: "718D5A",
            lineColor: "C7E6BD", showCenterLine: true, showKickOffCircle: true
        },
        vertexes: [
            { x: -fieldW, y: fieldH, bCoef: 0.1, cMask: ["ball"] },
            { x: -fieldW, y: goalWidth, bCoef: 0.1, cMask: ["ball"] },
            { x: -fieldW, y: -goalWidth, bCoef: 0.1, cMask: ["ball"] },
            { x: -fieldW, y: -fieldH, bCoef: 0.1, cMask: ["ball"] },
            { x: fieldW, y: fieldH, bCoef: 0.1, cMask: ["ball"] },
            { x: fieldW, y: goalWidth, bCoef: 0.1, cMask: ["ball"] },
            { x: fieldW, y: -goalWidth, bCoef: 0.1, cMask: ["ball"] },
            { x: fieldW, y: -fieldH, bCoef: 0.1, cMask: ["ball"] },
            { x: 0, y: fieldH, bCoef: 0.1, cMask: [], cGroup: [] },
            { x: 0, y: -fieldH, bCoef: 0.1, cMask: [], cGroup: [] },
            { x: -(fieldW + goalDepth), y: goalBackWidth, bCoef: 0.1, cMask: ["ball"] },
            { x: -(fieldW + goalDepth), y: -goalBackWidth, bCoef: 0.1, cMask: ["ball"] },
            { x: (fieldW + goalDepth), y: goalBackWidth, bCoef: 0.1, cMask: ["ball"] },
            { x: (fieldW + goalDepth), y: -goalBackWidth, bCoef: 0.1, cMask: ["ball"] }
        ],
        segments: [
            { v0: 0, v1: 8, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 8, v1: 4, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 3, v1: 9, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 9, v1: 7, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 0, v1: 1, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 2, v1: 3, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 4, v1: 5, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 6, v1: 7, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 1, v1: 10, curve: 90, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] },
            { v0: 10, v1: 11, curve: 0, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] },
            { v0: 11, v1: 2, curve: 90, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] },
            { v0: 5, v1: 12, curve: -90, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] },
            { v0: 12, v1: 13, curve: 0, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] },
            { v0: 13, v1: 6, curve: -90, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] }
        ],
        goals: [
            { p0: [-fieldW, goalWidth], p1: [-fieldW, -goalWidth], team: "red" },
            { p0: [fieldW, goalWidth], p1: [fieldW, -goalWidth], team: "blue" }
        ],
        discs: [
            { pos: [0, 0], radius: 10, invMass: 1, bCoef: 0.5, damping: 0.99, color: "FFFFFF", cMask: ["all"], cGroup: ["ball"] },
            { pos: [-fieldW, goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: "CCCCFF", cMask: ["all"] },
            { pos: [-fieldW, -goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: "CCCCFF", cMask: ["all"] },
            { pos: [fieldW, goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: "CCCCFF", cMask: ["all"] },
            { pos: [fieldW, -goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: "CCCCFF", cMask: ["all"] }
        ],
        planes: [
            { normal: [0, 1], dist: -(fieldH + 30), bCoef: 0.1, cMask: ["all"] },
            { normal: [0, -1], dist: -(fieldH + 30), bCoef: 0.1, cMask: ["all"] },
            { normal: [1, 0], dist: -(fieldW + goalDepth + 10), bCoef: 0.1, cMask: ["all"] },
            { normal: [-1, 0], dist: -(fieldW + goalDepth + 10), bCoef: 0.1, cMask: ["all"] }
        ],
        playerPhysics: {
            radius: 15, bCoef: 0.5, invMass: 0.5, damping: 0.96,
            acceleration: 0.10, kickingAcceleration: 0.065, kickingDamping: 0.96, kickStrength: 5
        },
        ballPhysics: "disc0"
    };
}

const FUTSAL_MAP = {
    name: "Futsal 3v3",
    width: 520, height: 260, spawnDistance: 180,
    bg: {
        type: "grass", width: 460, height: 220,
        kickOffRadius: 75, cornerRadius: 0,
        color: "4A4A4A", stripeColor: "4A4A4A", bgColor: "3A3A3A",
        lineColor: "FFFFFF", showCenterLine: true, showKickOffCircle: true,
        centerLineColor: "666666", useStarballImage: true
    },
    vertexes: [
        { x: -460, y: 220, bCoef: 0.1, cMask: ["ball"] },
        { x: -460, y: 75, bCoef: 0.1, cMask: ["ball"] },
        { x: -460, y: -75, bCoef: 0.1, cMask: ["ball"] },
        { x: -460, y: -220, bCoef: 0.1, cMask: ["ball"] },
        { x: 460, y: 220, bCoef: 0.1, cMask: ["ball"] },
        { x: 460, y: 75, bCoef: 0.1, cMask: ["ball"] },
        { x: 460, y: -75, bCoef: 0.1, cMask: ["ball"] },
        { x: 460, y: -220, bCoef: 0.1, cMask: ["ball"] },
        { x: 0, y: 220, bCoef: 0.1, cMask: [], cGroup: [] },
        { x: 0, y: -220, bCoef: 0.1, cMask: [], cGroup: [] },
        { x: -500, y: 75, bCoef: 0.1, cMask: ["ball"] },
        { x: -500, y: -75, bCoef: 0.1, cMask: ["ball"] },
        { x: 500, y: 75, bCoef: 0.1, cMask: ["ball"] },
        { x: 500, y: -75, bCoef: 0.1, cMask: ["ball"] }
    ],
    segments: [
        { v0: 0, v1: 8, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
        { v0: 8, v1: 4, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
        { v0: 3, v1: 9, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
        { v0: 9, v1: 7, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
        { v0: 0, v1: 1, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
        { v0: 2, v1: 3, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
        { v0: 4, v1: 5, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
        { v0: 6, v1: 7, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
        { v0: 1, v1: 10, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] },
        { v0: 10, v1: 11, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] },
        { v0: 11, v1: 2, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] },
        { v0: 5, v1: 12, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] },
        { v0: 12, v1: 13, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] },
        { v0: 13, v1: 6, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] }
    ],
    goals: [
        { p0: [-460, 75], p1: [-460, -75], team: "red" },
        { p0: [460, 75], p1: [460, -75], team: "blue" }
    ],
    discs: [
        { pos: [0, 0], radius: 9, invMass: 1.8, bCoef: 0.8, damping: 0.992, color: "FFB82E", cMask: ["all"], cGroup: ["ball"] },
        { pos: [-460, 75], radius: 4, invMass: 0, bCoef: 0.5, color: "c70000", cMask: ["all"] },
        { pos: [-460, -75], radius: 4, invMass: 0, bCoef: 0.5, color: "c70000", cMask: ["all"] },
        { pos: [460, 75], radius: 4, invMass: 0, bCoef: 0.5, color: "00008c", cMask: ["all"] },
        { pos: [460, -75], radius: 4, invMass: 0, bCoef: 0.5, color: "00008c", cMask: ["all"] }
    ],
    planes: [
        { normal: [0, 1], dist: -250, bCoef: 0.1, cMask: ["all"] },
        { normal: [0, -1], dist: -250, bCoef: 0.1, cMask: ["all"] },
        { normal: [1, 0], dist: -540, bCoef: 0.1, cMask: ["all"] },
        { normal: [-1, 0], dist: -540, bCoef: 0.1, cMask: ["all"] }
    ],
    playerPhysics: {
        radius: 16.0, bCoef: 0.5, invMass: 0.5, damping: 0.96,
        acceleration: 0.11, kickingAcceleration: 0.07, kickingDamping: 0.96, kickStrength: 7.0
    },
    ballPhysics: "disc0"
};

// ─── Registry ────────────────────────────────────────────────────────────────

// Built-in maps (ordered by typical usage)
const BUILTIN_MAPS = {
    small:  createStadium("Küçük", 250, 120, 120),
    futsal: FUTSAL_MAP,
    classic: createStadium("Klasik", 370, 170, 170),
    big:    createStadium("Büyük", 550, 270, 300),
    huge:   createStadium("Devasa", 750, 370, 450),
};

// ─── Hash helper ─────────────────────────────────────────────────────────────

function computeHash(mapData) {
    // Deterministic JSON: sort keys, no circular refs
    const canonical = JSON.stringify(mapData, Object.keys(mapData).sort());
    return createHash('sha256').update(canonical).digest('hex').slice(0, 16); // 64-bit short hash
}

// ─── MapManager class ────────────────────────────────────────────────────────

class MapManagerClass {
    constructor() {
        /** @type {Map<string, {id: string, data: object, hash: string}>} */
        this.registry = new Map();
        this._hashCache = new Map(); // mapId -> hash (lazy computed)

        // Register built-in maps
        for (const [id, data] of Object.entries(BUILTIN_MAPS)) {
            this.registry.set(id, { id, data });
        }

        // Attempt to load .hbs files from maps/ directory
        this._loadExternalMaps();
    }

    /**
     * Load .hbs files from the maps/ directory
     */
    _loadExternalMaps() {
        const mapsDir = path.join(__dirname, '..', 'maps');
        try {
            if (!fs.existsSync(mapsDir)) {
                fs.mkdirSync(mapsDir, { recursive: true });
                console.log('[MapManager] Created maps/ directory');
                return;
            }
            const files = fs.readdirSync(mapsDir).filter(f => f.endsWith('.hbs'));
            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(mapsDir, file), 'utf-8');
                    const data = JSON.parse(content);
                    const id = file.replace('.hbs', '').toLowerCase();
                    if (!this.registry.has(id)) {
                        this.registry.set(id, { id, data });
                        console.log(`[MapManager] Loaded external map: ${id} (${data.name || file})`);
                    }
                } catch (e) {
                    console.warn(`[MapManager] Failed to load ${file}:`, e.message);
                }
            }
        } catch (e) {
            // maps/ directory doesn't exist or can't be read — not fatal
        }
    }

    /**
     * Get full map data by ID
     * @param {string} mapId
     * @returns {object|null}
     */
    getMap(mapId) {
        const entry = this.registry.get(mapId);
        return entry ? entry.data : null;
    }

    /**
     * Get map hash by ID (lazy-computed, cached)
     * @param {string} mapId
     * @returns {string|null}
     */
    getHash(mapId) {
        if (this._hashCache.has(mapId)) return this._hashCache.get(mapId);
        const entry = this.registry.get(mapId);
        if (!entry) return null;
        const hash = computeHash(entry.data);
        this._hashCache.set(mapId, hash);
        return hash;
    }

    /**
     * Check if a map ID is valid
     * @param {string} mapId
     * @returns {boolean}
     */
    isValid(mapId) {
        return this.registry.has(mapId);
    }

    /**
     * Get list of all available maps (id + display name + hash)
     * @returns {Array<{id: string, name: string, hash: string}>}
     */
    getMapList() {
        const list = [];
        for (const [id, entry] of this.registry) {
            list.push({
                id,
                name: entry.data.name || id,
                hash: this.getHash(id)
            });
        }
        return list;
    }

    /**
     * Register a custom map (e.g., from HBS upload)
     * @param {string} id
     * @param {object} data
     * @returns {string} hash
     */
    registerMap(id, data) {
        this.registry.set(id, { id, data });
        this._hashCache.delete(id); // invalidate cache
        return this.getHash(id);
    }

    /**
     * Get the default map ID
     * @returns {string}
     */
    getDefaultMapId() {
        return 'classic';
    }
}

export const MapManager = new MapManagerClass();
