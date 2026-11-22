// Probes: measuring stations you drop on the map (the Probe tool). Each records the conditions at
// its spot over time, the same things the inspector shows, for the Graphs window: temperature,
// rain or snow, snow depth, surface water, soil wetness, plant cover, tree density, forest health,
// wind, and at sea the water quality, oxygen and salinity, plus the animals there and the biome.
// world.probes = [{ id, name, x, z, history: { key: [values…] }, biomes: [ids…] }] (saved with
// the level).

import { seasonalAt } from './climate.js';
import { waterQuality } from './waterQuality.js';
import { classifyBiome } from '../render/biomes.js';
import { marineShown } from './coast.js';

const HISTORY = 300;

/** What a probe records: key, label, unit, where it applies ('land', 'sea' or 'any'), help. */
export const PROBE_STATS = [
  { id: 'temp', label: 'Temperature', unit: '°C', where: 'any', help: 'Today\'s temperature here: the air on land, the water at sea.' },
  { id: 'precip', label: 'Rain / snow', unit: '%', where: 'any', help: 'How much rain or snow this spot gets (wet windward slopes high, rain shadows low).' },
  { id: 'snow', label: 'Snow depth', unit: '', where: 'land', help: 'Depth of the snow lying here.' },
  { id: 'water', label: 'Surface water', unit: '', where: 'land', help: 'Depth of the water standing or flowing here.' },
  { id: 'soil', label: 'Soil wetness', unit: '%', where: 'land', help: 'How wet the soil is.' },
  { id: 'cover', label: 'Plant cover', unit: '%', where: 'land', help: 'How much of the ground plants cover.' },
  { id: 'trees', label: 'Tree density', unit: '%', where: 'land', help: 'How closely the trees stand (canopy closure).' },
  { id: 'health', label: 'Forest health', unit: '%', where: 'land', help: 'Whether young trees are replacing the old ones as they die.' },
  { id: 'wind', label: 'Wind', unit: 'km/h', where: 'any', help: 'Wind speed here.' },
  { id: 'quality', label: 'Water quality', unit: '%', where: 'sea', help: 'How clear the seawater is (silt and pollutants lower it).' },
  { id: 'oxygen', label: 'Oxygen', unit: '%', where: 'sea', help: 'Oxygen in the water (low: hypoxic; very low: a dead zone).' },
  { id: 'salinity', label: 'Salinity', unit: '‰', where: 'sea', help: 'How salty the water is (full seawater is about 35 ‰; brackish near river mouths).' },
  { id: 'animals', label: 'Animals', unit: '%', where: 'any', help: 'All your animals here together (as a share of what the place could hold).' },
];

/** Add a probe at grid point (x, z); records a first sample at once. */
export function addProbe(world, x, z) {
  if (!world.probes) world.probes = [];
  const used = new Set(world.probes.map((p) => p.num));
  let num = 1;
  while (used.has(num)) num++;
  const p = { id: 'p' + Math.random().toString(36).slice(2, 8), num, name: `Probe ${num}`, x: Math.round(x), z: Math.round(z), history: {}, biomes: [] };
  world.probes.push(p);
  sampleProbe(world, p);
  return p;
}

/** Remove probes within `r` cells of (x, z). Returns how many were removed. */
export function removeProbesNear(world, x, z, r = 6) {
  const before = (world.probes || []).length;
  world.probes = (world.probes || []).filter((p) => Math.hypot(p.x - x, p.z - z) > r);
  return before - world.probes.length;
}

/** The current values at a probe's spot. */
export function probeValues(world, p) {
  const N = world.N, x = Math.min(N - 1, Math.max(0, p.x)), z = Math.min(N - 1, Math.max(0, p.z)), i = z * N + x, H = world.height;
  const sea = world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9;
  const wet = H[i] < sea;
  const gx = (H[x < N - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * 0.5, gz = (H[z < N - 1 ? i + N : i] - H[z > 0 ? i - N : i]) * 0.5;
  let animals = 0;
  for (const a of world.animals || []) { const f = world['animal_' + a.id]; if (f) animals += f[i]; }
  const v = {
    temp: wet && world.seaT && !Number.isNaN(world.seaT[i]) ? world.seaT[i] : world.temperature[i] + seasonalAt(world, i),
    precip: 100 * (world.precip ? world.precip[i] : 0),
    wind: world.wind ? world.wind[i] * 40 : null,
    animals: 100 * Math.min(1.5, animals),
  };
  if (wet) {
    v.quality = world.silt ? 100 * waterQuality(world, i) : null;
    v.oxygen = world.oxygen ? 100 * world.oxygen[i] : null;
    v.salinity = world.salinity ? 35 * world.salinity[i] : null;
  } else {
    v.snow = world.snow ? world.snow[i] : 0;
    v.water = world.water[i];
    v.soil = 100 * (world.soil ? world.soil[i] : 0);
    v.cover = 100 * world.vegetation[i];
    v.trees = world.treeDensity ? 100 * world.treeDensity[i] : null;
    v.health = world.forestHealth && world.vegetation[i] > 0.3 ? 100 * world.forestHealth[i] : null;
  }
  // (at sea, the sea bed: seagrass, kelp, coral, open water…)
  const m = wet && world.marine ? marineShown(world, i) : -1;
  return { values: v, biome: m >= 0 ? 'sea_' + m : classifyBiome(world, i, Math.sqrt(gx * gx + gz * gz)), wet };
}

function sampleProbe(world, p) {
  const { values, biome } = probeValues(world, p);
  for (const s of PROBE_STATS) {
    const val = values[s.id];
    const h = p.history[s.id] || (p.history[s.id] = []);
    h.push(val === null || val === undefined ? null : Math.round(val * 10) / 10);
    if (h.length > HISTORY) h.splice(0, h.length - HISTORY);
  }
  p.biomes.push(biome);
  if (p.biomes.length > HISTORY) p.biomes.splice(0, p.biomes.length - HISTORY);
}

/** Record a sample at every probe (with the map statistics). */
export function recordProbes(world) {
  for (const p of world.probes || []) sampleProbe(world, p);
}
