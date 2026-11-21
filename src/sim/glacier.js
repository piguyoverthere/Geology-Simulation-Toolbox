// Glaciers.
//
// A glacier is a river of ice. Where more snow falls each winter than melts each summer, it piles
// up year after year and compacts into ice (world.ice, thickness). Thick ice deforms under its own
// weight and creeps downhill, fastest where it is thickest and steepest (ice flow rises steeply
// with thickness: the shallow-ice approximation, flux ~ h^5 × slope^3, simplified here).
//
// Moving ice grinds and plucks its bed. It erodes hardest under the thickest, fastest ice in the
// middle of a valley and least at the edges, so a V-shaped river valley is carved into a U-shaped
// trough with a flat floor and steep walls. The rock it removes is carried along in the ice
// (world.iceDebris) and dropped where the ice melts: ridges of rubble called moraines, along the
// sides and as a horseshoe at the snout where the glacier ends.
//
// Below the equilibrium line (roughly where the year's average temperature is above freezing) the
// ice melts faster than snow replaces it. Its meltwater feeds the streams below, and the glacier
// ends where flow downhill and melting balance. Warm the climate and it retreats up the valley,
// leaving its moraines behind; cool it and it advances.

import { climateParams, seasonParams } from './climate.js';

export const glacierParams = {
  flow: 0.08,       // how readily ice creeps downhill
  erosion: 0.03,    // bed lowered per unit of ice sliding (× wall steepness)
  firn: 0.002,      // snow turned to ice per step where the pack is deep and lasting
  melt: 0.03,       // ice melted per step per °C above freezing (× season speed)
  moraine: 0.6,     // share of carried debris dropped where the ice melts
};

/** Make sure the ice fields exist. */
export function ensureIce(world) {
  const n = world.N * world.N;
  if (!world.ice || world.ice.length !== n) world.ice = new Float32Array(n);
  if (!world.iceDebris || world.iceDebris.length !== n) world.iceDebris = new Float32Array(n);
  if (!world.iceFlow || world.iceFlow.length !== n) world.iceFlow = new Float32Array(n);
}

let out = null, dOut = null;

/** Ice flow and erosion (run often: a few times a second). */
export function glacierFlow(world, dt = 1) {
  ensureIce(world);
  const N = world.N, n = N * N, I = world.ice, H = world.height, DB = world.iceDebris, FL = world.iceFlow;
  if (!out || out.length !== n) { out = new Float32Array(n); dOut = new Float32Array(n); }
  out.fill(0); dOut.fill(0);
  const p = glacierParams;
  let any = false;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      const h = I[i];
      if (h < 0.01) { FL[i] = 0; continue; }
      any = true;
      const s = H[i] + h;
      // Ice surface slopes to the four neighbours; ice moves toward the lower ones
      const nb = [i - 1, i + 1, i - N, i + N];
      let drops = 0;
      const d = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const j = nb[k];
        const g = s - (H[j] + I[j]);
        if (g > 0) { d[k] = g; drops += g; }
      }
      if (drops <= 0) { FL[i] = 0; continue; }
      // Flux grows steeply with thickness and slope; never more than a fraction of the ice here
      // (thick ice flows fastest, but even the thin snout creeps forward, so it tapers instead of
      // standing as a wall)
      const slope = Math.min(2, drops * 0.5);
      let q = p.flow * dt * (h * h + 0.6) * slope;
      q = Math.min(q, h * 0.25);
      FL[i] = q / Math.max(h, 0.1); // a speed proxy (used for erosion and the readout)
      for (let k = 0; k < 4; k++) {
        if (d[k] <= 0) continue;
        const share = q * (d[k] / drops), j = nb[k];
        out[i] -= share; out[j] += share;
        // Debris rides along with the ice
        const dd = DB[i] * (share / h);
        dOut[i] -= dd; dOut[j] += dd;
      }
      // The sliding ice grinds its bed, and scours sloping walls hardest (it presses against them
      // as it flows past). The walls are cut back until the floor is broad and flat, while above
      // the ice they're untouched: a U-shaped trough with steep sides where the ice edge was.
      const bx = (H[i + 1] - H[i - 1]) * 0.5, bz = (H[i + N] - H[i - N]) * 0.5;
      const wall = Math.min(1.5, Math.sqrt(bx * bx + bz * bz));
      const speed = q / Math.max(h, 0.5);
      const cut = p.erosion * dt * speed * Math.min(1, h / 1.5) * (0.25 + wall) * world.erodibilityAt(H[i], i);
      H[i] -= cut;
      DB[i] += cut;
    }
  }
  if (!any) return false;
  for (let i = 0; i < n; i++) {
    if (out[i] !== 0) I[i] = Math.max(0, I[i] + out[i]);
    if (dOut[i] !== 0) DB[i] = Math.max(0, DB[i] + dOut[i]);
  }
  world.dirty = true;
  return true;
}

/**
 * Mass balance (run with the vegetation/climate step): deep, lasting snow compacts into ice; ice
 * melts above freezing once its snow cover is gone, dropping the debris it carried as moraine and
 * feeding meltwater into the streams.
 */
export function glacierBalance(world) {
  ensureIce(world);
  const n = world.N * world.N, I = world.ice, S = world.snow, T = world.temperature, H = world.height;
  const DB = world.iceDebris, D = world.water, p = glacierParams;
  const st = world.seasonT || 0, sp = seasonParams.enabled ? seasonParams.speed : 1;
  // Only snow that survives the summer turns to ice: with seasons on that happens at the end of
  // summer, to whatever snow is still lying then, year after year
  const ph = seasonParams.phase;
  const firnTime = seasonParams.enabled ? smooth(0.38, 0.42, ph) * (1 - smooth(0.5, 0.54, ph)) * 4 : 1;
  for (let i = 0; i < n; i++) {
    // Firn: a pack that lasts from year to year compacts into ice (snow is mostly air, so it shrinks)
    if (firnTime > 0 && S && S[i] > 1) {
      const f = p.firn * firnTime * (S[i] - 1) * sp;
      S[i] -= f; I[i] += f * 0.5;
    }
    if (I[i] <= 0) continue;
    // Ablation: bare ice melts above freezing
    const warm = T[i] + st;
    if (warm > 0 && (!S || S[i] < 0.05)) {
      const m = Math.min(I[i], p.melt * warm * sp);
      I[i] -= m;
      D[i] += m * 0.4;
      // Rubble melts out and is left behind as moraine
      if (DB[i] > 0) {
        const drop = DB[i] * Math.min(1, p.moraine * (m / Math.max(I[i] + m, 0.05)) + (I[i] < 0.05 ? 1 : 0));
        H[i] += drop; DB[i] -= drop;
      }
    }
    if (I[i] < 0.005) {
      if (DB[i] > 0) { H[i] += DB[i]; DB[i] = 0; }
      I[i] = 0;
    }
  }
}

/** Paint ice (Glacier tool). amount < 0 removes it, dropping its debris. */
export function addIce(world, i, amount) {
  ensureIce(world);
  const I = world.ice;
  if (amount >= 0) I[i] += amount;
  else {
    I[i] = Math.max(0, I[i] + amount);
    if (I[i] === 0 && world.iceDebris[i] > 0) { world.height[i] += world.iceDebris[i]; world.iceDebris[i] = 0; }
  }
  world.vegetation[i] = Math.min(world.vegetation[i], 0.05);
  world.dirty = true;
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
