// Dynamics: events and slow changes that make the world more alive, each a setting (dynParams).
//
// Land & water: river floods and town levees (which can fail), meandering rivers, debris flows off
//   fresh burn scars in heavy rain, beaches starved of sand below dams and beside sea walls.
// Climate: (drought cycles are in sim/climate.js) earthquakes, with tsunamis from undersea ones,
//   thawing permafrost, native bark beetle outbreaks.
// Ecosystems: towns draining wetlands (drained peat sinks and smoulders when it burns), seed
//   dispersal (sim/species.js: trees spread from where they grow), invasive animals arriving with
//   towns and boats, crop pests and blights.
// People: trade between towns (sim/civilization.js), urban heat islands and smog, salt building up
//   in irrigated fields, ruins of abandoned towns.
//
// dynamicsStep(world) runs every 30 frames; it returns news of anything big (for the status line).

import { recordShock } from './seismo.js';
import { boxBlur } from '../core/grid.js';
import { seasonParams, seasonalAt, climateParams } from './climate.js';
import { waterParams } from './water.js';
import { coastParams, SHORE } from './coast.js';
import { triggerLandslide } from './landslides.js';
import { ecoParams, newAnimal, animalField, canLive, ensureEcology } from './ecology.js';
import { civParams } from './civilization.js';
import { SPECIES, treeShares } from './species.js';

export const dynParams = {
  floods: true, floodRate: 1,     // river floods in storms and wet seasons
  levees: true,                   // towns build levees along rivers (which can fail)
  meanders: true,                 // rivers on flat ground swing side to side
  debrisFlows: true,              // heavy rain on fresh burn scars sends mud and rock down
  starvedBeaches: true,           // dams and sea walls starve the beaches of sand
  earthquakes: true, quakeRate: 1,// earthquakes (and tsunamis from undersea ones)
  permafrost: true,               // frozen ground thaws as it warms
  barkBeetles: true,              // native bark beetle outbreaks
  wetlandDrainage: true,          // towns drain wetlands for farmland
  rewetWetlands: false,           // towns block the ditches: drained wetlands fill back up
  seedDispersal: true,            // trees spread from where they grow (sim/species.js)
  bogs: true,                     // peat bogs build up on cool, flat, waterlogged ground
  invasiveAnimals: true,          // feral pigs and goats, ship rats
  cropPests: true,                // pests and blights in the fields
  cropRotation: false,            // towns rotate crops: pests spread less and die out sooner
  trade: true,                    // towns trade (sim/civilization.js)
  urbanHeat: true,                // towns warmer than the land around; smog on still days
  salinisation: true,             // irrigated fields in dry country salt up
  ruins: true,                    // abandoned towns leave ruins
};

const seaOf = (w) => (w.meanSea !== undefined && w.meanSea > -999 ? w.meanSea : -1e9);
const rnd = Math.random;

function field(world, key, T = Float32Array) {
  const n = world.N * world.N;
  if (!world[key] || world[key].length !== n) world[key] = new T(n);
  return world[key];
}

let tick = 0;
/** One dynamics step (every 30 frames). Returns news (strings) of big events. */
export function dynamicsStep(world) {
  const news = [];
  tick++;
  if (dynParams.floods || dynParams.levees) floodStep(world, news);
  if (dynParams.meanders) meanderStep(world);
  if (dynParams.debrisFlows) debrisFlowStep(world, news);
  if (dynParams.starvedBeaches && tick % 3 === 0) starvedBeachStep(world);
  if (dynParams.earthquakes) quakeStep(world, news);
  if (dynParams.permafrost) permafrostStep(world);
  if (dynParams.barkBeetles) beetleStep(world, news);
  if (dynParams.wetlandDrainage || dynParams.rewetWetlands) wetlandStep(world);
  if (dynParams.bogs) bogStep(world);
  if (dynParams.seedDispersal) seedStep(world); else if (world.speciesHere) world.speciesHere = null;
  if (dynParams.invasiveAnimals && tick % 10 === 0) invasiveStep(world, news);
  if (dynParams.cropPests) pestStep(world); else if (world.cropPest) world.cropPest.fill(0);
  if (dynParams.urbanHeat && tick % 4 === 0) heatStep(world); else if (!dynParams.urbanHeat && world.heatIsland) world.heatIsland = null;
  if (dynParams.salinisation) saltStep(world);
  if (dynParams.ruins) ruinStep(world);
  world.dirty = true;
  return news;
}

// --- Land & water --------------------------------------------------------------------------------

/** River cells: moving water in a channel (not the sea). */
function isRiver(world, i, sea) {
  const D = world.water[i];
  if (D < 0.04 || world.height[i] < sea) return false;
  const vx = world.velX[i], vz = world.velZ[i];
  return vx * vx + vz * vz > 0.0025;
}

/**
 * Floods: in a storm or a wet spell, now and then a flood comes down the rivers: for some days the
 * rivers swell and spill over their banks onto the low ground beside them (the water simulation
 * spreads it). Towns of some size wall their river banks with levees, which keep ordinary floods
 * out; a big flood can overtop a levee and breach it, flooding the town behind.
 */
