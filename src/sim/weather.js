// Weather: storms that cross the map.
//
// Real rain doesn't fall evenly everywhere: it comes in storms, regional, ragged patches of cloud
// carried along by the prevailing wind. Each storm here is a cluster of rain cells that drift
// around inside it, with heavier and lighter bands that shift as it goes. It rains hardest where
// the ground forces its air upward (windward slopes: the same orographic effect as the
// Precipitation overlay).
//
// Fuel: a storm carries a fixed store of water vapour. Every drop it rains out is gone, and it
// rains out fastest while climbing over mountains, so storms that cross a range arrive on the far
// side weakened or spent: the *rain shadow*. Passing over the sea or a lake tops the store back up.
// When the fuel runs out the storm breaks up.
//
// Rain or snow is decided at the cloud base above each spot (see climate.cloudTempAt), which
// includes today's season. Rain goes straight into the water simulation, so storms raise streams
// and can trigger floods and landslides. Snow piles onto the snowpack. Through a winter, storm
// after storm builds the pack up on the mountains. In spring the warmth melts it, and the meltwater
// (climate.updateSnow) swells the rivers: the spring flood.
//
// Wet season: from late October to mid-March storms are practically constant.
//
// Mountain storms: the wet season reaches the high country first. From mid-September through
// mid-March storms build over the ranges one after another and cling to the peaks, so the mountains
// get many storms weeks before the lowlands; with cold air aloft they fall as snow, building the
// high snowpack. The rest of the year storms are the ordinary, travelling kind.
// Snow comes only from storms (unless the Storms slider is at 0).
//
// Thunderstorms: in warm weather the air near the ground is warm and buoyant, and storms grow into
// towering, compact, violent cumulonimbus cells: short-lived, with intense downpours, and with
// lightning. A strike on forest can start a wildfire, most easily in dry woodland and in resinous
// pine, and much less often where the downpour has soaked everything ("dry lightning" at the edge
// of a storm, or under a storm that has rained itself out, is the dangerous kind). A strike often
// smoulders for a while (a *holdover* fire) and only breaks out once the rain has moved on.
// *Dry* thunderstorms (common in dry summers and hot weather) are high-based: their rain
// evaporates on the way down (virga) but their lightning still reaches the ground.
//
// world.storms: [{ x, z, vx, vz, r, lobes, fuel, peak, age, life, thunder, … }] (grid cells,
// simulated seconds). world.strikes: recent lightning strikes for the renderer.

import { climateParams, seasonParams, cloudTempAt, seasonalRain, drySeason } from './climate.js';
import { createNoise2D } from '../core/noise.js';

export const weatherParams = {
  lightning: 1,    // how often thunderstorms throw lightning (0 = never)
};

const noise = createNoise2D(911);

