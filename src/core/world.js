// The World holds every simulated field as a flat Float32Array on an N×N grid.
// Index a cell with  i = z * N + x.  One grid cell is one world unit wide.
//
// Fields:
//   height    – solid ground elevation (rock + loose sediment)
//   baseline  – height when the terrain was generated/last "set"; used to show erosion vs. deposition
//   water     – depth of surface water sitting on each cell
//   sediment  – sediment suspended in that water (carried along by the flow)
//   flux      – outflow of water to the 4 neighbours (L, R, T, B) for the pipe model
//   velX/velZ – water velocity, derived from flux
//   vegetation – plant cover 0..1 (barren → grassland → forest); roots resist erosion
//   province  – geological province per cell (see core/rocks.js); with height it picks the rock type
//   lava, lavaTemp, lavaType – molten lava thickness, temperature (1 = vent, 0 = solid) and its rock
//   surfaceRock/surfaceBase – solidified lava or ash: which rock, and the ground height beneath it
//   intrusionRock/intrusionTop – plutons and dikes: which rock, and the height of its top
//   events    – running eruptions, intrusions and faults (each has update(world, dt) → done?)
//   sources   – springs that emit water each step (x, z, rate)

import { createNoise2D, fbm } from './noise.js';
import { ROCKS, rockAt } from './rocks.js';

const ROCK_HARDNESS = Float32Array.from(ROCKS, (r) => r.hardness);