function floodStep(world, news) {
  const N = world.N, n = N * N, H = world.height, D = world.water, sea = seaOf(world);
  const LV = field(world, 'levee');
  // A flood starts (more likely in storms and wet weather)
  if (dynParams.floods) {
    if (!(world.flood > 0)) {
      const wet = (waterParams.rain > 0.002 ? 1 : 0) + (world.storms ? world.storms.length * 0.5 : 0);
      if (rnd() < 0.004 * (dynParams.floodRate ?? 1) * (0.3 + wet)) { world.flood = 20 + Math.floor(rnd() * 40); world.floodSize = 0.5 + rnd() * rnd() * 2; news.push(world.floodSize > 1.3 ? 'A great flood is coming down the rivers' : 'The rivers are in flood'); }
    }
    if (world.flood > 0) {
      world.flood--;
      const k = 0.02 * (world.floodSize || 1);
      for (let i = 0; i < n; i++) if (isRiver(world, i, sea)) D[i] += k * Math.min(1, D[i] * 4);
    }
  }
  // Levees: a town of 600 or more walls the banks where its streets meet the river
  if (dynParams.levees && world.towns && world.landUse) {
    const LU = world.landUse, OW = world.civOwner;
    for (const t of world.towns) {
      if (t.pop < 600 || t.levees) continue;
      let built = 0;
      const R = 6 + Math.sqrt(t.pop) / 2;
      for (let z = Math.max(1, Math.floor(t.z - R)); z <= Math.min(N - 2, Math.ceil(t.z + R)); z++) for (let x = Math.max(1, Math.floor(t.x - R)); x <= Math.min(N - 2, Math.ceil(t.x + R)); x++) {
        const i = z * N + x;
        if (LU[i] !== 2 || OW[i] !== t.num || LV[i] > 0) continue;
        if ([i - 1, i + 1, i - N, i + N].some((j) => isRiver(world, j, sea))) { H[i] += 0.6; world.prevHeight[i] = H[i]; LV[i] = 0.6; built++; }
      }
      t.levees = built || -1;
    }
    // Breaches: a flood overtopping a levee washes a gap through it
    if (world.flood > 0) for (let i = N; i < n - N; i++) {
      if (LV[i] <= 0) continue;
      const top = Math.max(H[i - 1] + D[i - 1], H[i + 1] + D[i + 1], H[i - N] + D[i - N], H[i + N] + D[i + N]);
      if (top > H[i] - 0.05 && rnd() < 0.05) {
        H[i] -= LV[i]; world.prevHeight[i] = H[i]; LV[i] = 0;
        const t = (world.towns || []).find((u) => u.num === world.civOwner[i]);
        if (t && !t.breachNews) { t.breachNews = true; t.pop *= 0.97; news.push(`The levee at ${t.name} has breached`); }
      }
    }
    if (!(world.flood > 0)) for (const t of world.towns) t.breachNews = false;
  }
}

/**
 * Meanders: where a river crosses flat ground, the current swings to the outside of each bend and
 * cuts into that bank, while sand and gravel settle on the inside: the bends grow and slowly walk
 * across the valley floor, and in time a loop is cut off as an oxbow lake.
 */
function meanderStep(world) {
  const N = world.N, H = world.height, D = world.water, sea = seaOf(world), LU = world.landUse;
  for (let z = 2; z < N - 2; z++) for (let x = 2; x < N - 2; x++) {
    const i = z * N + x;
    if (!isRiver(world, i, sea)) continue;
    const slope = Math.abs(H[i + 1] - H[i - 1]) + Math.abs(H[i + N] - H[i - N]);
    if (slope > 0.3) continue; // (only on flat ground)
    const vx = world.velX[i], vz = world.velZ[i], sp = Math.hypot(vx, vz) || 1;
    const ux = vx / sp, uz = vz / sp;
    const j = Math.round(z + uz * 2) * N + Math.round(x + ux * 2);
    if (j < 0 || j >= N * N) continue;
    const wx = world.velX[j], wz = world.velZ[j], sp2 = Math.hypot(wx, wz);
    if (sp2 < 0.02) continue;
    const turn = ux * (wz / sp2) - uz * (wx / sp2); // (+ turning one way, − the other)
    if (Math.abs(turn) < 0.15) continue;
    // the outside of the bend, and the inside
    const s = turn > 0 ? 1 : -1;
    const ox = Math.round(x - s * uz * 1.5), oz = Math.round(z + s * ux * 1.5);
    const ix = Math.round(x + s * uz * 1.5), iz = Math.round(z - s * ux * 1.5);
    const o = oz * N + ox, n2 = iz * N + ix;
    const k = 0.004 * Math.min(1, Math.abs(turn) * 2) * Math.min(1.5, sp * 4);
    if (o >= 0 && o < N * N && D[o] < 0.05 && H[o] > H[i] && !(LU && LU[o] && LU[o] !== 1)) { H[o] -= k; world.prevHeight[o] = H[o]; }
    if (n2 >= 0 && n2 < N * N && H[n2] < H[i] + D[i] && !(LU && LU[n2])) { H[n2] += k * 0.5; world.prevHeight[n2] = H[n2]; }
  }
}

/**
 * Debris flows: heavy rain on a fresh burn scar (the plants and roots that held the soil gone, the
 * ground sealed by ash) sends a slurry of mud, ash and rock pouring down the slope and along the
 * gully, burying what's below and damming the stream where it stops.
 */
