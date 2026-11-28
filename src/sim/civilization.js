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
import { coastParams, isLivingBed, MARINE_ID, SHORE } from './coast.js';
import { waterParams } from './water.js';
import { SPECIES, treeShares } from './species.js';
import { cropFactor } from './pollinators.js';
import { dynParams, cropHealth } from './dynamics.js';
import { FOREST_TYPES } from './forests.js';
import { BIOMES, classifyBiome } from '../render/biomes.js';

export const civParams = {
  enabled: true,
  growth: 1,      // how fast towns spread: new villages, hunting
  popRate: 1,     // how fast their populations increase
  farmSlope: 15,  // steepest ground (degrees) that can be farmed; steeper must be terraced flat first
  farmCap: 100,   // most of the land (%) that may be farmland, all towns together (100 = no cap)
  destruction: 1, // how hard towns are on the land: burning to clear it, pollution, terracing
  quarrying: true, // whether big towns quarry hills away
  extraPlantations: false, // towns keep starting plantations even when they have all the timber they need
  plotSize: 120,  // largest plantation plot a town lays out (cells): smaller plots rotate faster
  epidemics: true, // crowded towns with dirty water suffer outbreaks of disease, spreading along their links
  invasive: true,  // plantations are planted with an invasive exotic pine that escapes into the wild forest
  clearInvasive: true, // towns cut the invasive pine out of the wild forest around them (at a cost in people)
  townParks: true,   // towns set aside small parks around a special feature, with a trail loop through each
  nationalForests: true, // each map has one or two large National Forests, where no timber is cut
  fishingQuotas: false, // towns cut back their fishing when their fishing grounds run low
  restoration: false, // towns replant native trees on their worn-out, burnt and grazed-out land, and take down dams that block fish runs
  fishLadders: false, // towns give their dams fish ladders, so runs like salmon get past
  townCores: true,    // every town grows a downtown out from its centre, entirely paved
  breakwaters: 1,     // how readily busy coastal towns pile rock breakwaters out at sea to shelter their harbours (0 = none)
  waterfronts: 1,     // how hard coastal towns build up their waterfronts: quays over the beaches, docks, dense streets behind (0 = only the odd quay)
  wildlifeCrossings: false, // towns build wildlife crossings where their roads cut through animals' ranges
  pesticides: 0.5,   // how much the farms spray: saves some crop from pests, but kills the pollinators on and around the fields
  predatorControl: 0.5, // how hard towns cull the predators that take their livestock (0 = never)
  herding: 0.3,      // herding, dogs and fencing: how well towns guard their livestock (0…1)
  fireSuppression: 0.5, // how hard towns fight the wildfires near them (0 = let them burn, 1 = put every one out)
  prescribedBurns: false, // towns burn off the fuel in their parks and nearby forest in the damp season
  climateChange: true, // the towns' greenhouse gas warms the climate and raises the sea (sim/climateChange.js)
  emissions: 1,      // how much greenhouse gas the towns give off (× the usual)
  parkRate: 1,       // how often towns make parks (and how many a town keeps; 0 = none)
  parkSize: 1,       // how large the towns' parks are made (× the usual 10–18 cells across; not Wilderness Areas)
  trailsSpread: true, // footpaths carry tree diseases and invasive pine seed (on boots), like roads
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
/** Mark cell i as an old field gone out of use (world.oldField), for the forest to take back. */
export function markOldField(world, i) {
  const n = world.N * world.N;
  if (!world.oldField || world.oldField.length !== n) world.oldField = new Uint8Array(n);
  world.oldField[i] = 1;
}

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
  for (let z = Math.max(1, Math.floor(t.z - R)); z <= Math.min(N - 2, Math.ceil(t.z + R)); z++) for (let x = Math.max(1, Math.floor(t.x - R)); x <= Math.min(N - 2, Math.ceil(t.x + R)); x++) {
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
  const wf = civParams.waterfronts ?? 1;
  const R = 5 + (Math.sqrt(t.pop) / 3) * (1 + 0.5 * wf);
  const SH = world.shore;
  const cands = [];
  for (let z = Math.max(2, Math.floor(cz - R)); z <= Math.min(N - 3, Math.ceil(cz + R)); z++) {
    for (let x = Math.max(2, Math.floor(cx - R)); x <= Math.min(N - 3, Math.ceil(cx + R)); x++) {
      const i = z * N + x;
      if (LU[i] === 6 || LU[i] === 5 || LU[i] === 3 || LU[i] === 4 || LU[i] === 13 || zoneHas(world, i, Z.earthworks)) continue;
      if (H[i] < sea - half || H[i] > sea + half + 2) continue; // (the shore, in reach of the tide)
      let seaward = false, quayNext = false;
      for (const j of [i - 1, i + 1, i - N, i + N]) { if (H[j] < sea) seaward = true; if (LU[j] === 6 || LU[j] === 5) quayNext = true; }
      if (!seaward) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d > R) continue;
      // (a built-up waterfront takes the beaches first: sand and shingle paved over for decks)
      const beach = wf > 0 && SH && (SH[i] === SHORE.sand || SH[i] === SHORE.shingle) ? 0.6 * Math.min(1, wf) : 0;
      cands.push([(quayNext ? 1 : 0) + beach - d / R + Math.random() * 0.05, i]);
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
      markBerth(world, j);
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
 * Trade (a setting, dynParams.trade): towns joined by roads in working order, or both with harbours
 * and boats, trade. Each town specialises in what its land is good for (farming, timber, mining,
 * fishing, industry), and a town with food to spare sells some of it to its partners, more to those
 * that make something else, so a trading town can grow past what its own land feeds. Worked out once
 * all the towns have been counted, and used in their next step.
 */
function tradeStep(world) {
  const towns = world.towns, byId = new Map(towns.map((t) => [t.id, t]));
  for (const t of towns) {
    const kinds = { farming: (t.farm || 0) * 1, timber: (t.timberCells || 0) * 1.2, mining: (t.mineCount || 0) * 40, fishing: (t.boats || 0) * 25, industry: (t.industry || 0) * 2 };
    t.special = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(kinds).sort((a, b) => b[1] - a[1])[0][0] : 'farming';
  }
  const ports = towns.filter((t) => t.harbor !== undefined && t.boats);
  for (const t of towns) {
    const partners = new Set();
    for (const id of t.links || []) { const u = byId.get(id); if (u) partners.add(u); }
    if (t.harbor !== undefined && t.boats) for (const u of ports) if (u !== t) partners.add(u);
    let bought = 0;
    for (const u of partners) {
      const spare = Math.max(0, (u.foodRaw || 0) - u.pop * 1.1);
      const roads = (t.links || []).includes(u.id) ? (t.roadsWorking ?? 1) : 0.8;
      bought += (spare * 0.3 * roads * (u.special !== t.special ? 1.3 : 1)) / Math.max(1, (u.links || []).length + 1);
    }
    t.tradeFood = (t.tradeFood || 0) * 0.7 + bought * 0.3;
    t.tradePartners = partners.size;
  }
}

/**
 * Town centres: every town grows a downtown out from its centre, entirely paved: solid streets,
 * squares and buildings, no gaps of grass or trees. It spreads over the gentlest ground first (a
 * cheapest-path flood from the centre), flowing round steep slopes, water and protected areas, to
 * about one cell for every 80 people, a few cells a step (civParams.townCores switches it off).
 * Fields, plantations and open ground in its way are built over; roads, industry, harbours and the
 * rest stay as they are. world.townCore holds the town's number on its centre cells.
 */
function townCoreStep(world, t) {
  if (civParams.townCores === false) return;
  const N = world.N, n = N * N, H = world.height, LU = world.landUse, OW = world.civOwner, P = world.paved;
  if (!world.townCore || world.townCore.length !== n) world.townCore = new Uint16Array(n);
  const TC = world.townCore, sea = seaOf(world), half = 0.5 * coastParams.tideRange;
  const want = Math.max(9, Math.round(t.pop / 80));
  let grow = Math.max(2, Math.round(6 * (civParams.growth ?? 1)));
  // (centre cells since turned into something else, a road, industry or another town's, are no
  // longer centre; the ones still centre are kept fully paved)
  const R = Math.ceil(Math.sqrt(want) * 3) + 4;
  for (let z = Math.max(0, t.z - R); z <= Math.min(N - 1, t.z + R); z++) for (let x = Math.max(0, t.x - R); x <= Math.min(N - 1, t.x + R); x++) {
    const i = z * N + x;
    if (TC[i] !== t.num) continue;
    if (LU[i] !== 2 || OW[i] !== t.num) TC[i] = 0;
    else { P[i] = 1; if (world.vegetation[i] > 0) world.vegetation[i] = 0; }
  }
  // (a cheapest-path flood from the centre: gentle ground is cheap, slopes dear)
  const start = t.z * N + t.x;
  const cap = want * 24 + 400;
  const cost = new Map([[start, 0]]), heap = new MinHeap(cap);
  heap.push(start, 0);
  let core = 0;
  while (heap.size && core < want) {
    const i = heap.pop();
    const c = cost.get(i);
    const x = i % N, z = (i / N) | 0;
    const u = LU[i];
    const open = u === 0 || u === 1 || u === 10 || (u === 2 && (OW[i] === t.num || !OW[i]));
    if (open) {
      if (TC[i] !== t.num) {
        if (grow <= 0) continue;
        if (u !== 2 || OW[i] !== t.num) { pave(world, i, t.num, 2); }
        P[i] = 1; world.vegetation[i] = 0; world.forestAge[i] = 0;
        if (world.irrigated) world.irrigated[i] = 0;
        TC[i] = t.num; grow--;
      } else if (P[i] < 1) P[i] = 1;
      core++;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, zz = z + dz;
      if (xx < 1 || zz < 1 || xx >= N - 1 || zz >= N - 1) continue;
      const j = zz * N + xx;
      if (H[j] < sea + half || world.water[j] > 0.3 || zoneHas(world, j, Z.towns)) continue;
      const lu = LU[j];
      // (it spreads over open ground and through its own streets and roads; other towns' ground,
      // industry, harbours, quays, dams and the like stop it)
      if (lu && lu !== 1 && lu !== 2 && lu !== 3 && lu !== 10) continue;
      if (lu === 2 && OW[j] && OW[j] !== t.num) continue;
      const slope = Math.abs(H[j] - H[i]);
      if (slope > 1.2) continue;
      const cj = c + 1 + slope * 6 + (lu === 3 ? 0 : 0.2);
      if (cj < (cost.get(j) ?? Infinity) && heap.size < cap - 1) { cost.set(j, cj); heap.push(j, cj); }
    }
  }
  t.core = core;
}

/**
 * Docks: a pier of paved deck built straight out from one of the town's quays over the water,
 * standing above the tide, with deep water dredged along both sides and off its end for ships to
 * tie up (a sharp drop-off; the sea bed there destroyed). Spaced along the waterfront.
 */
/** Dredged water kept deep for ships (beside quays and docks): spoil is never dumped there. */
function markBerth(world, i) {
  const n = world.N * world.N;
  if (!world.berth || world.berth.length !== n) world.berth = new Uint8Array(n);
  world.berth[i] = 1;
}

function buildDock(world, t) {
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world), LU = world.landUse, OW = world.civOwner;
  const half = 0.5 * coastParams.tideRange;
  const R = 8 + Math.sqrt(t.pop) / 2;
  const cands = [];
  for (let z = Math.max(3, Math.floor(t.z - R)); z <= Math.min(N - 4, Math.ceil(t.z + R)); z++) {
    for (let x = Math.max(3, Math.floor(t.x - R)); x <= Math.min(N - 4, Math.ceil(t.x + R)); x++) {
      const i = z * N + x;
      if (LU[i] !== 6 || OW[i] !== t.num) continue;
      // (straight out to sea: the one side facing open water)
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => H[i + dz * N + dx] < sea && H[i + 2 * dz * N + 2 * dx] < sea);
      if (dirs.length !== 1) continue;
      let near = false;
      for (let dz = -3; dz <= 3 && !near; dz++) for (let dx = -3; dx <= 3; dx++) { const j = i + dz * N + dx; if (j >= 0 && j < n && LU[j] === 13) { near = true; break; } }
      if (near || zoneHas(world, i, Z.earthworks)) continue;
      cands.push([i, dirs[0]]);
    }
  }
  if (!cands.length) return false;
  const [i0, [dx, dz]] = cands[Math.floor(Math.random() * cands.length)];
  const x0 = i0 % N, z0 = (i0 / N) | 0;
  const len = 2 + Math.floor(Math.random() * (2 + Math.min(4, t.pop / 1500)));
  let built = 0;
  for (let k = 1; k <= len; k++) {
    const x = x0 + dx * k, z = z0 + dz * k;
    if (x < 2 || z < 2 || x >= N - 2 || z >= N - 2) break;
    const j = z * N + x;
    if (H[j] >= sea || LU[j] || zoneHas(world, j, Z.earthworks)) break;
    pave(world, j, t.num, 13);
    H[j] = sea + half + 0.9; world.prevHeight[j] = H[j]; world.water[j] = 0;
    // Deep water dredged along both sides (and off the end)
    const side = [[-dz, dx], [dz, -dx]];
    if (k === len) side.push([dx, dz]);
    for (const [sx, sz] of side) {
      const s = j + sz * N + sx;
      if (LU[s] || H[s] >= sea) continue;
      H[s] = Math.min(H[s], sea - 2.8); world.prevHeight[s] = H[s];
      markBerth(world, s);
      if (world.marineHealth) world.marineHealth[s] = 0;
      if (world.silt) world.silt[s] = Math.min(4, world.silt[s] + 0.2);
    }
    built++;
  }
  if (built) t.docks = (t.docks || 0) + 1;
  return built > 0;
}

/**
 * A breakwater: a long mound of boulders (land use 14) piled up from the sea floor out in open
 * water off a busy waterfront, parallel to the shore and a little above high tide, in segments with
 * gaps for the water to change through. The waves break on it instead of the harbour: the water
 * behind is sheltered (sim/coast.js: less wave erosion, sand settles and the beach builds out).
 */
export function buildBreakwater(world, t) {
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world), LU = world.landUse, OW = world.civOwner;
  const half = 0.5 * coastParams.tideRange;
  const R = 10 + Math.sqrt(t.pop) / 2;
  // Which way is open sea from the waterfront: the mean direction to the sea cells around the town
  let sx = 0, sz = 0, fx = 0, fz = 0, nf = 0;
  for (let z = Math.max(2, Math.floor(t.z - R)); z <= Math.min(N - 3, Math.ceil(t.z + R)); z++) {
    for (let x = Math.max(2, Math.floor(t.x - R)); x <= Math.min(N - 3, Math.ceil(t.x + R)); x++) {
      const i = z * N + x;
      if (H[i] < sea - half) { sx += x - t.x; sz += z - t.z; }
      if ((LU[i] === 6 || LU[i] === 13) && OW[i] === t.num) { fx += x; fz += z; nf++; }
    }
  }
  const len0 = Math.hypot(sx, sz);
  if (!nf || len0 < 1) { t.breakwaters = (t.breakwaters || 0) + 1; return false; }
  const ux = sx / len0, uz = sz / len0, px = -uz, pz = ux; // (out to sea, and along the shore)
  // Start from one of the town's quays or docks, a bit to one side for a second, third one
  const ax = fx / nf, az = fz / nf, k = t.breakwaters || 0;
  const side = k === 0 ? 0 : (k % 2 ? 1 : -1) * (8 + 6 * Math.floor((k - 1) / 2));
  for (let d = 6; d <= 16; d++) {
    const cx = ax + ux * d + px * side, cz = az + uz * d + pz * side;
    const L = 9 + Math.floor(Math.random() * (5 + Math.min(10, t.pop / 600)));
    // A crest two cells wide (each stretch joined edge to edge, no diagonal gaps)
    const cells = [], seg = [];
    let ok = true;
    for (let s = -L; s <= L && ok; s++) {
      for (let o = 0; o <= 1 && ok; o++) {
        const x = Math.round(cx + px * s * 0.5 + ux * o), z = Math.round(cz + pz * s * 0.5 + uz * o);
        if (x < 4 || z < 4 || x >= N - 4 || z >= N - 4) { ok = false; break; }
        const i = z * N + x;
        if (cells.includes(i)) continue;
        const depth = sea - H[i];
        if (depth < 1.2 || depth > 14 || LU[i] || zoneHas(world, i, Z.earthworks)) { ok = false; break; }
        // (out in the water, detached: no land within a few cells)
        for (let dz = -3; dz <= 3 && ok; dz++) for (let dx = -3; dx <= 3; dx++) if (H[i + dz * N + dx] >= sea - half && LU[i + dz * N + dx] !== 14) { ok = false; break; }
        cells.push(i); seg.push(s);
      }
    }
    if (!ok || cells.length < 10) continue;
    // Piled up in segments (a gap now and then for the tide to flow through), on a skirt of
    // boulders sloping down under the water either side
    const top = sea + half + 1.1, crest = [];
    cells.forEach((i, m) => {
      const sg = seg[m] + L;
      if (sg > 3 && sg < 2 * L - 3 && sg % 13 === 12) return;
      crest.push(i);
      LU[i] = 14; OW[i] = t.num;
      H[i] = top + 0.25 * (((i * 2654435761) >>> 0) / 4294967296); world.prevHeight[i] = H[i];
      world.water[i] = 0; world.vegetation[i] = 0;
      if (world.marineHealth) world.marineHealth[i] = 0;
      if (world.silt) world.silt[i] = Math.min(4, world.silt[i] + 0.3);
    });
    for (const i of crest) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const j = i + dz * N + dx;
      if (LU[j] === 14) continue;
      const toe = sea - half - 0.5;
      if (H[j] < toe) { H[j] = toe; world.prevHeight[j] = toe; }
      for (let ez = -1; ez <= 1; ez++) for (let ex = -1; ex <= 1; ex++) { // (and the skirt's foot)
        const q = j + ez * N + ex, foot = sea - half - 2;
        if (LU[q] !== 14 && H[q] < foot) { H[q] = foot; world.prevHeight[q] = foot; }
      }
    }
    t.breakwaters = k + 1;
    world.dirty = true;
    return true;
  }
  t.breakwaters = k + 1; // (nowhere suitable: don't keep trying)
  return false;
}

