// Coasts, tides and the ocean.
//
// Tides: the sea rises and falls twice a "day" (the Moon's pull), over the Tide range. The strip
// between low and high water, the intertidal zone, floods and drains every cycle.
//
// Shore types (world.shore, per cell near the sea), chosen by the conditions there:
//   mudflat  – very gentle, sheltered shores (bays, estuaries) where fine silt settles: wide flats
//              that drain at low tide (Willapa Bay, the Skagit and Nisqually deltas)
//   sand     – beaches where sand collects: fed by rivers, eroded soft rock and, in warm seas, coral
//   shingle  – pebble and cobble beaches on exposed shores with little sand (much of Puget Sound,
//              where glaciers left gravel everywhere)
//   cliff    – steep coasts the waves undercut, so the cliff retreats
//   basalt   – black boulder beaches where basalt lava meets the sea (the Olympic coast)
// In warm seas, mangrove forests grow on the mudflats and sheltered shores (world.mangrove).
// The Shoreline tool paints a type, overriding the automatic choice.
//
// Waves: they erode the shore, hardest where it is exposed to open water (a long fetch) and the rock
// is soft. The eroded material becomes beach sand (soft rock) or shingle (hard rock). Sand
// (world.sand, depth) builds up from that, from river sediment and from coral reefs, and waves strip
// it away fastest on exposed shores. A thick beach absorbs the waves and protects the land behind.
// Wind blows sand off sand beaches into dunes behind them (world.dune).
//
// Ocean biomes (world.marine) follow the water temperature and depth: sea ice in freezing seas,
// kelp forests on cool rocky shores, seagrass meadows in sandy or muddy shallows, coral reefs in warm
// shallow water, and open or deep ocean beyond. world.coastal is how near the sea a spot is (salt
// spray and sea fog: see the coastal trees in species.js).

import { boxBlur } from '../core/grid.js';
import { climateParams, seasonParams } from './climate.js';
import { ROCK_INDEX } from '../core/rocks.js';
import { waterQualityStep, addSilt, ensureQuality } from './waterQuality.js';

export const coastParams = {
  tideRange: 1.5,     // height between low and high tide
  tidePeriod: 30,     // simulated seconds per tidal cycle
  waveErosion: 0.004, // how fast waves cut the shore (× exposure × softness)
  coral: 1,           // coral growth (warm seas)
  shoreType: 'auto',  // what the Shoreline tool paints
};

export const SHORES = [
  { id: 'mudflat', label: 'Mudflat', color: [0.42, 0.38, 0.31], help: 'Wide, flat, muddy shore of sheltered bays and estuaries; floods and drains with every tide.' },
  { id: 'sand', label: 'Sand beach', color: [0.88, 0.80, 0.60], help: 'Sandy beach, fed by rivers, eroded soft rock and (in warm seas) coral.' },
  { id: 'shingle', label: 'Shingle beach', color: [0.56, 0.54, 0.50], help: 'Pebble and cobble beach of exposed shores with little sand.' },
  { id: 'cliff', label: 'Rock cliff', color: [0.50, 0.46, 0.42], help: 'Steep coast undercut by the waves; it retreats as they erode it.' },
  { id: 'basalt', label: 'Basalt boulder beach', color: [0.17, 0.17, 0.19], help: 'Black boulders and cobbles where basalt meets the sea.' },
];
export const SHORE = Object.fromEntries(SHORES.map((s, k) => [s.id, k]));

