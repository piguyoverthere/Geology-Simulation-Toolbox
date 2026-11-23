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

import { boxBlur, MinHeap } from '../core/grid.js';
import { seasonParams, seasonalAt, drySeason, climateParams } from './climate.js';
import { ROCK_INDEX } from '../core/rocks.js';
import { coastParams, isLivingBed, MARINE_ID } from './coast.js';

export const civParams = {
  enabled: true,
  growth: 1,      // how fast towns spread: new villages, hunting
  popRate: 1,     // how fast their populations increase
  farmSlope: 15,  // steepest ground (degrees) that can be farmed; steeper must be terraced flat first
  destruction: 1, // how hard towns are on the land: burning to clear it, pollution, terracing
  quarrying: true, // whether big towns quarry hills away
  extraPlantations: false, // towns keep starting plantations even when they have all the timber they need
  plotSize: 120,  // largest plantation plot a town lays out (cells): smaller plots rotate faster
  epidemics: true, // crowded towns with dirty water suffer outbreaks of disease, spreading along their links
  invasive: true,  // plantations are planted with an invasive exotic pine that escapes into the wild forest
};

const FARMS_PER_TOWN_CELL = 3; // every cell of town needs at least this many cells of farmland

const PER_TOWN_CELL = 120;   // people per paved town cell
const PER_FARM_CELL = 70;    // people one cell of good farmland feeds
const MAX_TOWNS = Infinity; // (no limit: towns spread as far as the land lets them)

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
  if (!world.roadCond || world.roadCond.length !== n) world.roadCond = new Float32Array(n);
  if (!world.irrigated || world.irrigated.length !== n) world.irrigated = new Uint8Array(n);
  if (!world.roadTraffic || world.roadTraffic.length !== n) world.roadTraffic = new Float32Array(n);
  if (!world.roadCore || world.roadCore.length !== n) world.roadCore = new Uint8Array(n);
  // Farm soil: 1 when first cleared (fresh, rich); cropping wears it out; left fallow it recovers
  if (!world.farmSoil || world.farmSoil.length !== n) world.farmSoil = new Float32Array(n).fill(1);
  if (!world.terraform || world.terraform.length !== n) world.terraform = new Int8Array(n); // 1 cut / terraced, 2 reclaimed
  if (!world.bridge || world.bridge.length !== n) world.bridge = new Uint8Array(n);
  if (!world.channel || world.channel.length !== n) world.channel = new Uint8Array(n); // 1 irrigation canal, 2 sewer
}

/**
 * For every spot within reach (~12 cells) of water: the nearest water cell (a river, stream, lake
 * or the sea): where its fields draw irrigation water from and where their runoff ends up.
 * Returns { near: Int32Array (-1 = none), fresh: whether that water is fresh }.
 */
function nearestWater(world) {
  const N = world.N, n = N * N, H = world.height, D = world.water, sea = seaOf(world);
  const near = new Int32Array(n).fill(-1), dist = new Uint8Array(n).fill(255), q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (H[i] < sea || D[i] > 0.05) { near[i] = i; dist[i] = 0; q[tail++] = i; }
  while (head < tail) {
    const c = q[head++], d = dist[c] + 1;
    if (d > 12) continue;
    const x = c % N, z = (c / N) | 0;
    for (const j of [x > 0 ? c - 1 : -1, x < N - 1 ? c + 1 : -1, z > 0 ? c - N : -1, z < N - 1 ? c + N : -1]) {
      if (j < 0 || dist[j] <= d) continue;
      dist[j] = d; near[j] = near[c]; q[tail++] = j;
    }
  }
  return near;
}

/**
 * Protected zones: polygons you draw (Drawings → 🛡 Protect) are kept wild. No town is founded or
 * built there, no farmland cleared, no industry, and roads between towns go around them.
 * world.protectedZone is the rasterised mask (1 = protected).
 */
export function updateProtectedZones(world, shapes) {
  const N = world.N, n = N * N;
  if (!world.protectedZone || world.protectedZone.length !== n) world.protectedZone = new Uint8Array(n);
  if (!world.limitedZone || world.limitedZone.length !== n) world.limitedZone = new Uint8Array(n);
  if (!world.zoneFlags || world.zoneFlags.length !== n) world.zoneFlags = new Uint16Array(n);
  const PZ = world.protectedZone, LZ = world.limitedZone, ZF = world.zoneFlags;
  PZ.fill(0); LZ.fill(0); ZF.fill(0);
  for (const s of shapes || []) {
    const flags = zoneFlagsOf(s);
    if (!flags || !s.closed || !s.points || s.points.length < 3) continue;
    const pts = s.points;
    let x0 = N, x1 = 0, z0 = N, z1 = 0;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    for (let z = Math.max(0, Math.floor(z0)); z <= Math.min(N - 1, Math.ceil(z1)); z++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(N - 1, Math.ceil(x1)); x++) {
        // Point in polygon (ray casting)
        let inside = false;
        for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
          const pa = pts[a], pb = pts[b];
          if ((pa.z > z) !== (pb.z > z) && x < ((pb.x - pa.x) * (z - pa.z)) / (pb.z - pa.z) + pa.x) inside = !inside;
        }
        if (inside) { if (s.protected) PZ[z * N + x] = 1; if (s.limited) LZ[z * N + x] = 1; ZF[z * N + x] |= flags; }
      }
    }
  }
}
const isProtected = (world, i) => world.protectedZone && world.protectedZone[i] === 1;

/**
 * Restrictions a drawn polygon can put on its area (each its own switch in the Drawings list; a
 * protected zone has all those on land). Each is a bit in world.zoneFlags.
 */
export const RESTRICTIONS = [
  { key: 'towns', bit: 1, icon: '🏘', label: 'No new towns', help: 'No towns are founded inside, and towns don\'t spread their streets or industry into it (or build harbours there).' },
  { key: 'fields', bit: 2, icon: '🌾', label: 'No fields', help: 'No land inside is cleared for fields.' },
  { key: 'timber', bit: 4, icon: '🌲', label: 'No timber plantations', help: 'Towns don\'t plant or fell timber inside (your own painted plantations still can be painted).' },
  { key: 'roads', bit: 8, icon: '🛣', label: 'No roads', help: 'Roads between towns, forest tracks and road widening keep out (they go round it, unless there is truly no other way). Footpaths are still allowed.' },
  { key: 'earthworks', bit: 16, icon: '⛏', label: 'No earthworks', help: 'No terracing, quarrying, quays, breakwaters, dams, or spoil dumped there.' },
  { key: 'hunting', bit: 32, icon: '🏹', label: 'No hunting', help: 'Towns don\'t hunt your animals inside.' },
  { key: 'fishing', bit: 64, icon: '🎣', label: 'No fishing', help: 'Boats don\'t fish or trawl the sea inside (a marine reserve).' },
  { key: 'fires', bit: 128, icon: '🔥', label: 'No fires set', help: 'Towns don\'t burn land inside to clear it, and no fires get away from them there (lightning still can).' },
];
const Z = Object.fromEntries(RESTRICTIONS.map((r) => [r.key, r.bit]));
const LIMITED_BIT = 256;
/** The restriction bits a drawn shape puts on its area. */
function zoneFlagsOf(s) {
  let f = 0;
  if (s.protected) f |= Z.towns | Z.fields | Z.timber | Z.roads | Z.earthworks;
  if (s.limited) f |= LIMITED_BIT | Z.fields;
  for (const r of RESTRICTIONS) if (s.restrict && s.restrict[r.key]) f |= r.bit;
  return f;
}
/** Whether cell i lies in an area with restriction `bit`. */
const zoneHas = (world, i, bit) => !!(world.zoneFlags && (world.zoneFlags[i] & bit));
// (a limited-harvest zone: plantations inside are small and cut seldom)
const isLimited = (world, i) => world.limitedZone && world.limitedZone[i] === 1;

/** Which landmass each cell is on (islands and the mainland numbered apart; 0 = sea). */
function landComponents(world) {
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world);
  const comp = new Int32Array(n), q = new Int32Array(n);
  let label = 0;
  for (let s0 = 0; s0 < n; s0++) {
    if (comp[s0] || H[s0] < sea) continue;
    label++;
    let head = 0, tail = 0;
    q[tail++] = s0; comp[s0] = label;
    while (head < tail) {
      const c = q[head++], x = c % N, z = (c / N) | 0;
      if (x > 0 && !comp[c - 1] && H[c - 1] >= sea) { comp[c - 1] = label; q[tail++] = c - 1; }
      if (x < N - 1 && !comp[c + 1] && H[c + 1] >= sea) { comp[c + 1] = label; q[tail++] = c + 1; }
      if (z > 0 && !comp[c - N] && H[c - N] >= sea) { comp[c - N] = label; q[tail++] = c - N; }
      if (z < N - 1 && !comp[c + N] && H[c + N] >= sea) { comp[c + N] = label; q[tail++] = c + N; }
    }
  }
  return comp;
}

/** A coastal town's harbour: a shore cell beside the sea near the town (deeper water preferred). */
function buildHarbor(world, t, R = 10, fresh = false) {
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse;
  let best = -1, bs = -1e9;
  for (let z = Math.max(1, t.z - R); z <= Math.min(N - 2, t.z + R); z++) for (let x = Math.max(1, t.x - R); x <= Math.min(N - 2, t.x + R); x++) {
    const i = z * N + x;
    if (H[i] < sea || world.water[i] > 0.2 || (LU[i] !== 0 && LU[i] !== 1 && LU[i] !== 6) || zoneHas(world, i, Z.towns | Z.earthworks)) continue;
    let depth = 0;
    for (const j of [i - 1, i + 1, i - N, i + N]) {
      if (H[j] < sea) depth = Math.max(depth, sea - H[j]);
      else if (fresh && world.water[j] > 0.5 && !world.channel[j]) depth = Math.max(depth, world.water[j] * 0.8); // (a river or lake landing)
    }
    if (!depth) continue;
    const score = Math.min(4, depth) + (LU[i] === 6 ? 3 : 0) - Math.hypot(x - t.x, z - t.z) * 0.3; // (a quay: deep water at the wall)
    if (score > bs) { bs = score; best = i; }
  }
  if (best >= 0) { pave(world, best, t.num, 5); t.harbor = best; t.harborLake = H[best - 1] >= sea && H[best + 1] >= sea && H[best - N] >= sea && H[best + N] >= sea; }
  return best >= 0;
}

/**
 * Quays: a coastal town armours its shore. The land along the water is raised above high tide and
 * faced with a wall, and the water in front dredged deep: a steep drop-off where the tide can't reach
 * in (no tidal flats, no flooding), and where boats can tie up (harbours are easy to build there).
 * Building it smothers and churns up the sea bed in front (the beds there are destroyed, those
 * nearby damaged, the water clouded with silt and pollution).
 */
function buildQuay(world, t, count) {
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse, OW = world.civOwner;
  const half = 0.5 * coastParams.tideRange;
  const cx = t.harbor !== undefined ? t.harbor % N : t.x, cz = t.harbor !== undefined ? (t.harbor / N) | 0 : t.z;
  const R = 5 + Math.sqrt(t.pop) / 3;
  const cands = [];
  for (let z = Math.max(2, Math.floor(cz - R)); z <= Math.min(N - 3, Math.ceil(cz + R)); z++) {
    for (let x = Math.max(2, Math.floor(cx - R)); x <= Math.min(N - 3, Math.ceil(cx + R)); x++) {
      const i = z * N + x;
      if (LU[i] === 6 || LU[i] === 5 || LU[i] === 3 || LU[i] === 4 || zoneHas(world, i, Z.earthworks)) continue;
      if (H[i] < sea - half || H[i] > sea + half + 2) continue; // (the shore, in reach of the tide)
      let seaward = false, quayNext = false;
      for (const j of [i - 1, i + 1, i - N, i + N]) { if (H[j] < sea) seaward = true; if (LU[j] === 6 || LU[j] === 5) quayNext = true; }
      if (!seaward) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d > R) continue;
      cands.push([(quayNext ? 1 : 0) - d / R + Math.random() * 0.05, i]);
    }
  }
  cands.sort((a, b) => b[0] - a[0]);
  let built = 0;
  for (let k = 0; k < Math.min(count, cands.length); k++) {
    const i = cands[k][1], x = i % N, z = (i / N) | 0;
    // The wall: raised above high tide, paved
    H[i] = Math.max(H[i], sea + half + 1.6); world.prevHeight[i] = H[i];
    pave(world, i, t.num, 6);
    world.water[i] = 0;
    // The water in front dredged deep: a steep drop-off
    for (const j of [i - 1, i + 1, i - N, i + N, i - N - 1, i - N + 1, i + N - 1, i + N + 1]) {
      if (LU[j] || H[j] >= sea + half) continue;
      H[j] = Math.min(H[j], sea - 2.6); world.prevHeight[j] = H[j];
      if (world.marineHealth) world.marineHealth[j] = 0; // (the bed there is gone)
    }
    // …and the sea bed around churned up and smothered, the water clouded
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      const j = (z + dz) * N + x + dx;
      if (j < 0 || j >= N * N || H[j] >= sea) continue;
      const f = 1 - Math.hypot(dx, dz) / 5.7;
      if (f <= 0) continue;
      if (world.marineHealth) world.marineHealth[j] *= 1 - 0.25 * f;
      if (world.silt) world.silt[j] = Math.min(4, world.silt[j] + 0.3 * f);
      if (world.pollution) world.pollution[j] = Math.min(4, world.pollution[j] + 0.06 * f);
    }
    built++;
  }
  t.quay = (t.quay || 0) + built;
  return built;
}

/**
 * Terraforming: a growing town reshapes the land around it. Hillsides and unwanted slopes are
 * excavated into level terrace benches, and knobs that rise above the town are cut down; the spoil
 * is dumped into the shallow sea along its coast, building new flat land above the tide (land
 * reclamation), or, with no sea in reach, tipped into hollows nearby. Dumping smothers the sea bed,
 * clouds the water with silt and pollutes it. The cut and reclaimed ground is flat, buildable land.
 */
function terraform(world, t, cells) {
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world), LU = world.landUse, TF = world.terraform;
  const half = 0.5 * coastParams.tideRange;
  const R = 8 + Math.sqrt(t.pop) / 3;
  const base = H[t.z * N + t.x];
  // Cut: the steepest slopes and highest knobs near the town (not paved or protected)
  const cuts = [];
  for (let z = Math.max(2, Math.floor(t.z - R)); z <= Math.min(N - 3, Math.ceil(t.z + R)); z++) {
    for (let x = Math.max(2, Math.floor(t.x - R)); x <= Math.min(N - 3, Math.ceil(t.x + R)); x++) {
      const i = z * N + x;
      if (H[i] < sea + half + 0.5 || (LU[i] && LU[i] !== 1 && LU[i] !== 3 && LU[i] !== 10) || world.bridge[i] || zoneHas(world, i, Z.earthworks) || world.water[i] > 0.1) continue;
      const d = Math.hypot(x - t.x, z - t.z);
      if (d > R) continue;
      const slope = slopeAt(world, i), rise = H[i] - base;
      if (slope < 0.35 && rise < 5) continue;
      cuts.push([slope + Math.max(0, rise - 5) * 0.15 - d / R * 0.5, i]);
    }
  }
  if (!cuts.length) return 0;
  cuts.sort((a, b) => b[0] - a[0]);
  let spoil = 0;
  for (let k = 0; k < Math.min(cells, cuts.length); k++) {
    const i = cuts[k][1];
    // Down toward the terrace bench below (steps of 1.5), and knobs toward the town's level. Only
    // ground above the town is cut: below it the bench is the step above (toward the town), so a
    // cutting is never dug deeper and deeper (each pass a step lower) into a pit; and a cell that
    // already sits on its bench stays put (the small allowance stops rounding errors from cutting
    // it again)
    const rel = (H[i] - base) / 1.5;
    const bench = (rel >= 0 ? Math.floor(rel + 0.02) : Math.ceil(rel - 0.02)) * 1.5 + base;
    const target = Math.max(sea + half + 1.6, Math.min(bench, base + 5)); // (clear of the waves' reach)
    if (H[i] - target <= 0.02) continue;
    // Cut a level platform (about 5 cells across) at the bench height: the high ground is dug
    // away and the low ground filled up to it, so the terrace is a wide, flat step (its riser, the
    // steep face at its edge, is all that's left of the slope)
    const x = i % N, z = (i / N) | 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dz * dz > 5) continue;
      const xx = x + dx, zz = z + dz;
      if (xx < 1 || zz < 1 || xx > N - 2 || zz > N - 2) continue;
      const j = zz * N + xx;
      // (streets, works, fields, roads and plantations in the way are re-graded with the terrace,
      // never left standing on a pillar)
      if ((LU[j] && LU[j] !== 1 && LU[j] !== 2 && LU[j] !== 3 && LU[j] !== 4 && LU[j] !== 10) || world.bridge[j] || zoneHas(world, j, Z.earthworks) || H[j] < sea + half) continue;
      if (H[j] > target) { const dh = H[j] - target; H[j] -= dh; spoil += dh; }
      else if (H[j] > target - 3) { const fill = target - H[j]; H[j] = target; spoil -= fill; }
      else continue;
      world.prevHeight[j] = H[j];
      TF[j] = 1;
      world.vegetation[j] = Math.min(world.vegetation[j], 0.1); world.forestAge[j] = 0;
    }
  }
  t.terraformed = (t.terraformed || 0) + 1;
  if (spoil <= 0) { world.dirty = true; return 1; }
  dumpSpoil(world, t, spoil, R);
  world.dirty = true;
  return 1;
}

