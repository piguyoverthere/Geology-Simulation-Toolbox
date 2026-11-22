// Wildlife: animal populations that depend on the land, the sea and on each other.
//
// Each population is a density field (0 = none … ~1 = as many as the place can hold), growing,
// dying and moving every few frames. The links between them (and to the plants, rivers, sea and
// fire) are what make it an ecosystem:
//
//   On land
//   • Deer graze meadows and browse young trees and shrubs at forest edges. Many deer keep
//     meadows open and stop forest (and the willows and aspen along streams) from regrowing; deep
//     snow buries their food and drives them downhill in winter, and kills some.
//   • Wolves live on deer. Where there are wolves, deer are fewer and wary: they keep away from the
//     open stream banks, so the willows there grow back (a trophic cascade).
//   • Beavers need streams lined with willow, alder, aspen or birch. They fell those trees and dam
//     the streams, raising ponds and soggy wetland behind the dams; too many deer (eating the
//     willows) starve them out.
//   • Bark beetles bore into conifers stressed by drought and warmth; outbreaks spread from tree
//     to tree and kill whole stands, leaving grey dead wood that burns fiercely. A hard winter
//     freeze kills the beetles.
//
//   Rivers and sea
//   • Forage fish (herring, anchovy) swarm where plankton is plentiful, grazing it down (keeping
//     blooms in check), with seagrass and kelp beds as nurseries; they die in low-oxygen water.
//   • Salmon feed at sea on the forage fish, then each autumn run up the rivers to spawn in cool,
//     clean, flowing water (warm or dirty water and dams stop them). They die after spawning, and
//     their bodies fertilise the stream banks: forests along salmon rivers grow faster.
//   • Sea urchins graze kelp; unchecked, they mow it down into bare urchin barrens. Sea otters eat
//     the urchins, so where there are otters the kelp forests thrive; pollution kills otters.

import { boxBlur } from '../core/grid.js';
import { seasonParams, seasonalAt } from './climate.js';

export const ecoParams = {
  enabled: true,
  speed: 1,      // how fast populations grow, decline and move
};

export const SPECIES_ECO = [
  { id: 'deer', label: 'Deer', color: [0.66, 0.46, 0.26], help: 'Graze meadows and browse young trees: keep meadows open and stop forest regrowing. Driven downhill by deep snow. Eaten by wolves.' },
  { id: 'wolves', label: 'Wolves', color: [0.30, 0.30, 0.32], help: 'Hunt deer, keeping them fewer and away from stream banks, so streamside willows grow back.' },
  { id: 'beaver', label: 'Beavers', color: [0.86, 0.48, 0.16], help: 'Dam streams lined with willow, alder, aspen or birch, making ponds and wetland. Need those trees (which deer also eat).' },
  { id: 'beetle', label: 'Bark beetles', color: [0.80, 0.18, 0.12], help: 'Kill drought-stressed conifers, leaving dead wood that burns fiercely. Killed by hard winter freezes.' },
  { id: 'salmon', label: 'Salmon (run)', color: [0.95, 0.45, 0.50], help: 'Run up cool, clean rivers to spawn each autumn, fertilising the stream banks. Feed at sea on forage fish.' },
  { id: 'fish', label: 'Forage fish', color: [0.70, 0.80, 0.88], help: 'Herring and anchovy: graze plankton (keeping blooms down), shelter in seagrass and kelp, die in low-oxygen water.' },
  { id: 'urchin', label: 'Sea urchins', color: [0.50, 0.22, 0.55], help: 'Graze kelp: unchecked, they leave bare urchin barrens.' },
  { id: 'otter', label: 'Sea otters', color: [0.42, 0.30, 0.20], help: 'Eat urchins, so kelp forests thrive where they live. Killed by pollution.' },
];
const FIELDS = SPECIES_ECO.map((s) => s.id);

export function ensureEcology(world) {
  const n = world.N * world.N;
  let fresh = false;
  for (const k of [...FIELDS, 'dam', 'deadWood', 'browse', 'salmonN']) {
    if (!world[k] || world[k].length !== n) { world[k] = new Float32Array(n); fresh = true; }
  }
  if (world.salmonStock === undefined) world.salmonStock = 1;
  return fresh;
}