export const MARINE = [
  { id: 'ice', label: 'Sea ice', color: [0.90, 0.94, 0.97], bed: [0.46, 0.44, 0.40], help: 'Frozen sea surface in freezing water.' },
  { id: 'kelp', label: 'Kelp forest', color: [0.30, 0.32, 0.14], bed: [0.36, 0.34, 0.16], help: 'Underwater forests of giant kelp on cool, rocky shores, like the Washington coast.' },
  { id: 'seagrass', label: 'Seagrass meadow', color: [0.30, 0.50, 0.26], bed: [0.32, 0.46, 0.24], help: 'Eelgrass and seagrass in sandy and muddy shallows of bays.' },
  { id: 'coral', label: 'Coral reef', color: [0.92, 0.62, 0.58], bed: [0.86, 0.66, 0.56], help: 'Reefs built by corals in warm, clear, shallow water; they make white coral sand.' },
  { id: 'shelf', label: 'Open ocean (shelf)', color: [0.20, 0.45, 0.62], bed: [0.58, 0.55, 0.47], help: 'Shallow sea over the continental shelf.' },
  { id: 'deep', label: 'Deep ocean', color: [0.08, 0.20, 0.42], bed: [0.36, 0.36, 0.36], help: 'Deep water far from shore.' },
  { id: 'dieoff', label: 'Die-off (bare seabed)', color: [0.48, 0.42, 0.34], bed: [0.50, 0.45, 0.38], help: 'Seagrass, kelp or coral killed by dirty water (silt or pollutants): bare mud and rubble, or bleached, dead coral. It recovers slowly once the water is clean again.' },
];
export const MARINE_ID = Object.fromEntries(MARINE.map((m, k) => [m.id, k]));
// How well each sea bed cleans the water, and how easily dirty water harms it
const FILTER = MARINE.map((m) => ({ seagrass: 0.06, kelp: 0.05, coral: 0.04 }[m.id] || 0));
const SENSITIVE = MARINE.map((m) => ({ seagrass: 1.1, kelp: 1, coral: 1.6 }[m.id] || 0));
// How fast each bed declines under dirty water and regrows once it's clean (seagrass slowest: the
// meadow thins out gradually, its density falling over many weeks, and fills back in as slowly)
const PACE = MARINE.map((m) => ({ seagrass: 0.2, kelp: 0.5, coral: 1 }[m.id] || 1));
// How much a dense bed shields itself from dirty water (seagrass meadows most)
const RESIST = MARINE.map((m) => ({ seagrass: 1, kelp: 0.5 }[m.id] || 0));
// Beds whose density thins gradually (they show as a sparser meadow, not a sudden die-off)
const THINS = MARINE.map((m) => m.id === 'seagrass' || m.id === 'kelp');

/** The colour of the sea bed at i (bed: the natural view's colours, else the overlay's). */
export function marineColor(world, i, bed, out) {
  const m = marineShown(world, i);
  const c = bed ? MARINE[m].bed : MARINE[m].color;
  if (!THINS[m]) return c;
  // A thinning meadow: patches of bare seabed showing between the plants
  const d = world.marineHealth ? world.marineHealth[i] : 1;
  const b = bed ? MARINE[MARINE_ID.dieoff].bed : MARINE[MARINE_ID.dieoff].color, t = Math.min(1, d * 1.4);
  out[0] = b[0] + (c[0] - b[0]) * t; out[1] = b[1] + (c[1] - b[1]) * t; out[2] = b[2] + (c[2] - b[2]) * t;
  return out;
}

/** True for beds that thin gradually (seagrass, kelp): their health is their density. */
export function marineThins(m) { return m >= 0 && THINS[m]; }

/** The sea bed as it looks now: a living bed that dirty water has killed shows as a die-off. */
export function marineShown(world, i) {
  const m = world.marine ? world.marine[i] : -1;
  if (m >= 0 && SENSITIVE[m] > 0 && world.marineHealth && world.marineHealth[i] < (THINS[m] ? 0.05 : 0.3)) return MARINE_ID.dieoff;
  return m;
}

/** Make sure the coast fields exist. */
export function ensureCoast(world) {
  const n = world.N * world.N;
  if (!world.sand || world.sand.length !== n) world.sand = new Float32Array(n);
  if (!world.shore || world.shore.length !== n) world.shore = new Int8Array(n).fill(-1);
  if (!world.shoreSet || world.shoreSet.length !== n) world.shoreSet = new Int8Array(n).fill(-1);
  if (!world.marine || world.marine.length !== n) world.marine = new Int8Array(n).fill(-1);
  if (!world.coastal || world.coastal.length !== n) world.coastal = new Float32Array(n);
  if (!world.dune || world.dune.length !== n) world.dune = new Float32Array(n);
  if (!world.coral || world.coral.length !== n) world.coral = new Float32Array(n);
  if (!world.mangrove || world.mangrove.length !== n) world.mangrove = new Float32Array(n);
  ensureQuality(world);
}

