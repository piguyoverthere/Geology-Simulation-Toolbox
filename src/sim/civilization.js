// Civilization: towns that grow on the land (the people themselves aren't drawn; you see what they
// do to the place).
//
// • Founding: a town is sited where people would choose to settle: a comfortable climate (a yearly
//   mean of roughly 8–20 °C), fresh water (a river or lake) or the coast close by, fertile, flat
//   land to farm, timber and fish within reach, and safe from floods and lava.
// • Food: a town clears farmland around it (fields: no forest grows back there) and feeds itself
//   from it, plus fish if it's on the coast. Its population grows toward what that food supports;
//   drought years cut the harvest, mild summers improve it. As it grows it builds outward.
// • Land use (world.landUse): 1 farmland, 2 town (paved), 3 road. Pavement (world.paved) flattens
//   the ground, seals it (rain runs straight off, nothing grows, it doesn't erode) and lightly
//   pollutes any water right next to it. And every patch of pavement sends heavy pollution
//   downstream, always: street and roof runoff, sewage, industry. It follows the drainage down to
//   the rivers (world.riverPollution: murky, dirty rivers below towns) and pours into the sea at
//   the river mouth.
// • Roads are built by terracing the hills along the route to an even grade and paving it (bridges
//   over rivers). Towns grow along their roads where the land suits, and big neighbouring towns
//   build roads to each other.
// • More rules: a town without fresh water nearby stays small (wells only); polluted drinking water
//   slows its growth; floods, wildfires, lava and great-storm surges cost it people; a big town sends
//   people out to found a daughter village; a town that dwindles away is abandoned, and its pavement
//   slowly breaks up and grows over.

import { boxBlur } from '../core/grid.js';
import { seasonParams, seasonalAt } from './climate.js';

export const civParams = {
  enabled: true,
  growth: 1,      // how fast towns grow
};

const PER_TOWN_CELL = 120;   // people per paved town cell
const PER_FARM_CELL = 70;    // people one cell of good farmland feeds
const MAX_TOWNS = 14;

const SYL1 = ['Ash', 'Bel', 'Cal', 'Dun', 'El', 'Fair', 'Glen', 'Hal', 'Ive', 'Kel', 'Lin', 'Mar', 'Nor', 'Oak', 'Pem', 'Red', 'Stan', 'Tor', 'Wes', 'Wick'];
const SYL2 = ['ford', 'by', 'ton', 'wick', 'mouth', 'bridge', 'ham', 'field', 'haven', 'stead', 'dale', 'bury', 'port', 'well', 'mere'];
function townName(world) {
  const used = new Set((world.towns || []).map((t) => t.name));
  for (let k = 0; k < 50; k++) {
    const n = SYL1[(Math.random() * SYL1.length) | 0] + SYL2[(Math.random() * SYL2.length) | 0];
    if (!used.has(n)) return n;
  }
  return 'Town ' + ((world.towns || []).length + 1);
}

export function ensureCiv(world) {
  const n = world.N * world.N;
  if (!world.towns) world.towns = [];
  if (!world.paved || world.paved.length !== n) world.paved = new Float32Array(n);
  if (!world.landUse || world.landUse.length !== n) world.landUse = new Int8Array(n);
  if (!world.civOwner || world.civOwner.length !== n) world.civOwner = new Int16Array(n);
  if (!world.riverPollution || world.riverPollution.length !== n) world.riverPollution = new Float32Array(n);
}

function seaOf(world) { return world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9; }

/** How fertile cell i is for farming (0..1): wet-enough soil, flat, a growing season. */
function fertility(world, i, slope) {
  const T = world.temperature[i], soil = world.soil ? world.soil[i] : 0.5;
  const moist = soil < 0.15 ? 0 : soil < 0.35 ? (soil - 0.15) / 0.2 : soil < 0.9 ? 1 : 0.6; // (not swamp)
  const warm = Math.max(0, Math.min(1, (T - 2) / 8)) * Math.max(0, Math.min(1, (30 - T) / 6));
  const flat = Math.max(0, 1 - slope / 0.45);
  return moist * warm * flat * (0.6 + 0.4 * (world.humus ? world.humus[i] : 0.5));
}