/** Seed a new map with a starting population of everything (called on the first step). */
function seed(world) {
  const N = world.N, n = N * N, H = world.height, V = world.vegetation;
  const sea = seaLevel(world);
  for (const k of [...FIELDS, 'dam', 'deadWood', 'browse', 'salmonN']) world[k].fill(0); // (nothing left from the last map)
  for (let i = 0; i < n; i++) {
    const r = ((i * 2654435761) >>> 0) / 4294967296;
    if (H[i] >= sea) {
      const v = V[i];
      world.deer[i] = v > 0.1 ? 0.35 * Math.min(1, v * 1.5) : 0;
      world.wolves[i] = v > 0.5 ? 0.12 : 0;
      world.beetle[i] = world.conifer && world.conifer[i] > 0.5 && r < 0.01 ? 0.3 : 0;
    } else {
      const depth = sea - H[i];
      world.fish[i] = depth > 1 ? 0.3 : 0;
      const m = world.marine ? world.marine[i] : -1;
      world.urchin[i] = m === 1 ? 0.25 : 0;          // (kelp)
      world.otter[i] = m === 1 && r < 0.3 ? 0.15 : 0;
    }
  }
  world.ecoSeeded = true;
}

function seaLevel(world) { return world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9; }

/** Spread a population: move a share toward the neighbourhood average (where allowed). */
function spread(F, allow, N, r, rate) {
  const n = N * N, tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) tmp[i] = F[i] * allow[i];
  const b = boxBlur(tmp, N, r), m = boxBlur(allow, N, r);
  for (let i = 0; i < n; i++) {
    if (!allow[i]) { F[i] = 0; continue; }
    F[i] += (b[i] / Math.max(m[i], 1e-3) - F[i]) * rate;
  }
}

let masks = null; // habitat masks, shared by the three parts of a step

/**
 * One wildlife step, in three parts run on successive calls (to spread the work over frames):
 * 0 = deer and wolves (and the habitat masks), 1 = beavers and bark beetles, 2 = the sea and salmon.
 */
export function ecologyStep(world, part = -1) {
  if (!ecoParams.enabled) return;
  if (ensureEcology(world) || !world.ecoSeeded) seed(world);
  if (part < 0) { for (let p = 0; p < 3; p++) ecologyPart(world, p, 1); return; }
  ecologyPart(world, part, 2);
}

function ecologyPart(world, part, mult) {
  const N = world.N, n = N * N, H = world.height, V = world.vegetation, AGE = world.forestAge;
  const D = world.water, SN = world.snow, SOIL = world.soil;
  const sea = seaLevel(world), k = ecoParams.speed * mult;
  const DE = world.deer, WO = world.wolves, BV = world.beaver, BT = world.beetle;
  const SA = world.salmon, FI = world.fish, UR = world.urchin, OT = world.otter;
  const DAM = world.dam, DW = world.deadWood, BR = world.browse;
  const ph = seasonParams.enabled ? seasonParams.phase : 0.3;
  const st = world.seasonT || 0;

  // Habitat masks (recomputed at the start of each round)
  if (part === 0 || !masks || masks.n !== n) {
    masks = { n, land: new Float32Array(n), seaM: new Float32Array(n), stream: new Float32Array(n) };
  }
  const { land, seaM, stream } = masks;
  if (part === 0 || !masks.ready) for (let i = 0; i < n; i++) {
    const wet = H[i] < sea;
    seaM[i] = wet ? 1 : 0;
    land[i] = !wet && D[i] < 0.3 ? 1 : 0;
    // A stream: flowing water on land
    stream[i] = !wet && D[i] > 0.04 && D[i] < 2 && (world.velX[i] * world.velX[i] + world.velZ[i] * world.velZ[i]) > 0.0025 ? 1 : 0;
  }
  masks.ready = true;
  const decid = world.decid, conifer = world.conifer;
  if (part === 0) landAnimals(world, N, n, land, stream, boxBlur(stream, N, 2), k, V, AGE, SN, DE, WO, BR);
  else if (part === 1) { beavers(world, N, n, H, V, stream, decid, DE, BV, DAM, k); beetles(world, N, n, V, AGE, SOIL, conifer, BT, DW, st, k); }
  else { seaLife(world, N, n, H, sea, seaM, FI, UR, OT, k); salmonRun(world, N, n, ph, st, stream, seaM, SA, DAM); }
  world.dirty = true;
}

