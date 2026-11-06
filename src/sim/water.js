// Shallow-water flow with sediment transport ("virtual pipes" model, Mei, Decaudin & Hu 2007).
//
// Every cell is a column of water connected to its four neighbours by virtual pipes. Water
// accelerates through a pipe in proportion to the difference in water-surface height, so it fills
// lakes, spills over, and gathers into streams. From the outflow we get a velocity per cell.
//
// Moving water can hold an amount of sediment proportional to how fast it flows and how steep the
// bed is (its *transport capacity*). Fast water on steep ground erodes its bed; when it slows down
// (entering a lake, the sea or flat ground) it drops sediment, building deltas and floodplains.
// Sediment is carried along with the velocity field (semi-Lagrangian advection).

export const waterParams = {
  rain: 0,             // global rainfall per second (0 = off)
  dt: 0.03,
  gravity: 9.81,
  capacity: 0.6,       // Kc: sediment capacity constant
  erode: 0.5,          // Ks: dissolving rate
  deposit: 0.2,        // Kd: settling rate
  evaporate: 0.02,     // Ke
  minTilt: 0.02,       // keeps a little erosion going on near-flat river beds
  critSpeed: 0.4,      // flow slower than this can't lift grains off the bed (Hjulström/Shields threshold)
  maxConcentration: 0.3, // most sediment a unit of water depth can carry
  channelDepth: 2,     // flow this deep carries full capacity; shallower sheet flow carries less
  damping: 0.997,      // flux friction per step: calms sloshing in pools without choking river flow
  erosionEnabled: true,
};

let tmpSed = null;
let dBed = null; // this step's erosion (−) and deposition (+), applied smoothed at the end