function slopeAt(world, i) {
  const N = world.N, H = world.height, x = i % N, z = (i / N) | 0;
  const gx = (H[x < N - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * 0.5, gz = (H[z < N - 1 ? i + N : i] - H[z > 0 ? i - N : i]) * 0.5;
  return Math.sqrt(gx * gx + gz * gz);
}

/**
 * How good cell i is to settle (0..1): climate, water, land, resources, safety. `near` holds
 * neighbourhood fields (fresh water, sea, fertile land, forest) from siteFields().
 */
export function siteScore(world, i, near) {
  const H = world.height, sea = seaOf(world);
  if (H[i] < sea + 1 || world.water[i] > 0.1 || (world.lava && world.lava[i] > 0) || (world.ice && world.ice[i] > 0.05)) return 0;
  const T = world.temperature[i];
  const climate = Math.max(0, Math.min(1, (T - 2) / 6)) * Math.max(0, Math.min(1, (26 - T) / 6));
  const slope = slopeAt(world, i);
  const flat = Math.max(0, 1 - slope / 0.4);
  const water = Math.min(1, near.fresh[i] * 3 + near.sea[i] * 1.5);       // a river, lake or the coast
  const land = Math.min(1, near.fertile[i] * 1.6);                           // farmland around
  const resources = 0.6 + 0.25 * Math.min(1, near.forest[i] * 2) + 0.15 * Math.min(1, near.sea[i] * 3); // timber, fish
  const flood = H[i] < sea + 2 ? 0.5 : 1;
  const crowd = (world.towns || []).some((t) => Math.hypot(t.x - (i % world.N), t.z - ((i / world.N) | 0)) < 18) ? 0 : 1;
  return climate * flat * (0.15 + 0.85 * water) * (0.2 + 0.8 * land) * resources * flood * crowd;
}

/** Neighbourhood fields used to judge sites (fresh water, sea, fertile land and forest nearby). */
export function siteFields(world) {
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world);
  const fresh = new Float32Array(n), seaM = new Float32Array(n), fert = new Float32Array(n), forest = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const wet = H[i] < sea;
    seaM[i] = wet ? 1 : 0;
    fresh[i] = !wet && world.water[i] > 0.05 ? 1 : 0;
    if (!wet) { fert[i] = fertility(world, i, slopeAt(world, i)); forest[i] = world.vegetation[i] > 0.66 ? 1 : 0; }
  }
  return { fresh: boxBlur(fresh, N, 5), sea: boxBlur(seaM, N, 5), fertile: boxBlur(fert, N, 7), forest: boxBlur(forest, N, 8) };
}

/** The best place to settle within `r` of (x, z) (or anywhere, if r is large). */
export function bestSite(world, x, z, r, fields = siteFields(world)) {
  const N = world.N;
  let best = -1, bs = 0.02;
  const x0 = Math.max(2, Math.round(x - r)), x1 = Math.min(N - 3, Math.round(x + r));
  const z0 = Math.max(2, Math.round(z - r)), z1 = Math.min(N - 3, Math.round(z + r));
  for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) {
    if ((xx - x) ** 2 + (zz - z) ** 2 > r * r) continue;
    const i = zz * N + xx, s = siteScore(world, i, fields);
    if (s > bs) { bs = s; best = i; }
  }
  return best >= 0 ? { i: best, x: best % N, z: (best / N) | 0, score: bs } : null;
}

/** Found a town at cell i. */
export function foundTown(world, i, pop = 60) {
  ensureCiv(world);
  const N = world.N;
  const num = Math.max(0, ...world.towns.map((t) => t.num)) + 1;
  const t = { id: 't' + Math.random().toString(36).slice(2, 8), num, name: townName(world), x: i % N, z: (i / N) | 0, pop, history: [pop], founded: seasonParams.year || 1, links: [] };
  world.towns.push(t);
  pave(world, i, t.num, 2);
  return t;
}

/** Abandon town t: its people leave; its land is left to recover. */
export function removeTown(world, t) {
  world.towns = world.towns.filter((u) => u !== t);
  for (const u of world.towns) u.links = u.links.filter((id) => id !== t.id);
  const n = world.N * world.N;
  for (let i = 0; i < n; i++) if (world.civOwner[i] === t.num) world.civOwner[i] = 0;
}

