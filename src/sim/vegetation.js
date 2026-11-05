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
// Fresh volcanic ground: new lava is bare rock with no soil, so plants can't take hold until it
// weathers (lichens and mosses first, then grasses, and forest only much later). world.freshRock
// marks it (1 = just erupted) and fades as the rock breaks down, faster where it's moist. Ash
// weathers into fertile soil much sooner than solid lava does.
//
// Soil (world.humus, 0 = bare mineral ground, 1 = deep fertile soil) is built by plants: leaf
// litter, roots and the life they feed turn rock debris into soil. Forests build it about three
// times faster than grassland, at a rate that depends on the forest type. Erosion strips it,
// lava and ash bury it, and fire burns some of it off. Deep soil holds more water, lets plants
// regrow faster and protects the ground a little from erosion. Plant roots also pry apart fresh
// lava and ash, so recolonisation speeds up once pioneers (and nearby forest) get a foothold.
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
import { FOREST_TYPES, forestTypeAt } from './forests.js';
import { waterParams } from './water.js';

export const vegetationParams = {
  growth: 0.03,       // how fast cover moves toward the site's potential per step
  disturbance: 0.6,   // cover lost per unit of ground removed or buried
  treeLine: 38,       // forests give way to alpine grassland above this height
  alpineBand: 18,     // grassland thins out to bare ground over this much height above the tree line
  forestShare: 0.6,   // forest can take the gentlest this-fraction of the land (relative to the map)
  forestSlopeMax: 0.85, // …but never on ground steeper than this (rise/run, ≈ 40°)
  riparianReach: 4,   // how far (cells, roughly ×2) the wet zone extends from open water
  riparianBoost: 5,   // extra growth speed right beside water (1 + boost times the normal rate)
  standRadius: 6,     // neighbourhood (cells) used to judge whether a stand of forest fits
  spread: 0.35,       // how strongly cover is pulled toward its neighbours' average (seed spread)
  aridSoil: 0.32,     // soil moisture below this counts as arid (desert / mesa country)
  grassBuffer: 10,    // forest keeps roughly 1–2× this many cells away from arid ground (grassland between)
  climate: 1,         // regional wetness multiplier (0 = desert, 1 = normal, 1.5 = rainforest)
  forestWater: 0.46,  // soil moisture a forest needs to sustain itself
  ashRecovery: 0.004, // how fast burnt ground recovers per step
  soilBuild: 0.004,      // soil formed per step under full plant cover (× forest type)
  forestSoilBoost: 3,    // forests build soil this many times faster than grassland
  soilDecay: 0.0015,     // bare soil slowly washes/blows away where nothing grows
  soilErosion: 1.5,      // soil lost per unit of ground eroded or buried
  weathering: 0.0009, // how fast fresh lava/ash breaks down into soil per step (×(0.4 + soil))
  uptake: 0.2,        // how much full plant cover draws down soil moisture
  soilMemory: 0.04,   // how fast soil moisture moves toward its supply each step
};