function debrisFlowStep(world, news) {
  const N = world.N, H = world.height, B = world.burnt, sea = seaOf(world);
  const wet = waterParams.rain > 0.002 || (world.storms && world.storms.length > 0);
  if (!wet) return;
  let flows = 0;
  for (let t = 0; t < 200 && flows < 3; t++) {
    const x = 3 + Math.floor(rnd() * (N - 6)), z = 3 + Math.floor(rnd() * (N - 6)), i = z * N + x;
    if (B[i] < 0.4 || H[i] < sea) continue;
    const gx = (H[i + 1] - H[i - 1]) * 0.5, gz = (H[i + N] - H[i - N]) * 0.5, tan = Math.hypot(gx, gz);
    if (tan < 0.35 || rnd() > 0.15) continue;
    // scour the slope round it, then run down the steepest way, dropping the load where it flattens
    let load = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const j = i + dz * N + dx;
      if (B[j] < 0.2) continue;
      const cut = 0.25 * B[j]; H[j] -= cut; world.prevHeight[j] = H[j]; load += cut;
    }
    let cx = x, cz = z;
    for (let s = 0; s < 60 && load > 0.05; s++) {
      const c = cz * N + cx;
      let best = c, bh = H[c];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const j = (cz + dz) * N + cx + dx;
        if (cx + dx < 1 || cz + dz < 1 || cx + dx >= N - 1 || cz + dz >= N - 1) continue;
        if (H[j] < bh) { bh = H[j]; best = j; }
      }
      const drop = H[c] - bh;
      const dep = best === c ? load : load * (drop < 0.15 ? 0.35 : 0.05);
      H[c] += dep; world.prevHeight[c] = H[c]; load -= dep;
      world.vegetation[c] *= 0.3; if (world.water[c] > 0.05) world.water[c] *= 0.5; // (buries the ground, blocks the stream)
      if (H[c] < sea || best === c) break;
      cx = best % N; cz = (best / N) | 0;
    }
    flows++;
  }
  if (flows) { world.debrisFlows = (world.debrisFlows || 0) + flows; if (flows >= 2) news.push('Debris flows are pouring off the burn scars'); }
}

/**
 * Starved beaches: rivers feed the beaches the sand they carry, and the waves move it along the
 * shore. A dam traps its river's sand in the reservoir, so the beaches near that river's mouth get
 * none and wear away; a sea wall or dock cuts the shore's sand supply too, and the beaches beside it
 * shrink and the coast behind them erodes. (Shown as starved beaches in the inspector.)
 */
function starvedBeachStep(world) {
  const N = world.N, n = N * N, H = world.height, LU = world.landUse, SH = world.shore, SAND = world.sand, sea = seaOf(world);
  if (!LU || !SH || !SAND) return;
  const ST = field(world, 'starved');
  ST.fill(0);
  const cut = (cx, cz, R, k) => {
    for (let z = Math.max(1, cz - R); z <= Math.min(N - 2, cz + R); z++) for (let x = Math.max(1, cx - R); x <= Math.min(N - 2, cx + R); x++) {
      const i = z * N + x;
      if (SH[i] !== SHORE.sand && SH[i] !== SHORE.shingle) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d > R) continue;
      ST[i] = Math.max(ST[i], k * (1 - d / (R + 1)));
    }
  };
  // Dams: follow the river down from each dam to the sea
  const dams = [];
  for (let i = 0; i < n; i += 1) if (LU[i] === 7) dams.push(i);
  const seen = new Set();
  for (const d of dams.slice(0, 40)) {
    let c = d, steps = 0;
    while (steps++ < 600) {
      if (H[c] < sea) { const k = `${c}`; if (!seen.has(k)) { seen.add(k); cut(c % N, (c / N) | 0, 30, 1); } break; }
      const x = c % N, z = (c / N) | 0;
      let best = c, bh = H[c] + world.water[c];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (z + dz) * N + x + dx;
        if (x + dx < 0 || z + dz < 0 || x + dx >= N || z + dz >= N) continue;
        const hj = H[j] + world.water[j];
        if (hj < bh) { bh = hj; best = j; }
      }
      if (best === c) break;
      c = best;
    }
  }
  // Sea walls and docks
  for (let i = 0; i < n; i += 3) if (LU[i] === 6 || LU[i] === 13) cut(i % N, (i / N) | 0, 14, 0.7);
  // The starved beaches lose their sand, then the shore wears back
  for (let i = 0; i < n; i++) {
    if (ST[i] <= 0) continue;
    SAND[i] = Math.max(0, SAND[i] - 0.01 * ST[i]);
    if (SAND[i] < 0.3 && !(LU[i]) && H[i] > sea - 1) { H[i] -= 0.002 * ST[i]; world.prevHeight[i] = H[i]; }
  }
}

// --- Climate & disasters -------------------------------------------------------------------------

/**
 * Earthquakes: now and then a fault slips. Within reach of the quake the ground shakes: steep,
 * loose slopes fail in landslides, towns are damaged (people lost), and along the rupture one side
 * is lifted a little. An undersea quake sends a tsunami racing to the coasts nearby: it floods the
 * low ground behind the shore, stripping it to beach and drowning what's there.
 */