export function weatherStep(world, simDt) {
  const p = climateParams, N = world.N;
  if (!world.storms) world.storms = [];
  if (!world.strikes) world.strikes = [];
  if (!world.holdovers) world.holdovers = [];
  holdovers(world, simDt);
  const list = world.storms;
  // New storms arrive from upwind: more often in winter, and hardly at all in a dry summer
  // (fewer than before, since each one covers so much more ground)
  let rate = 0.012 * p.storms * seasonalRain();
  // …and hot weather adds thunderstorms that bubble up over the land
  rate *= 1 + 1.5 * thunderChance(world);
  const nRegular = list.reduce((c, s) => c + (s.mountain ? 0 : 1), 0);
  // The wet season (late October to mid-March): one storm after another, so there's practically
  // always a storm somewhere; if the map falls quiet, the next one rolls in almost at once
  const wet = wetSeason();
  if (wet > 0) rate *= 1 + 1.5 * wet * (nRegular < 2 ? 15 : 1);
  if (Math.random() < rate * simDt && nRegular < 8) list.push(newStorm(world));
  // Mountain storms: the autumn storm season reaches the high country weeks before the lowlands.
  // Moist air forced up over the ranges breeds storms that cling to the peaks, and as soon as it's
  // cold aloft they come down as snow: the first snowstorms of the year build the high snowpack
  // while the lowlands are still dry.
  // They are huge (each blankets a whole region), so only a few at once, but in the season there's
  // nearly always one over the mountains: when none is, the next builds quickly
  const nMountain = list.reduce((c, s) => c + (s.mountain ? 1 : 0), 0);
  const mRate = 0.05 * p.storms * mountainSeason() * (nMountain === 0 ? 6 : 1);
  if (mRate > 0 && Math.random() < mRate * simDt && nMountain < 3) list.push(newMountainStorm(world));

  const a = (p.windAngle * Math.PI) / 180, wx = Math.cos(a), wz = Math.sin(a);
  const D = world.water, S = world.snow, P = world.precip, W = world.lastWet, now = world.time, H = world.height;
  const sea = world.seaLevel;
  for (let s = list.length - 1; s >= 0; s--) {
    const st = list[s];
    st.age += simDt;
    // Once the fall storm season is over, the mountain storms break up
    if (st.mountain && seasonParams.enabled && mountainSeason() < 0.05) st.life = Math.min(st.life, st.age + 10);
    // Steered by the wind, with a slow wander of its own
    const wob = Math.sin(st.age * 0.05 + st.seed) * 0.6;
    const dx = wx * Math.cos(wob) - wz * Math.sin(wob), dz = wz * Math.cos(wob) + wx * Math.sin(wob);
    st.vx += (dx * st.speed - st.vx) * 0.02 * simDt; st.vz += (dz * st.speed - st.vz) * 0.02 * simDt;
    st.x += st.vx * simDt; st.z += st.vz * simDt;
    // Rain cells churn around inside the storm, growing and fading
    for (const l of st.lobes) {
      l.a += l.spin * simDt;
      l.ox = Math.cos(l.a) * l.d; l.oz = Math.sin(l.a) * l.d;
      l.w = st.mountain ? 0.85 + 0.15 * Math.sin(st.age * l.pulse + l.ph) : 0.55 + 0.45 * Math.sin(st.age * l.pulse + l.ph);
    }
    // Spent (out of fuel), past its life, or blown off the map
    const fuelF = smooth(0.08, 0.3, st.fuel);
    const fade = Math.min(1, st.age / 10, (st.life - st.age) / 10) * fuelF;
    if (fade <= 0 || (st.age > 20 && (st.x < -st.r * 1.5 || st.z < -st.r * 1.5 || st.x > N + st.r * 1.5 || st.z > N + st.r * 1.5))) {
      list.splice(s, 1); continue;
    }
    st.strength = fade * st.peak;
    const r = st.r * 1.4;
    const x0 = Math.max(1, Math.floor(st.x - r)), x1 = Math.min(N - 2, Math.ceil(st.x + r));
    const z0 = Math.max(1, Math.floor(st.z - r)), z1 = Math.min(N - 2, Math.ceil(st.z + r));
    let snowCells = 0, cells = 0, total = 0, overWater = 0;
    const nt = st.age * 0.015;
    // Big storms: sample the rain pattern on a 2×2 grid (it's smooth at that scale), then rain on
    // every cell
    const b = st.r > 60 ? 3 : st.r > 24 ? 2 : 1;
    for (let zb = z0; zb <= z1; zb += b) {
      for (let xb = x0; xb <= x1; xb += b) {
        const q = intensityAt(st, xb + (b - 1) / 2, zb + (b - 1) / 2, nt);
        if (q <= 0.01) continue;
        for (let z = zb; z < zb + b && z <= z1; z++) for (let x = xb; x < xb + b && x <= x1; x++) {
        const i = z * N + x;
        // Heaviest on windward slopes, light in rain shadows
        // A dry thunderstorm's rain mostly evaporates on the way down (virga): little reaches the ground
        let amount = st.strength * q * (0.35 + 1.3 * (P ? P[i] : 0.5)) * simDt * (st.dry ? 0.08 : 1);
        // Mountain storms drop most of their load on the high ground
        if (st.mountain) amount *= 0.2 + 1.3 * smooth(st.hLow, st.hHigh, H[i]);
        const snow = S ? smooth(1, -1, cloudTempAt(world, i)) : 0;
        if (snow > 0) S[i] = Math.min(6, S[i] + amount * (st.mountain ? 0.12 : 0.05) * snow);
        if (snow < 1) { D[i] += amount * 0.045 * (1 - snow); W[i] = now; }
        total += amount; cells++;
        if (snow > 0.5) snowCells++;
        if (H[i] < sea || D[i] > 1) overWater++;
        }
      }
    }
    st.snow = cells ? snowCells / cells : 0;
    // Raining uses up the storm's water vapour; open water feeds it
    const area = Math.PI * st.r * st.r;
    st.fuel -= (total / area) * (st.thunder ? 0.05 : 0.03);
    st.fuel = Math.min(st.maxFuel, st.fuel + (overWater / area) * 0.004 * simDt);

    if (st.thunder && weatherParams.lightning > 0) lightning(world, st, simDt);
  }
}