/** Rock dumped into the sea at cell i (amount `put`): smothers the sea bed, clouds and fouls the water. */
function smother(world, i, put) {
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world), x = i % N, z = (i / N) | 0;
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const j = (z + dz) * N + x + dx;
    if (j < 0 || j >= n || H[j] >= sea) continue;
    const f = 1 - Math.hypot(dx, dz) / 4.3;
    if (f <= 0) continue;
    if (world.marineHealth) world.marineHealth[j] *= 1 - 0.2 * f;
    if (world.silt) world.silt[j] = Math.min(4, world.silt[j] + 0.25 * put * f);
    if (world.pollution) world.pollution[j] = Math.min(4, world.pollution[j] + 0.05 * put * f);
  }
}

/**
 * A harbour breakwater (mole): spoil tipped from the harbour straight out into the sea, a causeway
 * about three cells wide built up above high tide and faced as a quay, growing longer with the town.
 * The harbour moves out to its tip, into deeper water. Returns the spoil left over.
 */
function buildMole(world, t, spoil) {
  if (t.harbor === undefined || t.harborLake || spoil <= 0.05) return spoil;
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse;
  const top = sea + 0.5 * coastParams.tideRange + 1;
  const maxLen = 4 + Math.floor(t.pop / 300);
  if ((t.mole || 0) >= maxLen) return spoil;
  // Its heading: from the harbour toward the deepest water nearby
  if (!t.moleDir) {
    let best = null, bd = 0;
    const hx = t.harbor % N, hz = (t.harbor / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      let depth = 0;
      for (let k = 2; k <= 8; k++) {
        const x = hx + dx * k, z = hz + dz * k;
        if (x < 2 || z < 2 || x > N - 3 || z > N - 3) { depth = -1; break; }
        const d = sea - H[z * N + x];
        if (d <= 0) { depth = -1; break; } // (runs back into land)
        depth += d;
      }
      if (depth > bd) { bd = depth; best = [dx, dz]; }
    }
    if (!best) return spoil;
    t.moleDir = best;
  }
  const [dx, dz] = t.moleDir;
  while (spoil > 0.05 && (t.mole || 0) < maxLen) {
    const tip = t.harbor, x = (tip % N) + dx, z = ((tip / N) | 0) + dz;
    if (x < 3 || z < 3 || x > N - 4 || z > N - 4) { t.mole = maxLen; break; }
    const i = z * N + x;
    if (zoneHas(world, i, Z.earthworks) || sea - H[i] > 14) { t.mole = maxLen; break; } // (too deep, or protected)
    // Fill the causeway's cells (the centre line and one either side) up to the top
    const side = dx && dz ? [i - dx, i - dz * N] : dx ? [i - N, i + N] : [i - 1, i + 1];
    let done = true;
    for (const j of [i, ...side]) {
      if (H[j] >= top) continue;
      const put = Math.min(spoil, top - H[j]);
      H[j] += put; world.prevHeight[j] = H[j]; spoil -= put;
      smother(world, j, put);
      if (H[j] < top - 0.01) { done = false; break; }
      world.water[j] = 0; world.vegetation[j] = 0; if (world.humus) world.humus[j] = 0;
      world.terraform[j] = 2;
      if (j !== i) { LU[j] = 6; world.paved[j] = 1; world.civOwner[j] = t.num; }
    }
    if (!done) break;
    // The harbour moves out to the new tip; the old one becomes quay
    LU[tip] = 6;
    world.paved[i] = 1; LU[i] = 5; world.civOwner[i] = t.num;
    t.harbor = i;
    t.mole = (t.mole || 0) + 1;
    t.quay = (t.quay || 0) + 3;
  }
  world.dirty = true;
  return spoil;
}

/**
 * A quarry: a big town picks a hill or mountain near it and cuts it away, a level at a time, until
 * it is down to the town's level (whole mountains go in the end). The rock goes into the harbour's
 * breakwater and to build new land along the coast.
 */
function quarry(world, t) {
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse;
  const base = Math.max(H[t.z * N + t.x], sea + 0.5 * coastParams.tideRange + 1.6); // (the pit floor clear of the waves)
  // (fields, plantations and roads are cut down with the ground around them: the road re-graded,
  // not left standing on a ridge)
  // (streets and works in the way are re-graded too, never left standing on pillars)
  const ok = (j) => (!LU[j] || LU[j] === 1 || LU[j] === 2 || LU[j] === 3 || LU[j] === 4 || LU[j] === 10) && !world.bridge[j] && !zoneHas(world, j, Z.earthworks) && world.water[j] < 0.4;
  // One quarry per town, well out beyond the town and its fields, worked as a single pit: the face
  // moves about inside it, and the pit widens bit by bit (to about 12 cells across) until the hill
  // there is down to the town's level. Only then is a new one opened.
  const pick = () => {
    const sx = t.quarrySite % N, sz = (t.quarrySite / N) | 0, qr = t.quarryR;
    let best = -1, bh = Math.max(base, t.quarryFloorSite === t.quarrySite ? t.quarryFloor : base) + 1.5;
    for (let z = Math.max(2, sz - qr); z <= Math.min(N - 3, sz + qr); z++) for (let x = Math.max(2, sx - qr); x <= Math.min(N - 3, sx + qr); x++) {
      const j = z * N + x;
      if ((x - sx) ** 2 + (z - sz) ** 2 > qr * qr || !ok(j)) continue;
      if (H[j] > bh) { bh = H[j]; best = j; }
    }
    return best;
  };
  let face = -1;
  if (t.quarrySite !== undefined) {
    face = pick();
    while (face < 0 && t.quarryR < 12) { t.quarryR += 2; face = pick(); } // (widen the pit)
    if (face < 0) t.quarrySite = undefined; // (worked out)
  }
  if (t.quarrySite === undefined) {
    const reach = 4 + 2.8 * Math.sqrt(t.pop / PER_FARM_CELL) * Math.max(1, civParams.growth);
    const minD = reach + 10, maxD = minD + 45;
    let best = -1, bs = 0;
    for (let z = Math.max(2, Math.floor(t.z - maxD)); z <= Math.min(N - 3, Math.ceil(t.z + maxD)); z += 2) for (let x = Math.max(2, Math.floor(t.x - maxD)); x <= Math.min(N - 3, Math.ceil(t.x + maxD)); x += 2) {
      const j = z * N + x, d = Math.hypot(x - t.x, z - t.z);
      if (d < minD || d > maxD || !ok(j)) continue;
      const score = H[j] - base - 4 - (d - minD) * 0.08; // (a big hill, not too far to haul from)
      if (score <= bs) continue;
      // (away from any town)
      let nearTown = false;
      for (const u of world.towns) if (Math.hypot(u.x - x, u.z - z) < 8 + Math.sqrt(u.pop) / 4) { nearTown = true; break; }
      if (nearTown) continue;
      bs = score; best = j;
    }
    if (best < 0) return 0;
    t.quarrySite = best; t.quarryR = 4;
    // (a haul road out to it)
    const path = routeRoad(world, t, { x: best % N, z: (best / N) | 0 });
    if (path && path.length > 1) buildRoad(world, path);
    face = pick();
    if (face < 0) return 0;
  }
  t.quarry = face;
  // The pit's floor: no deeper than the lowest ground around it (out past its walls), so it always
  // drains and never becomes a closed basin; and never below the town's level
  if (t.quarryFloor === undefined || t.quarryFloorSite !== t.quarrySite) {
    const sx = t.quarrySite % N, sz = (t.quarrySite / N) | 0, rr = 26;
    let lo = Infinity;
    for (let a = 0; a < 64; a++) {
      const x = Math.round(sx + Math.cos((a / 64) * Math.PI * 2) * rr), z = Math.round(sz + Math.sin((a / 64) * Math.PI * 2) * rr);
      if (x < 1 || z < 1 || x > N - 2 || z > N - 2) continue;
      lo = Math.min(lo, H[z * N + x]);
    }
    t.quarryFloor = Math.max(base + 0.5, Number.isFinite(lo) ? lo : base + 0.5);
    t.quarryFloorSite = t.quarrySite;
  }
  // Cut the top off: everything within the face's reach above the next level down
  const c = t.quarry, cx = c % N, cz = (c / N) | 0;
  const level = Math.max(t.quarryFloor, H[c] - 2.2 * Math.max(0.3, civParams.destruction));
  // (the floor is cut level around the face; beyond it the walls are cut back in benches to a
  // slope of about 50°, never a sheer face for the rain to gully into spikes)
  const r = 5, wall = 1.2, R2 = r + 10;
  let spoil = 0;
  for (let dz = -R2; dz <= R2; dz++) for (let dx = -R2; dx <= R2; dx++) {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > R2) continue;
    const x = cx + dx, z = cz + dz;
    if (x < 2 || z < 2 || x > N - 3 || z > N - 3) continue;
    const j = z * N + x;
    if (d <= r && Math.hypot(x - (t.quarrySite % N), z - ((t.quarrySite / N) | 0)) > t.quarryR + 1) continue; // (the floor stays inside the pit)
    const allowed = level + Math.max(0, d - r) * wall;
    if (!ok(j) || H[j] <= allowed) continue;
    spoil += H[j] - allowed;
    H[j] = allowed; world.prevHeight[j] = allowed;
    world.water[j] = 0;
    if (LU[j] === 3) continue; // (a road: just lowered and re-laid)
    world.terraform[j] = 1;
    world.vegetation[j] = 0; world.forestAge[j] = 0;
    if (world.soil) world.soil[j] *= 0.3;
    if (world.humus) world.humus[j] = 0;
  }
  t.quarried = (t.quarried || 0) + spoil;
  // (quarry dust and runoff foul the streams below)
  if (world.riverPollution) world.riverPollution[c] += 0.02 * spoil;
  if (spoil > 0) dumpSpoil(world, t, spoil, 8 + Math.sqrt(t.pop) / 3);
  world.dirty = true;
  return spoil;
}

/**
 * Get rid of a town's spoil (rock and earth dug from cuttings and quarries): first into its harbour's
 * breakwater, pushing it out to sea; then into the shallow sea along its coast, building new land
 * above the tide (reclamation); and with no sea in reach, into hollows nearby.
 */
function dumpSpoil(world, t, spoil, R) {
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world), LU = world.landUse, TF = world.terraform;
  const half = 0.5 * coastParams.tideRange;
  spoil = buildMole(world, t, spoil);
  // Then into the shallow sea along the coast nearby (building new land), else into hollows
  const dumps = [];
  for (let z = Math.max(2, Math.floor(t.z - R - 8)); z <= Math.min(N - 3, Math.ceil(t.z + R + 8)); z++) {
    for (let x = Math.max(2, Math.floor(t.x - R - 8)); x <= Math.min(N - 3, Math.ceil(t.x + R + 8)); x++) {
      const i = z * N + x;
      if (H[i] >= sea + half + 1.6 || sea - H[i] > 5 || zoneHas(world, i, Z.earthworks)) continue;
      let shoreNext = false;
      for (const j of [i - 1, i + 1, i - N, i + N]) if (H[j] >= sea + half) shoreNext = true;
      if (!shoreNext) continue; // (built out from the shore)
      dumps.push([-Math.hypot(x - t.x, z - t.z) - (sea - H[i]) * 0.5, i]);
    }
  }
  dumps.sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < dumps.length && spoil > 0.01; k++) {
    const i = dumps[k][1], x = i % N, z = (i / N) | 0;
    const need = sea + half + 1.6 - H[i], put = Math.min(spoil, need, 1.2);
    H[i] += put; world.prevHeight[i] = H[i]; spoil -= put;
    if (H[i] >= sea + half + 1.55) { TF[i] = 2; world.water[i] = 0; world.vegetation[i] = 0; if (world.humus) world.humus[i] = 0; }
    smother(world, i, put); // (the dumped rock and soil smother the sea bed, cloud and foul the water)
  }
  // (no sea to take it: into the hollows near town)
  for (let k = 0; spoil > 0.01 && k < 200; k++) {
    const x = Math.round(t.x + (Math.random() - 0.5) * 2 * R), z = Math.round(t.z + (Math.random() - 0.5) * 2 * R);
    if (x < 2 || z < 2 || x > N - 3 || z > N - 3) continue;
    const i = z * N + x;
    if (LU[i] || H[i] < sea || zoneHas(world, i, Z.earthworks)) continue;
    const avg = (H[i - 1] + H[i + 1] + H[i - N] + H[i + N]) * 0.25;
    if (avg - H[i] < 0.2) continue;
    const put = Math.min(spoil, avg - H[i]);
    H[i] += put; world.prevHeight[i] = H[i]; spoil -= put; TF[i] = 1;
  }
  world.dirty = true;
}

/**
 * A dam: a town past ~700 people walls off a river valley near it (a concrete wall across the
 * valley, its crest about 4 above the river), and a reservoir fills behind it: a water supply for
 * the town. The dam blocks fish swimming upriver, traps the river's sediment, and its building and
 * works pollute the river.
 */
function buildDam(world, t) {
  const N = world.N, H = world.height, D = world.water, sea = seaOf(world), LU = world.landUse;
  let best = -1, bs = -1e9;
  for (let z = Math.max(8, t.z - 25); z <= Math.min(N - 9, t.z + 25); z++) for (let x = Math.max(8, t.x - 25); x <= Math.min(N - 9, t.x + 25); x++) {
    const i = z * N + x;
    if (D[i] < 0.05 || H[i] < sea + 3 || LU[i] || zoneHas(world, i, Z.earthworks)) continue;
    const vx = world.velX[i], vz = world.velZ[i], sp = Math.hypot(vx, vz);
    if (sp < 0.05) continue;
    // A narrow valley: the ground rises steeply on both sides across the flow
    const px = -vz / sp, pz = vx / sp;
    let sides = 0;
    for (const sgn of [-1, 1]) {
      for (let k = 2; k <= 7; k++) {
        const j = Math.round(z + pz * k * sgn) * N + Math.round(x + px * k * sgn);
        if (H[j] - H[i] > 4) { sides++; break; }
      }
    }
    if (sides < 2) continue;
    const score = sp * 2 - Math.hypot(x - t.x, z - t.z) * 0.05;
    if (score > bs) { bs = score; best = i; }
  }
  if (best < 0) return false;
  const x = best % N, z = (best / N) | 0, sp = Math.hypot(world.velX[best], world.velZ[best]);
  const px = -world.velZ[best] / sp, pz = world.velX[best] / sp;
  const crest = H[best] + 4;
  for (let k = -8; k <= 8; k++) {
    const j = Math.round(z + pz * k) * N + Math.round(x + px * k);
    if (H[j] >= crest) continue; // (the valley side: the wall ends)
    for (const jj of [j, j + 1, j + N]) {
      if (H[jj] >= crest) continue;
      H[jj] = crest; world.prevHeight[jj] = crest; world.water[jj] = 0;
      LU[jj] = 7; world.paved[jj] = 1; world.civOwner[jj] = t.num; world.vegetation[jj] = 0;
      if (world.dam) world.dam[jj] = 2; // (fish can't get past)
    }
  }
  // The work muddies and fouls the river below
  for (let k = 0; k < 40; k++) world.riverPollution[best] += 0.05;
  t.dam = best;
  world.dirty = true;
  return true;
}

