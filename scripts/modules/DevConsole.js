/**
 * DevConsole.js — Developer Commands via /scriptevent
 */

import { system, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { GridEngine } from "./GridEngine.js";
import { DistrictEngine } from "./DistrictEngine.js";

const BITMASK_TOKEN = /_([01]{4})_/;

const FALLBACK_DISTRICT_COLORS = {
    COMMERCIAL: "§e",
    INDUSTRIAL: "§6",
    RESIDENTIAL: "§a",
    ANCIENT: "§5",
    MODERN: "§b",
    SLUMS: "§8",
};

const FALLBACK_DISTRICT_SYMBOLS = {
    COMMERCIAL: "C",
    INDUSTRIAL: "I",
    RESIDENTIAL: "R",
    ANCIENT: "A",
    MODERN: "M",
    SLUMS: "S",
};

/**
 * Register all grid: script event handlers.
 * @param {object} ctx - Shared state from main.js
 */
export function registerDevConsole(ctx) {
    system.afterEvents.scriptEventReceive.subscribe((ev) => {
        if (!ev.id.startsWith("grid:")) return;
        const cmd = ev.id.slice("grid:".length);
        const args = (ev.message ?? "").split(" ").filter(Boolean);
        const player = ev.sourceEntity;
        if (!player || typeof player.sendMessage !== "function") return;

        try {
            handleCommand(cmd, args, player, ctx);
        } catch (e) {
            player.sendMessage(`§c[GRID ERROR] ${e.message}`);
        }
    });
}

function handleCommand(cmd, args, player, ctx) {
    const {
        worldGrid, frontierCapQueue, config, structureData,
        districtSeedCache, districtTypes, commandQueue,
        tweakWorldHeight, generationStats
    } = ctx;

    const getGridValue = (k) => worldGrid.get(k);
    const getDistrictColor = (d) => FALLBACK_DISTRICT_COLORS[d] || "§7";
    const getDistrictSymbol = (d) => FALLBACK_DISTRICT_SYMBOLS[d] || (d ? d.charAt(0).toUpperCase() : "?");

    // ── grid:info ─────────────────────────────────────────────────────────────
    if (cmd === "info") {
        const { gx, gz } = getTargetCoords(player, config);
        const key = GridEngine.getGridKey(gx, gz);
        const occ = getGridValue(key);

        const district = DistrictEngine.getDistrictType(gx, gz, districtSeedCache, config.DISTRICT_SEEDS, districtTypes);
        const col = getDistrictColor(district);

        let type = "EMPTY";
        let rawStringData = "EMPTY";
        let mir = "none";
        let bm = "?";

        if (occ) {
            if (typeof occ === "string") {
                rawStringData = occ;
                const parts = occ.split(";");
                const id = parts[0].startsWith("FILL:") ? parts[0].slice(5) : parts[0];
                type = id.startsWith("road_") ? "ROAD" : (id === GridEngine.FALLBACK_ID ? "PLACEHOLDER" : "BUILDING");
                bm = (id.match(BITMASK_TOKEN)?.[1]) ?? "?";
                mir = parts[2] || "none";
            } else {
                rawStringData = `${occ.id};${occ.deg};${occ.mir}`;
                type = occ.id.startsWith("road_") ? "ROAD" : (occ.id === GridEngine.FALLBACK_ID ? "PLACEHOLDER" : "BUILDING");
                bm = (occ.id.match(BITMASK_TOKEN)?.[1]) ?? "?";
                mir = occ.mir || "none";
            }
        }

        const isCap = frontierCapQueue.has(key) ? " §c[FRONTIER CAP PENDING]§r" : "";

        player.sendMessage(
            `§6[GRID INFO]§r\n` +
            `§7Cell:     §f${gx},${gz}\n` +
            `§7Type:     §f${type}\n` +
            `§7District: ${col}${district}§r\n` +
            `§7Mirror:   §f${mir}\n` +
            `§7NESW:     §f${bm}\n` +
            `§7Data:     §f${rawStringData}${isCap}`
        );
    }

    // ── grid:spawn ────────────────────────────────────────────────────────────
    else if (cmd === "spawn") {
        const structId = args[0];
        if (!structId) return player.sendMessage("§cUsage: /scriptevent grid:spawn <id> [layer|block]");
        const animMode = args[1] === "layer" ? "layer_by_layer" : (args[1] === "block" ? "block_by_block" : "none");
        const cleanId = structId.replace(/\.mcstruc(ture)?$/i, "");
        const loc = player.location;
        const animPart = (animMode === "none") ? "none" : `none ${animMode} 5`;
        player.dimension.runCommand(`structure load "${cleanId}" ${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)} 0_degrees ${animPart}`);
        player.sendMessage(`§a[SPAWN] §f${cleanId} → (${Math.floor(loc.x)},${Math.floor(loc.y)},${Math.floor(loc.z)})`);
    }

    // ── grid:verify ───────────────────────────────────────────────────────────
    else if (cmd === "verify") {
        const structId = args[0];
        if (!structId) return player.sendMessage("§cUsage: /scriptevent grid:verify <id>");
        const cleanId = structId.replace(/\.mcstruc(ture)?$/i, "");
        const entry = structureData.USP_TABLE[structId] || structureData.USP_TABLE[cleanId];
        if (!entry) return player.sendMessage(`§cUnknown structure: ${structId}`);

        const usp = GridEngine.getUSP(cleanId, structureData, "0_degrees", "none");
        const loc = player.location;
        player.dimension.runCommand(
            `structure load "${cleanId}" ${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)} 0_degrees none`
        );
        player.sendMessage(
            `§e[VERIFY] §f${cleanId} (o: ${entry.o || 0}, w: ${entry.w || 1}, district: ${entry.c || "?"})\n` +
            `§7Physical Faces at 0°:\n` +
            `§bN: §f${usp.north === 1 ? '§aROAD' : '§7SIDE'}§r  ` +
            `§bE: §f${usp.east === 1 ? '§aROAD' : '§7SIDE'}§r\n` +
            `§bS: §f${usp.south === 1 ? '§aROAD' : '§7SIDE'}§r  ` +
            `§bW: §f${usp.west === 1 ? '§aROAD' : '§7SIDE'}§r`
        );
    }

    // ── grid:bitmask ──────────────────────────────────────────────────────────
    else if (cmd === "bitmask") {
        const structId = args[0];
        if (!structId) return player.sendMessage("§cUsage: /scriptevent grid:bitmask <id>");
        const cleanId = structId.replace(/\.mcstruc(ture)?$/i, "");
        const entry = structureData.USP_TABLE[cleanId] || structureData.USP_TABLE[structId];
        if (!entry) return player.sendMessage(`§cUnknown structure: ${cleanId}.`);

        const rots = [0, 90, 180, 270];
        let out = `§e[BITMASK] §f${cleanId}\n§7NESW at each rotation:\n`;
        for (const deg of rots) {
            const usp = GridEngine.getUSP(cleanId, structureData, `${deg}_degrees`, "none");
            const n = usp.north === 1 ? "§aR§r" : "§7S§r";
            const e = usp.east === 1 ? "§aR§r" : "§7S§r";
            const s = usp.south === 1 ? "§aR§r" : "§7S§r";
            const w = usp.west === 1 ? "§aR§r" : "§7S§r";
            out += `§b${String(deg).padStart(3)}°  §fN${n} E${e} S${s} W${w}\n`;
        }
        out += `§7R=Road  S=Sidewalk`;
        player.sendMessage(out);
    }

    // ── grid:clear ────────────────────────────────────────────────────────────
    else if (cmd === "clear") {
        const radius = parseInt(args[0]) || 3;
        const gx = Math.floor(player.location.x / config.GRID_SIZE);
        const gz = Math.floor(player.location.z / config.GRID_SIZE);
        player.sendMessage(`§eClearing grid in radius ${radius}...`);

        function* clearGridJob() {
            let cleared = 0;
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const k = GridEngine.getGridKey(gx + dx, gz + dz);
                    if (worldGrid.has(k)) {
                        worldGrid.delete(k);
                        try { world.setDynamicProperty("grid:" + k, undefined); } catch (_) { }
                        cleared++;
                        if (cleared % 25 === 0) yield;
                    }
                    frontierCapQueue.delete(k);
                }
            }
            player.sendMessage(`§a[CLEAR] §fRemoved ${cleared} grid cells.`);
        }

        system.runJob(clearGridJob());
    }

    // ── grid:reload ───────────────────────────────────────────────────────────
    else if (cmd === "reload") {
        const totalBefore = worldGrid.size;
        worldGrid.clear();
        frontierCapQueue.clear();
        districtSeedCache.clear();

        let wipedProps = 0;
        try {
            for (const prop of world.getDynamicPropertyIds()) {
                if (prop.startsWith("grid:")) {
                    world.setDynamicProperty(prop, undefined);
                    wipedProps++;
                }
            }
        } catch (_) { }

        if (generationStats) {
            generationStats.totalRoads = 0;
            generationStats.totalBuildings = 0;
            generationStats.startTick = system.currentTick;
        }

        player.sendMessage(
            `§c[RELOAD] §fWorld grid wiped.\n` +
            `§7Cleared: §e${totalBefore}§7 cells, §e${wipedProps}§7 properties.`
        );
    }

    // ── grid:stats ────────────────────────────────────────────────────────────
    else if (cmd === "stats") {
        let roads = 0, buildings = 0, placeholders = 0;
        const districtCounts = {};

        for (const [key, val] of worldGrid.entries()) {
            let id = "";
            if (typeof val === "string") {
                id = val.split(";")[0];
                if (id.startsWith("FILL:")) id = id.slice(5);
            } else if (val && val.id) {
                id = val.id;
            }

            if (!id) continue;

            if (id.startsWith("road_") || id.includes("intersection")) roads++;
            else if (id === GridEngine.FALLBACK_ID) placeholders++;
            else buildings++;

            const [gxStr, gzStr] = key.split(",");
            const gx = parseInt(gxStr), gz = parseInt(gzStr);
            const dist = DistrictEngine.getDistrictType(gx, gz, districtSeedCache, config.DISTRICT_SEEDS, districtTypes);
            districtCounts[dist] = (districtCounts[dist] || 0) + 1;
        }

        const totalCells = worldGrid.size;
        const ticksElapsed = generationStats ? (system.currentTick - generationStats.startTick) : 0;
        const secondsElapsed = Math.floor(ticksElapsed / 20);

        let distStr = "";
        for (const [d, count] of Object.entries(districtCounts).sort((a, b) => b[1] - a[1])) {
            const col = getDistrictColor(d);
            const pct = totalCells > 0 ? Math.round(count / totalCells * 100) : 0;
            distStr += `\n  ${col}${d}§r: §f${count} §7(${pct}%)`;
        }

        player.sendMessage(
            `§6[GRID STATS]§r\n` +
            `§7Total cells:   §e${totalCells}§7 / §f${config.MAX_STRUCTURES}\n` +
            `§7Roads:         §f${roads}\n` +
            `§7Buildings:     §f${buildings}\n` +
            `§7Placeholders:  §f${placeholders}\n` +
            `§7Frontier caps: §e${frontierCapQueue.size}§7 pending\n` +
            `§7Command queue: §e${commandQueue.size}§7 queued\n` +
            `§7Uptime:        §f${secondsElapsed}s\n` +
            `§6Districts:${distStr}`
        );
    }

    // ── grid:minimap ──────────────────────────────────────────────────────────
    else if (cmd === "minimap") {
        const { gx, gz } = getTargetCoords(player, config);
        let map = "§7--- Minimap (14x14 cells) ---\n";
        for (let dz = -7; dz <= 7; dz++) {
            let row = "";
            for (let dx = -7; dx <= 7; dx++) {
                if (dx === 0 && dz === 0) { row += "🟪"; continue; }
                const k = GridEngine.getGridKey(gx + dx, gz + dz);
                const occ = getGridValue(k);
                if (!occ) {
                    row += frontierCapQueue.has(k) ? "🟥" : "⬜";
                } else {
                    let id = typeof occ === "string" ? occ.split(";")[0] : occ.id;
                    if (id.startsWith("FILL:")) id = id.slice(5);
                    row += id.startsWith("road_") ? "⬛" : (id === GridEngine.FALLBACK_ID ? "🔲" : "🟩");
                }
            }
            map += row + "\n";
        }
        map += "§7⬜=empty  🟥=cap-needed  ⬛=road  🟩=building  🔲=placeholder";
        system.run(() => {
            new ActionFormData().title("§lMinimap§r").body(map).button("Close").show(player);
        });
    }

    // ── grid:heatmap ──────────────────────────────────────────────────────────
    else if (cmd === "heatmap") {
        const { gx, gz } = getTargetCoords(player, config);

        let map = "§7--- District Heatmap (14x14 cells) ---\n";
        for (let dz = -7; dz <= 7; dz++) {
            let row = "";
            for (let dx = -7; dx <= 7; dx++) {
                if (dx === 0 && dz === 0) { row += "§l*§r"; continue; }
                const dist = DistrictEngine.getDistrictType(
                    gx + dx, gz + dz, districtSeedCache, config.DISTRICT_SEEDS, districtTypes
                );
                const col = getDistrictColor(dist);
                const sym = getDistrictSymbol(dist);
                const k = GridEngine.getGridKey(gx + dx, gz + dz);
                const occupied = worldGrid.has(k);
                row += occupied ? `${col}${sym}§r` : `§8${sym.toLowerCase()}§r`;
            }
            map += row + "\n";
        }
        map += "§7Upper=placed  Lower=unbuilt\n";
        
        if (districtTypes && districtTypes.length > 0) {
            let contextLegend = "";
            districtTypes.forEach((d, i) => {
                const col = getDistrictColor(d);
                const sym = getDistrictSymbol(d);
                contextLegend += `${col}${sym}§7=${d}  `;
                if ((i + 1) % 3 === 0) contextLegend += "\n";
            });
            map += contextLegend.trim();
        } else {
            map += "§eC§7=Commercial  §6I§7=Industrial  §aR§7=Residential\n";
            map += "§5A§7=Ancient  §bM§7=Modern  §8S§7=Slums";
        }

        system.run(() => {
            new ActionFormData().title("§lDistrict Heatmap§r").body(map).button("Close").show(player);
        });
    }

    // ── grid:caps ─────────────────────────────────────────────────────────────
    else if (cmd === "caps") {
        player.sendMessage(`§6[GRID CAPS]§r §7Pending frontier caps: §e${frontierCapQueue.size}`);
    }

    // ── grid:candidates ──────────────────────────────────────────────────────
    else if (cmd === "candidates") {
        const { gx, gz } = getTargetCoords(player, config);
        const cellDistrict = DistrictEngine.getDistrictType(gx, gz, districtSeedCache, config.DISTRICT_SEEDS, districtTypes);

        player.sendMessage(`§e[EVAL] §f(${gx}, ${gz}) District: ${cellDistrict}`);

        const targetIsRoad = frontierCapQueue.has(GridEngine.getGridKey(gx, gz));
        const pool = targetIsRoad ? structureData.INFRASTRUCTURE : structureData.BUILDINGS;

        const results = [];
        const rotations = ["0_degrees", "90_degrees", "180_degrees", "270_degrees"];
        const mirrors = ["none", "x", "z", "xz"];

        const evalCtx = {
            worldGrid,
            structureData,
            districtConfig: config.DISTRICT_SEEDS,
            districtTypes,
            districtSeedCache,
            frontierCapQueue,
            config
        };

        for (const id of pool) {
            const size = structureData.SIZES[id] || [1, 1];
            const baseW = size[0];
            const baseD = size[1];
            const w = structureData.USP_TABLE[id]?.w || 1;

            for (const deg of rotations) {
                for (const mir of mirrors) {
                    let fw = baseW, fd = baseD;
                    if (deg === "90_degrees" || deg === "270_degrees") {
                        fw = baseD;
                        fd = baseW;
                    }
                    const score = GridEngine.evaluateCandidate(gx, gz, fw, fd, id, deg, mir, cellDistrict, evalCtx);
                    if (score > GridEngine.SCORING.INVALID_MISMATCH) {
                        results.push({ id, deg, mir, score, w });
                    }
                }
            }
        }
        results.sort((a, b) => b.score - a.score);

        if (results.length === 0) {
            player.sendMessage(`§cNo valid candidates found!`);
        } else {
            player.sendMessage(`§aTop Candidates:`);
            results.slice(0, 5).forEach(r => {
                player.sendMessage(` §7- §f${r.id} §e(${r.deg}/${r.mir}) Score: ${r.score} Wt: ${r.w}`);
            });
        }
    }

    // ── grid:help ─────────────────────────────────────────────────────────────
    else if (cmd === "help") {
        player.sendMessage(
            `§6[INFINIGRID COMMANDS]§r\n` +
            `§b/scriptevent grid:info§r      §7— Cell info at your position\n` +
            `§b/scriptevent grid:stats§r     §7— Full generation stats\n` +
            `§b/scriptevent grid:minimap§r   §7— ASCII minimap\n` +
            `§b/scriptevent grid:heatmap§r   §7— District zone heatmap\n` +
            `§b/scriptevent grid:caps§r      §7— Pending road caps count\n` +
            `§b/scriptevent grid:candidates§r §7— Evaluate cell potential\n` +
            `§b/scriptevent grid:bitmask <id>§r §7— All rotations of a structure\n` +
            `§b/scriptevent grid:verify <id>§r  §7— Verify structure at your position\n` +
            `§b/scriptevent grid:spawn <id>§r   §7— Force-spawn structure here\n` +
            `§b/scriptevent grid:clear [r]§r    §7— Clear grid in radius r\n` +
            `§b/scriptevent grid:reload§r    §7— Full grid reset\n`
        );
    }

    else {
        player.sendMessage(`§cUnknown command: grid:${cmd}. Try §b/scriptevent grid:help`);
    }
}

function getTargetCoords(player, config) {
    try {
        const raycast = player.getBlockFromViewDirection({ maxDistance: 50 });
        if (raycast?.block?.location) {
            const loc = raycast.block.location;
            return {
                gx: Math.floor(loc.x / config.GRID_SIZE),
                gz: Math.floor(loc.z / config.GRID_SIZE)
            };
        }
    } catch (_) { }
    const loc = player.location;
    return {
        gx: Math.floor(loc.x / config.GRID_SIZE),
        gz: Math.floor(loc.z / config.GRID_SIZE)
    };
}