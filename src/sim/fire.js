// Wildfire.
//
// Lava is around 1000 °C, so any vegetation it touches catches fire. Fire then spreads from plant
// to plant: dense forest carries a fast, intense fire (lots of fuel, crowns touching), grassland a
// slower one, and bare ground stops it. Fire runs faster uphill (flames lean into the slope and
// pre-heat the fuel above) and is damped by wet ground, open water and rain. Burnt ground is left
// barren and ash-covered; plants return more slowly while the ash and charred soil recover.
//
// world.fire is the fire intensity per cell (0 = not burning); world.burnt (1 = freshly burnt)
// fades as the vegetation step regrows the land.

import { waterParams } from './water.js';
import { FOREST_TYPES, forestTypeAt } from './forests.js';
import { vegetationParams } from './vegetation.js';

export const fireParams = {
  enabled: true,
  spread: 1.6,      // chance per step to ignite a fully fuelled neighbour (× intensity × dt)
  burnRate: 0.4,    // fuel (plant cover) consumed per second at full intensity
  minFuel: 0.12,    // cover below this can't carry fire
};

/** How readily cover catches: forest (crowns touching) very readily, sparse grass barely. */
function flammability(v) {
  const t = Math.min(Math.max((v - 0.62) / 0.25, 0), 1);
  return t * t * (3 - 2 * t) + 0.015 * v;
}

const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
let ignite = null;

/** Advance fire one step. Returns true while anything is burning. */
export function fireStep(world, dt) {
  const N = world.N, n = N * N;
  const F = world.fire, V = world.vegetation, H = world.height, L = world.lava, T = world.lavaTemp;
  const B = world.burnt, D = world.water, W = world.nearWater;
  if (!ignite || ignite.length !== n) ignite = new Uint8Array(n);
  const p = fireParams;
  const raining = waterParams.rain > 0.01;
  const cells = world.fireCells;
  cells.length = 0;
  let any = false;

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const hotLava = L[i] > 0.02 && T[i] > 0.25;
      if (F[i] <= 0 && !hotLava) continue;
      any = true;

      if (F[i] > 0) {
        // Standing water puts fire out quickly, rain more slowly; otherwise intensity builds up to
        // what the fuel can sustain (a grass fire never gets as hot as a crown fire)
        if (D[i] > 0.05) F[i] -= dt * 6;
        else if (raining) F[i] -= dt * 1.2;
        else F[i] = Math.min(Math.min(1, 0.2 + V[i] * 1.2), F[i] + dt * 2);
        V[i] -= p.burnRate * dt * F[i];
        if (V[i] <= 0.03 || F[i] < 0.05) {
          V[i] = Math.max(0, V[i]);
          if (V[i] <= 0.03) { B[i] = 1; V[i] = 0; world.humus[i] *= 0.6; world.forestAge[i] = 0; } // litter and topsoil burn
          F[i] = 0;
          continue;
        }
        cells.push(i);
      }
      if (!p.enabled) continue;

      // Spread to (or, for lava, ignite) the 8 neighbours
      const heat = hotLava ? 1 : F[i];
      for (let k = 0; k < 8; k++) {
        const nx = x + NEIGHBORS[k][0], nz = z + NEIGHBORS[k][1];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (F[j] > 0 || ignite[j] || V[j] < p.minFuel || L[j] > 0.02) continue;
        // Forest type matters: resinous conifers and dry woodland burn readily, rainforest and swamp barely
        // Old-growth forest (thick bark, damp shaded floor) is harder to ignite than young stands
        const kind = V[j] > 0.62
          ? FOREST_TYPES[forestTypeAt(world, j, H[j], vegetationParams.treeLine)].flammability * (1 - 0.35 * world.forestAge[j])
          : 1;
        const fuel = flammability(V[j]) * kind;
        const damp = (1 - 0.7 * (W ? W[j] : 0)) * (D[j] > 0.05 ? 0.1 : 1) * (raining ? 0.3 : 1);
        const uphill = 1 + Math.min(2, Math.max(0, H[j] - H[i]) * 1.5);
        const diag = k < 4 ? 1 : 0.7;
        const chance = hotLava ? 0.5 * fuel : p.spread * dt * heat * fuel * damp * uphill * diag;
        if (Math.random() < chance) ignite[j] = 1;
      }
    }
  }
  if (!any) return false;


  for (let i = 0; i < n; i++) {
    if (!ignite[i]) continue;
    ignite[i] = 0;
    F[i] = 0.3;
  }
  world.dirty = true;
  return true;
}
