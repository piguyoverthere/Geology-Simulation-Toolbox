import { createNoise2D, fbm, ridged } from './noise.js';
import { initVegetation } from '../sim/vegetation.js';
import { generateGeology } from './rocks.js';
import { boxBlur, breachDepressions, carveRivers } from './grid.js';

/**
 * Terrain presets. Each fills world.height with a starting landscape that erosion can then work on.
 * Heights are in world units (1 unit = 1 grid cell horizontally).
 */
export const PRESETS = {
  hills: { label: 'Rolling hills' },
  mountains: { label: 'Ridged mountains' },
  plateau: { label: 'Layered plateau' },
  volcano: { label: 'Volcanic cone' },
  flat: { label: 'Flat plain' },
};

export function generateTerrain(world, preset = 'mountains', seed = 1) {
  const N = world.N;
  const noise = createNoise2D(seed);
  const h = world.height;
  const scale = 1 / N;

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const u = x * scale, v = z * scale;
      // Distance from centre, for presets that fall off toward the edges
      const dx = u - 0.5, dz = v - 0.5;
      const r = Math.sqrt(dx * dx + dz * dz);
      let y = 0;

      switch (preset) {
        case 'hills':
          y = 18 + 22 * fbm(noise, u * 3, v * 3, 6);
          break;
        case 'mountains': {
          const falloff = 1 - Math.min(1, r * 1.6);
          y = 6 + 48 * ridged(noise, u * 2.2, v * 2.2, 7) * (0.35 + 0.65 * falloff) + 3 * fbm(noise, u * 8, v * 8, 4);
          break;
        }
        case 'plateau': {
          // A raised table of flat-lying rock with a gently tilted, noisy edge: perfect for
          // watching strata get cut into cliffs, mesas and buttes.
          const edge = 0.32 + 0.08 * fbm(noise, u * 4, v * 4, 4);
          const t = smoothstep(edge + 0.06, edge - 0.06, r);
          y = 6 + 32 * t + 3 * fbm(noise, u * 10, v * 10, 4);
          break;
        }
        case 'volcano': {
          const cone = Math.max(0, 1 - r * 2.6);
          const crater = Math.max(0, 1 - r * 22);
          y = 8 + 75 * Math.pow(cone, 1.6) - 22 * crater * crater + 3 * fbm(noise, u * 9, v * 9, 5);
          break;
        }
        case 'flat':
        default:
          y = 10 + 0.6 * fbm(noise, u * 6, v * 6, 3);
      }
      h[z * N + x] = y;
    }
  }

  if (preset !== 'flat') smoothLowlands(world, noise);
  // Real landscapes drain: almost every spot has a downhill route to the sea. Raw noise leaves
  // hundreds of closed basins where each river would die in its own little lake. Carve an outlet
  // from each one; the outlets merge into a branching valley network. (The volcano keeps its crater.)
  if (preset !== 'volcano') breachDepressions(h, N, 0.02);
  // Cut the drainage network: tributaries merging into deeper trunk channels
  if (preset !== 'flat') {
    carveRivers(h, N);
    if (preset !== 'volcano') breachDepressions(h, N, 0.02);
  }

  generateGeology(world, preset, seed);
  world.setBaseline();
  world.clearWater();
  world.sources.length = 0;
  initVegetation(world, seed);
  world.dirty = true;
}

/**
 * Real lowlands are mostly smooth: valleys and plains are filled with sediment that buries the
 * small bumps. Raw noise leaves lots of little dimples there, which fill with water into a honeycomb
 * of puddles. Blur the low ground, but leave a few patches rough (like a field of kettle ponds).
 */
function smoothLowlands(world, noise) {
  const N = world.N, H = world.height;
  let lo = Infinity, hi = -Infinity;
  for (const h of H) { if (h < lo) lo = h; if (h > hi) hi = h; }
  // A light blur: enough to remove noise dimples, not so much that valleys turn into broad flat
  // floors (water spreads across those as a sheet instead of gathering into a river)
  const blurred = boxBlur(H, N, 2);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const t = (H[i] - lo) / (hi - lo || 1);
      const low = 1 - smoothstep(0.15, 0.4, t);
      const keepRough = smoothstep(0.68, 0.82, 0.5 + 0.5 * noise(x / 60 + 91.7, z / 60 - 13.2));
      const w = low * (1 - keepRough);
      H[i] += (blurred[i] - H[i]) * w;
    }
  }
}

function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