/**
 * Dig a channel along `path` (grid points from its head to its end), sloping gently down from
 * `startLevel`: an irrigation canal (kind 1) carrying water from a river or lake out to the fields,
 * or a sewer (kind 2) carrying the town's waste down to a river or the sea. The trench is cut
 * through any higher ground on the way.
 */
function digChannel(world, path, startLevel, kind, owner) {
  const N = world.N, H = world.height, sea = seaOf(world), cells = [];
  let level = startLevel;
  let last = -1;
  for (const p of path) {
    const i = Math.round(p.z) * N + Math.round(p.x);
    if (i === last) continue;
    last = i;
    level -= 0.04;
    const lu = world.landUse[i];
    // (canals cross open land and fields; sewers also run under the town's streets and works)
    if (H[i] < sea || (lu && lu !== 1 && lu !== 8 && lu !== 9 && !(kind === 2 && (lu === 2 || lu === 4)))) continue;
    if (lu === 2 || lu === 4) world.paved[i] = 0;
    const bed = Math.min(H[i] - 0.3, level);
    if (bed < sea) break;
    H[i] = bed; world.prevHeight[i] = bed;
    world.channel[i] = kind;
    world.landUse[i] = kind === 1 ? 8 : 9;
    world.civOwner[i] = owner;
    world.vegetation[i] = 0;
    cells.push(i);
  }
  world.dirty = true;
  return cells;
}

/** A straight-ish route from a to b as grid points (one per cell). */
function linePath(a, b) {
  const pts = [], len = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
  for (let k = 0; k <= len; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / len, z: a.z + ((b.z - a.z) * k) / len });
  return pts;
}

/**
 * Irrigation canal: from the river or lake nearest the town's dry fields, out to the middle of them.
 * (Once it carries water, the fields along it can be irrigated.)
 */
function digCanal(world, t, NW) {
  const N = world.N, LU = world.landUse, OW = world.civOwner, H = world.height, sea = seaOf(world);
  let sx = 0, sz = 0, c = 0;
  for (let z = Math.max(0, t.z - 45); z <= Math.min(N - 1, t.z + 45); z++) for (let x = Math.max(0, t.x - 45); x <= Math.min(N - 1, t.x + 45); x++) {
    const i = z * N + x;
    if (LU[i] === 1 && OW[i] === t.num && !world.irrigated[i]) { sx += x; sz += z; c++; }
  }
  if (c < 6) return false;
  const fx = sx / c, fz = sz / c;
  // The nearest fresh water to the dry fields (within 30 cells)
  let src = -1, bd = 30;
  for (let z = Math.max(0, Math.round(fz) - 30); z <= Math.min(N - 1, Math.round(fz) + 30); z++) for (let x = Math.max(0, Math.round(fx) - 30); x <= Math.min(N - 1, Math.round(fx) + 30); x++) {
    const i = z * N + x;
    if (H[i] < sea || world.water[i] < 0.08 || world.channel[i]) continue;
    const d = Math.hypot(x - fx, z - fz);
    if (d < bd && d > 3) { bd = d; src = i; }
  }
  if (src < 0) return false;
  digChannel(world, linePath({ x: src % N, z: (src / N) | 0 }, { x: fx, z: fz }), H[src] + world.water[src] - 0.1, 1, t.num);
  t.canals = (t.canals || 0) + 1;
  return true;
}

/** The nearest open-sea cell to (x, z) anywhere on the map, or -1 if there is no sea. */
function nearestSea(world, x, z) {
  const N = world.N, H = world.height, sea = seaOf(world);
  let best = -1, bd = Infinity;
  for (let zz = 1; zz < N - 1; zz++) for (let xx = 1; xx < N - 1; xx++) {
    const i = zz * N + xx;
    if (H[i] >= sea - 0.3) continue;
    const d = (xx - x) * (xx - x) + (zz - z) * (zz - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** How well a cell would grow trees (0 unsuitable): its forest now, or a climate, soil and water for one. */
function forestSuitability(world, i) {
  const T = world.temperature[i], soil = world.soil ? world.soil[i] : 0.5, wet = world.precip ? world.precip[i] : 0.5;
  if (T < 0 || T > 29 || (world.snow && world.snow[i] > 0.5) || (world.ice && world.ice[i] > 0.05)) return 0;
  if (slopeAt(world, i) > 1) return 0;
  const climate = Math.min(1, Math.max(0, (T - 0) / 6)) * Math.min(1, Math.max(0, (30 - T) / 5)) * Math.min(1, Math.max(0, (wet - 0.2) * 2.5)) * Math.min(1, soil * 1.8);
  return Math.max(world.vegetation[i] > 0.62 ? 0.7 + 0.3 * world.vegetation[i] : 0, climate);
}

/**
 * Timber plantations: a town keeps about twice as much land under timber as under fields, on land
 * where forest grows: blocks of woodland it lets grow to full forest, clear-fells for wood when the
 * trees are grown (a stand at a time), and replants to grow again. A road runs from the town centre
 * out to each plantation.
 */
function timberStep(world, t, farmCells, R) {
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse, OW = world.civOwner;
  const V = world.vegetation, TD = world.treeDensity;
  if (!t.plantations) t.plantations = [];
  // Tend, and clear-fell: once most of a plantation's trees are grown, the whole plantation is cut
  // at once, and the natural forest next to it is felled with it (taken into the plantation, to be
  // replanted with it)
  const FS = world.farmSoil;
  const N2 = N * N, fell = (i) => {
    V[i] = world.plantedField && world.plantedField[i] ? 0.3 : 0.2; if (TD) TD[i] *= 0.08; world.forestAge[i] = 0; // (felled, and replanted with saplings at once)
    if (world.soil) world.soil[i] *= 0.92; // (the bare ground washing a little soil away)
    FS[i] = Math.max(0, FS[i] - 0.18); // (each crop of timber takes nutrients out with it)
    if (world.humus) world.humus[i] *= 0.7; // (and the clear-fell strips the soil: hauled, rutted, washed off)
  };
  const HU = world.humus;
  let cells = 0, cut = 0;
  const ready = [];
  if (t.fellRest > 0) t.fellRest--;
  if (!world.timberRest || world.timberRest.length !== N2) world.timberRest = new Uint8Array(N2);
  const REST = world.timberRest;
  for (const pl of t.plantations) {
    let alive = 0, grown = 0;
    // A painted plantation resting (its soil worn out): left alone, neither tended nor felled, the
    // trees growing back wild and the soil slowly recovering, until the town takes it up again
    if (pl.resting) {
      let soil = 0, depth = 0;
      for (const i of pl.cells) {
        if (LU[i] !== 10 || OW[i] !== t.num) continue;
        alive++;
        REST[i] = 1;
        FS[i] = Math.min(1, FS[i] + 0.0025);
        if (HU) HU[i] = Math.min(1, HU[i] + 0.002 * (1 - HU[i]) * (0.3 + V[i]));
        soil += FS[i]; depth += HU ? HU[i] : 1;
      }
      pl.soil = alive ? soil / alive : 0; pl.depth = alive ? depth / alive : 0;
      pl.alive = alive; cells += alive;
      continue;
    }
    // (a town-made plot far bigger than the plot size, e.g. one that took in a whole forest, is cut
    // back to the plot nearest its centre; the rest goes back to the wild)
    const plLimited = isLimited(world, Math.max(0, Math.min(N - 1, pl.z)) * N + Math.max(0, Math.min(N - 1, pl.x)));
    pl.limited = plLimited;
    if (pl.cool > 0) pl.cool--;
    const plotCap = plLimited ? Math.max(10, Math.round(civParams.plotSize * 0.25)) : civParams.plotSize;
    if (!pl.painted && pl.cells.length > plotCap * 1.5) {
      const keep = pl.cells.filter((i) => LU[i] === 10 && OW[i] === t.num)
        .sort((a, b) => Math.hypot((a % N) - pl.x, ((a / N) | 0) - pl.z) - Math.hypot((b % N) - pl.x, ((b / N) | 0) - pl.z));
      for (const i of keep.slice(plotCap)) { LU[i] = 0; OW[i] = 0; REST[i] = 0; }
      pl.cells = keep.slice(0, plotCap);
    }
    for (const i of pl.cells) {
      if (LU[i] !== 10 || OW[i] !== t.num) continue;
      alive++;
      REST[i] = 0;
      if (V[i] > 0.82) grown++;
      else { const g = (0.3 + 0.7 * FS[i]) * (HU ? 0.35 + 0.65 * Math.min(1, HU[i] * 2.5) : 1) * (world.plantedField && world.plantedField[i] ? 3 : 1) /* (old fields, planted out: three times as fast) */; V[i] = Math.min(0.88, V[i] + 0.015 * g); if (TD) TD[i] = Math.min(1, TD[i] + 0.012 * g); } // (replanted fast-growing stock, tended: slower on worn soil)
    }
    // (ready to fell once its trees have grown back almost all over; the town picks which below)
    if (!pl.id) pl.id = Math.random().toString(36).slice(2, 8);
    // (in a limited-harvest zone: only when it has grown back fully, and long after the last cut)
    const noTimber = !pl.painted && zoneHas(world, Math.max(0, Math.min(N - 1, pl.z)) * N + Math.max(0, Math.min(N - 1, pl.x)), Z.timber);
    if (alive && grown >= (pl.limited ? 0.95 : 0.8) * alive && !(pl.cool > 0) && !noTimber) ready.push(pl);
    // Worn out: once a plantation's soil is exhausted it is abandoned to recover (left to the wild,
    // its soil slowly coming back), and a new plantation is started on fresh land elsewhere
    if (alive) {
      let soil = 0, depth = 0;
      for (const i of pl.cells) if (LU[i] === 10 && OW[i] === t.num) { soil += FS[i]; depth += HU ? HU[i] : 1; }
      pl.soil = soil / alive;
      pl.depth = depth / alive;
      // (worn out: its nutrients gone, or its soil stripped too thin to grow another crop)
      // (a plantation you painted is kept for good: felled and replanted, regrowing more slowly as its
      // soil wears, but never given up)
      if ((pl.soil < 0.3 || pl.depth < 0.1) && (pl.felled || 0) >= 1) { // (after at least one crop)
        if (pl.painted) { pl.resting = true; pl.felled = 0; } // (a painted one is rested, not given up)
        else {
          for (const i of pl.cells) if (LU[i] === 10 && OW[i] === t.num) { LU[i] = 0; OW[i] = 0; }
          t.platsRetired = (t.platsRetired || 0) + 1;
          alive = 0;
        }
      }
    }
    pl.alive = alive;
    cells += alive;
  }
  // Felling, one plot at a time in rotation: the town cuts one plot, then waits, and the next plot it
  // cuts is a different one (never the same plot twice running while it has another), the one that
  // has gone longest since it was last felled. The others grow back meanwhile.
  const working = t.plantations.filter((pl) => !pl.resting && pl.alive > 0);
  if (ready.length && (t.fellRest || 0) <= 0) {
    const choices = working.length > 1 ? ready.filter((pl) => pl.id !== t.lastPlot) : ready;
    let pl = null;
    for (const c of choices) if (!pl || (c.lastFell ?? -1) < (pl.lastFell ?? -1)) pl = c;
    if (pl) {
      t.fellCount = (t.fellCount || 0) + 1;
      pl.lastFell = t.fellCount;
      t.lastPlot = pl.id;
      t.fellRest = Math.max(8, Math.round(30 / Math.max(1, working.length)));
      const live = pl.cells.filter((i) => LU[i] === 10 && OW[i] === t.num);
      for (const i of live) fell(i);
      cut += live.length;
      // (and the forest around it, all of it that joins on)
      // (no bigger than the plot size, or than you painted it)
      const capF = pl.limited ? Math.max(Math.round(civParams.plotSize * 0.25), pl.painted ? live.length : 0) : Math.max(civParams.plotSize, pl.painted ? live.length : 0);
      if (pl.limited) pl.cool = 90; // (left a long while before it may be cut again)
      const seen = new Uint8Array(N2), q = [];
      for (const i of live) seen[i] = 1;
      for (const i of live) for (const k of [i - 1, i + 1, i - N, i + N]) if (k >= 0 && k < N2 && !seen[k]) { seen[k] = 1; q.push(k); }
      for (let h = 0; h < q.length && pl.alive < capF; h++) {
        const j = q[h], x = j % N, z = (j / N) | 0;
        if (x < 2 || z < 2 || x > N - 3 || z > N - 3) continue;
        if (LU[j] || V[j] <= 0.6 || FS[j] < 0.5 || (HU && HU[j] < 0.15) || H[j] < sea + 0.5 || world.water[j] > 0.1 || zoneHas(world, j, Z.timber)) continue;
        fell(j); LU[j] = 10; OW[j] = t.num; pl.cells.push(j); cut++; pl.alive++; cells++;
        for (const k of [j - 1, j + 1, j - N, j + N]) if (!seen[k]) { seen[k] = 1; q.push(k); }
      }
      pl.felled = (pl.felled || 0) + 1;
      world.dirty = true;
    }
  }
  t.plantations = t.plantations.filter((pl) => pl.alive > 0);
  // Rotation among the painted plantations: while none is being worked, the rested one whose soil
  // has come back best (nutrients 60%, some depth of soil) is taken up again
  const painted = t.plantations.filter((pl) => pl.painted);
  if (painted.length && !painted.some((pl) => !pl.resting)) {
    let best = null;
    for (const pl of painted) if (pl.soil >= 0.6 && pl.depth >= 0.2 && (!best || pl.soil + pl.depth > best.soil + best.depth)) best = pl;
    if (best) { best.resting = false; for (const i of best.cells) REST[i] = 0; world.dirty = true; }
  }
  t.timberCells = cells;
  t.timberCut = (t.timberCut || 0) * 0.9 + cut;
  // New plantations: about twice the land of its fields. Every village must have one: a village
  // without one looks twice as far afield, and failing that turns some of its own fields over to
  // timber
  // A town keeps 2 to 4 plots to rotate among: it always starts a second one, and goes on to up to
  // four while its timber land is under twice its farmland (with Extra plantations on, without limit)
  const plots = t.plantations.filter((pl) => !pl.resting).length;
  const need = (plots === 0 && t.pop >= 20) || (plots < 2 && t.pop >= 60);
  const more = civParams.extraPlantations;
  if (!need && ((!more && (cells >= 2 * farmCells || plots >= 4)) || t.pop < (more ? 20 : 80) || Math.random() > 0.5 * civParams.growth)) return;
  const reach = R * (need ? 6 : 3);
  let best = null, bs = need ? 0.12 : 0.25;
  for (let k = 0; k < (need ? 90 : 60); k++) {
    const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * reach;
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 5 || z < 5 || x > N - 6 || z > N - 6) continue;
    let s = 0, c = 0;
    for (let dz = -4; dz <= 4; dz += 2) for (let dx = -4; dx <= 4; dx += 2) {
      const j = (z + dz) * N + x + dx;
      if (LU[j] || H[j] < sea + 0.5 || world.water[j] > 0.1 || zoneHas(world, j, Z.timber)) continue;
      if (FS[j] < 0.6 || (HU && HU[j] < 0.08)) continue; // (worn-out or thin-soiled ground isn't planted again until its soil has recovered)
      s += forestSuitability(world, j); c++;
    }
    const score = s / 25 - d / (reach * 4) + (V[z * N + x] > 0.6 ? 0.3 : 0); // (an existing forest first)
    if (c > 12 && score > bs) { bs = score; best = { x, z }; }
  }
  if (!best && need && plots === 0) { convertFieldsToTimber(world, t); return; } // (only for a village with none at all)
  if (!best) return;
  // The plantation takes in the whole forest there: every connected forest cell, however big the
  // forest (or, on open ground suitable for trees, a block planted around the site)
  const claimed = [], c0 = best.z * N + best.x;
  const free = (j) => !LU[j] && H[j] >= sea + 0.5 && world.water[j] < 0.1 && !zoneHas(world, j, Z.timber) && FS[j] >= 0.5 && (!HU || HU[j] >= 0.06);
  if (V[c0] > 0.6 && free(c0)) {
    // (a compact block of the forest there, grown out from the site to the plot size)
    const seen = new Uint8Array(N * N), q = [c0], cap = Math.max(10, isLimited(world, c0) ? civParams.plotSize * 0.25 : civParams.plotSize);
    seen[c0] = 1;
    for (let h = 0; h < q.length && claimed.length < cap; h++) {
      const j = q[h], x = j % N, z = (j / N) | 0;
      if (x < 2 || z < 2 || x > N - 3 || z > N - 3) continue;
      LU[j] = 10; OW[j] = t.num; claimed.push(j);
      for (const k of [j - 1, j + 1, j - N, j + N]) if (!seen[k]) { seen[k] = 1; if (V[k] > 0.6 && free(k)) q.push(k); }
    }
  } else {
    const r = Math.max(2, Math.round(Math.sqrt(Math.max(10, isLimited(world, c0) ? civParams.plotSize * 0.25 : civParams.plotSize) / Math.PI)));
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r + 1) continue;
      const x = best.x + dx, z = best.z + dz;
      if (x < 2 || z < 2 || x > N - 3 || z > N - 3) continue;
      const j = z * N + x;
      if (!free(j) || FS[j] < 0.6 || forestSuitability(world, j) < 0.3) continue;
      LU[j] = 10; OW[j] = t.num;
      if (V[j] < 0.35) V[j] = 0.35; // (planted with saplings)
      claimed.push(j);
    }
  }
  if (!claimed.length) return;
  t.plantations.push({ x: best.x, z: best.z, cells: claimed, alive: claimed.length });
  // (a timber road from the town centre out to it)
  const path = routeRoad(world, t, best);
  if (path && path.length > 1) buildRoad(world, path);
  world.dirty = true;
}