/** Precipitation intensity 0..~1 at (x, z) from storm st: a ragged cluster of rain cells. */
export function intensityAt(st, x, z, nt = st.age * 0.015) {
  let q = 0;
  for (const l of st.lobes) {
    const ddx = x - st.x - l.ox, ddz = z - st.z - l.oz, r2 = l.r * l.r;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 >= r2) continue;
    const t = 1 - d2 / r2;
    q += t * t * l.w;
  }
  if (q <= 0) return 0;
  // Bands and holes that drift through the storm
  const s = 5 + st.r * 0.25; // band size scales with the storm
  const n = noise((x - st.x) / s + st.seed, (z - st.z) / s + nt);
  // Regional snowstorms are a broad, even blanket; other storms are ragged with holes
  return st.mountain ? Math.min(1, q) * (0.8 + 0.25 * n) : Math.min(1.2, q) * Math.max(0, 0.45 + 0.75 * n);
}

/** Lightning: strikes the ground under a thunderstorm; can ignite forest. */
function lightning(world, st, simDt) {
  const N = world.N;
  // Dry thunderstorms throw more ground strikes (and nothing to douse them)
  if (Math.random() > 0.06 * weatherParams.lightning * st.strength * (st.dry ? 1.6 : 1) * simDt) return;
  // Somewhere under the storm; strikes favour tall things: high ground and trees
  let best = -1, bh = -Infinity;
  for (let k = 0; k < 4; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * st.r * 1.1;
    const x = Math.round(st.x + Math.cos(a) * d), z = Math.round(st.z + Math.sin(a) * d);
    if (x < 1 || z < 1 || x > N - 2 || z > N - 2) continue;
    const i = z * N + x;
    const h = world.height[i] * 0.3 + 4 * world.vegetation[i] + Math.random() * 3;
    if (h > bh) { bh = h; best = i; }
  }
  if (best >= 0) strike(world, best);
}

/**
 * A lightning strike at cell i: draws the bolt and may start a fire. Fire needs fuel; dry ground,
 * a dry season and resinous trees (pine) catch far more easily, and a soaking downpour (water on
 * the ground) usually smothers it. A natural strike usually smoulders first (a holdover fire);
 * `direct` (the Lightning tool) ignites at once if it catches.
 */
export function strike(world, i, direct = false) {
  const N = world.N, V = world.vegetation;
  if (!world.strikes) world.strikes = [];
  if (!world.holdovers) world.holdovers = [];
  world.strikes.push({ x: i % N, z: (i / N) | 0, age: 0, seed: Math.random() * 1000, top: (world.cloudBase ? world.cloudBase[i] : world.height[i] + 8) + 4 });
  world.lightningCount = (world.lightningCount || 0) + 1;
  world.dirty = true;
  if (V[i] < 0.2 || world.fire[i] > 0 || world.water[i] > 0.15) return false;
  const soil = world.soil ? world.soil[i] : 0.5;
  const flam = world.forestFlam ? world.forestFlam[i] : 1;
  const pine = world.pineShare ? world.pineShare[i] : 0;
  const chance = 0.55 * (1 + drySeason()) * Math.min(1.5, flam) * (1 - smooth(0.35, 0.85, soil)) * (1 + 1.5 * pine) * smooth(0.2, 0.7, V[i]);
  if (direct) {
    if (Math.random() < Math.min(1, 0.35 + chance * 2)) { world.fire[i] = 0.7; world.lightningFires = (world.lightningFires || 0) + 1; return true; }
    return false;
  }
  if (Math.random() < chance) world.holdovers.push({ i, t: 4 + Math.random() * 20 });
  return false;
}