function quakeStep(world, news) {
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world);
  if (rnd() > 0.0015 * (dynParams.quakeRate ?? 1)) return;
  const M = 5 + 3 * rnd() * rnd(); // (big ones are rare)
  const ex = 4 + Math.floor(rnd() * (N - 8)), ez = 4 + Math.floor(rnd() * (N - 8)), e = ez * N + ex;
  const R = Math.round(8 * Math.pow(M - 4, 1.4));
  // Landslides on the steepest slopes within reach
  let slides = 0;
  for (let t = 0; t < 120 && slides < Math.round(M - 4); t++) {
    const a = rnd() * Math.PI * 2, d = rnd() * R;
    const x = Math.round(ex + Math.cos(a) * d), z = Math.round(ez + Math.sin(a) * d);
    if (x < 3 || z < 3 || x >= N - 3 || z >= N - 3) continue;
    const i = z * N + x;
    const gx = (H[i + 1] - H[i - 1]) * 0.5, gz = (H[i + N] - H[i - N]) * 0.5, tan = Math.hypot(gx, gz);
    if (tan < 0.45 || H[i] < sea) continue;
    const dx = -gx / tan, dz = -gz / tan;
    const fx = Math.round(x + dx * 20), fz = Math.round(z + dz * 20);
    const relief = fx > 0 && fz > 0 && fx < N && fz < N ? Math.max(0, H[i] - H[fz * N + fx]) : 0;
    if (relief < 3) continue;
    try { triggerLandslide(world, { x, z, i, dx, dz, relief, sat: 0.8, index: 1.2 }); slides++; } catch { /* no slide */ }
  }
  // The rupture: a line through the epicentre, one side lifted
  const ang = rnd() * Math.PI, ux = Math.cos(ang), uz = Math.sin(ang), lift = 0.15 * (M - 5);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const x = ex + dx, z = ez + dz;
    if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
    const along = dx * ux + dz * uz, across = -dx * uz + dz * ux;
    if (Math.abs(along) > R * 0.6 || across < 0 || across > R * 0.4) continue;
    const i = z * N + x;
    H[i] += lift * (1 - across / (R * 0.4)); world.prevHeight[i] = H[i];
  }
  // Towns shaken
  let hit = 0;
  for (const t of world.towns || []) {
    const d = Math.hypot(t.x - ex, t.z - ez);
    if (d > R * 1.5) continue;
    const loss = Math.min(0.15, 0.03 * (M - 5) * (1 - d / (R * 1.5)));
    t.pop *= 1 - loss; hit++;
  }
  // Undersea: a tsunami
  let tsunami = false;
  if (H[e] < sea - 2 && M > 6.3) {
    tsunami = true;
    const run = 1.2 * (M - 6) + 0.8, reach = R * 4;
    const BS = field(world, 'beachSand'), BT = field(world, 'beachType', Int8Array);
    for (let z = Math.max(1, ez - reach); z <= Math.min(N - 2, ez + reach); z++) for (let x = Math.max(1, ex - reach); x <= Math.min(N - 2, ex + reach); x++) {
      const i = z * N + x;
      if (H[i] < sea) continue;
      const d = Math.hypot(x - ex, z - ez);
      if (d > reach) continue;
      const top = sea + run * (1 - d / (reach + 1));
      if (H[i] >= top) continue;
      // (only ground the sea can reach: next to the sea, or to flooded ground)
      world.water[i] += (top - H[i]) * 0.8;
      if (world.landUse && world.landUse[i] && world.landUse[i] !== 1 && world.landUse[i] !== 10) continue;
      world.vegetation[i] = Math.min(world.vegetation[i], 0.06); world.forestAge[i] = 0;
      if (BS[i] < 1) { BS[i] = 1; BT[i] = SHORE.sand; }
    }
    for (const t of world.towns || []) {
      const d = Math.hypot(t.x - ex, t.z - ez);
      if (d < reach && H[t.z * N + t.x] < sea + run * (1 - d / (reach + 1))) t.pop *= 0.8;
    }
  }
  world.lastQuake = { M: Math.round(M * 10) / 10, x: ex, z: ez, year: seasonParams.year || 1, tsunami };
  recordShock(world, 'quake', M, ex, ez, tsunami ? { tsunami: true } : null);
  world.quake = Math.min(2.5, (world.quake || 0) + 0.25 * (M - 4.5));
  news.push(`A magnitude ${M.toFixed(1)} earthquake${hit ? ` shook ${hit} town${hit > 1 ? 's' : ''}` : ''}${slides ? `, setting off ${slides} landslide${slides > 1 ? 's' : ''}` : ''}${tsunami ? ': a tsunami is flooding the coast' : ''}`);
}

/**
 * Permafrost: ground frozen all year where it's cold enough (mean temperature below about −3 °C).
 * As the climate warms it thaws: the ground slumps as its ice melts (thermokarst), hollows fill
 * with ponds, and the peat frozen in it rots, giving off greenhouse gas. It freezes again only
 * slowly when it's cold again.
 */
