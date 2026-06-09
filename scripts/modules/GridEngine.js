/**
 * GridEngine.js — Socket-Only Road Logic + District-Aware Scoring
 *
 * Full-Scale Production Engine (Long-Form Edition):
 * - Bedrock Transformation Order: MIRROR -> ROTATE.
 * - Perimeter boundary scanning optimized for memory-constrained environments (4GB RAM/128MB VRAM).
 * - Complete evaluation matrix including Street Hunger, Jigsaws, Border Zoning, and Spacing.
 *
 * @project InfiniGrid Procedural Generation Engine
 * @author ScalarLabs / Imaturtlebro
 */

import { DistrictEngine } from "./DistrictEngine.js";

export class GridEngine {

    /**
     * Fallback ID placed when no valid structure matching constraints can be calculated.
     * Prevents generation crashes or endless looping by capping the open sequence.
     */
    static FALLBACK_ID = "ruin_placeholder_0000_ancient_gnd";

    /**
     * Complete architectural scoring matrix constants.
     * Tuned for survival/horror procedural generation flows.
     */
    static SCORING = {
        INVALID_MISMATCH: -99999,
        MATCHING_SOCKET: 80,
        DANGLING_PENALTY_BASE: -30,
        DANGLING_PENALTY_MULTI: -25,
        FRONT_DOOR_ALIGNMENT: 1000,
        JUNCTION_MULTIPORT_BONUS: 150,
        DEAD_END_PENALTY: -2000,
        STREET_HUNGER_SCALING: 150,
        SPACING_PENALTY: -800,
        BORDER_MATCH_BONUS: 800,
        BORDER_MISMATCH_PENALTY: -50,
        JIGSAW_MATCH_BONUS: 300,
        JIGSAW_MISMATCH_PENALTY: -300
    };

    /**
     * Splits a string-based grid key back into explicit integer components.
     * @param {string} key - A grid coordinate identifier string matching "x,z".
     * @returns {{x: number, z: number}} Explicit coordinate map.
     */
    static parseGridKey(key) {
        const [x, z] = key.split(",").map(Number);
        return { x, z };
    }

    /**
     * Formats structural cell coordinates into a stable map indexing string.
     * @param {number} x - Target cell horizontal grid index.
     * @param {number} z - Target cell depth grid index.
     * @returns {string} Compiled key.
     */
    static getGridKey(x, z) {
        return `${x},${z}`;
    }

    /**
     * Translates grid coordinate cells into absolute world coordinates.
     * @param {number} gx - Grid cell horizontal index.
     * @param {number} gz - Grid cell depth index.
     * @param {number} gridSize - Linear scale size of a single grid cell.
     * @returns {{x: number, z: number}} World coordinates.
     */
    static gridToWorld(gx, gz, gridSize) {
        return {
            x: gx * gridSize,
            z: gz * gridSize
        };
    }

    /**
     * Translates a baseline directional indicator string across active Bedrock 
     * mirror states and clockwise rotational offsets.
     * @param {string} baseDir - Baseline heading: "north", "east", "south", "west".
     * @param {string} deg - Active rotation angle degrees.
     * @param {string} mir - Active mirroring transformation state string.
     * @returns {string} Transformed absolute direction string.
     */
    static getRotatedDirection(baseDir, deg, mir) {
        if (!baseDir) return null;
        const dirs = ["north", "east", "south", "west"];
        let idx = dirs.indexOf(baseDir.toLowerCase());
        if (idx === -1) return baseDir;

        // Step 1: Handle Bedrock Mirror Mapping
        if (mir === "x") {
            if (baseDir === "east") idx = 3;
            else if (baseDir === "west") idx = 1;
        } else if (mir === "z") {
            if (baseDir === "north") idx = 2;
            else if (baseDir === "south") idx = 0;
        } else if (mir === "xz") {
            if (baseDir === "east") idx = 3;
            else if (baseDir === "west") idx = 1;
            if (dirs[idx] === "north") idx = 2;
            else if (dirs[idx] === "south") idx = 0;
        }

        // Step 2: Handle Clockwise Rotation Steps
        if (deg === "90_degrees" || deg === "90") {
            idx = (idx + 1) % 4;
        } else if (deg === "180_degrees" || deg === "180") {
            idx = (idx + 2) % 4;
        } else if (deg === "270_degrees" || deg === "270") {
            idx = (idx + 3) % 4;
        }

        return dirs[idx];
    }

