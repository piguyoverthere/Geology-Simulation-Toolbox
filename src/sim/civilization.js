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
import { seasonParams, seasonalAt, drySeason } from './climate.js';
import { coastParams, isLivingBed, MARINE_ID } from './coast.js';

export const civParams = {
  enabled: true,
  growth: 1,      // how fast towns spread: new villages, hunting
  popRate: 1,     // how fast their populations increase
  farmSlope: 15,  // steepest ground (degrees) that can be farmed; steeper must be terraced flat first
  destruction: 1, // how hard towns are on the land: burning to clear it, pollution, terracing
};

const FARMS_PER_TOWN_CELL = 3; // every cell of town needs at least this many cells of farmland

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
  const PZ = world.protectedZone;
  PZ.fill(0);
  for (const s of shapes || []) {
    if (!s.protected || !s.closed || !s.points || s.points.length < 3) continue;
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
        if (inside) PZ[z * N + x] = 1;
      }
    }
  }
}
const isProtected = (world, i) => world.protectedZone && world.protectedZone[i] === 1;

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
    if (H[i] < sea || world.water[i] > 0.2 || (LU[i] !== 0 && LU[i] !== 1 && LU[i] !== 6) || isProtected(world, i)) continue;
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
  const R = Math.min(16, 5 + Math.sqrt(t.pop) / 3);
  const cands = [];
  for (let z = Math.max(2, Math.floor(cz - R)); z <= Math.min(N - 3, Math.ceil(cz + R)); z++) {
    for (let x = Math.max(2, Math.floor(cx - R)); x <= Math.min(N - 3, Math.ceil(cx + R)); x++) {
      const i = z * N + x;
      if (LU[i] === 6 || LU[i] === 5 || LU[i] === 3 || LU[i] === 4 || isProtected(world, i)) continue;
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
    H[i] = Math.max(H[i], sea + half + 0.8); world.prevHeight[i] = H[i];
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
  const R = Math.min(22, 8 + Math.sqrt(t.pop) / 3);
  const base = H[t.z * N + t.x];
  // Cut: the steepest slopes and highest knobs near the town (not paved or protected)
  const cuts = [];
  for (let z = Math.max(2, Math.floor(t.z - R)); z <= Math.min(N - 3, Math.ceil(t.z + R)); z++) {
    for (let x = Math.max(2, Math.floor(t.x - R)); x <= Math.min(N - 3, Math.ceil(t.x + R)); x++) {
      const i = z * N + x;
      if (H[i] < sea + half + 0.5 || (LU[i] && LU[i] !== 1) || isProtected(world, i) || world.water[i] > 0.1) continue;
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
    // Down toward the terrace bench below (steps of 1.5), and knobs toward the town's level
    const bench = Math.floor((H[i] - base) / 1.5) * 1.5 + base;
    const target = Math.max(sea + half + 0.8, Math.min(bench, base + 5));
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
      if ((LU[j] && LU[j] !== 1) || isProtected(world, j) || H[j] < sea + half) continue;
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
  const maxLen = Math.min(40, 4 + Math.floor(t.pop / 300));
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
    if (isProtected(world, i) || sea - H[i] > 14) { t.mole = maxLen; break; } // (too deep, or protected)
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
  const base = Math.max(H[t.z * N + t.x], sea + 1);
  const ok = (j) => (!LU[j] || LU[j] === 1) && !isProtected(world, j) && world.water[j] < 0.1;
  // The quarry face: stay on the current mountain, moving to its highest point near the workings
  if (t.quarry !== undefined) {
    const qx = t.quarry % N, qz = (t.quarry / N) | 0;
    let best = -1, bh = base + 1.5;
    for (let z = Math.max(2, qz - 6); z <= Math.min(N - 3, qz + 6); z++) for (let x = Math.max(2, qx - 6); x <= Math.min(N - 3, qx + 6); x++) {
      const j = z * N + x;
      if (ok(j) && H[j] > bh) { bh = H[j]; best = j; }
    }
    t.quarry = best >= 0 ? best : undefined;
  }
  if (t.quarry === undefined) {
    const R = Math.min(50, 15 + Math.sqrt(t.pop) / 2);
    let best = -1, bs = 0;
    for (let z = Math.max(2, Math.floor(t.z - R)); z <= Math.min(N - 3, Math.ceil(t.z + R)); z++) for (let x = Math.max(2, Math.floor(t.x - R)); x <= Math.min(N - 3, Math.ceil(t.x + R)); x++) {
      const j = z * N + x, d = Math.hypot(x - t.x, z - t.z);
      if (d > R || !ok(j)) continue;
      const score = H[j] - base - 3 - d * 0.1; // (any hill standing well above the town)
      if (score > bs) { bs = score; best = j; }
    }
    if (best < 0) return 0;
    t.quarry = best;
  }
  // Cut the top off: everything within the face's reach above the next level down
  const c = t.quarry, cx = c % N, cz = (c / N) | 0;
  const level = Math.max(base + 0.5, H[c] - 1.5 * Math.max(0.3, civParams.destruction));
  const r = 4;
  let spoil = 0;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dz * dz > r * r) continue;
    const x = cx + dx, z = cz + dz;
    if (x < 2 || z < 2 || x > N - 3 || z > N - 3) continue;
    const j = z * N + x;
    if (!ok(j) || H[j] <= level) continue;
    spoil += H[j] - level;
    H[j] = level; world.prevHeight[j] = level;
    world.terraform[j] = 1;
    world.vegetation[j] = 0; world.forestAge[j] = 0;
    if (world.soil) world.soil[j] *= 0.3;
    if (world.humus) world.humus[j] = 0;
  }
  t.quarried = (t.quarried || 0) + spoil;
  // (quarry dust and runoff foul the streams below)
  if (world.riverPollution) world.riverPollution[c] += 0.02 * spoil;
  if (spoil > 0) dumpSpoil(world, t, spoil, Math.min(30, 8 + Math.sqrt(t.pop) / 3));
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
      if (H[i] >= sea + half + 0.8 || sea - H[i] > 5 || isProtected(world, i)) continue;
      let shoreNext = false;
      for (const j of [i - 1, i + 1, i - N, i + N]) if (H[j] >= sea + half) shoreNext = true;
      if (!shoreNext) continue; // (built out from the shore)
      dumps.push([-Math.hypot(x - t.x, z - t.z) - (sea - H[i]) * 0.5, i]);
    }
  }
  dumps.sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < dumps.length && spoil > 0.01; k++) {
    const i = dumps[k][1], x = i % N, z = (i / N) | 0;
    const need = sea + half + 0.8 - H[i], put = Math.min(spoil, need, 1.2);
    H[i] += put; world.prevHeight[i] = H[i]; spoil -= put;
    if (H[i] >= sea + half + 0.75) { TF[i] = 2; world.water[i] = 0; world.vegetation[i] = 0; if (world.humus) world.humus[i] = 0; }
    smother(world, i, put); // (the dumped rock and soil smother the sea bed, cloud and foul the water)
  }
  // (no sea to take it: into the hollows near town)
  for (let k = 0; spoil > 0.01 && k < 200; k++) {
    const x = Math.round(t.x + (Math.random() - 0.5) * 2 * R), z = Math.round(t.z + (Math.random() - 0.5) * 2 * R);
    if (x < 2 || z < 2 || x > N - 3 || z > N - 3) continue;
    const i = z * N + x;
    if (LU[i] || H[i] < sea || isProtected(world, i)) continue;
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
    if (D[i] < 0.05 || H[i] < sea + 3 || LU[i] || isProtected(world, i)) continue;
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
  const N = world.N, H = world.height, sea = seaOf(world);
  let level = startLevel;
  let last = -1;
  for (const p of path) {
    const i = Math.round(p.z) * N + Math.round(p.x);
    if (i === last) continue;
    last = i;
    level -= 0.04;
    if (H[i] < sea || (world.landUse[i] && world.landUse[i] !== 1 && world.landUse[i] !== 8 && world.landUse[i] !== 9)) continue;
    const bed = Math.min(H[i] - 0.3, level);
    if (bed < sea) break;
    H[i] = bed; world.prevHeight[i] = bed;
    world.channel[i] = kind;
    world.landUse[i] = kind === 1 ? 8 : 9;
    world.civOwner[i] = owner;
    world.vegetation[i] = 0;
  }
  world.dirty = true;
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

/** Sewer: from the town centre down to the nearest river or the sea (its outfall). */
function digSewer(world, t) {
  const N = world.N, H = world.height, sea = seaOf(world), R = 70, hc = H[t.z * N + t.x];
  // (the sea if it can be reached at all: a river only when the sea is much farther)
  let best = -1, bd = Infinity;
  for (let z = Math.max(0, t.z - R); z <= Math.min(N - 1, t.z + R); z++) for (let x = Math.max(0, t.x - R); x <= Math.min(N - 1, t.x + R); x++) {
    const i = z * N + x, d = Math.hypot(x - t.x, z - t.z);
    if (d > R) continue;
    let cost;
    if (H[i] < sea - 0.3) cost = d;
    else if (world.water[i] > 0.15 && !world.channel[i] && H[i] < hc) cost = d * 3 + 15; // (a real river or lake, downhill)
    else continue;
    if (cost < bd) { bd = cost; best = i; }
  }
  if (best < 0) return false;
  const path = linePath({ x: t.x, z: t.z }, { x: best % N, z: (best / N) | 0 });
  digChannel(world, path.slice(0, -1), hc - 0.3, 2, t.num);
  t.sewerOutfall = best;
  t.sewerToSea = H[best] < sea;
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
  for (const i of newFarms) if (Math.random() < 0.18 * civParams.destruction && world.fire[i] <= 0) world.fire[i] = 0.7;
  // Accidents: a stray spark at the town's edge, more people, more risk, worst when it's dry
  if (Math.random() < 0.0015 * Math.min(4, t.pop / 300) * (0.25 + 3 * dry)) {
    const R = 6 + Math.sqrt(t.pop) / 3, a = Math.random() * Math.PI * 2;
    const x = Math.round(t.x + Math.cos(a) * R), z = Math.round(t.z + Math.sin(a) * R);
    if (x > 1 && z > 1 && x < N - 2 && z < N - 2) {
      const i = z * N + x;
      if (V[i] > 0.4 && world.water[i] < 0.05 && !(world.snow && world.snow[i] > 0.2)) { world.fire[i] = 0.8; t.lastFire = seasonParams.year || 1; }
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
      if (H[i] >= sea) continue;
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
  if (H[i] < sea + 1 || world.water[i] > 0.1 || (world.lava && world.lava[i] > 0) || (world.ice && world.ice[i] > 0.05) || isProtected(world, i)) return 0;
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
  if (!civParams.enabled) return;
  ensureCiv(world);
  const towns = world.towns;
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world);
  const P = world.paved, LU = world.landUse, OW = world.civOwner, RP = world.riverPollution;
  // --- Pollution: light near pavement, heavy downstream (always) ---------------------------
  for (let i = 0; i < n; i++) if (RP[i] > 0) RP[i] = RP[i] < 1e-3 ? 0 : RP[i] * 0.85;
  let anyPaved = false;
  // Towns' sewer outfalls (by town number)
  const sewerOf = {};
  for (const t of towns) if (t.sewerOutfall !== undefined) sewerOf[t.num] = t.sewerOutfall;
  // The sewers themselves run foul
  for (let i = 0; i < n; i++) if (world.channel[i] === 2) RP[i] = Math.max(RP[i], 1.2);
  // (a working canal is kept running from the river it taps: sluices let water in as it soaks away)
  for (let i = 0; i < n; i++) if (world.channel[i] === 1 && OW[i] && world.water[i] < 0.12) world.water[i] = 0.12;
  const sewerLoad = {};
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
        if (H[j] < sea) { if (world.pollution) world.pollution[j] = Math.min(4, world.pollution[j] + 0.004 * ind); }
        else if (world.water[j] > 0.05) RP[j] += 0.004 * ind;
      }
      // Heavy: down the drainage to the rivers and on to the sea (or, where the town has dug a
      // sewer, all of it out through the sewer's outfall)
      // (roads are not drained into sewers, but shed much less than streets and works)
      const load = 0.012 * (LU[i] === 4 ? 6 : 1) * (LU[i] === 3 ? 0.3 : 1) * civParams.destruction;
      const owner = OW[i] ? sewerOf[OW[i]] : undefined;
      if (owner !== undefined) { sewerLoad[OW[i]] = (sewerLoad[OW[i]] || 0) + load; continue; }
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
  // Each sewer pours its town's whole load out at its outfall: into the sea, spreading there, or
  // into a river, which carries it down as one foul stream to the sea
  for (const num in sewerLoad) {
    let c = sewerOf[num], load = sewerLoad[num];
    for (let k = 0; k < 200; k++) {
      if (H[c] < sea) {
        if (world.pollution) for (const j of [c, c - 1, c + 1, c - N, c + N]) if (j >= 0 && j < n && H[j] < sea) world.pollution[j] = Math.min(4, world.pollution[j] + load * (j === c ? 0.8 : 0.3));
        break;
      }
      RP[c] += Math.min(3, load * 0.5);
      const cx = c % N, cz = (c / N) | 0;
      if (cx < 1 || cz < 1 || cx > N - 2 || cz > N - 2) break;
      let low = c, lh = H[c] + world.water[c];
      for (const j of [c - 1, c + 1, c - N, c + N, c - N - 1, c - N + 1, c + N - 1, c + N + 1]) { const hj = H[j] + world.water[j]; if (hj < lh) { lh = hj; low = j; } }
      if (low === c) break;
      c = low;
    }
  }
  // Livestock: the farms' cattle, sheep, goats and pigs roam out into the woods around them and
  // graze the understory (forest health falls there: few seedlings survive)
  {
    const mask = new Float32Array(n);
    for (let i = 0; i < n; i++) if (LU[i] === 1) mask[i] = 1;
    const g = boxBlur(mask, N, 5);
    if (!world.grazing || world.grazing.length !== n) world.grazing = new Float32Array(n);
    for (let i = 0; i < n; i++) world.grazing[i] = LU[i] ? 0 : Math.min(1, g[i] * 2.5);
  }
  // Abandoned pavement breaks up and grows over; farmland with no town goes back to the wild
  const FS = world.farmSoil;
  for (let i = 0; i < n; i++) {
    if (LU[i] !== 1 && FS[i] < 1) FS[i] = Math.min(1, FS[i] + 0.0012); // (fallow ground recovers)
    if (LU[i] === 0 || OW[i] || LU[i] === 3) continue;
    if (LU[i] === 1) { LU[i] = 0; continue; }
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
      if (H[j] < sea || world.water[j] > 0.2 || isProtected(world, j)) continue;
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
    const R = Math.min(25, 4 + 2.4 * Math.sqrt(t.pop / PER_FARM_CELL));
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
          if (H[src] < sea) { if (world.pollution) world.pollution[src] = Math.min(4, world.pollution[src] + 0.0012 * civParams.destruction); }
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
    if (t.pop > 250 && Math.random() < 0.5 * civParams.growth * Math.min(1.5, civParams.destruction)) terraform(world, t, Math.max(1, Math.round(Math.min(20, 3 + Math.floor(t.pop / 250)) * civParams.destruction)));
    // A big town quarries whole hills and mountains away (harder the bigger it is)
    if (t.pop > 500 && civParams.destruction > 0) for (let q = Math.min(4, Math.floor(t.pop / 1500) + 1); q > 0; q--) if (Math.random() < 0.4 * civParams.growth * Math.min(1.5, civParams.destruction)) quarry(world, t);
    // Channels: irrigation canals out to dry fields; a sewer down to the water
    if (t.pop > 200 && farmCells > 10 && (t.canals || 0) < 3 && Math.random() < 0.03 * civParams.growth) {
      let dry = 0;
      for (let z = Math.max(0, t.z - 30); z <= Math.min(N - 1, t.z + 30); z++) for (let x = Math.max(0, t.x - 30); x <= Math.min(N - 1, t.x + 30); x++) { const i = z * N + x; if (LU[i] === 1 && OW[i] === t.num && !world.irrigated[i]) dry++; }
      if (dry > farmCells * 0.4) digCanal(world, t, NW);
    }
    // Exploratory roads out into the deep forest (more as the town grows)
    if (t.pop > 150 && (t.trails || 0) < Math.min(4, 1 + Math.floor(t.pop / 800)) && Math.random() < 0.02 * civParams.growth) exploreForest(world, t);
    if (t.pop > 1500 && t.sewerOutfall !== undefined && !t.sewerToSea && !t.seaSewerTried && Math.random() < 0.05 * civParams.growth) { t.seaSewerTried = true; const old = t.sewerOutfall; t.sewerOutfall = undefined; if (!digSewer(world, t) || !t.sewerToSea) t.sewerOutfall = old; }
    if (t.pop > 150 && t.sewerOutfall === undefined && (t.sewerTries || 0) < 6 && Math.random() < 0.05 * civParams.growth) { if (!digSewer(world, t)) t.sewerTries = (t.sewerTries || 0) + 1; }
    // A big town dams a river valley near it for a reservoir (one per town)
    if (t.pop > 700 && t.dam === undefined && Math.random() < 0.02 * civParams.growth) { if (!buildDam(world, t)) t.dam = -1; }
    // Fires: land cleared by burning, and accidents
    manMadeFires(world, t, world._newFarms || []);
    world._newFarms = [];
    // A coastal town of a few hundred armours its shore with quays (growing with the town)
    if (t.pop > 250 && fields.sea[ci] > 0.02 && (t.quay || 0) < Math.min(60, Math.floor((t.pop - 200) / 60)) && Math.random() < 0.3) buildQuay(world, t, 2);
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
          const i = z * N + x, take = F[i] * 0.02 * hunters * (1 - d2 / (HR * HR));
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
    food *= yearFactor;
    // Water: a river or lake nearby, or only wells; dirty water slows them
    const freshNear = fields.fresh[ci];
    const waterOK = freshNear > 0.02 ? 1 : 0.35;
    const dirty = Math.min(1, (RP[ci] || 0) * 0.5 + (fields.fresh[ci] > 0 ? 0 : 0));
    // (and it can only hold so many more than its streets house: it grows as fast as it builds)
    let K = Math.max(20, Math.min(food * waterOK * (1 - 0.4 * dirty), (townCells / 2 + indCells + 4) * PER_TOWN_CELL * 1.3));
    if (t.harbor === undefined && K > 1000) K = 1000; // (no harbour, no trade: it can't grow past a thousand)
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
    if (townCells < wantTown && roomForTown > 0) expand(world, t, 2, Math.min(3, wantTown - townCells, roomForTown), R, fields);
    // Worn-out fields: next to the town they are paved and built on (housing, shops, workshops);
    // farther out they are left fallow to recover. Either way the farmers clear fresh fields
    // farther out, so the town grows in rings: a core, its fields, new clearings at the edge.
    let housed = 0;
    for (const i of exhausted) {
      let nextToTown = false;
      for (const j of [i - 1, i + 1, i - N, i + N]) if ((LU[j] === 2 || LU[j] === 4) && OW[j] === t.num) nextToTown = true;
      if (nextToTown && housed < 3 && !isProtected(world, i) && slopeAt(world, i) < 0.6 && farmCells - 1 >= FARMS_PER_TOWN_CELL * (townCells + indCells + 1)) { pave(world, i, t.num, 2); housed++; farmCells--; townCells++; }
      else if (!nextToTown && Math.random() < 0.05) { LU[i] = 0; OW[i] = 0; farmCells--; } // (fallow)
    }
    t.exhausted = exhausted.length;
    // Industry: a town past ~400 people builds an industrial area on the water (river, lake or
    // coast: for transport, cooling and, alas, dumping), mass-paved, growing with the town
    const wantInd = Math.min(40, Math.max(0, Math.floor((t.pop - 400) / 110)));
    t.industry = indCells;
    if (indCells < wantInd && roomForTown > 0) buildIndustry(world, t, Math.min(3, wantInd - indCells, roomForTown), NW);
    if (farmCells < wantFarm) expand(world, t, 1, Math.min(8, wantFarm - farmCells), Math.min(45, R * 2), fields, NW);
    // (and the farmers keep clearing a little more each year even when the town isn't growing:
    // new holdings, pasture, land for the next generation)
    else if (Math.random() < 0.4 * civParams.growth) expand(world, t, 1, 1 + (Math.random() < 0.5 ? 1 : 0), Math.min(45, R * 2), fields, NW);
    // A big town sends people out to found a daughter village (linked by road)
    // (when the town is crowded: near what its land can feed)
    // (a town with boats can send them across the water, farther afield; without, only overland)
    if (t.pop > 300 && t.pop > 0.85 * K && towns.length < MAX_TOWNS && Math.random() < 0.015 * civParams.growth) {
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
      const cost = len * (1 + 14 * grade * grade + (D[j] > 0.1 ? 6 : 0) + lie - (LU[j] === 3 ? 0.6 : 0) + (isProtected(world, j) ? 60 : 0));
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
    if (H[i] < sea + 0.5 || LU[i] || isProtected(world, i)) continue;
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
    if (LU[i] !== 0 && !(use === 2 && LU[i] === 1 && OW[i] === t.num)) continue; // (towns grow over their own fields)
    if (isProtected(world, i)) continue; // (a protected zone)
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
    if ((LU[i] !== 0 && LU[i] !== 1) || H[i] < sea + 0.5 || world.water[i] > 0.1 || isProtected(world, i)) continue;
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