function permafrostStep(world) {
  const N = world.N, n = N * N, H = world.height, T = world.temperature, sea = seaOf(world);
  const PF = world.permafrost;
  if (!PF || PF.length !== n) {
    world.permafrost = new Float32Array(n);
    for (let i = 0; i < n; i++) if (H[i] >= sea && T[i] < -3) world.permafrost[i] = 1;
    return;
  }
  let released = 0;
  // (for the Permafrost overlay: how much has thawed, and where it's thawing now)
  const PT = field(world, 'pfThawed'), PN = field(world, 'pfThawing');
  for (let i = 0; i < n; i++) {
    PN[i] *= 0.6;
    if (H[i] < sea) { PF[i] = 0; continue; }
    const t = T[i];
    if (PF[i] > 0 && t > -1.5) {
      const thaw = Math.min(PF[i], 0.01 * (t + 1.5 + 0.5));
      PF[i] -= thaw;
      PT[i] = Math.min(1, PT[i] + thaw); PN[i] = 1;
      H[i] -= thaw * 0.4; world.prevHeight[i] = H[i];          // (the ice in it melts: it slumps)
      if (world.soil && world.soil[i] > 0.4) world.water[i] += thaw * 0.15; // (thermokarst ponds)
      released += thaw * (world.humus ? world.humus[i] : 0.5);
    } else if (t < -5 && PF[i] < 1) PF[i] = Math.min(1, PF[i] + 0.0005);
  }
  if (released > 0 && civParams.climateChange && world.carbonPPM !== undefined) world.carbonPPM += released * 0.02;
  world.permafrostThaw = released;
}

/**
 * Bark beetles (native): always about in small numbers in the conifers, they erupt in a drought
 * year (trees too dry to pitch them out) or after a mild winter (more larvae survive), spreading
 * from tree to tree through stressed stands of pine, spruce and fir and killing them, the forest
 * going red then grey. Outbreaks crash after a few years: the old trees are dead, or a hard winter
 * kills the larvae.
 */
function beetleStep(world, news) {
  const N = world.N, n = N * N, V = world.vegetation, A = world.forestAge, CF = world.conifer;
  if (!CF) return;
  const BB = field(world, 'barkBeetle');
  const year = seasonParams.year || 1;
  const drought = seasonParams.enabled && seasonParams.yearKind === 'hot';
  const winterMin = (i) => world.temperature[i] - (seasonParams.swing || 10);
  // A new outbreak
  if (rnd() < (drought ? 0.05 : 0.008)) {
    for (let t = 0; t < 60; t++) {
      const i = Math.floor(rnd() * n);
      if (V[i] > 0.65 && CF[i] > 0.5 && A[i] > 0.4 && (drought || winterMin(i) > -12)) { BB[i] = 0.4; if (drought) news.push('Bark beetles are breaking out in the drought-stressed conifers'); break; }
    }
  }
  // A hard winter or the end of a drought knocks them back (once a year)
  if (world.beetleYear !== year) {
    world.beetleYear = year;
    if (!drought) for (let i = 0; i < n; i++) if (BB[i] > 0) BB[i] *= winterMin(i) < -25 ? 0.2 : 0.6;
  }
  const next = BB.slice();
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = z * N + x;
    const host = V[i] > 0.5 ? CF[i] * (0.3 + 0.7 * A[i]) * (drought ? 1.4 : 1) : 0;
    let b = next[i];
    const near = (BB[i - 1] + BB[i + 1] + BB[i - N] + BB[i + N]) * 0.25;
    if (host > 0.1) { b += 0.3 * near * host * (1 - b) + 0.12 * b * (1 - b) * (host - 0.3); }
    else b -= 0.1 * b;
    next[i] = b < 0.003 ? 0 : b > 1 ? 1 : b;
    // they kill the conifers they're in
    if (BB[i] > 0.3 && V[i] > 0.35) {
      const kill = 0.03 * (BB[i] - 0.3) * CF[i];
      V[i] -= kill; A[i] = Math.max(0, A[i] - kill * 2);
      if (world.deadWood) world.deadWood[i] = Math.min(1, world.deadWood[i] + kill * 6);
      if (world.treeKill) world.treeKill[i] = Math.min(1, world.treeKill[i] + kill * 20);
    }
  }
  // (now and then they fly far)
  for (let t = 0; t < 4; t++) { const i = Math.floor(rnd() * n); if (BB[i] > 0.6) { const j = Math.floor(rnd() * n); if (CF[j] > 0.5 && V[j] > 0.6) next[j] = Math.max(next[j], 0.2); } }
  world.barkBeetle = next;
}

// --- Ecosystems ----------------------------------------------------------------------------------

/**
 * Wetlands: towns drain the marshes and swamps near them for farmland, ditching them (world.drained).
 * The drained ground dries out; its peat, no longer waterlogged, rots away and the ground sinks; and
 * dry peat that catches fire smoulders on for months, deep in the ground. With Rewet wetlands on,
 * towns block the ditches and the wetlands fill back up.
 */
