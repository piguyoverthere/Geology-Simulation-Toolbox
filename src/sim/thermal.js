// Thermal erosion (a.k.a. mass wasting / talus creep).
//
// Loose rock can only pile up so steeply before it slides: this limit is the *angle of repose*
// (roughly 30–40° for dry rubble). Freeze–thaw cycles and gravity keep breaking material off
// slopes that are steeper than that and dropping it lower down, which is how scree slopes form at
// the foot of cliffs. Hard rock can hold steeper faces than soft rock, so strata matter here too.

export const thermalParams = {
  talusAngle: 34,  // degrees: slopes steeper than this shed material
  rate: 0.5,       // fraction of the excess moved per step
};

import { saturation, landslideParams } from './landslides.js';

const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

let delta = null;

/**
 * One relaxation pass. If `region` ({x, z, r}) is given, only cells inside it are processed.
 * @param {import('../core/world.js').World} world
 */
export function thermalStep(world, region = null, strength = 1) {
  if (!world.erosionEnabled) return;
  const N = world.N;
  const H = world.height;
  if (!delta || delta.length !== H.length) delta = new Float32Array(H.length);

  const baseTan = Math.tan((thermalParams.talusAngle * Math.PI) / 180);
  let x0 = 1, x1 = N - 1, z0 = 1, z1 = N - 1;
  if (region) {
    x0 = Math.max(1, Math.floor(region.x - region.r)); x1 = Math.min(N - 1, Math.ceil(region.x + region.r));
    z0 = Math.max(1, Math.floor(region.z - region.r)); z1 = Math.min(N - 1, Math.ceil(region.z + region.r));
  }
  // Only the processed box (plus the neighbours it can push material into) is cleared and applied,
  // so relaxing a small region is cheap
  const ax0 = x0 - 1, ax1 = Math.min(N - 1, x1), az0 = z0 - 1, az1 = Math.min(N - 1, z1);
  for (let z = az0; z <= az1; z++) delta.fill(0, z * N + ax0, z * N + ax1 + 1);

  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      let falloff = 1;
      if (region) {
        const d = Math.hypot(x - region.x, z - region.z) / region.r;
        if (d >= 1) continue;
        falloff = 1 - d * d;
      }
      const i = z * N + x;
      const h = H[i];
      // Harder rock stands steeper (about 0.85x to 1.3x the base talus slope)
      // Roots also bind slopes: forested ground holds up to ~30% steeper than bare ground
      // Rain-soaked ground loses much of its friction, so saturated slopes slump at gentler angles
      const tanLimit = baseTan * (0.8 + 0.5 * world.hardnessAt(h, i)) * (1 + 0.3 * world.vegetation[i] + 0.25 * world.forestAge[i])
        * (1 - landslideParams.satWeakening * saturation(world, i));

      let total = 0, maxDiff = 0;
      const diffs = [0, 0, 0, 0, 0, 0, 0, 0];
      for (let k = 0; k < 8; k++) {
        const j = (z + NEIGHBORS[k][1]) * N + (x + NEIGHBORS[k][0]);
        const dist = k < 4 ? 1 : Math.SQRT2;
        const d = h - H[j];
        if (d / dist > tanLimit) {
          diffs[k] = d - tanLimit * dist;
          total += diffs[k];
          if (d > maxDiff) maxDiff = d;
        }
      }
      if (total <= 0) continue;

      const move = Math.min(maxDiff * 0.5, total) * thermalParams.rate * strength * falloff;
      delta[i] -= move;
      for (let k = 0; k < 8; k++) {
        if (diffs[k] > 0) {
          const j = (z + NEIGHBORS[k][1]) * N + (x + NEIGHBORS[k][0]);
          delta[j] += move * (diffs[k] / total);
        }
      }
    }
  }

  for (let z = az0; z <= az1; z++) for (let i = z * N + ax0; i <= z * N + ax1; i++) H[i] += delta[i];
  world.dirty = true;
}
