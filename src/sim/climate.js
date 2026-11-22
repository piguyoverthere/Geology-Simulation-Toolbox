// Climate: temperature and snow.
//
// Air cools as it rises (the *lapse rate*, about 6.5 °C per km), so temperature here falls with
// height from the sea-level value set by the Temperature slider. Slopes also differ by *aspect*:
// a slope facing the sun gets far more energy than one in shade, so sunny slopes are warmer and
// shady ones colder. That's why the tree line and snow line sit lower on shaded faces.
//
// Snow comes from clouds: see updatePrecip (where precipitation falls) and updateSnow (whether it
// falls as snow, how it builds up, melts, drifts and slides).

import { boxBlur } from '../core/grid.js';
import { waterParams } from './water.js';

export const climateParams = {
  seaTemp: 22,        // °C at sea level (the Temperature slider)
  lapse: 0.4,         // °C lost per unit of height
  sunEffect: 3,       // °C warmer on a slope facing the sun (colder facing away)
  treeLineTemp: 2.5,  // trees can't grow below this temperature (tundra above)
  windAngle: 20,      // direction the prevailing wind blows toward (degrees; 0 = +x)
  humidity: 1,        // moisture of the air arriving at the upwind edge
  cloudLift: 6,       // height of the clouds above the ground (their temperature decides snow vs rain)
  snowfall: 0.06,     // snow added per step at average precipitation
  melt: 0.09,         // snow melted per step per °C above meltTemp (× season speed)
  meltTemp: 2,        // snow only melts above this temperature (°C): a pack stays cold and reflects sunlight
  oceanFog: 0.4,      // how often the marine layer (sea fog) rolls in over the sea and coast
  snowSlope: 47,      // steepest slope (degrees) snow accumulates on; steeper faces shed it unless the pack around is deep
  deepSnow: 2,        // snowpack depth around a slope at which steep faces start holding snow
  storms: 1,          // how often storms sweep across the map (0 = none; see sim/weather.js)
  snowstorms: 1,      // how many mountain snowstorms come each year (× the default; 0 = none)
  meltRunoff: 0.05,   // runoff per unit of snow melted (snow is mostly air, and much of the melt soaks in)
  summerDry: 0,       // 0 = rain all year; 1 = almost all of it from autumn to spring, dry summers
};

/**
 * Seasons. The year is a phase 0..1 (0 = start of spring, 0.25 summer, 0.5 autumn, 0.75 winter).
 * Temperature swings around its annual mean, peaking a little after midsummer and bottoming out a
 * little after midwinter (land and sea take time to warm and cool). world.temperature stays the
 * *annual mean*, which decides what can live where; world.seasonT is today's offset from it, which
 * decides snow and rain, melting, evaporation and what the leaves are doing.
 */
export const seasonParams = {
  enabled: false,
  speed: 1,      // years per minute of real time
  swing: 13,     // °C between the annual mean and midsummer (or midwinter)
  phase: 0.12,   // where in the year we are
  variability: 1, // how often years are extreme (0 = every year alike)
  yearKind: 'normal', // this year: 'normal', 'hot' (drought and heatwave) or 'mild' (cool, showery)
  yearStrength: 1,    // how extreme this year is (0.6 … 1.2)
  year: 1,
};

/**
 * Not every year is the same. Most are ordinary, but now and then a summer of drought and heat
 * waves comes (a blocking ridge of high pressure parks over the region for weeks): hotter, almost
 * rainless, with dry lightning, and fuels drying out early, so wildfires run far and wide. Other
 * summers are mild and showery, cool and green, with little fire. A new kind of year is drawn at
 * each new year; `variability` sets how often the extremes come.
 */