/**
 * Waterfront sprawl: the ground behind a busy waterfront fills up with dense streets (warehouses,
 * offices, flats), the nearest open ground to the town's quays and docks first.
 */
export function waterfrontSprawl(world, t, count) {
  const N = world.N, H = world.height, sea = seaOf(world), LU = world.landUse, OW = world.civOwner;
  const half = 0.5 * coastParams.tideRange;
  const R = 8 + Math.sqrt(t.pop) / 2;
  const front = [];
  for (let z = Math.max(1, Math.floor(t.z - R)); z <= Math.min(N - 2, Math.ceil(t.z + R)); z++) for (let x = Math.max(1, Math.floor(t.x - R)); x <= Math.min(N - 2, Math.ceil(t.x + R)); x++) {
    const i = z * N + x;
    if ((LU[i] === 6 || LU[i] === 13) && OW[i] === t.num) front.push([x, z]);
  }
  if (!front.length) return 0;
  const cands = [];
  const D = 5;
  for (const [fx, fz] of front) {
    for (let dz = -D; dz <= D; dz++) for (let dx = -D; dx <= D; dx++) {
      const x = fx + dx, z = fz + dz;
      if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
      const i = z * N + x;
      if ((LU[i] && LU[i] !== 1) || H[i] < sea + half || world.water[i] > 0.3) continue;
      if (zoneHas(world, i, Z.towns) || (world.footpath && world.footpath[i])) continue;
      cands.push([Math.hypot(dx, dz) + Math.random() * 0.8, i]);
    }
  }
  cands.sort((a, b) => a[0] - b[0]);
  let built = 0;
  for (const [, i] of cands) {
    if (built >= count) break;
    if (LU[i] && LU[i] !== 1) continue;
    pave(world, i, t.num, 2);
    built++;
  }
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
      if (world.berth && world.berth[i]) continue; // (dredged berths beside the quays and docks are kept deep)
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
  let woodNow = 0;
  const N2 = N * N, fell = (i) => {
    // (the wood it yields: more from grown trees; in a native plantation, wild pine that got in is no timber)
    const yieldWood = V[i] * (civParams.invasive || !world.invasive ? 1 : 1 - world.invasive[i]);
    world.woodCut = (world.woodCut || 0) + yieldWood;
    woodNow += yieldWood;
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
  // (the felled wood goes into the town's stock; its average income, for when the stock runs dry)
  t.woodStock = (t.woodStock ?? 40) + woodNow;
  t.woodIn = (t.woodIn || 0) * 0.95 + woodNow * 0.05;
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
export function fishing(world, t) {
  const N = world.N, H = world.height, sea = seaOf(world), boats = t.boats;
  const hx = t.harbor % N, hz = (t.harbor / N) | 0, FR = 10 + 3 * Math.sqrt(boats);
  t.fishRange = FR;
  let prod = 0, cells = 0, caught = 0, stock = 0, cap = 0;
  // Quotas: when the town's fishing grounds have run low (under half), it cuts its catch back hard
  // so they can recover, and fishes freely again once they have
  // (t.fishGrounds: how full its grounds are, as a share of what the water there can hold; under a
  // quota the catch is cut back from half full, and stopped altogether near a collapse)
  const quota = civParams.fishingQuotas && t.fishGrounds !== undefined && t.fishGrounds < 0.5 ? Math.max(0, (t.fishGrounds - 0.25) / 0.25) : 1;
  t.quota = quota < 1;
  const seaAnimals = (world.animals || []).filter((a) => a.habitat === 'sea' || a.habitat === 'coast' || a.habits.runsRivers);
  for (let z = Math.max(0, Math.floor(hz - FR)); z <= Math.min(N - 1, Math.ceil(hz + FR)); z++) {
    for (let x = Math.max(0, Math.floor(hx - FR)); x <= Math.min(N - 1, Math.ceil(hx + FR)); x++) {
      const i = z * N + x;
      if (H[i] >= sea || zoneHas(world, i, Z.fishing)) continue; // (not in a marine reserve)
      const d = Math.hypot(x - hx, z - hz);
      if (d > FR) continue;
      // (fishing effort here; with quotas, cut back as the town's grounds run low)
      const e = boats * 0.0035 * (1 - d / FR) / Math.max(1, FR / 10) * quota;
      const FS = world.fishStock;
      // (how full the grounds are, weighted by where the boats fish hardest: near the harbour)
      if (FS) { const wgt = 1 - d / FR; stock += FS[i] * wgt; cap += (world.fishK ? world.fishK[i] : 1) * wgt; FS[i] = Math.max(0, FS[i] - FS[i] * Math.min(0.3, 0.4 * e)); }
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
  // (how much fish the town's grounds hold: the catch is only what's there)
  t.fishGrounds = cells && world.fishStock && cap > 0 ? stock / cap : 1;
  return boats * 40 * (cells ? prod / cells : 0) * (world.fishStock ? Math.min(1, t.fishGrounds * 1.3) : 1) * quota + caught * 1500;
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
  if (world.footpaths && world.footpaths.length > 3 && Math.random() < 0.1) thinFootpaths(world);
  if (!civParams.enabled) return;
  ensureCiv(world);
  const towns = world.towns;
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world);
  const P = world.paved, LU = world.landUse, OW = world.civOwner, RP = world.riverPollution;
  farmCapStep(world);
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
    if (world.bridge[i] || (LU[i] >= 5 && LU[i] <= 9) || LU[i] === 13 || LU[i] === 14) continue; // (not harbours, quays, dams, channels, docks or breakwaters: built to stand out or sink)
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
    if (LU[i] === 14) continue; // (a breakwater's boulders stay where they were piled, long after its town)
    if (LU[i] === 1 || LU[i] === 10) { if (LU[i] === 1) markOldField(world, i); LU[i] = 0; continue; } // (fields and plantations go back to the wild)
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
  fishStockStep(world); // (the sea's fish breed back, and drift)
  if (civParams.nationalForests && towns.length) nationalForestStep(world); // (only once there is a civilization to set them aside)
  if (!towns.length) { world.civPop = 0; if (world.popDensity) world.popDensity.fill(0); airPollutionStep(world); desertStep(world); invasiveStep(world); return; } // (the smoke, worn land and pine carry on without towns)
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
        if (fSlope > (world.terraform[i] === 1 ? Math.max(1, Math.tan((civParams.farmSlope * Math.PI) / 180) * 1.3) : Math.tan((civParams.farmSlope * Math.PI) / 180) * 1.3)) { LU[i] = 0; OW[i] = 0; world.irrigated[i] = 0; markOldField(world, i); continue; }
        const f = fertility(world, i, fSlope) * (watered ? 1.2 : 1) * (0.15 + 0.85 * FS[i]);
        // (burnt, flooded or snowbound fields yield little)
        const lost = world.fire[i] > 0 || world.burnt[i] > 0.5 || world.water[i] > 0.4 || (world.snow && world.snow[i] > 0.5 && ph > 0.1 && ph < 0.55) ? 0.2 : 1;
        food += PER_FARM_CELL * f * lost * cropFactor(world, i) * cropHealth(world, i); // (and how well the pollinators reach it; pests and salt)
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
    restorationStep(world, t);
    townCoreStep(world, t); // (its downtown: solid pavement, sprawling out as it grows)
    // Fish ladders on the town's dam, and wildlife crossings on its roads
    if (civParams.fishLadders && t.dam >= 0 && t.dam !== undefined) {
      if (!world.fishLadder || world.fishLadder.length !== n) world.fishLadder = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (LU[i] === 7 && OW[i] === t.num) world.fishLadder[i] = 1;
    }
    if (civParams.wildlifeCrossings && t.pop > 500 && Math.random() < 0.05 * civParams.growth) buildCrossing(world, t);
    // A big town dams a river valley near it for a reservoir (one per town)
    if (t.pop > 700 && t.dam === undefined && Math.random() < 0.02 * civParams.growth) { if (!buildDam(world, t)) t.dam = -1; }
    // Fires: land cleared by burning, and accidents
    manMadeFires(world, t, world._newFarms || []);
    world._newFarms = [];
    // A coastal town of a few hundred armours its shore with quays (growing with the town)
    const wf = civParams.waterfronts ?? 1;
    if (t.pop > 250 - 100 * Math.min(1, wf) && fields.sea[ci] > 0.02 && (t.quay || 0) < Math.floor(((t.pop - 150) / 60) * (1 + 2 * wf)) && Math.random() < 0.3 + 0.2 * wf) buildQuay(world, t, 2 + Math.round(2 * wf));
    // …and a built-up waterfront: docks out into the water, dense streets packed in behind the quays
    if (wf > 0 && (t.quay || 0) >= 4) {
      if ((t.docks || 0) < Math.floor((t.quay || 0) / 6) && Math.random() < 0.25 * wf) buildDock(world, t);
      const bwk = civParams.breakwaters ?? 1;
      if (bwk > 0 && t.pop > 500 && (t.breakwaters || 0) < Math.min(6, Math.floor(bwk * (1 + t.pop / 2500))) && Math.random() < 0.08 * bwk) buildBreakwater(world, t);
      if (Math.random() < 0.5 * wf) waterfrontSprawl(world, t, Math.round(4 + 6 * wf));
    }
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
    // Livestock and predators: predators near the town's grazing land take its livestock (less with
    // good herding and fencing), and the town culls them (Predator control): kill off the wolves and
    // the deer they kept in check can boom and strip the young trees
    t.livestockLost = 0;
    if (world.animals && world.animals.length && world.grazing) {
      const preds = world.animals.filter((a) => a.prey.length && ['land', 'forest', 'meadow', 'mountains'].includes(a.habitat));
      if (preds.length) {
        const R = 15 + Math.sqrt(t.pop) / 2;
        const x0 = Math.max(0, Math.floor(t.x - R)), x1 = Math.min(N - 1, Math.ceil(t.x + R));
        const z0 = Math.max(0, Math.floor(t.z - R)), z1 = Math.min(N - 1, Math.ceil(t.z + R));
        const guard = Math.max(0, Math.min(1, civParams.herding ?? 0.3));
        const cull = (civParams.predatorControl ?? 0.5) * (1 - 0.5 * guard);
        for (const a of preds) {
          const F = world['animal_' + a.id];
          if (!F) continue;
          for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
            const i = z * N + x, g = world.grazing[i] + (LU[i] === 1 ? 0.5 : 0);
            if (F[i] <= 0.001 || (x - t.x) ** 2 + (z - t.z) ** 2 > R * R) continue;
            if (g > 0.05) t.livestockLost += F[i] * g * (1 - 0.8 * guard);
            if (cull > 0 && !zoneHas(world, i, Z.hunting)) F[i] -= F[i] * 0.04 * cull * (g > 0.05 ? 1.5 : 0.5);
          }
        }
        food -= Math.min(food * 0.3, t.livestockLost * 600);
      }
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
    // (and when the wells have been pumped nearly dry, water runs short)
    const waterOK = (freshNear > 0.02 ? 1 : 0.35) * (t.wellsDry ? 0.7 : 1);
    const dirty = Math.min(1, (RP[ci] || 0) * 0.5 + (fields.fresh[ci] > 0 ? 0 : 0));
    // (and it can only hold so many more than its streets house: it grows as fast as it builds)
    t.foodRaw = food;
    // (trade, sim/dynamics.js: food bought from the towns it trades with)
    if (dynParams.trade && t.tradeFood) food += t.tradeFood;
    let K = Math.max(20, Math.min(food * waterOK * (1 - 0.4 * dirty), (townCells / 2 + indCells + 4) * PER_TOWN_CELL * 1.3));
    if (t.harbor === undefined && K > 1000) K = 1000; // (no harbour, no trade: it can't grow past a thousand)
    // Timber: a town burns and builds with wood all the time (more people, more wood). Its stock is
    // filled by felling its plantations; a small village gets by gathering fallen wood from the forest
    // around it, but a town can't. When the stock runs out and the wood coming in doesn't cover what
    // it uses, it can support far fewer people (down to about a third) until timber flows again.
    {
      const use = t.pop * 0.0015;
      const gather = Math.min(0.15 + 0.0004 * t.pop, 0.004 * t.pop) * (0.2 + 0.8 * Math.min(1, (fields.forest ? fields.forest[ci] : 0.5) * 1.5));
      t.woodStock = Math.max(0, Math.min(use * 80 + 20, (t.woodStock ?? 40) + gather - use));
      t.woodNeed = use;
      if (t.woodStock <= 0.001) {
        t.woodSupply = Math.min(1, ((t.woodIn || 0) + gather) / Math.max(0.01, use));
        K *= 0.35 + 0.65 * t.woodSupply;
      } else t.woodSupply = 1;
    }
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
      else if (!nextToTown && Math.random() < 0.05) { LU[i] = 0; OW[i] = 0; farmCells--; markOldField(world, i); } // (fallow)
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
    // Clearing the invasive pine out of the forest around it
    if (civParams.clearInvasive) clearInvasives(world, t, R);
    // Parks: a growing town sets aside small areas around something special in the forest near it
    if (civParams.townParks) { parkStep(world, t); oldGrowthStep(world, t); wildernessStep(world, t); oldTrailStep(world, t); }
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
  if (dynParams.trade) tradeStep(world); else for (const t of world.towns) t.tradeFood = 0;
  populationField(world);
  // People on the move, disease, smoke and worn-out land
  migrationStep(world, world.towns);
  if (civParams.epidemics) epidemicStep(world, world.towns);
  airPollutionStep(world);
  desertStep(world);
  invasiveStep(world);
  world.dirty = true;
}

/**
 * The sea takes what it covers: wherever the land goes under the sea for good (a rising sea, the
 * ground sinking, the coast eroding back), the towns' streets, roads, industry, harbours, quays,
 * dams and mines there are washed away, and a town whose centre goes under is lost with them (its
 * people gone). Bridges stand until the water is well over them. Footpaths under the sea go too.
 * Runs whether or not Civilization is on. Returns the towns washed away.
 */
export function washAway(world) {
  const sea = seaOf(world);
  if (sea < -1e8 || !world.landUse) return [];
  const N = world.N, n = N * N, H = world.height, LU = world.landUse, OW = world.civOwner, P = world.paved;
  const B = world.bridge, CX = world.crossing, FL = world.fishLadder, FP = world.footpath;
  for (let i = 0; i < n; i++) {
    const u = LU[i];
    if (H[i] >= sea) continue;
    if (FP && FP[i]) FP[i] = 0;
    if (!u || u === 1 || u === 10 || u === 8) continue; // (fields, plantations and canals: civStep)
    if (B && B[i] && H[i] > sea - 1) continue; // (a bridge, until the water is well over it)
    LU[i] = 0; if (OW) OW[i] = 0; if (P) P[i] = 0;
    if (world.roadCond) world.roadCond[i] = 0;
    if (B) B[i] = 0;
    if (CX) CX[i] = 0;
    if (FL) FL[i] = 0;
    if (world.channel) world.channel[i] = 0;
  }
  const lost = [];
  for (const t of [...(world.towns || [])]) {
    const c = t.z * N + t.x;
    if (H[c] < sea) { lost.push(t); removeTown(world, t); }
  }
  if (lost.length) world.dirty = true;
  return lost;
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
  if (!world.fireSmoke || world.fireSmoke.length !== n) world.fireSmoke = new Float32Array(n);
  const A = world.airPollution, S = world.fireSmoke, F = world.fire, k = civParams.destruction;
  for (let i = 0; i < n; i++) {
    const lu = LU[i];
    if (lu === 4) A[i] += 0.05 * k;
    else if (lu === 2) A[i] += 0.006 * k;
    else if (lu === 11 || lu === 12) A[i] += 0.015 * k;
    // Wildfires pour out smoke, far more than any town (but soot and ash, not the sulphur that
    // makes acid rain): kept apart in world.fireSmoke
    if (F && F[i] > 0) S[i] += 0.5 * Math.min(1, F[i]) + 0.15;
  }
  // Drift downwind (about 2 cells a step) and spread
  const a = ((climateParams.windAngle || 0) * Math.PI) / 180, ux = Math.cos(a) * 2, uz = Math.sin(a) * 2;
  const drift = (A, keep) => {
    const B = new Float32Array(n);
    let any = false;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const sx = Math.round(x - ux), sz = Math.round(z - uz);
      if (sx < 0 || sz < 0 || sx >= N || sz >= N) continue;
      const v = A[sz * N + sx];
      if (v) { B[z * N + x] = v; any = true; }
    }
    if (!any) { A.fill(0); return; }
    const C = boxBlur(B, N, 1);
    for (let i = 0; i < n; i++) A[i] = C[i] * keep < 1e-4 ? 0 : Math.min(3, C[i] * keep);
  };
  drift(A, 0.9);
  drift(S, waterParams.rain > 0.01 ? 0.75 : 0.88); // (smoke clears faster than the towns' haze, and rain washes it down)
  // Acid rain where the towns' smoke settles
  const FH = world.forestHealth, V = world.vegetation, FS = world.farmSoil;
  for (let i = 0; i < n; i++) {
    const s = A[i];
    if (s < 0.03) continue;
    if (FH) FH[i] = Math.max(0, FH[i] - 0.01 * s);
    if (V[i] > 0.66 && s > 0.25) V[i] -= 0.004 * s; // (trees dying back)
    if (LU[i] === 1 && FS) FS[i] = Math.max(0, FS[i] - 0.0006 * s);
  }
  // Smoke over a town makes people ill: a few of the old and the weak die in a smoky spell
  for (const t of world.towns || []) {
    const i = t.z * N + t.x, s = S[i] || 0;
    t.smoky = s > 0.1;
    if (s > 0.1) t.pop = Math.max(20, t.pop * (1 - 0.004 * Math.min(2, s)));
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
  // (with Invasive plantation pine on, every plantation is pine; off, the plantations are replanted
  // with native trees at once and kept clear of pine, but the pine already loose in the wild keeps
  // spreading through the wild forest)
  const pinePlant = civParams.invasive;
  if (!pinePlant && !world.invasive) return;
  if (!world.invasive || world.invasive.length !== n) world.invasive = new Float32Array(n);
  const I = world.invasive, FH = world.forestHealth;
  let any = false;
  for (let i = 0; i < n; i++) if (LU[i] === 10) { I[i] = pinePlant ? 1 : 0; any ||= pinePlant; } else if (I[i] > 0) any = true;
  if (!any) return;
  const next = I.slice();
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = z * N + x;
    if (LU[i] === 10) continue; // (pine, or native and weeded)
    const OF = world.oldField;
    if (!LU[i] && OF && OF[i]) {
      // An old field: the pine is a pioneer on bare, disturbed ground, quick to take it over from
      // nearby (or from seed come down a road), and grows it up into pine forest
      let s0 = (I[i - 1] + I[i + 1] + I[i - N] + I[i + N]) * 0.25;
      for (const j of [i - 1, i + 1, i - N, i + N]) if (world.roadSeed && world.roadSeed[j] > 0.15) s0 = Math.max(s0, 0.3);
      if (s0 > 0.01 || I[i] > 0) {
        next[i] = Math.min(1, I[i] + 0.12 * Math.max(s0, I[i]) * (1 - I[i]) + (s0 > 0.05 && I[i] < 0.1 ? 0.1 : 0));
        V[i] = Math.min(0.85, V[i] + 0.008 * next[i]); // (growing up into pine forest)
      }
      continue;
    }
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
  // (footpaths too, with the Trails spread setting on: fewer feet, so it fades sooner along them)
  const FP = civParams.trailsSpread && world.footpath && world.footpath.length === n ? world.footpath : null;
  const way = (i) => LU[i] === 3 || (FP && FP[i] === 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (!way(i)) { RS[i] = 0; continue; }
      let s = RS[i] * 0.985;
      for (const j of [i - 1, i + 1, i - N, i + N]) {
        if (way(j)) s = Math.max(s, RS[j] * (LU[j] === 3 ? 0.97 : 0.95));
        else if (I[j] > 0.5) s = 1; // (picks it up from invaded forest or a plantation beside it)
      }
      RS[i] = s;
    }
  }
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = z * N + x;
    if (LU[i] || V[i] < 0.5) continue;
    let s = 0;
    for (const j of [i - 1, i + 1, i - N, i + N]) if (way(j) && RS[j] > s) s = RS[j];
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

/**
 * A town clears the invasive pine only where it must: where it presses on the town's own land, its
 * fields, streets and works, or has got into its plantations (when they're planted with native
 * trees). Work gangs cut it out there, the worst first. The work is hard and takes people away
 * (some leave, some are lost to accidents, the rest are kept from the fields): the town loses about
 * one person for every 0.4 of a cell's worth of pine it clears. The cut pine is worthless as timber
 * (it isn't added to the town's wood).
 */
function clearInvasives(world, t, R) {
  const I = world.invasive, LU = world.landUse, OW = world.civOwner, N = world.N;
  if (!I || t.pop < 150 || Math.random() > 0.25) return;
  const pinePlant = civParams.invasive;
  const reach = Math.ceil(R * 2);
  const budget = Math.min(6, t.pop * 0.003); // (cells' worth of pine the gangs can clear this step)
  // (its own land: fields, streets, works, and native plantations)
  const own = (j) => OW[j] === t.num && (LU[j] === 1 || LU[j] === 2 || LU[j] === 4 || (LU[j] === 10 && !pinePlant));
  const cands = [];
  for (let z = Math.max(2, t.z - reach); z <= Math.min(N - 3, t.z + reach); z += 1) for (let x = Math.max(2, t.x - reach); x <= Math.min(N - 3, t.x + reach); x += 1) {
    const i = z * N + x;
    if (I[i] < 0.1) continue;
    // (in its native plantation, or pressing right up against its land)
    let pressing = LU[i] === 10 && !pinePlant && OW[i] === t.num;
    if (!pressing && !LU[i]) for (const j of [i - 1, i + 1, i - N, i + N, i - 2, i + 2, i - 2 * N, i + 2 * N]) if (own(j)) { pressing = true; break; }
    if (pressing) cands.push(i);
  }
  if (!cands.length) return;
  cands.sort((a, b) => I[b] - I[a]);
  let cleared = 0;
  for (const i of cands) {
    if (cleared >= budget) break;
    cleared += I[i];
    I[i] = 0;
    if (!LU[i]) world.vegetation[i] = Math.min(world.vegetation[i], 0.55); // (a gap where the pines were: the natives fill it)
  }
  if (!cleared) return;
  const lost = cleared / 0.4;
  t.pop = Math.max(20, t.pop - lost);
  t.invCleared = (t.invCleared || 0) + cleared;
  t.invLost = (t.invLost || 0) + lost;
}

// --- Overgrazing ------------------------------------------------------------------------------

/**
 * Desertification: in dry country the farms' livestock strip the grass and scrub around the fields
 * down to the soil, which blows and washes away: the land degrades toward desert (world.degraded,
 * 0…1), plants can't grow back there, and the bare ground creeps outward. Taken off grazing (or with
 * more rain) it slowly recovers.
 */
/**
 * The sea's fish (world.fishStock, 0…1 of what the water can hold): they breed back towards what
 * the sea there can feed (healthy beds, oxygen, clean water), fastest at half full, and drift
 * through the sea (so a marine reserve, where no one fishes, restocks the water round it). Fished
 * down below about a fifth they can no longer find mates and spawn well, and recover only very
 * slowly: a collapse.
 */
export function fishStockStep(world) {
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world);
  if (!world.fishStock || world.fishStock.length !== n) { world.fishStock = new Float32Array(n); for (let i = 0; i < n; i++) world.fishStock[i] = H[i] < sea ? 0.9 : 0; }
  const FS = world.fishStock;
  if (!world.fishK || world.fishK.length !== n) world.fishK = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (H[i] >= sea) { FS[i] = 0; world.fishK[i] = 0; continue; }
    const m = world.marine ? world.marine[i] : -1, hl = world.marineHealth ? world.marineHealth[i] : 1;
    const K = Math.max(0.05, (0.5 + 0.5 * (isLivingBed(m) ? hl : 0.6)) * (world.oxygen ? world.oxygen[i] : 1) * (1 - Math.min(0.6, (world.pollution ? world.pollution[i] : 0) * 0.3)));
    world.fishK[i] = K;
    const s = FS[i];
    const collapse = s < 0.2 ? Math.max(0.05, (s - 0.05) / 0.15) : 1; // (too few to spawn well)
    FS[i] = Math.max(0, Math.min(K, s + 0.03 * s * (1 - s / K) * collapse + (s < 0.01 ? 0 : 0)));
  }
  // (they move about: a little of each cell's mixes with its neighbours')
  const B = boxBlur(FS, N, 2);
  for (let i = 0; i < n; i++) if (H[i] < sea) FS[i] += (B[i] - FS[i]) * 0.15;
}

/**
 * Restoration (a setting): a town replants native trees on the worn-out, burnt and grazed-out land
 * around it (more when it's bigger and wild land near it is scarce), and takes down its dam if the
 * dam stands in the way of a fish run.
 */
function restorationStep(world, t) {
  if (!civParams.restoration || t.pop < 400) return;
  const N = world.N, LU = world.landUse, V = world.vegetation, DG = world.degraded, B = world.burnt, OF = world.oldField;
  const R = 12 + Math.sqrt(t.pop) / 2, scarce = Math.max(0, 0.5 - localForest(world, t.x, t.z));
  const tries = Math.round((2 + t.pop / 500) * (1 + 2 * scarce));
  for (let k = 0; k < tries; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * R;
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
    const i = z * N + x;
    if (LU[i] || world.water[i] > 0.1 || world.height[i] < seaOf(world)) continue;
    const worn = (DG && DG[i] > 0.15) || (B && B[i] > 0.3) || (OF && OF[i]) || (world.grazing && world.grazing[i] > 0.5 && V[i] < 0.5);
    if (!worn) continue;
    // (seedlings planted: the land heals, and trees take hold)
    if (DG) DG[i] = Math.max(0, DG[i] - 0.15);
    if (world.grazing) world.grazing[i] *= 0.5;
    if (V[i] < 0.55 && world.soil[i] > 0.2) V[i] = Math.min(0.62, V[i] + 0.12);
    if (!world.replanted || world.replanted.length !== N * N) world.replanted = new Uint8Array(N * N);
    world.replanted[i] = 1;
    t.replanted = (t.replanted || 0) + 1;
  }
  // (a dam standing in the way of a fish run comes down)
  if (t.dam >= 0 && t.dam !== undefined && (world.animals || []).some((an) => an.habits.runsRivers) && !(world.fishLadder && world.fishLadder[t.dam]) && Math.random() < 0.01) {
    for (let i = 0; i < N * N; i++) if (LU[i] === 7 && world.civOwner[i] === t.num) { LU[i] = 0; world.paved[i] = 0; world.civOwner[i] = 0; if (world.dam) world.dam[i] = 0; }
    t.dam = -2; // (taken down: not rebuilt)
  }
}

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
export function routeRoad(world, a, b, foot = false) {
  const FPm = foot ? world.footpath : null; // (a footpath keeps to the paths already trodden where it can)
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
      const cost = len * (1 + 14 * grade * grade + (D[j] > 0.1 ? 6 : 0) + lie - (LU[j] === 3 ? 0.6 : 0) + (zoneHas(world, j, Z.roads) ? 60 : 0)) * (FPm && FPm[j] ? 0.2 : 1);
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
  // (the farmland cap: no more fields once the map's farmland reaches it)
  if (use === 1 && (civParams.farmCap ?? 100) < 100 && world.landCells) {
    const room = Math.floor((civParams.farmCap / 100) * world.landCells) - (world.farmCells || 0);
    count = Math.max(0, Math.min(count, room));
    world.farmCells = (world.farmCells || 0) + Math.min(count, cands.length);
  }
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
 * The farmland cap (civParams.farmCap, % of the land): counts the map's land and farmland for the
 * towns' growth, and where there's more farmland than the cap allows (the cap was lowered), the
 * fields farthest from their towns are given up a few at a time (left fallow as old fields that go
 * back to the wild).
 */
function farmCapStep(world) {
  const N = world.N, n = N * N, H = world.height, LU = world.landUse, OW = world.civOwner, sea = seaOf(world);
  let land = 0, farms = 0;
  for (let i = 0; i < n; i++) { if (H[i] >= sea) land++; if (LU[i] === 1) farms++; }
  world.landCells = land; world.farmCells = farms;
  const cap = civParams.farmCap ?? 100;
  if (cap >= 100) return;
  const excess = farms - Math.floor((cap / 100) * land);
  if (excess <= 0) return;
  const at = {};
  for (const t of world.towns || []) at[t.num] = t;
  const far = [];
  for (let i = 0; i < n; i++) {
    if (LU[i] !== 1) continue;
    const t = at[OW[i]];
    far.push([t ? Math.hypot((i % N) - t.x, ((i / N) | 0) - t.z) : 1e9, i]);
  }
  far.sort((a, b) => b[0] - a[0]);
  const drop = Math.min(far.length, Math.max(20, Math.ceil(excess * 0.1)), excess);
  for (let k = 0; k < drop; k++) {
    const i = far[k][1];
    LU[i] = 0; OW[i] = 0; world.irrigated[i] = 0;
    markOldField(world, i);
  }
  world.farmCells = farms - drop;
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
export function addFootpath(world, a, b, join = true) {
  ensureCiv(world);
  const N = world.N;
  if (!world.footpaths) world.footpaths = [];
  let pts = routeRoad(world, a, b, true);
  if (!pts || pts.length < 2) {
    const len = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    pts = [];
    for (let k = 0; k <= len; k++) pts.push({ x: Math.round(a.x + ((b.x - a.x) * k) / len), z: Math.round(a.z + ((b.z - a.z) * k) / len) });
  }
  pts = pts.map((p) => ({ x: Math.round(p.x), z: Math.round(p.z) }));
  // Starting at the end (or the start) of a footpath carries that footpath on: one continuous path,
  // laid a stretch at a time
  let joined = null, atEnd = true, bd = 4;
  if (join) for (const fp of world.footpaths) {
    if (!fp.pts || !fp.pts.length) continue;
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

/**
 * Cut out the stretches of footpath within `r` cells of the line a–b (Footpath tool, Shift-drag):
 * only the part dragged across goes; what's left on either side stays as footpaths of their own (the
 * first keeps the name, the others are numbered after it). Returns how many stretches were cut.
 */
export function removeFootpathsNear(world, a, b, r = 2) {
  const dist = (p) => {
    const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L));
    return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
  };
  const out = [];
  let cut = 0;
  const used = new Set((world.footpaths || []).map((p) => p.num));
  for (const fp of world.footpaths || []) {
    if (!fp.pts.some((p) => dist(p) <= r)) { out.push(fp); continue; }
    cut++;
    const runs = [];
    let run = [];
    for (const p of fp.pts) {
      if (dist(p) <= r) { if (run.length) runs.push(run); run = []; } else run.push(p);
    }
    if (run.length) runs.push(run);
    const keep = runs.filter((rn) => rn.length >= 3);
    keep.forEach((pts, k) => {
      if (k === 0) { out.push({ ...fp, pts }); return; }
      let num = 1;
      while (used.has(num)) num++;
      used.add(num);
      out.push({ ...fp, id: 'f' + Math.random().toString(36).slice(2, 8), num, name: `${fp.name} (${k + 1})`, pts });
    });
  }
  world.footpaths = out;
  markFootpaths(world);
  return cut;
}

/** Mark the cells the footpaths cross (world.footpath) and wear the ground along them a little. */
/** Share of the ground within r cells of (x, z) that is footpath. */
function pathDensity(world, x, z, r = 10) {
  const N = world.N, FP = world.footpath;
  if (!FP) return 0;
  let on = 0, all = 0;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dz * dz > r * r) continue;
    const xx = Math.round(x + dx), zz = Math.round(z + dz);
    if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
    all++; if (FP[zz * N + xx]) on++;
  }
  return all ? on / all : 0;
}
const CROWDED = 0.07; // (paths on more than this share of the ground around: no new trail there)

/**
 * Where a new trail out to (dest) starts: from the nearest point of the footpaths already there when
 * that's much nearer than (from), so trails branch off the network rather than each running all the
 * way out from town alongside the others.
 */
function trailStart(world, dest, from) {
  let best = from, bd = Math.hypot(from.x - dest.x, from.z - dest.z) * 0.7;
  for (const fp of world.footpaths || []) for (const p of fp.pts || []) {
    const d = Math.hypot(p.x - dest.x, p.z - dest.z);
    if (d < bd) { bd = d; best = { x: p.x, z: p.z }; }
  }
  return best;
}

/**
 * Thin out trails where the towns have laid too many: wherever footpaths cover more than about a
 * sixth of the ground around, the newest town-made trails through there are taken up (and grow
 * over) until it's thin enough. Paths you drew are never touched, and a park keeps at least one trail.
 */
export function thinFootpaths(world) {
  const fps = world.footpaths || [];
  if (fps.length < 4 || !world.footpath) return 0;
  const N = world.N;
  let removed = 0;
  for (let round = 0; round < 12; round++) {
    const dens = boxBlur(Float32Array.from(world.footpath), N, 7);
    let victim = null;
    for (let k = fps.length - 1; k >= 0 && !victim; k--) {
      const f = fps[k];
      if (!f.park && !f.spot) continue; // (only the towns' own trails)
      if (f.park) {
        const site = (world.parkSites || []).find((p) => p.id === f.park);
        const others = fps.filter((g) => g !== f && g.park === f.park).length;
        if (site && others === 0) continue; // (a park's only trail stays)
      }
      let sum = 0, c = 0;
      for (const p of f.pts) { if (p.x >= 0 && p.z >= 0 && p.x < N && p.z < N) { sum += dens[p.z * N + p.x]; c++; } }
      if (c && sum / c > 0.16) victim = f;
    }
    if (!victim) break;
    const i = fps.indexOf(victim);
    fps.splice(i, 1);
    for (const site of world.parkSites || []) if (site.trails) site.trails = site.trails.filter((id) => id !== victim.id);
    markFootpaths(world);
    removed++;
  }
  return removed;
}

export function markFootpaths(world) {
  const N = world.N, n = N * N;
  if (!world.footpath || world.footpath.length !== n) world.footpath = new Uint8Array(n);
  world.footpath.fill(0);
  // (a footpath with no ground left to it, e.g. from an old level, is dropped)
  if (world.footpaths && world.footpaths.some((fp) => !fp.pts || fp.pts.length < 2)) world.footpaths = world.footpaths.filter((fp) => fp.pts && fp.pts.length >= 2);
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

/**
 * The Harvest tool: clear-fell the plantation at (x, z) now, whether or not its trees are grown. It
 * counts as the town's felling: the timber goes to the town, the soil is worn (nutrients and depth),
 * the plot is replanted with saplings at once, and it takes its turn in the town's rotation.
 * Returns { town, plot, cells, grown } or a string saying why not.
 */
export function harvestPlantationAt(world, x, z) {
  const N = world.N, LU = world.landUse, OW = world.civOwner;
  let i = Math.round(z) * N + Math.round(x);
  // (the click may land just beside it: the nearest plantation cell within 3)
  if (LU[i] !== 10) {
    let bd = 4;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const j = (Math.round(z) + dz) * N + Math.round(x) + dx, d = Math.hypot(dx, dz);
      if (j >= 0 && j < N * N && LU[j] === 10 && d < bd) { bd = d; i = j; }
    }
  }
  if (LU[i] !== 10) return 'click on a timber plantation';
  const t = (world.towns || []).find((u) => u.num === OW[i]);
  const pl = t && (t.plantations || []).find((p) => p.cells.includes(i));
  if (!pl) return 'that plantation has no town working it';
  const V = world.vegetation, TD = world.treeDensity, FS = world.farmSoil, HU = world.humus;
  let cells = 0, grown = 0;
  for (const j of pl.cells) {
    if (LU[j] !== 10 || OW[j] !== t.num) continue;
    cells++;
    if (V[j] > 0.82) grown++;
    const yieldWood = V[j] * (civParams.invasive || !world.invasive ? 1 : 1 - world.invasive[j]); // (wild pine in a native plantation: no timber)
    world.woodCut = (world.woodCut || 0) + yieldWood;
    t.woodStock = (t.woodStock ?? 40) + yieldWood;
    V[j] = world.plantedField && world.plantedField[j] ? 0.3 : 0.2; // (felled, and replanted with saplings)
    if (TD) TD[j] *= 0.08;
    world.forestAge[j] = 0;
    if (world.soil) world.soil[j] *= 0.92;
    if (FS) FS[j] = Math.max(0, FS[j] - 0.18);
    if (HU) HU[j] *= 0.7;
  }
  t.timberCut = (t.timberCut || 0) + cells;
  t.fellCount = (t.fellCount || 0) + 1;
  pl.lastFell = t.fellCount; pl.felled = (pl.felled || 0) + 1; pl.resting = false;
  t.lastPlot = pl.id;
  world.dirty = true;
  return { town: t, plot: pl, cells, grown };
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

/**
 * Town parks: a town of a few hundred people sets aside areas (10–18 cells across) of wild land near
 * it, with nothing built or farmed in them, and lays a trail out to each from the town and round it
 * in a loop. Parks protect only what is hard to find, and each kind has its own restrictions (all of
 * them: no timber, no fields, no new towns and no roads; footpaths are still allowed):
 *   • Old Growth Reserve, around the oldest stands (older than 0.8, worth less where old forest is
 *     common on the map; at a timber plantation's edge older than 0.72 will do, and it counts for
 *     more, so the old growth beside plantations is kept from the next felling): strictest, also no
 *     fires, no hunting and no earthworks
 *   • a Grove (Fir Grove, Cedar Grove…) of a tree under 8% of the map's forest that makes up much of
 *     the trees there: also no hunting
 *   • a Preserve (Wetland Preserve, Tundra Preserve…) of a wild biome under 6% of the map's land:
 *     also no earthworks
 *   • a Refuge (Deer Refuge…) where an animal lives far more thickly than across the map: also no
 *     hunting, no earthworks
 *   • Last Woods, forest where little is left within 20 cells: also no fires, no earthworks
 *   • a Beach park (Beach, Pebble Beach, Black Beach) on a stretch of unbuilt sand, shingle or
 *     basalt beach and the land behind it: also no earthworks (no quays, breakwaters or dumped spoil)
 *   • Commons, only for a town over ten years old with next to no wild forest left within 20 cells:
 *     a block of its own fields taken out of farming and left to go back to the wild; no fires, no
 *     hunting
 * Wilderness Areas are made apart from these (wildernessStep).
 * Where there is nothing rare near a town, it makes no park. (Woods and Game Woods, for ordinary
 * forest, are no longer made; ones already on a map stay.) Bigger towns keep adding parks (about
 * one more for every 1,500 people). A new park next to an existing one (its edge within a few cells)
 * joins it into one larger park (the outline around both, the restrictions of both, its trail
 * linked in). New and grown parks wait in world.newParks for the app to add or reshape them as
 * drawn polygons (Drawings list, where their restrictions can be changed); world.parkSites
 * remembers each park.
 */
export const PARK_TYPES = {
  old: { label: 'Old Growth Reserve', restrict: ['timber', 'fields', 'towns', 'roads', 'fires', 'hunting', 'earthworks'] },
  grove: { label: 'Grove', restrict: ['timber', 'fields', 'towns', 'roads', 'hunting'] },
  woods: { label: 'Woods', restrict: ['timber', 'fields', 'towns', 'roads'] },
  game: { label: 'Game Woods', restrict: ['timber', 'fields', 'towns', 'roads', 'earthworks'] },
  refuge: { label: 'Refuge', restrict: ['timber', 'fields', 'towns', 'roads', 'hunting', 'earthworks'] },
  commons: { label: 'Commons', restrict: ['timber', 'fields', 'towns', 'roads', 'fires', 'hunting'] },
  biome: { label: 'Preserve', restrict: ['timber', 'fields', 'towns', 'roads', 'earthworks'] },
  national: { label: 'National Forest', restrict: ['timber'] },
  beach: { label: 'Beach', restrict: ['timber', 'fields', 'towns', 'roads', 'earthworks'] },
  remnant: { label: 'Last Woods', restrict: ['timber', 'fields', 'towns', 'roads', 'fires', 'earthworks'] },
  wilderness: { label: 'Wilderness', restrict: ['timber', 'fields', 'towns', 'roads', 'fires', 'earthworks'] },
};
// (the wild biomes a Preserve can be made for)
const WILD_BIOMES = new Set([...FOREST_TYPES.map((f) => f.id), 'wetland', 'grassland', 'shrubland', 'tundra', 'mangrove', 'dunes', 'mesa', 'desert']);
let biomeMean = {};
function slopeAtCell(world, i) {
  const N = world.N, H = world.height, x = i % N, z = (i / N) | 0;
  const gx = (H[x < N - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * 0.5, gz = (H[z < N - 1 ? i + N : i] - H[z > 0 ? i - N : i]) * 0.5;
  return Math.sqrt(gx * gx + gz * gz);
}
/** A wild biome covering most of the ground around cell i that is rare on the map: [id, how rare] or null. */
function rareBiomeAt(world, i) {
  const N = world.N, cnt = {};
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const j = i + dz * N + dx, b = classifyBiome(world, j, slopeAtCell(world, j));
    cnt[b] = (cnt[b] || 0) + 1;
  }
  let id = null, c = 0;
  for (const [b, k] of Object.entries(cnt)) if (k > c) { c = k; id = b; }
  // (only a biome that's hard to find: under 6% of the map's land)
  const m = biomeMean[id] || 0;
  if (c < 15 || !WILD_BIOMES.has(id) || m >= 0.06) return null;
  return [id, Math.min(1, 0.03 / (m + 0.005)) * 0.9];
}
/** Share of the land within 20 cells of (x, z) that is wild forest. */
function localForest(world, x, z) {
  const N = world.N, V = world.vegetation, LU = world.landUse, H = world.height, sea = seaOf(world);
  let f = 0, c = 0;
  for (let dz = -20; dz <= 20; dz += 3) for (let dx = -20; dx <= 20; dx += 3) {
    if (dx * dx + dz * dz > 400) continue;
    const xx = x + dx, zz = z + dz;
    if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
    const j = zz * N + xx;
    if (H[j] < sea) continue;
    c++;
    if (V[j] > 0.6 && !LU[j]) f++;
  }
  return c ? f / c : 1;
}
let rarity = null, rarityAt = -99, rarityCalls = 0;
function speciesRarity(world) {
  // (each species' share of the map's forest, sampled; refreshed now and then)
  const step = ++rarityCalls;
  if (rarity && rarity.length === SPECIES.length && step - rarityAt < 20) return rarity;
  const N = world.N, K = SPECIES.length, sum = new Float32Array(K), sh = new Float32Array(K);
  let c = 0;
  let old = 0;
  for (let i = 0; i < N * N; i += 13) {
    if (world.vegetation[i] < 0.5 || world.landUse[i]) continue;
    treeShares(world, i, sh);
    for (let k = 0; k < K; k++) sum[k] += sh[k];
    if (world.forestAge[i] > 0.8) old++;
    c++;
  }
  oldMean = old / Math.max(1, c);
  for (let k = 0; k < K; k++) sum[k] /= Math.max(1, c);
  rarity = sum; rarityAt = step;
  // (each wild biome's share of the land)
  biomeMean = {};
  let land = 0;
  for (let i = N * 2 + 2; i < N * N - N * 2; i += 17) {
    if (world.height[i] < seaOf(world)) continue;
    const b = classifyBiome(world, i, slopeAtCell(world, i));
    biomeMean[b] = (biomeMean[b] || 0) + 1; land++;
  }
  for (const b of Object.keys(biomeMean)) biomeMean[b] /= Math.max(1, land);
  // (and each land animal's average density over the land)
  animalMean = {};
  for (const an of world.animals || []) {
    if (an.habitat === 'sea' || an.habitat === 'coast') continue;
    const f = world['animal_' + an.id];
    if (!f) continue;
    let tot = 0, cc = 0;
    for (let i = 0; i < N * N; i += 13) if (world.height[i] > seaOf(world)) { tot += f[i]; cc++; }
    animalMean[an.id] = tot / Math.max(1, cc);
  }
  return rarity;
}
let animalMean = {}, oldMean = 0;
/** The land animal living much more thickly at cell i than across the map: [animal, how much] or null. */
function wildlifeAt(world, i) {
  const N = world.N;
  let best = null, bs = 0;
  for (const an of world.animals || []) {
    const mean = animalMean[an.id];
    if (mean === undefined) continue;
    const f = world['animal_' + an.id];
    let v = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) v += f[i + dz * N + dx] || 0;
    v /= 25;
    if (v < 0.12) continue;
    const r = Math.min(1, v / (mean + 0.03) / 5);
    if (r > bs) { bs = r; best = an; }
  }
  return best ? [best, bs] : null;
}
/**
 * A park's outline around (cx, cz): an irregular blob, often drawn out longer one way than the
 * other, with bays and lobes (a few random waves around its edge), that stops short where the wild
 * land does (at fields, streets, roads, the sea, lakes and big rivers). A Commons is cut out of
 * fields, so only streets and works and water stop it.
 */
function parkOutline(world, cx, cz, r, commons) {
  const N = world.N, LU = world.landUse, H = world.height, sea = seaOf(world), FP = world.footpath;
  const K = 28, out = [];
  const stretch = 1 + Math.random() * 1.2, along = Math.random() * Math.PI; // (elongation and its direction)
  const waves = [];
  for (let h = 2; h <= 5; h++) waves.push({ h, amp: (Math.random() * 0.22) / Math.sqrt(h - 1), ph: Math.random() * Math.PI * 2 });
  const stops = (j) => H[j] < sea || world.water[j] > 0.3 || (LU[j] && !(FP && FP[j]) && !(commons && LU[j] === 1));
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2;
    // (an ellipse, stretched one way, kept to about the same area)
    const ca = Math.cos(a - along), sa = Math.sin(a - along);
    let rr = r / Math.sqrt((ca * ca) / stretch + sa * sa * stretch);
    let wv = 1;
    for (const w of waves) wv += w.amp * Math.sin(w.h * a + w.ph);
    rr *= Math.max(0.45, wv);
    // (out along the ray until the wild land ends)
    let reach = 0;
    for (let t = 0.5; t <= rr; t += 0.5) {
      const x = Math.round(cx + Math.cos(a) * t), z = Math.round(cz + Math.sin(a) * t);
      if (x < 0 || z < 0 || x >= N || z >= N || stops(z * N + x)) break;
      reach = t;
    }
    rr = Math.max(r * 0.3, reach);
    out.push({ x: Math.max(0, Math.min(N - 1, cx + Math.cos(a) * rr)), z: Math.max(0, Math.min(N - 1, cz + Math.sin(a) * rr)) });
  }
  return out;
}
/** The outline around two overlapping or neighbouring outlines (bays kept, the gap between bridged). */
function unionOutline(A, B) {
  const all = A.concat(B);
  let cx = 0, cz = 0;
  for (const p of all) { cx += p.x; cz += p.z; }
  cx /= all.length; cz /= all.length;
  const inside = (P, x, z) => {
    let o = false;
    for (let a = 0, b = P.length - 1; a < P.length; b = a++) if ((P[a].z > z) !== (P[b].z > z) && x < ((P[b].x - P[a].x) * (z - P[a].z)) / (P[b].z - P[a].z) + P[a].x) o = !o;
    return o;
  };
  const maxR = Math.max(...all.map((p) => Math.hypot(p.x - cx, p.z - cz))) + 1;
  const K = 48, out = [];
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    let far = 0;
    for (let t = 0; t <= maxR; t += 0.4) { const x = cx + c * t, z = cz + s * t; if (inside(A, x, z) || inside(B, x, z)) far = t; }
    out.push({ x: cx + c * Math.max(1, far), z: cz + s * Math.max(1, far) });
  }
  // (drop points that lie on a straight run, to keep the outline light)
  return out.filter((p, k) => {
    const a = out[(k + K - 1) % K], b = out[(k + 1) % K];
    return Math.abs((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) > 0.05;
  });
}
/** Whether (x, z) lies inside a park's outline. */
function inPark(p, x, z) {
  const P = p.points;
  if (!P || P.length < 3) return Math.hypot(p.x - x, p.z - z) < p.r;
  let inside = false;
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
    if ((P[a].z > z) !== (P[b].z > z) && x < ((P[b].x - P[a].x) * (z - P[a].z)) / (P[b].z - P[a].z) + P[a].x) inside = !inside;
  }
  return inside;
}
/** Distance from (x, z) to the edge of a park's outline. */
function edgeDist(p, x, z) {
  const P = p.points;
  if (!P || P.length < 2) return Math.hypot(p.x - x, p.z - z) - p.r;
  let d = Infinity;
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
    const ax = P[b].x, az = P[b].z, dx = P[a].x - ax, dz = P[a].z - az, L = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    d = Math.min(d, Math.hypot(x - ax - u * dx, z - az - u * dz));
  }
  return d;
}
export function parkStep(world, t, pick = null) {
  if (t.pop < 400) return;
  // (every piece of park counts, merged or not; Old Growth Reserves have an allowance of their own)
  let mine = 0;
  for (const p of world.parkSites || []) if ((p.town === t.num || (p.towns && p.towns.includes(t.num))) && !p.oldOwn) mine += p.parts || 1;
  // (the Park frequency slider: how soon they come, and how many a town of its size keeps)
  const rate = civParams.parkRate ?? 1;
  if (!pick && (rate <= 0 || mine >= Math.max(1, Math.round((1 + t.pop / 1500) * rate)) || Math.random() > 0.02 * rate * Math.max(0.5, civParams.growth))) return;
  const N = world.N, LU = world.landUse, V = world.vegetation, A = world.forestAge, H = world.height, sea = seaOf(world);
  const sites = (world.parkSites ||= []);
  const glob = speciesRarity(world), K = SPECIES.length, sh = new Float32Array(K);
  let best = pick;
  if (!pick) {
  for (let k = 0; k < 160; k++) {
    const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 78; // (out to 90 cells: away from the town's own land)
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 8 || z < 8 || x >= N - 8 || z >= N - 8) continue;
    const i = z * N + x;
    if (LU[i] || V[i] < 0.25 || H[i] < sea + 0.5 || world.water[i] > 0.1) continue;
    // (not in or on top of another park; your own drawn areas don't stop a park, whatever they restrict)
    if (sites.some((p) => p.kind !== 'national' && (inPark(p, x, z) || edgeDist(p, x, z) < 5))) continue; // (a National Forest doesn't keep parks out)
    // (wild forest all over: nothing built, farmed or planted in it)
    // (wild all over, nothing built, farmed or planted in it; the last woods of a farmed district may
    // have fields close round them, but not right up against the middle)
    // (timber plantations close by don't spoil it: old growth at a plantation's edge is just what
    // needs keeping from the next felling)
    let wild = true, near = false, open = 0, plant = 0;
    for (let dz = -6; dz <= 6 && !near; dz++) for (let dx = -6; dx <= 6; dx++) {
      if (dx * dx + dz * dz > 36) continue;
      const j = i + dz * N + dx;
      if (LU[j] && !(world.footpath && world.footpath[j])) {
        if (dx * dx + dz * dz <= 4) { near = true; break; }
        if (LU[j] === 10) plant++; else wild = false;
      }
      if (V[j] < 0.45) open++;
    }
    if (near) continue;
    const handy = sites.some((p) => edgeDist(p, x, z) < 9) ? 0.1 : 0;
    // (how much of the land around is developed, within 12 cells: parks are for wild country, so a
    // site among fields and streets counts for much less; distance from town counts only a little)
    let dv = 0, dc = 0;
    for (let dz = -12; dz <= 12; dz += 3) for (let dx = -12; dx <= 12; dx += 3) {
      const j = i + dz * N + dx;
      if (j < 0 || j >= N * N) continue;
      dc++;
      if (LU[j] && !(world.footpath && world.footpath[j])) dv++;
    }
    const devCost = (dv / Math.max(1, dc)) * 1.5, far = d * 0.0015;
    // The last woods of the district: forest where little is left within 20 cells
    if (V[i] >= 0.6 && open <= 20) {
      const lf = localForest(world, x, z);
      if (lf < 0.3) {
        const sc = 0.3 + (0.3 - lf) * 2.5 - far + handy;
        if (!best || sc > best.score) best = { x, z, score: sc, kind: 'remnant', sp: -1 };
      }
    }
    if (!wild) continue;
    // A preserve: a stretch of a wild biome that's rare on the map (wetland, tundra, dunes…)
    const rb = rareBiomeAt(world, i);
    if (rb) {
      let sc = rb[1];
      for (const p of sites) for (const f of p.features || []) if (f === 'biome:' + rb[0]) sc *= 0.55;
      sc += handy - far - devCost;
      if (sc > 0.25 && (!best || sc > best.score)) best = { x, z, score: sc, kind: 'biome', sp: -1, biome: rb[0] };
    }
    // A refuge: where some wild animal lives much more thickly than across the map (forest or open)
    const wl = wildlifeAt(world, i);
    if (wl) {
      let sc = wl[1];
      for (const p of sites) for (const f of p.features || []) if (f === 'wild:' + wl[0].id) sc *= 0.55;
      sc -= far + devCost;
      if (sites.some((p) => edgeDist(p, x, z) < 9)) sc += 0.1;
      if (sc > 0.25 && (!best || sc > best.score)) best = { x, z, score: sc, kind: 'refuge', sp: -1, animal: wl[0] };
    }
    if (V[i] < 0.6 || open > 20) continue; // (the rest are forest parks)
    // Old growth: the stand's age (averaged over its neighbours)
    let age = 0, c = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const j = i + dz * N + dx; if (!LU[j]) { age += A[j]; c++; } }
    age /= Math.max(1, c);
    // (ordinary forest, for Woods or Game Woods if nothing special turns up: older, nearer is better)
    // (old growth: only the oldest stands, and worth less where old forest is common on the map)
    // (beside a timber plantation it counts for more, and a little younger will do; so does a stand
    // people already walk to on one of the town's old-growth trails)
    const edge = plant > 0;
    const walked = (world.footpaths || []).some((f) => f.spot && !f.park && Math.hypot(f.spot.x - x, f.spot.z - z) < 8);
    let score = age > (edge || walked ? 0.72 : 0.8) ? Math.min(1, (age - 0.62) * 3.3) * Math.max(0.9, Math.min(1, 0.12 / (oldMean + 0.02))) + (edge ? 0.2 : 0) + (walked ? 0.25 : 0) + (dv === 0 ? 0.2 : 0) : 0, kind = 'old', sp = -1;
    // A rare tree: one making up much more of the trees here than of the map's forest
    treeShares(world, i, sh);
    for (let s = 0; s < K; s++) {
      // (only a tree that's hard to find: under 8% of the map's forest, and much of the trees here)
      if (sh[s] < 0.4 || glob[s] >= 0.08) continue;
      const r = Math.min(1, (sh[s] / (glob[s] + 0.01)) / 10);
      if (r > score) { score = r; kind = 'grove'; sp = s; }
    }
    // (something the map's parks already protect counts for less: each new park something different)
    const key = kind === 'old' ? 'old' : SPECIES[sp].id;
    for (const p of sites) for (const f of p.features || [p.kind === 'old' ? 'old' : p.species]) if (f === key) score *= key === 'old' ? 0.88 : 0.55; // (old growth is always worth keeping: only a little less for each reserve already made)
    score -= far + (kind === 'old' && edge ? 0 : devCost); // (plantations beside old growth don't count against it)
    // (ground next to a park the town already has is handier still: parks tend to grow together)
    if (sites.some((p) => edgeDist(p, x, z) < 9)) score += 0.1;
    if (score > 0.25 && (!best || score > best.score)) best = { x, z, score, kind, sp };
  }
  // A town hemmed in by its own development (or, now and then, an old town): a Commons, out of its
  // own fields
  // A beach: an unbuilt stretch of the shore near the town
  const bch = beachSite(world, t);
  if (bch && (!best || bch.score > best.score)) best = bch;
  // (only when it has next to no wild forest left within 20 cells, and has been there ten years)
  const old = (seasonParams.year || 1) - (t.founded || 1) >= 10;
  if (!best && old && localForest(world, t.x, t.z) < 0.15) { const c = commonsSite(world, t); if (c) best = c; }
  }
  if (!best) return;
  const type = PARK_TYPES[best.kind];
  const r = best.r || (5 + Math.random() * 4) * (civParams.parkSize ?? 1); // (10–18 cells across, times the Park size slider)
  const label = best.kind === 'grove' ? `${SPECIES[best.sp].label.replace(/\s*\(.*\)/, '').replace(/ & .*/, '')} Grove`
    : best.kind === 'beach' ? ['Beach', 'Pebble Beach', 'Black Beach'][best.shore]
    : best.kind === 'refuge' ? `${best.animal.name} Refuge`
    : best.kind === 'biome' ? `${BIOMES[best.biome].label.replace(/\s*\(.*\)/, '').replace(/\b\w/g, (ch) => ch.toUpperCase())} Preserve` : type.label;
  const restrict = {};
  for (const k of type.restrict) restrict[k] = true;
  if (best.kind === 'woods' && Math.random() < 0.4) restrict.fires = true;
  if (best.kind === 'grove' && t.pop > 2000) restrict.earthworks = true;
  const points = best.outline || parkOutline(world, best.x, best.z, r, best.kind === 'commons');
  const feature = best.kind === 'grove' ? SPECIES[best.sp].id : best.kind === 'refuge' ? 'wild:' + best.animal.id : best.kind === 'biome' ? 'biome:' + best.biome : best.kind;
  // (a Commons: its fields inside are taken out of farming and left to go wild)
  if (best.kind === 'commons') {
    const rc = r * 1.15;
    for (let dz = -Math.ceil(rc); dz <= Math.ceil(rc); dz++) for (let dx = -Math.ceil(rc); dx <= Math.ceil(rc); dx++) {
      if (dx * dx + dz * dz > rc * rc) continue;
      const j = (best.z + dz) * N + best.x + dx;
      if (j < 0 || j >= N * N || LU[j] !== 1) continue;
      LU[j] = 0; world.civOwner[j] = 0; world.paved[j] = 0;
      if (world.irrigated) world.irrigated[j] = 0;
      markOldField(world, j);
    }
  }
  const year = seasonParams.year || 1;
  // Next to an existing park (edges within a few cells)? It joins that park
  let site = null, sd = r + 4;
  for (const p of sites) { if (p.noMerge) continue; const e = edgeDist(p, best.x, best.z); if (e < sd) { sd = e; site = p; } }
  let from;
  if (site) {
    from = { x: site.x, z: site.z };
    site.points = unionOutline(site.points, points).map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
    let cx = 0, cz = 0;
    for (const p of site.points) { cx += p.x; cz += p.z; }
    site.x = Math.round(cx / site.points.length); site.z = Math.round(cz / site.points.length);
    site.r = Math.max(...site.points.map((p) => Math.hypot(p.x - site.x, p.z - site.z)));
    for (const k of Object.keys(restrict)) site.restrict[k] = true;
    site.features = [...new Set([...(site.features || []), feature])];
    site.kinds = [...new Set([...(site.kinds || []), best.kind])];
    if (site.town !== t.num) site.towns = [...new Set([...(site.towns || []), t.num])];
    site.parts = (site.parts || 1) + 1;
    if (!/ Park( \d+)?$/.test(site.name)) {
      // (Elford Old Growth Reserve → Elford Old Growth Park; a numbered name keeps its number last)
      const base = `${site.name.replace(/ \d+$/, '').replace(/ Reserve$/, '')} Park`;
      let nm = base;
      for (let k = 2; sites.some((p) => p !== site && p.name === nm); k++) nm = `${base} ${k}`;
      site.name = nm;
    }
  } else {
    // (a name of its own: a second Cedar Grove of the same town is named by where it lies)
    let name = `${t.name} ${label}`;
    if (sites.some((p) => p.name === name || p.name === `${name.replace(/ Reserve$/, '')} Park`)) {
      const ang = Math.atan2(best.z - t.z, best.x - t.x);
      const dir = ['East', 'South', 'West', 'North'][((Math.round(ang / (Math.PI / 2)) % 4) + 4) % 4]; // (+z is south on the map)
      name = `${t.name} ${dir} ${label}`;
      for (let k = 2; sites.some((p) => p.name === name); k++) name = `${t.name} ${dir} ${label} ${k}`;
    }
    site = { id: 'pk' + Math.random().toString(36).slice(2, 8), town: t.num, name, kind: best.kind, kinds: [best.kind], oldOwn: !!best.own, species: best.sp >= 0 ? SPECIES[best.sp].id : null,
      features: [feature], x: best.x, z: best.z, r, year, parts: 1, points, restrict };
    sites.push(site);
    from = { x: t.x, z: t.z };
  }
  (world.newParks ||= []).push({ id: site.id, name: site.name, points: site.points, restrict: { ...site.restrict } });
  // A trail loop through the new ground, from the side nearest the town, walked out to from the town
  // (or, for ground joining a park, from the middle of the park it joins)
  // (a beach park's trail instead runs along the beach itself, end to end, walked out to from town)
  const before = new Set((world.footpaths || []).map((f) => f.id));
  const along = best.kind === 'beach' ? beachPath(world, points) : null;
  let fp;
  if (along) {
    const near = Math.hypot(along[0].x - from.x, along[0].z - from.z) <= Math.hypot(along[along.length - 1].x - from.x, along[along.length - 1].z - from.z);
    if (!near) along.reverse();
    fp = addFootpath(world, from, along[0], false);
    if (fp) { fp.pts.push(...along.slice(1)); markFootpaths(world); }
  } else if (pathDensity(world, best.x, best.z, Math.max(8, r)) < CROWDED) {
    // (no new loop where the ground is already laced with trails)
    const ta = Math.atan2(from.z - best.z, from.x - best.x), rl = r * 0.7;
    const at = (a) => ({ x: Math.round(best.x + Math.cos(a) * rl), z: Math.round(best.z + Math.sin(a) * rl) });
    const loop = [at(ta), at(ta + 2.1), at(ta + 4.2), at(ta)];
    fp = addFootpath(world, trailStart(world, loop[0], from), loop[0], false);
    for (let k = 0; k < 3; k++) fp = addFootpath(world, loop[k], loop[k + 1]) || fp;
  }
  if (fp && !before.has(fp.id)) { fp.park = site.id; (site.trails ||= []).push(fp.id); }
  // (an old-growth trail out to a stand inside the park becomes one of its trails)
  for (const f of world.footpaths || []) if (f.spot && !f.park && (inPark(site, f.spot.x, f.spot.z) || edgeDist(site, f.spot.x, f.spot.z) < 3)) { f.park = site.id; (site.trails ||= []).push(f.id); }
  // (the park's trails are named after it, numbered if there are several)
  const trails = (world.footpaths || []).filter((f) => f.park === site.id);
  trails.forEach((f, k) => { f.name = `${site.name} Trail${trails.length > 1 ? ` ${k + 1}` : ''}`; });
  t.lastPark = year;
}