function wetlandStep(world) {
  const N = world.N, n = N * N, LU = world.landUse, H = world.height, sea = seaOf(world);
  const DR = field(world, 'drained', Uint8Array);
  const near = world.nearWater, soil = world.soil;
  if (dynParams.wetlandDrainage && world.towns && LU && near && soil) {
    for (const t of world.towns) {
      if (t.pop < 300 || rnd() > 0.15) continue;
      const R = 8 + Math.sqrt(t.pop) / 2;
      for (let k = 0, done = 0; k < 40 && done < 4; k++) {
        const a = rnd() * Math.PI * 2, d = rnd() * R;
        const x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
        if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
        const i = z * N + x;
        if (DR[i] || LU[i] || H[i] < sea || world.water[i] > 0.3) continue;
        if ((near[i] > 0.5 && soil[i] > 0.7 && world.vegetation[i] > 0.35) || (world.peat && world.peat[i] > 0.5)) { DR[i] = 1; done++; }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (!DR[i]) continue;
    if (dynParams.rewetWetlands) { if (rnd() < 0.01) DR[i] = 0; continue; }
    // (ditched: dries out; the peat rots and the ground sinks)
    if (soil) soil[i] = Math.min(soil[i], 0.45);
    world.water[i] *= 0.6;
    if (world.humus && world.humus[i] > 0.3) { world.humus[i] -= 0.0004; H[i] -= 0.0004; world.prevHeight[i] = H[i]; }
    // (dry peat on fire smoulders on underground, and creeps through the drained ground)
    if (world.fire[i] > 0 && world.humus && world.humus[i] > 0.3) {
      world.fire[i] = Math.max(world.fire[i], 0.3);
      world.humus[i] -= 0.01; H[i] -= 0.01; world.prevHeight[i] = H[i];
      const j = [i - 1, i + 1, i - N, i + N][Math.floor(rnd() * 4)];
      if (DR[j] && rnd() < 0.2 && world.fire[j] <= 0) { world.fire[j] = 0.3; world.fireCells.push(j); }
    }
  }
}

/**
 * Peat bogs (world.peat: depth of peat). On cool, flat, waterlogged ground, the moss (sphagnum) grows
 * faster than it can rot in the cold, sour water, and its remains pile up as peat, very slowly. Once
 * there is a good depth of it the bog holds its own water like a sponge, keeping itself wet through
 * dry spells, and creeps out over the wet ground around it: a bog, once formed, is very stable. Only
 * a few dwarf shrubs and stunted trees grow on it. Peat is a huge store of carbon, many times what a
 * forest holds (sim/forestCarbon.js). Drained (towns ditch bogs for farmland: Wetland drainage), farmed
 * or burnt, it dries out and rots away, giving its carbon off to the air, and the ground sinks and
 * turns to heath shrubland. On a map that has never had bogs, the ones the land would have built up
 * over thousands of years are there from the start.
 */
function bogStep(world) {
  const N = world.N, n = N * N, H = world.height, sea = seaOf(world);
  const fresh = !world.peat || world.peat.length !== n;
  const PT = field(world, 'peat'), soil = world.soil, T = world.vegTemp || world.temperature, P = world.precip;
  if (!soil || !T) return;
  const DR = world.drained, LU = world.landUse;
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = z * N + x;
    const pt = PT[i];
    if (H[i] < sea) { if (pt) PT[i] = 0; continue; }
    // Drained, farmed, built on or burning: the peat dries and rots (or burns) away
    if ((DR && DR[i]) || (LU && LU[i]) || world.fire[i] > 0) {
      if (pt > 0) {
        const lost = Math.min(pt, world.fire[i] > 0 ? 0.02 : 0.0015);
        PT[i] -= lost; H[i] -= lost * 0.5; world.prevHeight[i] = H[i];
        if (PT[i] < 0.01) PT[i] = 0;
      }
      continue;
    }
    const slope = Math.hypot(H[i + 1] - H[i - 1], H[i + N] - H[i - N]) * 0.5;
    const t = T[i];
    // Cool (not frozen solid, not warm enough to rot it), flat and wet
    const cool = t < -4 || t > 15 ? 0 : t < 0 ? (t + 4) / 4 : t > 11 ? (15 - t) / 4 : 1;
    // (flat ground; in a very wet climate gentle slopes too, blanketed in peat)
    const pr = P ? P[i] : 0.5, maxSlope = 0.22 + 0.3 * Math.min(1, Math.max(0, (pr - 0.6) / 0.6));
    const flat = slope > maxSlope ? 0 : 1 - slope / maxSlope;
    let edge = 0;
    if (pt < 1) edge = Math.max(PT[i - 1], PT[i + 1], PT[i - N], PT[i + N]) > 1 ? 0.15 : 0; // (a bog spreads out over the wet ground beside it)
    const wet = Math.min(1, Math.max(0, (soil[i] - 0.62 + edge) / 0.25)) * Math.min(1, pr / 0.45 + (pt > 1 ? 0.5 : 0));
    const cond = cool * flat * wet;
    if (fresh) { if (cond > 0.55) PT[i] = 3 * (cond - 0.45); continue; }
    if (cond > 0.3) {
      const grow = 0.0005 * cond;
      PT[i] = Math.min(5, pt + grow);
      H[i] += grow * 0.3; world.prevHeight[i] = H[i]; // (a raised bog slowly domes up)
    } else if (pt > 0 && cond < 0.05 && pt < 1) PT[i] = Math.max(0, pt - 0.0002); // (a thin skin of peat on ground that dried out rots)
    // The sponge: a bog keeps itself wet
    if (PT[i] > 0.6) soil[i] = Math.max(soil[i], Math.min(0.95, 0.7 + 0.06 * PT[i]));
  }
}

/**
 * Seed dispersal: which tree species have reached each place (world.speciesHere, one bit each, up
 * to 31 species). A species grows only where it has arrived (sim/species.js). Seeds spread from
 * the trees out to the ground next to them, light wind-blown seeds (pioneers: aspen, birch,
 * pine, alder…) fast, heavy ones (oak, beech, maple: carried by jays and squirrels) slowly, and
 * now and then a bird carries one far across the map.
 */
let SPEED = null;
function seedStep(world) {
  const N = world.N, n = N * N, SP = SPECIES;
  const K = Math.min(31, SP.length);
  if (!SPEED || SPEED.length !== K) SPEED = SP.slice(0, K).map((s) => (s.age <= 0.2 ? 0.45 : s.age >= 0.75 ? 0.08 : 0.2));
  let S = world.speciesHere;
  if (!S || S.length !== n) {
    // (to start: every species is wherever trees are now and it suits)
    S = new Uint32Array(n);
    const out = new Float32Array(SP.length + 1);
    world.speciesHere = null; // (while working it out: every species counts as present)
    for (let i = 0; i < n; i++) {
      if (world.vegetation[i] < 0.3) continue;
      treeShares(world, i, out);
      let bits = 0;
      for (let k = 0; k < K; k++) if (out[k] > 0.02) bits |= 1 << k;
      S[i] = bits;
    }
    world.speciesHere = S;
    return;
  }
  // This step's seeds: which species spread, and which way
  let mask = 0;
  for (let k = 0; k < K; k++) if (rnd() < SPEED[k]) mask |= 1 << k;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let rep = 0; rep < 2; rep++) {
    const [dx, dz] = dirs[Math.floor(rnd() * 4)];
    const off = dz * N + dx;
    if (off > 0) { for (let i = n - 1; i >= 0; i--) { const j = i - off; if (j >= 0 && world.vegetation[j] > 0.3) S[i] |= S[j] & mask; } }
    else { for (let i = 0; i < n; i++) { const j = i - off; if (j < n && world.vegetation[j] > 0.3) S[i] |= S[j] & mask; } }
  }
  // birds: a few long flights
  for (let t = 0; t < 12; t++) { const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n); if (world.vegetation[a] > 0.5) S[b] |= S[a] & mask; }
  // (mod species beyond 31 are everywhere: species.js treats them as present)
}