export class World {
  /** @param {number} size grid resolution (cells per side) */
  constructor(size = 256) {
    this.N = size;
    const n = size * size;
    this.height = new Float32Array(n);
    this.baseline = new Float32Array(n);
    this.water = new Float32Array(n);
    this.sediment = new Float32Array(n);
    this.fluxL = new Float32Array(n);
    this.fluxR = new Float32Array(n);
    this.fluxT = new Float32Array(n);
    this.fluxB = new Float32Array(n);
    this.velX = new Float32Array(n);
    this.velZ = new Float32Array(n);
    this.vegetation = new Float32Array(n);
    this.lastWet = new Float32Array(n).fill(-1); // sim time a cell last had surface water (-1 = never)
    this.time = 0;                              // simulated seconds of water flow so far
    this.prevHeight = new Float32Array(n); // last vegetation step's heights, to detect disturbance
    this.moisture = null;                  // climate wetness map 0..1, set by initVegetation
    this.soil = null;                      // soil moisture 0..1 (supply minus plant use), set by initVegetation
    this.nearWater = null;                 // 0..1 closeness to open water, set by the vegetation step
    this.standSlope = null;                // neighbourhood-averaged slope, set by the vegetation step
    this.gentleSlope = 0.6;                // the map's median stand slope ("gentle" is relative)
    /** @type {{x:number, z:number, rate:number}[]} */
    this.sources = [];
    this.province = new Uint8Array(n);
    this.lava = new Float32Array(n);
    this.lavaTemp = new Float32Array(n);
    this.lavaType = new Int8Array(n);
    this.surfaceRock = new Int8Array(n).fill(-1);
    this.surfaceBase = new Float32Array(n);
    this.freshRock = new Float32Array(n); // 1 = newly erupted lava/ash with no soil yet; weathers back to 0
    this.fire = new Float32Array(n);      // wildfire intensity (0 = not burning)
    this.burnt = new Float32Array(n);     // 1 = freshly burnt to ash; fades as plants return
    this.humus = new Float32Array(n);     // soil depth/fertility 0..1, built by plants (see sim/vegetation.js)
    this.fireCells = [];                  // indices of burning cells (for smoke)
    this.flows = [];                      // moving pyroclastic flows {x, z, vx, vz, mass, age}
    this.intrusionRock = new Int8Array(n).fill(-1);
    this.intrusionTop = new Float32Array(n).fill(-Infinity);
    this.events = [];
    this.faults = [];   // fault traces for drawing: {ax, az, bx, bz, type}
    this.quake = 0;     // current earthquake shaking (decays), drives camera shake
    this.geoRange = { lo: 0, hi: 1 };       // height range at generation (for the volcano's zoning)

    // Geology settings shared by all processes
    this.erosionEnabled = true; // master switch: water erosion, weathering and landslides
    this.rocksEnabled = true;  // rock types differ in hardness (off = uniform rock everywhere)
    this.strataSpacing = 7;    // base thickness of rock layers
    this.strataStrength = 0.5; // hardness contrast: 0 = all rock erodes alike, 1 = full difference
    // Real rock layers are rarely perfectly level: they dip and fold. This per-cell offset warps
    // the layers so they don't line up with the contours (which would cut every slope into rings).
    this.strataWarp = new Float32Array(n);
    const warpNoise = createNoise2D(4242);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        this.strataWarp[z * size + x] = 0.06 * x + 0.03 * z + 12 * fbm(warpNoise, x / 90, z / 90, 4);
      }
    }
    this.strataWarp0 = this.strataWarp.slice(); // undeformed layers, restored for each new terrain
    this.seaLevel = -1000;    // below this, water is "ocean" and sediment settles out
    this.edgeDrain = true;    // water flows off the map edges

    /** Set to true whenever a field changes so the renderer rebuilds its buffers. */
    this.dirty = true;
  }

  idx(x, z) { return z * this.N + x; }

  inBounds(x, z) { return x >= 0 && z >= 0 && x < this.N && z < this.N; }

  /** Bilinear sample of the height field at a fractional position. */
  sampleHeight(x, z) {
    const N = this.N;
    x = Math.min(Math.max(x, 0), N - 1.001);
    z = Math.min(Math.max(z, 0), N - 1.001);
    const x0 = x | 0, z0 = z | 0;
    const fx = x - x0, fz = z - z0;
    const i = z0 * N + x0;
    const h = this.height;
    return (h[i] * (1 - fx) + h[i + 1] * fx) * (1 - fz) +
           (h[i + N] * (1 - fx) + h[i + N + 1] * fx) * fz;
  }

  /** Index into ROCKS of the bedrock at cell i with the ground at height h. */
  rockAt(h, i) { return rockAt(this, i, h); }

  /**
   * Rock resistance (0..1, higher = harder) at a given elevation. Soft rock (shale) wears away
   * far faster than hard rock (granite, basalt), which is what carves cliffs, ledges, mesas and
   * hoodoos. Layered rocks dip and fold, so which layer is exposed changes as erosion cuts down.
   * @param {number} h  elevation   @param {number} i  cell index
   */
  hardnessAt(h, i) {
    if (!this.rocksEnabled) return 0.5;
    return 0.5 + (ROCK_HARDNESS[rockAt(this, i, h)] - 0.5) * this.strataStrength;
  }

  /**
   * Multiplier applied to erosion rates. Soft rock erodes up to ~5x faster than hard rock, and
   * plant cover protects the ground: forest ≈ 0.15x, grassland ≈ 0.8x, barren ≈ 1.4x.
   */
  erodibilityAt(h, i) {
    // Deep soil binds the surface a little on top of what roots do
    return (1.15 - this.hardnessAt(h, i)) * (1.4 - 1.25 * this.vegetation[i]) * (1.1 - 0.25 * this.humus[i]);
  }

  /** Forget lava, deposits, intrusions, faults and running events (new terrain). */
  resetEvents() {
    this.lava.fill(0); this.lavaTemp.fill(0);
    this.surfaceRock.fill(-1); this.surfaceBase.fill(0); this.freshRock.fill(0);
    this.fire.fill(0); this.burnt.fill(0); this.fireCells.length = 0; this.flows.length = 0;
    this.intrusionRock.fill(-1); this.intrusionTop.fill(-Infinity);
    this.strataWarp.set(this.strataWarp0);
    this.events.length = 0; this.faults.length = 0; this.quake = 0;
    this.dirty = true;
  }

  /** Mark the current terrain as the reference for the erosion/deposition view. */
  setBaseline() {
    this.baseline.set(this.height);
  }

  clearWater() {
    this.water.fill(0);
    this.lastWet.fill(-1);
    this.sediment.fill(0);
    this.fluxL.fill(0); this.fluxR.fill(0); this.fluxT.fill(0); this.fluxB.fill(0);
    this.velX.fill(0); this.velZ.fill(0);
    this.dirty = true;
  }

  stats() {
    let water = 0, sed = 0, eroded = 0, deposited = 0;
    for (let i = 0; i < this.height.length; i++) {
      water += this.water[i];
      sed += this.sediment[i];
      const d = this.height[i] - this.baseline[i];
      if (d < 0) eroded -= d; else deposited += d;
    }
    return { water, sed, eroded, deposited };
  }
}
