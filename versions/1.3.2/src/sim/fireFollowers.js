// Fire followers: plants (and, through the Recent small burns habitat in sim/ecology.js, animals)
// that live on freshly burnt ground, but only in the smaller burns.
//
// A burn is "small" when the patch it left is no bigger than ecoParams.smallBurn cells (fading out
// up to two and a half times that). Why only those: the followers reach a burn from the unburnt
// ground round it, by wind-blown seed or on the wing, so a small burn fills from its edges while the
// heart of a huge one is out of reach for years; and a big fire burns hot enough to cook the seeds
// waiting in the soil.
//
//   world.burnSuit   how good each cell is for fire followers now: a small burn, recently out
//                    (remembered after the ash has gone, fading over a few years as the ground
//                    greens over; the burning itself doesn't count until the fire is out)
//   world.fireweed   fireweed: wind-blown seed from fireweed nearby (and a few from far away); it
//                    carpets small burns in magenta for a few years, then is shaded out as the
//                    shrubs and trees come back
//   world.firePoppy  fire poppies (and other "smoke-germinating" annuals): their seeds wait in the
//                    soil (world.poppySeeds) for years and sprout only after a fire passes; one or
//                    two summers of flowers, which refill the seed bank. A big, hot fire kills the
//                    seed bank.
//
// Fire flowers feed pollinators (sim/pollinators.js), and animals that eat "fire-following
// flowers"; animals that eat "burnt and dead trees" (wood-boring beetles) follow the burns too.

import { boxBlur } from '../core/grid.js';
import { ecoParams } from './ecology.js';

const seaOf = (w) => (w.meanSea !== undefined && w.meanSea > -999 ? w.meanSea : -1e9);
let label = null, queue = null;

function ensure(world) {
  const n = world.N * world.N;
  for (const k of ['burnSuit', 'fireweed', 'firePoppy', 'burnSize']) if (!world[k] || world[k].length !== n) world[k] = new Float32Array(n);
  if (!world.poppySeeds || world.poppySeeds.length !== n) {
    // (a seed bank under dry, open ground and scrub to start with)
    world.poppySeeds = new Float32Array(n);
    const V = world.vegetation, sea = seaOf(world);
    for (let i = 0; i < n; i++) if (world.height[i] >= sea && V[i] > 0.15 && V[i] < 0.85) world.poppySeeds[i] = 0.35;
  }
}

/** How strongly a burn patch of this many cells counts as "small" (1 small … 0 too big). */
export function smallness(size) {
  const S = Math.max(10, ecoParams.smallBurn ?? 400);
  return size <= S ? 1 : Math.max(0, 1 - (size - S) / (1.5 * S));
}

/** One fire-follower step (every 30 frames). */
export function fireFollowerStep(world) {
  if (!ecoParams.fireFollowers) return;
  ensure(world);
  const N = world.N, n = N * N, sea = seaOf(world);
  const B = world.burnt, F = world.fire, V = world.vegetation, H = world.height;
  const SU = world.burnSuit, FW = world.fireweed, FP = world.firePoppy, SB = world.poppySeeds, BS = world.burnSize;
  // --- Burn patches: each connected stretch of burnt ground, and how big it is ---
  if (!label || label.length !== n) { label = new Int32Array(n); queue = new Int32Array(n); }
  label.fill(0);
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (label[s] || B[s] < 0.15 || H[s] < sea) continue;
    next++;
    let head = 0, tail = 0, burning = false;
    queue[tail++] = s; label[s] = next;
    while (head < tail) {
      const i = queue[head++], x = i % N, z = (i - x) / N;
      if (F[i] > 0) burning = true;
      const nb = [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, z > 0 ? i - N : -1, z < N - 1 ? i + N : -1];
      for (const j of nb) if (j >= 0 && !label[j] && B[j] >= 0.15 && H[j] >= sea) { label[j] = next; queue[tail++] = j; }
    }
    if (burning) continue; // (still burning: wait until it's out to know how big it was)
    const size = tail, sm = smallness(size);
    for (let q = 0; q < tail; q++) {
      const i = queue[q];
      // (fresh ash: remembered as fire-follower ground for years, however fast the ash goes)
      const fresh = Math.min(1, B[i] * 1.4) * sm;
      if (fresh > SU[i] + 0.25) {
        // A new burn: the fire poppies' seed bank sprouts
        FP[i] = Math.max(FP[i], Math.min(1, SB[i] * 2.2) * sm);
      }
      if (fresh > SU[i]) SU[i] = fresh;
      BS[i] = size;
      // (a big, hot fire cooks the seed bank in the soil)
      if (sm < 0.3 && B[i] > 0.6) SB[i] *= 0.3;
    }
  }
  // --- The fire followers grow, spread and fade ---
  const seedRain = boxBlur(FW, N, 6);
  for (let i = 0; i < n; i++) {
    if (H[i] < sea || F[i] > 0) { FW[i] *= 0.5; FP[i] *= 0.5; continue; }
    const su = SU[i];
    // (the burn greens over: shrubs and trees shade the followers out)
    const open = 1 - Math.max(0, Math.min(1, (V[i] - 0.55) / 0.3));
    const target = su * open;
    // Fireweed: arrives on the wind from fireweed nearby (a little from far off), then spreads
    if (target > 0.02) {
      const arrive = 0.04 * seedRain[i] + 0.004;
      FW[i] += (target - FW[i]) * (FW[i] < target ? Math.min(0.25, arrive + 0.12 * FW[i]) : 0.05);
    } else FW[i] *= 0.95;
    // Fire poppies: one or two summers of flowers, refilling the seed bank
    if (FP[i] > 0) {
      SB[i] = Math.min(1, SB[i] + 0.02 * FP[i]);
      FP[i] *= target > 0.05 ? 0.985 : 0.9;
      if (FP[i] < 0.01) FP[i] = 0;
    }
    // (the seed bank slowly dies off without fire; scrub and open woods keep topping it up a little)
    SB[i] = Math.max(0, SB[i] * 0.9995 + (V[i] > 0.2 && V[i] < 0.8 ? 0.00005 : 0));
    // Fire-follower ground fades over a few years
    if (su > 0) SU[i] = su < 0.01 ? 0 : su * 0.993;
  }
  world.dirty = true;
}

/** Fire-following flowers at cell i (fireweed and fire poppies), 0…1. */
export function fireFlowers(world, i) {
  return Math.min(1, (world.fireweed ? world.fireweed[i] : 0) + (world.firePoppy ? world.firePoppy[i] : 0));
}