export const YEAR_KINDS = {
  normal: { label: 'Normal year', short: '' },
  hot: { label: 'Drought & heat wave year', short: '🔥 Drought year' },
  mild: { label: 'Mild, cool summer', short: '🌦 Mild summer' },
};
/** Draw the kind of year at a new year. */
export function rollYear() {
  const v = seasonParams.variability, r = Math.random();
  seasonParams.yearKind = r < 0.16 * v ? 'hot' : r < 0.34 * v ? 'mild' : 'normal';
  seasonParams.yearStrength = 0.6 + Math.random() * 0.6;
  seasonParams.year = (seasonParams.year || 1) + 1;
}
/** 0 … 1 through the summer (April to September, strongest in July and August). */
function summerWeight(ph = seasonParams.phase) {
  const d = ph - 0.36;
  return Math.abs(d) < 0.26 ? Math.cos((d / 0.26) * Math.PI * 0.5) ** 2 : 0;
}
/** This year's summer anomaly: +1 drought and heat, −1 mild, scaled by how far into summer. */
export function yearAnomaly() {
  if (!seasonParams.enabled || seasonParams.yearKind === 'normal') return 0;
  return (seasonParams.yearKind === 'hot' ? 1 : -1) * seasonParams.yearStrength * summerWeight();
}

const LAG = 0.05; // the warmest day comes this fraction of a year after the summer solstice (late July)
/** Today's temperature offset from the annual mean (°C). */
export function seasonOffset() {
  if (!seasonParams.enabled) return 0;
  // (plus this year's summer: up to +5 °C in a heat-wave year, −3 °C in a mild one)
  const a = yearAnomaly();
  return seasonParams.swing * Math.sin(2 * Math.PI * (seasonParams.phase - LAG)) + (a > 0 ? 5 * a : 3 * a);
}
/**
 * How stormy today is relative to the yearly average (1 = average), with Seasons on. A
 * Mediterranean-type climate (like the Pacific Northwest or California) gets its rain from autumn to
 * spring, when the jet stream and its storm track shift south over it, and has a dry summer under a
 * high-pressure ridge. `summerDry` sets how strong that swing is; wettest around midwinter, driest
 * in late summer. Even without it, storms are a little more frequent in winter.
 */
export function seasonalRain() {
  if (!seasonParams.enabled) return 1;
  const s = Math.max(0.3, climateParams.summerDry);
  const base = Math.max(0.05, 1 + s * Math.cos(2 * Math.PI * (seasonParams.phase - 0.83)));
  // Drought years: the rain all but stops; mild summers: showers keep coming
  const a = yearAnomaly();
  return a > 0 ? base * (1 - 0.85 * Math.min(1, a)) : base * (1 - 2 * a);
}

/**
 * Fire season 0..1 (with Seasons on). Fuels dry out through the summer: dead grass cures, litter and
 * fallen wood lose their moisture, and the trees themselves are drought-stressed. So fire danger
 * builds through summer and peaks in late summer (around mid-to-late August), well after the
 * driest weather, then fades with the autumn rains. Dry summers make it much stronger; even a
 * climate with summer rain has a milder version.
 */
export function drySeason() {
  if (!seasonParams.enabled) return 0;
  const d = seasonParams.phase - 0.43; // late summer
  const bump = Math.abs(d) < 0.16 ? Math.cos((d / 0.16) * Math.PI * 0.5) ** 2 : 0;
  const normal = bump * (0.4 + 0.6 * climateParams.summerDry);
  // A drought year dries the fuels out early and the whole summer burns; a mild one barely does
  const a = yearAnomaly();
  return a > 0 ? Math.min(1.2, normal + 0.9 * a) : normal * (1 + 0.85 * a);
}

/** +1 while the year is warming (late winter → midsummer), −1 while it cools. */
export function seasonTrend() {
  return Math.cos(2 * Math.PI * (seasonParams.phase - LAG)) >= 0 ? 1 : -1;
}
/** Advance the year by `seconds` of real time. */
export function advanceSeason(seconds) {
  if (!seasonParams.enabled) return;
  const before = seasonParams.phase;
  seasonParams.phase = (seasonParams.phase + (seconds * seasonParams.speed) / 60) % 1;
  // A new year begins at the end of winter (phase wraps round): what kind of year will it be?
  if (seasonParams.phase < before - 0.5) rollYear();
}
/** 'Early spring' … 'Late winter'. */
export function seasonName(phase = seasonParams.phase) {
  const names = ['spring', 'summer', 'autumn', 'winter'];
  const q = ((phase % 1) + 1) % 1 * 4, k = Math.floor(q), f = q - k;
  const part = f < 1 / 3 ? 'Early' : f < 2 / 3 ? 'Mid' : 'Late';
  return `${part} ${names[k]}`;
}
/**
 * The ground lags the air. Soil and the land surface store a summer's heat and give it up over
 * weeks, so in early winter the ground is still warmer than the air: the first snows reaching the
 * lowlands melt as they land, and only the high country (cold ground) builds a snowpack. By
 * midwinter the ground has chilled and snow sticks low down too. world.groundSeason is the
 * seasonal offset of the ground: today's air offset delayed by about five weeks.
 */
