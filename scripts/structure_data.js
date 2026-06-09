/**
 * structure_data.js — InfiniGrid CORE Structure Registry
 *
 * ─────────────────────────────────────────────────────────────────────
 * THIS FILE IS A STUB. It ships with ZERO structures registered.
 *
 * HOW TO CREATE A CONTENT PACK
 * ─────────────────────────────
 * 1. Copy INFINIGRID_CORE into your new content pack folder.
 * 2. Add your .mcstructure files to the structures/ folder.
 * 3. Add your structure entries to the data/*.js files
 * (infrastructure.js, and any zone files you create).
 * 4. Import and register them in this aggregator.
 * 5. Set STRUCTURE_DATA.SEED_ID to your preferred starting piece.
 *
 * DATA FILE FORMAT (each data/*.js file should export):
 * export const MY_STRUCTURES = [];         // list of IDs
 * export const MY_USP = {};                // { id: { u, c, e, w, a, f, o } }
 * export const MY_JIGSAWS = {};            // { id: { SOCKETS, LABELS, ... } }
 * export const MY_SIZES = {};              // { id: [w, d] }
 *
 * FIELD REFERENCE:
 * u    → NESW bitmask string e.g. "1010". Roads only, buildings use "0000".
 * c    → District: COMMERCIAL / INDUSTRIAL / RESIDENTIAL / ANCIENT / MODERN / SLUMS
 * e    → Elevation: "G"=ground, "U"=underground (-10Y), "S"=surface+20Y
 * w    → Spawn weight (higher = more common)
 * a    → Active: 1=enabled, 0=disabled
 * f    → Front door direction at 0° ("north"/"south"/"east"/"west"), null for roads
 * o    → Orientation offset (always 0)
 * size → [width, depth] in 16-block grid cells
 * ─────────────────────────────────────────────────────────────────────
 */

import {
    INFRASTRUCTURE_STRUCTURES, INFRASTRUCTURE_USP,
    INFRASTRUCTURE_JIGSAWS, INFRASTRUCTURE_SIZES
} from "./data/infrastructure.js";

// ── Add more data imports here as you build content ──────────────────
// import { MY_BUILDINGS, MY_USP, MY_JIGSAWS, MY_SIZES } from "./data/myzone.js";
// ─────────────────────────────────────────────────────────────────────

const ALL_BUILDINGS = [
    // Add building arrays here: ...MY_BUILDINGS,
];

const ALL_USP = {
    ...INFRASTRUCTURE_USP,
    // ...MY_USP,
};

// Compile stable district lookups dynamically on module initialization
const DISTRICTS = {};
for (const [id, entry] of Object.entries(ALL_USP)) {
    if (entry) {
        DISTRICTS[id] = entry.c || "COMMERCIAL";
    }
}

export const STRUCTURE_DATA = {
    // ── Required by engine ───────────────────────────────────────────
    BUILDINGS: ALL_BUILDINGS,
    INFRASTRUCTURE: INFRASTRUCTURE_STRUCTURES,
    USP_TABLE: ALL_USP,
    SIZES: {
        ...INFRASTRUCTURE_SIZES,
        // ...MY_SIZES,
    },
    JIGSAWS: {
        ...INFRASTRUCTURE_JIGSAWS,
        // ...MY_JIGSAWS,
    },
    DISTRICTS,

    // ── Optional pools (for future decoration/thematic layers) ──────
    THEMATIC: [],
    DETAILS: [],

    // ── EXPANSION HOOKS: Visual Decay & Props Layer ──────────────────
    // Allows modules to safely cross-reference decay variants and prop arrays
    // without throwing undefined property reference faults during runtime.
    DECAY_MODIFIERS: {
        // "structure_id": { PRISTINE: "struct_id", ABANDONED: "struct_id_v2" }
    },
    DECORATION_POOLS: {
        // "COMMERCIAL": ["prop_streetlight", "prop_trashcan"]
    },

    // ── Seed piece — the first structure placed when a world starts ──
    // Must be a 4-way road piece present in INFRASTRUCTURE_STRUCTURES.
    // If null or empty, GenerationLoop falls back to INFRASTRUCTURE[0].
    SEED_ID: null,
};