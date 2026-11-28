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

import { climateParams, seasonParams } from './climate.js';
import { ROCK_INDEX } from '../core/rocks.js';

export const windParams = {
  strength: 1,   // overall wind strength (ocean wind)
  erosion: 1,    // how fast wind wears down bare sedimentary rock (very slow at 1)
  variability: 1, // how much the wind changes from day to day: veering, calm days and gales (0 = always the prevailing wind)
};

/**
 * Today's wind: each simulated day brings its own weather on top of the prevailing wind. It veers
 * (mostly within ±40° or so of the prevailing direction, now and then right round), and blows
 * harder or softer (calm days, breezy days, the odd gale; windier in winter). It turns and changes
 * over a few hours rather than all at once. veer: degrees off the Wind direction setting; factor:
 * × the strength.
 */
export const windNow = { veer: 0, factor: 1, day: -1, toVeer: 0, toFactor: 1 };

function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 2; } // (about ±3, sd 1)

function dailyWind(dt = 1) {
  const v = windParams.variability ?? 1;
  const day = Math.floor(((seasonParams.year || 1) + (seasonParams.phase || 0)) * 360 / 2); // (a new spell of weather every couple of days)
  if (day !== windNow.day) {
    windNow.day = day;
    if (v <= 0) { windNow.toVeer = 0; windNow.toFactor = 1; }
    else {
      // (a day in ten the wind comes from somewhere else entirely)
      windNow.toVeer = Math.random() < 0.1 * Math.min(1, v) ? (Math.random() - 0.5) * 300 : gauss() * 22 * v;
      const winter = Math.cos(((seasonParams.phase || 0) - 0.8) * Math.PI * 2); // (+1 midwinter)
      windNow.toFactor = Math.max(0.15, Math.min(2.2, Math.exp(gauss() * 0.35 * v) * (1 + 0.15 * winter * Math.min(1, v))));
    }
  }
  const k = Math.min(1, 0.15 * dt);
  windNow.veer += (windNow.toVeer - windNow.veer) * k;
  windNow.factor += (windNow.toFactor - windNow.factor) * k;
}

let cache = null, field0 = null, FS = null;

/** Recompute the wind field (cached: only when the wind, the sea or the land has changed). */
export function updateWind(world, force = false) {
  const N = world.N, n = N * N, H = world.height;
  if (!world.wind || world.wind.length !== n) { world.wind = new Float32Array(n); force = true; }
  dailyWind();
  // (the field is worked out again when the day's wind has turned by 15° or more; how hard it blows
  // just scales it)
  const angle = Math.round(((climateParams.windAngle || 0) + windNow.veer) / 15) * 15;
  const sea = world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9;
  let sig = Math.round(angle * 10) * 7919 + Math.round(sea * 8) + Math.round(windParams.strength * 100) * 13;
  for (let k = 0; k < 300; k++) sig = (sig * 31 + Math.round(H[(k * 2654435761) % n >>> 0] * 2)) | 0;
  const W = world.wind;
  if (!force && cache && cache.sig === sig && cache.N === N && field0 && field0.length === n) {
    const f = windNow.factor;
    for (let i = 0; i < n; i++) W[i] = field0[i] * f;
    return W;
  }
  cache = { sig, N };
  if (!field0 || field0.length !== n) field0 = new Float32Array(n);
  const a = (angle * Math.PI) / 180, ux = Math.cos(a), uz = Math.sin(a);
  const STEPS = 28, STEP = 1.6;
  // The fetch and shelter are traced on every other cell on big maps (they change smoothly; a
  // quarter of the work, so the field can follow the day's wind), each cell's own height after
  const s = N >= 192 ? 2 : 1;
  if (!FS || FS.length !== 2 * n) FS = new Float32Array(2 * n);
  for (let z = 0; z < N; z += s) {
    for (let x = 0; x < N; x += s) {
      const i = z * N + x;
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
      for (let dz = 0; dz < s && z + dz < N; dz++) for (let dx = 0; dx < s && x + dx < N; dx++) {
        const q = (z + dz) * N + x + dx;
        FS[q] = fetch / STEPS; FS[n + q] = shelter;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const f = FS[i], wet = H[i] < sea;
    let w = wet
      ? 0.55 + 0.75 * f                                            // over the sea: builds with fetch
      : 0.45 + 0.35 * f + Math.min(0.4, Math.max(0, H[i] - sea) * 0.012); // over land: windier up high
    w *= 1 - 0.85 * FS[n + i];
    field0[i] = w * windParams.strength;
    W[i] = field0[i] * windNow.factor;
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
  const a = (((climateParams.windAngle || 0) + windNow.veer) * Math.PI) / 180, dx = Math.round(Math.cos(a) * 5), dz = Math.round(Math.sin(a) * 5);
  const k = 0.00004 * windParams.erosion;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x, h = H[i];
      if (h < sea + 0.5 || world.builtUp(i)) continue; // (kept ground doesn't blow away)
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
