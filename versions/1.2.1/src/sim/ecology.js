// Wildlife: animals you design yourself, living on the land and in the sea.
//
// Each animal (world.animals: name, colour, where it lives, what it eats, how it behaves) has a
// density field, world['animal_' + id] (0 = none … ~1 = as many as the place can hold), that grows,
// declines and moves every few frames. What links them into an ecosystem:
//
//   • Food: an animal can live only where there is something it eats: grass and meadow plants,
//     shrubs and young trees, deciduous trees, conifers, plankton, seaweed (kelp and seagrass), or
//     other animals. Plant-eaters crop what they eat (grazers hold meadows open and stop forest
//     regrowing; plankton-eaters keep blooms down; seaweed-eaters can strip kelp into barrens);
//     predators thin out their prey, and starve without it.
//   • Habitat: land, forest, meadows, mountains, streams, the sea or the coastal shallows.
//   • Habits: avoiding deep snow (some die in hard winters), harm from pollution, being killed by
//     hard frost, building dams (ponds behind them), killing the trees it eats (leaving dead wood
//     that burns fiercely), fertilising the ground, and swimming up the rivers each autumn (a run
//     like salmon, fertilising the stream banks).
//   Every sea animal suffocates in low-oxygen water.

import { boxBlur } from '../core/grid.js';
import { seasonParams, seasonalAt } from './climate.js';
import { advect } from './ocean.js';

export const ecoParams = {
  enabled: true,
  speed: 1,      // how fast populations grow, decline and move
  abundance: 1,  // how much food the land and sea offer (× what each place supports)
  predation: 1,  // how hard predators hit their prey
  roaming: 1,    // how far animals range and how fast they spread
  winters: 1,    // how hard winters, cold, heat and deep snow are on them
  roadkill: true,        // traffic kills animals crossing roads (and they shun busy roads)
  disease: false,        // crowded populations suffer outbreaks of disease
  fireFollowers: true,   // fireweed, fire poppies and the like on recent small burns
  smallBurn: 400,        // largest burn (cells) fire followers fully take to
};

export const HABITATS = {
  land: 'Anywhere on land',
  forest: 'Forest',
  meadow: 'Meadows and open land',
  mountains: 'Mountains (cold, high ground)',
  stream: 'Streams and ponds',
  sea: 'The sea',
  coast: 'Coastal shallows',
  burn: 'Recent small burns (fire followers)',
};
export const PLANT_FOODS = {
  grass: 'Grass and meadow plants',
  young: 'Shrubs and young trees',
  decid: 'Deciduous trees (willow, aspen, oak…)',
  conifer: 'Conifers',
  plankton: 'Plankton',
  seaweed: 'Seaweed (kelp, seagrass)',
  fireflowers: 'Fire-following flowers (fireweed, fire poppies)',
  charred: 'Burnt and dead trees (like wood-boring beetles)',
};
export const HABITS = {
  avoidsSnow: ['Avoids deep snow', 'Leaves deep snow in winter, and some die in hard winters.'],
  pollution: ['Harmed by pollution', 'Dies off where the water is polluted.'],
  frostKills: ['Killed by hard frost', 'A winter freeze below about −12 °C kills most of them (like bark beetles).'],
  dams: ['Builds dams', 'Dams the streams it lives on, slowly raising ponds and wetland behind (and fells nearby deciduous trees).'],
  killsTrees: ['Kills the trees it eats', 'Kills whole stands of the trees it eats (like bark beetles), leaving grey dead wood that burns fiercely.'],
  fertilises: ['Fertilises the ground', 'Its droppings enrich the soil where it lives: plants grow faster.'],
  runsRivers: ['Swims up rivers in autumn', 'Lives at sea, then each autumn runs up the rivers to spawn in cool, clean water (like salmon), fertilising the stream banks. Next year\'s run depends on how many made it.'],
};

export const MIGRATION = {
  none: 'Stays put',
  ns: 'North in summer, south in winter',
  ew: 'East in summer, west in winter',
  nomad: 'Wanders the whole map following food',
};