/** @param {import('../core/world.js').World} world */
export function waterStep(world) {
  const N = world.N;
  const p = waterParams;
  const dt = p.dt;
  const B = world.height, D = world.water, S = world.sediment;
  const fL = world.fluxL, fR = world.fluxR, fT = world.fluxT, fB = world.fluxB;
  const VX = world.velX, VZ = world.velZ;
  const n = N * N;
  if (!tmpSed || tmpSed.length !== n) { tmpSed = new Float32Array(n); dBed = new Float32Array(n); }
  dBed.fill(0);

  // 1. Water sources: rain, springs, and the sea acting as a constant-level reservoir
  if (p.rain > 0) {
    const r = p.rain * dt;
    for (let i = 0; i < n; i++) D[i] += r;
  }
  for (const s of world.sources) {
    const sx = Math.round(s.x), sz = Math.round(s.z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (world.inBounds(sx + dx, sz + dz)) D[(sz + dz) * N + sx + dx] += (s.rate * dt) / 9;
    }
  }
  const sea = world.seaLevel;
  for (let i = 0; i < n; i++) if (B[i] < sea && B[i] + D[i] < sea) D[i] = sea - B[i];

  // 2. Outflow flux through the virtual pipes (pipe cross-section area and length are 1)
  const k = dt * p.gravity;
  const drain = world.edgeDrain;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const hi = B[i] + D[i];
      // Off-map neighbours are either walls (no flow) or a drop to ground level (water leaves)
      const hL = x > 0 ? B[i - 1] + D[i - 1] : (drain ? B[i] : Infinity);
      const hR = x < N - 1 ? B[i + 1] + D[i + 1] : (drain ? B[i] : Infinity);
      const hT = z > 0 ? B[i - N] + D[i - N] : (drain ? B[i] : Infinity);
      const hB = z < N - 1 ? B[i + N] + D[i + N] : (drain ? B[i] : Infinity);
      const damp = p.damping;
      let l = Math.max(0, fL[i] * damp + k * (hi - hL));
      let r = Math.max(0, fR[i] * damp + k * (hi - hR));
      let t = Math.max(0, fT[i] * damp + k * (hi - hT));
      let b = Math.max(0, fB[i] * damp + k * (hi - hB));
      // Never let more water leave than the cell holds
      const out = (l + r + t + b) * dt;
      if (out > D[i] && out > 0) {
        const s = D[i] / out;
        l *= s; r *= s; t *= s; b *= s;
      }
      fL[i] = l; fR[i] = r; fT[i] = t; fB[i] = b;
    }
  }

  // 3. Update water depth and derive velocity
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const inL = x > 0 ? fR[i - 1] : 0;
      const inR = x < N - 1 ? fL[i + 1] : 0;
      const inT = z > 0 ? fB[i - N] : 0;
      const inB = z < N - 1 ? fT[i + N] : 0;
      const before = D[i];
      const after = Math.max(0, before + dt * (inL + inR + inT + inB - fL[i] - fR[i] - fT[i] - fB[i]));
      D[i] = after;
      const avg = (before + after) * 0.5;
      if (avg > 1e-3) {
        VX[i] = clamp((inL - fL[i] + fR[i] - inR) * 0.5 / avg, -10, 10);
        VZ[i] = clamp((inT - fT[i] + fB[i] - inB) * 0.5 / avg, -10, 10);
      } else {
        VX[i] = 0; VZ[i] = 0;
      }
    }
  }

  // 4. Erosion and deposition
  if (p.erosionEnabled && world.erosionEnabled) {
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        const i = z * N + x;
        const d = D[i];
        if (d < 1e-4 && S[i] < 1e-5) continue;
        const gx = (B[i + 1] - B[i - 1]) * 0.5, gz = (B[i + N] - B[i - N]) * 0.5;
        const g2 = gx * gx + gz * gz;
        const sinTilt = Math.max(p.minTilt, Math.sqrt(g2 / (1 + g2)));
        const speed = Math.sqrt(VX[i] * VX[i] + VZ[i] * VZ[i]);
        // Capacity grows with discharge (depth × speed), like stream power: a big trunk river keeps
        // its load moving across gentle ground and cuts down, capturing smaller flows, while a thin
        // sheet of runoff carries little. Still pools stay below critSpeed, so they don't dig pits.
        const depthFactor = Math.min(1, d / p.channelDepth);
        // Never pick up more than the water can actually hold for its depth (otherwise fast, shallow
        // sheets would scour sediment and immediately have to dump it again, building cones)
        const cap = Math.min(p.maxConcentration * d, p.capacity * sinTilt * Math.max(0, speed - p.critSpeed) * depthFactor);
        if (cap > S[i]) {
          const amt = Math.min(p.erode * (cap - S[i]) * dt * world.erodibilityAt(B[i], i), 0.05);
          dBed[i] -= amt;
          S[i] += amt;
        } else {
          const amt = p.deposit * (S[i] - cap) * dt;
          dBed[i] += amt;
          S[i] -= amt;
        }
      }
    }

    // 5. Carry suspended sediment along the flow. Each cell pushes its load downstream and splits
    // it between the (up to 4) cells it lands in, so sediment is exactly conserved locally.
    // Only cells that actually hold water can receive it: handing sediment to a dry neighbour
    // would make it drop the lot there, building the cell up into a spike that stays dry and
    // keeps collecting more.
    tmpSed.fill(0);
    const wet = 0.01;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        const s = S[i];
        if (s <= 0) continue;
        const tx = clamp(x + VX[i] * dt, 0, N - 1.001);
        const tz = clamp(z + VZ[i] * dt, 0, N - 1.001);
        const x0 = tx | 0, z0 = tz | 0, fx = tx - x0, fz = tz - z0;
        const j = z0 * N + x0;
        const w00 = D[j] > wet ? (1 - fx) * (1 - fz) : 0;
        const w10 = D[j + 1] > wet ? fx * (1 - fz) : 0;
        const w01 = D[j + N] > wet ? (1 - fx) * fz : 0;
        const w11 = D[j + N + 1] > wet ? fx * fz : 0;
        const sum = w00 + w10 + w01 + w11;
        if (sum <= 0) { tmpSed[i] += s; continue; } // nowhere wet to go: stays put
        const k = s / sum;
        tmpSed[j] += w00 * k; tmpSed[j + 1] += w10 * k;
        tmpSed[j + N] += w01 * k; tmpSed[j + N + 1] += w11 * k;
      }
    }
    // Sediment that reaches a draining map edge is carried away with the water
    if (drain) {
      for (let k = 0; k < N; k++) {
        tmpSed[k] = 0; tmpSed[n - N + k] = 0; tmpSed[k * N] = 0; tmpSed[k * N + N - 1] = 0;
      }
    }
    // Water can only hold so much sediment for its depth; the rest settles out on the spot
    for (let i = 0; i < n; i++) {
      const maxLoad = p.maxConcentration * D[i] + 0.005;
      if (tmpSed[i] > maxLoad) { dBed[i] += tmpSed[i] - maxLoad; tmpSed[i] = maxLoad; }
      S[i] = tmpSed[i];
    }
  }

  // 6. Evaporation. When a puddle dries up its sediment is left behind on the ground.
  const evap = 1 - p.evaporate * dt;
  world.time += dt;
  const now = world.time, W = world.lastWet;
  if (p.rain > 0) W.fill(now); // rain waters everywhere
  for (let i = 0; i < n; i++) {
    if (D[i] > 0.05) W[i] = now;
    D[i] *= evap;
    if (D[i] < 1e-4) {
      D[i] = 0;
      if (S[i] > 0) { dBed[i] += S[i]; S[i] = 0; }
    }
  }

  // 7. Apply the bed changes, each shared with its 3×3 neighbourhood (40% centre, 10% sides,
  // 5% corners). Real erosion and deposition act over a footprint, not a single grid cell;
  // applying them per cell lets neighbouring cells drift apart into pits and cones.
  applySmoothed(B, dBed, N);

  world.dirty = true;
}

/** Scatter each cell's change over its 3×3 neighbourhood (edge cells keep their own change). */
function applySmoothed(B, dB, N) {
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const v = dB[i];
      if (v === 0) continue;
      if (x === 0 || z === 0 || x === N - 1 || z === N - 1) { B[i] += v; continue; }
      const side = v * 0.1, corner = v * 0.05;
      B[i] += v * 0.4;
      B[i - 1] += side; B[i + 1] += side; B[i - N] += side; B[i + N] += side;
      B[i - N - 1] += corner; B[i - N + 1] += corner; B[i + N - 1] += corner; B[i + N + 1] += corner;
    }
  }
}

/** Add water in a soft circular brush (the Rain tool). */
export function addWater(world, cx, cz, radius, amount) {
  const N = world.N;
  const r2 = radius * radius;
  for (let z = Math.max(0, Math.floor(cz - radius)); z <= Math.min(N - 1, Math.ceil(cz + radius)); z++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(N - 1, Math.ceil(cx + radius)); x++) {
      const d2 = (x - cx) ** 2 + (z - cz) ** 2;
      if (d2 < r2) {
        const i = z * N + x;
        world.water[i] = Math.max(0, world.water[i] + amount * (1 - d2 / r2));
        if (world.water[i] === 0) world.sediment[i] = 0;
      }
    }
  }
  world.dirty = true;
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
