/**
 * data/infrastructure.js — Road & Infrastructure Registry
 *
 * ─────────────────────────────────────────────────────────────────────
 * CORE STUB — No road pieces registered by default.
 *
 * Add your road structures here. Each piece needs an entry in:
 *   INFRASTRUCTURE_STRUCTURES  — the ID list
 *   INFRASTRUCTURE_USP         — socket bitmask + metadata
 *   INFRASTRUCTURE_JIGSAWS     — socket/label data
 *   INFRASTRUCTURE_SIZES       — [width, depth] in grid cells
 *
 * BITMASK FORMAT (u: field) — "NESW":
 *   1 = road socket on that face
 *   0 = sidewalk / closed on that face
 *   Examples:
 *     "1010" = N-S straight
 *     "0110" = E-S corner
 *     "1011" = N+S+W T-junction
 *     "1111" = 4-way intersection
 *
 * EXAMPLE ENTRY:
 * ─────────────────────────────────────────────────────────────────────
 * INFRASTRUCTURE_STRUCTURES.push("road_straight_1010_commercial_gnd");
 *
 * INFRASTRUCTURE_USP["road_straight_1010_commercial_gnd"] =
 *     { u: "1010", c: "COMMERCIAL", e: "G", w: 25, a: 1, f: null, o: 0 };
 *
 * INFRASTRUCTURE_JIGSAWS["road_straight_1010_commercial_gnd"] = {
 *     SOCKETS: ["socket:north", "socket:south"],
 *     LABELS: ["socket:north", "socket:south", "label:sidewalkeast", "label:sidewalkwest"],
 *     COORDS: [], HAS_ENTITIES: false, HAS_LOOT: false, DIRTY: false,
 * };
 *
 * INFRASTRUCTURE_SIZES["road_straight_1010_commercial_gnd"] = [1, 1];
 * ─────────────────────────────────────────────────────────────────────
 */

export const INFRASTRUCTURE_STRUCTURES = [];
export const INFRASTRUCTURE_USP = {};
export const INFRASTRUCTURE_JIGSAWS = {};
export const INFRASTRUCTURE_SIZES = {};