/** Make a new animal definition. */
export function newAnimal(opts = {}) {
  return {
    id: 'a' + Math.random().toString(36).slice(2, 8),
    name: opts.name || 'New animal',
    color: opts.color || [0.6, 0.45, 0.3],
    habitat: opts.habitat || 'land',
    eats: { ...(opts.eats || {}) },
    prey: [...(opts.prey || [])],
    breed: opts.breed ?? 1,
    roam: opts.roam ?? 3,
    habits: { ...(opts.habits || {}) },
    migrates: opts.migrates || 'none',
    tempMin: opts.tempMin ?? -10,   // °C: the range it's comfortable in (air on land, water at sea)
    tempMax: opts.tempMax ?? 30,
    stock: 1, // (runs up rivers: this year's run strength)
  };
}

export function animalField(world, a) {
  const n = world.N * world.N, k = 'animal_' + a.id;
  if (!world[k] || world[k].length !== n) world[k] = new Float32Array(n);
  return world[k];
}

/** How hungry the animal is at each cell: 0 well fed … 1 starving. */
export function hungerField(world, a) {
  const n = world.N * world.N, k = 'hunger_' + a.id;
  if (!world[k] || world[k].length !== n) world[k] = new Float32Array(n);
  return world[k];
}

export function removeAnimal(world, id) {
  world.animals = (world.animals || []).filter((a) => a.id !== id);
  for (const a of world.animals) a.prey = a.prey.filter((p) => p !== id);
  delete world['animal_' + id];
  delete world['hunger_' + id];
  world.dirty = true;
}

export function ensureEcology(world) {
  const n = world.N * world.N;
  if (!world.animals) world.animals = [];
  for (const k of ['dam', 'deadWood', 'browse', 'salmonN', 'treeKill', 'runners']) {
    if (!world[k] || world[k].length !== n) world[k] = new Float32Array(n);
  }
  for (const a of world.animals) animalField(world, a);
}

function seaLevel(world) { return world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9; }

let masks = null;

/** How well cell i suits an animal of this habitat (0..1). */
function habitatAt(world, a, i, M, sea) {
  // (a timber plantation is a monoculture of even-aged trees, felled and replanted: no understory,
  // no old or dead trees, no food: nothing lives there)
  if (world.landUse && world.landUse[i] === 10 && a.habitat !== 'sea' && a.habitat !== 'coast') return 0;
  // (an invaded forest supports only as much life as its native trees: the exotic pine feeds and
  // shelters nothing)
  const inv = world.invasive && a.habitat !== 'sea' && a.habitat !== 'coast' ? world.invasive[i] : 0;
  if (inv >= 0.95) return 0;
  return habitatBase(world, a, i, M, sea) * (1 - inv);
}

function habitatBase(world, a, i, M, sea) {
  const H = world.height, V = world.vegetation;
  switch (a.habitat) {
    case 'sea': return M.seaM[i];
    case 'coast': return M.seaM[i] && sea - H[i] < 12 ? 1 : 0;
    case 'stream': return M.stream[i] || world.dam[i] > 0.05 ? 1 : 0;
    case 'forest': return M.land[i] ? (V[i] > 0.6 ? 1 : V[i] * 0.5) : 0;
    case 'meadow': return M.land[i] ? (V[i] > 0.05 && V[i] < 0.7 ? 1 : 0.25) : 0;
    // (fire followers: recent small burns, and a few hang on in the forest between fires)
    case 'burn': return M.land[i] ? Math.max(world.burnSuit ? world.burnSuit[i] : 0, V[i] > 0.6 ? 0.1 : 0.03) : 0;
    case 'mountains': return M.land[i] ? (world.temperature[i] < 6 ? 1 : 0.15) : 0;
    default: return M.land[i];
  }
}