    /**
     * Unpacks and transforms directional bitmasks from structure data tables,
     * maintaining Bedrock alignment ordering guidelines (MIRROR then ROTATE).
     * @param {string} id - Unique target identifier.
     * @param {object} structureData - Extracted configuration assets maps.
     * @param {string} deg - Selected rotation parameter state string.
     * @param {string} mir - Selected mirror plane indicator configuration.
     * @returns {object} Transformed architectural properties mapping object.
     */
    static getUSP(id, structureData, deg = "0_degrees", mir = "none") {
        if (id.startsWith("FILL:")) {
            return { north: 0, east: 0, south: 0, west: 0, c: "COMMERCIAL", e: "G", w: 1, a: 1, f: null, o: 0, isBorder: false };
        }
        const base = structureData.USP_TABLE[id];
        if (!base) {
            return { north: 0, east: 0, south: 0, west: 0, c: "COMMERCIAL", e: "G", w: 1, a: 1, f: null, o: 0, isBorder: false };
        }

        let bitmask = base.u || "0000"; // Order: North, East, South, West
        let n = parseInt(bitmask[0], 10) || 0;
        let e = parseInt(bitmask[1], 10) || 0;
        let s = parseInt(bitmask[2], 10) || 0;
        let w = parseInt(bitmask[3], 10) || 0;

        // Phase 1: Mirroring Modifications (Bedrock Standard Order Requirement)
        if (mir === "x") {
            const temp = e; e = w; w = temp;
        } else if (mir === "z") {
            const temp = n; n = s; s = temp;
        } else if (mir === "xz") {
            let temp = e; e = w; w = temp;
            temp = n; n = s; s = temp;
        }

        // Phase 2: Clockwise Rotation Shifting
        if (deg === "90_degrees" || deg === "90") {
            const temp = n; n = w; w = s; s = e; e = temp;
        } else if (deg === "180_degrees" || deg === "180") {
            let temp = n; n = s; s = temp;
            temp = e; e = w; w = temp;
        } else if (deg === "270_degrees" || deg === "270") {
            const temp = n; n = e; e = s; s = w; w = temp;
        }

        return {
            ...base,
            north: n,
            east: e,
            south: s,
            west: w,
            c: base.c || "COMMERCIAL",
            f: base.f || null,
            isBorder: !!base.isBorder
        };
    }

