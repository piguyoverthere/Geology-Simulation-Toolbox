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
//   sources   – springs that emit water each step (x, z, rate)

import { createNoise2D, fbm } from './noise.js';

const LUT_MIN = -100, LUT_MAX = 300, LUT_RES = 20; // hardness table range (height units) and samples per unit

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
    this.prevHeight = new Float32Array(n); // last vegetation step's heights, to detect disturbance
    this.moisture = null;                  // climate wetness map 0..1, set by initVegetation
    this.soil = null;                      // soil moisture 0..1 (supply minus plant use), set by initVegetation
    this.nearWater = null;                 // 0..1 closeness to open water, set by the vegetation step
    /** @type {{x:number, z:number, rate:number}[]} */
    this.sources = [];

    // Geology settings shared by all processes
    this.strataEnabled = false;
    this.strataSpacing = 7;   // vertical distance between hard/soft rock bands
    this.strataStrength = 0.4; // 0 = uniform rock, 1 = hard bands erode ~5x slower than soft ones
    // Real rock layers are rarely perfectly level: they dip and fold. This per-cell offset warps
    // the layers so they don't line up with the contours (which would cut every slope into rings).
    this.strataWarp = new Float32Array(n);
    const warpNoise = createNoise2D(4242);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        this.strataWarp[z * size + x] = 0.06 * x + 0.03 * z + 12 * fbm(warpNoise, x / 90, z / 90, 4);
      }
    }
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

  /**
   * Rock resistance (0..1, higher = harder) at a given elevation. Real landscapes are built
   * from layers of different rock; soft layers wear away faster than hard ones, which is
   * what carves cliffs, ledges, mesas and hoodoos. Strata are gently dipping, folded layers.
   * @param {number} h  elevation   @param {number} i  cell index (selects the layer warp)
   */
  hardnessAt(h, i) {
    if (!this.strataEnabled) return 0.5;
    // Cached lookup table (this is called for every cell every frame); rebuilt when spacing changes
    if (this._lutSpacing !== this.strataSpacing) this.buildHardnessLUT();
    const k = ((h + this.strataWarp[i] - LUT_MIN) * LUT_RES) | 0;
    const raw = this._lut[k < 0 ? 0 : k >= this._lut.length ? this._lut.length - 1 : k];
    return 0.5 + (raw - 0.55) * this.strataStrength;
  }

  buildHardnessLUT() {
    const n = (LUT_MAX - LUT_MIN) * LUT_RES;
    this._lut = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const t = (LUT_MIN + k / LUT_RES) / this.strataSpacing;
      // Thin hard caprock bands separated by thicker soft layers
      const band = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 + Math.sin(t * 0.7) * 1.3);
      this._lut[k] = 0.15 + 0.8 * Math.pow(band, 3);
    }
    this._lutSpacing = this.strataSpacing;
  }

  /**
   * Multiplier applied to erosion rates. Soft rock erodes up to ~5x faster than hard rock, and
   * plant cover protects the ground: forest ≈ 0.15x, grassland ≈ 0.8x, barren ≈ 1.4x.
   */
  erodibilityAt(h, i) {
    return (1.15 - this.hardnessAt(h, i)) * (1.4 - 1.25 * this.vegetation[i]);
  }

  /** Mark the current terrain as the reference for the erosion/deposition view. */
  setBaseline() {
    this.baseline.set(this.height);
  }

  clearWater() {
    this.water.fill(0);
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
