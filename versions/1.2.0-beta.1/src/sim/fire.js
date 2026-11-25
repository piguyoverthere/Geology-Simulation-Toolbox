// Wildfire.
//
// Lava is around 1000 °C, so any vegetation it touches catches fire. Fire then spreads from plant
// to plant: dense forest carries a fast, intense fire (lots of fuel, crowns touching), grassland a
// slower one, and bare ground stops it. Fire runs faster uphill (flames lean into the slope and
// pre-heat the fuel above) and is damped by wet ground, open water and rain (the global rain or a
// storm passing overhead). Snow puts it out completely: a burning spot that gets snowed on goes
// out, and fire can't spread onto snowy ground. Fire in dry country is much harder to put out: parched soil and dry
// litter keep smouldering and flare up again, and resinous pine burns hot and long. So rain and
// water quench a fire in a damp broadleaf forest quickly, but barely slow one in a dry pine wood. Burnt ground is left
// barren and ash-covered; plants return more slowly while the ash and charred soil recover.
//
// world.fire is the fire intensity per cell (0 = not burning); world.burnt (1 = freshly burnt)
// fades as the vegetation step regrows the land.
//
// Fuel (world.fuel, 0…1): dead wood, litter and undergrowth on the forest floor build up year by
// year where nothing burns. A fire through light fuel is a surface fire: it clears the undergrowth
// but the trees live through it, and the forest keeps its age. Through heavy fuel it climbs into the
// crowns: it spreads faster, throws embers further ahead, and kills the whole stand. So forests that
// burn a little every few years stay safe, and forests where every fire is put out build up fuel
// until one turns into a megafire. Towns fight the fires near them (civParams.fireSuppression) and
// can burn off the fuel in their parks and the forest around them in the cool, damp season
// (prescribed burns, civParams.prescribedBurns).

import { waterParams } from './water.js';
import { drySeason, climateParams } from './climate.js';
import { FOREST_TYPES, forestTypeAt } from './forests.js';

export const fireParams = {
  enabled: true,
  spread: 1.6,      // chance per step to ignite a fully fuelled neighbour (× intensity × dt)
  burnRate: 0.4,    // fuel (plant cover) consumed per second at full intensity
  minFuel: 0.12,    // cover below this can't carry fire
  resiliency: 0,
  mergeGap: 4,      // fires burning at the same time this close (cells) count as one (Fire history)    // how much a big fire shrugs off rain (0 = rain puts any fire out as well; 1+ = big fires burn on through it)
};

/**
 * How readily cover catches: forest (crowns touching) very readily; grassland and shrubland
 * (dry grass, sagebrush) carry a slower, creeping fire; bare ground barely at all.
 */
function flammability(v) {
  const t = Math.min(Math.max((v - 0.62) / 0.25, 0), 1);
  const g = Math.min(Math.max((v - 0.15) / 0.3, 0), 1);
  return t * t * (3 - 2 * t) + 0.035 * g * g * (3 - 2 * g);
}

const SNOWED = 0.02; // any lying snow (depth) puts fire out and stops it spreading

const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
let ignite = null;

