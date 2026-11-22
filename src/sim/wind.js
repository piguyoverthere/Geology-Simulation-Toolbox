// Surface wind.
//
// The prevailing wind (Climate → wind direction) blows hardest over open water, building up over
// the stretch of sea it has crossed (the fetch), and is blocked by land: an island or headland
// casts a wind shadow behind it, longer the higher it stands, so its lee is calm. Over land it
// slows over rough ground and in valleys, and is strongest on exposed ridges and coasts.
//
// world.wind (≈0 calm … 1.5 gale) drives the sea's surface currents and waves (sim/ocean.js), and
// wears down soft, bare rock very slowly: wind erosion picks the grains out of sedimentary rock
// (sandstone, shale, limestone, conglomerate) where there's no plant cover to protect it, and drops
// them downwind (into the sea as silt, or on land in sheltered spots).

import { climateParams } from './climate.js';
import { ROCK_INDEX } from '../core/rocks.js';

export const windParams = {
  strength: 1,   // overall wind strength (ocean wind)
  erosion: 1,    // how fast wind wears down bare sedimentary rock (very slow at 1)
};

let cache = null;

/** Recompute the wind field (cached: only when the wind, the sea or the land has changed). */
export function updateWind(world, force = false) {
  const N = world.N, n = N * N, H = world.height;
  if (!world.wind || world.wind.length !== n) { world.wind = new Float32Array(n); force = true; }
  const sea = world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9;
  let sig = Math.round((climateParams.windAngle || 0) * 10) * 7919 + Math.round(sea * 8) + Math.round(windParams.strength * 100) * 13;
  for (let k = 0; k < 300; k++) sig = (sig * 31 + Math.round(H[(k * 2654435761) % n >>> 0] * 2)) | 0;
  if (!force && cache && cache.sig === sig && cache.N === N) return world.wind;
  cache = { sig, N };
  const a = ((climateParams.windAngle || 0) * Math.PI) / 180, ux = Math.cos(a), uz = Math.sin(a);
  const W = world.wind, STEPS = 28, STEP = 1.6;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const wet = H[i] < sea;
      const base = Math.max(sea, H[i]);
      // Walk upwind: count the open water crossed (fetch) and find the tallest obstacle's shadow
      let fetch = 0, shelter = 0, open = true;
      for (let k = 1; k <= STEPS; k++) {
        const sx = x - ux * k * STEP, sz = z - uz * k * STEP;
        if (sx < 0 || sz < 0 || sx > N - 1 || sz > N - 1) { if (open) fetch += STEPS - k + 1; break; } // open ocean beyond the map
        const j = (sz | 0) * N + (sx | 0), hj = H[j];
        if (hj < sea) { if (open) fetch++; }
        else {
          open = false;
          // A wind shadow reaches roughly 8× the obstacle's height downwind
          const rise = Math.max(hj, sea) - base;
          if (rise > 0) shelter = Math.max(shelter, Math.min(1, rise / (k * STEP * 0.125 + 1)));
          else shelter = Math.max(shelter, 0.15 * Math.max(0, 1 - k / STEPS)); // rough ground upwind
        }
      }
      const f = fetch / STEPS;
      let w = wet
        ? 0.55 + 0.75 * f                                            // over the sea: builds with fetch
        : 0.45 + 0.35 * f + Math.min(0.4, Math.max(0, H[i] - sea) * 0.012); // over land: windier up high
      w *= 1 - 0.85 * shelter;
      W[i] = w * windParams.strength;
    }
  }
  return W;
}

const SEDIMENTARY = new Set(['sandstone', 'shale', 'limestone', 'conglomerate'].map((id) => ROCK_INDEX[id]));

/**
 * Wind erosion (extremely slow): bare sedimentary rock is worn down where the wind is strong, the
 * grains dropped a few cells downwind. Run with the slow steps.
 */
export function windErosion(world) {
  if (windParams.erosion <= 0 || !world.wind) return;
  const N = world.N, H = world.height, W = world.wind, V = world.vegetation, n = N * N;
  const sea = world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9;
  const a = ((climateParams.windAngle || 0) * Math.PI) / 180, dx = Math.round(Math.cos(a) * 5), dz = Math.round(Math.sin(a) * 5);
  const k = 0.00004 * windParams.erosion;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x, h = H[i];
      if (h < sea + 0.5) continue;
      const w = W[i];
      if (w < 0.6) continue;
      const bare = (1 - Math.min(1, V[i] * 1.4)) * (1 - Math.min(1, (world.humus ? world.humus[i] : 0) * 1.2));
      if (bare <= 0.05) continue;
      const r = world.rockAt(h - 0.05, i);
      if (!SEDIMENTARY.has(r)) continue;
      const cut = k * (w - 0.6) * (w - 0.6) * 4 * bare * (1.2 - world.hardnessAt(h, i));
      if (cut <= 0) continue;
      H[i] -= cut;
      // Downwind: into the sea as silt, or settling on land
      const tx = x + dx, tz = z + dz;
      if (tx < 0 || tz < 0 || tx >= N || tz >= N) continue;
      const j = tz * N + tx;
      if (H[j] < sea) { if (world.silt) world.silt[j] = Math.min(4, world.silt[j] + cut * 4); }
      else H[j] += cut;
    }
  }
  world.dirty = true;
}
