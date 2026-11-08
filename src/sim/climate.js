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

export const climateParams = {
  seaTemp: 22,        // °C at sea level (the Temperature slider)
  lapse: 0.4,         // °C lost per unit of height
  sunEffect: 3,       // °C warmer on a slope facing the sun (colder facing away)
  treeLineTemp: 2.5,  // trees can't grow below this temperature (tundra above)
  windAngle: 20,      // direction the prevailing wind blows toward (degrees; 0 = +x)
  humidity: 1,        // moisture of the air arriving at the upwind edge
  cloudLift: 6,       // height of the clouds above the ground (their temperature decides snow vs rain)
  snowfall: 0.06,     // snow added per step at average precipitation
  melt: 0.012,        // snow melted per step per °C above freezing
  deepSnow: 2,        // snowpack depth around a slope at which steep faces start holding snow
};

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
  const T = world.temperature;
  for (let i = 0; i < N * N; i++) T[i] = p.seaTemp - p.lapse * Math.max(0, H[i]) + p.sunEffect * sun[i];
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
  if (!world.precip) { world.precip = new Float32Array(n); world.cloud = new Float32Array(n); world.humidity = new Float32Array(n); }
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
      total += fall;
    }
  }
  // Normalise so the map average is 0.5
  const mean = total / n || 1;
  for (let i = 0; i < n; i++) P[i] = Math.min(1, (P[i] / mean) * 0.5);
}

/**
 * Snowpack (world.snow, depth). Precipitation falls as snow when the cloud it falls from (a few
 * units above the ground) is below freezing, so snow can fall where the ground itself is a little
 * above zero. It then melts according to the ground temperature (sunny slopes faster). Wind drifts
 * it into hollows. Snow slides off steep slopes and piles up below them, but once the snowpack
 * around a slope is deep, it builds up on steep faces too.
 */
export function updateSnow(world, steps = 1) {
  const N = world.N, H = world.height, n = N * N, p = climateParams;
  if (!world.snow) world.snow = new Float32Array(n);
  if (!world.precip) updatePrecip(world);
  const S = world.snow, T = world.temperature, P = world.precip;
  for (let s = 0; s < steps; s++) {
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        const i = z * N + x;
        const cloudT = p.seaTemp - p.lapse * (Math.max(0, H[i]) + p.cloudLift);
        const asSnow = smooth(1, -1, cloudT);
        // Drifting: hollows collect snow, crests are scoured
        const curv = (H[i - 1] + H[i + 1] + H[i - N] + H[i + N]) * 0.25 - H[i];
        const drift = 1 + Math.max(-0.5, Math.min(0.6, curv * 0.8));
        let d = S[i] + p.snowfall * P[i] * asSnow * drift - p.melt * Math.max(0, T[i] + 0.5);
        S[i] = d < 0 ? 0 : d > 6 ? 6 : d;
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
        const hold = 0.8 + 0.9 * smooth(p.deepSnow * 0.4, p.deepSnow, around);
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

/**
 * Snow cover 0..1 at cell i, from the snowpack depth (forest canopy hides some of it).
 * @param {number} slope rise/run at the cell (unused: steepness is handled by the snowpack itself)
 */
export function snowAt(world, i, slope) {
  if (!world.snow) return 0;
  const cover = smooth(0.02, 0.35, world.snow[i]);
  return cover * (1 - 0.5 * smooth(0.6, 0.9, world.vegetation[i]));
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
