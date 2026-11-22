// Seawater quality.
//
// Two things foul the sea here:
//   • silt (world.silt): mud and fine particles stirred into the water. It comes from rivers
//     carrying sediment into the sea, from waves eating at the shore (mudflats wash out fastest)
//     and from landslides that run into the water. It turns the water brown and cuts off the light
//     that seagrass and coral need; it settles out over a few days.
//   • pollutants (world.pollution): sewage, runoff, spills (the Pollute tool). They linger far longer
//     and poison sea life outright.
// Both spread with the tides and currents, and are flushed out to the open ocean at the map's edge.
//
// Living sea beds clean the water: seagrass meadows trap silt and take up nutrients, kelp forests
// slow the water so particles drop out, coral reefs and their filter feeders strain it, and
// mangroves catch the mud among their roots. But they can only take so much: where the water stays
// too dirty, the beds sicken (world.marineHealth falls) and die off, leaving bare seabed that no
// longer cleans anything, so a polluted bay can tip into a dead zone. Clean it up and they slowly
// come back.

import { boxBlur } from '../core/grid.js';

export const qualityParams = {
  settle: 0.03,   // share of the silt that settles out each step
  decay: 0.002,   // share of the pollutants broken down each step
  filter: 1,      // how strongly living sea beds clean the water
};

export function ensureQuality(world) {
  const n = world.N * world.N;
  if (!world.silt || world.silt.length !== n) world.silt = new Float32Array(n);
  if (!world.pollution || world.pollution.length !== n) world.pollution = new Float32Array(n);
  if (!world.marineHealth || world.marineHealth.length !== n) world.marineHealth = new Float32Array(n).fill(1);
}

/** Water quality 0 (foul) … 1 (clear) at cell i. */
export function waterQuality(world, i) {
  if (!world.silt) return 1;
  return Math.max(0, Math.min(1, 1 - 0.45 * world.silt[i] - 0.8 * world.pollution[i]));
}

export function qualityLabel(q) {
  return q > 0.85 ? 'clear' : q > 0.65 ? 'slightly murky' : q > 0.4 ? 'murky' : q > 0.2 ? 'polluted' : 'foul';
}

/** Put silt into the sea at or next to cell i (into the lowest neighbour, where the water is). */
export function addSilt(world, i, amount) {
  ensureQuality(world);
  const N = world.N, H = world.height;
  let j = i;
  if (i > N && i < N * N - N) for (const k of [i - 1, i + 1, i - N, i + N]) if (H[k] < H[j]) j = k;
  world.silt[j] = Math.min(4, world.silt[j] + amount);
}

/** Silt spread over a disc (debris falling into the sea). */
export function addSiltAt(world, x, z, amount, r) {
  ensureQuality(world);
  const N = world.N, sea = world.meanSea;
  if (sea === undefined || sea < -999) return;
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(N - 1, Math.ceil(x + r));
  const z0 = Math.max(0, Math.floor(z - r)), z1 = Math.min(N - 1, Math.ceil(z + r));
  const cells = [];
  for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) {
    const i = zz * N + xx;
    if ((xx - x) ** 2 + (zz - z) ** 2 <= r * r && world.height[i] < sea) cells.push(i);
  }
  if (!cells.length) return;
  const each = amount / cells.length;
  for (const i of cells) world.silt[i] = Math.min(4, world.silt[i] + each);
}

/**
 * One step (with the coast step). `filterOf[m]` is how well marine biome m cleans the water
 * (0 for bare or open water); `sensitivity[m]` how easily it is harmed.
 */
export function waterQualityStep(world, sea, half, filterOf, sensitivity) {
  ensureQuality(world);
  const N = world.N, n = N * N, H = world.height, SI = world.silt, PO = world.pollution, HL = world.marineHealth;
  const M = world.marine, MG = world.mangrove, SED = world.sediment, p = qualityParams;
  // The water body: the sea and the tidal fringe
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) mask[i] = H[i] < sea + half ? 1 : 0;
  // Rivers deliver their muddy load to the sea
  for (let i = 0; i < n; i++) if (mask[i] && H[i] < sea) SI[i] = Math.min(4, SI[i] + 0.4 * SED[i]);
  // Tides and currents mix it about (an average over the water only, so it doesn't leak onto land)
  const mBlur = boxBlur(mask, N, 2);
  const mix = (F) => {
    const tmp = new Float32Array(n);
    for (let i = 0; i < n; i++) tmp[i] = F[i] * mask[i];
    const b = boxBlur(tmp, N, 2);
    for (let i = 0; i < n; i++) {
      if (!mask[i]) { F[i] = 0; continue; }
      F[i] += (b[i] / Math.max(mBlur[i], 1e-3) - F[i]) * 0.3;
    }
  };
  mix(SI); mix(PO);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (!mask[i]) { HL[i] += (1 - HL[i]) * 0.02; continue; }
      // Flushed out to the open ocean at the map's edge
      const edge = Math.min(x, z, N - 1 - x, N - 1 - z);
      const flush = edge < 4 ? 0.15 * (1 - edge / 4) : 0;
      const m = M ? M[i] : -1;
      const hl = HL[i];
      // Living beds (and mangroves) clean the water, in proportion to how healthy they are
      const f = p.filter * ((m >= 0 ? filterOf[m] : 0) * hl + 0.05 * (MG ? MG[i] : 0));
      const out = SI[i] * Math.min(0.9, p.settle + f + flush);
      // Mud settling in quiet, shallow water builds the tidal flats back up
      if (H[i] > sea - half - 1.5) H[i] += 0.04 * out * (1 - flush * 6);
      SI[i] -= out;
      PO[i] *= 1 - Math.min(0.9, p.decay + 0.25 * f + flush);
      if (SI[i] < 1e-4) SI[i] = 0;
      if (PO[i] < 1e-4) PO[i] = 0;
      // Too much dirt and poison sickens the beds; clean water lets them recover, slowly
      const sens = m >= 0 ? sensitivity[m] : 0;
      const stress = (0.5 * SI[i] + PO[i]) * sens;
      if (stress > 0.35) HL[i] = Math.max(0, hl - 0.03 * (stress - 0.35) * 4);
      else HL[i] = Math.min(1, hl + 0.004 * (1 - stress / 0.35));
    }
  }
}