/** What there is to eat at cell i for animal a (plants only; prey is added separately). */
function plantFood(world, a, i, M) {
  const e = a.eats, v = world.vegetation[i];
  let f = 0;
  if (M.land[i] || M.stream[i]) {
    if (e.grass) f += v < 0.75 ? Math.min(1, v * 1.8) : 0.25;
    if (e.young) f += v * (1 - world.forestAge[i]);
    if (e.decid) f += (world.decid ? world.decid[i] : 0) * v * 1.4;
    if (e.conifer) f += (world.conifer ? world.conifer[i] : 0) * v * 1.4;
    if (e.fireflowers) f += 1.3 * Math.min(1, (world.fireweed ? world.fireweed[i] : 0) + (world.firePoppy ? world.firePoppy[i] : 0)) + 0.04 * v;
    if (e.charred) f += 1.2 * (world.burnSuit ? world.burnSuit[i] : 0) * (world.burnt[i] > 0.05 || world.forestAge[i] > 0.2 ? 1 : 0.5) + (world.deadWood ? world.deadWood[i] : 0) + 0.03 * v;
    const snow = world.snow ? world.snow[i] : 0;
    if (snow > 0) f *= Math.max(0.05, 1 - snow * 0.8);
  }
  if (M.seaM[i]) {
    if (e.plankton) f += Math.min(1, (world.plankton ? world.plankton[i] : 0.2) * 1.2 + 0.1);
    if (e.seaweed) {
      const m = world.marine ? world.marine[i] : -1;
      if (m === 1 || m === 2) f += world.marineHealth ? world.marineHealth[i] : 1; // kelp, seagrass
    }
  }
  return f;
}

/**
 * One wildlife step, in three parts run on successive calls (to spread the work over frames): each
 * part handles a third of the animals (part 0 also refreshes the habitat masks and shared effects).
 */
export function ecologyStep(world, part = -1) {
  if (!ecoParams.enabled) return;
  ensureEcology(world);
  if (part < 0) { for (let p = 0; p < 3; p++) ecologyPart(world, p, 1); return; }
  ecologyPart(world, part, 2);
}

function ecologyPart(world, part, mult) {
  const N = world.N, n = N * N, H = world.height, D = world.water;
  const sea = seaLevel(world);
  if (part === 0 || !masks || masks.n !== n) {
    if (!masks || masks.n !== n) masks = { n, land: new Float32Array(n), seaM: new Float32Array(n), stream: new Float32Array(n) };
    const VX = world.velX, VZ = world.velZ;
    for (let i = 0; i < n; i++) {
      const wet = H[i] < sea;
      masks.seaM[i] = wet ? 1 : 0;
      masks.land[i] = !wet && D[i] < 0.3 ? 1 : 0;
      masks.stream[i] = !wet && D[i] > 0.04 && D[i] < 2 && VX[i] * VX[i] + VZ[i] * VZ[i] > 0.0025 ? 1 : 0;
    }
    // Shared effects, rebuilt each round from the animals' contributions; old ones fade
    world.browse.fill(0);
    world.runners.fill(0);
    const TK = world.treeKill, SN = world.salmonN, DW = world.deadWood;
    for (let i = 0; i < n; i++) {
      if (TK[i] > 0) TK[i] *= 0.9;
      if (SN[i] > 0) SN[i] = Math.max(0, SN[i] - 0.0015 * mult);
      if (DW[i] > 0 && world.fire[i] > 0) DW[i] = 0; // (burnt up; otherwise it rots: see vegetation.js)
    }
  }
  world.animals.forEach((a, idx) => { if (idx % 3 === part) stepAnimal(world, a, masks, sea, ecoParams.speed * mult); });
  // Population history (for the graphs): every other round, each animal's total
  if (part === 0) {
    world.popRound = (world.popRound || 0) + 1;
    if (world.popRound % 2 === 0) recordPopulations(world);
  }
  world.dirty = true;
}

