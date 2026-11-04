// Biomes: what the land surface looks like, decided by plant cover, soil water, slope and height.
// The Natural view blends between them smoothly; the Biomes view shows the hard categories.

import { vegetationParams } from '../sim/vegetation.js';

/** Colours are sRGB 0..1. Order is the legend order. */
export const BIOMES = {
  forest:    { label: 'Forest',    color: [0.13, 0.30, 0.13], help: 'Moist, gentle ground below the tree line. Deep roots: erodes slowest.' },
  wetland:   { label: 'Wetland',   color: [0.27, 0.40, 0.31], help: 'Flat, waterlogged ground beside rivers and lakes: marsh and swamp.' },
  grassland: { label: 'Grassland', color: [0.52, 0.66, 0.30], help: 'Moderately moist ground, or slopes too steep for forest.' },
  shrubland: { label: 'Shrubland', color: [0.67, 0.62, 0.37], help: 'Semi-arid scrub and savanna: sparse cover on drying soil.' },
  desert:    { label: 'Desert',    color: [0.88, 0.78, 0.48], help: 'Dry, flat ground: loose sand with almost no plants. Erodes easily.' },
  mesa:      { label: 'Mesa',      color: [0.78, 0.42, 0.24], help: 'Dry, steep ground: bare banded red rock, like mesas and badlands.' },
  barren:    { label: 'Barren',    color: [0.55, 0.43, 0.30], help: 'Bare soil and rock: recently eroded, buried or too steep to grow on.' },
  tundra:    { label: 'Tundra',    color: [0.56, 0.58, 0.48], help: 'Above the tree line: low alpine grasses and lichen thinning to rock.' },
  snow:      { label: 'Snow',      color: [0.95, 0.96, 0.98], help: 'High, gentle ground above the snow line.' },
};

export const DRY_SOIL = 0.28;     // soil moisture below this is arid (desert / mesa)
export const MESA_SLOPE = 0.6;    // rise/run separating flat desert from steep mesa

/**
 * Hard biome category of a cell.
 * @param {import('../core/world.js').World} world
 * @param {number} i      cell index
 * @param {number} slope  rise/run at the cell
 * @param {number} snowLine
 */
export function classifyBiome(world, i, slope, snowLine) {
  const h = world.height[i];
  const v = world.vegetation[i];
  const soil = world.soil ? world.soil[i] : 0.5;
  const near = world.nearWater ? world.nearWater[i] : 0;
  const treeLine = vegetationParams.treeLine;
  if (h > snowLine && slope < 0.6) return 'snow';
  if (h > treeLine + 2 && v > 0.12) return 'tundra';
  if (near > 0.5 && soil > 0.7 && slope < 0.25 && v > 0.4) return 'wetland';
  if (v > 0.66) return 'forest';
  if (v > 0.42) return soil < 0.4 ? 'shrubland' : 'grassland';
  if (v > 0.25 && soil >= DRY_SOIL) return 'shrubland';
  if (soil < DRY_SOIL) return slope < MESA_SLOPE ? 'desert' : 'mesa';
  return 'barren';
}