/** Pave cell i (town or road): flatten it a little toward its neighbours, seal it. */
function pave(world, i, owner, use) {
  const N = world.N, H = world.height, x = i % N, z = (i / N) | 0;
  if (x > 0 && z > 0 && x < N - 1 && z < N - 1 && world.paved[i] < 0.5) {
    const avg = (H[i - 1] + H[i + 1] + H[i - N] + H[i + N]) * 0.25;
    H[i] += (avg - H[i]) * 0.6;
    world.prevHeight[i] = H[i];
  }
  world.paved[i] = 1;
  world.landUse[i] = use;
  if (owner) world.civOwner[i] = owner;
  world.vegetation[i] = 0;
  world.forestAge[i] = 0;
}

/**
 * Build a road along points [{x, z}…]: terrace the hills along the route to an even grade (cut and
 * fill), pave it, bridge any rivers. Roads let towns grow out along them.
 */
export function buildRoad(world, pts) {
  ensureCiv(world);
  const N = world.N, H = world.height, sea = seaOf(world);
  // Sample the route every half cell
  const cells = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1], len = Math.hypot(b.x - a.x, b.z - a.z), k = Math.max(1, Math.ceil(len * 2));
    for (let j = 0; j <= k; j++) {
      const x = Math.round(a.x + ((b.x - a.x) * j) / k), z = Math.round(a.z + ((b.z - a.z) * j) / k);
      if (x < 1 || z < 1 || x > N - 2 || z > N - 2) continue;
      const i = z * N + x;
      if (cells[cells.length - 1] !== i) cells.push(i);
    }
  }
  if (cells.length < 2) return 0;
  // The road's grade: the ground along it, smoothed (cuts through crests, fills hollows)
  const prof = cells.map((i) => H[i]);
  const smooth = prof.map((_, k) => {
    let s = 0, c = 0;
    for (let d = -6; d <= 6; d++) { const j = k + d; if (j >= 0 && j < prof.length) { s += prof[j]; c++; } }
    return s / c;
  });
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k];
    if (H[i] < sea || world.water[i] > 0.4) { world.landUse[i] = 3; continue; } // (a bridge)
    const target = Math.max(smooth[k], sea + 0.6);
    // Terrace: the road bed and its shoulders follow the grade
    for (const j of [i, i - 1, i + 1, i - N, i + N]) {
      if (H[j] < sea) continue;
      const w = j === i ? 1 : 0.5;
      H[j] += (target - H[j]) * w;
      world.prevHeight[j] = H[j];
    }
    pave(world, i, 0, 3);
  }
  world.dirty = true;
  return cells.length;
}