    /**
     * Scans world matrix conditions to identify viable structure assets, 
     * validating orientation profiles via a stochastic weighting filter.
     * @param {number} gx - Target grid coordinate X.
     * @param {number} gz - Target grid coordinate Z.
     * @param {Array<object>} pool - Filtered structure pool candidates.
     * @param {object} ctx - Shared engine context.
     */
    static findBestStructureForCell(gx, gz, pool, ctx) {
        const cellDistrict = DistrictEngine.getDistrictType(
            gx, gz, ctx.districtSeedCache, ctx.districtConfig, ctx.districtTypes
        );

        const targetIsRoad = ctx.frontierCapQueue && ctx.frontierCapQueue.has(this.getGridKey(gx, gz));

        const bestList = [];
        let maxScore = -999999;

        const rotations = ["0_degrees", "90_degrees", "180_degrees", "270_degrees"];
        const mirrors = ["none", "x", "z", "xz"];

        // Loop Pass over registered structural assets
        for (let pIdx = 0; pIdx < pool.length; pIdx++) {
            const id = pool[pIdx].id;
            const size = ctx.structureData.SIZES[id] || [1, 1];
            const baseW = size[0];
            const baseD = size[1];

            for (let rIdx = 0; rIdx < rotations.length; rIdx++) {
                const deg = rotations[rIdx];

                for (let mIdx = 0; mIdx < mirrors.length; mIdx++) {
                    const mir = mirrors[mIdx];

                    let fw = baseW;
                    let fd = baseD;
                    if (deg === "90_degrees" || deg === "270_degrees") {
                        fw = baseD;
                        fd = baseW;
                    }

                    // Scan multi-tile footprints efficiently to see if origin captures target cell
                    const minX = targetIsRoad ? gx : gx - fw + 1;
                    const maxX = gx;
                    const minZ = targetIsRoad ? gz : gz - fd + 1;
                    const maxZ = gz;

                    for (let ax = minX; ax <= maxX; ax++) {
                        for (let az = minZ; az <= maxZ; az++) {
                            
                            // Bounds checking safety verification loop pass
                            if (gx < ax || gx >= ax + fw || gz < az || gz >= az + fd) {
                                continue;
                            }

                            const score = this.evaluateCandidate(ax, az, fw, fd, id, deg, mir, cellDistrict, ctx);
                            if (score <= this.SCORING.INVALID_MISMATCH) {
                                continue;
                            }

                            if (score > maxScore) {
                                maxScore = score;
                                bestList.length = 0;
                            }
                            if (score === maxScore) {
                                bestList.push({ id, deg, mir, ax, az, fw, fd });
                            }
                        }
                    }
                }
            }
        }

        // Return fallback piece if no structures match socket criteria
        if (bestList.length === 0) {
            return null;
        }

        // Stochastic roulette selection prioritizing structural asset weight definitions
        let totalWeight = 0;
        for (let i = 0; i < bestList.length; i++) {
            const cand = bestList[i];
            const w = ctx.structureData.USP_TABLE[cand.id]?.w || 1;
            totalWeight += w;
            cand._w = w;
        }

        let r = Math.random() * totalWeight;
        let chosen = bestList[0];
        for (let i = 0; i < bestList.length; i++) {
            const cand = bestList[i];
            r -= cand._w;
            if (r <= 0) {
                chosen = cand;
                break;
            }
        }

        const c = chosen;
        const chosenIsRoad = c.id.startsWith("road_");

        // Compile absolute keys affected by this footprint choice
        const keys = [this.getGridKey(gx, gz)];
        for (let fx = 0; fx < c.fw; fx++) {
            for (let fz = 0; fz < c.fd; fz++) {
                const k = this.getGridKey(c.ax + fx, c.az + fz);
                if (k !== keys[0]) {
                    keys.push(k);
                }
            }
        }

        // Project new road frontier endpoints outward if infrastructure was generated
        const frontierCaps = [];
        if (chosenIsRoad) {
            const usp = this.getUSP(c.id, ctx.structureData, c.deg, c.mir);
            if (usp.north === 1) frontierCaps.push({ gx: c.ax, gz: c.az - 1 });
            if (usp.east === 1)  frontierCaps.push({ gx: c.ax + c.fw, gz: c.az });
            if (usp.south === 1) frontierCaps.push({ gx: c.ax, gz: c.az + c.fd });
            if (usp.west === 1)  frontierCaps.push({ gx: c.ax - 1, gz: c.az });
        }

        return { id: c.id, deg: c.deg, mir: c.mir, ax: c.ax, az: c.az, fw: c.fw, fd: c.fd, affectedKeys: keys, frontierCaps };
    }