function landAnimals(world, N, n, land, stream, streamNear, k, V, AGE, SN, DE, WO, BR) {
  // --- Deer and wolves -------------------------------------------------------------------
  const wolfNear = boxBlur(WO, N, 5);
  const K = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i]) { DE[i] = 0; WO[i] = 0; continue; }
    const v = V[i];
    // Food: grass and shrubs, young forest and edges; mature forest has little in reach
    let food = v < 0.05 ? 0 : v < 0.75 ? Math.min(1, v * 1.8) : 0.35 + 0.65 * (1 - AGE[i]);
    // Snow buries it (and drives the deer down to the valleys)
    const snow = SN ? SN[i] : 0;
    food *= Math.max(0.05, 1 - snow * 0.8);
    // Wary of wolves on the open stream banks (where they can be ambushed)
    food *= 1 - 0.6 * Math.min(1, wolfNear[i] * 3) * Math.min(1, streamNear[i] * 2);
    K[i] = food;
    const d = DE[i];
    let dd = 0.03 * d * (1 - d / Math.max(0.02, food));       // grow toward what the land can feed
    dd -= 0.25 * WO[i] * d;                                       // wolves
    if (snow > 1.2) dd -= 0.02 * d;                               // winter kill in deep snow
    DE[i] = Math.max(0, Math.min(1.5, d + dd * k));
    // Wolves: thrive on plenty of deer, starve without
    const prey = Math.min(1, d * 2);
    WO[i] = Math.max(0, Math.min(1, WO[i] + 0.03 * k * WO[i] * (prey - 0.3)));
    BR[i] = DE[i]; // browsing pressure, read by the vegetation
  }
  // Deer drift toward better grazing (and downhill out of the snow); wolves roam widely
  {
    const tmp = new Float32Array(n);
    for (let i = 0; i < n; i++) tmp[i] = DE[i] * land[i];
    const b = boxBlur(tmp, N, 3), kb = boxBlur(K, N, 3);
    for (let i = 0; i < n; i++) {
      if (!land[i]) continue;
      const target = kb[i] > 1e-3 ? (b[i] * K[i]) / kb[i] : 0;
      DE[i] += (target - DE[i]) * 0.2 * k;
    }
  }
  spread(WO, land, N, 5, 0.15 * k);
}

function beavers(world, N, n, H, V, stream, decid, DE, BV, DAM, k) {
  // --- Beavers ----------------------------------------------------------------------------
  // Food: willow, alder, aspen and birch along the stream (deciduous trees), less where deer eat them
  const willow = new Float32Array(n);
  for (let i = 0; i < n; i++) willow[i] = (decid ? decid[i] : 0) * V[i] * (1 - 0.6 * Math.min(1, DE[i] * 1.5));
  const willowNear = boxBlur(willow, N, 3);
  for (let i = 0; i < n; i++) {
    const onStream = stream[i] || DAM[i] > 0.05;
    if (!onStream) { BV[i] *= 0.9; if (BV[i] < 0.01) BV[i] = 0; }
    else BV[i] = Math.max(0, Math.min(1, BV[i] + 0.03 * k * BV[i] * (willowNear[i] * 3 - 0.35)));
    // A healthy colony dams its stream: the dam rises a little each step (on gentle ground)
    if (BV[i] > 0.4 && DAM[i] < 1.4) {
      const gx = (H[Math.min(n - 1, i + 1)] - H[Math.max(0, i - 1)]) * 0.5, gz = (H[Math.min(n - 1, i + N)] - H[Math.max(0, i - N)]) * 0.5;
      if (gx * gx + gz * gz < 0.36) { const inc = 0.004 * BV[i] * k; H[i] += inc; DAM[i] += inc; }
    } else if (BV[i] < 0.05 && DAM[i] > 0) {
      // Abandoned dams slowly wash out
      const dec = Math.min(DAM[i], 0.002 * k); H[i] -= dec; DAM[i] -= dec;
    }
    // They fell the trees around their pond
    if (BV[i] > 0.2 && decid && decid[i] > 0.2) V[i] = Math.max(0, V[i] - 0.001 * BV[i] * k);
  }
  {
    const allow = new Float32Array(n);
    for (let i = 0; i < n; i++) allow[i] = stream[i] || DAM[i] > 0.05 ? 1 : 0;
    spread(BV, allow, N, 3, 0.05 * k);
  }

}

