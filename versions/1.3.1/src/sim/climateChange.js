// Climate change: the towns' greenhouse gas warming the climate (a Civilization setting).
//
// world.carbonPPM is the greenhouse gas in the air (parts per million; 280 before any towns).
// Towns add to it by burning (more people, more burning), with their industry, and with every
// wildfire; the oceans and growing forests slowly take it back up. The climate warms towards
// about 3 °C for every doubling of the gas (climateParams.warming, which every temperature on the
// map includes), but slowly: the warming lags the gas by years, and it goes on warming for a while
// after emissions stop. While it's warmer than it was, the sea slowly rises. Everything that
// follows temperature follows the warming: snow lines and tree lines climb, glaciers shrink,
// species move uphill, the sea warms.

import { civParams } from './civilization.js';
import { climateParams } from './climate.js';

const BASE = 280;

/** One step (with the towns' step). Returns how much the sea rose (for the app to apply). */
export function climateChangeStep(world, seaOn) {
  if (world.carbonPPM === undefined) world.carbonPPM = BASE;
  let rise = 0;
  if (!civParams.climateChange) {
    // (switched off: the climate settles back as it was)
    if (climateParams.warming) climateParams.warming *= 0.995;
    if (Math.abs(climateParams.warming) < 0.005) climateParams.warming = 0;
    return 0;
  }
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
  climateParams.warming = (climateParams.warming || 0) + (target - (climateParams.warming || 0)) * 0.003;
  world.emissionRate = emit * e;
  // The sea rises while it's warmer (melting ice, warmer water taking more room)
  if (seaOn && climateParams.warming > 0.05) rise = 0.00025 * climateParams.warming;
  return rise;
}