/**
 * A village with nowhere to plant timber turns a block of its own fields over to it: the fields
 * that would grow trees best, planted with saplings (the village farms elsewhere, or less).
 */
function convertFieldsToTimber(world, t) {
  const N = world.N, LU = world.landUse, OW = world.civOwner, V = world.vegetation;
  let best = -1, bs = -1;
  const R = 4 + 2.8 * Math.sqrt(t.pop / PER_FARM_CELL) * Math.max(1, civParams.growth);
  for (let z = Math.max(3, Math.floor(t.z - R * 2)); z <= Math.min(N - 4, Math.ceil(t.z + R * 2)); z++) for (let x = Math.max(3, Math.floor(t.x - R * 2)); x <= Math.min(N - 4, Math.ceil(t.x + R * 2)); x++) {
    const i = z * N + x;
    if (LU[i] !== 1 || OW[i] !== t.num) continue;
    const sc = forestSuitability(world, i) + 0.002 * Math.hypot(x - t.x, z - t.z); // (the outer fields first)
    if (sc > bs) { bs = sc; best = i; }
  }
  if (best < 0) return false; // (even in dry country: a watered, tended woodlot)
  const bx = best % N, bz = (best / N) | 0, r = 4, claimed = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dz * dz > r * r + 1) continue;
    const j = (bz + dz) * N + bx + dx;
    const ownField = LU[j] === 1 && OW[j] === t.num;
    if (!ownField && (LU[j] || zoneHas(world, j, Z.timber) || world.water[j] > 0.1 || world.height[j] < seaOf(world) + 0.5)) continue;
    LU[j] = 10; OW[j] = t.num; world.irrigated[j] = 0;
    if (V[j] < 0.35) V[j] = 0.35; // (planted with saplings)
    if (ownField) { if (!world.plantedField) world.plantedField = new Uint8Array(N * N); world.plantedField[j] = 1; } // (ploughed field: planted out with nursery stock)
    claimed.push(j);
  }
  if (!claimed.length) return false;
  t.plantations.push({ x: bx, z: bz, cells: claimed, alive: claimed.length, fromFields: true });
  world.dirty = true;
  return true;
}

/**
 * Fires set by people: farmers burn forest to clear it for fields (slash and burn), and fires get
 * away from towns by accident, far more often in a dry season. Either can escape into a wildfire.
 */
function manMadeFires(world, t, newFarms) {
  const N = world.N, V = world.vegetation;
  const dry = drySeason();
  // Clearing by fire: some of the forest turned into fields is burnt off first
  for (const i of newFarms) if (Math.random() < 0.3 * civParams.destruction && world.fire[i] <= 0 && !zoneHas(world, i, Z.fires)) world.fire[i] = 0.7;
  // Accidents: a stray spark at the town's edge, more people, more risk, worst when it's dry
  if (Math.random() < 0.0015 * Math.min(4, t.pop / 300) * (0.25 + 3 * dry)) {
    const R = 6 + Math.sqrt(t.pop) / 3, a = Math.random() * Math.PI * 2;
    const x = Math.round(t.x + Math.cos(a) * R), z = Math.round(t.z + Math.sin(a) * R);
    if (x > 1 && z > 1 && x < N - 2 && z < N - 2) {
      const i = z * N + x;
      if (V[i] > 0.4 && world.water[i] < 0.05 && !(world.snow && world.snow[i] > 0.2) && !zoneHas(world, i, Z.fires)) { world.fire[i] = 0.8; t.lastFire = seasonParams.year || 1; }
    }
  }
}

/**
 * The fleet at work: the boats fish the sea around the harbour, catching whatever lives under the
 * water (your sea animals among it), trawling the sea bed (seagrass, kelp and coral are torn up),
 * and fouling the water a little. Returns the food landed. An overfished, wrecked sea yields less.
 */
function fishing(world, t) {
  const N = world.N, H = world.height, sea = seaOf(world), boats = t.boats;
  const hx = t.harbor % N, hz = (t.harbor / N) | 0, FR = 10 + 3 * Math.sqrt(boats);
  t.fishRange = FR;
  let prod = 0, cells = 0, caught = 0;
  const seaAnimals = (world.animals || []).filter((a) => a.habitat === 'sea' || a.habitat === 'coast' || a.habits.runsRivers);
  for (let z = Math.max(0, Math.floor(hz - FR)); z <= Math.min(N - 1, Math.ceil(hz + FR)); z++) {
    for (let x = Math.max(0, Math.floor(hx - FR)); x <= Math.min(N - 1, Math.ceil(hx + FR)); x++) {
      const i = z * N + x;
      if (H[i] >= sea || zoneHas(world, i, Z.fishing)) continue; // (not in a marine reserve)
      const d = Math.hypot(x - hx, z - hz);
      if (d > FR) continue;
      const e = boats * 0.0035 * (1 - d / FR) / Math.max(1, FR / 10); // (fishing effort here)
      const m = world.marine ? world.marine[i] : -1, hl = world.marineHealth ? world.marineHealth[i] : 1;
      // The catch depends on a living sea: healthy beds, oxygen, clean water
      prod += (0.35 + 0.65 * (isLivingBed(m) ? hl : 0.5)) * (world.oxygen ? world.oxygen[i] : 1) * (1 - Math.min(0.6, (world.pollution ? world.pollution[i] : 0) * 0.3));
      cells++;
      // (trawling: deep coral reefs, slow to grow and brittle, are wrecked fastest)
      if (isLivingBed(m) && world.marineHealth) world.marineHealth[i] = Math.max(0, hl - 0.25 * e * (m === MARINE_ID.deepcoral ? 3 : 1));
      if (world.pollution) world.pollution[i] = Math.min(4, world.pollution[i] + 0.04 * e);       // (fuel, bilge, waste)
      for (const a of seaAnimals) {
        const F = world['animal_' + a.id];
        if (!F || F[i] <= 0) continue;
        const take = F[i] * Math.min(0.25, 3 * e);
        F[i] -= take; caught += take;
      }
    }
  }
  t.catch = caught;
  return boats * 40 * (cells ? prod / cells : 0) + caught * 1500;
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
  if (H[i] < sea + 1 || world.water[i] > 0.1 || (world.lava && world.lava[i] > 0) || (world.ice && world.ice[i] > 0.05) || zoneHas(world, i, Z.towns)) return 0;
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
  if (world.channel && world.channel[i]) { // (canals and sewers aren't paved over: a road bridges them)
    if (use === 3) { world.landUse[i] = 3; world.bridge[i] = 1; world.paved[i] = 1; world.roadCond[i] = 1; }
    return;
  }
  if (x > 0 && z > 0 && x < N - 1 && z < N - 1 && world.paved[i] < 0.5) {
    const avg = (H[i - 1] + H[i + 1] + H[i - N] + H[i + N]) * 0.25;
    H[i] += (avg - H[i]) * 0.6;
    world.prevHeight[i] = H[i];
  }
  world.paved[i] = 1;
  world.landUse[i] = use;
  if (use === 3) world.roadCond[i] = 1;
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
    if (H[i] < sea || world.water[i] > 0.4 || world.channel[i]) { world.landUse[i] = 3; world.roadCond[i] = 1; world.roadCore[i] = 1; world.bridge[i] = 1; world.paved[i] = 1; continue; } // (a bridge)
    const target = Math.max(smooth[k], sea + 0.6);
    // Terrace: the road bed and its shoulders follow the grade
    for (const j of [i, i - 1, i + 1, i - N, i + N]) {
      if (H[j] < sea || world.channel[j]) continue; // (and over a canal or sewer, a bridge)
      const w = j === i ? 1 : 0.5;
      H[j] += (target - H[j]) * w;
      world.prevHeight[j] = H[j];
    }
    pave(world, i, 0, 3);
    world.roadCore[i] = 1; // (the road's centre line: lanes are added beside it)
  }
  world.dirty = true;
  return cells.length;
}

