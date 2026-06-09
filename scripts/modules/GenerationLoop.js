/**
 * GenerationLoop.js — Placement Logic & Budget Orchestration
 *
 * Handles the per-tick placement cycle:
 * Phase 1 — Road frontier (open road sockets get capped first)
 * Phase 2 — Building construction (proximity scan)
 * Phase 3 — Catch-up (leftover budget returns to roads)
 *
 * Includes post-placement scanning for custom text container disguise blocks.
 */

import { world, system } from "@minecraft/server";
import { GridEngine } from "./GridEngine.js";
import { DistrictEngine } from "./DistrictEngine.js";

// Pre-cache structural profiles
let PRE_FILTERED_INFRA = null;
let PRE_SORTED_BUILDINGS = null;

const DATA_PREFIX = "scalar_block_data_";

/**
 * Maps the scalar:disguise_index state values to their target physical block identifiers.
 */
const DISGUISE_REPLACEMENT_MAP = {
    0: "minecraft:concrete", 
    1: "minecraft:stone_bricks",
    2: "minecraft:oak_planks",
    3: "minecraft:cobblestone",
    4: "minecraft:dirt",
    5: "minecraft:stone",
    6: "minecraft:iron_block",
    7: "minecraft:obsidian"
};

/**
 * Attempt to place a structure in grid cell (gx, gz).
 * @returns {{ placed: boolean, type: string|null, frontierCaps: Array }}
 */
export function attemptPlacement(gx, gz, dimension, opts) {
    const {
        worldGrid,
        commandQueue,
        config,
        structureData,
        districtSeedCache,
        districtTypes,
        tweakWorldHeight,
        structureYOffsets,
        frontierCapQueue
    } = opts;

    const key = GridEngine.getGridKey(gx, gz);
    if (worldGrid.has(key)) return { placed: false, type: null, frontierCaps: [] };

    const hasNeighbor = [
        GridEngine.getGridKey(gx, gz - 1), GridEngine.getGridKey(gx, gz + 1),
        GridEngine.getGridKey(gx + 1, gz), GridEngine.getGridKey(gx - 1, gz)
    ].some(k => worldGrid.has(k));
    if (!hasNeighbor) return { placed: false, type: null, frontierCaps: [] };

    const ctx = {
        worldGrid,
        structureData,
        districtConfig: config.DISTRICT_SEEDS,
        districtTypes,
        districtSeedCache,
        frontierCapQueue,
        config
    };

    if (!PRE_FILTERED_INFRA) {
        PRE_FILTERED_INFRA = structureData.INFRASTRUCTURE.map(id => ({ id }));
    }
    if (!PRE_SORTED_BUILDINGS) {
        PRE_SORTED_BUILDINGS = structureData.BUILDINGS.map(id => ({ id })).sort((a, b) => {
            const sizeA = structureData.SIZES[a.id] || [1, 1];
            const sizeB = structureData.SIZES[b.id] || [1, 1];
            return (sizeB[0] * sizeB[1]) - (sizeA[0] * sizeA[1]);
        });
    }

    const isRoadCycle = opts.currentPhaseIsRoad === true;
    const pool = isRoadCycle ? PRE_FILTERED_INFRA : PRE_SORTED_BUILDINGS;

    const result = GridEngine.findBestStructureForCell(gx, gz, pool, ctx);
    if (!result) {
        return { placed: false, type: null, frontierCaps: [] };
    }

    const { id: structureId, deg, mir, affectedKeys, frontierCaps, ax: anchorX, az: anchorZ } = result;

    const rotationStr = deg;
    const cellType = structureId.startsWith("road_") ? "ROAD" : "BUILDING";

    const wPos = GridEngine.gridToWorld(anchorX ?? gx, anchorZ ?? gz, config.GRID_SIZE);

    // ── Multi-tile cell storage ───────────────────────────────────────────────
    const gridData = { id: structureId, deg: rotationStr, mir };
    const rawStringData = `${structureId};${rotationStr};${mir}`;

    for (let i = 0; i < affectedKeys.length; i++) {
        const cellData = i === 0 ? gridData : `FILL:${rawStringData}`;
        worldGrid.set(affectedKeys[i], cellData);
        frontierCapQueue.delete(affectedKeys[i]);
        try { 
            world.setDynamicProperty("grid:" + affectedKeys[i], i === 0 ? rawStringData : `FILL:${rawStringData}`); 
        } catch (_) { }
    }

    if (config.DEBUG?.VERBOSE) {
        const dbgUsp = GridEngine.getUSP(structureId, structureData, rotationStr, mir);
        const dbgBm = `N=${dbgUsp.north} E=${dbgUsp.east} S=${dbgUsp.south} W=${dbgUsp.west}`;
        console.warn(`[PLACE] (${gx},${gz}) ${structureId} rot=${rotationStr} mir=${mir} bitmask=[${dbgBm}]`);
    }

    const meta = structureData.USP_TABLE[structureId] || { e: "G" };
    const baseSurfaceY = (tweakWorldHeight.BASE_SURFACE_Y !== null && tweakWorldHeight.BASE_SURFACE_Y !== undefined) ? tweakWorldHeight.BASE_SURFACE_Y : config.SURFACE_Y;
    const tierOffset = (meta.e === "U" ? -10 : meta.e === "S" ? 20 : 0);
    const globalOffset = (cellType === "ROAD") ? tweakWorldHeight.ROAD_SINK_OFFSET : tweakWorldHeight.BUILDING_LIFT_OFFSET;
    const specificOffset = structureYOffsets[structureId] || 0;
    const targetY = baseSurfaceY + tierOffset + globalOffset + specificOffset;

    const cleanId = structureId.replace(/\.mcstruc(ture)?$/i, "");
    const cmdPriority = (cellType === "ROAD") ? 10 : 1;

    // Calculate scanning coordinates
    const size = structureData.SIZES[structureId] || [1, 1];
    const targetX = wPos.x;
    const targetZ = wPos.z;

    const fw = deg === "90_degrees" || deg === "270_degrees" ? size[1] : size[0];
    const fd = deg === "90_degrees" || deg === "270_degrees" ? size[0] : size[1];

    const minX = Math.floor(targetX);
    const maxX = Math.floor(targetX + fw * config.GRID_SIZE - 1);
    const minZ = Math.floor(targetZ);
    const maxZ = Math.floor(targetZ + fd * config.GRID_SIZE - 1);

    const minY = targetY;
    const maxY = targetY + 15; // Assumption: structures do not exceed 15 blocks vertical height

    commandQueue.push(
        dimension, 
        `structure load "${cleanId}" ${Math.floor(wPos.x)} ${targetY} ${Math.floor(wPos.z)} ${rotationStr} ${mir}`, 
        cmdPriority,
        () => {
            processScalarScriptBlocks(dimension, minX, minY, minZ, maxX, maxY, maxZ, opts);
        }
    );

    return { placed: true, type: cellType, frontierCaps: frontierCaps || [] };
}