/** Smouldering strikes: once the rain has moved on, those that survived break out into fire. */
function holdovers(world, simDt) {
  const list = world.holdovers;
  for (let k = list.length - 1; k >= 0; k--) {
    const h = list[k];
    // A soaking puts most of them out; dry ground and pine keep them alive
    const wet = world.water[h.i] > 0.05;
    const keep = (world.soil ? 1 - world.soil[h.i] : 0.5) + (world.pineShare ? world.pineShare[h.i] : 0);
    if (wet && Math.random() < 0.02 * simDt / Math.max(0.2, keep)) { list.splice(k, 1); continue; }
    if (!wet) h.t -= simDt;
    if (h.t <= 0) {
      list.splice(k, 1);
      if (world.vegetation[h.i] > 0.3 && world.fire[h.i] <= 0) {
        world.fire[h.i] = 0.6;
        world.lightningFires = (world.lightningFires || 0) + 1;
      }
    }
  }
}

/**
 * How active the mountain storm season is (0..1). With Seasons on it switches on in mid-September,
 * is in full swing from October through the winter, and fades out in early spring. Without
 * seasons, mountain storms come at a steady moderate rate.
 */
function mountainSeason() {
  if (!seasonParams.enabled) return 0.4;
  const ph = seasonParams.phase;
  // Starts in mid-September, then one snowstorm after another builds over the peaks right through
  // the wet season, ending around mid-March. The rest of the year storms are the ordinary kind
  // (mostly rain, or snow only where it's cold enough).
  return smooth(0.46, 0.52, ph) * (1 - smooth(0.97, 0.995, ph));
}

/**
 * The wet season, 0..1 (with Seasons on): from late October to mid-March storms are practically
 * constant (the winter storm track sits over the region). Phase 0.6 ≈ 25 October, 0.986 ≈ 15 March.
 */
export function wetSeason() {
  if (!seasonParams.enabled) return 0;
  const ph = seasonParams.phase;
  return smooth(0.57, 0.6, ph) * (1 - smooth(0.975, 0.995, ph));
}

/** A storm born over the high ground: slow, clinging to the peaks. */
function newMountainStorm(world) {
  const N = world.N, H = world.height;
  // Rough height percentiles of the map: where "high ground" starts
  const sample = [];
  for (let k = 0; k < 1500; k++) sample.push(H[(Math.random() * N * N) | 0]);
  sample.sort((a, b) => a - b);
  const hLow = sample[Math.floor(sample.length * 0.55)], hHigh = sample[Math.floor(sample.length * 0.9)];
  // Over any part of the high ground (not just the very highest peaks), so every range gets them
  const cut = hLow + 0.4 * (hHigh - hLow);
  let best = -1;
  for (let k = 0; k < 200 && best < 0; k++) {
    const i = (Math.random() * N * N) | 0;
    if (H[i] >= cut) best = i;
  }
  if (best < 0) best = (Math.random() * N * N) | 0;
  const p = climateParams, a = (p.windAngle * Math.PI) / 180;
  // A regional system: a third to half of the map across, smooth and slow-moving
  const r = N * (0.17 + Math.random() * 0.08), speed = 0.15 + Math.random() * 0.2;
  const lobes = [];
  const nl = 3 + Math.floor(Math.random() * 2);
  for (let k = 0; k < nl; k++) {
    lobes.push({
      a: Math.random() * Math.PI * 2, d: (k === 0 ? 0 : 0.3 + Math.random() * 0.4) * r,
      r: r * (k === 0 ? 1.0 : 0.6 + Math.random() * 0.3), spin: (Math.random() - 0.5) * 0.01,
      pulse: 0.01 + Math.random() * 0.02, ph: Math.random() * 6, ox: 0, oz: 0, w: 1,
    });
  }
  const fuel = 1 + Math.random() * 0.4;
  return {
    x: best % N, z: (best / N) | 0, vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, speed, r, lobes,
    thunder: false, dry: false, mountain: true, hLow, hHigh: Math.max(hHigh, hLow + 1),
    fuel, maxFuel: fuel * 1.2, peak: 1.0 + Math.random() * 0.4,
    // A few days each (seconds of play); shorter at fast season speeds so they stay seasonal
    age: 0, life: (60 + Math.random() * 50) / Math.max(1, seasonParams.enabled ? seasonParams.speed : 1),
    strength: 0, snow: 0, seed: Math.random() * 1000,
  };
}