function beetles(world, N, n, V, AGE, SOIL, conifer, BT, DW, st, k) {
  // --- Bark beetles -----------------------------------------------------------------------
  {
    const temp = (i) => world.temperature[i] + seasonalAt(world, i, st);
    for (let i = 0; i < n; i++) {
      const c = conifer ? conifer[i] * V[i] : 0;
      if (c < 0.1) { BT[i] *= 0.8; if (BT[i] < 0.005) BT[i] = 0; continue; }
      // Drought-stressed, warm forest is easy prey; a hard freeze kills the larvae
      const drought = 1 - Math.min(1, (SOIL ? SOIL[i] : 0.5) * 1.6);
      const t = temp(i);
      const warm = Math.max(0, Math.min(1, (t - 8) / 14));
      const g = 0.06 * k * BT[i] * (c * (0.4 * drought + 0.4 * warm + 0.2) - 0.25);
      BT[i] = Math.max(0, Math.min(1, BT[i] + g));
      if (t < -12) BT[i] *= 0.6;
      // Infested trees die: the forest turns grey, leaving dead wood
      if (BT[i] > 0.35) {
        const kill = 0.006 * BT[i] * k * V[i];
        V[i] -= kill; AGE[i] = Math.max(0, AGE[i] - kill * 2);
        DW[i] = Math.min(1, DW[i] + kill * 2);
      }
    }
    const allow = new Float32Array(n);
    for (let i = 0; i < n; i++) allow[i] = conifer && conifer[i] > 0.15 && V[i] > 0.2 ? 1 : 0;
    spread(BT, allow, N, 2, 0.12 * k);
  }
  for (let i = 0; i < n; i++) if (DW[i] > 0) { DW[i] = Math.max(0, DW[i] - 0.0015 * k); if (world.fire[i] > 0) DW[i] = 0; }

}

function seaLife(world, N, n, H, sea, seaM, FI, UR, OT, k) {
  // --- The sea: forage fish, urchins, otters -----------------------------------------------
  const PL = world.plankton, OX = world.oxygen, HL = world.marineHealth, M = world.marine, PO = world.pollution;
  let fishSum = 0, fishCells = 0;
  for (let i = 0; i < n; i++) {
    if (!seaM[i]) { FI[i] = 0; UR[i] = 0; OT[i] = 0; continue; }
    const m = M ? M[i] : -1;
    const bed = m >= 1 && m <= 3 && HL ? HL[i] : 0; // kelp, seagrass, coral nurseries
    const food = Math.min(1, (PL ? PL[i] : 0.2) * 1.2 + 0.25 * bed + 0.1);
    const ox = OX ? OX[i] : 1;
    let f = FI[i];
    f += 0.04 * k * f * (food - f) - (ox < 0.35 ? 0.15 * f : 0) - (PO ? 0.05 * Math.min(1, PO[i]) * f : 0);
    FI[i] = Math.max(0, Math.min(1.2, f));
    // They graze the plankton down
    if (PL) PL[i] = Math.max(0, PL[i] - 0.02 * FI[i] * k);
    fishSum += FI[i]; fishCells++;
    // Urchins graze kelp (and other weed); otters eat urchins; pollution kills otters
    const kelp = m === 1 && HL ? HL[i] : 0;
    const depth = sea - H[i];
    const algae = depth < 10 ? 0.3 + kelp : 0;
    let u = UR[i];
    u += 0.03 * k * u * (algae - u) - 0.2 * k * OT[i] * u;
    UR[i] = Math.max(0, Math.min(1.5, u));
    if (m === 1 && HL) HL[i] = Math.max(0, HL[i] - 0.012 * k * Math.max(0, UR[i] - 0.3)); // urchin barrens
    let o = OT[i];
    o += 0.03 * k * o * (Math.min(1, UR[i] * 2) - 0.35) - (PO && PO[i] > 0.4 ? 0.1 * o : 0);
    OT[i] = depth < 12 ? Math.max(0, Math.min(1, o)) : 0;
  }
  // Fish school about and ride the currents; urchins creep; otters swim along the coast
  spread(FI, seaM, N, 3, 0.2 * k);
  spread(UR, seaM, N, 1, 0.05 * k);
  spread(OT, seaM, N, 3, 0.1 * k);
  world.fishMean = fishCells ? fishSum / fishCells : 0;

}