/**
 * Where an old town hemmed in by its own development makes a Commons: a block of its own fields
 * (mostly fields: no streets, works or roads inside), a little way out from the middle of town.
 */
function commonsSite(world, t) {
  const N = world.N, LU = world.landUse, OW = world.civOwner, sites = world.parkSites || [];
  let best = null;
  for (let k = 0; k < 120; k++) {
    const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * 30;
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 6 || z < 6 || x >= N - 6 || z >= N - 6) continue;
    const i = z * N + x;
    if (LU[i] !== 1 || OW[i] !== t.num) continue;
    if (sites.some((p) => p.kind !== 'national' && (inPark(p, x, z) || edgeDist(p, x, z) < 3))) continue;
    let fields = 0, blocked = false;
    for (let dz = -5; dz <= 5 && !blocked; dz++) for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dz * dz > 25) continue;
      const u = LU[i + dz * N + dx];
      if (u === 1) fields++;
      else if (u && u !== 0) { blocked = true; break; } // (streets, works, roads, plantations…)
    }
    if (blocked || fields < 55) continue;
    const score = 0.3 + fields * 0.002 - d * 0.004 + (sites.some((p) => edgeDist(p, x, z) < 9) ? 0.1 : 0);
    if (!best || score > best.score) best = { x, z, score, kind: 'commons', sp: -1 };
  }
  return best;
}

