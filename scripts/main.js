import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { STRUCTURE_DATA } from "./structure_data.js";
import { GridEngine } from "./modules/GridEngine.js";
import { CommandQueue } from "./modules/CommandQueue.js";
import { attemptPlacement, placeSeed, runGenerationCycle } from "./modules/GenerationLoop.js";
import { registerDevConsole } from "./modules/DevConsole.js";

/**
 * ─────────────────────────────────────────────────────────────────────
 * INFINIGRID CORE — main.js
 *
 * Tune these values to match your content pack and world setup.
 * ─────────────────────────────────────────────────────────────────────
 */
const TWEAK_WORLD_HEIGHT = {
    BASE_SURFACE_Y: null,   // null = use flat world preset Y. Set a number to override.
    ROAD_SINK_OFFSET: -2,   // Roads sink 2 blocks below surface
    BUILDING_LIFT_OFFSET: -1, // Buildings lift 1 block above surface
    
    // EXPANSION: Per-District baseline modifiers for vertical layering variations
    DISTRICT_OFFSETS: {
        "ANCIENT": -5,     // e.g., Sunken ruins or deep catacombs
        "COMMERCIAL": 0,
        "INDUSTRIAL": 0,
        "RESIDENTIAL": 0,
        "MODERN": 2,       // e.g., Elevated luxury platforms
        "SLUMS": -1,       // e.g., Low-lying shanties
        "RURAL": 0
    }
};

// Per-structure Y overrides. Add { "my_structure_id": offsetInt } if needed.
const STRUCTURE_Y_OFFSETS = {};

const USER_CONFIG = {
    PLACEMENTS_PER_TICK: 16,
    COMMANDS_PER_TICK: 2,
    SCAN_RANGE: 7,
    BUILDING_BUDGET_PERCENT: 0.5,
    MIN_STRAIGHT_RUN: 3,
    JUNCTION_HUNGER_THRESHOLD: 5,
    MIN_JUNCTION_SPACING: 3,
    DEBUG_VERBOSE: false,
};

const CONFIG = {
    VERSION: "1.1.0 (Core Extended)",
    GRID_SIZE: 16,
    SURFACE_Y: undefined,
    CHECK_INTERVAL: 2,
    SPAWN_COOLDOWN: 1,
    MAX_STRUCTURES: 2000,
    COMMANDS_PER_TICK: USER_CONFIG.COMMANDS_PER_TICK,
    MAX_QUEUE_SIZE: 500,
    DISTRICT_SEEDS: { SEED_SPACING: 12, INFLUENCE_RADIUS: 8, WEIGHT_MULTIPLIER: 3 },
    URBAN_DISTRICTS: ["COMMERCIAL", "INDUSTRIAL"],
    SPACED_DISTRICTS: ["RESIDENTIAL", "ANCIENT", "SLUMS", "MODERN"],
    SCAN_RANGE: USER_CONFIG.SCAN_RANGE,
    DEBUG: { VERBOSE: USER_CONFIG.DEBUG_VERBOSE },
};

// ── Runtime state ────────────────────────────────────────────────────
const worldGrid = new Map();
const frontierCapQueue = new Set();
const districtSeedCache = new Map();
const playerCooldowns = new Map();
const generationStats = { totalRoads: 0, totalBuildings: 0, startTick: 0 };

const commandQueue = new CommandQueue(USER_CONFIG.COMMANDS_PER_TICK);
commandQueue.setMaxSize(CONFIG.MAX_STRUCTURES); // Keep queue bounds perfectly aligned with max engine constraints
commandQueue.start();
let generationJobActive = false;

// District types — add or remove to match your content pack's zones
const districtTypes = ["INDUSTRIAL", "COMMERCIAL", "RESIDENTIAL", "ANCIENT", "MODERN", "SLUMS", "RURAL"];

// ── Restore saved grid from dynamic properties ────────────────────────
(function loadGrid() {
    try {
        for (const prop of world.getDynamicPropertyIds()) {
            if (prop.startsWith("grid:")) worldGrid.set(prop.substring(5), world.getDynamicProperty(prop));
        }
    } catch (e) { }
})();

