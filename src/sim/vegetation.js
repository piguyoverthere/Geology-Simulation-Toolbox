// Vegetation cover and its feedback on erosion.
//
// world.vegetation holds a cover value per cell from 0 to 1:
//   0.0 – 0.33  barren   (bare soil/rock: erodes fastest)
//   0.33 – 0.66 grassland (roots bind the topsoil: medium erosion)
//   0.66 – 1.0  forest   (deep roots, leaf litter and canopy shield the ground: low erosion)
//
// Plants grow toward what the site can support. They like gentle slopes, water and moderate
// elevation. Flooding, burial by sediment and having the soil washed away all kill them off. This
// gives the classic feedback loop: bare ground erodes, and erosion keeps ground bare.
//
// Water: each cell keeps a soil-moisture store (world.soil) fed by the local climate, current
// rainfall and nearby rivers/lakes (the *riparian zone*, where the water table is high). Plants draw
// it down, forests most of all. Forests need moist soil, so when the supply drops (a spring is
// removed, rain stops, the climate dries), soil dries out and forests retreat to grassland, then
// grassland to bare ground. They hang on longest along rivers: the ribbon of trees along a desert river.
//
// Elevation: above the tree line it is too cold and windy for trees. Forest gives way to alpine
// grassland, which thins out to bare rock higher up.

import { createNoise2D, fbm } from '../core/noise.js';
import { boxBlur } from '../core/grid.js';
import { waterParams } from './water.js';

export const vegetationParams = {
  growth: 0.03,       // how fast cover moves toward the site's potential per step
  disturbance: 0.6,   // cover lost per unit of ground removed or buried
  treeLine: 38,       // forests give way to alpine grassland above this height
  alpineBand: 18,     // grassland thins out to bare ground over this much height above the tree line
  forestSlope: 0.45,  // slope (rise/run, ≈ 24°) above which forest gives way to grassland
  riparianReach: 4,   // how far (cells, roughly ×2) the wet zone extends from open water
  riparianBoost: 5,   // extra growth speed right beside water (1 + boost times the normal rate)
  climate: 1,         // regional wetness multiplier (0 = desert, 1 = normal, 1.5 = rainforest)
  forestWater: 0.5,   // soil moisture a forest needs to sustain itself
  uptake: 0.2,        // how much full plant cover draws down soil moisture
  soilMemory: 0.04,   // how fast soil moisture moves toward its supply each step
};

/** Build the climate moisture map and set soil water and vegetation straight to equilibrium. */
export function initVegetation(world, seed = 1) {
  const N = world.N;
  const noise = createNoise2D(seed * 31 + 5);
  if (!world.moisture) world.moisture = new Float32Array(N * N);
  if (!world.soil) world.soil = new Float32Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      // Wet and dry regions (rain shadows, soil differences) give distinct biome patches
      world.moisture[z * N + x] = Math.min(1, Math.max(0, 0.5 + 1.2 * fbm(noise, x / 70, z / 70, 4)));
    }
  }
  updateNearWater(world);
  world.vegetation.fill(0);
  // A few passes of soil ⇄ vegetation lets the plants' own water use settle in
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < N * N; i++) world.soil[i] = soilSupply(world, i);
    for (let i = 0; i < N * N; i++) world.vegetation[i] = potential(world, i);
  }
  world.prevHeight.set(world.height);
  world.dirty = true;
}

/** Soil moisture a cell would settle at: climate + rain + nearby water − what its plants use. */
function soilSupply(world, i) {
  const p = vegetationParams;
  const s = p.climate * world.moisture[i]
    + waterParams.rain * 8
    + 0.6 * world.nearWater[i]
    - p.uptake * world.vegetation[i];
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

/** The cover a cell can support (0..1). */
function potential(world, i) {
  const N = world.N, H = world.height;
  const x = i % N, z = (i / N) | 0;
  const h = H[i];
  if (h < world.seaLevel) return 0;
  const gx = (H[x < N - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * 0.5;
  const gz = (H[z < N - 1 ? i + N : i] - H[z > 0 ? i - N : i]) * 0.5;
  const slope = Math.sqrt(gx * gx + gz * gz);
  const p = vegetationParams;

  const soil = world.soil[i];
  const steep = 1 - 0.85 * smoothstep(0.6, 1.8, slope);
  // Above the tree line plants get sparser, down to bare ground at the top of the alpine band
  const alpine = 1 - 0.95 * smoothstep(p.treeLine, p.treeLine + p.alpineBand, h);
  // Lakes drown plants; shallow floodwater on a floodplain does not
  const drowned = 1 - smoothstep(1, 3, world.water[i]);
  let v = (0.05 + 1.1 * soil) * steep * alpine * drowned;

  // Forest (cover above ~0.6) needs all three: gentle ground for deep soil, enough water,
  // and to be below the tree line. Otherwise the site tops out as grassland.
  const forestOk = (1 - smoothstep(p.forestSlope * 0.6, p.forestSlope, slope))
    * smoothstep(p.forestWater - 0.12, p.forestWater + 0.08, soil)
    * (1 - smoothstep(p.treeLine - 6, p.treeLine, h));
  v = Math.min(v, 0.58 + 0.42 * forestOk);
  return Math.max(0, Math.min(1, v));
}

/** Update soil water, then grow/decay vegetation one step. */
export function vegetationStep(world) {
  const V = world.vegetation, H = world.height, P = world.prevHeight, S = world.soil;
  const p = vegetationParams;
  updateNearWater(world);
  const W = world.nearWater;
  for (let i = 0; i < V.length; i++) {
    S[i] += (soilSupply(world, i) - S[i]) * p.soilMemory;

    // Slow creep is tolerated; only real scouring or burial damages plants
    const change = Math.max(0, Math.abs(H[i] - P[i]) - 0.05);
    let v = V[i] - change * p.disturbance;
    const target = potential(world, i);
    // Regrowth is faster near water; dieback (drought, cold) runs at the normal rate
    const rate = target > v ? p.growth * (1 + p.riparianBoost * W[i]) : p.growth;
    v += (target - v) * Math.min(1, rate);
    V[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  P.set(H);
  world.dirty = true;
}

/** world.nearWater: 1 at open water, fading to 0 a few cells away from it. */
function updateNearWater(world) {
  const D = world.water;
  const wet = new Float32Array(D.length);
  for (let i = 0; i < D.length; i++) wet[i] = D[i] > 0.05 ? 1 : 0;
  const r = vegetationParams.riparianReach;
  const spread = boxBlur(boxBlur(wet, world.N, r), world.N, r);
  for (let i = 0; i < spread.length; i++) spread[i] = Math.min(1, spread[i] * 3);
  world.nearWater = spread;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