    /**
     * Deep-scans a structural candidate against local grid conditions.
     * Evaluates boundaries, transitions, and variance modifiers.
     */
    static evaluateCandidate(ax, az, fw, fd, id, deg, mir, cellDistrict, ctx) {
        const grid = ctx.worldGrid;

        // ── 1. COLLISION SCAN PASSTHROUGH ────────────────────────────────────
        for (let x = 0; x < fw; x++) {
            for (let z = 0; z < fd; z++) {
                if (grid.has(this.getGridKey(ax + x, az + z))) {
                    return this.SCORING.INVALID_MISMATCH;
                }
            }
        }

        let totalScore = 0;
        const structUsp = this.getUSP(id, ctx.structureData, deg, mir);

        // ── 2. DISTRICT ZONE ALIGNMENT ───────────────────────────────────────
        const structDistrict = structUsp.c || "COMMERCIAL";
        totalScore += DistrictEngine.scoreDistrict(structDistrict, cellDistrict);

        // ── 3. DISTRICT TRANSITION BORDER SCORING ────────────────────────────
        if (ctx.districtConfig) {
            const details = DistrictEngine.getDistrictDetails(
                ax, az, ctx.districtSeedCache, ctx.districtConfig, ctx.districtTypes
            );
            if (details && details.isBorder) {
                if (structUsp.isBorder) {
                    totalScore += this.SCORING.BORDER_MATCH_BONUS;
                } else {
                    totalScore += this.SCORING.BORDER_MISMATCH_PENALTY;
                }
            } else {
                if (structUsp.isBorder) {
                    totalScore += this.SCORING.BORDER_MISMATCH_PENALTY;
                }
            }
        }

        // ── 4. SPACING VARIANCE SCORING ──────────────────────────────────────
        if (!id.startsWith("road_")) {
            const scanRadius = ctx.config?.SCAN_RANGE || 4;
            for (let sx = -scanRadius; sx <= scanRadius; sx++) {
                for (let sz = -scanRadius; sz <= scanRadius; sz++) {
                    if (sx === 0 && sz === 0) continue;
                    const checkKey = this.getGridKey(ax + sx, az + sz);
                    const existing = grid.get(checkKey);
                    if (existing) {
                        const existingId = typeof existing === "string" ? existing.split(";")[0] : existing.id;
                        if (existingId === id) {
                            totalScore += this.SCORING.SPACING_PENALTY;
                        }
                    }
                }
            }
        }

        // Track connection states across road systems
        let openRoadSockets = 0;
        let connectedRoadSockets = 0;
        let danglingCapsCount = 0;

        // ── 5. NORTH BOUNDARY EVALUATION LOOP ────────────────────────────────
        for (let x = 0; x < fw; x++) {
            if (structUsp.north === 1) openRoadSockets++;
            const neighborKey = this.getGridKey(ax + x, az - 1);
            const neighbor = grid.get(neighborKey);

            if (neighbor) {
                if (typeof neighbor === "string" && neighbor.startsWith("FILL:")) continue;
                const [nId, nDeg, nMir] = typeof neighbor === "string" ? neighbor.split(";") : [neighbor.id, neighbor.deg, neighbor.mir];
                const nUsp = this.getUSP(nId, ctx.structureData, nDeg, nMir);
                
                if (structUsp.north !== nUsp.south) return this.SCORING.INVALID_MISMATCH;
                if (structUsp.north === 1) {
                    totalScore += this.SCORING.MATCHING_SOCKET;
                    connectedRoadSockets++;
                }
                totalScore += this.evaluateJigsawCompatibility(id, nId, "NORTH", ctx);
            } else if (structUsp.north === 1) {
                danglingCapsCount++;
            }
        }

        // ── 6. SOUTH BOUNDARY EVALUATION LOOP ────────────────────────────────
        for (let x = 0; x < fw; x++) {
            if (structUsp.south === 1) openRoadSockets++;
            const neighborKey = this.getGridKey(ax + x, az + fd);
            const neighbor = grid.get(neighborKey);

            if (neighbor) {
                if (typeof neighbor === "string" && neighbor.startsWith("FILL:")) continue;
                const [nId, nDeg, nMir] = typeof neighbor === "string" ? neighbor.split(";") : [neighbor.id, neighbor.deg, neighbor.mir];
                const nUsp = this.getUSP(nId, ctx.structureData, nDeg, nMir);

                if (structUsp.south !== nUsp.north) return this.SCORING.INVALID_MISMATCH;
                if (structUsp.south === 1) {
                    totalScore += this.SCORING.MATCHING_SOCKET;
                    connectedRoadSockets++;
                }
                totalScore += this.evaluateJigsawCompatibility(id, nId, "SOUTH", ctx);
            } else if (structUsp.south === 1) {
                danglingCapsCount++;
            }
        }

        // ── 7. WEST BOUNDARY EVALUATION LOOP ─────────────────────────────────
        for (let z = 0; z < fd; z++) {
            if (structUsp.west === 1) openRoadSockets++;
            const neighborKey = this.getGridKey(ax - 1, az + z);
            const neighbor = grid.get(neighborKey);

            if (neighbor) {
                if (typeof neighbor === "string" && neighbor.startsWith("FILL:")) continue;
                const [nId, nDeg, nMir] = typeof neighbor === "string" ? neighbor.split(";") : [neighbor.id, neighbor.deg, neighbor.mir];
                const nUsp = this.getUSP(nId, ctx.structureData, nDeg, nMir);

                if (structUsp.west !== nUsp.east) return this.SCORING.INVALID_MISMATCH;
                if (structUsp.west === 1) {
                    totalScore += this.SCORING.MATCHING_SOCKET;
                    connectedRoadSockets++;
                }
                totalScore += this.evaluateJigsawCompatibility(id, nId, "WEST", ctx);
            } else if (structUsp.west === 1) {
                danglingCapsCount++;
            }
        }

        // ── 8. EAST BOUNDARY EVALUATION LOOP ─────────────────────────────────
        for (let z = 0; z < fd; z++) {
            if (structUsp.east === 1) openRoadSockets++;
            const neighborKey = this.getGridKey(ax + fw, az + z);
            const neighbor = grid.get(neighborKey);

            if (neighbor) {
                if (typeof neighbor === "string" && neighbor.startsWith("FILL:")) continue;
                const [nId, nDeg, nMir] = typeof neighbor === "string" ? neighbor.split(";") : [neighbor.id, neighbor.deg, neighbor.mir];
                const nUsp = this.getUSP(nId, ctx.structureData, nDeg, nMir);

                if (structUsp.east !== nUsp.west) return this.SCORING.INVALID_MISMATCH;
                if (structUsp.east === 1) {
                    totalScore += this.SCORING.MATCHING_SOCKET;
                    connectedRoadSockets++;
                }
                totalScore += this.evaluateJigsawCompatibility(id, nId, "EAST", ctx);
            } else if (structUsp.east === 1) {
                danglingCapsCount++;
            }
        }

        // ── 9. INFRASTRUCTURE DENSITY & ROAD HUNGER SCORING ──────────────────
        if (id.startsWith("road_")) {
            if (openRoadSockets >= 3) {
                totalScore += this.SCORING.JUNCTION_MULTIPORT_BONUS;
            }
            if (openRoadSockets === 1 && connectedRoadSockets === 1) {
                totalScore += this.SCORING.DEAD_END_PENALTY;
            }
            if (danglingCapsCount > 0) {
                totalScore += this.SCORING.DANGLING_PENALTY_BASE + (danglingCapsCount * this.SCORING.DANGLING_PENALTY_MULTI);
            }

            // Street Hunger: Reward road extension prioritized by proximity to active open targets
            let localHungerCount = 0;
            const hungerRadius = 3;
            for (let hx = -hungerRadius; hx <= hungerRadius; hx++) {
                for (let hz = -hungerRadius; hz <= hungerRadius; hz++) {
                    const checkKey = this.getGridKey(ax + hx, az + hz);
                    if (ctx.frontierCapQueue && ctx.frontierCapQueue.has(checkKey)) {
                        localHungerCount++;
                    }
                }
            }
            totalScore += localHungerCount * this.SCORING.STREET_HUNGER_SCALING;

        } else {
            // ── 10. ARCHITECTURAL FRONT DOOR SYSTEM ALIGNMENT ──────────────────
            if (structUsp.f) {
                const globalDoorDir = this.getRotatedDirection(structUsp.f, deg, mir);
                let doorTargetKey = "";

                if (globalDoorDir === "north") doorTargetKey = this.getGridKey(ax, az - 1);
                else if (globalDoorDir === "east")  doorTargetKey = this.getGridKey(ax + fw, az);
                else if (globalDoorDir === "south") doorTargetKey = this.getGridKey(ax, az + fd);
                else if (globalDoorDir === "west")  doorTargetKey = this.getGridKey(ax - 1, az);

                const doorNeighbor = grid.get(doorTargetKey);
                if (doorNeighbor) {
                    const doorNeighborId = typeof doorNeighbor === "string" ? doorNeighbor.split(";")[0] : doorNeighbor.id;
                    if (doorNeighborId && !doorNeighborId.startsWith("FILL:") && doorNeighborId.startsWith("road_")) {
                        totalScore += this.SCORING.FRONT_DOOR_ALIGNMENT;
                    }
                }
            }
        }

        return totalScore;
    }

    /**
     * Evaluates custom registration jigsaw tags across bordering interfaces.
     */
    static evaluateJigsawCompatibility(sourceId, targetId, edgeDirection, ctx) {
        const sourceJigsaw = ctx.structureData.JIGSAWS?.[sourceId];
        const targetJigsaw = ctx.structureData.JIGSAWS?.[targetId];
        if (!sourceJigsaw || !targetJigsaw) return 0;

        const sourceLabel = sourceJigsaw[edgeDirection];
        const reciprocalMap = { "NORTH": "SOUTH", "SOUTH": "NORTH", "EAST": "WEST", "WEST": "EAST" };
        const targetLabel = targetJigsaw[reciprocalMap[edgeDirection]];

        if (sourceLabel && targetLabel) {
            return sourceLabel === targetLabel ? this.SCORING.JIGSAW_MATCH_BONUS : this.SCORING.JIGSAW_MISMATCH_PENALTY;
        }
        return 0;
    }
}