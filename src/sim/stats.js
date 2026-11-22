// Whole-map statistics over time, for the Graphs panel: how much of the land is forest, grass or
// bare, how healthy and dense the forest is, snow and ice, fire, and the state of the sea. Sampled
// every few seconds while the simulation runs; world.statHistory keeps the last few hundred samples
// of each (saved with the level).

import { seasonalAt } from './climate.js';
import { waterQuality } from './waterQuality.js';
import { isLivingBed } from './coast.js';

const HISTORY = 300;

/** The statistics shown, in order: id, label, group, unit and help. */
export const STATS = [
  { id: 'forest', label: 'Forest cover', group: 'Land', unit: '%', help: 'Share of the land covered by forest.' },
  { id: 'grass', label: 'Grassland & shrubs', group: 'Land', unit: '%', help: 'Share of the land with grass, meadow or shrubs (not forest).' },
  { id: 'bare', label: 'Bare ground', group: 'Land', unit: '%', help: 'Share of the land with little or nothing growing: rock, sand, desert, fresh lava, burnt ground.' },
  { id: 'oldGrowth', label: 'Old-growth forest', group: 'Land', unit: '%', help: 'Share of the forest that is old growth.' },
  { id: 'health', label: 'Forest health', group: 'Land', unit: '%', help: 'Average forest health: how well young trees are replacing the old ones as they die.' },
  { id: 'density', label: 'Tree density', group: 'Land', unit: '%', help: 'Average tree density (canopy closure) in the forest.' },
  { id: 'snow', label: 'Snow cover', group: 'Land', unit: '%', help: 'Share of the land under snow.' },
  { id: 'ice', label: 'Glacier ice', group: 'Land', unit: '%', help: 'Share of the land under glacier ice.' },
  { id: 'burnt', label: 'Burnt or burning', group: 'Land', unit: '%', help: 'Share of the land on fire or freshly burnt.' },
  { id: 'deadWood', label: 'Dead forest', group: 'Land', unit: '%', help: 'Share of the land with standing dead trees (killed by tree-killing animals), which burn fiercely.' },
  { id: 'temp', label: 'Average temperature', group: 'Climate', unit: '°C', help: 'Average temperature over the land today (with the season).' },
  { id: 'people', label: 'Population', group: 'Civilization', unit: 'people', help: 'Everyone living in the towns.' },
  { id: 'towns', label: 'Towns', group: 'Civilization', unit: '', help: 'How many towns and villages there are.' },
  { id: 'paved', label: 'Paved land', group: 'Civilization', unit: '%', help: 'Share of the land paved over by towns and roads.' },
  { id: 'boats', label: 'Boats', group: 'Civilization', unit: '', help: 'Fishing boats in the towns\' harbours.' },
  { id: 'industry', label: 'Industrial land', group: 'Civilization', unit: '%', help: 'Share of the land given over to industry.' },
  { id: 'farmland', label: 'Farmland', group: 'Civilization', unit: '%', help: 'Share of the land cleared for farming.' },
  { id: 'dirtyRivers', label: 'Polluted rivers', group: 'Civilization', unit: '%', help: 'Share of the rivers and streams carrying pollution from the towns upstream.' },
  { id: 'sea', label: 'Sea', group: 'Sea', unit: '%', help: 'Share of the map that is sea.' },
  { id: 'clean', label: 'Clean water', group: 'Sea', unit: '%', help: 'Share of the sea whose water is clear (not muddy or polluted).' },
  { id: 'lowOxygen', label: 'Low-oxygen water', group: 'Sea', unit: '%', help: 'Share of the sea short of oxygen (hypoxic water and dead zones).' },
  { id: 'beds', label: 'Healthy sea beds', group: 'Sea', unit: '%', help: 'Share of the kelp, seagrass, coral and cold-water coral beds that are in good health.' },
  { id: 'coral', label: 'Coral reef', group: 'Sea', unit: '%', help: 'Share of the sea with living coral reef.' },
  { id: 'seaIce', label: 'Sea ice', group: 'Sea', unit: '%', help: 'Share of the sea frozen over.' },
];

