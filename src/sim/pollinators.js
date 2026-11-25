// Pollinators: bees, hoverflies, butterflies and the like (world.pollinators, 0…1).
//
// They live where there are flowers through the year and somewhere to nest: meadows, scrub, old
// fields going back to the wild, forest edges and open woods; few in deep forest, none in town or on
// bare ground, and only a few on the farmland itself. They forage a few cells out from where they
// live. The towns' pesticides (civParams.pesticides) kill them on the fields and, drifting on the
// wind, around them. Many crops need them: a field's yield depends on how many pollinators reach
// it (from 70% with none to 100%), so a town that sprays heavily, or clears every hedge and meadow
// round its fields, harvests less, though spraying also saves some of the crop from pests.

import { boxBlur } from '../core/grid.js';
import { civParams } from './civilization.js';
import { seasonParams } from './climate.js';

/** How good cell i is for pollinators to live in (flowers and nest sites); fire-following flowers
 * (fireweed, fire poppies) on small burns are rich in nectar. */
function habitat(world, i) {
  const base = habitatBase(world, i);
  const ff = (world.fireweed ? world.fireweed[i] : 0) + (world.firePoppy ? world.firePoppy[i] : 0);
  return ff > 0.02 && base > 0 ? Math.min(1.3, base + 0.6 * Math.min(1, ff)) : base;
}

function habitatBase(world, i) {
  const v = world.vegetation[i], LU = world.landUse ? world.landUse[i] : 0;
  if (world.height[i] < (world.meanSea > -999 ? world.meanSea : -1e9) || world.water[i] > 0.2) return 0;
  if (LU === 2 || LU === 3 || LU === 4 || LU === 5 || LU === 6 || LU === 11 || LU === 12) return 0;
  if (LU === 1) return 0.15; // (the crop flowers for a while, but it's no home)
  if (LU === 10) return 0.1;
  if (world.snow && world.snow[i] > 0.6) return 0.05;
  // Meadows and scrub best; open woods and forest edges good; deep closed forest poor
  if (v < 0.15) return 0.05;
  if (v < 0.65) return 0.6 + 0.4 * Math.min(1, (v - 0.15) / 0.3) + (world.oldField && world.oldField[i] ? 0.2 : 0);
  const dens = world.treeDensity ? world.treeDensity[i] : 0.7;
  return 0.25 + 0.5 * (1 - dens);
}

/** Recompute where the pollinators are (every 30 frames). */
export function pollinatorStep(world) {
  const N = world.N, n = N * N;
  if (!world.pollinators || world.pollinators.length !== n) world.pollinators = new Float32Array(n);
  const P = world.pollinators, home = new Float32Array(n);
  for (let i = 0; i < n; i++) home[i] = habitat(world, i);
  // (forest edges: the mix of open and wooded ground within a few cells is richer than either)
  const reach = boxBlur(home, N, 3);
  // Pesticide on the fields, drifting a few cells round them
  const spray = civParams.pesticides ?? 0.5;
  let drift = null;
  if (spray > 0 && world.landUse) {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) if (world.landUse[i] === 1) f[i] = 1;
    drift = boxBlur(f, N, 3);
  }
  // Fewer in winter (they overwinter as eggs, larvae and dormant queens)
  const ph = seasonParams.enabled ? seasonParams.phase : 0.3;
  const season = seasonParams.enabled ? 0.35 + 0.65 * Math.max(0, Math.sin(Math.PI * Math.min(1, ph / 0.7))) : 1;
  for (let i = 0; i < n; i++) {
    const kill = drift ? Math.min(0.95, spray * (world.landUse[i] === 1 ? 0.9 : 0) + spray * 0.7 * drift[i]) : 0;
    const target = Math.min(1, reach[i] * 1.1) * (1 - kill) * season;
    P[i] += (target - P[i]) * 0.1;
  }
}

/** How well the crop at field cell i is pollinated (0.7 with none … 1), with the pesticide's help against pests (up to 10% more). */
export function cropFactor(world, i) {
  const p = world.pollinators ? world.pollinators[i] : 0.6;
  const spray = civParams.pesticides ?? 0.5;
  return (0.7 + 0.3 * Math.min(1, p * 2.5)) * (1 + 0.1 * spray);
}
