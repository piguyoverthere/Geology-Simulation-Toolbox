// The living, moving sea: tidal currents, salinity and estuaries, plankton blooms and low-oxygen
// dead zones, sea ice that freezes and thaws cell by cell, storm surge and storm waves, and surf.
// Run from the coast step (a few times a second), before the water-quality step.
//
// • Tidal currents: as the tide rises (flood) the sea pours into the bays and channels from the
//   open ocean, and drains back out as it falls (ebb). Each spot's current runs along the route
//   to the open sea, fastest in narrow passages, carrying silt, pollutants, plankton and fresh
//   river water back and forth (plus a slow drift with the wind).
// • Salinity: rivers pour fresh water into the sea; near their mouths the water is brackish (an
//   estuary), mixing back to full seawater (≈35 parts per thousand) further out. Corals and kelp
//   need full seawater; eelgrass and salt marsh don't mind brackish water.
// • Plankton: microscopic algae bloom where the water is warm, sunny (spring and summer) and rich
//   in nutrients (sewage and farm runoff, i.e. the pollutants, and river water). A big bloom turns
//   the water green; when it dies and rots in quiet, deep water it uses up the oxygen there
//   (hypoxia), suffocating sea life: a dead zone. Healthy sea beds compete with the plankton for
//   the nutrients and keep blooms down.
// • Sea ice forms in freezing water cell by cell, first in sheltered, shallow bays and in fresher
//   water (which freezes at a higher temperature), thickening through the winter, and thaws back
//   in spring.
// • Storm surge: a storm over the sea raises it (low pressure lifts the surface, the wind piles
//   water against the coast), flooding low shores for a while; and its big waves pound the coast.
// • Surf: waves break along exposed shores, fiercest under a storm.

import { boxBlur } from '../core/grid.js';
import { climateParams, seasonParams } from './climate.js';

export const oceanParams = {
  currents: 1,   // strength of the tidal currents (0 = still water)
  surge: 1,      // how much storms raise the sea (storm surge) and whip up waves
  blooms: 1,     // how readily plankton blooms grow on nutrients
};

export function ensureOcean(world) {
  const n = world.N * world.N;
  for (const k of ['curU', 'curV', 'plankton', 'seaIce', 'surf', 'stormWave']) {
    if (!world[k] || world[k].length !== n) world[k] = new Float32Array(n);
  }
  if (!world.salinity || world.salinity.length !== n) world.salinity = new Float32Array(n).fill(1);
  if (!world.oxygen || world.oxygen.length !== n) world.oxygen = new Float32Array(n).fill(1);
}

let distCache = null; // distance to the open sea along the water: { key, dist }

/** Water distance from the open ocean (the map's edge) for every sea cell: the tide's route in. */
function openSeaDistance(world, sea) {
  const N = world.N, n = N * N, H = world.height;
  // Recompute when the sea or the coastline moves noticeably (cheap check on a sample)
  let sig = Math.round(sea * 4);
  for (let k = 0; k < 400; k++) { const i = (k * 2654435761) % n >>> 0; if (H[i] < sea) sig = (sig * 31 + i) | 0; }
  if (distCache && distCache.key === sig && distCache.N === N) return distCache.dist;
  const dist = new Float32Array(n).fill(1e9);
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (x > 0 && z > 0 && x < N - 1 && z < N - 1) continue;
    const i = z * N + x;
    if (H[i] < sea) { dist[i] = 0; q[tail++] = i; }
  }
  while (head < tail) {
    const i = q[head++], x = i % N, z = (i / N) | 0, d = dist[i] + 1;
    if (x > 0 && H[i - 1] < sea && dist[i - 1] > d) { dist[i - 1] = d; q[tail++] = i - 1; }
    if (x < N - 1 && H[i + 1] < sea && dist[i + 1] > d) { dist[i + 1] = d; q[tail++] = i + 1; }
    if (z > 0 && H[i - N] < sea && dist[i - N] > d) { dist[i - N] = d; q[tail++] = i - N; }
    if (z < N - 1 && H[i + N] < sea && dist[i + N] > d) { dist[i + N] = d; q[tail++] = i + N; }
  }
  distCache = { key: sig, N, dist };
  return dist;
}

/** Carry field F along the currents (semi-Lagrangian: each cell takes what was upstream). */
function advect(F, U, V, mask, N) {
  const n = N * N, out = new Float32Array(n);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (!mask[i]) { out[i] = F[i]; continue; }
      let sx = x - U[i], sz = z - V[i];
      sx = sx < 0 ? 0 : sx > N - 1.001 ? N - 1.001 : sx;
      sz = sz < 0 ? 0 : sz > N - 1.001 ? N - 1.001 : sz;
      const x0 = sx | 0, z0 = sz | 0, fx = sx - x0, fz = sz - z0, j = z0 * N + x0;
      // Only draw from water: a land sample falls back to this cell's own value
      const a = mask[j] ? F[j] : F[i], b = mask[j + 1] ? F[j + 1] : F[i];
      const c = mask[j + N] ? F[j + N] : F[i], d = mask[j + N + 1] ? F[j + N + 1] : F[i];
      out[i] = (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
    }
  }
  F.set(out);
}