/** Compute the current value of every statistic. */
export function computeStats(world) {
  const N = world.N, n = N * N, H = world.height, V = world.vegetation;
  const sea = world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9;
  let land = 0, tempN = 0, forest = 0, grass = 0, bare = 0, old = 0, healthSum = 0, densSum = 0, snow = 0, ice = 0, burnt = 0, dead = 0, temp = 0;
  let paved = 0, farmland = 0, industry = 0, streams = 0, dirtyStreams = 0;
  let seaN = 0, clean = 0, lowOx = 0, beds = 0, bedsOK = 0, coral = 0, seaIce = 0;
  const st = world.seasonT || 0;
  for (let i = 0; i < n; i += 2) { // (every other cell: plenty for a map-wide share)
    if (H[i] < sea) {
      seaN++;
      if (world.silt && waterQuality(world, i) > 0.65) clean++;
      if (world.oxygen && world.oxygen[i] < 0.6) lowOx++;
      const m = world.marine ? world.marine[i] : -1;
      if (isLivingBed(m)) { beds++; if (world.marineHealth && world.marineHealth[i] > 0.5) bedsOK++; }
      if (world.coral && world.coral[i] > 0.3) coral++;
      if (world.seaIce && world.seaIce[i] > 0.3) seaIce++;
      continue;
    }
    land++;
    if (world.paved && world.paved[i] > 0.5) paved++;
    if (world.landUse && world.landUse[i] === 1) farmland++;
    if (world.landUse && world.landUse[i] === 4) industry++;
    if (world.water[i] > 0.05) { streams++; if (world.riverPollution && world.riverPollution[i] > 0.1) dirtyStreams++; }
    const v = V[i];
    if (v > 0.66) {
      forest++;
      if (world.forestAge[i] > 0.75) old++;
      if (world.forestHealth) healthSum += world.forestHealth[i];
      if (world.treeDensity) densSum += world.treeDensity[i];
    } else if (v > 0.25) grass++;
    else bare++;
    if (world.snow && world.snow[i] > 0.1) snow++;
    if (world.ice && world.ice[i] > 0.05) ice++;
    if (world.fire[i] > 0 || world.burnt[i] > 0.2) burnt++;
    if (world.deadWood && world.deadWood[i] > 0.1) dead++;
    if (i % 8 === 0) { temp += world.temperature[i] + seasonalAt(world, i, st); tempN++; }
  }
  const pct = (a, b) => (b > 0 ? (100 * a) / b : 0);
  return {
    forest: pct(forest, land), grass: pct(grass, land), bare: pct(bare, land),
    oldGrowth: pct(old, forest),
    health: world.forestHealth && forest ? (100 * healthSum) / forest : null,
    density: world.treeDensity && forest ? (100 * densSum) / forest : null,
    snow: pct(snow, land), ice: pct(ice, land), burnt: pct(burnt, land), deadWood: pct(dead, land),
    temp: tempN ? temp / tempN : 0,
    sea: pct(seaN, seaN + land), clean: pct(clean, seaN), lowOxygen: pct(lowOx, seaN), beds: pct(bedsOK, beds),
    coral: pct(coral, seaN), seaIce: pct(seaIce, seaN),
    people: (world.towns || []).reduce((t, x) => t + x.pop, 0), towns: (world.towns || []).length, boats: (world.towns || []).reduce((t, x) => t + (x.boats || 0), 0),
    paved: pct(paved, land), farmland: pct(farmland, land), industry: pct(industry, land), dirtyRivers: pct(dirtyStreams, streams),
  };
}

/** Record a sample of every statistic. */
export function recordStats(world) {
  if (!world.statHistory) world.statHistory = {};
  const now = computeStats(world);
  for (const s of STATS) {
    if (now[s.id] === null) continue; // (not computed yet)
    const h = world.statHistory[s.id] || (world.statHistory[s.id] = []);
    h.push(Math.round(now[s.id] * 10) / 10);
    if (h.length > HISTORY) h.splice(0, h.length - HISTORY);
  }
  return now;
}