/** Share of new storms that are thunderstorms: they need warm, buoyant air near the ground. */
function thunderChance(world) {
  return 0.75 * smooth(14, 24, climateParams.seaTemp + (world.seasonT || 0));
}

function newStorm(world) {
  const N = world.N, p = climateParams;
  const a = (p.windAngle * Math.PI) / 180, wx = Math.cos(a), wz = Math.sin(a);
  // Warm weather breeds thunderstorms: compact, violent and short-lived
  const thunder = Math.random() < thunderChance(world);
  // Frontal storms are big, regional systems; thunderstorms are smaller cells (but still sizeable)
  const r = thunder ? 14 + Math.random() * 16 : 30 + Math.random() * 50;
  // Pick a spot on the map and start upwind of it, just off the edge
  const tx = Math.random() * N, tz = Math.random() * N, m = r * 0.6;
  const back = Math.min(
    Math.abs(wx) > 1e-3 ? (wx > 0 ? tx + m : N + m - tx) / Math.abs(wx) : Infinity,
    Math.abs(wz) > 1e-3 ? (wz > 0 ? tz + m : N + m - tz) / Math.abs(wz) : Infinity);
  // Thunderstorms often build over the land itself rather than blowing in
  const inland = thunder && Math.random() < 0.6;
  const cx = inland ? tx : tx - wx * back, cz = inland ? tz : tz - wz * back;
  const speed = (thunder ? 1.2 : 2.2) + Math.random() * 1.6; // cells per simulated second
  // A ragged cluster of 3–6 rain cells
  const lobes = [];
  const nl = 3 + Math.floor(Math.random() * 4);
  for (let k = 0; k < nl; k++) {
    lobes.push({
      a: Math.random() * Math.PI * 2, d: (k === 0 ? 0 : 0.35 + Math.random() * 0.55) * r,
      r: r * (k === 0 ? 0.75 : 0.35 + Math.random() * 0.45), spin: (Math.random() - 0.5) * 0.03,
      pulse: 0.03 + Math.random() * 0.06, ph: Math.random() * 6, ox: 0, oz: 0, w: 1,
    });
  }
  const fuel = thunder ? 0.5 + Math.random() * 0.4 : 0.7 + Math.random() * 0.6;
  // Dry thunderstorms: high-based storms over hot, dry country whose rain evaporates before it lands
  // but whose lightning still reaches the ground. The classic wildfire starter of dry summers.
  const dry = thunder && Math.random() < 0.15 + 0.7 * drySeason() + 0.3 * smooth(26, 34, p.seaTemp + (world.seasonT || 0));
  return {
    x: cx, z: cz, vx: wx * speed, vz: wz * speed, speed, r, lobes, thunder, dry,
    fuel, maxFuel: fuel * 1.2,
    peak: thunder ? 1.4 + Math.random() * 0.8 : 0.5 + Math.random() * 0.8,
    // (shorter at fast season speeds, so a storm doesn't outlast the season it belongs to)
    age: 0, life: (thunder ? 60 + Math.random() * 80 : (N + 2 * r) / speed * (0.7 + Math.random() * 0.5)) / Math.max(1, seasonParams.enabled ? seasonParams.speed : 1),
    strength: 0, snow: 0, seed: Math.random() * 1000,
  };
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