/** One civilization step (a couple of times a second). */
export function civStep(world) {
  // (footpaths stay trodden: plants don't close over them, though nothing maintains them)
  if (world.footpaths && world.footpaths.length) markFootpaths(world);
  if (!civParams.enabled) return;
  ensureCiv(world);
  const towns = world.towns;
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world);
  const P = world.paved, LU = world.landUse, OW = world.civOwner, RP = world.riverPollution;
  // --- Pollution: light near pavement, heavy downstream (always) ---------------------------
  for (let i = 0; i < n; i++) if (RP[i] > 0) RP[i] = RP[i] < 1e-3 ? 0 : RP[i] * 0.85;
  let anyPaved = false;
  // Sewage: every town, however small, pipes its streets' and works' waste straight out
  // to the nearest open sea, where it all pours out at one spot (the outfall)
  const outfallOf = {}, seaLoad = {};
  for (const t of towns) {
    if (t.seaOutfall === undefined || !(H[t.seaOutfall] < sea)) t.seaOutfall = nearestSea(world, t.x, t.z);
    if (t.seaOutfall >= 0) outfallOf[t.num] = t.seaOutfall;
  }
  // (old sewer channels, from before: filled in and built over)
  for (let i = 0; i < n; i++) if (world.channel[i] === 2) {
    world.channel[i] = 0;
    const x = i % N, z = (i / N) | 0;
    if (x > 0 && z > 0 && x < N - 1 && z < N - 1) { const avg = (H[i - 1] + H[i + 1] + H[i - N] + H[i + N]) * 0.25; if (H[i] < avg) { H[i] = avg; world.prevHeight[i] = avg; } }
    if (LU[i] === 9) { if (OW[i]) { LU[i] = 2; P[i] = 1; } else LU[i] = 0; }
  }
  // (a working canal is kept running from the river it taps: sluices let water in as it soaks away)
  for (let i = 0; i < n; i++) if (world.channel[i] === 1 && OW[i] && world.water[i] < 0.05) world.water[i] = 0.05;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (P[i] < 0.5) continue;
      anyPaved = true;
      // Light: into water right next to it
      // (industry: on a vastly larger scale, straight into the water beside it and down the drains)
      const ind = (LU[i] === 4 ? 12 : LU[i] === 6 ? 3 : 1) * civParams.destruction;
      // (a bridge drips its road runoff, oil and grit straight into the water under it)
      if (world.bridge[i]) { if (H[i] < sea) { if (world.pollution) world.pollution[i] = Math.min(4, world.pollution[i] + 0.004); } else RP[i] += 0.01; }
      // (and a dam's works leach into the river)
      if (LU[i] === 7) for (const j of [i - 1, i + 1, i - N, i + N]) if (world.water[j] > 0.05) RP[j] += 0.006;
      // (a working quay keeps fouling the water at its foot and wearing the beds there down)
      if (LU[i] === 6) for (const j of [i - 1, i + 1, i - N, i + N]) if (H[j] < sea && world.marineHealth) world.marineHealth[j] = Math.max(0, world.marineHealth[j] - 0.002);
      for (const j of [i - 1, i + 1, i - N, i + N]) {
        if (H[j] < sea) { if (world.pollution) world.pollution[j] = Math.min(4, world.pollution[j] + 0.006 * ind); }
        else if (world.water[j] > 0.05 && !(OW[i] && outfallOf[OW[i]] !== undefined)) RP[j] += 0.006 * ind; // (a sewered town's drains carry it off to sea)
      }
      // Heavy: down the drainage to the rivers and on to the sea (or, where the town has dug a
      // sewer, all of it out through the sewer's outfall)
      // (roads are not drained into sewers, but shed much less than streets and works)
      const load = 0.018 * (LU[i] === 4 ? 6 : 1) * (LU[i] === 3 ? 0.3 : 1) * civParams.destruction;
      if (OW[i] && outfallOf[OW[i]] !== undefined) { seaLoad[OW[i]] = (seaLoad[OW[i]] || 0) + load; continue; } // (down the sewers, out to sea)
      if (LU[i] === 3) continue; // (a road's runoff stays by the road: no foul stream down the valley)
      let c = i;
      for (let k = 0; k < 160; k++) {
        if (H[c] < sea) { if (world.pollution) world.pollution[c] = Math.min(4, world.pollution[c] + load * 1.6); break; }
        if (world.water[c] > 0.1) RP[c] += load; // (only real streams: a damp patch isn't a river)
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
  // Each town's sewage pours into the sea at its outfall and spreads from there
  if (world.pollution) for (const num in seaLoad) {
    const c = outfallOf[num], load = seaLoad[num];
    for (const j of [c, c - 1, c + 1, c - N, c + N]) if (j >= 0 && j < n && H[j] < sea) world.pollution[j] = Math.min(4, world.pollution[j] + load * (j === c ? 0.8 : 0.3));
  }
  // Upkeep of the ground: a kept cell left standing as a spike (its surroundings worn or dug away)
  // is levelled down to the ground around it, and a hole in the middle of kept ground is filled
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = z * N + x;
    // (kept ground, and the leftovers of cuttings and quarries: dug ground or right next to it)
    const TF = world.terraform;
    if (!(world.builtUp(i) || TF[i] || TF[i - 1] || TF[i + 1] || TF[i - N] || TF[i + N])) continue;
    if (world.bridge[i] || (LU[i] >= 5 && LU[i] <= 9)) continue; // (not harbours, quays, dams or channels: built to stand or sink)
    const a = H[i - 1], b = H[i + 1], c = H[i - N], d = H[i + N];
    if (Math.min(a, b, c, d) < sea) {
      // (a scrap of kept ground left standing out in the sea, its surroundings long washed away,
      // goes too)
      const wet = (a < sea) + (b < sea) + (c < sea) + (d < sea);
      if (wet >= 3 && H[i] - (a + b + c + d) * 0.25 > 1.5) { H[i] = (a + b + c + d) * 0.25; world.prevHeight[i] = H[i]; LU[i] = 0; OW[i] = 0; P[i] = 0; if (world.terraform) world.terraform[i] = 0; }
      continue;
    }
    const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d), avg = (a + b + c + d) * 0.25;
    if (H[i] - hi > 1.2 || H[i] - lo > 3 || H[i] - avg > 1.5) { H[i] = Math.max(sea + 0.3, avg + 0.3); world.prevHeight[i] = H[i]; } // (clumps of two or three too)
    else if (lo - H[i] > 1.2) { H[i] = avg; world.prevHeight[i] = H[i]; }
  }
  // Livestock: the farms' cattle, sheep, goats and pigs roam out into the woods around them and
  // graze the understory (forest health falls there: few seedlings survive)
  {
    const mask = new Float32Array(n);
    for (let i = 0; i < n; i++) if (LU[i] === 1) mask[i] = 1;
    const g = boxBlur(mask, N, 5);
    if (!world.grazing || world.grazing.length !== n) world.grazing = new Float32Array(n);
    for (let i = 0; i < n; i++) world.grazing[i] = LU[i] ? 0 : Math.min(1, g[i] * 3.5);
  }
  const seaNow = world.seaLevel > -999 ? Math.max(sea, world.seaLevel) : sea; // (with today's tide and any surge)
  // Abandoned pavement breaks up and grows over; farmland with no town goes back to the wild
  const FS = world.farmSoil;
  for (let i = 0; i < n; i++) {
    // Under the sea (sunk, eroded away, or drowned by a surge): fields, plantations and canals are
    // destroyed: the crop and trees killed, the soil salted (it takes years to be farmable again)
    if ((LU[i] === 1 || LU[i] === 10 || LU[i] === 8) && (H[i] < sea || (H[i] < seaNow && world.water[i] > 0.2))) {
      LU[i] = 0; OW[i] = 0; world.irrigated[i] = 0; if (world.channel) world.channel[i] = 0;
      FS[i] = Math.min(FS[i], 0.05);
      world.vegetation[i] = 0; world.forestAge[i] = 0;
      if (world.treeDensity) world.treeDensity[i] = 0;
      continue;
    }
    if (LU[i] !== 1 && LU[i] !== 10 && FS[i] < 1) FS[i] = Math.min(1, FS[i] + 0.0012); // (fallow ground recovers)
    if (LU[i] === 0 || OW[i] || LU[i] === 3) continue;
    if (LU[i] === 1 || LU[i] === 10) { LU[i] = 0; continue; } // (fields and plantations go back to the wild)
    P[i] = Math.max(0, P[i] - 0.004);
    if (P[i] <= 0) { LU[i] = 0; world.channel[i] = 0; }
  }
  // --- Roads wear out and must be kept up ------------------------------------------------
  // Weather, frost, floods and steep ground wear the road; the towns near it repair it (a bigger
  // town keeps up more road, farther out). A neglected road cracks, then breaks up and grows over;
  // only a road in working order lets towns grow along it and trade over it.
  const RC = world.roadCond;
  const upkeep = new Float32Array(n);
  for (const t of towns) {
    const reach = 14 + 4 * Math.sqrt(t.pop / 100), budget = t.pop / 25; // (road cells a step's work can fix)
    const bx0 = Math.max(1, Math.floor(t.x - reach)), bx1 = Math.min(N - 2, Math.ceil(t.x + reach));
    const bz0 = Math.max(1, Math.floor(t.z - reach)), bz1 = Math.min(N - 2, Math.ceil(t.z + reach));
    let count = 0;
    for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) { const i = z * N + x; if (LU[i] === 3 && (x - t.x) ** 2 + (z - t.z) ** 2 < reach * reach) count++; }
    if (!count) continue;
    const share = Math.min(1, budget / count);
    for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) {
      const i = z * N + x;
      if (LU[i] === 3 && (x - t.x) ** 2 + (z - t.z) ** 2 < reach * reach) upkeep[i] = Math.max(upkeep[i], share);
    }
  }
  // Traffic: how many people use each road (the towns it serves, nearer and bigger ones most)
  const TR = world.roadTraffic;
  TR.fill(0);
  for (const t of towns) {
    const reach = 30 + 6 * Math.sqrt(t.pop / 100);
    const bx0 = Math.max(1, Math.floor(t.x - reach)), bx1 = Math.min(N - 2, Math.ceil(t.x + reach));
    const bz0 = Math.max(1, Math.floor(t.z - reach)), bz1 = Math.min(N - 2, Math.ceil(t.z + reach));
    for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) {
      const i = z * N + x;
      if (LU[i] !== 3) continue;
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < reach) TR[i] += t.pop / (1 + d / 12);
    }
  }
  // Busy roads are widened: a second lane past ~600 people a day, a third past ~1500
  let widened = 0;
  const CORE = world.roadCore;
  for (let i = N; i < n - N && widened < 40; i++) {
    if (LU[i] !== 3 || !CORE[i] || RC[i] < 0.5) continue; // (widen from the centre line only)
    const lanes = TR[i] > 1500 ? 3 : TR[i] > 600 ? 2 : 1;
    if (lanes < 2) continue;
    const x = i % N;
    if (x < 1 || x > N - 2) continue;
    // Lanes go beside the road, across its direction: a road running north–south widens east
    // and west, one running east–west widens north and south
    const ns = CORE[i - N] || CORE[i + N], ew = CORE[i - 1] || CORE[i + 1];
    const side = ns && !ew ? [i + 1, i - 1] : [i + N, i - N];
    const nb = lanes === 3 ? side : [side[0]];
    for (const j of nb) {
      if (LU[j] !== 0 && LU[j] !== 1) continue;
      if (H[j] < sea || world.water[j] > 0.2 || zoneHas(world, j, Z.roads)) continue;
      // (graded to the road and paved)
      H[j] += (H[i] - H[j]) * 0.8; world.prevHeight[j] = H[j];
      pave(world, j, 0, 3);
      RC[j] = RC[i]; TR[j] = TR[i];
      if (++widened >= 40) break;
    }
  }
  for (let i = 0; i < n; i++) {
    if (LU[i] !== 3) continue;
    const slope = slopeAt(world, i);
    const wear = 0.0025 * (1 + 4 * slope) * (world.water[i] > 0.3 && H[i] >= sea ? 3 : 1) * (world.snow && world.snow[i] > 0.4 ? 1.6 : 1)
      * (world.fire[i] > 0 ? 3 : 1) * (Math.abs(H[i] - world.prevHeight[i]) > 0.3 ? 10 : 1); // (landslides, floods)
    RC[i] = Math.max(0, Math.min(1, RC[i] - wear + 0.03 * upkeep[i]));
    P[i] = Math.min(1, RC[i] * 1.6); // (a broken road loses its paving: plants creep back)
    if (RC[i] <= 0.03) { LU[i] = world.channel[i] ? (world.channel[i] === 1 ? 8 : 9) : 0; P[i] = 0; RC[i] = 0; world.roadCore[i] = 0; world.bridge[i] = 0; } // (a fallen bridge leaves its canal)
  }
  if (!towns.length) { world.civPop = 0; return; }
  // (the site fields change slowly: refresh them every few steps)
  world.civFieldsAge = (world.civFieldsAge || 0) + 1;
  if (!world._civFields || world._civFields.N !== N || world.civFieldsAge % 6 === 0) { world._civFields = siteFields(world); world._civFields.N = N; world._landComp = landComponents(world); }
  const COMP = world._landComp;
  const fields = world._civFields;
  const NW = nearestWater(world);
  const ph = seasonParams.enabled ? seasonParams.phase : 0.3;
  const yearFactor = seasonParams.enabled ? (seasonParams.yearKind === 'hot' ? 0.6 : seasonParams.yearKind === 'mild' ? 1.1 : 1) : 1;
  let total = 0;
  for (const t of [...towns]) {
    const ci = t.z * N + t.x;
    // Its land: town cells and farms (owner = t.num)
    let townCells = 0, farmCells = 0, indCells = 0, food = 0, hurt = 0;
    const exhausted = [];
    // (how far out the town reaches: farmers can only work fields within a day's walk or so)
    const R = (4 + 2.8 * Math.sqrt(t.pop / PER_FARM_CELL)) * Math.max(1, civParams.growth);
    const x0 = Math.max(1, Math.floor(t.x - R - 4)), x1 = Math.min(N - 2, Math.ceil(t.x + R + 4));
    const z0 = Math.max(1, Math.floor(t.z - R - 4)), z1 = Math.min(N - 2, Math.ceil(t.z + R + 4));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * N + x;
      if (OW[i] !== t.num) continue;
      if (LU[i] === 4) { indCells++; if (world.lava && world.lava[i] > 0.05) { LU[i] = 0; P[i] = 0; OW[i] = 0; } continue; }
      if (LU[i] === 2) {
        townCells++;
        // Disasters on the town: floods, fire, lava, the sea
        if (world.water[i] > 0.6 || H[i] < (world.seaLevel ?? -1e9)) hurt += 0.02;
        if (world.fire[i] > 0) hurt += 0.04;
        if (world.lava && world.lava[i] > 0.05) { hurt += 0.1; LU[i] = 0; P[i] = 0; OW[i] = 0; }
      } else if (LU[i] === 1) {
        farmCells++;
        // Irrigation: water drawn from the nearest river or lake (depleting it); if that has run
        // dry, the field gets only the rain. Fertiliser and soil wash off into the nearest water.
        const src = NW[i];
        let watered = false;
        if (src >= 0 && H[src] >= sea && world.water[src] > 0.03) {
          world.water[src] = Math.max(0, world.water[src] - 0.0015);
          watered = true;
          if (world.soil[i] < 0.6) world.soil[i] = 0.6;
        }
        world.irrigated[i] = watered ? 1 : 0;
        if (src >= 0) {
          // (the fields' runoff goes into the town's drains and out to sea with the rest, where it has
          // an outfall; otherwise into the water they draw on)
          const out = t.seaOutfall !== undefined && t.seaOutfall >= 0 ? t.seaOutfall : -1;
          if (out >= 0) { if (world.pollution) world.pollution[out] = Math.min(4, world.pollution[out] + 0.0012 * civParams.destruction); }
          else if (H[src] < sea) { if (world.pollution) world.pollution[src] = Math.min(4, world.pollution[src] + 0.0012 * civParams.destruction); }
          else RP[src] += 0.003 * civParams.destruction;
        }
        // Cropping wears the soil out (faster when irrigated, cropped harder); a worn-out field
        // yields little
        FS[i] = Math.max(0, FS[i] - 0.0011 * (watered ? 1.3 : 1));
        if (FS[i] < 0.15) exhausted.push(i);
        // (a field too steep to plough, say after a landslide or the river cut into it, is given up)
        const fSlope = fieldSlope(world, i);
        // (a terraced field is level on its benches: only a slope past ~45° undoes it)
        if (fSlope > (world.terraform[i] === 1 ? Math.max(1, Math.tan((civParams.farmSlope * Math.PI) / 180) * 1.3) : Math.tan((civParams.farmSlope * Math.PI) / 180) * 1.3)) { LU[i] = 0; OW[i] = 0; world.irrigated[i] = 0; continue; }
        const f = fertility(world, i, fSlope) * (watered ? 1.2 : 1) * (0.15 + 0.85 * FS[i]);
        // (burnt, flooded or snowbound fields yield little)
        const lost = world.fire[i] > 0 || world.burnt[i] > 0.5 || world.water[i] > 0.4 || (world.snow && world.snow[i] > 0.5 && ph > 0.1 && ph < 0.55) ? 0.2 : 1;
        food += PER_FARM_CELL * f * lost;
        if (world.vegetation[i] > 0.45) world.vegetation[i] = 0.45; // (crops, not forest)
      }
    }
    const harvest = food; // (from the fields alone)
    // A coastal town builds a harbour; its fleet grows with the town and fishes the sea
    if (t.harbor !== undefined && LU[t.harbor] !== 5) t.harbor = undefined;
    // A bigger town reshapes the land: cutting hills and slopes into terraces, dumping the spoil
    if (t.pop > 200 && Math.random() < 0.7 * civParams.growth * civParams.destruction) terraform(world, t, Math.max(1, Math.round(Math.min(28, 4 + Math.floor(t.pop / 200)) * civParams.destruction)));
    // A big town quarries whole hills and mountains away (harder the bigger it is)
    if (civParams.quarrying && t.pop > 500 && civParams.destruction > 0) for (let q = Math.round(Math.min(4, Math.floor(t.pop / 1500) + 1) * Math.max(1, civParams.destruction / 1.5)); q > 0; q--) if (Math.random() < 0.6 * civParams.growth * civParams.destruction) quarry(world, t);
    // Irrigation canals out to dry fields
    if (t.pop > 200 && farmCells > 10 && (t.canals || 0) < 1 + Math.floor(t.pop / 400) && Math.random() < 0.03 * civParams.growth) {
      let dry = 0;
      for (let z = Math.max(0, t.z - 30); z <= Math.min(N - 1, t.z + 30); z++) for (let x = Math.max(0, t.x - 30); x <= Math.min(N - 1, t.x + 30); x++) { const i = z * N + x; if (LU[i] === 1 && OW[i] === t.num && !world.irrigated[i]) dry++; }
      if (dry > farmCells * 0.4) digCanal(world, t, NW);
    }
    // Exploratory roads out into the deep forest (more as the town grows)
    if (t.pop > 150 && (t.trails || 0) < 1 + Math.floor(t.pop / 500) && Math.random() < 0.04 * civParams.growth) exploreForest(world, t);
    // A big town dams a river valley near it for a reservoir (one per town)
    if (t.pop > 700 && t.dam === undefined && Math.random() < 0.02 * civParams.growth) { if (!buildDam(world, t)) t.dam = -1; }
    // Fires: land cleared by burning, and accidents
    manMadeFires(world, t, world._newFarms || []);
    world._newFarms = [];
    // A coastal town of a few hundred armours its shore with quays (growing with the town)
    if (t.pop > 250 && fields.sea[ci] > 0.02 && (t.quay || 0) < Math.floor((t.pop - 200) / 60) && Math.random() < 0.3) buildQuay(world, t, 2);
    if (t.harbor === undefined && t.pop > 120 && fields.sea[ci] > 0.02) buildHarbor(world, t);
    // A town past a thousand needs a harbour for its trade: it searches farther along the coast,
    // then for a river or lake landing; without one it can't grow beyond about a thousand
    if (t.harbor === undefined && t.pop > 900 && Math.random() < 0.2) buildHarbor(world, t, 30) || buildHarbor(world, t, 30, true);
    t.boats = t.harbor !== undefined && !t.harborLake ? Math.min(24, 1 + Math.floor(t.pop / 180)) : 0;
    // (gathering on the shore, and with boats the catch at sea)
    food += 150 * fields.sea[ci] * (world.oxygen ? world.oxygen[ci] ?? 1 : 1);
    if (t.boats) food += fishing(world, t);
    // Hunting: a young settlement lives largely off the game around it (your land animals), which
    // it thins out; as it grows and takes to farming, hunting fades away
    const stage = Math.max(0, Math.min(1, (400 - t.pop) / 250));
    t.hunted = 0;
    if (stage > 0 && world.animals && world.animals.length) {
      const HR = 12 + 8 * stage;
      const hx0 = Math.max(0, Math.floor(t.x - HR)), hx1 = Math.min(N - 1, Math.ceil(t.x + HR));
      const hz0 = Math.max(0, Math.floor(t.z - HR)), hz1 = Math.min(N - 1, Math.ceil(t.z + HR));
      const hunters = Math.min(1, t.pop / 150) * stage * civParams.growth;
      for (const a of world.animals) {
        if (!['land', 'forest', 'meadow', 'mountains'].includes(a.habitat) || a.habits.killsTrees) continue; // (game, not insects)
        const F = world['animal_' + a.id];
        if (!F) continue;
        for (let z = hz0; z <= hz1; z++) for (let x = hx0; x <= hx1; x++) {
          const d2 = (x - t.x) ** 2 + (z - t.z) ** 2;
          if (d2 > HR * HR) continue;
          const i = z * N + x;
          if (zoneHas(world, i, Z.hunting)) continue; // (no hunting here)
          const take = F[i] * 0.02 * hunters * (1 - d2 / (HR * HR));
          if (take > 0) { F[i] -= take; t.hunted += take; }
        }
      }
      food += t.hunted * 1500;
    }
    // Trade: working roads to other towns bring in goods and food
    let working = 0, roadsNear = 0;
    for (let z = Math.max(1, t.z - 8); z <= Math.min(N - 2, t.z + 8); z++) for (let x = Math.max(1, t.x - 8); x <= Math.min(N - 2, t.x + 8); x++) {
      const i = z * N + x;
      if (LU[i] === 3) { roadsNear++; if (world.roadCond[i] > 0.4) working++; }
    }
    t.roadsWorking = roadsNear ? working / roadsNear : 1;
    food *= 1 + Math.min(0.3, 0.08 * t.links.length) * (roadsNear ? t.roadsWorking : 0);
    // (industry brings work and trade: the town can support more people)
    food *= 1 + Math.min(0.35, indCells * 0.012);
    // (mines bring wealth: the town can support more people)
    food *= 1 + Math.min(0.4, (t.mineCount || 0) * 0.12);
    // (timber: building, fuel and trade, from its plantations)
    food *= 1 + Math.min(0.3, (t.timberCut || 0) * 0.01);
    food *= yearFactor;
    // Water: a river or lake nearby, or only wells; dirty water slows them
    const freshNear = fields.fresh[ci];
    const waterOK = freshNear > 0.02 ? 1 : 0.35;
    const dirty = Math.min(1, (RP[ci] || 0) * 0.5 + (fields.fresh[ci] > 0 ? 0 : 0));
    // (and it can only hold so many more than its streets house: it grows as fast as it builds)
    let K = Math.max(20, Math.min(food * waterOK * (1 - 0.4 * dirty), (townCells / 2 + indCells + 4) * PER_TOWN_CELL * 1.3));
    if (t.harbor === undefined && K > 1000) K = 1000; // (no harbour, no trade: it can't grow past a thousand)
    // A soft limit: the bigger a town, the harder it is to feed, house and run (hauling food from
    // ever farther fields, crowding, disease, upkeep), so its growth tails off smoothly toward
    // about 25,000 people (times the Expansion speed) rather than running away
    { const soft = 25000 * Math.max(0.2, civParams.growth); K = K / (1 + K / soft); }
    // Growth toward what the land feeds (and disasters)
    const r = 0.02 * civParams.popRate;
    // (an overcrowded town shrinks as people drift away, a little at a time, not all at once)
    const change = Math.max(-0.02 * t.pop, r * t.pop * (1 - t.pop / K));
    t.pop = Math.max(0, t.pop + change - hurt * t.pop);
    t.capacity = K; t.farm = farmCells; t.cells = townCells;
    // Build out: more town for more people (spreading along its roads where they run), and
    // farmland to feed them
    // (farmers clear more land than they need today, so the town can grow into it: a town's size
    // ends up limited by how much fertile land there is around it, and by its neighbours)
    const perFarm = farmCells ? Math.max(8, harvest / farmCells) : PER_FARM_CELL * 0.5;
    // (every cell of housing needs another of infrastructure: streets, markets, workshops, wells,
    // so a town builds out twice the ground for its people)
    const wantTown = 2 * Math.ceil(t.pop / PER_TOWN_CELL);
    // (every cell of town needs 3 of farmland: the town builds out only once its fields allow)
    const wantFarm = Math.max(Math.ceil((t.pop * 1.8) / perFarm) + 4, FARMS_PER_TOWN_CELL * (Math.max(wantTown, townCells) + indCells + 1));
    const roomForTown = Math.floor(farmCells / FARMS_PER_TOWN_CELL) - townCells - indCells;
    if (townCells < wantTown && roomForTown > 0) expand(world, t, 2, Math.min(Math.max(Math.round(6 * Math.max(1, civParams.growth)), Math.ceil((wantTown - townCells) / 2)), wantTown - townCells, roomForTown), R, fields);
    // Worn-out fields: next to the town they are paved and built on (housing, shops, workshops);
    // farther out they are left fallow to recover. Either way the farmers clear fresh fields
    // farther out, so the town grows in rings: a core, its fields, new clearings at the edge.
    let housed = 0;
    for (const i of exhausted) {
      let nextToTown = false;
      for (const j of [i - 1, i + 1, i - N, i + N]) if ((LU[j] === 2 || LU[j] === 4) && OW[j] === t.num) nextToTown = true;
      if (nextToTown && !zoneHas(world, i, Z.towns) && slopeAt(world, i) < 0.6 && farmCells - 1 >= FARMS_PER_TOWN_CELL * (townCells + indCells + 1)) { pave(world, i, t.num, 2); housed++; farmCells--; townCells++; }
      else if (!nextToTown && Math.random() < 0.05) { LU[i] = 0; OW[i] = 0; farmCells--; } // (fallow)
    }
    t.exhausted = exhausted.length;
    // Industry: a town past ~400 people builds an industrial area on the water (river, lake or
    // coast: for transport, cooling and, alas, dumping), mass-paved, growing with the town
    const wantInd = Math.max(0, Math.floor((t.pop - 400) / 110));
    t.industry = indCells;
    if (indCells < wantInd && roomForTown > 0) buildIndustry(world, t, Math.min(3, wantInd - indCells, roomForTown), NW);
    if (farmCells < wantFarm) expand(world, t, 1, Math.max(Math.round(14 * Math.max(1, civParams.growth)), Math.ceil((wantFarm - farmCells) / 2)), R * 2, fields, NW);
    // (and the farmers keep clearing a little more each year even when the town isn't growing:
    // new holdings, pasture, land for the next generation)
    else if (Math.random() < (0.7 * civParams.growth) / (1 + farmCells / (3000 * Math.max(0.2, civParams.growth)))) expand(world, t, 1, Math.round((2 + (Math.random() < 0.5 ? 1 : 0)) * Math.max(1, civParams.growth)), R * 2, fields, NW);
    // Timber: plantations on land where forest grows, about twice as much land as its fields; each
    // grows trees, is clear-felled when they're grown, and grows them again
    timberStep(world, t, farmCells, R);
    // Mines into the hard rock nearby
    mineStep(world, t, R);
    // A big town sends people out to found a daughter village (linked by road)
    // (when the town is crowded: near what its land can feed)
    // (a town with boats can send them across the water, farther afield; without, only overland)
    if (t.pop > 300 && t.pop > 0.85 * K && towns.length < MAX_TOWNS && Math.random() < 0.03 * civParams.growth) {
      const ang = Math.random() * Math.PI * 2, d = 30 + Math.random() * (t.boats ? 60 : 30);
      const site = bestSite(world, t.x + Math.cos(ang) * d, t.z + Math.sin(ang) * d, 24, fields);
      const overseas = site && COMP && COMP[site.i] !== COMP[ci];
      if (site && (!overseas || t.boats)) {
        const v = foundTown(world, site.i, 60);
        t.pop -= 60;
        if (overseas) { v.byBoat = true; t.links.push(v.id); v.links.push(t.id); } // (a sea route, no road)
        else linkTowns(world, t, v);
      }
    }
    // Boats also carry settlers out to islands no one lives on yet
    if (t.boats >= 2 && t.pop > 200 && towns.length < MAX_TOWNS && COMP && Math.random() < 0.006 * civParams.growth) {
      const settled = new Set(towns.map((u) => COMP[u.z * N + u.x]));
      const ang = Math.random() * Math.PI * 2, d = 25 + Math.random() * 80;
      const site = bestSite(world, t.x + Math.cos(ang) * d, t.z + Math.sin(ang) * d, 30, fields);
      if (site && !settled.has(COMP[site.i])) {
        const v = foundTown(world, site.i, 50);
        t.pop -= 50;
        v.byBoat = true; t.links.push(v.id); v.links.push(t.id);
      }
    }
    // …and over the sea to the cells next door (the world grid): they land there when it is next
    // visited, and found a village on the coast nearest where they crossed
    if (t.boats >= 2 && t.pop > 300 && world.gridSides && Math.random() < 0.004 * civParams.growth) {
      const side = ['n', 's', 'w', 'e'][(Math.random() * 4) | 0];
      let pos = -1, bd = Infinity;
      for (let k = 2; k < N - 2; k++) {
        const i = side === 'n' ? k : side === 's' ? (N - 1) * N + k : side === 'w' ? k * N : k * N + N - 1;
        if (H[i] >= seaOf(world) - 1) continue; // (open sea at that edge)
        const d = Math.hypot((i % N) - t.x, ((i / N) | 0) - t.z);
        if (d < bd) { bd = d; pos = k; }
      }
      if (pos >= 0 && bd < 120) {
        if (!world.settlersOut) world.settlersOut = [];
        world.settlersOut.push({ toCell: world.gridSides[side], side, pos, pop: 50, fromId: t.id });
        t.pop -= 50;
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
    // …and to the towns in the cells next door (the world grid): a road to the border, continued
    // on the far side when that cell is next visited
    if (world.foreignTowns && world.foreignTowns.length && t.pop > 300 && Math.random() < 0.03 * civParams.growth) {
      let f = null, fd = 160;
      for (const u of world.foreignTowns) {
        if (!u.side || u.pop < 100 || t.links.includes(u.id)) continue;
        const d = Math.hypot(u.gx - t.x, u.gz - t.z);
        if (d < fd) { fd = d; f = u; }
      }
      if (f) crossBorderRoad(world, t, f);
    }
    t.history.push(Math.round(t.pop));
    if (t.history.length > 300) t.history.splice(0, t.history.length - 300);
    // A town that dwindles away is abandoned
    if (t.pop < 8) removeTown(world, t);
    else total += t.pop;
  }
  world.civPop = total;
  // People on the move, disease, smoke and worn-out land
  migrationStep(world, world.towns);
  if (civParams.epidemics) epidemicStep(world, world.towns);
  airPollutionStep(world);
  desertStep(world);
  invasiveStep(world);
  world.dirty = true;
}