function stepAnimal(world, a, M, sea, k) {
  const N = world.N, n = N * N, H = world.height, V = world.vegetation, P = animalField(world, a);
  const hb = a.habits, st = world.seasonT || 0;
  const ph = seasonParams.enabled ? seasonParams.phase : 0.3;
  // Prey: what it can catch around it (it roams for its food)
  let prey = null;
  if (a.prey.length) {
    const sum = new Float32Array(n);
    for (const pid of a.prey) { const q = world['animal_' + pid]; if (q) for (let i = 0; i < n; i++) sum[i] += q[i]; }
    prey = boxBlur(sum, N, Math.max(1, a.roam));
  }
  // Its predators, which thin it out
  let hunted = null;
  for (const b of world.animals) {
    if (!b.prey.includes(a.id)) continue;
    const q = world['animal_' + b.id];
    if (!q) continue;
    if (!hunted) hunted = new Float32Array(n);
    for (let i = 0; i < n; i++) hunted[i] += q[i];
  }
  const runSeason = hb.runsRivers && ph > 0.47 && ph < 0.72;
  const K = new Float32Array(n), allow = new Float32Array(n);
  const HU = hungerField(world, a);
  let fed = 0, starving = 0;
  const PO = world.pollution, OX = world.oxygen, SNW = world.snow;
  const grazer = a.eats.grass || a.eats.young || a.eats.decid || a.eats.conifer;
  const r = 0.03 * a.breed * k;
  const wint = ecoParams.winters ?? 1;
  // Disease (a setting): crowded populations now and then suffer an outbreak, which runs for a
  // while and hits hardest where they're packed in
  if (ecoParams.disease) {
    if (a.outbreak > 0) a.outbreak--;
    else if (a.crowded > 0.25 && Math.random() < 0.03 * a.crowded * k) a.outbreak = 30 + Math.floor(Math.random() * 30);
  } else a.outbreak = 0;
  const sick = a.outbreak > 0;
  let crowd = 0, occupied = 0;
  // Temperature: comfortable inside its range (fading out over ~5 °C beyond it)
  const tLo = a.tempMin ?? -10, tHi = a.tempMax ?? 30;
  const tempFit = (i) => {
    const t = M.seaM[i] && world.seaT && !Number.isNaN(world.seaT[i]) ? world.seaT[i] : world.temperature[i] + seasonalAt(world, i, st);
    return t < tLo ? Math.max(0, 1 - (tLo - t) / 5) : t > tHi ? Math.max(0, 1 - (t - tHi) / 5) : 1;
  };
  for (let i = 0; i < n; i++) {
    let h = habitatAt(world, a, i, M, sea);
    if (runSeason && M.stream[i]) h = Math.max(h, 0.8); // (up the rivers in the autumn run)
    allow[i] = h > 0 ? 1 : 0;
    if (h <= 0) { P[i] = 0; continue; }
    const food = Math.min(1.2, plantFood(world, a, i, M) + (prey ? prey[i] * 1.5 : 0));
    // Too hot or too cold: the place supports fewer of them, and they breed slower there
    const fit = tempFit(i);
    K[i] = food * h * (0.1 + 0.9 * fit) * (ecoParams.abundance ?? 1);
    let p = P[i];
    if (p <= 0) { HU[i] = 0; continue; }
    // Hunger: builds where there's less food than the animals here need, eases where there's
    // plenty. Hungry animals stop breeding; starving ones die off fast (and wander off for food)
    const ratio = K[i] / p;
    HU[i] += (Math.max(0, Math.min(1, 1 - ratio)) - HU[i]) * Math.min(1, 0.15 * k);
    const hu = HU[i];
    let dp = r * p * (1 - p / Math.max(0.02, K[i]));
    if (dp > 0) dp *= (1 - hu) * fit;
    if (fit < 0.5) dp -= 0.05 * k * (0.5 - fit) * p * wint; // (exposure: heat or cold stress)
    dp -= 0.12 * k * hu * hu * p; // (starving)
    if (hunted) dp -= 0.25 * k * hunted[i] * p * (ecoParams.predation ?? 1);
    if (hb.avoidsSnow && SNW && SNW[i] > 1.2) dp -= 0.02 * k * p * wint;
    if (sick && p > 0.35) dp -= 0.12 * k * p * (p - 0.2); // (an outbreak: worst where they're crowded)
    if (hb.pollution && ((PO && PO[i] > 0.4) || (world.riverPollution && world.riverPollution[i] > 0.3))) dp -= 0.1 * k * p;
    if (M.seaM[i] && OX && OX[i] < 0.35) dp -= 0.15 * k * p; // (suffocating)
    p = Math.max(0, Math.min(1.5, p + dp));
    if (hb.frostKills && world.temperature[i] + seasonalAt(world, i, st) < -12 * Math.min(2, 1 / Math.max(0.3, wint))) p *= 0.6;
    if (p < 0.002) { P[i] = 0; HU[i] = 0; continue; }
    P[i] = p;
    fed += p; starving += p * (hu > 0.4 ? 1 : 0);
    if (p > 0.05) { occupied++; if (p > 0.55 && p > 0.85 * K[i]) crowd++; }
    // --- What it does to the place ---
    // (where their predators are about, grazers keep moving and browse less: the young trees there
    // get a chance to grow, the landscape of fear behind a trophic cascade)
    if (grazer && M.land[i]) world.browse[i] = Math.min(1, world.browse[i] + p * (a.eats.grass || a.eats.young ? 1 : 0.5) * (hunted ? 1 - 0.65 * Math.min(1, hunted[i] * 2.5) : 1));
    if (a.eats.plankton && world.plankton && M.seaM[i]) world.plankton[i] = Math.max(0, world.plankton[i] - 0.02 * p * k);
    if (a.eats.seaweed && world.marineHealth && M.seaM[i]) {
      const m = world.marine ? world.marine[i] : -1;
      if (m === 1 || m === 2) world.marineHealth[i] = Math.max(0, world.marineHealth[i] - 0.012 * k * Math.max(0, p - 0.3));
    }
    if (hb.killsTrees && p > 0.3 && M.land[i]) {
      const share = (a.eats.conifer && world.conifer ? world.conifer[i] : 0) + (a.eats.decid && world.decid ? world.decid[i] : 0) || (a.eats.young ? 0.5 : 0);
      const kill = 0.006 * p * k * V[i] * Math.min(1, share);
      if (kill > 0) {
        V[i] -= kill; world.forestAge[i] = Math.max(0, world.forestAge[i] - kill * 2);
        world.deadWood[i] = Math.min(1, world.deadWood[i] + kill * 2);
        world.treeKill[i] = Math.min(1, world.treeKill[i] + kill * 20);
      }
    }
    if (hb.dams && p > 0.4) {
      if ((M.stream[i] || world.dam[i] > 0.05) && world.dam[i] < 1.4) {
        const gx = (H[Math.min(n - 1, i + 1)] - H[Math.max(0, i - 1)]) * 0.5, gz = (H[Math.min(n - 1, i + N)] - H[Math.max(0, i - N)]) * 0.5;
        if (gx * gx + gz * gz < 0.36) { const inc = 0.004 * p * k; H[i] += inc; world.dam[i] += inc; }
      }
      if (world.decid && world.decid[i] > 0.2) V[i] = Math.max(0, V[i] - 0.001 * p * k); // (fells the trees)
    }
    if (hb.fertilises && M.land[i]) {
      world.humus[i] = Math.min(1, world.humus[i] + 0.0015 * p * k);
      world.salmonN[i] = Math.min(1, world.salmonN[i] + 0.004 * p * k);
    }
    if (runSeason && M.stream[i]) world.runners[i] += p;
  }
  a.starving = fed > 0.5 ? starving / fed : 0; // (share of them starving, for the panel)
  a.crowded = occupied > 20 ? crowd / occupied : 0;
  // Fire followers: drawn from far off to a fresh small burn (beetles home in on the smoke)
  if (a.habitat === 'burn' && world.burnSuit) {
    const BSU = world.burnSuit;
    for (let i = 0; i < n; i++) if (BSU[i] > 0.3 && allow[i] && P[i] < 0.05 * K[i] + 0.02) P[i] += 0.003 * k * BSU[i];
  }
  // Abandoned dams wash out
  if (hb.dams) for (let i = 0; i < n; i++) if (world.dam[i] > 0 && P[i] < 0.05) { const d = Math.min(world.dam[i], 0.002 * k); H[i] -= d; world.dam[i] -= d; }
  // (land animals shun the noisy band either side of a busy road, except at a wildlife crossing: a
  // band they won't settle in, which few get across)
  if (ecoParams.roadkill !== false && ['land', 'forest', 'meadow', 'mountains', 'burn'].includes(a.habitat)) {
    const band = roadBand(world);
    if (band) for (let i = 0; i < n; i++) if (band[i] > 0.01) K[i] *= 1 - 0.97 * Math.min(1, band[i] * 4.5);
  }
  // --- Moving about: toward better feeding, over its roaming range ---
  if (runSeason) riverRun(world, a, P, M);
  else {
    migrate(world, a, P, K, allow, k);
    // (on the trek they keep moving rather than settling on the nearest good grazing)
    const trekking = (a.migrates === 'ns' || a.migrates === 'ew') && seasonParams.enabled ? 0.3 : 1;
    const tmp = new Float32Array(n);
    for (let i = 0; i < n; i++) tmp[i] = P[i] * allow[i];
    const rr = Math.max(1, Math.round(a.roam * (ecoParams.roaming ?? 1))), b = boxBlur(tmp, N, rr), kb = boxBlur(K, N, rr);
    for (let i = 0; i < n; i++) {
      if (!allow[i]) { P[i] = 0; continue; }
      const target = kb[i] > 1e-3 ? (b[i] * K[i]) / kb[i] : 0;
      // (hungry animals move on, looking for food)
      P[i] += (target - P[i]) * Math.min(0.9, 0.2 * k * (1 + 2 * HU[i]) * trekking);
    }
  }
  // Roads: land animals crossing a road are killed by the traffic (more on a busier road), so a busy
  // road splits their range: few get across, and a population cut off on one side can dwindle.
  // At a wildlife crossing (an over- or underpass, world.crossing) they cross safely.
  if (ecoParams.roadkill !== false && ['land', 'forest', 'meadow', 'mountains', 'burn'].includes(a.habitat) && world.landUse && world.roadTraffic) {
    const LU = world.landUse, TR = world.roadTraffic, CX = world.crossing;
    for (let i = 0; i < n; i++) {
      if (LU[i] !== 3 || P[i] <= 0 || (CX && CX[i])) continue;
      P[i] *= 1 - Math.min(0.6, 0.04 + TR[i] / 3000) * Math.min(1, k);
    }
  }
  // End of the run: those in the rivers spawn and die, fertilising the banks
  if (hb.runsRivers) {
    if (ph >= 0.72 && !a.spawned) {
      let spawned = 0;
      const inRiver = new Float32Array(n);
      for (let i = 0; i < n; i++) if (M.stream[i]) { inRiver[i] = P[i]; spawned += P[i]; P[i] = 0; }
      const carcass = boxBlur(inRiver, N, 3);
      for (let i = 0; i < n; i++) if (carcass[i] > 0.01 && !M.seaM[i]) {
        world.humus[i] = Math.min(1, world.humus[i] + 0.15 * carcass[i]);
        world.salmonN[i] = Math.min(1, world.salmonN[i] + 4 * carcass[i]);
      }
      const expected = Math.max(1, (a.mouths || 1) * 4 * a.stock);
      a.stock = Math.max(0.05, Math.min(2, 0.5 * a.stock + a.stock * Math.min(1.5, spawned / expected) * 0.9));
      a.mouths = 0;
      a.spawned = true;
    }
    if (ph < 0.47) a.spawned = false;
  }
}