function updateGroundLag(world) {
  if (!seasonParams.enabled) { world.groundSeason = 0; world.groundPhase = undefined; return; }
  const ph = seasonParams.phase;
  if (world.groundPhase === undefined || world.groundSeason === undefined) {
    // Start already lagged: the offset from about five weeks ago
    world.groundSeason = seasonParams.swing * Math.sin(2 * Math.PI * (ph - 0.1 - LAG));
  } else {
    let dy = ph - world.groundPhase;
    if (dy < 0) dy += 1;
    if (dy > 0.25) dy = 0.25;
    world.groundSeason += (world.seasonT - world.groundSeason) * (1 - Math.exp(-dy / 0.1));
  }
  world.groundPhase = ph;
}

/** True while an Arctic cold snap is sitting over the region (see weather.startColdSnap). */
export function coldSnapActive(world) {
  if (world.coldSnapUntil === undefined) return false;
  const t = world.coldSnapSeasons ? seasonParams.phase : world.time;
  let left = world.coldSnapUntil - t;
  if (world.coldSnapSeasons) { if (left < -0.5) left += 1; if (left > 0.5) left -= 1; } // around the new year
  return left > 0;
}

/**
 * Today's seasonal temperature offset at cell i (°C). The sea stores heat, so near the coast the
 * seasons swing much less (mild winters, cool summers: a maritime climate) and far inland more
 * (continental: cold winters, hot summers); world.seasonScale holds that per cell. In winter, cold
 * interior air also pours through low mountain passes (gap flow, as at Snoqualmie Pass on I-90),
 * so a pass is far colder than its height alone would make it (world.gapCold).
 */
export function seasonalAt(world, i, st = world.seasonT || 0) {
  const sc = world.seasonScale ? world.seasonScale[i] : 1;
  let v = st * sc;
  if (st < 0 && world.gapCold) v -= 7 * world.gapCold[i] * Math.min(1, -st / Math.max(1, seasonParams.swing));
  return v;
}

/** Today's temperature at cell i (annual mean + season). */
export function nowTemp(world, i) { return world.temperature[i] + seasonalAt(world, i); }

// Horizontal direction toward the sun (matches the scene's directional light)
const SUN = (() => { const x = -160, z = 90, l = Math.hypot(x, z); return [x / l, z / l]; })();

/** Recompute world.temperature (°C per cell). Cheap; called with the vegetation step. */
export function updateTemperature(world) {
  const N = world.N, H = world.height, p = climateParams;
  if (!world.temperature) world.temperature = new Float32Array(N * N);
  // Sun exposure: how directly each slope faces the sun, smoothed so it reads as hillsides
  const expo = new Float32Array(N * N);
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      const gx = (H[i + 1] - H[i - 1]) * 0.5, gz = (H[i + N] - H[i - N]) * 0.5;
      const s = Math.sqrt(gx * gx + gz * gz);
      if (s < 1e-4) continue;
      // Downhill direction · sun direction, scaled by how steep the slope is
      expo[i] = ((-gx / s) * SUN[0] + (-gz / s) * SUN[1]) * Math.min(1, s * 1.5);
    }
  }
  const sun = boxBlur(expo, N, 2);
  world.sunExpo = sun;
  world.seasonT = seasonOffset();
  updateGroundLag(world);
  const T = world.temperature;
  for (let i = 0; i < N * N; i++) T[i] = p.seaTemp - p.lapse * Math.max(0, H[i]) + p.sunEffect * sun[i];
  updateEvaporation(world);
}