/**
 * Places the initial 4-way seed at the player's grid cell.
 */
export function placeSeed(centerGridX, centerGridZ, dimension, opts) {
    const { worldGrid, commandQueue, config, frontierCapQueue, tweakWorldHeight, structureData } = opts;

    const seedId = structureData.SEED_ID || structureData.INFRASTRUCTURE[0] || "road_fourway_1111_commercial_gnd";
    const seedRot = "0_degrees";
    const seedKey = GridEngine.getGridKey(centerGridX, centerGridZ);
    const seedPos = GridEngine.gridToWorld(centerGridX, centerGridZ, config.GRID_SIZE);

    const seedData = { id: seedId, deg: seedRot, mir: "NONE" };
    worldGrid.set(seedKey, seedData);
    try { world.setDynamicProperty("grid:" + seedKey, `${seedId};${seedRot};NONE`); } catch (_) { }

    const seedBaseY = (tweakWorldHeight.BASE_SURFACE_Y !== null && tweakWorldHeight.BASE_SURFACE_Y !== undefined) ? tweakWorldHeight.BASE_SURFACE_Y : config.SURFACE_Y;
    const seedTargetY = seedBaseY + tweakWorldHeight.ROAD_SINK_OFFSET;

    dimension.runCommand(
        `structure load "${seedId}" ${Math.floor(seedPos.x)} ${seedTargetY} ${Math.floor(seedPos.z)} ${seedRot} NONE`
    );

    const dirs = [
        { gx: centerGridX, gz: centerGridZ - 1 },
        { gx: centerGridX, gz: centerGridZ + 1 },
        { gx: centerGridX + 1, gz: centerGridZ },
        { gx: centerGridX - 1, gz: centerGridZ }
    ];
    for (const fc of dirs) {
        frontierCapQueue.add(GridEngine.getGridKey(fc.gx, fc.gz));
    }
}

/**
 * Run one full budget cycle for a player tick.
 */