/**
 * Migration. Seasonal migrants trek across the map to the far side each season (summer range one
 * way, winter range the other), over ground they can live on (land animals can't cross the sea),
 * slowing as they arrive. Nomads drift across the whole map toward wherever the food is best.
 */
function migrate(world, a, P, K, allow, k) {
  const N = world.N, n = N * N, mode = a.migrates || 'none';
  if (mode === 'none') return;
  if (mode === 'nomad') {
    // Follow the food over the whole map (a very wide view of where it's good)
    const tmp = new Float32Array(n);
    for (let i = 0; i < n; i++) tmp[i] = P[i] * allow[i];
    const r = Math.max(4, Math.round(N / 10));
    const b = boxBlur(tmp, N, r), kb = boxBlur(K, N, r);
    for (let i = 0; i < n; i++) {
      if (!allow[i]) continue;
      const target = kb[i] > 1e-3 ? (b[i] * K[i]) / kb[i] : 0;
      P[i] += (target - P[i]) * 0.08 * k;
    }
    return;
  }
  if (!seasonParams.enabled) return; // (no seasons, no seasonal migration)
  const ph = seasonParams.phase;
  const summer = ph > 0.05 && ph < 0.55; // (spring and summer: April to September)
  // Direction: toward the summer side or the winter side (north = the top of the map, z = 0)
  const dx = mode === 'ew' ? (summer ? 1 : -1) : 0, dz = mode === 'ns' ? (summer ? -1 : 1) : 0;
  const U = new Float32Array(n), V = new Float32Array(n), mask = new Uint8Array(n);
  const speed = 2.6 * Math.min(2, k);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (!allow[i]) continue;
      mask[i] = 1;
      // How far along it is: slow down over the last quarter of the way, stop at the far edge
      const along = dx > 0 ? x / N : dx < 0 ? 1 - x / N : dz > 0 ? z / N : 1 - z / N;
      const go = speed * Math.max(0, Math.min(1, (0.92 - along) / 0.25));
      U[i] = dx * go; V[i] = dz * go;
    }
  }
  advect(P, U, V, mask, N, true);
}

