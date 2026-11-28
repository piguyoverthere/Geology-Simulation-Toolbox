// Rivers fed by their catchments: rain falling on the hills runs downhill and gathers, so every
// slope with enough land draining through it carries a stream, and streams join into rivers that
// grow bigger downstream.
//
// Every so often the drainage of the land is worked out (each cell passes the rain that reaches it,
// world.precip, to its lowest neighbour, highest ground first): world.drainArea is how much rain
// drains through each cell (counting at least a modest rain everywhere, so dry country has its washes). Where that passes a threshold (riverParams.density: more = rivers start
// from smaller catchments) the cell is part of the river network. Each river cell is fed the rain of
// the land that drains straight into it from off the network (world.riverInflow, per second), so the
// water simulation (sim/water.js) carries a flow that builds down the network: small streams high
// up, joining as tributaries into bigger rivers below. The flow follows the season's rain (less in
// a dry summer, none in a drought-dry land), and where it runs steadily it carves its channel
// (water.js's erosion), and on flat ground it winds (sim/dynamics.js, meanders).

import { seasonalRain } from './climate.js';
import { MinHeap } from '../core/grid.js';

/** The land with its hollows filled to their spill points (a tiny slope kept across the fill). */
function fillDepressions(world, sea) {
  const N = world.N, n = N * N, H = world.height;
  const F = new Float32Array(n), seen = new Uint8Array(n), heap = new MinHeap(n * 2);
  const EPS = 1e-4;
  for (let i = 0; i < n; i++) {
    const x = i % N, z = (i / N) | 0;
    if (H[i] < sea || x === 0 || z === 0 || x === N - 1 || z === N - 1) { F[i] = H[i]; seen[i] = 1; heap.push(i, H[i]); }
  }
  while (heap.size) {
    const i = heap.pop(), x = i % N, z = (i / N) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
      const j = zz * N + xx;
      if (seen[j]) continue;
      seen[j] = 1;
      F[j] = Math.max(H[j], F[i] + EPS);
      if (heap.size < n * 2 - 1) heap.push(j, F[j]);
    }
  }
  return F;
}

export const riverParams = {
  enabled: true,
  density: 1,   // how many rivers: higher = streams start from smaller catchments
  flow: 1,      // how much water they carry
};

let order = null, tick = 0, AR = null;

/** Work out the drainage and the river network (every few hundred frames). */
export function updateDrainage(world) {
  const N = world.N, n = N * N, H = world.height, sea = world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9;
  const P = world.precip;
  if (!world.drainArea || world.drainArea.length !== n) world.drainArea = new Float32Array(n);
  const A = world.drainArea, down = new Int32Array(n).fill(-1);
  // Hollows filled (a priority flood in from the sea and the map's edges): water drains through
  // lakes and on downhill, as it does, instead of stopping in every dip
  const F = fillDepressions(world, sea);
  // Highest ground first
  if (!order || order.length !== n) order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => F[b] - F[a]);
  // Two tallies: how much land drains through each cell, counting at least a modest rain everywhere
  // (A: where the streambeds are; dry country has its washes too, running only after rain), and the
  // rain that really falls (AR: how much water they carry)
  if (!AR || AR.length !== n) AR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = H[i] >= sea ? (P ? Math.min(1.5, P[i]) : 0.5) : 0;
    AR[i] = r; A[i] = H[i] >= sea ? Math.max(0.45, r) : 0;
  }
  for (let k = 0; k < n; k++) {
    const i = order[k];
    if (H[i] < sea) continue;
    const x = i % N, z = (i / N) | 0;
    let best = -1, bd = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
      const j = zz * N + xx;
      const drop = (F[i] - F[j]) / (dx && dz ? 1.414 : 1);
      if (drop > bd) { bd = drop; best = j; }
    }
    if (best >= 0) { A[best] += A[i]; AR[best] += AR[i]; down[i] = best; }
  }
  // The network: cells with enough draining through them; each fed what drains in from off it
  const th = 60 / Math.max(0.1, riverParams.density);
  const RI = world.riverInflow && world.riverInflow.length === n ? world.riverInflow : (world.riverInflow = new Float32Array(n));
  RI.fill(0);
  const local = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (H[i] < sea || A[i] < th) continue;
    local[i] += Math.max(1e-4, P ? Math.min(1.5, P[i]) : 0.5); // (its own rain; a dry wash is still on the network)
  }
  for (let i = 0; i < n; i++) {
    const d = down[i];
    if (d < 0 || A[i] >= th || A[d] < th) continue;
    local[d] += AR[i]; // (a slope draining into the river from off the network: the rain it really gets)
  }
  let cells = 0;
  for (let i = 0; i < n; i++) if (local[i] > 0) { RI[i] = local[i]; cells++; }
  world.riverCells = cells;
}

/** Each step: the river network's water (added by sim/water.js). Recomputes the drainage now and then. */
export function riverStep(world) {
  if (!riverParams.enabled) { world.riverFeed = null; return; }
  if (!world.riverInflow || tick++ % 20 === 0) updateDrainage(world);
  // per-second inflow per cell, scaled by the season's rain
  world.riverFeed = 0.008 * riverParams.flow * seasonalRain();
}