/**
 * Wilderness Areas: a town of 1,500 people or more now and then sets aside a very large tract
 * (36–70 cells across) of the remotest wild land it can find, 40–130 cells away: the place farthest
 * from any town, field, road or works, kept that way. No timber, fields, new towns, roads, fires or
 * earthworks; hunting is allowed. Its outline stops at the sea, lakes and anything built, like other
 * parks', and a long trail leads out to it from the town. Each town makes one; they don't merge with
 * other parks and don't count toward its other parks. Named after the town, or by where it lies if
 * that is taken.
 */
export function wildernessStep(world, t) {
  if (t.pop < 1500 || Math.random() > 0.004 * (civParams.parkRate ?? 1) * Math.max(0.5, civParams.growth)) return;
  const sites = (world.parkSites ||= []);
  if (sites.some((p) => p.kind === 'wilderness' && p.town === t.num)) return;
  const N = world.N, n = N * N, LU = world.landUse, H = world.height, V = world.vegetation, sea = seaOf(world), FP = world.footpath;
  // How far every cell is from anything developed (or from a park's middle: no wilderness on one)
  const dist = new Int16Array(n).fill(-1), q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (LU[i] && !(FP && FP[i])) { dist[i] = 0; q[tail++] = i; }
  for (const p of sites) { if (p.kind === 'national') continue; const i = p.z * N + p.x; if (dist[i] < 0) { dist[i] = 0; q[tail++] = i; } }
  if (!tail) return;
  while (head < tail) {
    const i = q[head++], x = i % N, d = dist[i] + 1;
    if (x > 0 && dist[i - 1] < 0) { dist[i - 1] = d; q[tail++] = i - 1; }
    if (x < N - 1 && dist[i + 1] < 0) { dist[i + 1] = d; q[tail++] = i + 1; }
    if (i >= N && dist[i - N] < 0) { dist[i - N] = d; q[tail++] = i - N; }
    if (i < n - N && dist[i + N] < 0) { dist[i + N] = d; q[tail++] = i + N; }
  }
  let best = null;
  for (let k = 0; k < 300; k++) {
    const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 90;
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 10 || z < 10 || x >= N - 10 || z >= N - 10) continue;
    const i = z * N + x;
    if (H[i] < sea + 0.5 || world.water[i] > 0.1 || dist[i] < 20) continue;
    if (sites.some((p) => p.kind === 'wilderness' && Math.hypot(p.x - x, p.z - z) < p.r + 20)) continue;
    // (mostly wild, living land around it: not bare rock or open water)
    let live = 0, c = 0;
    for (let dz = -15; dz <= 15; dz += 3) for (let dx = -15; dx <= 15; dx += 3) {
      const j = (z + dz) * N + x + dx;
      if (j < 0 || j >= n) continue;
      c++;
      if (H[j] >= sea && V[j] > 0.3) live++;
    }
    if (live < c * 0.5) continue;
    const score = dist[i] + live * 0.2 - d * 0.05;
    if (!best || score > best.score) best = { x, z, score, remote: dist[i] };
  }
  if (!best) return;
  const r = Math.min(35, Math.max(18, best.remote * 0.85));
  const points = parkOutline(world, best.x, best.z, r, false);
  let name = `${t.name} Wilderness`;
  if (sites.some((p) => p.name === name)) {
    const ang = Math.atan2(best.z - t.z, best.x - t.x);
    name = `${t.name} ${['East', 'South', 'West', 'North'][((Math.round(ang / (Math.PI / 2)) % 4) + 4) % 4]} Wilderness`;
  }
  const restrict = {};
  for (const k of PARK_TYPES.wilderness.restrict) restrict[k] = true;
  const site = { id: 'pk' + Math.random().toString(36).slice(2, 8), town: t.num, name, kind: 'wilderness', kinds: ['wilderness'], species: null,
    features: ['wilderness'], x: best.x, z: best.z, r, year: seasonParams.year || 1, parts: 0, points: points.map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) })), restrict, noMerge: true };
  sites.push(site);
  (world.newParks ||= []).push({ id: site.id, name, points: site.points, restrict: { ...restrict } });
  // (a long trail out to it from the town, ending in a loop through its heart)
  const rl = Math.min(10, r * 0.4), ta = Math.atan2(t.z - best.z, t.x - best.x);
  const at = (a) => ({ x: Math.round(best.x + Math.cos(a) * rl), z: Math.round(best.z + Math.sin(a) * rl) });
  const loop = [at(ta), at(ta + 2.1), at(ta + 4.2), at(ta)];
  let fp = addFootpath(world, trailStart(world, loop[0], { x: t.x, z: t.z }), loop[0], false);
  for (let k = 0; k < 3; k++) fp = addFootpath(world, loop[k], loop[k + 1]) || fp;
  if (fp) { fp.park = site.id; fp.name = `${name} Trail`; site.trails = [fp.id]; }
}

