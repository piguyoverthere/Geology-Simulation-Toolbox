// Groundwater: the water stored in the ground beneath the soil (an aquifer), world.groundwater,
// 0 (dry) … 1 (full to the surface), in every cell.
//
// • Recharge: rain soaks down through the soil to it, more where it's wetter and less under
//   pavement, bare rock and steep ground; standing water (ponds, lakes, rivers) leaks down into it.
// • It seeps slowly through the ground towards lower ground (the water table follows the land).
// • Discharge: where it's full in the valley bottoms it seeps out into springs and streams (base
//   flow), which keeps rivers running through dry spells.
// • Pumping: towns sink wells around them and pump it for their people and their fields (more for
//   more people and farmland). Pumped faster than the rain refills it, the water table falls in a
//   cone around the town: the streams it fed fail in summer, and where it's pumped nearly dry the
//   ground settles (subsidence, world.subsided) and the town runs short of water (t.wellsDry).
//
// world.gwNatural is what the aquifer would hold left alone (from the rain and the ground), so the
// Groundwater change overlay can show where it has been drawn down.

import { boxBlur } from '../core/grid.js';

export const groundwaterParams = {
  enabled: true,
  pumping: 1,     // how hard towns pump (× the usual)
};

const seaOf = (w) => (w.meanSea !== undefined && w.meanSea > -999 ? w.meanSea : -1e9);

/** What the aquifer holds left alone: wetter climates and deeper, gentler ground hold more. */
function natural(world, i, sea) {
  if (world.height[i] < sea) return 1;
  const P = world.precip ? Math.min(1, world.precip[i]) : 0.5;
  const soil = world.soil ? world.soil[i] : 0.5;
  const valley = world.valley ? -world.valley[i] : 0; // (hollows and valley floors fill highest)
  return Math.max(0.05, Math.min(1, 0.15 + 0.5 * P + 0.25 * soil + 0.25 * Math.max(-0.4, Math.min(1, valley))));
}

export function ensureGroundwater(world) { ensure(world); }

function ensure(world) {
  const n = world.N * world.N, sea = seaOf(world);
  if (!world.gwNatural || world.gwNatural.length !== n) {
    world.gwNatural = new Float32Array(n);
    for (let i = 0; i < n; i++) world.gwNatural[i] = natural(world, i, sea);
  }
  if (!world.groundwater || world.groundwater.length !== n) world.groundwater = world.gwNatural.slice();
  if (!world.subsided || world.subsided.length !== n) world.subsided = new Float32Array(n);
}

let tick = 0;
/** One groundwater step (every 30 frames). */
export function groundwaterStep(world) {
  if (!groundwaterParams.enabled) return;
  ensure(world);
  const N = world.N, n = N * N, sea = seaOf(world);
  const G = world.groundwater, NAT = world.gwNatural, H = world.height, D = world.water, PV = world.paved;
  // (the natural level follows the climate as it changes: refreshed now and then)
  if (++tick % 20 === 0) for (let i = 0; i < n; i++) NAT[i] = natural(world, i, sea);
  // Recharge towards the natural level (rain, and water standing on the ground), and discharge
  // where it's fuller than the ground holds
  for (let i = 0; i < n; i++) {
    if (H[i] < sea) { G[i] = 1; continue; }
    const seal = PV ? 1 - 0.85 * Math.min(1, PV[i]) : 1;
    const target = NAT[i];
    if (G[i] < target) {
      const rain = world.precip ? Math.min(1, world.precip[i]) : 0.5;
      G[i] += (target - G[i]) * (0.004 + 0.01 * rain) * seal + (D[i] > 0.05 ? 0.002 : 0);
    } else G[i] -= (G[i] - target) * 0.02;
    // Base flow: a full water table in a valley bottom seeps out into the stream
    if (G[i] > 0.75 && world.valley && world.valley[i] < -0.1) {
      const out = (G[i] - 0.75) * 0.004;
      D[i] += out * 2;
      G[i] -= out;
    }
  }
  // Seepage: the water table evens out slowly through the ground
  if (tick % 4 === 0) {
    const B = boxBlur(G, N, 2);
    for (let i = 0; i < n; i++) if (H[i] >= sea) G[i] += (B[i] - G[i]) * 0.15;
  }
  // Pumping: each town's wells, in a cone around it
  const pump = groundwaterParams.pumping;
  if (pump > 0 && world.towns && world.towns.length) {
    const LU = world.landUse, OW = world.civOwner;
    const farms = {};
    if (LU && OW) for (let i = 0; i < n; i += 2) if (LU[i] === 1 && OW[i]) farms[OW[i]] = (farms[OW[i]] || 0) + 2;
    for (const t of world.towns) {
      const demand = (t.pop * 0.00004 + (farms[t.num] || 0) * 0.00025) * pump;
      const r = Math.round(5 + Math.sqrt(t.pop) / 4);
      let wsum = 0;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const d2 = dx * dx + dz * dz; if (d2 <= r * r) wsum += 1 - Math.sqrt(d2) / (r + 1); }
      let level = 0, lc = 0;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const x = t.x + dx, z = t.z + dz;
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (H[i] < sea) continue;
        const take = (demand * (1 - Math.sqrt(d2) / (r + 1))) / wsum * 8;
        G[i] = Math.max(0, G[i] - take);
        // (pumped nearly dry, the ground settles: it can't spring back)
        if (G[i] < 0.12 && world.subsided[i] < 1.5) { const s = 0.0015 * (0.12 - G[i]) / 0.12; H[i] -= s; world.subsided[i] += s; }
        if (d2 <= 9) { level += G[i]; lc++; }
      }
      t.groundwater = lc ? level / lc : 1;
      t.wellsDry = t.groundwater < 0.15;
    }
  } else if (world.towns) {
    // (no pumping: the towns' wells still read the water table as it refills)
    for (const t of world.towns) {
      let level = 0, lc = 0;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) { const x = t.x + dx, z = t.z + dz; if (x >= 0 && z >= 0 && x < N && z < N) { level += G[z * N + x]; lc++; } }
      t.groundwater = lc ? level / lc : 1;
      t.wellsDry = t.groundwater < 0.15;
    }
  }
  world.dirty = true;
}

/** Share of the land's natural groundwater that is there now (0…1), for the graphs. */
export function groundwaterShare(world) {
  if (!world.groundwater) return 1;
  const G = world.groundwater, NAT = world.gwNatural, H = world.height, sea = seaOf(world);
  let a = 0, b = 0;
  for (let i = 0; i < G.length; i += 5) if (H[i] >= sea) { a += G[i]; b += NAT[i]; }
  return b > 0 ? a / b : 1;
}