/**
 * Regional evaporation (world.evapRate, × the Evaporation slider). Water evaporates faster in warm
 * air (about 3× faster at 30 °C than at freezing), in direct sun, and the higher up it is (thin, dry,
 * windy air). Shaded, sheltered valley
 * bottoms lose water slowest: less sun, still, humid air. Plant cover shades the ground and keeps
 * the air above it damp, so bare ground dries much faster than ground under forest (though the
 * plants themselves draw water from the soil: see vegetation uptake).
 */
export function updateEvaporation(world) {
  const n = world.N * world.N, T = world.temperature, st = world.seasonT || 0;
  if (!world.evapRate) world.evapRate = new Float32Array(n).fill(1);
  if (!world.evapSoil || world.evapSoil.length !== n) world.evapSoil = new Float32Array(n).fill(1);
  const ES = world.evapSoil; // without the altitude boost: alpine soil stays moist from snowmelt
  const E = world.evapRate, sun = world.sunExpo, Vy = world.valley, V = world.vegetation, H = world.height;
  const base = Math.max(0, world.seaLevel) + 6;
  const summerEvap = 1 + (waterParams.summerEvap - 1) * (seasonParams.enabled ? summerWeight() : 0);
  for (let i = 0; i < n; i++) {
    const heat = 0.4 + 0.04 * Math.max(0, T[i] + seasonalAt(world, i, st));
    const light = 1 + 0.45 * (sun ? sun[i] : 0) - 0.35 * (Vy ? Math.max(0, Vy[i]) : 0);
    const cover = 1.3 - 0.55 * V[i];
    // Up high the air is thin, dry and windy and the sunlight strong, so water evaporates faster
    // the higher it is, even though it's colder (alpine tarns shrink fast in late summer)
    // (strongly: high basins hold only small tarns, not big lakes)
    const altitude = Math.min(12, 1 + 0.22 * Math.max(0, H[i] - base));
    // Summer: long, sunny, hot days make lakes and ponds evaporate far faster (× the summer slider)
    E[i] = Math.max(0.05, heat * light * cover * altitude * summerEvap);
    ES[i] = Math.max(0.05, heat * light * cover);
  }
}

/**
 * Clouds and precipitation (world.precip, world.cloud). Moist air blows across the map with the
 * prevailing wind. Where it is pushed uphill it cools, its water condenses into cloud and falls as
 * rain or snow (*orographic* precipitation), so windward slopes are the wettest. Having lost its
 * water it descends dry beyond the crest: the *rain shadow* behind a range. Air picks moisture back
 * up over lakes, the sea and forests.
 *
 * Computed with an upwind sweep: each cell takes its air from the neighbours it is downwind of.
 */
