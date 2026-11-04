// Vegetation cover and its feedback on erosion.
//
// world.vegetation holds a cover value per cell from 0 to 1:
//   0.0 – 0.33  barren   (bare soil/rock: erodes fastest)
//   0.33 – 0.66 grassland (roots bind the topsoil: medium erosion)
//   0.66 – 1.0  forest   (deep roots, leaf litter and canopy shield the ground: low erosion)
//
// Plants grow toward what the site can support. They like gentle slopes, moisture and moderate
// elevation. Flooding, burial by sediment and having the soil washed away all kill them off. This
// gives the classic feedback loop: bare ground erodes, and erosion keeps ground bare.

import { createNoise2D, fbm } from '../core/noise.js';

export const vegetationParams = {
  growth: 0.03,       // how fast cover moves toward the site's potential per step
  disturbance: 0.6,   // cover lost per unit of ground removed or buried
  treeLine: 38,       // forests thin out above this height
  forestSlope: 0.45,  // slope (rise/run, ≈ 24°) above which forest gives way to grassland
};

/** Build a moisture map from noise and set vegetation straight to its potential. */
export function initVegetation(world, seed = 1) {
  const N = world.N;
  const noise = createNoise2D(seed * 31 + 5);
  if (!world.moisture) world.moisture = new Float32Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      // Wet and dry regions (rain shadows, soil differences) give distinct biome patches
      world.moisture[z * N + x] = Math.min(1, Math.max(0, 0.5 + 1.2 * fbm(noise, x / 70, z / 70, 4)));
    }
  }
  for (let i = 0; i < N * N; i++) world.vegetation[i] = potential(world, i);
  world.prevHeight.set(world.height);
  world.dirty = true;
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

  let m = world.moisture ? world.moisture[i] : 0.5;
  // Valley floors near water stay wetter
  if (world.water[i] > 0.01) m += 0.3;
  const p = vegetationParams;
  const steep = 1 - 0.85 * smoothstep(0.6, 1.8, slope);
  const cold = 1 - smoothstep(p.treeLine, p.treeLine + 14, h);
  // Lakes drown plants; shallow floodwater on a floodplain does not
  const drowned = 1 - smoothstep(1, 3, world.water[i]);
  let v = (0.05 + 1.1 * m) * steep * (0.4 + 0.6 * cold) * drowned;
  // Forests need deep, stable soil, which only builds up on gentle ground. Moderate slopes top out
  // as grassland (cover < 0.6); the steepest stay barren via the `steep` term above.
  const forestCap = 1 - 0.42 * smoothstep(p.forestSlope * 0.6, p.forestSlope, slope);
  v = Math.min(v, forestCap);
  return Math.max(0, Math.min(1, v));
}

/** Grow/decay vegetation one step. */
export function vegetationStep(world) {
  const V = world.vegetation, H = world.height, P = world.prevHeight;
  const p = vegetationParams;
  for (let i = 0; i < V.length; i++) {
    // Slow creep is tolerated; only real scouring or burial damages plants
    const change = Math.max(0, Math.abs(H[i] - P[i]) - 0.05);
    let v = V[i] - change * p.disturbance;
    v += (potential(world, i) - v) * p.growth;
    V[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  P.set(H);
  world.dirty = true;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
