import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MapManager } from './MapManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadExternalMaps() {
    const mapsDir = path.join(__dirname, '..', 'maps');
    if (!fs.existsSync(mapsDir)) {
        fs.mkdirSync(mapsDir, { recursive: true });
        return;
    }

    for (const file of fs.readdirSync(mapsDir).filter(name => name.endsWith('.hbs'))) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(mapsDir, file), 'utf-8'));
            const id = file.replace(/\.hbs$/i, '').toLowerCase();
            if (!MapManager.isValid(id)) {
                MapManager.registerMap(id, data);
                console.log(`[MapManager] Loaded external map: ${id} (${data.name || file})`);
            }
        } catch (error) {
            console.warn(`[MapManager] Failed to load ${file}:`, error.message);
        }
    }
}