// --- Mining -------------------------------------------------------------------------------
// The hard, mineral-bearing rocks (igneous and metamorphic): where ores are found
const ORE_ROCKS = new Set(['basalt', 'andesite', 'rhyolite', 'granite', 'gneiss', 'schist', 'marble'].map((id) => ROCK_INDEX[id]));

/**
 * Mining: a town of a few hundred sinks a mine into the hard, mineral-bearing rock near it (granite,
 * basalt, gneiss and the like), with a road out to it. The mine deepens its pit year by year; the
 * waste rock is piled into a spoil heap beside it, a raw, poisonous heap where nothing grows and that
 * poisons the ground around it, with foul, metal-laden drainage running off it down the streams. Each
 * working mine adds to the town's wealth (it can support more people). More mines as it grows.
 */
function mineStep(world, t, R) {
  const N = world.N, H = world.height, LU = world.landUse, OW = world.civOwner, sea = seaOf(world);
  if (!t.mines) t.mines = [];
  let worked = 0;
  for (const m of t.mines) {
    if (!m.pit.some((j) => LU[j] === 11)) continue; // (bulldozed, flooded or abandoned)
    worked++;
    // Deepen the pit a little; the rock goes onto the heap
    let spoil = 0;
    for (const j of m.pit) {
      if (LU[j] !== 11 || H[j] < m.floor) continue;
      const cut = Math.min(0.15 * Math.max(0.3, civParams.destruction), H[j] - m.floor);
      H[j] -= cut; world.prevHeight[j] = H[j]; spoil += cut;
    }
    const heap = m.heap.filter((j) => LU[j] === 12);
    for (const j of heap) { const put = spoil / Math.max(1, heap.length); H[j] += put; world.prevHeight[j] = H[j]; }
    // The heap poisons the ground around it: nothing grows on it, little near it
    for (const j of heap) {
      world.vegetation[j] = 0;
      world.farmSoil[j] = 0;
      if (world.humus) world.humus[j] = 0;
      for (const k of [j - 1, j + 1, j - N, j + N, j - N - 1, j - N + 1, j + N - 1, j + N + 1]) {
        if (k < 0 || k >= N * N || LU[k]) continue;
        world.vegetation[k] = Math.min(world.vegetation[k], 0.25);
        world.farmSoil[k] = Math.min(world.farmSoil[k], 0.3);
      }
    }
    // …and its drainage runs foul down the streams (acid, metal-laden)
    if (heap.length && !zoneHas(world, heap[0], Z.earthworks)) traceDown(world, heap[0], 0.02 * civParams.destruction);
  }
  t.mines = t.mines.filter((m) => m.pit.some((j) => LU[j] === 11));
  t.mineCount = worked;
  // A new mine
  if (t.pop < 400 || civParams.destruction <= 0 || worked >= 1 + Math.floor(t.pop / 3000) || Math.random() > 0.012 * civParams.growth * Math.min(1.5, civParams.destruction)) return;
  let best = -1, bs = 0;
  for (let k = 0; k < 50; k++) {
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * R * 2;
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 6 || z < 6 || x > N - 7 || z > N - 7) continue;
    const i = z * N + x;
    if (LU[i] || H[i] < sea + 2 || world.water[i] > 0.1 || zoneHas(world, i, Z.earthworks | Z.towns)) continue;
    if (!ORE_ROCKS.has(world.rockAt(H[i] - 1.5, i))) continue; // (ore-bearing rock just beneath)
    const score = world.hardnessAt(H[i] - 1.5, i) + 0.2 * slopeAt(world, i) - d * 0.004;
    if (score > bs) { bs = score; best = i; }
  }
  if (best < 0) return;
  const bx = best % N, bz = (best / N) | 0, pit = [], heap = [];
  // The pit (about 5 across) and, downhill of it, the spoil heap
  let dx = 0, dz = 0, lo = H[best];
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (bz + az * 4) * N + bx + ax * 4; if (H[j] < lo) { lo = H[j]; dx = ax; dz = az; } }
  if (!dx && !dz) dx = 1;
  for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) {
    if (ox * ox + oz * oz > 5) continue;
    const j = (bz + oz) * N + bx + ox;
    if (LU[j]) continue;
    LU[j] = 11; OW[j] = t.num; world.vegetation[j] = 0; pit.push(j);
  }
  for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
    const j = (bz + dz * 4 + oz) * N + bx + dx * 4 + ox;
    if (LU[j] || H[j] < sea + 0.5) continue;
    LU[j] = 12; OW[j] = t.num; world.vegetation[j] = 0; heap.push(j);
  }
  if (!pit.length) return;
  t.mines.push({ i: best, pit, heap, floor: Math.max(sea + 1, H[best] - 14) });
  // (the haul road runs up to the pit's edge, on the town's side, not into it)
  const ang = Math.atan2(t.z - bz, t.x - bx);
  const path = routeRoad(world, t, { x: Math.round(bx + Math.cos(ang) * 3.5), z: Math.round(bz + Math.sin(ang) * 3.5) });
  if (path && path.length > 1) buildRoad(world, path);
  world.dirty = true;
}

/** Foul water running off cell `start`: down the steepest way to the streams and on to the sea. */
function traceDown(world, start, load) {
  const N = world.N, H = world.height, D = world.water, RP = world.riverPollution, sea = seaOf(world);
  let c = start;
  for (let k = 0; k < 200; k++) {
    if (H[c] < sea) { if (world.pollution) world.pollution[c] = Math.min(4, world.pollution[c] + load * 1.5); return; }
    if (D[c] > 0.1) RP[c] += load;
    const cx = c % N, cz = (c / N) | 0;
    if (cx < 1 || cz < 1 || cx > N - 2 || cz > N - 2) return;
    let low = c, lh = H[c] + D[c];
    for (const j of [c - 1, c + 1, c - N, c + N, c - N - 1, c - N + 1, c + N - 1, c + N + 1]) { const hj = H[j] + D[j]; if (hj < lh) { lh = hj; low = j; } }
    if (low === c) return;
    c = low;
  }
}