/**
 * Invasive animals: feral pigs escape from the towns' farms and spread through the woods and
 * fields, rooting up the soil and eating seedlings; feral goats, let loose by the harbours, strip
 * the hillsides of young trees; ship rats come ashore from the boats and eat the eggs and young of
 * the small animals of the land (ground-nesting birds, woodpeckers and the like).
 */
function invasiveStep(world, news) {
  if (!ecoParams.enabled || !world.towns || !world.towns.length) return;
  ensureEcology(world);
  const has = (name) => world.animals.some((a) => a.name === name);
  const N = world.N, n = N * N;
  const seedNear = (a, towns, d0) => {
    const P = animalField(world, a);
    for (const t of towns) for (let k = 0; k < 60; k++) {
      const x = Math.round(t.x + (rnd() - 0.5) * d0 * 2), z = Math.round(t.z + (rnd() - 0.5) * d0 * 2);
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const i = z * N + x;
      if (canLive(world, a, i)) P[i] = Math.max(P[i], 0.2);
    }
  };
  const farmers = world.towns.filter((t) => t.pop > 300);
  if (farmers.length && !has('Feral pig') && rnd() < 0.3) {
    const pig = newAnimal({ name: 'Feral pig', color: [0.36, 0.26, 0.22], habitat: 'land', eats: { grass: true, young: true }, breed: 1.5, roam: 4, habits: { roots: true }, tempMin: -5, tempMax: 35 });
    world.animals.push(pig); seedNear(pig, farmers.slice(0, 3), 8);
    news.push('Feral pigs have escaped into the countryside');
  }
  const ports = world.towns.filter((t) => t.harbor !== undefined && t.boats);
  if (ports.length && !has('Feral goat') && rnd() < 0.2) {
    const goat = newAnimal({ name: 'Feral goat', color: [0.80, 0.78, 0.70], habitat: 'mountains', eats: { grass: true, young: true, decid: true }, breed: 1.3, roam: 4, habits: { overbrowse: true }, tempMin: -10, tempMax: 35 });
    world.animals.push(goat); seedNear(goat, ports.slice(0, 2), 10);
    news.push('Feral goats are loose on the hills');
  }
  if (ports.length && !has('Ship rat') && rnd() < 0.3) {
    const small = world.animals.filter((a) => /bird|pecker|nest|moth|beetle|lizard|vole|mouse/i.test(a.name)).map((a) => a.id);
    const rat = newAnimal({ name: 'Ship rat', color: [0.30, 0.28, 0.27], habitat: 'land', eats: { grass: true }, prey: small, breed: 1.8, roam: 3, tempMin: -5, tempMax: 38 });
    world.animals.push(rat); seedNear(rat, ports.slice(0, 3), 5);
    news.push('Ship rats have come ashore from the boats');
  }
  // (rats go after the small animals added since)
  const rat = world.animals.find((a) => a.name === 'Ship rat');
  if (rat) for (const a of world.animals) if (a !== rat && /bird|pecker|nest|moth|beetle|lizard|vole|mouse/i.test(a.name) && !rat.prey.includes(a.id)) rat.prey.push(a.id);
}

/**
 * Crop pests and blights: they break out in the farmland now and then, worst in big blocks of one
 * crop, and spread field to field. A field that's infested yields less (sim/civilization.js). They
 * die back on their own, faster where hedgerows and wild ground among the fields shelter their
 * enemies (pollinators show where), and with crop rotation (a setting) they spread less.
 */