/** Sea surface now: mean sea level plus the tide. Called every frame. */
export function tideLevel(world, meanSea) {
  const p = coastParams;
  world.tide = 0.5 * p.tideRange * Math.sin((2 * Math.PI * (world.time || 0)) / p.tidePeriod);
  world.meanSea = meanSea;
  return meanSea + world.tide;
}

/** Water temperature of the sea (°C): the air's year average, with a damped season. */
export function seaTemp() {
  const st = seasonParams.enabled ? seasonParams.swing * Math.sin(2 * Math.PI * (seasonParams.phase - 0.12)) : 0;
  return climateParams.seaTemp + 0.45 * st; // the sea lags and swings less than the air
}

/**
 * Water temperature (°C) at cell i if it lies under the sea, else null. The surface follows
 * seaTemp(); below the sunlit top layer it cools toward the cold deep water (about 4 °C), which
 * barely feels the seasons. now=false gives the year average.
 */
export function waterTempAt(world, i, now = true) {
  const sea = world.meanSea;
  if (sea === undefined || sea < -999) return null;
  const depth = sea - world.height[i];
  if (depth <= 0) return null;
  const surf = now ? seaTemp() : climateParams.seaTemp;
  return surf + (Math.min(surf, 4) - surf) * smoothstep(4, 20, depth);
}

/**
 * Classify the shore and ocean, erode the shore with waves, and move sand. Run with the
 * vegetation/climate step.
 */