/** Advance fire one step. Returns true while anything is burning. */
export function fireStep(world, dt) {
  const N = world.N, n = N * N;
  const F = world.fire, V = world.vegetation, H = world.height, L = world.lava, T = world.lavaTemp;
  const B = world.burnt, D = world.water, W = world.nearWater;
  if (!ignite || ignite.length !== n) ignite = new Uint8Array(n);
  const p = fireParams;
  const globalRain = waterParams.rain > 0.01;
  const LW = world.lastWet, now = world.time, SO = world.soil, PS = world.pineShare;
  // How hard a fire here is to put out: dry soil and pine make it stubborn (1 ≈ ordinary)
  // A dry summer (with Seasons on and Dry summers set) makes the whole landscape tinder
  const drought = drySeason();
  const SN = world.snow;
  const wind = (climateParams.windAngle * Math.PI) / 180;
  const resist = (i) => (0.6 + 1.6 * (1 - (SO ? SO[i] : 0.5))) * (1 + 1.5 * (PS ? PS[i] : 0)) * (1 + 3 * drought);
  const rainingAt = (i) => globalRain || now - LW[i] < 0.5;
  const cells = world.fireCells;
  const FU = world.fuel, GD = world.fireGuard;
  // Fire resiliency: once a fire is big (hundreds of cells burning, as of the last step), its heat
  // and the updraft over it dry the air and drive the rain off, so rain puts it out far more slowly.
  // (Standing water and snow still put it out.)
  const bigFire = 1 + p.resiliency * 4 * Math.min(1, Math.max(0, (cells.length - 80) / 400));
  cells.length = 0;
  let any = false;

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const hotLava = L[i] > 0.02 && T[i] > 0.25;
      if (F[i] <= 0 && !hotLava) continue;
      any = true;

      // Snow smothers fire completely
      if (F[i] > 0 && SN && SN[i] > SNOWED) { F[i] = 0; continue; }
      if (F[i] > 0) {
        // Standing water puts fire out quickly, rain more slowly; otherwise intensity builds up to
        // what the fuel can sustain (a grass fire never gets as hot as a crown fire)
        if (D[i] > 0.05) F[i] -= (dt * 6) / resist(i);
        else if (rainingAt(i)) F[i] -= (dt * 1.2) / (resist(i) * bigFire); // (a big fire makes its own weather: rain hardly reaches it)
        else F[i] = Math.min(Math.min(1, 0.2 + V[i] * 1.2), F[i] + dt * 2);
        // Firefighters: near a town (world.fireGuard) small fires are put out (a big one overwhelms them)
        if (GD && GD[i] > 0) F[i] -= dt * 5 * GD[i] * (cells.length > 300 ? 0.2 : 1);
        // A surface fire (light fuel): the undergrowth burns, the trees live and the stand keeps its
        // age; it dies down once the fuel is gone
        if (FU && FU[i] < 0.35 && V[i] > 0.5) {
          FU[i] = Math.max(0, FU[i] - dt * 0.8 * F[i]);
          V[i] = Math.max(Math.min(V[i], 0.68), V[i] - p.burnRate * dt * F[i] * 0.1); // (the canopy stays: still forest)
          F[i] = Math.min(F[i], 0.35);
          if (FU[i] <= 0.02) F[i] -= dt * 2;
          if (F[i] < 0.05) { F[i] = 0; continue; }
          cells.push(i);
        } else {
        if (FU) FU[i] = Math.max(0, FU[i] - dt * 0.5 * F[i]);
        V[i] -= p.burnRate * dt * F[i];
        if (V[i] <= 0.03 || F[i] < 0.05) {
          V[i] = Math.max(0, V[i]);
          if (V[i] <= 0.03) { B[i] = 1; V[i] = 0; world.humus[i] *= 0.6; world.forestAge[i] = 0; } // litter and topsoil burn
          F[i] = 0;
          continue;
        }
        cells.push(i);
        }
      }
      if (!p.enabled) continue;

      // Spread to (or, for lava, ignite) the 8 neighbours
      const heat = hotLava ? 1 : F[i];
      for (let k = 0; k < 8; k++) {
        const nx = x + NEIGHBORS[k][0], nz = z + NEIGHBORS[k][1];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (F[j] > 0 || ignite[j] || V[j] < p.minFuel || L[j] > 0.02 || (SN && SN[j] > SNOWED)) continue;
        // Forest type matters: resinous conifers and dry woodland burn readily, rainforest and swamp barely
        // Old-growth forest (thick bark, damp shaded floor) is harder to ignite than young stands
        const kind = V[j] > 0.62
          ? (world.forestFlam ? world.forestFlam[j] : FOREST_TYPES[forestTypeAt(world, j)].flammability) * (1 - 0.35 * world.forestAge[j])
          : 1;
        // Grass and shrubs only burn well when they've dried out (cured grass in a dry summer)
        const grassy = V[j] <= 0.62 ? 0.3 + 0.8 * (1 - (SO ? SO[j] : 0.5)) + 4 * drought : 1;
        // (standing dead wood from a bark beetle outbreak burns fiercely)
        // (and the fuel on the forest floor: a heavy load carries a fire into the crowns, fast)
        const fuel = flammability(V[j]) * kind * grassy * (1 + 2.5 * (world.deadWood ? world.deadWood[j] : 0)) * (FU && V[j] > 0.5 ? 0.35 + 1.3 * FU[j] : 1);
        const rj = resist(j);
        const damp = (1 - 0.7 * (W ? W[j] : 0)) * (D[j] > 0.05 ? Math.min(1, 0.1 * rj) : 1)
          * (rainingAt(j) ? Math.min(1, 0.3 * rj) : 1) * (0.7 + 0.6 * (1 - (SO ? SO[j] : 0.5)));
        const uphill = 1 + Math.min(2, Math.max(0, H[j] - H[i]) * 1.5);
        const diag = k < 4 ? 1 : 0.7;
        // Late-summer fire season: bone-dry fuels let fire run several times faster
        const chance = hotLava ? 0.5 * fuel : p.spread * dt * heat * fuel * damp * uphill * diag * (1 + 4 * drought);
        if (Math.random() < chance) ignite[j] = 1;
      }
      // Spotting: in the fire season, burning embers blow downwind and start new fires ahead of the
      // front (often hundreds of metres), so big fires leap roads, rivers and firebreaks
      const crown = FU ? FU[i] : 0.5;
      if (!hotLava && drought > 0.2 && F[i] > 0.4 && Math.random() < 0.6 * drought * F[i] * dt * (0.4 + 1.6 * crown)) {
        const dist = 2 + Math.random() * (3 + 6 * drought) * (0.6 + crown);
        const a = wind + (Math.random() - 0.5) * 0.9;
        const sx = Math.round(x + Math.cos(a) * dist), sz = Math.round(z + Math.sin(a) * dist);
        if (sx >= 0 && sz >= 0 && sx < N && sz < N) {
          const j = sz * N + sx;
          if (F[j] <= 0 && V[j] >= p.minFuel && D[j] <= 0.05 && L[j] <= 0.02 && !(SN && SN[j] > SNOWED)) ignite[j] = 1;
        }
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

/**
 * Fuel on the forest floor (every 30 frames): builds up where nothing burns (faster under dense,
 * old forest and where trees have died), is gone where fire has passed, and is burnt off by the
 * towns' prescribed burns. Also lays out where the towns fight fires (world.fireGuard).
 */
export function fuelStep(world, towns, opts) {
  const N = world.N, n = N * N, V = world.vegetation, A = world.forestAge;
  if (!world.fuel || world.fuel.length !== n) {
    // (a map that never had fuel: what its forests would have built up)
    world.fuel = new Float32Array(n);
    for (let i = 0; i < n; i++) world.fuel[i] = V[i] > 0.5 ? 0.2 + 0.35 * A[i] : 0.05;
  }
  const FU = world.fuel, B = world.burnt, DW = world.deadWood;
  for (let i = 0; i < n; i++) {
    if (B && B[i] > 0.5) { FU[i] = 0; continue; }
    const grow = V[i] > 0.5 ? 0.0005 * (0.6 + 0.6 * A[i]) + (DW ? 0.002 * DW[i] : 0) : V[i] > 0.2 ? 0.0002 : -0.002;
    FU[i] = Math.max(0, Math.min(1, FU[i] + grow * (1 - FU[i])));
  }
  // Where the towns fight fires: around each town, as hard as the Fire suppression setting says
  if (!world.fireGuard || world.fireGuard.length !== n) world.fireGuard = new Float32Array(n);
  const GD = world.fireGuard;
  GD.fill(0);
  const sup = opts.suppression;
  if (sup > 0) for (const t of towns || []) {
    const r = Math.round(15 + Math.sqrt(t.pop) / 2);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > r) continue;
      const x = t.x + dx, z = t.z + dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const i = z * N + x;
      GD[i] = Math.max(GD[i], sup * (1 - 0.6 * (d / r)));
    }
  }
  // Prescribed burns: in the cool, damp part of the year a town burns off heavy fuel in its parks
  // and the forest around it (a patch at a time), so the next wildfire there stays on the ground
  world.prescribed = world.prescribed || 0;
  if (opts.prescribed && !opts.fireSeason) for (const t of towns || []) {
    if (t.pop < 200 || Math.random() > 0.08) continue;
    const r = 15 + Math.sqrt(t.pop) / 2;
    let best = -1, bf = 0.45;
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * r;
      const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
      if (x < 4 || z < 4 || x >= N - 4 || z >= N - 4) continue;
      const i = z * N + x;
      if (V[i] > 0.5 && FU[i] > bf && !(world.landUse && world.landUse[i])) { bf = FU[i]; best = i; }
    }
    if (best < 0) continue;
    const bx = best % N, bz = (best / N) | 0;
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dz * dz > 16) continue;
      const i = (bz + dz) * N + bx + dx;
      if (V[i] > 0.2) FU[i] = Math.min(FU[i], 0.08);
    }
    world.prescribed++;
  }
}