// --- People on the move, and disease ----------------------------------------------------------

/**
 * Migration: people move along the roads and sea routes between linked towns, from the more crowded
 * or struggling town (nearer, or past, what its land can support) to the more prosperous one. Booming
 * towns draw people in; failing ones empty, sometimes to ghost towns.
 */
function migrationStep(world, towns) {
  const byId = new Map(towns.map((t) => [t.id, t]));
  for (const t of towns) {
    t.migrants = (t.migrants || 0) * 0.9;
    for (const id of t.links) {
      const u = byId.get(id);
      if (!u || u.id < t.id) continue; // (each pair once)
      const ct = t.pop / Math.max(20, t.capacity || t.pop), cu = u.pop / Math.max(20, u.capacity || u.pop);
      const diff = ct - cu;
      if (Math.abs(diff) < 0.08) continue;
      const from = diff > 0 ? t : u, to = from === t ? u : t;
      // (more of them move the bigger the gap, a little faster with good roads)
      const move = Math.min(from.pop * 0.025, Math.abs(diff) * 0.02 * from.pop) * civParams.growth;
      if (move < 0.5) continue;
      from.pop -= move; to.pop += move;
      to.migrants = (to.migrants || 0) + move; from.migrants = (from.migrants || 0) - move;
    }
  }
}

/**
 * Epidemics: now and then disease breaks out in a crowded town, more readily where its water is
 * dirty. It spreads through the town (killing some of those it strikes) and along its roads and sea
 * routes to the towns it trades with, then burns out, leaving the survivors immune for a while.
 */
function epidemicStep(world, towns) {
  const N = world.N, RP = world.riverPollution, byId = new Map(towns.map((t) => [t.id, t]));
  for (const t of towns) {
    t.immune = Math.max(0, (t.immune || 0) - 0.0025);
    if (!(t.sick > 0)) {
      const crowd = t.pop / Math.max(20, t.capacity || t.pop);
      const dirty = Math.min(1, (RP[t.z * N + t.x] || 0) + (world.pollution ? (world.pollution[t.seaOutfall] || 0) * 0.1 : 0));
      if (t.pop > 300 && Math.random() < 0.0012 * crowd * crowd * (1 + 3 * dirty) * (1 - t.immune)) { t.sick = 0.02; t.outbreaks = (t.outbreaks || 0) + 1; t.lastOutbreak = seasonParams.year || 1; }
      continue;
    }
    // Spreads through the town, kills some, the rest recover immune
    const deaths = t.pop * t.sick * 0.06;
    t.pop -= deaths;
    t.died = (t.died || 0) + deaths;
    t.sick += t.sick * 0.5 * Math.max(0, 1 - t.sick * 4 - t.immune);
    const recovered = t.sick * 0.2;
    t.sick -= recovered; t.immune = Math.min(1, t.immune + recovered * 6 + 0.01);
    // (an outbreak runs its course: burns out within about 40 steps)
    t.sickSteps = (t.sickSteps || 0) + 1;
    if (t.sickSteps > 40) t.sick *= 0.7;
    // …and along its links
    for (const id of t.links) {
      const u = byId.get(id);
      if (u && !(u.sick > 0) && (u.immune || 0) < 0.5 && Math.random() < t.sick * 1.5 * (1 - (u.immune || 0))) { u.sick = 0.01; u.outbreaks = (u.outbreaks || 0) + 1; u.lastOutbreak = seasonParams.year || 1; }
    }
    if (t.sick < 0.004) { t.sick = 0; t.sickSteps = 0; t.immune = Math.max(t.immune, 0.8); }
  }
}

// --- Smoke and acid rain ----------------------------------------------------------------------

/**
 * Air pollution: smoke from industry (heavily), towns and mines drifts downwind with the prevailing
 * wind, spreading and thinning as it goes. Where it settles, acid rain falls: forests sicken (their
 * health drops and, where it's thick, the trees die back) and the soil of fields turns sour.
 */
function airPollutionStep(world) {
  const N = world.N, n = N * N, LU = world.landUse;
  if (!world.airPollution || world.airPollution.length !== n) world.airPollution = new Float32Array(n);
  const A = world.airPollution, k = civParams.destruction;
  for (let i = 0; i < n; i++) {
    const lu = LU[i];
    if (lu === 4) A[i] += 0.05 * k;
    else if (lu === 2) A[i] += 0.006 * k;
    else if (lu === 11 || lu === 12) A[i] += 0.015 * k;
  }
  // Drift downwind (about 2 cells a step) and spread
  const a = ((climateParams.windAngle || 0) * Math.PI) / 180, ux = Math.cos(a) * 2, uz = Math.sin(a) * 2;
  const B = new Float32Array(n);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const sx = Math.round(x - ux), sz = Math.round(z - uz);
    if (sx < 0 || sz < 0 || sx >= N || sz >= N) continue;
    B[z * N + x] = A[sz * N + sx];
  }
  const C = boxBlur(B, N, 1);
  for (let i = 0; i < n; i++) A[i] = C[i] * 0.9 < 1e-4 ? 0 : Math.min(3, C[i] * 0.9);
  // Acid rain where it settles
  const FH = world.forestHealth, V = world.vegetation, FS = world.farmSoil;
  for (let i = 0; i < n; i++) {
    const s = A[i];
    if (s < 0.03) continue;
    if (FH) FH[i] = Math.max(0, FH[i] - 0.01 * s);
    if (V[i] > 0.66 && s > 0.25) V[i] -= 0.004 * s; // (trees dying back)
    if (LU[i] === 1 && FS) FS[i] = Math.max(0, FS[i] - 0.0006 * s);
  }
}

// --- An invasive tree ------------------------------------------------------------------------

/**
 * The plantations are planted with a fast-growing exotic pine, and it escapes. world.invasive (0…1)
 * is the share of the trees that are this pine. Every plantation is all pine; from them, and from
 * wild forest it has already taken, its seed spreads slowly into the native forest around (tree by
 * tree, a few cells a decade, and now and then a long jump on the wind or with birds), and it
 * crowds the native trees out as it goes: their seedlings can't establish under it, so forest health
 * falls. It supports no wildlife: an animal can live in an invaded forest only as far as the native
 * trees remain (sim/ecology.js). It doesn't grow on open ground, and dies back where the forest is
 * cleared or burnt (though a plantation is replanted with it).
 */
function invasiveStep(world) {
  const N = world.N, n = N * N, LU = world.landUse, V = world.vegetation;
  if (!civParams.invasive) return;
  if (!world.invasive || world.invasive.length !== n) world.invasive = new Float32Array(n);
  const I = world.invasive, FH = world.forestHealth;
  let any = false;
  for (let i = 0; i < n; i++) if (LU[i] === 10) { I[i] = 1; any = true; } else if (I[i] > 0) any = true;
  if (!any) return;
  const next = I.slice();
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = z * N + x;
    if (LU[i] === 10) continue;
    if (V[i] < 0.5 || LU[i]) { next[i] = I[i] * 0.97; continue; } // (no forest: it dies back)
    const s = (I[i - 1] + I[i + 1] + I[i - N] + I[i + N]) * 0.25;
    if (s <= 0.001 && I[i] <= 0) continue;
    // (seedlings from its neighbours take hold under the native trees, and it shades them out)
    next[i] = Math.min(1, I[i] + 0.006 * Math.max(s, I[i]) * (1 - I[i]) * (0.5 + V[i]));
    if (FH && next[i] > 0.1) FH[i] = Math.max(0, FH[i] - 0.006 * next[i]);
  }
  // Seed carried along the roads (on boots, wheels and timber carts): a road passing invaded forest
  // or a plantation picks it up, it travels along the road network, and the forest beside a seed-
  // carrying road gets invaded too, far from where it started
  if (!world.roadSeed || world.roadSeed.length !== n) world.roadSeed = new Float32Array(n);
  const RS = world.roadSeed;
  for (let pass = 0; pass < 3; pass++) {
    for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (LU[i] !== 3) { RS[i] = 0; continue; }
      let s = RS[i] * 0.985;
      for (const j of [i - 1, i + 1, i - N, i + N]) {
        if (LU[j] === 3) s = Math.max(s, RS[j] * 0.97);
        else if (I[j] > 0.5) s = 1; // (picks it up from invaded forest or a plantation beside it)
      }
      RS[i] = s;
    }
  }
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = z * N + x;
    if (LU[i] || V[i] < 0.5) continue;
    let s = 0;
    for (const j of [i - 1, i + 1, i - N, i + N]) if (LU[j] === 3 && RS[j] > s) s = RS[j];
    if (s > 0.15 && Math.random() < 0.04 * s) next[i] = Math.max(next[i], 0.06);
  }
  // (now and then a long jump: seed carried far on the wind or by birds)
  for (let k = 0; k < 6; k++) {
    const i = (Math.random() * n) | 0;
    if (I[i] < 0.5) continue;
    const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * 18;
    const x = Math.round((i % N) + Math.cos(a) * d), z = Math.round(((i / N) | 0) + Math.sin(a) * d);
    if (x < 1 || z < 1 || x > N - 2 || z > N - 2) continue;
    const j = z * N + x;
    if (!LU[j] && V[j] > 0.55) next[j] = Math.max(next[j], 0.05);
  }
  I.set(next);
}

// --- Overgrazing ------------------------------------------------------------------------------

/**
 * Desertification: in dry country the farms' livestock strip the grass and scrub around the fields
 * down to the soil, which blows and washes away: the land degrades toward desert (world.degraded,
 * 0…1), plants can't grow back there, and the bare ground creeps outward. Taken off grazing (or with
 * more rain) it slowly recovers.
 */
function desertStep(world) {
  const N = world.N, n = N * N, G = world.grazing, SM = world.soil, V = world.vegetation, HU = world.humus;
  if (!G || !SM) return;
  if (!world.degraded || world.degraded.length !== n) world.degraded = new Float32Array(n);
  const DG = world.degraded, k = Math.max(0.2, civParams.destruction);
  for (let i = 0; i < n; i++) {
    const dry = Math.max(0, (0.45 - SM[i]) / 0.45);
    let d = DG[i];
    if (G[i] > 0.15 && dry > 0) {
      d += 0.004 * G[i] * dry * k;
      if (HU) HU[i] *= 1 - 0.003 * G[i] * dry;
    } else d -= 0.0012 * (1 - dry * 0.7); // (resting: slow recovery, slower when dry)
    // (bare ground creeps outward from badly degraded land, where it's dry)
    if (d < 0.5 && dry > 0.3) {
      const x = i % N, z = (i / N) | 0;
      if (x > 0 && z > 0 && x < N - 1 && z < N - 1 && Math.max(DG[i - 1], DG[i + 1], DG[i - N], DG[i + N]) > 0.7) d += 0.0015 * dry * k;
    }
    DG[i] = d < 0 ? 0 : d > 1 ? 1 : d;
    if (DG[i] > 0.2) V[i] = Math.min(V[i], 1 - DG[i] * 0.9);
  }
}

/**
 * The way a road would go from a to b: the cheapest route over the land (A*), as road builders lay
 * them out: along valleys and contours rather than straight over the hills, avoiding steep
 * slopes, crossing rivers only where it must (and never the open sea), reusing roads already there.
 * The route wanders a little with the lie of the land. Returns grid points, or null.
 */
export function routeRoad(world, a, b) {
  const N = world.N, n = N * N, H = world.height, D = world.water, sea = seaOf(world), LU = world.landUse;
  const pad = 30;
  const x0 = Math.max(1, Math.min(a.x, b.x) - pad), x1 = Math.min(N - 2, Math.max(a.x, b.x) + pad);
  const z0 = Math.max(1, Math.min(a.z, b.z) - pad), z1 = Math.min(N - 2, Math.max(a.z, b.z) + pad);
  const s = Math.round(a.z) * N + Math.round(a.x), goal = Math.round(b.z) * N + Math.round(b.x);
  const g = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
  const heap = new MinHeap(n * 4);
  const hcost = (i) => Math.hypot((i % N) - b.x, ((i / N) | 0) - b.z);
  g[s] = 0; heap.push(s, hcost(s));
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];
  let found = false, guard = 0;
  while (heap.size && guard++ < 200000) {
    const c = heap.pop();
    if (c === goal) { found = true; break; }
    const cx = c % N, cz = (c / N) | 0;
    for (let k = 0; k < 8; k++) {
      const x = cx + DX[k], z = cz + DZ[k];
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      const j = z * N + x;
      if (H[j] < sea && LU[j] !== 3) continue; // (no road over open sea)
      const len = k < 4 ? 1 : 1.414;
      const grade = Math.abs(H[j] - H[c]) / len;
      // The lie of the land: gentle undulations in where a road finds it easiest to go
      const lie = 0.35 * (1 + Math.sin(x * 0.19 + z * 0.07) * Math.cos(z * 0.15 - x * 0.06));
      // (protected zones are kept wild: roads go round them unless there's truly no other way)
      const cost = len * (1 + 14 * grade * grade + (D[j] > 0.1 ? 6 : 0) + lie - (LU[j] === 3 ? 0.6 : 0) + (zoneHas(world, j, Z.roads) ? 60 : 0));
      const ng = g[c] + cost;
      if (ng < g[j]) { g[j] = ng; from[j] = c; heap.push(j, ng + hcost(j)); }
    }
  }
  if (!found) return null;
  const path = [];
  for (let c = goal; c !== -1; c = from[c]) path.push({ x: c % N, z: (c / N) | 0 });
  return path.reverse();
}

/** Connect two towns with a road, routed over the land (none if the only way is over open sea). */
/**
 * An exploratory road: a track pushed out from the town into the deepest forest nearby, for timber
 * and game and new land. It cuts a strip of trees down along it, thins the forest either side, and
 * like any road lets the town spread out along it.
 */
function exploreForest(world, t) {
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse;
  const TD = world.treeDensity || world.vegetation;
  let best = null, bs = 0.55;
  for (let k = 0; k < 60; k++) {
    const a = Math.random() * Math.PI * 2, d = 15 + Math.random() * 25;
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 3 || z < 3 || x > N - 4 || z > N - 4) continue;
    const i = z * N + x;
    if (H[i] < sea + 0.5 || LU[i] || zoneHas(world, i, Z.roads)) continue;
    // (deep forest: dense all round, and no road already near)
    let s = 0, c = 0, road = false;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const j = i + dz * N + dx;
      s += TD[j] * (world.vegetation[j] > 0.6 ? 1 : 0.3); c++;
      if (LU[j] === 3) road = true;
    }
    if (road) continue;
    const score = s / c + d * 0.004;
    if (score > bs) { bs = score; best = { x, z }; }
  }
  if (!best) return false;
  const path = routeRoad(world, t, best);
  if (!path || path.length < 4) return false;
  buildRoad(world, path);
  // (felled along the track, thinned either side)
  for (const p of path) {
    const i = Math.round(p.z) * N + Math.round(p.x);
    for (const j of [i, i - 1, i + 1, i - N, i + N, i - 2, i + 2, i - 2 * N, i + 2 * N]) {
      if (j < 0 || j >= N * N || LU[j] === 3) continue;
      const near = j === i - 1 || j === i + 1 || j === i - N || j === i + N;
      world.vegetation[j] = Math.min(world.vegetation[j], near ? 0.35 : 0.6);
      if (world.treeDensity) world.treeDensity[j] *= near ? 0.3 : 0.7;
      if (near && world.forestAge) world.forestAge[j] = 0;
    }
  }
  t.trails = (t.trails || 0) + 1;
  world.dirty = true;
  return true;
}

/**
 * A road from town t toward a town in the next cell of the world grid (f, in this cell's
 * coordinates): routed to the border where the straight line between them crosses it, and left
 * there for the far side to continue (world.portalsOut).
 */