/**
 * National Forests: every map gets one or two (decided once, world.nationalTarget) large forest
 * parks, set aside for the whole map rather than by a town: the most heavily forested stretch of the
 * map, 60–90 cells across, its outline following the forest's edge (it stops at the sea and where
 * the forest gives out). No timber is cut inside (no plantations planted or felled); towns, farms and
 * roads can still go there, and town parks can be made inside it. A trail runs through it. Named
 * after the nearest town, or with a name of its own if none is near. They wait until the map has
 * enough forest (a young map may take a while), and until there is a civilization: no town, no
 * National Forest.
 */
const NF_NAMES = ['Silverpine', 'Blackwater', 'Ironwood', 'Stillwater', 'Bear Creek', 'Eagle Ridge', 'Greenhollow', 'Misty Hills', 'Elk Valley', 'Thornbury', 'Coldspring', 'Ravenwood'];
export function nationalForestStep(world) {
  if (world.nationalTarget === undefined) world.nationalTarget = Math.random() < 0.5 ? 1 : 2;
  const sites = (world.parkSites ||= []);
  const have = sites.filter((p) => p.kind === 'national');
  if (have.length >= world.nationalTarget || Math.random() > 0.03) return;
  const N = world.N, V = world.vegetation, H = world.height, LU = world.landUse, sea = seaOf(world);
  const forest = (j) => V[j] > 0.55 && H[j] >= sea && LU[j] !== 10;
  const R = Math.round(Math.min(45, N * 0.17));
  let best = null;
  for (let k = 0; k < 120; k++) {
    const x = Math.round(R * 0.5 + Math.random() * (N - R)), z = Math.round(R * 0.5 + Math.random() * (N - R));
    if (have.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + R * 0.8)) continue;
    let f = 0, c = 0;
    for (let dz = -R; dz <= R; dz += 4) for (let dx = -R; dx <= R; dx += 4) {
      if (dx * dx + dz * dz > R * R) continue;
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
      c++;
      if (forest(zz * N + xx)) f++;
    }
    const cover = f / Math.max(1, c);
    if (cover > 0.45 && forest(z * N + x) && (!best || cover > best.cover)) best = { x, z, cover };
  }
  if (!best) return;
  // Outline: out along each ray to where the forest gives out (the sea, or several cells of open ground)
  const K = 40, pts = [];
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2, rr = R * (0.75 + Math.random() * 0.3);
    let reach = R * 0.3, gap = 0;
    for (let t = 1; t <= rr; t += 1) {
      const x = Math.round(best.x + Math.cos(a) * t), z = Math.round(best.z + Math.sin(a) * t);
      if (x < 0 || z < 0 || x >= N || z >= N) break;
      const j = z * N + x;
      if (H[j] < sea) break;
      if (forest(j)) { gap = 0; reach = Math.max(reach, t); } else if (++gap > 5) break;
    }
    pts.push({ x: +(best.x + Math.cos(a) * reach).toFixed(2), z: +(best.z + Math.sin(a) * reach).toFixed(2) });
  }
  // (smoothed a little, so the edge doesn't jag from ray to ray)
  const points = pts.map((p, k) => {
    const a = pts[(k + K - 1) % K], b = pts[(k + 1) % K];
    return { x: +((a.x + 2 * p.x + b.x) / 4).toFixed(2), z: +((a.z + 2 * p.z + b.z) / 4).toFixed(2) };
  });
  let near = null, nd = 60;
  for (const t of world.towns || []) { const d = Math.hypot(t.x - best.x, t.z - best.z); if (d < nd) { nd = d; near = t; } }
  const used = new Set(sites.map((p) => p.name));
  let name = near ? `${near.name} National Forest` : null;
  if (!name || used.has(name)) {
    const free = NF_NAMES.filter((w) => !used.has(`${w} National Forest`));
    name = `${free.length ? free[(Math.random() * free.length) | 0] : 'Great'} National Forest`;
  }
  let r = 0;
  for (const p of points) r = Math.max(r, Math.hypot(p.x - best.x, p.z - best.z));
  const site = { id: 'nf' + Math.random().toString(36).slice(2, 8), town: 0, name, kind: 'national', kinds: ['national'], species: null, features: ['national'],
    x: best.x, z: best.z, r, year: seasonParams.year || 1, parts: 0, points, restrict: { timber: true }, noMerge: true };
  sites.push(site);
  (world.newParks ||= []).push({ id: site.id, name, points, restrict: { timber: true }, color: '#3fae5a' });
  // (a trail through it, end to end the long way)
  let a0 = 0, best2 = 0;
  for (let k = 0; k < K / 2; k++) { const d = Math.hypot(points[k].x - points[k + K / 2].x, points[k].z - points[k + K / 2].z); if (d > best2) { best2 = d; a0 = k; } }
  const p1 = points[a0], p2 = points[a0 + K / 2];
  const lerp = (p, f) => ({ x: Math.round(best.x + (p.x - best.x) * f), z: Math.round(best.z + (p.z - best.z) * f) });
  const fp = addFootpath(world, lerp(p1, 0.85), lerp(p2, 0.85), false);
  if (fp) { fp.park = site.id; fp.name = `${name} Trail`; site.trails = [fp.id]; }
}

