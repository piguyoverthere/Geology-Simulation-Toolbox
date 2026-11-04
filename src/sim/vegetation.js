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
//
// Forests are communities, not individual cells: seeds spread from neighbouring trees and a canopy
// keeps its own ground moist and shaded. So whether a spot can hold forest is judged on its
// neighbourhood (averaged slope and moisture), and cover is pulled toward the local average. That
// grows continuous expanses with clean edges instead of a speckle of single-cell groves.

import { createNoise2D, fbm } from '../core/noise.js';
import { boxBlur } from '../core/grid.js';
import { waterParams } from './water.js';

export const vegetationParams = {
  growth: 0.03,       // how fast cover moves toward the site's potential per step
  disturbance: 0.6,   // cover lost per unit of ground removed or buried
  treeLine: 38,       // forests give way to alpine grassland above this height
  alpineBand: 18,     // grassland thins out to bare ground over this much height above the tree line
  forestShare: 0.5,   // forest can take the gentlest this-fraction of the land (relative to the map)
  forestSlopeMax: 0.85, // …but never on ground steeper than this (rise/run, ≈ 40°)
  riparianReach: 4,   // how far (cells, roughly ×2) the wet zone extends from open water
  riparianBoost: 5,   // extra growth speed right beside water (1 + boost times the normal rate)
  standRadius: 4,     // neighbourhood (cells) used to judge whether a stand of forest fits
  spread: 0.35,       // how strongly cover is pulled toward its neighbours' average (seed spread)
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
      world.moisture[z * N + x] = Math.min(1, Math.max(0, 0.5 + 1.3 * fbm(noise, x / 95, z / 95, 3)));
    }
  }
  updateNearWater(world);
  world.vegetation.fill(0);
  // A few passes of soil ⇄ vegetation lets the plants' own water use and seed spread settle in
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < N * N; i++) world.soil[i] = soilSupply(world, i);
    const f = neighbourhood(world);
    for (let i = 0; i < N * N; i++) world.vegetation[i] = potential(world, i, f);
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

/** Per-cell slope plus neighbourhood averages of slope, soil moisture and plant cover. */
function neighbourhood(world) {
  const N = world.N, H = world.height, r = vegetationParams.standRadius;
  const slope = new Float32Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const gx = (H[x < N - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * 0.5;
      const gz = (H[z < N - 1 ? i + N : i] - H[z > 0 ? i - N : i]) * 0.5;
      slope[i] = Math.sqrt(gx * gx + gz * gz);
    }
  }
  const standSlope = boxBlur(slope, N, r);
  // "Gentle" is relative to this landscape: the slope below which `forestShare` of the land lies
  // (estimated from a fixed sample of cells so it's cheap and stable from step to step)
  const sample = [];
  for (let k = 0; k < 4096; k++) sample.push(standSlope[(k * 2654435761) % (N * N) >>> 0]);
  sample.sort((a, b) => a - b);
  const p = vegetationParams;
  const gentle = Math.min(p.forestSlopeMax, sample[Math.floor(p.forestShare * (sample.length - 1))]);
  return {
    slope,
    gentle,
    standSlope,
    standSoil: boxBlur(world.soil, N, r),
    standCover: boxBlur(world.vegetation, N, 2),
  };
}

/** The cover a cell can support (0..1), given the neighbourhood fields `f`. */
function potential(world, i, f) {
  const h = world.height[i];
  if (h < world.seaLevel) return 0;
  const p = vegetationParams;
  const slope = f.slope[i];

  // Blend this cell's soil with its neighbourhood's: a stand shares (and shades) its water
  const soil = 0.4 * world.soil[i] + 0.6 * f.standSoil[i];
  const steep = 1 - 0.85 * smoothstep(0.6, 1.8, slope);
  // Above the tree line plants get sparser, down to bare ground at the top of the alpine band
  const alpine = 1 - 0.95 * smoothstep(p.treeLine, p.treeLine + p.alpineBand, h);
  // Lakes drown plants; shallow floodwater on a floodplain does not
  const drowned = 1 - smoothstep(1, 3, world.water[i]);
  let v = (0.05 + 1.1 * soil) * steep * alpine * drowned;
  // Seed spread: pulled toward the neighbours' cover, so groves fill in and merge
  v += (f.standCover[i] - v) * p.spread * steep * drowned;

  // Forest (cover above ~0.6) needs all three, judged over the whole stand: gentle ground for deep
  // soil, enough water, and to be below the tree line. Otherwise the site tops out as grassland.
  const forestOk = (1 - smoothstep(f.gentle * 0.85, f.gentle * 1.1, f.standSlope[i]))
    * smoothstep(p.forestWater - 0.15, p.forestWater + 0.05, soil)
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
  for (let i = 0; i < V.length; i++) S[i] += (soilSupply(world, i) - S[i]) * p.soilMemory;
  const f = neighbourhood(world);
  for (let i = 0; i < V.length; i++) {

    // Slow creep is tolerated; only real scouring or burial damages plants
    const change = Math.max(0, Math.abs(H[i] - P[i]) - 0.05);
    let v = V[i] - change * p.disturbance;
    const target = potential(world, i, f);
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