export function updatePrecip(world) {
  const N = world.N, H = world.height, n = N * N, p = climateParams;
  if (!world.precip) {
    world.precip = new Float32Array(n); world.cloud = new Float32Array(n); world.humidity = new Float32Array(n);
    world.cloudBase = new Float32Array(n); world.fog = new Float32Array(n);
  }
  const CB = world.cloudBase, FG = world.fog;
  const a = (p.windAngle * Math.PI) / 180;
  const wx = Math.cos(a), wz = Math.sin(a);
  const sx = wx >= 0 ? 1 : -1, sz = wz >= 0 ? 1 : -1;
  const ax = Math.abs(wx), az = Math.abs(wz), aw = ax + az;
  const Q = world.humidity, P = world.precip, C = world.cloud;
  let total = 0;
  // Visit cells from the upwind corner so both upwind neighbours are always done first
  for (let zz = 0; zz < N; zz++) {
    const z = sz > 0 ? zz : N - 1 - zz;
    for (let xx = 0; xx < N; xx++) {
      const x = sx > 0 ? xx : N - 1 - xx;
      const i = z * N + x;
      const ux = x - sx, uz = z - sz;
      const inX = ux >= 0 && ux < N, inZ = uz >= 0 && uz < N;
      // Air (and its moisture) arriving from upwind; fresh moist air enters at the upwind edges
      const qx = inX ? Q[i - sx] : p.humidity, qz = inZ ? Q[i - sz * N] : p.humidity;
      const hx = inX ? H[i - sx] : H[i], hz = inZ ? H[i - sz * N] : H[i];
      const qIn = (ax * qx + az * qz) / aw;
      const hUp = (ax * hx + az * hz) / aw;
      // Rising over terrain squeezes water out of the air
      const lift = Math.max(0, H[i] - hUp);
      const fall = qIn * (0.003 + 0.06 * lift);
      // Lakes, the sea and plants put moisture back into the air
      const regain = (world.water[i] > 0.3 ? 0.012 : 0) + 0.0015 * world.vegetation[i];
      Q[i] = Math.min(p.humidity, qIn - fall + regain);
      P[i] = fall;
      C[i] = Math.min(1, fall * 22);
      // Cloud base: moist air condenses after only a little lifting (low cloud hugging the slopes);
      // drier air has to rise much further first (higher cloud)
      const dryness = 1 - Math.min(1, qIn / p.humidity);
      CB[i] = Math.max(0, H[i]) + 2.5 + 8 * dryness;
      total += fall;
    }
  }
  // Normalise so the map average is 0.5
  const mean = total / n || 1;
  for (let i = 0; i < n; i++) P[i] = Math.min(1, (P[i] / mean) * 0.5);
  // Valley fog: cool, damp air pools in valley bottoms
  const T = world.temperature, Vy = world.valley, S = world.soil, SC = world.seasonScale;
  const summer = seasonParams.enabled ? smooth(-2, 6, world.seasonT || 0) : 0.5;
  for (let i = 0; i < n; i++) {
    FG[i] = Vy && S && T ? smooth(0.25, 0.7, Vy[i]) * smooth(0.6, 0.9, S[i]) * (1 - smooth(10, 18, T[i])) * Math.min(1, Q[i] / p.humidity + 0.3) : 0;
    // Ocean fog (the marine layer): cool, damp sea air drifting over the sea and the coastal
    // lowlands, mostly in summer when the land behind is warm
    if (SC && p.oceanFog > 0) {
      const marine = Math.max(0, (1.25 - SC[i]) / 0.75);
      const low = 1 - smooth(8, 20, H[i] - (world.meanSea ?? 0));
      FG[i] = Math.max(FG[i], Math.min(1, p.oceanFog * marine * low * (0.3 + 0.7 * summer)));
    }
  }
}

/**
 * Snowpack (world.snow, depth). Precipitation falls as snow when the cloud it falls from (a few
 * units above the ground) is below freezing, so snow can fall where the ground itself is a little
 * above zero. It then melts according to the ground temperature (sunny slopes faster). Wind drifts
 * it into hollows. Snow slides off steep slopes and piles up below them, but once the snowpack
 * around a slope is deep, it builds up on steep faces too.
 */