/**
 * Where a town makes a beach park: an unbuilt stretch of sand, shingle or basalt beach within 55
 * cells, at least six cells of it together. The park's middle is set a few cells inland, so it takes
 * in the beach and the land behind it. Each beach park the map has already makes another count for
 * less. Returns { x, z, score, kind: 'beach', shore: 0 sand / 1 shingle / 2 basalt } or null.
 */
function beachSite(world, t) {
  if (!world.shore) return null;
  const N = world.N, SH = world.shore, LU = world.landUse, H = world.height, sea = seaOf(world), sites = world.parkSites || [];
  const kinds = [SHORE.sand, SHORE.shingle, SHORE.basalt];
  const beaches = sites.filter((p) => p.features && p.features.includes('beach')).length;
  let best = null;
  for (let k = 0; k < 200; k++) {
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 47;
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 8 || z < 8 || x >= N - 8 || z >= N - 8) continue;
    const i = z * N + x, kind = kinds.indexOf(SH[i]);
    if (kind < 0 || LU[i] || H[i] < sea - 0.5) continue;
    let cnt = 0, built = 0, sx = 0, sz = 0, sc = 0;
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
      if (dx * dx + dz * dz > 36) continue;
      const j = i + dz * N + dx;
      if (SH[j] === SH[i]) cnt++;
      if (LU[j] && !(world.footpath && world.footpath[j])) built++;
      if (H[j] < sea) { sx += dx; sz += dz; sc++; }
    }
    if (cnt < 6 || built > 6 || !sc) continue;
    // (a few cells inland, away from the sea)
    const L = Math.hypot(sx, sz) || 1;
    const cx = Math.round(x - (sx / L) * 3), cz = Math.round(z - (sz / L) * 3);
    if (cx < 8 || cz < 8 || cx >= N - 8 || cz >= N - 8 || H[cz * N + cx] < sea + 0.3 || LU[cz * N + cx]) continue;
    if (sites.some((p) => p.kind !== 'national' && (inPark(p, cx, cz) || edgeDist(p, cx, cz) < 4))) continue;
    const score = (0.45 + Math.min(0.3, cnt * 0.008)) * Math.pow(0.55, beaches) - d * 0.004;
    if (score > 0.25 && (!best || score > best.score)) best = { x: cx, z: cz, score, kind: 'beach', sp: -1, shore: kind };
  }
  return best;
}