function pestStep(world) {
  const N = world.N, n = N * N, LU = world.landUse;
  if (!LU) return;
  const PS = field(world, 'cropPest');
  const rot = dynParams.cropRotation;
  // A new outbreak in a big block of fields
  if (rnd() < 0.05) for (let t = 0; t < 40; t++) {
    const x = 3 + Math.floor(rnd() * (N - 6)), z = 3 + Math.floor(rnd() * (N - 6)), i = z * N + x;
    if (LU[i] !== 1) continue;
    let f = 0;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (LU[i + dz * N + dx] === 1) f++;
    if (f > 25) { PS[i] = 0.4; break; } // (a big block of one crop)
  }
  const next = PS.slice();
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = z * N + x;
    if (LU[i] !== 1) { next[i] = 0; continue; }
    const near = (PS[i - 1] + PS[i + 1] + PS[i - N] + PS[i + N]) * 0.25;
    let p = next[i] + 0.15 * near * (rot ? 0.6 : 1) * (1 - next[i]) + 0.1 * next[i] * (1 - next[i]);
    const hedge = world.pollinators ? Math.min(1, world.pollinators[i] * 2) : 0.3;
    p -= p * (0.01 + 0.04 * hedge + (rot ? 0.05 : 0));
    next[i] = p < 0.005 ? 0 : p > 1 ? 1 : p;
  }
  world.cropPest = next;
}

// --- People --------------------------------------------------------------------------------------

/**
 * Urban heat and smog: paved streets and buildings soak up the sun, so a town is warmer than the
 * country round it (up to about 2.5 °C in a big centre: world.heatIsland, added to the temperature in
 * sim/climate.js); and on still days the towns' smoke can't blow away, so it builds up as smog over
 * the town and drifts into the valleys, harming the people and the plants.
 */
function heatStep(world) {
  const N = world.N, n = N * N, P = world.paved;
  if (!P) return;
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) if (P[i] > 0.3) src[i] = P[i] * (world.townCore && world.townCore[i] ? 1.4 : 1);
  const b = boxBlur(boxBlur(src, N, 4), N, 4);
  const HI = field(world, 'heatIsland');
  for (let i = 0; i < n; i++) HI[i] = Math.min(2.5, b[i] * 4);
  // Smog on still days
  if (world.airPollution && world.wind) {
    const AP = world.airPollution;
    for (let i = 0; i < n; i++) {
      if (b[i] < 0.02) continue;
      const still = 1 - Math.min(1, world.wind[i] / 0.6);
      AP[i] = Math.min(2, AP[i] + 0.05 * b[i] * still * still);
    }
    for (const t of world.towns || []) {
      const s = AP[t.z * N + t.x];
      if (s > 0.6) t.pop *= 1 - 0.003 * Math.min(1, s - 0.6); // (smog sickens people)
    }
  }
}

/**
 * Salt: in dry, hot country, irrigation water evaporates off the fields and leaves its salts behind.
 * Year by year the soil salts up (world.soilSalt), the crop yields less (sim/civilization.js), and
 * once it's too salty the field is abandoned, a white crust over worn-out ground. Rain washes it out
 * only slowly.
 */
function saltStep(world) {
  const N = world.N, n = N * N, LU = world.landUse, IR = world.irrigated;
  if (!LU || !IR) return;
  const SA = field(world, 'soilSalt'); // (salt in the soil; world.salinity is the sea's)
  for (let i = 0; i < n; i++) {
    const rain = world.precip ? Math.min(1, world.precip[i]) : 0.5;
    if (LU[i] === 1 && IR[i]) {
      const dry = Math.max(0, 1 - rain * 1.6), hot = world.temperature[i] > 14 ? 1 : 0.4;
      SA[i] = Math.min(1, SA[i] + 0.0015 * dry * hot);
      if (SA[i] > 0.75) {
        // (abandoned: salted and worn out)
        LU[i] = 0; if (world.civOwner) world.civOwner[i] = 0; IR[i] = 0;
        if (world.degraded) world.degraded[i] = Math.max(world.degraded[i], 0.6);
        if (world.farmSoil) world.farmSoil[i] = 0;
      }
    }
    if (SA[i] > 0) SA[i] = Math.max(0, SA[i] - 0.0003 * (0.2 + rain));
  }
}

/**
 * Ruins: when a town is abandoned (dwindled away, burnt out, washed away) its streets and buildings
 * don't vanish: they stand as ruins (world.ruins), forest growing up through them, slowly crumbling
 * over the decades. Abandoned roads stay visible as old tracks for a long time too.
 */
function ruinStep(world) {
  const n = world.N * world.N, LU = world.landUse, OW = world.civOwner, P = world.paved;
  if (!LU) return;
  const RU = field(world, 'ruins');
  for (let i = 0; i < n; i++) {
    const u = LU[i];
    if ((u === 2 || u === 4 || u === 5) && !OW[i]) RU[i] = Math.max(RU[i], 0.9);      // (an abandoned town's streets)
    else if (u === 3 && !OW[i] && world.roadCond && world.roadCond[i] < 0.3) RU[i] = Math.max(RU[i], 0.4); // (an old road)
    if (RU[i] > 0) {
      if (u === 2 && OW[i]) { RU[i] = 0; continue; } // (built over again)
      RU[i] = Math.max(0, RU[i] - 0.00025);
    }
  }
}

/** Crop yield factor at a field cell (pests and salt), for sim/civilization.js. */
export function cropHealth(world, i) {
  let f = 1;
  if (world.cropPest) f *= 1 - 0.6 * world.cropPest[i];
  if (world.soilSalt) f *= 1 - 0.8 * world.soilSalt[i];
  return f;
}