export function coastStep(world) {
  ensureCoast(world);
  const N = world.N, n = N * N, H = world.height, sea = world.meanSea;
  if (sea === undefined || sea < -999) {
    world.shore.fill(-1); world.marine.fill(-1); world.coastal.fill(0); world.dune.fill(0);
    world.seasonScale = null;
    return;
  }
  const p = coastParams, half = 0.5 * p.tideRange;
  const SAND = world.sand, SH = world.shore, SET = world.shoreSet, M = world.marine, CO = world.coral;
  // Open water around each spot: how exposed it is to waves (bays are sheltered, headlands exposed)
  const seaMask = new Float32Array(n);
  for (let i = 0; i < n; i++) seaMask[i] = H[i] < sea - half ? 1 : 0;
  const exposure = boxBlur(seaMask, N, 10);
  const nearSea = boxBlur(boxBlur(seaMask, N, 3), N, 3);
  // Coastal influence (salt spray, sea fog) reaching a few cells inland
  const coast = boxBlur(seaMask, N, 10);
  for (let i = 0; i < n; i++) world.coastal[i] = Math.min(1, coast[i] * 3);
  // Maritime vs continental climate: the sea damps the seasons near the coast (about half the
  // swing at the shore) and inland, away from it, they swing more (colder winters, hotter summers)
  const marine = boxBlur(boxBlur(seaMask, N, 16), N, 16);
  if (!world.seasonScale || world.seasonScale.length !== n) world.seasonScale = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = Math.min(1, marine[i] * 3);
    world.seasonScale[i] = 0.5 + 0.75 * (1 - m); // 0.5 at the coast … 1.25 far inland
  }
  const Tw = seaTemp();
  const erodeK = p.waveErosion * (world.erosionEnabled ? 1 : 0);
  const basalt = ROCK_INDEX.basalt;
  const sandBeach = new Float32Array(n);

  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x, h = H[i];
      // --- Ocean: biome by temperature and depth ---
      if (h < sea - half) {
        const depth = sea - h;
        let m;
        const rocky = world.hardnessAt(h, i) > 0.6;
        if (Tw < -1.5) m = MARINE_ID.ice;
        else if (depth > 14) m = MARINE_ID.deep;
        else if (depth < 6 && Tw > 20) m = MARINE_ID.coral;
        else if (depth < 6 && Tw > 4 && Tw < 19 && rocky) m = MARINE_ID.kelp;
        else if (depth < 4) m = MARINE_ID.seagrass;
        else m = MARINE_ID.shelf;
        M[i] = m;
        // Coral reefs grow in warm shallows and grind down into white coral sand
        CO[i] += ((m === MARINE_ID.coral ? world.marineHealth[i] : 0) - CO[i]) * 0.02;
        SH[i] = -1;
        continue;
      }
      M[i] = -1;
      CO[i] *= 0.95;
      // --- Shore: land within reach of the waves (up to a little above high tide) ---
      if (h > sea + half + 2.5 || nearSea[i] <= 0) { SH[i] = -1; continue; }
      const gx = (H[i + 1] - H[i - 1]) * 0.5, gz = (H[i + N] - H[i - N]) * 0.5;
      const slope = Math.sqrt(gx * gx + gz * gz);
      const ex = exposure[i];
      const hard = world.hardnessAt(h, i);
      let type = SET[i];
      // A new coast starts with sand on its gentle, exposed shores (built up over the ages before)
      if (!world.coastInit && slope < 0.4 && ex > 0.15) SAND[i] = Math.max(SAND[i], 0.3 + 1.2 * ex * (1 - slope * 2));
      if (type < 0) {
        // A cliff needs a steep face and real height behind it; at the foot of one is shingle
        const behind = Math.max(H[i + 1], H[i - 1], H[i + N], H[i - N]) - h;
        if (slope > 1.4 && behind > 1.8) type = SHORE.cliff;
        else if (ex < 0.22 && slope < 0.18) type = SHORE.mudflat;
        else if (SAND[i] > 0.35 && slope < 0.6) type = SHORE.sand; // sand covers whatever rock is beneath
        else if (world.rockAt(h, i) === basalt && ex > 0.15) type = SHORE.basalt;
        else type = SHORE.shingle;
      }
      SH[i] = type;
      // --- Waves erode the shore: exposed, soft coasts fastest; a thick beach protects ---
      const inReach = h < sea + half + 1.2;
      if (inReach && erodeK > 0 && type !== SHORE.mudflat) {
        const protect = 1 - Math.min(0.85, SAND[i] * 0.6);
        // (mangrove roots take the force out of the waves)
        const cut = erodeK * ex * (1.2 - hard) * protect * (1 - 0.85 * world.mangrove[i]) * (type === SHORE.cliff ? 2 : 1);
        H[i] -= cut;
        // Soft rock breaks down to sand; hard rock to shingle (doesn't add sand). The fines cloud
        // the water.
        SAND[i] += cut * (1.3 - hard) * 2;
        addSilt(world, i, cut * (1.4 - hard) * 3);
      }
      // Mudflats wash out where the waves reach them, and the mud they lose clouds the water
      // (fast where they're bare; mangroves and seagrass hold the mud down)
      if (inReach && erodeK > 0 && type === SHORE.mudflat) {
        const grass = [i - 1, i + 1, i - N, i + N].some((j) => M[j] === MARINE_ID.seagrass) ? 0.6 * world.marineHealth[i] : 0;
        const cut = erodeK * (0.3 + 2 * ex) * (1 - 0.85 * world.mangrove[i]) * (1 - grass);
        H[i] -= cut;
        addSilt(world, i, cut * 6);
      }
      // --- Longshore drift: waves running along the shore fill coves and plane off bumps, so
      // beaches straighten into long stretches between points (hard-rock headlands hold out) ---
      if (inReach && erodeK > 0 && type !== SHORE.cliff) {
        const avg = (H[i - 1] + H[i + 1] + H[i - N] + H[i + N] + H[i - N - 1] + H[i - N + 1] + H[i + N - 1] + H[i + N + 1]) / 8;
        H[i] += (avg - H[i]) * 0.04 * ex * (1.2 - hard);
      }
      // --- Sand budget: rivers and coral feed it, exposed waves strip it ---
      const river = world.sediment[i] * 0.3;
      const coralSand = nearCoral(CO, i, N) * 0.01 * p.coral;
      const loss = 0.004 * ex * (type === SHORE.cliff ? 3 : 1);
      SAND[i] = Math.max(0, Math.min(3, SAND[i] + river + coralSand - loss * SAND[i]));
      if (type === SHORE.sand) sandBeach[i] = SAND[i];
    }
  }
  world.coastInit = true;
  // Wind blows sand inland off sand beaches into dunes (a few cells behind the beach, low ground)
  const blown = boxBlur(boxBlur(sandBeach, N, 6), N, 6);
  for (let i = 0; i < n; i++) {
    const h = H[i];
    const low = h > sea + half && h < sea + half + 8 ? 1 : 0;
    world.dune[i] = low * Math.min(1, blown[i] * 12);
  }
  // Mangroves: forests of salt-tolerant trees standing in the tide on warm, sheltered mudflats.
  // They need warm water all year (they die back where the sea drops much below ~20 °C), spread out
  // across the flats and into the shallows, trap mud among their roots (so the flat slowly builds
  // up) and break the waves.
  const MG = world.mangrove, warm = smoothstep(19, 23, climateParams.seaTemp);
  for (let i = 0; i < n; i++) {
    const h = H[i];
    let target = 0;
    if (warm > 0) {
      if (SH[i] === SHORE.mudflat) target = warm;
      else if (SH[i] === SHORE.sand && exposure[i] < 0.3) target = 0.6 * warm;
      else if (h < sea - half && h > sea - half - 1.2 && exposure[i] < 0.75 && i > N && i < n - N
        && Math.max(MG[i - 1], MG[i + 1], MG[i - N], MG[i + N]) > 0.35) target = 0.8 * warm; // spreading out into the shallows
    }
    MG[i] += (target - MG[i]) * (target > MG[i] ? 0.03 : 0.08);
    if (MG[i] < 0.005) MG[i] = 0;
    // Trapped mud builds the flat up toward the high-tide line
    if (MG[i] > 0.2 && h < sea + half) H[i] += 0.0015 * MG[i];
  }
  // Seawater quality: silt and pollutants mix, settle, flush out to sea and are filtered by the
  // living sea beds, which die off where it stays too dirty
  waterQualityStep(world, sea, half, FILTER, SENSITIVE, PACE, RESIST);
  world.dirty = true;
}