/** One civilization step (a couple of times a second). */
export function civStep(world) {
  if (!civParams.enabled) return;
  ensureCiv(world);
  const towns = world.towns;
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world);
  const P = world.paved, LU = world.landUse, OW = world.civOwner, RP = world.riverPollution;
  // --- Pollution: light near pavement, heavy downstream (always) ---------------------------
  for (let i = 0; i < n; i++) if (RP[i] > 0) RP[i] = RP[i] < 1e-3 ? 0 : RP[i] * 0.85;
  let anyPaved = false;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (P[i] < 0.5) continue;
      anyPaved = true;
      // Light: into water right next to it
      for (const j of [i - 1, i + 1, i - N, i + N]) {
        if (H[j] < sea) { if (world.pollution) world.pollution[j] = Math.min(4, world.pollution[j] + 0.0015); }
        else if (world.water[j] > 0.05) RP[j] += 0.004;
      }
      // Heavy: down the drainage to the rivers and on to the sea
      let c = i;
      const load = 0.012;
      for (let k = 0; k < 160; k++) {
        if (H[c] < sea) { if (world.pollution) world.pollution[c] = Math.min(4, world.pollution[c] + load * 0.6); break; }
        if (world.water[c] > 0.03) RP[c] += load;
        const cx = c % N, cz = (c / N) | 0;
        if (cx < 1 || cz < 1 || cx > N - 2 || cz > N - 2) break;
        let low = c, lh = H[c] + world.water[c];
        for (const j of [c - 1, c + 1, c - N, c + N, c - N - 1, c - N + 1, c + N - 1, c + N + 1]) {
          const hj = H[j] + world.water[j];
          if (hj < lh) { lh = hj; low = j; }
        }
        if (low === c) break; // (a hollow: it pools there)
        c = low;
      }
    }
  }
  // Abandoned pavement breaks up and grows over; farmland with no town goes back to the wild
  for (let i = 0; i < n; i++) {
    if (LU[i] === 0 || OW[i] || LU[i] === 3) continue;
    if (LU[i] === 1) { LU[i] = 0; continue; }
    P[i] = Math.max(0, P[i] - 0.004);
    if (P[i] <= 0) LU[i] = 0;
  }
  if (!towns.length) { world.civPop = 0; return; }
  // (the site fields change slowly: refresh them every few steps)
  world.civFieldsAge = (world.civFieldsAge || 0) + 1;
  if (!world._civFields || world._civFields.N !== N || world.civFieldsAge % 6 === 0) { world._civFields = siteFields(world); world._civFields.N = N; }
  const fields = world._civFields;
  const ph = seasonParams.enabled ? seasonParams.phase : 0.3;
  const yearFactor = seasonParams.enabled ? (seasonParams.yearKind === 'hot' ? 0.6 : seasonParams.yearKind === 'mild' ? 1.1 : 1) : 1;
  let total = 0;
  for (const t of [...towns]) {
    const ci = t.z * N + t.x;
    // Its land: town cells and farms (owner = t.num)
    let townCells = 0, farmCells = 0, food = 0, hurt = 0;
    const R = 4 + 2.4 * Math.sqrt(t.pop / PER_FARM_CELL);
    const x0 = Math.max(1, Math.floor(t.x - R - 4)), x1 = Math.min(N - 2, Math.ceil(t.x + R + 4));
    const z0 = Math.max(1, Math.floor(t.z - R - 4)), z1 = Math.min(N - 2, Math.ceil(t.z + R + 4));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * N + x;
      if (OW[i] !== t.num) continue;
      if (LU[i] === 2) {
        townCells++;
        // Disasters on the town: floods, fire, lava, the sea
        if (world.water[i] > 0.6 || H[i] < (world.seaLevel ?? -1e9)) hurt += 0.02;
        if (world.fire[i] > 0) hurt += 0.04;
        if (world.lava && world.lava[i] > 0.05) { hurt += 0.1; LU[i] = 0; P[i] = 0; OW[i] = 0; }
      } else if (LU[i] === 1) {
        farmCells++;
        const f = fertility(world, i, slopeAt(world, i));
        // (burnt, flooded or snowbound fields yield little)
        const lost = world.fire[i] > 0 || world.burnt[i] > 0.5 || world.water[i] > 0.4 || (world.snow && world.snow[i] > 0.5 && ph > 0.1 && ph < 0.55) ? 0.2 : 1;
        food += PER_FARM_CELL * f * lost;
        if (world.vegetation[i] > 0.45) world.vegetation[i] = 0.45; // (crops, not forest)
      }
    }
    // Fish from the sea within reach
    food += 600 * fields.sea[ci] * (world.oxygen ? world.oxygen[ci] ?? 1 : 1);
    food *= yearFactor;
    // Water: a river or lake nearby, or only wells; dirty water slows them
    const freshNear = fields.fresh[ci];
    const waterOK = freshNear > 0.02 ? 1 : 0.35;
    const dirty = Math.min(1, (RP[ci] || 0) * 0.5 + (fields.fresh[ci] > 0 ? 0 : 0));
    const K = Math.max(20, food * waterOK * (1 - 0.4 * dirty));
    // Growth toward what the land feeds (and disasters)
    const r = 0.02 * civParams.growth;
    // (an overcrowded town shrinks as people drift away, a few percent a step, not all at once)
    const change = Math.max(-0.08 * t.pop, r * t.pop * (1 - t.pop / K));
    t.pop = Math.max(0, t.pop + change - hurt * t.pop);
    t.capacity = K; t.farm = farmCells; t.cells = townCells;
    // Build out: more town for more people (spreading along its roads where they run), and
    // farmland to feed them
    // (farmers clear more land than they need today, so the town can grow into it: a town's size
    // ends up limited by how much fertile land there is around it, and by its neighbours)
    const perFarm = farmCells ? Math.max(8, (food - 600 * fields.sea[ci]) / Math.max(0.5, yearFactor) / farmCells) : PER_FARM_CELL * 0.5;
    const wantTown = Math.ceil(t.pop / PER_TOWN_CELL), wantFarm = Math.ceil((t.pop * 1.8) / perFarm) + 4;
    if (townCells < wantTown) expand(world, t, 2, Math.min(3, wantTown - townCells), R, fields);
    if (farmCells < wantFarm) expand(world, t, 1, Math.min(8, wantFarm - farmCells), R * 2, fields);
    // A big town sends people out to found a daughter village (linked by road)
    // (when the town is crowded: near what its land can feed)
    if (t.pop > 300 && t.pop > 0.85 * K && towns.length < MAX_TOWNS && Math.random() < 0.015 * civParams.growth) {
      const ang = Math.random() * Math.PI * 2, d = 30 + Math.random() * 30;
      const site = bestSite(world, t.x + Math.cos(ang) * d, t.z + Math.sin(ang) * d, 24, fields);
      if (site) {
        const v = foundTown(world, site.i, 60);
        t.pop -= 60;
        linkTowns(world, t, v);
      }
    }
    // Big neighbours build roads to each other
    if (t.pop > 250 && Math.random() < 0.03) {
      for (const u of towns) {
        if (u === t || u.pop < 150 || t.links.includes(u.id) || Math.hypot(u.x - t.x, u.z - t.z) > 80) continue;
        linkTowns(world, t, u);
        break;
      }
    }
    t.history.push(Math.round(t.pop));
    if (t.history.length > 300) t.history.splice(0, t.history.length - 300);
    // A town that dwindles away is abandoned
    if (t.pop < 8) removeTown(world, t);
    else total += t.pop;
  }
  world.civPop = total;
  world.dirty = true;
}

