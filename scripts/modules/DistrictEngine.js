/**
 * DistrictEngine.js — Deterministic District Zoning System
 */

export class DistrictEngine {

    /**
     * Fast deterministic integer hash.
     * Maps any (x, z) pair to a stable pseudo-random integer.
     */
    static _hash(x, z) {
        let h = (x * 374761393 + z * 668265263) | 0;
        h = ((h ^ (h >>> 13)) * 1274126177) | 0;
        return Math.abs(h ^ (h >>> 16));
    }

    /**
     * Returns the grid coordinates of district seed points within
     * (INFLUENCE_RADIUS * 2) cells of (gridX, gridZ).
     */
    static _nearbySeeds(gridX, gridZ, districtConfig, districtTypes) {
        const { SEED_SPACING, INFLUENCE_RADIUS } = districtConfig;
        
        const searchRange = Math.ceil((INFLUENCE_RADIUS * 1.5) / SEED_SPACING);
        const seeds = [];

        const baseSeedX = Math.floor(gridX / SEED_SPACING);
        const baseSeedZ = Math.floor(gridZ / SEED_SPACING);

        for (let sx = baseSeedX - searchRange; sx <= baseSeedX + searchRange; sx++) {
            for (let sz = baseSeedZ - searchRange; sz <= baseSeedZ + searchRange; sz++) {
                const wx = sx * SEED_SPACING;
                const wz = sz * SEED_SPACING;
                const distSq = (wx - gridX) ** 2 + (wz - gridZ) ** 2;
                if (distSq <= (INFLUENCE_RADIUS * INFLUENCE_RADIUS)) {
                    const typeIndex = this._hash(sx, sz) % districtTypes.length;
                    seeds.push({ gx: wx, gz: wz, type: districtTypes[typeIndex], distSq });
                }
            }
        }

        return seeds;
    }

    /**
     * Returns weighted influence of each district type at (gridX, gridZ).
     * Uses inverse-square-law for smooth, organic border blending.
     */
    static getDistrictWeights(gridX, gridZ, districtConfig, districtTypes) {
        const seeds = this._nearbySeeds(gridX, gridZ, districtConfig, districtTypes);
        const weights = {};
        for (const seed of seeds) {
            const influence = 1 / (seed.distSq + 1);
            weights[seed.type] = (weights[seed.type] || 0) + influence;
        }
        return weights;
    }

    /**
     * Returns the dominant district type at (gridX, gridZ).
     * Uses organic weighted blending with deterministic noise for
     * natural zone transitions instead of hard mathematical lines.
     */
    static getDistrictType(gridX, gridZ, cache, districtConfig, districtTypes) {
        const key = `${gridX},${gridZ}`;
        if (cache.has(key)) return cache.get(key);

        const weights = this.getDistrictWeights(gridX, gridZ, districtConfig, districtTypes);
        let best = null;
        let maxWeight = -Infinity;

        for (const [type, weight] of Object.entries(weights)) {
            const noise = (this._hash(gridX + type.charCodeAt(0), gridZ) % 10) / 100;
            const finalWeight = weight + noise;
            if (finalWeight > maxWeight) { maxWeight = finalWeight; best = type; }
        }

        const result = best || "COMMERCIAL";
        cache.set(key, result);
        return result;
    }

    /**
     * Returns a district match score bonus for a candidate structure.
     * Matching district = strong bonus  (+30)
     * Adjacent district = small bonus   (+10)
     * Mismatching zone  = penalty       (-20)
     *
     * @param {string} structureDistrict  - USP_TABLE entry's c: field
     * @param {string} cellDistrict       - getDistrictType result for this cell
     */
    static scoreDistrict(structureDistrict, cellDistrict) {
        if (!structureDistrict || !cellDistrict) return 0;
        if (structureDistrict === cellDistrict) return 30;

        const softNeighbors = {
            COMMERCIAL: ["MODERN", "RESIDENTIAL"],
            INDUSTRIAL: ["COMMERCIAL", "SLUMS"],
            RESIDENTIAL: ["COMMERCIAL", "MODERN"],
            MODERN: ["COMMERCIAL", "RESIDENTIAL"],
            SLUMS: ["INDUSTRIAL", "ANCIENT"],
            ANCIENT: ["SLUMS", "INDUSTRIAL"]
        };
        const neighbors = softNeighbors[structureDistrict] || [];
        if (neighbors.includes(cellDistrict)) return 10;

        return -20;
    }

    /**
     * Debug: returns all nearby district seeds with their types.
     */
    static getNearbySeedsDebug(gridX, gridZ, districtConfig, districtTypes) {
        return this._nearbySeeds(gridX, gridZ, districtConfig, districtTypes);
    }

    /**
     * Returns the dominant district type AND whether this cell sits on a
     * district border.
     */
    static getDistrictDetails(gridX, gridZ, cache, districtConfig, districtTypes) {
        const type = this.getDistrictType(gridX, gridZ, cache, districtConfig, districtTypes);
        const weights = this.getDistrictWeights(gridX, gridZ, districtConfig, districtTypes);
        const sortedValues = Object.values(weights).sort((a, b) => b - a);
        const isBorder = sortedValues.length > 1 && (sortedValues[0] - sortedValues[1]) < 0.15;
        return { type, isBorder };
    }
}