/**
 * One ocean step. `exposure` is the open-water exposure from the coast step; `Tw` the surface
 * water temperature now. Returns nothing; updates world fields.
 */
export function oceanStep(world, sea, half, exposure, Tw, tidePeriod) {
  ensureOcean(world);
  const N = world.N, n = N * N, H = world.height, D = world.water, p = oceanParams;
  const U = world.curU, V = world.curV, SAL = world.salinity, PL = world.plankton, OX = world.oxygen;
  const ICE = world.seaIce, SURF = world.surf, SW = world.stormWave;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = H[i] < sea + half ? 1 : 0;

  // --- Tidal currents ---------------------------------------------------------------------
  // Flood (+) or ebb (−): how fast the tide is rising or falling now
  const t = world.time || 0;
  const flood = Math.cos((2 * Math.PI * t) / tidePeriod);
  const dist = openSeaDistance(world, sea);
  // Narrow passages run fastest (the same water squeezes through less width)
  const open = boxBlur(Float32Array.from(mask), N, 4);
  const wa = ((climateParams.windAngle || 0) * Math.PI) / 180, wdx = Math.cos(wa), wdz = Math.sin(wa);
  const amp = 0.9 * p.currents * Math.min(2, (2 * half) / 1.5);
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (!mask[i] || dist[i] >= 1e9) { U[i] = V[i] = 0; continue; }
      // Downhill in distance = toward the open sea; the flood runs the other way, inland
      const dl = dist[i - 1] < 1e9 ? dist[i - 1] : dist[i], dr = dist[i + 1] < 1e9 ? dist[i + 1] : dist[i];
      const du = dist[i - N] < 1e9 ? dist[i - N] : dist[i], dd = dist[i + N] < 1e9 ? dist[i + N] : dist[i];
      let gx = (dr - dl) * 0.5, gz = (dd - du) * 0.5;
      const g = Math.hypot(gx, gz) || 1;
      gx /= g; gz /= g;
      // Bays far up a channel feel the tide less; narrow passages squeeze it faster
      const squeeze = 1 / Math.max(0.25, open[i]);
      const reach = 1 / (1 + dist[i] / (N * 0.6));
      // (friction with the bottom slows the water in the shallows)
      const friction = Math.min(1, Math.max(0.1, (sea - H[i]) / 4));
      const s = amp * flood * Math.min(2.5, squeeze * 0.45) * reach * friction;
      // (plus a slow drift with the prevailing wind at the surface)
      U[i] = gx * s + 0.12 * wdx * p.currents;
      V[i] = gz * s + 0.12 * wdz * p.currents;
    }
  }
  if (p.currents > 0) {
    advect(world.silt, U, V, mask, N);
    advect(world.pollution, U, V, mask, N);
    advect(PL, U, V, mask, N);
    advect(SAL, U, V, mask, N);
  }

  // --- Salinity: rivers freshen the sea near their mouths -----------------------------------
  // Fresh water arriving from the land next door (streams and rivers), spread over a fan at
  // the mouth: river water is lighter than seawater and floats out over it as a plume
  const FR = new Float32Array(n);
  const VX = world.velX, VZ = world.velZ;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (!mask[i] || (mask[i - 1] && mask[i + 1] && mask[i - N] && mask[i + N])) continue;
      for (let k = 0; k < 4; k++) {
        const j = k === 0 ? i - 1 : k === 1 ? i + 1 : k === 2 ? i - N : i + N;
        if (mask[j] || D[j] < 0.03) continue; // (a real stream, not a film of rain)
        const flow = D[j] * Math.hypot(VX[j], VZ[j]);
        if (flow > 0.002) FR[i] += flow;
      }
    }
  }
  const fan = boxBlur(FR, N, 4);
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (!mask[i]) { SAL[i] = 1; continue; }
      const edge = Math.min(x, z, N - 1 - x, N - 1 - z) < 4 ? 0.2 : 0;
      SAL[i] += (1 - SAL[i]) * (0.006 + edge) - Math.min(0.6, fan[i] * 60) * SAL[i];
      if (SAL[i] < 0) SAL[i] = 0;
    }
  }
  // (mixing with the neighbours)
  const sb = boxBlur(SAL, N, 1);
  for (let i = 0; i < n; i++) if (mask[i]) SAL[i] += (sb[i] - SAL[i]) * 0.5;

  // --- Plankton, oxygen -------------------------------------------------------------------
  // Light: spring and summer (phase 0 is the spring equinox)
  const ph = seasonParams.enabled ? seasonParams.phase : 0.2;
  const light = seasonParams.enabled ? 0.25 + 0.75 * Math.max(0, Math.sin(2 * Math.PI * (ph + 0.05))) : 0.8;
  const warm = Math.max(0, Math.min(1, (Tw - 6) / 14));
  const PO = world.pollution, HL = world.marineHealth, M = world.marine;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) { PL[i] = 0; OX[i] = 1; continue; }
    // Nutrients: pollutants (sewage, fertiliser), river water, a little upwelling everywhere
    const nutrient = PO[i] + 0.4 * (1 - SAL[i]) + 0.03;
    // Sea beds take up nutrients first (and shade nothing: they compete with the plankton)
    const bed = M && M[i] >= 0 && HL ? HL[i] * (M[i] >= 1 && M[i] <= 3 ? 1 : 0) : 0;
    const grow = p.blooms * 0.12 * light * (0.3 + warm) * nutrient * (1 - 0.6 * bed) * (1 - (ICE[i] > 0.3 ? 0.8 : 0));
    PL[i] += grow * (1 - PL[i] / 3) - 0.04 * PL[i];
    if (PL[i] < 1e-4) PL[i] = 0;
    // Oxygen: a dying bloom rots and uses it up, worst in deep, sheltered, warm water where it
    // doesn't mix back in; open, wavy water and winter storms stir oxygen back down
    const depth = sea - H[i];
    // (far up a long inlet, like Hood Canal, the deep water is rarely flushed out to sea)
    const remote = dist[i] < 1e9 ? Math.min(1, Math.max(0, (dist[i] - N * 0.08) / (N * 0.3))) : 1;
    const still = Math.max(remote, 1 - Math.min(1, exposure[i] * 2.5)) * Math.min(1, Math.max(0, depth - 3) / 8);
    const use = 0.05 * Math.max(0, PL[i] - 0.5) * still * (0.5 + warm);
    const mixIn = 0.03 + 0.15 * (1 - still) + 0.1 * SW[i];
    OX[i] += -use + (1 - OX[i]) * mixIn;
    OX[i] = OX[i] < 0 ? 0 : OX[i] > 1 ? 1 : OX[i];
  }
  const pb = boxBlur(PL, N, 1);
  for (let i = 0; i < n; i++) if (mask[i]) PL[i] += (pb[i] - PL[i]) * 0.3;

  // --- Sea ice ----------------------------------------------------------------------------
  // Seawater freezes at about −1.9 °C, fresher water closer to 0 °C; sheltered, shallow water
  // freezes first and open, wavy water last
  for (let i = 0; i < n; i++) {
    if (!(H[i] < sea)) { ICE[i] = 0; continue; }
    const depth = sea - H[i];
    const freeze = -1.9 * SAL[i];
    const shelter = 1 - Math.min(1, exposure[i] * 1.6);
    const cold = freeze + 0.8 * shelter + 0.5 * (1 - Math.min(1, depth / 10)) - Tw; // > 0: freezing
    if (cold > 0) ICE[i] = Math.min(1.5, ICE[i] + 0.01 * Math.min(2, cold) * (0.4 + shelter) * (1 - 0.7 * SW[i]));
    else ICE[i] = Math.max(0, ICE[i] + 0.02 * Math.max(-3, cold));
  }

  // --- Storm surge and storm waves --------------------------------------------------------
  SW.fill(0);
  let surgeT = 0;
  for (const st of world.storms || []) {
    const s = (st.strength || 0) * p.surge;
    if (s <= 0) continue;
    const r = st.r * 1.6, x0 = Math.max(1, Math.floor(st.x - r)), x1 = Math.min(N - 2, Math.ceil(st.x + r));
    const z0 = Math.max(1, Math.floor(st.z - r)), z1 = Math.min(N - 2, Math.ceil(st.z + r));
    let overSea = 0, cells = 0;
    for (let z = z0; z <= z1; z += 2) for (let x = x0; x <= x1; x += 2) {
      const dd = Math.hypot(x - st.x, z - st.z) / r;
      if (dd >= 1) continue;
      const i = z * N + x, w = (1 - dd * dd) * s;
      cells++;
      if (mask[i]) overSea++;
      // Big waves under the storm (spread to the skipped neighbours too)
      SW[i] = Math.max(SW[i], w); SW[i + 1] = Math.max(SW[i + 1], w); SW[i + N] = Math.max(SW[i + N], w); SW[i + N + 1] = Math.max(SW[i + N + 1], w);
    }
    if (cells) surgeT += 1.2 * s * (overSea / cells);
  }
  world.surge = (world.surge || 0) + (Math.min(2.5, surgeT) - (world.surge || 0)) * 0.08;

  // --- Surf: breaking waves along exposed shores -----------------------------------------
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      SURF[i] = 0;
      if (!mask[i] || ICE[i] > 0.3) continue;
      // Within a couple of cells of the shore
      const m1 = !mask[i - 1] + !mask[i + 1] + !mask[i - N] + !mask[i + N];
      const m2 = (x > 1 && !mask[i - 2]) + (x < N - 2 && !mask[i + 2]) + (z > 1 && !mask[i - 2 * N]) + (z < N - 2 && !mask[i + 2 * N]);
      const shore = m1 + m2;
      if (!shore) continue;
      SURF[i] = Math.min(1, (exposure[i] * 2.2 + SW[i] * 1.5) * Math.min(1, shore / 2));
    }
  }
}
