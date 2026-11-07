// Biomes: what the land surface looks like, decided by plant cover, soil water, slope and height.
// The Natural view blends between them smoothly; the Biomes view shows the hard categories.

import { FOREST_TYPES, forestTypeAt } from '../sim/forests.js';
import { climateParams, snowAt } from '../sim/climate.js';

const forestBiomes = Object.fromEntries(FOREST_TYPES.map((f) => [f.id, { label: f.label, color: f.color, help: f.help }]));

/** Colours are sRGB 0..1. Order is the legend order. */
export const BIOMES = {
  ...forestBiomes,
  wetland:   { label: 'Wetland',   color: [0.27, 0.40, 0.31], help: 'Flat, waterlogged ground beside rivers and lakes: marsh and swamp.' },
  grassland: { label: 'Grassland', color: [0.52, 0.66, 0.30], help: 'Moderately moist ground, or slopes too steep for forest.' },
  shrubland: { label: 'Shrubland', color: [0.67, 0.62, 0.37], help: 'Semi-arid scrub and savanna: sparse cover on drying soil.' },
  desert:    { label: 'Desert',    color: [0.88, 0.78, 0.48], help: 'Dry, flat ground: loose sand with almost no plants. Erodes easily.' },
  mesa:      { label: 'Mesa',      color: [0.78, 0.42, 0.24], help: 'Dry, steep ground: bare banded red rock, like mesas and badlands.' },
  barren:    { label: 'Barren',    color: [0.55, 0.43, 0.30], help: 'Bare soil and rock: recently eroded, buried or too steep to grow on.' },
  tundra:    { label: 'Tundra',    color: [0.56, 0.58, 0.48], help: 'Too cold for trees: low alpine grasses and lichen thinning to rock.' },
  snow:      { label: 'Snow',      color: [0.95, 0.96, 0.98], help: 'Below freezing with enough moisture, on slopes gentle enough to hold snow.' },
};

export const DRY_SOIL = 0.28;     // soil moisture below this is arid (desert / mesa)

/**
 * Hard biome category of a cell.
 * @param {import('../core/world.js').World} world
 * @param {number} i      cell index
 * @param {number} slope  rise/run at the cell
 */
export function classifyBiome(world, i, slope) {
  const v = world.vegetation[i];
  const soil = world.soil ? world.soil[i] : 0.5;
  const near = world.nearWater ? world.nearWater[i] : 0;
  const T = world.temperature ? world.temperature[i] : 12;
  if (snowAt(world, i, slope) > 0.5) return 'snow';
  if (T < climateParams.treeLineTemp - 0.5 && v > 0.12) return 'tundra';
  if (v > 0.66) return FOREST_TYPES[forestTypeAt(world, i)].id;
  if (near > 0.5 && soil > 0.7 && slope < 0.25 && v > 0.4) return 'wetland';
  if (v > 0.42) return soil < 0.36 ? 'shrubland' : 'grassland';
  if (v > 0.25 && soil >= DRY_SOIL) return 'shrubland';
  // Desert vs mesa is decided by the lie of the land around, not one cell, so each forms whole regions
  const stand = world.standSlope ? world.standSlope[i] : slope;
  if (soil < DRY_SOIL) return stand < world.gentleSlope * 1.1 ? 'desert' : 'mesa';
  return 'barren';
}