/**
 * A path along the beach inside a park outline: from one end of the beach to the other, cell by
 * cell over the beach itself (sand, shingle or boulders above the water). Null if there's too
 * little beach for one.
 */
function beachPath(world, poly) {
  const N = world.N, SH = world.shore, H = world.height, LU = world.landUse, sea = seaOf(world);
  if (!SH) return null;
  const beach = new Set([SHORE.sand, SHORE.shingle, SHORE.basalt]);
  let x0 = N, x1 = 0, z0 = N, z1 = 0;
  for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  // (the beach just outside the outline counts too: the outline stops at the water's edge)
  x0 = Math.max(0, Math.floor(x0) - 4); z0 = Math.max(0, Math.floor(z0) - 4); x1 = Math.min(N - 1, Math.ceil(x1) + 4); z1 = Math.min(N - 1, Math.ceil(z1) + 4);
  const site = { points: poly };
  const ok = new Set();
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const i = z * N + x;
    if (!beach.has(SH[i]) || H[i] < sea - 0.2 || LU[i]) continue;
    if (inPark(site, x, z) || edgeDist(site, x, z) < 4) ok.add(i);
  }
  if (ok.size < 5) return null;
  const bfs = (start) => {
    const dist = new Map([[start, 0]]), prev = new Map(), q = [start];
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % N;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if ((dx === 1 && x === N - 1) || (dx === -1 && x === 0)) continue;
        const j = i + dz * N + dx;
        if (!ok.has(j) || dist.has(j)) continue;
        dist.set(j, dist.get(i) + 1); prev.set(j, i); q.push(j);
      }
    }
    let far = start, fd = 0;
    for (const [j, d] of dist) if (d > fd) { fd = d; far = j; }
    return { far, fd, prev };
  };
  // (the two ends of the longest stretch of beach: on the biggest connected stretch, its farthest
  // cell from anywhere, then the farthest from that)
  let start = -1, most = 0;
  const seen = new Set();
  for (const i of ok) {
    if (seen.has(i)) continue;
    const r = bfs(i);
    let size = 0;
    for (const j of r.prev.keys()) { seen.add(j); size++; }
    seen.add(i);
    if (size + 1 > most) { most = size + 1; start = r.far; }
  }
  const a = start;
  const { far: b, fd, prev } = bfs(a);
  if (fd < 4) return null;
  const pts = [];
  for (let i = b; i !== undefined; i = prev.get(i)) pts.push({ x: i % N, z: (i / N) | 0 });
  return pts;
}