/** The autumn run: from the river mouths, up the rivers against the flow. */
function riverRun(world, a, P, M) {
  const N = world.N, n = N * N, st = world.seasonT || 0;
  let atSea = 0, seaCells = 0;
  for (let i = 0; i < n; i++) if (M.seaM[i]) { atSea += P[i]; seaCells++; }
  const pool = Math.min(1.5, (seaCells ? atSea / seaCells : 0) * 3 + 0.2) * Math.min(1.5, a.stock);
  let mouths = 0;
  const tmp = new Float32Array(n);
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (M.seaM[i]) { tmp[i] += P[i]; continue; }
      if (!M.stream[i]) continue;
      const mouth = M.seaM[i - 1] || M.seaM[i + 1] || M.seaM[i - N] || M.seaM[i + N];
      const q = world.silt ? 1 - Math.min(1, 0.5 * (world.silt[i] || 0)) : 1;
      if (mouth) { P[i] = Math.max(P[i], 0.8 * pool * q); mouths++; }
      if (P[i] <= 0.01) continue;
      const vx = world.velX[i], vz = world.velZ[i], sp = Math.sqrt(vx * vx + vz * vz) || 1;
      const tx = Math.round(x - (vx / sp) * 1.5), tz = Math.round(z - (vz / sp) * 1.5), j = tz * N + tx;
      const warm = world.temperature[i] + seasonalAt(world, i, st) > 18 ? 0.5 : 1;
      // (a dam stops the run, all but a few, unless it has a fish ladder)
      const damHere = j >= 0 && j < n && world.dam[j] > 0.8;
      const go = 0.5 * warm * (damHere ? (world.fishLadder && world.fishLadder[j] ? 0.6 : 0.02) : 1);
      if (j >= 0 && j < n && M.stream[j]) { tmp[j] += P[i] * go; tmp[i] += P[i] * (1 - go) * 0.97; }
      else tmp[i] += P[i] * 0.97;
    }
  }
  for (let i = 0; i < n; i++) P[i] = Math.min(1.5, tmp[i]);
  a.mouths = Math.max(a.mouths || 0, mouths);
}