export function updateSnow(world, steps = 1, runoff = false) {
  const N = world.N, H = world.height, n = N * N, p = climateParams;
  if (!world.snow) world.snow = new Float32Array(n);
  if (!world.precip) updatePrecip(world);
  const S = world.snow, T = world.temperature, P = world.precip, st = world.seasonT || 0;
  const melts = Math.max(st, world.groundSeason ?? st);
  const SNW = world.snowingAt;
  // During a cold snap (an Arctic outbreak) the air is far below normal, so lying snow doesn't melt
  const snap = coldSnapActive(world) ? 8 : 0;
  const meltSpeed = seasonParams.enabled ? seasonParams.speed : 1; // same melt per season at any speed
  const holdTan = Math.tan((Math.min(85, Math.max(5, p.snowSlope)) * Math.PI) / 180);
  // With storms on, all snow comes from storms (sim/weather.js): snowstorms build the pack. Only with
  // the Storms slider at 0 does a steady background snowfall stand in for them.
  const background = p.storms > 0 ? 0 : seasonalRain();
  const D = world.water, now = world.time, W = world.lastWet;
  world.meltRate = 0;
  for (let s = 0; s < steps; s++) {
    // (every cell, the map's edges too: snow there has to melt as well)
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        // Snow or rain is decided at the cloud base, which is lower in humid air
        const cloudT = cloudTempAt(world, i);
        const asSnow = smooth(1, -1, cloudT);
        // Drifting: hollows collect snow, crests are scoured
        const l = x > 0 ? i - 1 : i, r = x < N - 1 ? i + 1 : i, u = z > 0 ? i - N : i, d0 = z < N - 1 ? i + N : i;
        const curv = (H[l] + H[r] + H[u] + H[d0]) * 0.25 - H[i];
        const drift = 1 + Math.max(-0.5, Math.min(0.6, curv * 0.8));
        const before = S[i] + p.snowfall * background * P[i] * asSnow * drift;
        // Snow melts from above (warm air) and from below (ground still warm from summer), but hardly
        // at all while a snowstorm is falling on it (the falling snow chills the air to freezing)
        const snowing = SNW && now - SNW[i] < 6 ? 0.08 : 1;
        const mt = seasonalAt(world, i, melts);
        // Near the sea the air stays mild and moist: snow there melts at a lower temperature and
        // faster (it rarely lasts more than days on a maritime coast)
        const sea = world.coastal ? world.coastal[i] : 0;
        let melt = p.melt * meltSpeed * snowing * (1 + 2.5 * sea) * Math.max(0, T[i] + mt - snap - (p.meltTemp - 2 * sea));
        if (before > 0 && !snap) {
          // Warm ground: in the mild lowlands (yearly mean well above freezing) the soil holds
          // its heat and melts snow from below, all winter long
          melt += 0.03 * meltSpeed * Math.max(0, T[i] - 5) * (snowing < 1 ? 0.5 : 1);
          // (and rain falling on snow washes it away: see weather.js)
        }
        let d = before - melt;
        d = d < 0 ? 0 : d > 6 ? 6 : d;
        // Meltwater runs off into the streams: the spring flood of a snowy catchment
        if (runoff && d < before && before > 0.005) {
          const m = before - d;
          D[i] += m * p.meltRunoff;
          world.meltRate += m;
          if (m > 0.002) W[i] = now;
        }
        S[i] = d;
      }
    }
    // Sliding: steeper than the snow can hold → half the snow slides to the lowest neighbour. Deep
    // snow all around lets steep faces hold it.
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        const i = z * N + x;
        if (S[i] < 0.01) continue;
        const gx = (H[i + 1] - H[i - 1]) * 0.5, gz = (H[i + N] - H[i - N]) * 0.5;
        const slope = Math.sqrt(gx * gx + gz * gz);
        const around = (S[i - 1] + S[i + 1] + S[i - N] + S[i + N]) * 0.25;
        // Snow sticks to slopes up to the Snow slope limit (steeper faces shed it unless the pack
        // around them is deep)
        const hold = holdTan + 0.7 * smooth(p.deepSnow * 0.4, p.deepSnow, around);
        if (slope <= hold) continue;
        let low = i, lh = H[i] + S[i];
        for (const j of [i - 1, i + 1, i - N, i + N]) if (H[j] + S[j] < lh) { lh = H[j] + S[j]; low = j; }
        if (low === i) continue;
        const move = S[i] * 0.5;
        S[i] -= move; S[low] += move;
      }
    }
  }
}

/** Temperature (°C) at the base of the clouds over cell i. */
export function cloudTempAt(world, i) {
  const p = climateParams;
  const base = world.cloudBase ? world.cloudBase[i] : Math.max(0, world.height[i]) + p.cloudLift;
  return p.seaTemp - p.lapse * base + seasonalAt(world, i);
}

/**
 * Snow cover 0..1 at cell i, from the snowpack depth (forest canopy hides some of it).
 * @param {number} slope rise/run at the cell (unused: steepness is handled by the snowpack itself)
 */
export function snowAt(world, i, slope) {
  if (!world.snow) return 0;
  const cover = smooth(0.02, 0.35, world.snow[i]);
  // Canopy hides snow on the ground, except under leafless deciduous trees in winter
  const bare = world.leafOn && world.decid ? world.decid[i] * (1 - world.leafOn[i]) : 0;
  return cover * (1 - 0.5 * smooth(0.6, 0.9, world.vegetation[i]) * (1 - bare));
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