export function* runGenerationCycle(centerGridX, centerGridZ, dimension, opts) {
    const { worldGrid, commandQueue, config, frontierCapQueue, userConfig, generationStats } = opts;

    const budget = userConfig.PLACEMENTS_PER_TICK;
    const roadGoal = budget - Math.floor(budget * userConfig.BUILDING_BUDGET_PERCENT);

    let totalPlaced = 0;

    const frontierCandidates = [];
    for (const capKey of frontierCapQueue) {
        if (worldGrid.has(capKey)) { frontierCapQueue.delete(capKey); continue; }
        const [cxStr, czStr] = capKey.split(",");
        const cgx = parseInt(cxStr, 10), cgz = parseInt(czStr, 10);
        const dx = cgx - centerGridX, dz = cgz - centerGridZ;
        frontierCandidates.push({ gx: cgx, gz: cgz, distSq: dx * dx + dz * dz });
    }
    frontierCandidates.sort((a, b) => a.distSq - b.distSq);

    const proximityCandidates = [];
    const radius = config.SCAN_RANGE;
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
            const gx = centerGridX + dx, gz = centerGridZ + dz;
            const key = GridEngine.getGridKey(gx, gz);
            if (worldGrid.has(key)) continue;
            proximityCandidates.push({ gx, gz, distSq: dx * dx + dz * dz });
        }
    }
    proximityCandidates.sort((a, b) => a.distSq - b.distSq);

    function* processBatch(list, limit, isRoadPhase) {
        let batchPlaced = 0;
        opts.currentPhaseIsRoad = isRoadPhase;

        for (let i = 0; i < list.length; i++) {
            if (totalPlaced >= budget || batchPlaced >= limit || commandQueue.size >= config.MAX_QUEUE_SIZE) break;
            const cand = list[i];
            const candKey = GridEngine.getGridKey(cand.gx, cand.gz);

            if (worldGrid.has(candKey)) {
                list.splice(i, 1);
                i--;
                continue;
            }

            const { placed, type, frontierCaps } = attemptPlacement(cand.gx, cand.gz, dimension, opts);

            if (placed) {
                totalPlaced++;
                batchPlaced++;
                if (type === "ROAD") generationStats.totalRoads++;
                else generationStats.totalBuildings++;

                frontierCapQueue.delete(candKey);

                for (const fc of frontierCaps) {
                    const fcKey = GridEngine.getGridKey(fc.gx, fc.gz);
                    if (!worldGrid.has(fcKey)) frontierCapQueue.add(fcKey);
                }

                list.splice(i, 1);
                i--;
                yield;
            }
        }
    }

    yield* processBatch(frontierCandidates, roadGoal, true);
    yield* processBatch(proximityCandidates, budget - totalPlaced, false);

    if (totalPlaced < budget) {
        yield* processBatch(frontierCandidates, budget - totalPlaced, true);
    }
}

/**
 * Advanced Post-Placement Scan of Bounding Boxes for ScalarScriptBlocks.
 * Automatically handles district-aware parameters and maps them to block variables.
 */
export function processScalarScriptBlocks(dimension, minX, minY, minZ, maxX, maxY, maxZ, opts) {
    const { districtSeedCache, districtTypes, config } = opts;
    const dimId = dimension.id ?? dimension;

    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            for (let z = minZ; z <= maxZ; z++) {
                try {
                    const block = dimension.getBlock({ x, y, z });
                    if (!block) continue;

                    const typeId = block.typeId;
                    if (!typeId.startsWith("myname:concrete_panel_")) continue;

                    // Extract block properties & spatial info
                    const disguiseIndex = block.permutation.getState("scalar:disguise_index") ?? 0;
                    let facingDirection = "north";
                    try {
                        facingDirection = block.permutation.getState("minecraft:facing_direction") ?? "north";
                    } catch (_) {}

                    const gx = Math.floor(x / config.GRID_SIZE);
                    const gz = Math.floor(z / config.GRID_SIZE);
                    const cellDistrict = DistrictEngine.getDistrictType(
                        gx, gz, districtSeedCache, config.DISTRICT_SEEDS, districtTypes
                    );

                    // Route block type logic
                    if (typeId === "myname:concrete_panel_textcontainer") {
                        // JOINT LOGIC BLOCK: Check connection transitions
                        resolveJointLogic(dimension, { x, y, z }, facingDirection, disguiseIndex, cellDistrict);
                    } else {
                        // AUTO-CALIBRATE LOGIC BLOCKS BASED ON DISTRICT
                        calibrateScriptBlockMemory(dimId, { x, y, z }, typeId, cellDistrict);
                    }

                } catch (_) {
                    // Prevent loaded boundary exceptions from stopping loop
                }
            }
        }
    }
}

/**
 * Resolves joint connection blocks into visually appropriate transitions
 * by analyzing neighboring grid cells and adjoining block types.
 */
