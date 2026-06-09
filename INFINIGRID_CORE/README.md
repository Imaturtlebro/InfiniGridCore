# InfiniGrid — Core Engine

Standalone Behavior Pack containing the pure procedural city generation engine.  
**No structures are bundled here.** This is the base all content packs build on.

---

## Contents

```
INFINIGRID_CORE/
├── manifest.json
└── scripts/
    ├── main.js                  ← Entry point. Tune config here.
    ├── structure_data.js        ← Aggregator. Register your structures here.
    ├── data/
    │   └── infrastructure.js   ← Road piece stub — add your roads here.
    └── modules/
        ├── GridEngine.js        ← Socket + scoring engine (do not edit)
        ├── DistrictEngine.js    ← Zoning system (do not edit)
        ├── GenerationLoop.js    ← Placement loop (do not edit)
        ├── CommandQueue.js      ← Command buffer (do not edit)
        └── DevConsole.js        ← /scriptevent grid:* dev tools (do not edit)
```

---

## Creating a Content Pack

1. **Copy** this entire `INFINIGRID_CORE` folder to a new folder (e.g. `MyCity_Pack`).
2. **Rename** the pack in `manifest.json` — give it a new UUID and name.
3. **Add** your `.mcstructure` files to a `structures/` folder you create.
4. **Register** your roads in `scripts/data/infrastructure.js`.
5. **Create** new zone data files in `scripts/data/` for each district type you want (e.g. `commercial.js`, `residential.js`).
6. **Import** them in `scripts/structure_data.js` following the pattern shown in the comments there.
7. **Set** `STRUCTURE_DATA.SEED_ID` to your preferred 4-way road piece (the first piece placed).
8. **Done** — the engine reads everything from `STRUCTURE_DATA` automatically.

---

## Data File Format

Each `data/*.js` file should export four things:

```js
export const MY_STRUCTURES = ["my_road_1010_commercial_gnd"];

export const MY_USP = {
    "my_road_1010_commercial_gnd": {
        u: "1010",        // NESW bitmask — roads only, buildings = "0000"
        c: "COMMERCIAL",  // District zone
        e: "G",           // Elevation: G=ground, U=underground, S=+20Y
        w: 25,            // Spawn weight (higher = more common)
        a: 1,             // Active? 1=yes, 0=disabled
        f: null,          // Front door direction (null for roads)
        o: 0,             // Orientation offset (always 0)
    },
};

export const MY_JIGSAWS = {
    "my_road_1010_commercial_gnd": {
        SOCKETS: ["socket:north", "socket:south"],
        LABELS:  ["socket:north", "socket:south", "label:sidewalkeast", "label:sidewalkwest"],
        COORDS: [], HAS_ENTITIES: false, HAS_LOOT: false, DIRTY: false,
    },
};

export const MY_SIZES = {
    "my_road_1010_commercial_gnd": [1, 1], // [width, depth] in 16-block grid cells
};
```

---

## Dev Commands (in-game)

All commands use `/scriptevent grid:<cmd>`:

| Command | Description |
|---|---|
| `grid:help` | List all commands |
| `grid:info` | Cell info at your position |
| `grid:stats` | Generation stats |
| `grid:minimap` | ASCII cell map |
| `grid:heatmap` | District zone view |
| `grid:bitmask <id>` | All 4 rotations of a structure |
| `grid:verify <id>` | Verify bitmask + place at feet |
| `grid:spawn <id>` | Force-spawn a structure |
| `grid:clear [r]` | Clear grid in radius |
| `grid:reload` | Full grid reset |

---

## Tuning

All tuneable values are at the top of `scripts/main.js`:

- `USER_CONFIG` — placements per tick, scan range, junction thresholds
- `TWEAK_WORLD_HEIGHT` — Y offsets for roads and buildings
- `STRUCTURE_Y_OFFSETS` — per-structure Y overrides
- `districtTypes` — which zone names the engine uses
