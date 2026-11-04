// Particle ("droplet") hydraulic erosion.
//
// Each droplet is a raindrop that lands somewhere, rolls downhill, and keeps a little load of
// sediment. Its carrying capacity grows with speed, slope and water volume:
//
//     capacity = max(slope, minSlope) * speed * water * capacityFactor
//
// If it carries less than its capacity it picks up (erodes) ground; if it carries more (because it
// slowed down on flatter ground or fell into a pit) it drops (deposits) the excess. Thousands of
// droplets together carve gullies and valleys and build up alluvial fans at their mouths.
// This is a long-time-scale model: one droplet stands in for many years of rain.

import { mulberry32 } from '../core/noise.js';

export const dropletParams = {
  inertia: 0.05,        // how much a droplet keeps its direction instead of following the slope
  capacity: 4,          // sediment capacity multiplier
  minSlope: 0.01,       // stops capacity reaching zero on flat ground
  erodeRate: 0.25,
  depositRate: 0.3,
  evaporate: 0.015,
  gravity: 4,
  maxLifetime: 64,
  radius: 3,            // erosion brush radius in cells (spreads the pick-up and avoids spiky pits)
};

let rand = mulberry32(12345);
const brushCache = new Map();

function erosionBrush(radius) {
  if (brushCache.has(radius)) return brushCache.get(radius);
  const offsets = [], weights = [];
  let sum = 0;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < radius) {
        const w = 1 - d / radius;
        offsets.push(dx, dz);
        weights.push(w);
        sum += w;
      }
    }
  }
  const b = { offsets, weights: weights.map((w) => w / sum) };
  brushCache.set(radius, b);
  return b;
}

/**
 * Simulate `count` droplets. If `region` is given ({x, z, r}) droplets spawn only inside that circle.
 * @param {import('../core/world.js').World} world
 */
export function runDroplets(world, count, region = null, strength = 1) {
  const N = world.N;
  const H = world.height;
  const p = dropletParams;
  const brush = erosionBrush(p.radius);

  for (let n = 0; n < count; n++) {
    let x, z;
    if (region) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * region.r;
      x = region.x + Math.cos(a) * d;
      z = region.z + Math.sin(a) * d;
    } else {
      x = rand() * (N - 2);
      z = rand() * (N - 2);
    }
    let dirX = 0, dirZ = 0, speed = 1, water = 1, sediment = 0;
    let lastX = -1, lastZ = -1;

    for (let life = 0; life < p.maxLifetime; life++) {
      const cx = x | 0, cz = z | 0;
      if (cx < 1 || cz < 1 || cx >= N - 2 || cz >= N - 2) break;
      const fx = x - cx, fz = z - cz;
      lastX = x; lastZ = z;

      const { h, gx, gz } = heightAndGradient(H, N, x, z);

      // Steer: blend previous direction with the downhill direction
      dirX = dirX * p.inertia - gx * (1 - p.inertia);
      dirZ = dirZ * p.inertia - gz * (1 - p.inertia);
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
      if (len < 1e-6) break;
      dirX /= len; dirZ /= len;
      x += dirX; z += dirZ;

      if (x < 1 || z < 1 || x >= N - 2 || z >= N - 2) { sediment = 0; break; } // carried off the map

      const newH = heightAndGradient(H, N, x, z).h;
      const dh = newH - h;

      // Droplets entering the sea stop and dump their load (deltas form at river mouths)
      if (newH < world.seaLevel) { deposit(H, N, cx, cz, fx, fz, sediment); sediment = 0; break; }

      const cap = Math.max(-dh, p.minSlope) * speed * water * p.capacity;

      if (sediment > cap || dh > 0) {
        // Uphill: fill the pit we're in (but not above the next cell). Otherwise drop the excess.
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * p.depositRate;
        sediment -= amount;
        deposit(H, N, cx, cz, fx, fz, amount);
      } else {
        const soft = world.erodibilityAt(h, cz * N + cx);
        const amount = Math.min((cap - sediment) * p.erodeRate * soft * strength, -dh);
        for (let k = 0, b = 0; k < brush.weights.length; k++, b += 2) {
          const bx = cx + brush.offsets[b], bz = cz + brush.offsets[b + 1];
          if (bx < 0 || bz < 0 || bx >= N || bz >= N) continue;
          const i = bz * N + bx;
          const take = Math.min(H[i], amount * brush.weights[k]);
          H[i] -= take;
          sediment += take;
        }
      }

      speed = Math.sqrt(Math.max(0, speed * speed - dh * p.gravity));
      water *= 1 - p.evaporate;
    }
    // A droplet that evaporates or stalls drops whatever it is still carrying
    if (sediment > 0 && lastX >= 1) {
      const cx = lastX | 0, cz = lastZ | 0;
      deposit(H, N, cx, cz, lastX - cx, lastZ - cz, sediment);
    }
  }
  world.dirty = true;
}

/** Spread an amount of sediment over the 4 cells around a fractional position (bilinear). */
function deposit(H, N, cx, cz, fx, fz, amount) {
  const i = cz * N + cx;
  H[i] += amount * (1 - fx) * (1 - fz);
  H[i + 1] += amount * fx * (1 - fz);
  H[i + N] += amount * (1 - fx) * fz;
  H[i + N + 1] += amount * fx * fz;
}

function heightAndGradient(H, N, x, z) {
  const cx = x | 0, cz = z | 0;
  const fx = x - cx, fz = z - cz;
  const i = cz * N + cx;
  const nw = H[i], ne = H[i + 1], sw = H[i + N], se = H[i + N + 1];
  return {
    h: nw * (1 - fx) * (1 - fz) + ne * fx * (1 - fz) + sw * (1 - fx) * fz + se * fx * fz,
    gx: (ne - nw) * (1 - fz) + (se - sw) * fz,
    gz: (sw - nw) * (1 - fx) + (se - ne) * fx,
  };
}
