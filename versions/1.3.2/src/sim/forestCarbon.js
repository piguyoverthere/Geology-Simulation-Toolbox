// Forest carbon: how much carbon the land holds in its trees and soil, cell by cell, and how much
// it gains or loses. Trees hold it in their wood: more the denser and older the stand (old growth
// holds several times what young regrowth does); soil holds it in its organic matter (humus), built
// up under long-standing forest. Felling, clearing and fire release it, and regrowing forest takes
// it back up. world.carbonTotal is the map's store; world.carbonFlux the greenhouse gas the land
// gave off (positive) or took up (negative) in the last step, which climate change adds to the air.

/** Carbon held at cell i (tonnes per cell, roughly; up to about 6 in dense old growth). */
export function carbonAt(world, i) {
  const v = world.vegetation[i];
  const cover = v > 0.35 ? Math.min(1, (v - 0.35) / 0.5) : 0;
  const age = world.forestAge ? world.forestAge[i] : 0;
  const dens = world.treeDensity ? world.treeDensity[i] : cover;
  // (giant trees, sequoia and redwood, hold several times the wood of an ordinary old stand)
  const giant = world.giants ? world.giants[i] : 0;
  const wood = 4.5 * cover * (0.25 + 0.75 * age) * (0.4 + 0.6 * dens) * (1 + 2 * giant * age);
  const grass = v > 0.1 ? 0.3 * Math.min(1, v / 0.6) : 0;
  const soil = 1.5 * (world.humus ? world.humus[i] : 0);
  return wood + grass + soil;
}

/** Recount the map's carbon (every 2nd cell each way, scaled up) and how much it changed. */
export function carbonStep(world) {
  const N = world.N, H = world.height, sea = world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9;
  let total = 0;
  for (let z = 0; z < N; z += 2) for (let x = 0; x < N; x += 2) {
    const i = z * N + x;
    if (H[i] >= sea) total += carbonAt(world, i);
  }
  total *= 4;
  const prev = world.carbonTotal;
  world.carbonTotal = total;
  // (released carbon becomes greenhouse gas: about 0.004 ppm a tonne on a map this size)
  world.carbonFlux = prev === undefined ? 0 : (prev - total) * 0.004;
}
