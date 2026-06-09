/**
 * CommandQueue.js — Structure Load Command Buffer
 *
 * Batches `structure load` commands and drains them on a tick interval.
 * This decouples generation logic from command execution, preventing
 * command-per-tick limits from stalling world growth.
 *
 * Priority Buffers: Core framework structures (roads/paths = priority >= 5) 
 * load before secondary features (buildings/details) to limit floating artifacts.
 *
 * Lag Detection: Measures tick delta. If the server exceeds 60ms/tick,
 * drain rate is halved to help lower-end platforms recover.
 */

import { system } from "@minecraft/server";

export class CommandQueue {
    #highPriorityQueue = []; // Priority >= 5 (Infrastructure)
    #lowPriorityQueue = [];  // Priority < 5 (Features)
    #commandsPerTick;
    #started = false;
    #lastTickTime = Date.now();
    _maxSize = 2000;

    constructor(commandsPerTick = 2) {
        this.#commandsPerTick = commandsPerTick;
    }

    /**
     * Start the drain interval. Call once from main.js after CONFIG is ready.
     */
    start() {
        if (this.#started) return;
        this.#started = true;

        system.runInterval(() => {
            const now = Date.now();
            const delta = now - this.#lastTickTime;
            this.#lastTickTime = now;

            const totalSize = this.#highPriorityQueue.length + this.#lowPriorityQueue.length;
            if (totalSize === 0) return;

            // Lag detection: throttle if server is struggling (>60ms per tick)
            let rate = this.#commandsPerTick;
            if (delta > 60) {
                rate = Math.max(1, Math.floor(rate / 2));
            } else if (totalSize > 100) {
                rate = 5;
            } else if (totalSize > 50) {
                rate = 3;
            }

            let executed = 0;
            while (executed < rate) {
                let item = null;
                if (this.#highPriorityQueue.length > 0) {
                    item = this.#highPriorityQueue.shift();
                } else if (this.#lowPriorityQueue.length > 0) {
                    item = this.#lowPriorityQueue.shift();
                } else {
                    break;
                }

                try { 
                    item.dimension.runCommand(item.command); 
                    if (item.callback) {
                        // Delay by 1 tick to ensure blocks are physically loaded before scanning
                        system.runTimeout(() => {
                            try { item.callback(); } catch(e) {}
                        }, 1);
                    }
                } catch (_) { 
                    // Suppress structural dimensions/unload crashes safely
                }
                executed++;
            }
        }, 1);
    }

    /**
     * Enqueue a structure load command.
     * @param {object} dimension - Minecraft dimension object
     * @param {string} command   - Full command string
     * @param {number} priority  - Higher = more important (infrastructure>=5, features<5)
     * @param {function|null} callback - Optional callback executed post-placement
     */
    push(dimension, command, priority = 1, callback = null) {
        if (this.size >= this._maxSize) return;

        const item = { dimension, command, callback };
        if (priority >= 5) {
            this.#highPriorityQueue.push(item);
        } else {
            this.#lowPriorityQueue.push(item);
        }
    }

    get size() { 
        return this.#highPriorityQueue.length + this.#lowPriorityQueue.length; 
    }

    get isFull() { 
        return this.size >= this._maxSize; 
    }

    setMaxSize(n) { 
        this._maxSize = n; 
    }

    /** For DEBUG reporting */
    getStats() {
        return { queued: this.size };
    }
}