const HISTORY = 300; // samples kept per animal

/** Add each animal's current total to its population history. */
export function recordPopulations(world) {
  if (!world.popHistory) world.popHistory = {};
  const n = world.N * world.N;
  for (const a of world.animals || []) {
    const f = world['animal_' + a.id];
    if (!f) continue;
    let t = 0;
    for (let i = 0; i < n; i++) t += f[i];
    const h = world.popHistory[a.id] || (world.popHistory[a.id] = []);
    h.push(Math.round(t * 10) / 10);
    if (h.length > HISTORY) h.splice(0, h.length - HISTORY);
  }
  for (const id of Object.keys(world.popHistory)) if (!(world.animals || []).some((a) => a.id === id)) delete world.popHistory[id];
}

/** Can animal a live at cell i (for painting it in)? */
export function canLive(world, a, i) {
  const sea = seaLevel(world), wet = world.height[i] < sea;
  if (world.landUse && world.landUse[i] === 10 && !wet) return false; // (no wildlife in plantations)
  switch (a.habitat) {
    case 'sea': return wet || a.habits.runsRivers && world.water[i] > 0.03;
    case 'coast': return wet && sea - world.height[i] < 12;
    case 'stream': return !wet && (world.water[i] > 0.03 || (world.dam && world.dam[i] > 0.05));
    default: return !wet && world.water[i] < 0.3;
  }
}

/** The most common animal at cell i: [definition, density] or null. */
export function dominantAnimal(world, i) {
  let best = null, bv = 0.06;
  for (const a of world.animals || []) {
    const f = world['animal_' + a.id];
    if (f && f[i] > bv) { bv = f[i]; best = a; }
  }
  return best ? [best, bv] : null;
}