/** Connect two towns with a road (unless the way is over open sea). */
function linkTowns(world, a, b) {
  const N = world.N, sea = seaOf(world);
  let wet = 0;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  for (let k = 0; k <= len; k++) {
    const x = Math.round(a.x + ((b.x - a.x) * k) / len), z = Math.round(a.z + ((b.z - a.z) * k) / len);
    if (world.height[z * N + x] < sea) wet++;
  }
  a.links.push(b.id); b.links.push(a.id);
  if (wet > 3) return; // (no road across the sea)
  buildRoad(world, [{ x: a.x, z: a.z }, { x: b.x, z: b.z }]);
}

/**
 * Grow town t's land: `use` 2 (town) or 1 (farms), `count` cells, within radius R of its centre.
 * New town cells go next to its existing town or along roads; farms on the most fertile land.
 */
function expand(world, t, use, count, R, fields) {
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse, OW = world.civOwner;
  const cands = [];
  const x0 = Math.max(2, Math.floor(t.x - R)), x1 = Math.min(N - 3, Math.ceil(t.x + R));
  const z0 = Math.max(2, Math.floor(t.z - R)), z1 = Math.min(N - 3, Math.ceil(t.z + R));
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const i = z * N + x;
    if (LU[i] !== 0 && !(use === 2 && LU[i] === 1 && OW[i] === t.num)) continue; // (towns grow over their own fields)
    if (H[i] < sea + 0.8 || world.water[i] > 0.1 || (world.ice && world.ice[i] > 0.05)) continue;
    const d = Math.hypot(x - t.x, z - t.z);
    if (d > R) continue;
    const slope = slopeAt(world, i);
    let score;
    if (use === 2) {
      // Next to town or road
      let adj = 0, road = 0;
      for (const j of [i - 1, i + 1, i - N, i + N]) { if (LU[j] === 2 && OW[j] === t.num) adj = 1; if (LU[j] === 3) road = 1; }
      if (!adj && !road) continue;
      if (slope > 0.6) continue;
      score = (1 - d / R) + road * 0.6 + adj * 0.3 - slope;
    } else {
      const f = fertility(world, i, slope);
      if (f < 0.15) continue;
      score = f - 0.5 * (d / R);
    }
    cands.push([score + Math.random() * 0.05, i]);
  }
  cands.sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < Math.min(count, cands.length); k++) {
    const i = cands[k][1];
    if (use === 2) pave(world, i, t.num, 2);
    else { LU[i] = 1; OW[i] = t.num; world.forestAge[i] = 0; if (world.vegetation[i] > 0.45) world.vegetation[i] = 0.45; }
  }
}

/** Town at (or nearest to) cell i within r cells, or null. */
export function townNear(world, x, z, r = 10) {
  let best = null, bd = r;
  for (const t of world.towns || []) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; best = t; } }
  return best;
}
