// Climate change: the towns' greenhouse gas warming the climate (a Civilization setting).
//
// world.carbonPPM is the greenhouse gas in the air (parts per million; 280 before any towns).
// Towns add to it by burning (more people, more burning), with their industry, and with every
// wildfire; the oceans and growing forests slowly take it back up. The climate warms towards
// about 3 °C for every doubling of the gas, but slowly: the warming lags the gas by years, and it goes
// on warming for a while after emissions stop. The warming moves the climate settings themselves, so
// you see it on them: the Temperature slider climbs, evaporation and rain pick up a little (a
// warmer world has a faster water cycle), and the sea level setting rises while it's warmer
// (melting ice, warmer water taking more room). world.warmed is how far it has moved them so far.
// Everything that follows temperature follows: snow lines and tree lines climb, glaciers shrink,
// species move uphill, the sea warms. Switched off, it stops moving them (they stay where they are).

import { civParams } from './civilization.js';
import { climateParams } from './climate.js';
import { waterParams } from './water.js';

const BASE = 280;

/** Warm (or cool) the climate settings by d °C. */
function applyWarming(world, d) {
  world.warmed = (world.warmed || 0) + d;
  climateParams.seaTemp = Math.max(-10, Math.min(35, climateParams.seaTemp + d));
  // (about 7% more evaporation a degree, and a few % more rain where it rains at all)
  waterParams.evaporate = Math.max(0, Math.min(0.3, waterParams.evaporate * (1 + 0.07 * d)));
  if (waterParams.rain > 0) waterParams.rain = Math.max(0, Math.min(0.1, waterParams.rain * (1 + 0.03 * d)));
}

/** One step (with the towns' step). Returns how much the sea rose (for the app to apply). */
export function climateChangeStep(world, seaOn) {
  if (world.carbonPPM === undefined) world.carbonPPM = BASE;
  let rise = 0;
  // (a save from before: its hidden warming offset moves onto the settings, once)
  if (climateParams.warming) { applyWarming(world, climateParams.warming); climateParams.warming = 0; }
  if (!civParams.climateChange) return 0; // (switched off: the settings stay where it left them)
  const e = civParams.emissions ?? 1;
  let emit = 0;
  for (const t of world.towns || []) emit += t.pop * 1.5e-6;
  if (world.landUse) {
    let ind = 0;
    const LU = world.landUse;
    for (let i = 0; i < LU.length; i += 4) if (LU[i] === 4) ind += 4;
    emit += ind * 4e-4;
  }
  emit += (world.fireCells ? world.fireCells.length : 0) * 2e-4;
  // (land cleared or burnt and forest regrowing: the forest carbon change, when that's kept)
  if (world.carbonFlux) emit += world.carbonFlux;
  world.carbonPPM += emit * e;
  // Taken back up by the sea and the land, the more the higher it is
  world.carbonPPM -= (world.carbonPPM - BASE) * 0.0002;
  if (world.carbonPPM < BASE) world.carbonPPM = BASE;
  // Warming follows, slowly (~3 °C a doubling)
  const target = 3 * Math.log2(world.carbonPPM / BASE);
  const d = (target - (world.warmed || 0)) * 0.003;
  if (Math.abs(d) > 1e-6) applyWarming(world, d);
  world.emissionRate = emit * e;
  // The sea rises while it's warmer (melting ice, warmer water taking more room)
  if (seaOn && world.warmed > 0.05) rise = 0.00025 * world.warmed;
  return rise;
}