function resolveJointLogic(dimension, location, facing, disguiseIndex, district) {
    // Spatial inspection of directly adjacent blocks
    const offset = getDirectionalOffset(facing);
    const adjacentLocation = { x: location.x + offset.x, y: location.y + offset.y, z: location.z + offset.z };

    try {
        const neighbor = dimension.getBlock(adjacentLocation);
        let replacementId = DISGUISE_REPLACEMENT_MAP[disguiseIndex] || "minecraft:air";

        if (neighbor) {
            const neighborId = neighbor.typeId;

            // Archway resolution: if connecting to paths/roads
            if (neighborId.startsWith("road_") || neighborId.includes("path")) {
                replacementId = "minecraft:air"; // Keep open for walkways
            }
            // Barrier resolution: if placed next to solid structures or walls
            else if (neighbor.isSolid) {
                replacementId = (district === "INDUSTRIAL" || district === "ANCIENT") 
                    ? "minecraft:stone_bricks" 
                    : "minecraft:oak_planks";
            }
        }

        const block = dimension.getBlock(location);
        if (block) {
            block.setType(replacementId);
            try {
                const newPerm = block.permutation.withState("minecraft:facing_direction", facing);
                block.setPermutation(newPerm);
            } catch (_) {}
        }
    } catch (_) {}
}

/**
 * Writes pre-calibrated default properties directly into world memory
 * based on the district where the structural element spawned.
 */
function calibrateScriptBlockMemory(dimId, pos, typeId, district) {
    const memoryLocSuffix = `${dimId}_${pos.x}_${pos.y}_${pos.z}`;

    if (typeId.includes("ambush")) {
        let mob = "minecraft:zombie";
        if (district === "SLUMS") mob = "minecraft:husk";
        else if (district === "INDUSTRIAL") mob = "minecraft:spider";
        else if (district === "ANCIENT") mob = "minecraft:skeleton";

        const cfg = { mob_id: mob, count: 2, cooldown_mins: 1, enabled: true, triggerMode: 4 };
        world.setDynamicProperty(`${DATA_PREFIX}ambush_cfg_${memoryLocSuffix}`, JSON.stringify(cfg));
    } 
    
    else if (typeId.includes("aura")) {
        let hazard = "minecraft:poison";
        let strength = 1;
        if (district === "SLUMS") hazard = "minecraft:hunger";
        else if (district === "INDUSTRIAL") hazard = "minecraft:mining_fatigue";
        else if (district === "MODERN") { hazard = "minecraft:speed"; strength = 0; }

        const cfg = { effect_id: hazard, strength: strength, radius: 6, enabled: true, triggerMode: 1 };
        world.setDynamicProperty(`${DATA_PREFIX}aura_cfg_${memoryLocSuffix}`, JSON.stringify(cfg));
    } 
    
    else if (typeId.includes("spawner") && !typeId.includes("mobspawner")) {
        let item = "minecraft:bread";
        if (district === "INDUSTRIAL") item = "minecraft:iron_ingot";
        else if (district === "ANCIENT") item = "minecraft:experience_bottle";

        const cfg = { item_id: item, count: 1, mode: 1, interval: 10, trigger: 1, held_id: "", enabled: true, triggerMode: 4 };
        world.setDynamicProperty(`${DATA_PREFIX}spawner_cfg_${memoryLocSuffix}`, JSON.stringify(cfg));
    } 
    
    else if (typeId.includes("mobspawner")) {
        let entity = "minecraft:zombie";
        if (district === "ANCIENT") entity = "minecraft:skeleton";
        else if (district === "SLUMS") entity = "minecraft:creeper";

        const cfg = { entity_id: entity, count: 1, mode: 0, cooldown_min: 0, cooldown_sec: 15, trigger: 1, enabled: true, triggerMode: 4 };
        world.setDynamicProperty(`${DATA_PREFIX}mobspawner_cfg_${memoryLocSuffix}`, JSON.stringify(cfg));
    } 
    
    else if (typeId.includes("weather")) {
        const cfg = { range: 12, intensity: district === "ANCIENT" ? 3 : 1, enabled: true, triggerMode: 1 };
        world.setDynamicProperty(`${DATA_PREFIX}weather_cfg_${memoryLocSuffix}`, JSON.stringify(cfg));
    }
}

function getDirectionalOffset(direction) {
    switch (direction) {
        case "north": return { x: 0, y: 0, z: -1 };
        case "south": return { x: 0, y: 0, z: 1 };
        case "east":  return { x: 1, y: 0, z: 0 };
        case "west":  return { x: -1, y: 0, z: 0 };
        default:      return { x: 0, y: 0, z: 0 };
    }
}