function salmonRun(world, N, n, ph, st, stream, seaM, SA, DAM) {
  // --- Salmon ------------------------------------------------------------------------------
  // The run: in autumn (Sept–Nov) salmon gather at the river mouths and swim upstream; in early
  // winter they spawn and die, fertilising the banks. Their numbers next year depend on how many
  // spawned and on the food at sea (forage fish).
  const run = ph > 0.47 && ph < 0.72;
  // (salmon-derived nutrients in the stream banks fade over a few years)
  const SN2 = world.salmonN;
  for (let i = 0; i < n; i++) if (SN2[i] > 0) SN2[i] = Math.max(0, SN2[i] - 0.0015);
  let mouths = 0;
  if (run) {
    const strength = Math.min(1.5, world.salmonStock);
    for (let i = 0; i < n; i++) {
      if (!stream[i]) { if (!seaM[i]) SA[i] *= 0.5; else SA[i] = 0; continue; }
      // Entering from the sea: stream cells next to the sea
      const x = i % N;
      const mouth = (x > 0 && seaM[i - 1]) || (x < N - 1 && seaM[i + 1]) || (i >= N && seaM[i - N]) || (i < n - N && seaM[i + N]);
      const q = world.silt ? 1 - Math.min(1, 0.5 * (world.silt[i] || 0)) : 1;
      if (mouth) { SA[i] = Math.max(SA[i], 0.8 * strength * q); mouths++; }
    }
    // Swim upstream (against the flow), stopped by warm water and by dams
    const tmp = new Float32Array(n);
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        const i = z * N + x;
        if (!stream[i] || SA[i] <= 0.01) continue;
        const vx = world.velX[i], vz = world.velZ[i], sp = Math.sqrt(vx * vx + vz * vz) || 1;
        const tx = Math.round(x - (vx / sp) * 1.5), tz = Math.round(z - (vz / sp) * 1.5);
        const j = tz * N + tx;
        const warm = world.temperature[i] + seasonalAt(world, i, st) > 18 ? 0.5 : 1;
        const blocked = DAM[j] > 0.8 ? 0.3 : 1;
        const go = 0.5 * warm * blocked;
        if (j >= 0 && j < n && stream[j]) { tmp[j] += SA[i] * go; tmp[i] += SA[i] * (1 - go) * 0.97; }
        else tmp[i] += SA[i] * 0.97;
      }
    }
    for (let i = 0; i < n; i++) SA[i] = Math.min(1.5, tmp[i]);
    world.salmonMouths = Math.max(world.salmonMouths || 0, mouths);
  } else if (ph >= 0.72 && !world.salmonSpawned) {
    // Spawning: the run ends, the fish die and fertilise the stream banks
    let spawned = 0;
    const carcass = boxBlur(SA, N, 3);
    for (let i = 0; i < n; i++) {
      spawned += SA[i];
      if (carcass[i] > 0.02 && !seaM[i]) {
        world.humus[i] = Math.min(1, world.humus[i] + 0.15 * carcass[i]);
        SN2[i] = Math.min(1, SN2[i] + 4 * carcass[i]); // (marine nitrogen: the banks grow richer)
      }
    }
    SA.fill(0);
    // Next year's run: how well this year's run did (spawners per river mouth, against what a
    // healthy run brings) × how well the young survive at sea (forage fish to eat)
    const expected = Math.max(1, (world.salmonMouths || 1) * 4 * world.salmonStock);
    const success = Math.min(1.5, spawned / expected);
    const sea = 0.4 + 1.2 * Math.min(1, world.fishMean * 2.5);
    world.salmonStock = Math.max(0.02, Math.min(2, 0.5 * world.salmonStock + world.salmonStock * success * sea * 0.8));
    world.salmonMouths = 0;
    world.salmonSpawned = true;
  }
  if (ph < 0.47) world.salmonSpawned = false;
}

/** Dominant animal at cell i (for the overlay and inspector): [index, density] or null. */
export function dominantAnimal(world, i) {
  let best = -1, bv = 0.06;
  SPECIES_ECO.forEach((s, k) => { const f = world[s.id]; const v = f ? f[i] * (s.id === 'beetle' || s.id === 'beaver' || s.id === 'salmon' ? 2 : 1) : 0; if (v > bv) { bv = v; best = k; } });
  return best >= 0 ? [best, bv] : null;
}