function nearCoral(CO, i, N) {
  return Math.max(CO[i - 1], CO[i + 1], CO[i - N], CO[i + N], CO[i - N - 1], CO[i + N + 1]);
}

/**
 * The Shoreline tool: set the shore type under the brush and shape the ground to match.
 * type 'auto' (or Shift) returns it to the automatic choice.
 */
export function paintShore(world, i, w, type, dt) {
  ensureCoast(world);
  const sea = world.meanSea;
  if (sea === undefined || sea < -999) return;
  const H = world.height, half = 0.5 * coastParams.tideRange;
  if (type === 'auto') { world.shoreSet[i] = -1; return; }
  const k = SHORE[type];
  if (k === undefined) return;
  // Only the shore itself: a little below low tide up to a little above high tide
  if (H[i] < sea - half - 3 || H[i] > sea + half + 6) return;
  world.shoreSet[i] = k;
  const s = Math.min(1, dt * 4) * w;
  if (k === SHORE.mudflat) {
    // Wide, nearly flat, just about at mean sea level
    H[i] += (sea + 0.1 - H[i]) * s * 0.5;
    world.vegetation[i] *= 1 - s;
  } else if (k === SHORE.sand) {
    world.sand[i] = Math.min(3, world.sand[i] + s * 1.5);
    world.vegetation[i] *= 1 - s;
  } else if (k === SHORE.shingle) {
    world.sand[i] *= 1 - s;
    world.vegetation[i] *= 1 - s;
  } else if (k === SHORE.cliff) {
    // Lift the land above the tide into a steep face
    if (H[i] > sea + half) H[i] += s * 3;
    world.sand[i] *= 1 - s;
  } else if (k === SHORE.basalt) {
    // Basalt at the surface, with a rough, bouldery face
    world.surfaceRock[i] = ROCK_INDEX.basalt;
    world.surfaceBase[i] = Math.min(world.surfaceBase[i] || H[i] - 2, H[i] - 2);
    world.sand[i] *= 1 - s;
    world.vegetation[i] *= 1 - s;
  }
  world.dirty = true;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