/** Build the climate moisture map and set soil water and vegetation straight to equilibrium. */
export function initVegetation(world, seed = 1) {
  const N = world.N;
  const noise = createNoise2D(seed * 31 + 5);
  if (!world.moisture) world.moisture = new Float32Array(N * N);
  if (!world.soil) world.soil = new Float32Array(N * N);
  world.humus.fill(0.3);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      // Wet and dry regions (rain shadows, soil differences) give distinct biome patches
      world.moisture[z * N + x] = Math.min(1, Math.max(0, 0.5 + 1.15 * fbm(noise, x / 170, z / 170, 3)));
    }
  }
  updateNearWater(world);
  world.vegetation.fill(0);
  // A few passes of soil ⇄ vegetation lets the plants' own water use and seed spread settle in
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < N * N; i++) world.soil[i] = soilSupply(world, i);
    const f = neighbourhood(world);
    for (let i = 0; i < N * N; i++) world.vegetation[i] = potential(world, i, f);
    // Mature soils: deepest under long-standing forest
    for (let i = 0; i < N * N; i++) world.humus[i] = Math.min(1, 1.1 * world.vegetation[i] ** 1.5);
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
    - p.uptake * world.vegetation[i]
    + 0.15 * world.humus[i]; // deep, organic soil holds water like a sponge
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
  world.standSlope = standSlope; // also used by the renderer to split desert (flat) from mesa (steep)
  // How much arid ground lies nearby. Forest needs a margin of grassland between it and the
  // desert: the moisture gradient at a dry edge is too steep and windblown for a closed canopy.
  const arid = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) arid[i] = world.soil[i] < vegetationParams.aridSoil ? 1 : 0;
  const nearArid = boxBlur(boxBlur(arid, N, vegetationParams.grassBuffer), N, vegetationParams.grassBuffer);
  // "Gentle" is relative to this landscape: the slope below which `forestShare` of the land lies
  // (estimated from a fixed sample of cells so it's cheap and stable from step to step)
  const sample = [];
  for (let k = 0; k < 4096; k++) sample.push(standSlope[(k * 2654435761) % (N * N) >>> 0]);
  sample.sort((a, b) => a - b);
  const p = vegetationParams;
  const gentle = Math.min(p.forestSlopeMax, sample[Math.floor(p.forestShare * (sample.length - 1))]);
  world.gentleSlope = gentle; // renderer: dry ground gentler than this is desert, steeper is mesa
  return {
    slope,
    gentle,
    standSlope,
    nearArid,
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
    * (1 - smoothstep(p.treeLine - 6, p.treeLine, h))
    * (1 - smoothstep(0.005, 0.06, f.nearArid[i]));
  v = Math.min(v, 0.58 + 0.42 * forestOk);
  return Math.max(0, Math.min(1, v));
}

/** Update soil water, then grow/decay vegetation one step. */
export function vegetationStep(world) {
  const V = world.vegetation, H = world.height, P = world.prevHeight, S = world.soil;
  const p = vegetationParams;
  updateNearWater(world);
  const W = world.nearWater, F = world.freshRock, SO = world.humus;
  for (let i = 0; i < V.length; i++) S[i] += (soilSupply(world, i) - S[i]) * p.soilMemory;
  const f = neighbourhood(world);
  for (let i = 0; i < V.length; i++) {

    // Burning cells don't regrow; burnt ground recovers slowly while plants creep back
    if (world.fire[i] > 0) continue;
    const burnt = world.burnt[i];
    // Slow creep is tolerated; only real scouring or burial damages plants
    const change = Math.max(0, Math.abs(H[i] - P[i]) - 0.05);
    let v = V[i] - change * p.disturbance;
    let target = potential(world, i, f);
    // Regrowth is faster near water; dieback (drought, cold) runs at the normal rate
    let rate = target > v ? p.growth * (1 + p.riparianBoost * W[i]) * (0.5 + SO[i]) : p.growth;
    if (burnt > 0) {
      if (target > v) rate *= 1 - 0.8 * burnt;
      world.burnt[i] = Math.max(0, burnt - p.ashRecovery * (1 + 2 * SO[i]));
    }
    const fresh = F[i];
    if (fresh > 0) {
      // Bare new rock can only hold sparse pioneers, and colonisation is slow until soil forms
      const exposed = world.surfaceRock[i] >= 0 && H[i] > world.surfaceBase[i] + 1e-3;
      if (!exposed) F[i] = 0; // eroded away: the old ground (and its soil) is back
      else {
        target = Math.min(target, 1 - fresh);
        if (target > v) rate *= (1 - fresh) * (1 - fresh);
        // Roots of the pioneers here and of the forest nearby break the rock down faster
        F[i] = Math.max(0, fresh - p.weathering * (0.4 + S[i]) * (1 + 3 * v + 4 * f.standCover[i]));
      }
    }
    v += (target - v) * Math.min(1, rate);
    V[i] = v < 0 ? 0 : v > 1 ? 1 : v;

    // Soil: built by plants (forests fastest, by type), lost to erosion/burial and on bare ground
    let soil = SO[i];
    const build = v > 0.66
      ? p.forestSoilBoost * FOREST_TYPES[forestTypeAt(world, i, H[i], p.treeLine)].soilBuild
      : 1;
    soil += p.soilBuild * v * v * build * (1 - soil) - p.soilDecay * soil * (1 - v) - change * p.soilErosion;
    if (F[i] > 0) soil = Math.min(soil, 1 - F[i]);
    SO[i] = soil < 0 ? 0 : soil > 1 ? 1 : soil;
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