/** A short description: where it lives, what it eats, its habits. */
export function describeAnimal(world, a) {
  const foods = Object.keys(PLANT_FOODS).filter((k) => a.eats[k]).map((k) => PLANT_FOODS[k].split(' (')[0].toLowerCase());
  for (const pid of a.prey) { const b = (world.animals || []).find((x) => x.id === pid); if (b) foods.push(b.name); }
  const habits = Object.keys(HABITS).filter((k) => a.habits[k]).map((k) => HABITS[k][0].toLowerCase());
  if (a.migrates && a.migrates !== 'none') habits.push(MIGRATION[a.migrates].toLowerCase());
  habits.push(`likes ${a.tempMin ?? -10} to ${a.tempMax ?? 30} °C`);
  return `Lives in: ${HABITATS[a.habitat].toLowerCase()}. Eats: ${foods.length ? foods.join(', ') : 'nothing yet (it will die out)'}.${habits.length ? ' ' + habits.join('; ') + '.' : ''}`;
}

/**
 * A starter food web: deer (grazing meadows and browsing young trees, avoiding deep snow) and wolves
 * (hunting the deer), spread over the land they suit. Without the wolves the deer multiply and
 * browse the young trees out, and the forest stops regenerating; with them the deer are kept in
 * check and shy away from where the wolves hunt (a trophic cascade).
 */
export function addStarterFoodWeb(world) {
  ensureEcology(world);
  const deer = newAnimal({ name: 'Deer', color: [0.66, 0.46, 0.26], habitat: 'land', eats: { grass: true, young: true }, breed: 1.1, roam: 3, habits: { avoidsSnow: true } });
  const wolf = newAnimal({ name: 'Wolf', color: [0.42, 0.42, 0.46], habitat: 'land', eats: {}, prey: [deer.id], breed: 0.7, roam: 7, habits: {} });
  world.animals.push(deer, wolf);
  const n = world.N * world.N, D = animalField(world, deer), W = animalField(world, wolf);
  for (let i = 0; i < n; i++) {
    if (!canLive(world, deer, i) || world.vegetation[i] < 0.2) continue;
    D[i] = 0.25 + 0.1 * Math.random();
    W[i] = 0.05 + 0.03 * Math.random();
  }
  return [deer, wolf];
}

/** Fire followers that live on recent small burns: wood-boring beetles drawn to the smoke, the
 * woodpeckers that feed on them, and moths that drink at the fireweed. */
export function addFireFollowers(world) {
  ensureEcology(world);
  const beetle = newAnimal({ name: 'Fire beetle', color: [0.18, 0.16, 0.14], habitat: 'burn', eats: { charred: true }, breed: 1.8, roam: 5, habits: { frostKills: false } });
  const pecker = newAnimal({ name: 'Black-backed woodpecker', color: [0.10, 0.10, 0.12], habitat: 'burn', eats: {}, prey: [beetle.id], breed: 0.9, roam: 6, habits: {} });
  const moth = newAnimal({ name: 'Fireweed moth', color: [0.85, 0.35, 0.65], habitat: 'burn', eats: { fireflowers: true }, breed: 1.6, roam: 6, habits: {}, tempMin: -5, tempMax: 32 });
  world.animals.push(beetle, pecker, moth);
  const n = world.N * world.N;
  for (const a of [beetle, pecker, moth]) {
    const P = animalField(world, a);
    for (let i = 0; i < n; i++) if (canLive(world, a, i)) P[i] = 0.02 + 0.02 * Math.random();
  }
  return [beetle, pecker, moth];
}

// The road-avoidance band: busy roads, blurred out three cells either side, with the ground around
// wildlife crossings left out (a couple of milliseconds to work out)
function roadBand(world) {
  const LU = world.landUse, TR = world.roadTraffic;
  if (!LU || !TR) return null;
  const N = world.N, n = N * N;
  const m = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) if (LU[i] === 3 && TR[i] > 50) { m[i] = Math.min(1, TR[i] / 800); any = true; }
  if (!any) return null;
  const b = boxBlur(m, N, 3);
  if (world.crossing) {
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) if (world.crossing[i]) c[i] = 1;
    const cb = boxBlur(c, N, 4);
    for (let i = 0; i < n; i++) if (cb[i] > 0.01) b[i] *= Math.max(0, 1 - cb[i] * 12);
  }
  return b;
}