function crossBorderRoad(world, t, f) {
  const N = world.N, clamp = (v) => Math.max(2, Math.min(N - 3, Math.round(v)));
  let bx, bz;
  if (f.side === 'e' || f.side === 'w') {
    bx = f.side === 'e' ? N - 2 : 1; // (as near the edge as roads go)
    bz = clamp(t.z + ((f.gz - t.z) * (bx - t.x)) / (f.gx - t.x || 1));
  } else {
    bz = f.side === 's' ? N - 2 : 1;
    bx = clamp(t.x + ((f.gx - t.x) * (bz - t.z)) / (f.gz - t.z || 1));
  }
  const path = routeRoad(world, t, { x: bx, z: bz });
  if (!path || path.length < 2) return false;
  buildRoad(world, path);
  if (!world.portalsOut) world.portalsOut = [];
  world.portalsOut.push({ toCell: f.cell, side: f.side, pos: f.side === 'e' || f.side === 'w' ? bz : bx, fromId: t.id, toId: f.id });
  t.links.push(f.id);
  return true;
}

function linkTowns(world, a, b) {
  a.links.push(b.id); b.links.push(a.id);
  const path = routeRoad(world, a, b);
  if (path && path.length > 1) buildRoad(world, path);
}

/**
 * Grow town t's land: `use` 2 (town) or 1 (farms), `count` cells, within radius R of its centre.
 * New town cells go next to its existing town or along roads; farms on the most fertile land.
 */
function expand(world, t, use, count, R, fields, NWexp = null) {
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse, OW = world.civOwner;
  const cands = [];
  const x0 = Math.max(2, Math.floor(t.x - R)), x1 = Math.min(N - 3, Math.ceil(t.x + R));
  const z0 = Math.max(2, Math.floor(t.z - R)), z1 = Math.min(N - 3, Math.ceil(t.z + R));
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const i = z * N + x;
    if (LU[i] !== 0 && !(use === 2 && LU[i] === 1 && OW[i] === t.num) && !(LU[i] === 10 && OW[i] === t.num)) continue; // (towns grow over their own fields and plantations)
    if (zoneHas(world, i, use === 1 ? Z.fields : Z.towns)) continue; // (a protected or restricted area)
    if (use === 1 && isLimited(world, i)) continue; // (a limited-harvest zone is kept as woodland: never cleared for fields)
    if (H[i] < sea + 0.8 || world.water[i] > 0.1 || (world.ice && world.ice[i] > 0.05)) continue;
    const d = Math.hypot(x - t.x, z - t.z);
    if (d > R) continue;
    const slope = slopeAt(world, i);
    let score;
    if (use === 2) {
      // Next to town or road
      let adj = 0, road = 0;
      for (const j of [i - 1, i + 1, i - N, i + N]) { if (LU[j] === 2 && OW[j] === t.num) adj = 1; if (LU[j] === 3 && world.roadCond[j] > 0.4) road = 1; }
      if (!adj && !road) continue;
      if (slope > 0.6) continue;
      score = (1 - d / R) + road * 0.6 + adj * 0.3 - slope;
    } else {
      // Any land can be farmed if it can be watered and has a growing season: cleared (forest
      // too), flattened or terraced (up to fairly steep), and irrigated from water nearby
      // (too steep to farm as it lies; a town of some size cuts moderately steep ground into level
      // terraces first, at a cost)
      const lim = Math.tan((civParams.farmSlope * Math.PI) / 180);
      if (slope > lim && (t.pop < 150 || slope > Math.max(lim, 0.7))) continue;
      const T = world.temperature[i];
      const warm = Math.max(0, Math.min(1, (T - 2) / 8)) * Math.max(0, Math.min(1, (30 - T) / 6));
      if (warm < 0.2) continue;
      const src = NWexp ? NWexp[i] : -1;
      const canWater = src >= 0 && H[src] >= sea;
      const moist = Math.min(1, (world.soil ? world.soil[i] : 0.5) * 1.8);
      if (!canWater && moist < 0.45) continue;
      // (fresh or long-fallow ground is preferred: worn-out soil isn't worth clearing again yet)
      if (world.farmSoil[i] < 0.35) continue;
      score = warm * (canWater ? 0.9 : moist) * (0.4 + 0.6 * world.farmSoil[i]) - 0.35 * slope + 0.2 * (world.humus ? world.humus[i] : 0) - 0.5 * (d / R);
    }
    cands.push([score + Math.random() * 0.05, i]);
  }
  cands.sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < Math.min(count, cands.length); k++) {
    const i = cands[k][1];
    if (use === 2) pave(world, i, t.num, 2);
    else {
      if (world.vegetation[i] > 0.6) (world._newFarms || (world._newFarms = [])).push(i); // (forest: may be cleared by fire)
      makeFarm(world, i, t.num);
    }
  }
}

/**
 * Grow town t's industrial area by `count` cells: on the water's edge nearest the town (a river,
 * lake or the coast), spreading along the shore and inland from it as one solid paved block.
 */
function buildIndustry(world, t, count, NW) {
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse, OW = world.civOwner;
  const R = 26;
  const cands = [];
  const x0 = Math.max(2, t.x - R), x1 = Math.min(N - 3, t.x + R), z0 = Math.max(2, t.z - R), z1 = Math.min(N - 3, t.z + R);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const i = z * N + x;
    if ((LU[i] !== 0 && LU[i] !== 1) || H[i] < sea + 0.5 || world.water[i] > 0.1 || zoneHas(world, i, Z.towns)) continue;
    const d = Math.hypot(x - t.x, z - t.z);
    if (d > R || slopeAt(world, i) > 0.5) continue;
    let ind = 0, shore = 0;
    for (const j of [i - 1, i + 1, i - N, i + N]) {
      if (LU[j] === 4 && OW[j] === t.num) ind = 1;
      if (H[j] < sea || world.water[j] > 0.1) shore = 1;
    }
    const src = NW[i];
    const waterDist = src >= 0 ? Math.hypot((src % N) - x, ((src / N) | 0) - z) : 99;
    const hasInd = t.industry > 0;
    if (hasInd && !ind) continue; // (one solid block)
    if (!hasInd && waterDist > 2) continue; // (it starts on the water's edge)
    cands.push([(ind ? 2 : 0) + shore * 0.8 - waterDist * 0.15 - d / R + Math.random() * 0.05, i]);
  }
  cands.sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < Math.min(count, cands.length); k++) {
    const i = cands[k][1];
    pave(world, i, t.num, 4);
    t.industry = (t.industry || 0) + 1;
  }
}

/**
 * Turn cell i into farmland: clear it (trees and all), flatten it, or on a slope cut it into
 * terraces (level steps), and make it a field (the Farmland biome).
 */
/**
 * How steep a field's own surface is: along each axis the gentler side, so a level terrace step
 * counts as flat even though the riser beside it is steep.
 */
function fieldSlope(world, i) {
  const N = world.N, H = world.height, x = i % N, z = (i / N) | 0;
  if (x < 1 || z < 1 || x > N - 2 || z > N - 2) return 0;
  const gx = Math.min(Math.abs(H[i + 1] - H[i]), Math.abs(H[i] - H[i - 1]));
  const gz = Math.min(Math.abs(H[i + N] - H[i]), Math.abs(H[i] - H[i - N]));
  return Math.hypot(gx, gz);
}

function makeFarm(world, i, owner) {
  const N = world.N, H = world.height, x = i % N, z = (i / N) | 0;
  world.vegetation[i] = Math.min(world.vegetation[i], 0.3);
  world.forestAge[i] = 0;
  if (x > 0 && z > 0 && x < N - 1 && z < N - 1) {
    const slope = slopeAt(world, i);
    if (slope < Math.min(0.25, Math.tan((civParams.farmSlope * Math.PI) / 180))) H[i] += ((H[i - 1] + H[i + 1] + H[i - N] + H[i + N]) * 0.25 - H[i]) * 0.6; // (levelled)
    else { H[i] += (Math.round(H[i] / 0.6) * 0.6 - H[i]) * 0.85; if (world.terraform) world.terraform[i] = 1; } // (terraced: a level step)
    world.prevHeight[i] = H[i];
  }
  world.landUse[i] = 1;
  world.civOwner[i] = owner;
}

/**
 * The Harbour tool: build a harbour at the shore nearest (x, z) for the nearest town (within 40
 * cells); a town that already has one moves it there (the old one becomes town). On the sea it gets
 * a fishing fleet; on a river or lake, a landing for trade without one. Returns the town, or a
 * string saying why not.
 */
export function placeHarbor(world, x, z) {
  ensureCiv(world);
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse;
  const t = townNear(world, x, z, 40);
  if (!t) return 'no town within about 40 cells to run it: settle one first';
  let best = -1, bd = 7;
  for (let zz = Math.max(1, Math.round(z) - 6); zz <= Math.min(N - 2, Math.round(z) + 6); zz++) for (let xx = Math.max(1, Math.round(x) - 6); xx <= Math.min(N - 2, Math.round(x) + 6); xx++) {
    const i = zz * N + xx;
    if (H[i] < sea || world.water[i] > 0.2 || (LU[i] !== 0 && LU[i] !== 1 && LU[i] !== 2 && LU[i] !== 6) || world.channel[i]) continue;
    let shore = false;
    for (const j of [i - 1, i + 1, i - N, i + N]) if (H[j] < sea || (world.water[j] > 0.5 && !world.channel[j])) shore = true;
    if (!shore) continue;
    const d = Math.hypot(xx - x, zz - z);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return 'no shore there: click on the land at the edge of the sea, a lake or a big river';
  if (t.harbor !== undefined && LU[t.harbor] === 5) LU[t.harbor] = 2; // (the old harbour is built over)
  pave(world, best, t.num, 5);
  t.harbor = best;
  t.harborLake = H[best - 1] >= sea && H[best + 1] >= sea && H[best - N] >= sea && H[best + N] >= sea;
  t.moleDir = undefined; t.mole = 0; // (a new breakwater from here)
  world.dirty = true;
  return t;
}

/**
 * The Plantation brush: cells around (x, z) become timber plantation for the nearest town (within
 * 80 cells), planted with saplings: open land, and that town's own fields. Painted cells join a
 * plantation of that town nearby (or start a new one), and are felled and regrown with it. With
 * `remove`, plantation under the brush goes back to the wild. Returns the town, null, or a reason.
 */
export function paintPlantation(world, x, z, radius, remove) {
  ensureCiv(world);
  const N = world.N, LU = world.landUse, OW = world.civOwner, H = world.height, sea = seaOf(world);
  const cells = [];
  const r = Math.max(1, radius);
  for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
    if (dx * dx + dz * dz > r * r) continue;
    const xx = Math.round(x) + dx, zz = Math.round(z) + dz;
    if (xx < 2 || zz < 2 || xx > N - 3 || zz > N - 3) continue;
    cells.push(zz * N + xx);
  }
  if (remove) {
    for (const i of cells) if (LU[i] === 10) { LU[i] = 0; OW[i] = 0; }
    world.dirty = true;
    return null;
  }
  const t = townNear(world, x, z, 80);
  if (!t) return 'no town within about 80 cells to plant and fell it: settle one first';
  if (!t.plantations) t.plantations = [];
  let pl = t.plantations.find((p) => p.painted && Math.hypot(p.x - x, p.z - z) < 20);
  if (!pl) { pl = { x: Math.round(x), z: Math.round(z), cells: [], alive: 0, painted: true }; t.plantations.push(pl); }
  const have = new Set(pl.cells);
  for (const i of cells) {
    const ownField = LU[i] === 1 && OW[i] === t.num;
    if (!(LU[i] === 0 || ownField || (LU[i] === 10 && OW[i] !== t.num)) || H[i] < sea + 0.3 || world.water[i] > 0.2 || isProtected(world, i)) continue;
    LU[i] = 10; OW[i] = t.num; world.irrigated[i] = 0;
    if (world.vegetation[i] < 0.35) world.vegetation[i] = 0.35; // (saplings)
    if (ownField) { if (!world.plantedField) world.plantedField = new Uint8Array(N * N); world.plantedField[i] = 1; } // (ploughed field: planted out with nursery stock)
    if (!have.has(i)) { pl.cells.push(i); have.add(i); }
  }
  pl.alive = pl.cells.length;
  world.dirty = true;
  return t;
}

/**
 * Footpaths: tracks you draw across the land (the Footpath tool), following the lie of the land like
 * a road but not built: no grading, no paving, and no upkeep (they never wear out or need repair).
 * Feet keep the ground a little worn along them. world.footpaths = [{ id, name, pts }]; the cells
 * they cross are marked in world.footpath (for drawing).
 */
export function addFootpath(world, a, b) {
  ensureCiv(world);
  const N = world.N;
  if (!world.footpaths) world.footpaths = [];
  let pts = routeRoad(world, a, b);
  if (!pts || pts.length < 2) {
    const len = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    pts = [];
    for (let k = 0; k <= len; k++) pts.push({ x: Math.round(a.x + ((b.x - a.x) * k) / len), z: Math.round(a.z + ((b.z - a.z) * k) / len) });
  }
  pts = pts.map((p) => ({ x: Math.round(p.x), z: Math.round(p.z) }));
  // Starting at the end (or the start) of a footpath carries that footpath on: one continuous path,
  // laid a stretch at a time
  let joined = null, atEnd = true, bd = 4;
  for (const fp of world.footpaths) {
    const e = fp.pts[fp.pts.length - 1], s0 = fp.pts[0];
    const de = Math.hypot(e.x - a.x, e.z - a.z), ds = Math.hypot(s0.x - a.x, s0.z - a.z);
    if (de < bd) { bd = de; joined = fp; atEnd = true; }
    if (ds < bd) { bd = ds; joined = fp; atEnd = false; }
  }
  if (joined) {
    if (atEnd) joined.pts.push(...pts.slice(1));
    else joined.pts.unshift(...pts.slice(1).reverse());
    markFootpaths(world);
    return joined;
  }
  const used = new Set(world.footpaths.map((p) => p.num));
  let num = 1;
  while (used.has(num)) num++;
  const fp = { id: 'f' + Math.random().toString(36).slice(2, 8), num, name: `Footpath ${num}`, pts };
  world.footpaths.push(fp);
  markFootpaths(world);
  return fp;
}

/** Remove footpaths passing within `r` cells of the line a–b. Returns how many were removed. */
export function removeFootpathsNear(world, a, b, r = 3) {
  const before = (world.footpaths || []).length;
  const dist = (p) => {
    const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L));
    return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
  };
  world.footpaths = (world.footpaths || []).filter((fp) => !fp.pts.some((p) => dist(p) <= r));
  markFootpaths(world);
  return before - world.footpaths.length;
}

/** Mark the cells the footpaths cross (world.footpath) and wear the ground along them a little. */
export function markFootpaths(world) {
  const N = world.N, n = N * N;
  if (!world.footpath || world.footpath.length !== n) world.footpath = new Uint8Array(n);
  world.footpath.fill(0);
  const tread = (x, z) => {
    if (x < 0 || z < 0 || x >= N || z >= N) return;
    const i = z * N + x;
    world.footpath[i] = 1;
    world.vegetation[i] = Math.min(world.vegetation[i], 0.4); // (trodden: no trees on the path itself)
  };
  for (const fp of world.footpaths || []) for (let k = 0; k < fp.pts.length; k++) {
    const p = fp.pts[k];
    tread(p.x, p.z);
    // (a diagonal step: the corner between is trodden too, so the trail is continuous)
    const q = fp.pts[k + 1];
    if (q && q.x !== p.x && q.z !== p.z) tread(q.x, p.z);
  }
  world.dirty = true;
}

/** Shift with the Harbour tool: close the harbour nearest (x, z) (within 8 cells). */
export function removeHarborNear(world, x, z) {
  const N = world.N;
  let best = null, bd = 8;
  for (const t of world.towns || []) {
    if (t.harbor === undefined) continue;
    const d = Math.hypot((t.harbor % N) - x, ((t.harbor / N) | 0) - z);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return null;
  world.landUse[best.harbor] = 2;
  best.harbor = undefined; best.boats = 0; best.harborLake = false; best.moleDir = undefined; best.mole = 0;
  world.dirty = true;
  return best;
}

/** Town at (or nearest to) cell i within r cells, or null. */
export function townNear(world, x, z, r = 10) {
  let best = null, bd = r;
  for (const t of world.towns || []) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; best = t; } }
  return best;
}
