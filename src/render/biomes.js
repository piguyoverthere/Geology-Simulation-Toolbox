// Biomes: what the land surface looks like, decided by plant cover, soil water, slope and height.
// The Natural view blends between them smoothly; the Biomes view shows the hard categories.

import { FOREST_TYPES, forestTypeAt } from '../sim/forests.js';
import { climateParams, snowAt } from '../sim/climate.js';
import { coastParams, SHORE } from '../sim/coast.js';

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
  mangrove:  { label: 'Mangrove forest', color: [0.13, 0.33, 0.18], help: 'Salt-tolerant forest standing in the tide on warm, sheltered mudflats.' },
  dunes:     { label: 'Coastal dunes', color: [0.86, 0.82, 0.62], help: 'Wind-blown sand behind sand beaches: dune grass, with shore pine on the stabilised dunes.' },
  farmland:  { label: 'Farmland',  color: [0.74, 0.68, 0.40], help: 'Fields cleared, levelled or terraced and irrigated by a town: crops, no forest. Their irrigation draws down the nearest river or lake, and their runoff pollutes it.' },
  canal:     { label: 'Irrigation canal', color: [0.56, 0.52, 0.44], help: 'A stone-lined channel dug from a river or lake out to a town\'s dry fields, carrying water so they can be irrigated; it draws down the river it taps.' },
  timber:    { label: 'Timber plantation', color: [0.16, 0.30, 0.15], help: 'Woodland a town grows for timber, on land where forest grows: planted, left to grow to full forest, clear-felled a stand at a time when grown (bare brown ground with slash), then replanted. A road runs out to each from the town.' },
  mine:      { label: 'Mine', color: [0.30, 0.27, 0.25], help: 'A town\'s mine: an open pit sunk into hard, ore-bearing rock (granite, basalt, gneiss…), deepened year by year. It makes the town richer.' },
  spoil:     { label: 'Spoil heap', color: [0.70, 0.48, 0.26], help: 'The waste rock from a mine, piled beside it: raw and poisonous. Nothing grows on it, little near it, and the water running off it fouls the streams.' },
  sewer:     { label: 'Sewer',     color: [0.30, 0.26, 0.20], help: 'A town\'s drain: a foul channel from the town centre to its outfall, where the town\'s runoff pours into one river or bay instead of seeping out everywhere.' },
  dam:       { label: 'Dam',       color: [0.76, 0.75, 0.72], help: 'A concrete wall across a river valley, a reservoir filling behind it: water for the town; it blocks fish swimming upriver, traps the river\'s sediment and pollutes the river.' },
  quay:      { label: 'Quay (sea wall)', color: [0.62, 0.61, 0.57], help: 'A town\'s armoured shore: raised above the tide and walled, deep water dredged in front (a steep drop-off with no tidal flats). Easy to build harbours on; hard on the sea bed and the water beside it.' },
  harbor:    { label: 'Harbour',   color: [0.50, 0.40, 0.30], help: 'A coastal town\'s docks: home to its fishing boats, which also carry settlers across the water.' },
  industry:  { label: 'Industrial area', color: [0.42, 0.45, 0.50], help: 'A town\'s industry on the water\'s edge: mass-paved, pouring pollution into the water beside it and down the rivers on a very large scale.' },
  town:      { label: 'Town',      color: [0.62, 0.52, 0.48], help: 'Paved streets and buildings: flat, sealed ground where nothing grows.' },
  snow:      { label: 'Snow',      color: [0.95, 0.96, 0.98], help: 'Below freezing with enough moisture, on slopes gentle enough to hold snow.' },
  beach:     { label: 'Sand beach', color: [0.90, 0.83, 0.62], help: 'Sand the waves have laid down: bare ground within reach of the tide and storm surges, where sand gathers on gentle shores; and grassland the sea once covered, its turf stripped (out of the water again it stays beach for decades, then dune grass creeps back and it slowly turns back into grassland).' },
  mudflat:   { label: 'Mudflat', color: [0.46, 0.41, 0.33], help: 'Bare mud within reach of the tide and storm surges, on flat, sheltered shores: floods and drains with every tide.' },
  shingle:   { label: 'Shingle beach', color: [0.60, 0.58, 0.54], help: 'Pebbles and cobbles within reach of the tide and storm surges, on steeper or exposed shores with little sand (black boulders where the rock is basalt).' },
  seacliff:  { label: 'Sea cliff', color: [0.50, 0.46, 0.42], help: 'A steep rock face the waves are undercutting: it retreats as they erode it.' },
  dock:      { label: 'Dock (pier)', color: [0.46, 0.40, 0.34], help: 'A paved deck built out over the water from a town\'s waterfront, deep water dredged on both sides for ships to tie up.' },
};