/**
 * Old-growth trails: a town of 300 or more now and then lays a trail out to a stand of old growth
 * near it (older than 0.75, wild, outside any park), ending in a short loop through the stand. People
 * walk there, and a stand with a trail to it is much more likely to become an Old Growth Reserve
 * later, which then takes the trail in as its own. A town keeps about one such trail for every 2,000
 * people, plus one (times the Park frequency slider). Named after the town (the "Old Forest Trail").
 */
export function oldTrailStep(world, t) {
  const rate = civParams.parkRate ?? 1;
  if (t.pop < 300 || rate <= 0 || Math.random() > 0.012 * rate) return;
  // (every trail it has laid counts, including those a park has since taken over)
  const mine = (world.footpaths || []).filter((f) => f.spot && f.town === t.num).length;
  if (mine >= Math.max(1, Math.round((1 + t.pop / 2000) * rate))) return;
  const N = world.N, LU = world.landUse, V = world.vegetation, A = world.forestAge, sites = world.parkSites || [];
  let best = null;
  for (let k = 0; k < 120; k++) {
    const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 35;
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 6 || z < 6 || x >= N - 6 || z >= N - 6) continue;
    const i = z * N + x;
    if (LU[i] || V[i] < 0.6) continue;
    if (sites.some((p) => p.kind !== 'national' && inPark(p, x, z))) continue;
    if ((world.footpaths || []).some((f) => f.spot && Math.hypot(f.spot.x - x, f.spot.z - z) < 10)) continue;
    if (pathDensity(world, x, z, 8) >= CROWDED) continue; // (not where trails are thick already)
    let age = 0, c = 0, built = false;
    for (let dz = -3; dz <= 3 && !built; dz++) for (let dx = -3; dx <= 3; dx++) {
      const j = i + dz * N + dx;
      if (LU[j] && LU[j] !== 10 && !(world.footpath && world.footpath[j])) { built = true; break; }
      age += A[j]; c++;
    }
    if (built) continue;
    age /= c;
    if (age < 0.75) continue;
    const score = age - d * 0.004;
    if (!best || score > best.score) best = { x, z, score };
  }
  if (!best) return;
  const rl = 3, ta = Math.atan2(t.z - best.z, t.x - best.x);
  const at = (a) => ({ x: Math.round(best.x + Math.cos(a) * rl), z: Math.round(best.z + Math.sin(a) * rl) });
  const loop = [at(ta), at(ta + 2.1), at(ta + 4.2), at(ta)];
  let fp = addFootpath(world, trailStart(world, loop[0], { x: t.x, z: t.z }), loop[0], false);
  for (let k = 0; k < 3; k++) fp = addFootpath(world, loop[k], loop[k + 1]) || fp;
  if (!fp) return;
  const n = (world.footpaths || []).filter((f) => f.spot && f.town === t.num).length;
  fp.spot = { x: best.x, z: best.z }; fp.town = t.num;
  fp.name = `${t.name} Old Forest Trail${n ? ` ${n + 1}` : ''}`;
}

/**
 * Old Growth Reserves, set aside on their own (apart from the town's other parks, with an allowance
 * of their own, so the rare groves, preserves and beaches don't crowd them out): a town of 400 or
 * more looks up to 120 cells out for old growth (older than 0.78 over the stand, forest, outside any
 * park but a National Forest) in wild country (little development within 12 cells; plantations
 * beside it don't count), preferring the biggest old stands, and reserves it. The reserve is larger
 * than other parks (12–26 cells across, times Park size) and its outline follows the old growth out
 * to where the forest gets younger (below 0.7), meets the sea or anything built. A stand on one of the
 * town's Old Forest Trails is preferred, and next to an existing reserve it joins it. A town keeps
 * about one for every 1,200 people, plus one (times Park frequency).
 */
export function oldGrowthStep(world, t) {
  const rate = civParams.parkRate ?? 1;
  if (t.pop < 400 || rate <= 0 || Math.random() > 0.025 * rate * Math.max(0.5, civParams.growth)) return;
  const sites = world.parkSites || [];
  let mine = 0;
  for (const p of sites) if (p.oldOwn && (p.town === t.num || (p.towns && p.towns.includes(t.num)))) mine += p.parts || 1;
  if (mine >= Math.max(1, Math.round((1 + t.pop / 1200) * rate))) return;
  const N = world.N, LU = world.landUse, V = world.vegetation, A = world.forestAge, H = world.height, sea = seaOf(world);
  const FP = world.footpath;
  let best = null;
  for (let k = 0; k < 250; k++) {
    const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 108;
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 8 || z < 8 || x >= N - 8 || z >= N - 8) continue;
    const i = z * N + x;
    if (LU[i] || V[i] < 0.6 || H[i] < sea + 0.3 || A[i] < 0.75) continue;
    if (sites.some((p) => p.kind !== 'national' && (inPark(p, x, z) || edgeDist(p, x, z) < 4))) continue;
    // (the stand: how old, and how much old growth there is within 10 cells)
    let age = 0, c = 0, old = 0, oc = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const j = i + dz * N + dx; if (!LU[j]) { age += A[j]; c++; } }
    age /= Math.max(1, c);
    if (age < 0.78) continue;
    let dv = 0, dc = 0;
    for (let dz = -12; dz <= 12; dz += 2) for (let dx = -12; dx <= 12; dx += 2) {
      const j = i + dz * N + dx;
      if (j < 0 || j >= N * N) continue;
      dc++;
      if (LU[j] && LU[j] !== 10 && !(FP && FP[j])) dv++;
      if (dx * dx + dz * dz <= 100) { oc++; if (A[j] > 0.75 && V[j] > 0.55 && !LU[j]) old++; }
    }
    if (dv / dc > 0.2) continue;
    const walked = (world.footpaths || []).some((f) => f.spot && !f.park && Math.hypot(f.spot.x - x, f.spot.z - z) < 8);
    const score = age + (old / oc) * 0.8 - (dv / dc) * 2 - d * 0.001 + (walked ? 0.3 : 0);
    if (!best || score > best.score) best = { x, z, score };
  }
  if (!best) return;
  const r = (6 + Math.random() * 7) * (civParams.parkSize ?? 1);
  // Outline: out along each ray while the forest stays old (a few younger cells are let through)
  const K = 32, pts = [];
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2;
    let reach = r * 0.35, gap = 0;
    for (let s = 0.5; s <= r * 1.4; s += 0.5) {
      const x = Math.round(best.x + Math.cos(a) * s), z = Math.round(best.z + Math.sin(a) * s);
      if (x < 0 || z < 0 || x >= N || z >= N) break;
      const j = z * N + x;
      if (H[j] < sea || world.water[j] > 0.3 || (LU[j] && !(FP && FP[j]))) break;
      if (A[j] >= 0.7 && V[j] > 0.5) { gap = 0; reach = s; } else if (++gap > 4) break;
    }
    pts.push({ x: best.x + Math.cos(a) * reach, z: best.z + Math.sin(a) * reach });
  }
  const outline = pts.map((p, k) => {
    const a = pts[(k + K - 1) % K], b = pts[(k + 1) % K];
    return { x: Math.max(0, Math.min(N - 1, (a.x + 2 * p.x + b.x) / 4)), z: Math.max(0, Math.min(N - 1, (a.z + 2 * p.z + b.z) / 4)) };
  });
  parkStep(world, t, { x: best.x, z: best.z, score: best.score, kind: 'old', sp: -1, r, outline, own: true });
}

/**
 * Where the people live (the Population overlay): each town's people spread over the cells it owns,
 * most in its streets and houses (by how built up), some in its works, a few on its farmland and
 * plantations (farmers and foresters), then blurred a little into a heatmap. world.popDensity holds
 * people per cell (rebuilt every town step; not saved).
 */
const POP_WEIGHT = { 2: 1, 4: 0.25, 5: 0.2, 6: 0.15, 1: 0.05, 10: 0.01, 11: 0.05 };
export function populationField(world) {
  const N = world.N, n = N * N, LU = world.landUse, OW = world.civOwner, P = world.paved;
  const sum = {}, raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = OW[i];
    if (!o) continue;
    let wgt = POP_WEIGHT[LU[i]] || 0;
    if (LU[i] === 2) wgt *= 0.3 + 0.7 * Math.min(1, P[i]);
    if (!wgt) continue;
    raw[i] = wgt;
    sum[o] = (sum[o] || 0) + wgt;
  }
  const popOf = {};
  for (const t of world.towns || []) popOf[t.num] = t.pop;
  for (let i = 0; i < n; i++) if (raw[i]) { const o = OW[i]; raw[i] = popOf[o] ? (popOf[o] * raw[i]) / sum[o] : 0; }
  const blur = boxBlur(raw, N, 2);
  // (mostly the blurred heat, with the built-up cells still standing out)
  for (let i = 0; i < n; i++) blur[i] = 0.65 * blur[i] + 0.35 * raw[i];
  world.popDensity = blur;
}

/**
 * A wildlife crossing (an overpass or underpass, world.crossing): built on a busy stretch of the
 * town's roads where land animals live thickly on both sides and there's no crossing near, so they
 * can cross without being killed by the traffic.
 */
function buildCrossing(world, t) {
  const N = world.N, n = N * N, LU = world.landUse, TR = world.roadTraffic;
  if (!world.crossing || world.crossing.length !== n) world.crossing = new Uint8Array(n);
  const CX = world.crossing;
  const land = (world.animals || []).filter((a) => ['land', 'forest', 'meadow', 'mountains'].includes(a.habitat));
  if (!land.length) return;
  const R = 30 + Math.sqrt(t.pop) / 2;
  let best = -1, bs = 0.05;
  for (let k = 0; k < 200; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * R;
    const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
    if (x < 3 || z < 3 || x >= N - 3 || z >= N - 3) continue;
    const i = z * N + x;
    if (LU[i] !== 3 || TR[i] < 150) continue;
    let near = false;
    for (let dz = -12; dz <= 12 && !near; dz += 2) for (let dx = -12; dx <= 12; dx += 2) { const j = i + dz * N + dx; if (j >= 0 && j < n && CX[j]) { near = true; break; } }
    if (near) continue;
    // (animals thick around it: where the road cuts their range)
    let dens = 0;
    for (const an of land) { const F = world['animal_' + an.id]; if (F) for (const j of [i - 2, i + 2, i - 2 * N, i + 2 * N]) dens += F[j] || 0; }
    const score = dens * (1 + TR[i] / 1000);
    if (score > bs) { bs = score; best = i; }
  }
  if (best < 0) return;
  // (the crossing spans the road: the road cells right around it)
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const j = best + dz * N + dx; if (LU[j] === 3) CX[j] = 1; }
  t.crossings = (t.crossings || 0) + 1;
}