// ── Shared context (passed to all engine modules) ────────────────────
const sharedContext = {
    worldGrid, frontierCapQueue, districtSeedCache, commandQueue,
    config: CONFIG,
    structureData: STRUCTURE_DATA,
    districtTypes,
    tweakWorldHeight: TWEAK_WORLD_HEIGHT,
    structureYOffsets: STRUCTURE_Y_OFFSETS,
    userConfig: USER_CONFIG,
    generationStats,
    
    /**
     * EXPANSION: Programmatic Addon Registration Hook
     * Allows separate behavior packs to safely register custom zones, 
     * structural maps, and weights into the engine without editing core source files.
     */
    registerAddonPack(addonData) {
        try {
            if (addonData.BUILDINGS) STRUCTURE_DATA.BUILDINGS.push(...addonData.BUILDINGS);
            if (addonData.INFRASTRUCTURE) STRUCTURE_DATA.INFRASTRUCTURE.push(...addonData.INFRASTRUCTURE);
            if (addonData.USP_TABLE) Object.assign(STRUCTURE_DATA.USP_TABLE, addonData.USP_TABLE);
            if (addonData.SIZES) Object.assign(STRUCTURE_DATA.SIZES, addonData.SIZES);
            if (addonData.JIGSAWS) Object.assign(STRUCTURE_DATA.JIGSAWS, addonData.JIGSAWS);
            
            // Recompile live dynamic district maps
            if (addonData.USP_TABLE) {
                for (const [id, entry] of Object.entries(addonData.USP_TABLE)) {
                    if (entry) STRUCTURE_DATA.DISTRICTS[id] = entry.c || "COMMERCIAL";
                }
            }
        } catch (e) { }
    }
};

// Bind registration interface globally to expose a clean bridge for separate addon scripts
world.infiniGrid = { registerPack: (pack) => sharedContext.registerAddonPack(pack) };

registerDevConsole(sharedContext);

// ── Main generation loop ─────────────────────────────────────────────
let isGuiActive = false;
system.runInterval(() => {
    try {
        const players = world.getAllPlayers().filter(p => p.isValid());
        if (players.length === 0) return;

        // First-time setup: prompt user for flat world preset
        if (CONFIG.SURFACE_Y === undefined) {
            const savedY = world.getDynamicProperty("grid_config_y");
            if (savedY !== undefined) {
                CONFIG.SURFACE_Y = savedY;
            } else if (!isGuiActive) {
                isGuiActive = true;
                const form = new ActionFormData()
                    .title("§lInfiniGrid§r — Setup")
                    .body("Select your Flat World preset:");
                const presets = [
                    { name: "Classic Flat", y: -61 },
                    { name: "Bottomless Pit", y: -60 },
                    { name: "Desert / Overworld", y: -5 },
                    { name: "Redstone Ready", y: 51 },
                    { name: "Water World", y: 36 },
                    { name: "Tunneler's Dream", y: 171 },
                    { name: "The Void", y: 1 },
                ];
                for (const p of presets) form.button(p.name);
                form.show(players[0]).then(res => {
                    isGuiActive = false;
                    if (res.canceled) return;
                    const selectedY = presets[res.selection].y;
                    CONFIG.SURFACE_Y = selectedY;
                    world.setDynamicProperty("grid_config_y", selectedY);
                }).catch(() => { isGuiActive = false; });
                return;
            }
            return;
        }

        for (const player of players) {
            const last = playerCooldowns.get(player.id) || 0;
            if (system.currentTick - last < CONFIG.SPAWN_COOLDOWN * 20) continue;

            const cx = Math.floor(player.location.x / 16);
            const cz = Math.floor(player.location.z / 16);

            if (worldGrid.size === 0) placeSeed(cx, cz, player.dimension, sharedContext);

            if (!generationJobActive) {
                generationJobActive = true;
                system.runJob((function* () {
                    yield* runGenerationCycle(cx, cz, player.dimension, sharedContext);
                    generationJobActive = false;
                })());
            }

            playerCooldowns.set(player.id, system.currentTick);
        }
    } catch (e) { }
}, 40);