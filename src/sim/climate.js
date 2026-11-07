// Climate: temperature and snow.
//
// Air cools as it rises (the *lapse rate*, about 6.5 °C per km), so temperature here falls with
// height from the sea-level value set by the Temperature slider. Slopes also differ by *aspect*:
// a slope facing the sun gets far more energy than one in shade, so sunny slopes are warmer and
// shady ones colder. That's why the tree line and snow line sit lower on shaded faces.
//
// Snow lies where it's below freezing, but how much depends on more than temperature: dry regions
// get little snowfall; snow can't cling to steep faces and avalanches off them; wind drifts it into
// hollows; forest canopy catches part of it; and sun-facing slopes melt out first (via aspect).

import { boxBlur } from '../core/grid.js';

export const climateParams = {
  seaTemp: 22,        // °C at sea level (the Temperature slider)
  lapse: 0.4,         // °C lost per unit of height
  sunEffect: 3,       // °C warmer on a slope facing the sun (colder facing away)
  treeLineTemp: 2.5,  // trees can't grow below this temperature (tundra above)
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
 * Snow cover 0..1 at cell i.
 * @param {number} slope rise/run at the cell
 */
export function snowAt(world, i, slope) {
  const T = world.temperature ? world.temperature[i] : 10;
  if (T > 1.5) return 0;
  const N = world.N, H = world.height;
  const cold = smooth(1.5, -2.5, T);
  // Snowfall needs moisture: arid ground gets only a dusting
  const wet = 0.35 + 0.65 * Math.min(1, world.moisture ? world.moisture[i] : 0.5);
  // Snow can't hold on steep faces
  const cling = 1 - smooth(1.1, 1.9, slope);
  // Wind drifts snow into hollows and scours it off crests
  const x = i % N, z = (i / N) | 0;
  let hollow = 1;
  if (x > 0 && z > 0 && x < N - 1 && z < N - 1) {
    const curv = (H[i - 1] + H[i + 1] + H[i - N] + H[i + N]) * 0.25 - H[i];
    hollow = 1 + Math.max(-0.4, Math.min(0.4, curv * 0.8));
  }
  // Forest canopy holds some snow up in the trees, so less of the ground shows white
  const canopy = 1 - 0.5 * smooth(0.6, 0.9, world.vegetation[i]);
  return Math.min(1, cold * wet * cling * hollow * canopy * 1.3);
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