export const DRY_SOIL = 0.28;     // soil moisture below this is arid (desert / mesa)

/**
 * Hard biome category of a cell.
 * @param {import('../core/world.js').World} world
 * @param {number} i      cell index
 * @param {number} slope  rise/run at the cell
 */
/** The biome at cell i. With noSnow, snow lying on the ground is looked through to the biome beneath. */
export function classifyBiome(world, i, slope, noSnow = false) {
  const v = world.vegetation[i];
  const soil = world.soil ? world.soil[i] : 0.5;
  const near = world.nearWater ? world.nearWater[i] : 0;
  const T = (world.vegTemp || world.temperature) ? (world.vegTemp || world.temperature)[i] : 12;
  if (world.landUse && world.landUse[i] === 5) return 'harbor';
  if (world.landUse && world.landUse[i] === 6) return 'quay';
  if (world.landUse && world.landUse[i] === 7) return 'dam';
  if (world.landUse && world.landUse[i] === 8) return 'canal';
  if (world.landUse && world.landUse[i] === 9) return 'sewer';
  if (world.landUse && world.landUse[i] === 10) return 'timber';
  if (world.landUse && world.landUse[i] === 11) return 'mine';
  if (world.landUse && world.landUse[i] === 12) return 'spoil';
  if (world.landUse && world.landUse[i] === 13) return 'dock';
  if (world.landUse && world.landUse[i] === 4 && world.paved[i] > 0.5) return 'industry';
  if (world.landUse && world.landUse[i] === 2 && world.paved[i] > 0.5) return 'town';
  if (world.landUse && world.landUse[i] === 1) return 'farmland';
  if (!noSnow && snowAt(world, i, slope) > 0.5) return 'snow';
  if (T < climateParams.treeLineTemp - 0.5 && v > 0.12 && v <= 0.66) return 'tundra'; // (high fir forest stays forest)
  if (world.mangrove && world.mangrove[i] > 0.3) return 'mangrove';
  if (world.beachSand && world.beachSand[i] > 0.35 && v <= 0.66) return 'beach';
  // Bare ground within reach of the tide and the storm surges is shore: mudflat, sand or shingle
  // (or a sea cliff), whatever the waves have made of it (sim/coast.js)
  if (v <= 0.25 && world.meanSea > -999) {
    const reach = world.meanSea + 0.5 * coastParams.tideRange + 1.2 + Math.max(0, world.surge || 0);
    if (world.height[i] < reach && (world.shore ? world.shore[i] >= 0 || world.water[i] > 0.05 : true)) {
      const sh = world.shore ? world.shore[i] : -1;
      if (sh < 0) return slope < 0.18 ? 'mudflat' : 'shingle'; // (flooded well inland: flat ground silts to mud)
      return sh === SHORE.mudflat ? 'mudflat' : sh === SHORE.sand ? 'beach' : sh === SHORE.cliff ? 'seacliff' : 'shingle';
    }
  }
  if (world.dune && world.dune[i] > 0.3 && v <= 0.66) return 'dunes';
  if (v > 0.66) return FOREST_TYPES[forestTypeAt(world, i)].id;
  if (near > 0.5 && soil > 0.7 && slope < 0.25 && v > 0.4) return 'wetland';
  if (v > 0.42) return soil < 0.36 ? 'shrubland' : 'grassland';
  if (v > 0.25 && soil >= DRY_SOIL) return 'shrubland';
  // Desert vs mesa is decided by the lie of the land around, not one cell, so each forms whole regions
  const stand = world.standSlope ? world.standSlope[i] : slope;
  if (soil < DRY_SOIL) return stand < world.gentleSlope * 1.1 ? 'desert' : 'mesa';
  return 'barren';
}
