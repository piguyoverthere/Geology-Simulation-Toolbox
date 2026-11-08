// Landslides.
//
// A slope stands because friction between grains (and roots, and rock strength) resists gravity.
// Water in the ground pushes grains apart (*pore pressure*) and cancels much of that friction, which
// is why most landslides happen during or just after heavy rain, on ground that is already soaked.
// Small failures are handled continuously by thermal erosion (sim/thermal.js), with its stable
// angle lowered as the ground saturates. Large failures are discrete events here: a whole section
// of hillside detaches along a deep failure surface and pours downhill as a debris avalanche,
// stripping plants and soil and spreading into a debris fan. Where relief is large, the failure can
// be a *sector collapse* that takes out an entire mountain flank (Mount St Helens 1980 began this way).

import { waterParams } from './water.js';
import { thermalParams, thermalStep } from './thermal.js';
import { breachDepressions } from '../core/grid.js';

export const landslideParams = {
  enabled: true,
  frequency: 1,        // multiplies how often large slides are triggered
  satWeakening: 0.45,  // how much full saturation lowers the stable slope angle (0.45 = by 45%)
};

/** Ground saturation 0..1 at cell i: soil moisture, standing water and current rainfall. */
export function saturation(world, i) {
  const soil = world.soil ? world.soil[i] : 0.5;
  const s = soil * 0.7 - 0.2 + waterParams.rain * 9 + (world.water[i] > 0.05 ? 0.3 : 0);
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

/** Steepest stable slope (rise/run) at cell i: rock, roots, forest age and water all count. */
export function stableSlope(world, i) {
  const h = world.height[i];
  const base = Math.tan((thermalParams.talusAngle * Math.PI) / 180);
  return base * (0.8 + 0.5 * world.hardnessAt(h, i)) * (1 + 0.3 * world.vegetation[i] + 0.25 * world.forestAge[i])
    * (1 - landslideParams.satWeakening * saturation(world, i));
}

function slopeAt(world, x, z) {
  const N = world.N, H = world.height, i = z * N + x;
  const gx = (H[i + 1] - H[i - 1]) * 0.5, gz = (H[i + N] - H[i - N]) * 0.5;
  return { gx, gz, tan: Math.sqrt(gx * gx + gz * gz) };
}

/**
 * Look for a slope about to fail; with some chance (more in heavy rain) trigger a big landslide
 * there. Call a few times a second.
 */
export function landslideCheck(world, dt) {
  const p = landslideParams;
  if (!p.enabled || !world.erosionEnabled) return;
  const N = world.N, H = world.height;
  let best = null, bestScore = 0;
  for (let k = 0; k < 300; k++) {
    const x = 3 + ((Math.random() * (N - 6)) | 0), z = 3 + ((Math.random() * (N - 6)) | 0);
    const i = z * N + x;
    const { gx, gz, tan } = slopeAt(world, x, z);
    if (tan < 0.3) continue;
    const sat = saturation(world, i);
    const index = tan / stableSlope(world, i);
    // Local relief: how far the ground drops within ~20 cells downslope (bigger relief → bigger slide)
    const len = tan || 1;
    const dx = -gx / len, dz = -gz / len;
    const fx = Math.round(x + dx * 20), fz = Math.round(z + dz * 20);
    const relief = world.inBounds(fx, fz) ? Math.max(0, H[i] - H[fz * N + fx]) : 0;
    const score = index * (0.3 + sat) * (0.6 + relief / 25);
    if (score > bestScore) { bestScore = score; best = { x, z, i, dx, dz, relief, sat, index }; }
  }
  if (!best || bestScore < 1.1 || best.index < 0.85) return;
  // Heavy rain makes failures far more likely; a dry hillside rarely goes
  const chance = p.frequency * dt * (0.02 + waterParams.rain * 12) * best.sat * Math.min(3, bestScore);
  if (Math.random() < chance) triggerLandslide(world, best);
}

/** Detach a section of hillside around `site` and send it downhill as a debris avalanche. */
export function triggerLandslide(world, site) {
  const N = world.N, H = world.height;
  // Tall, soaked slopes sometimes fail as a whole flank (sector collapse)
  const mega = site.relief > 10 && Math.random() < 0.03 + 0.06 * site.sat + site.relief / 300;
  let R = Math.min(42, 4 + site.relief * (0.5 + 0.5 * Math.random()));
  if (mega) R = Math.min(60, R * 1.7);
  const depth = Math.min(site.relief * (mega ? 0.4 : 0.25), R * (mega ? 0.5 : 0.4));
  // The failure zone sits mostly upslope of the trigger point
  const cx = site.x - site.dx * R * 0.35, cz = site.z - site.dz * R * 0.35;
  // Failure surface: a plane dipping downslope at a gentle residual angle through the slide's
  // centre, bowed down into a spoon shape (deepest in the middle). Everything above it goes.
  const Hc = world.sampleHeight(cx, cz);
  const residual = stableSlope(world, site.i) * 0.5;
  const x0 = Math.max(1, Math.floor(cx - R)), x1 = Math.min(N - 2, Math.ceil(cx + R));
  const z0 = Math.max(1, Math.floor(cz - R)), z1 = Math.min(N - 2, Math.ceil(cz + R));
  const bw = x1 - x0 + 1, bh = z1 - z0 + 1;
  let cut = new Float32Array(bw * bh);
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const r = Math.hypot(x - cx, z - cz) / R;
      if (r >= 1) continue;
      const along = (x - cx) * site.dx + (z - cz) * site.dz; // + is downslope
      const surface = Hc - along * residual - depth * (1 - r * r);
      const taper = 1 - smooth01((r - 0.7) / 0.3); // fades to nothing at the rim: no walls
      cut[(z - z0) * bw + (x - x0)] = Math.min(depth * 1.2 * (1 - r * r), Math.max(0, H[z * N + x] - surface)) * taper;
    }
  }
  cut = boxBlur(boxBlur(cut, bw, bh, 1), bw, bh, 1); // soften the scar edges
  let removed = 0;
  const cells = [];
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const c = cut[(z - z0) * bw + (x - x0)];
      if (c <= 0.05) continue;
      const i = z * N + x;
      H[i] -= c;
      removed += c;
      if (c > 0.3) { world.vegetation[i] = 0; world.humus[i] = 0; world.forestAge[i] = 0; }
      world.prevHeight[i] = H[i];
      cells.push(i);
    }
  }
  if (removed < 1 || !cells.length) return null;
  // Debris parcels start from across the scar, moving downslope
  const n = Math.min(60, Math.max(6, Math.round(cells.length / 12)));
  for (let k = 0; k < n; k++) {
    const i = cells[(Math.random() * cells.length) | 0];
    const speed = 6 + Math.random() * 6;
    world.debris.push({
      x: i % N, z: (i / N) | 0, vx: site.dx * speed, vz: site.dz * speed,
      mass: removed / n, age: 0,
    });
  }
  world.quake = Math.min(2.5, world.quake + 0.3 + R / (mega ? 25 : 60));
  world.landslides.push({ x: cx, z: cz, r: R, mega, volume: removed, time: world.time });
  world.slideAreas.push({ x: cx, z: cz, r: R + 35 });
  world.dirty = true;
  return { R, mega, removed };
}

/** Move debris avalanches: they run downhill, slow on gentle ground and pile up as a debris fan. */
export function debrisStep(world, dt) {
  const N = world.N, D = world.debris;
  if (!D.length) return false;
  const settled = [];
  for (let k = D.length - 1; k >= 0; k--) {
    const p = D[k];
    p.age += dt;
    const gx = (world.sampleHeight(p.x + 1, p.z) - world.sampleHeight(p.x - 1, p.z)) * 0.5;
    const gz = (world.sampleHeight(p.x, p.z + 1) - world.sampleHeight(p.x, p.z - 1)) * 0.5;
    p.vx -= gx * 30 * dt; p.vz -= gz * 30 * dt;
    const drag = 1 - 0.9 * dt;     // rock debris is draggier than a pyroclastic flow
    p.vx *= drag; p.vz *= drag;
    p.x += p.vx * dt; p.z += p.vz * dt;
    const speed = Math.hypot(p.vx, p.vz);
    const out = p.x < 1 || p.z < 1 || p.x > N - 2 || p.z > N - 2;
    // Drops more of its load as it slows on flatter ground
    const drop = out ? 0 : Math.min(p.mass, p.mass * dt * (0.25 + 2 / (1 + speed)));
    p.mass -= drop;
    const dead = out || p.mass < 0.05 || p.age > 6 || (speed < 1.2 && p.age > 0.6);
    // Spread each load over an area that grows with its volume, so debris forms a broad fan
    // rather than piling into a tower where several parcels come to rest together
    const load = dead ? drop + p.mass : drop;
    const r = Math.min(18, (dead ? 4 : 2.5) + Math.sqrt(load) * 0.9);
    if (!out) spread(world, p.x, p.z, load, r);
    if (dead) { D.splice(k, 1); if (!out) settled.push({ x: p.x, z: p.z, r: r + 8 }); }
    else if (!out) thermalStep(world, { x: p.x, z: p.z, r: r + 3 }, 1); // slumps as it goes
  }
  // Loose debris can't stand steeper than its angle of repose: slump fresh piles into a fan
  for (const s of settled) for (let k = 0; k < 8; k++) thermalStep(world, s, 1);
  if (!D.length) drainSlideAreas(world);
  world.dirty = true;
  return true;
}

/**
 * Once the debris has stopped, give any hollow left in the scar or behind a debris dam an outlet,
 * so water runs on through instead of filling a staircase of ponds. Only basins in the disturbed
 * area are opened (lakes elsewhere, e.g. ones you dug, are left alone).
 */
function drainSlideAreas(world) {
  const areas = world.slideAreas;
  if (!areas.length) return;
  const N = world.N, keep = world.keepBasin;
  breachDepressions(world.height, N, 0.02, (i) => {
    if (keep && keep(i)) return true;
    const x = i % N, z = (i / N) | 0;
    return !areas.some((a) => (x - a.x) ** 2 + (z - a.z) ** 2 < a.r * a.r);
  });
  world.prevHeight.set(world.height);
  areas.length = 0;
  world.dirty = true;
}

function smooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

/** Box blur of a w×h array (radius r), for smoothing the scar. */
function boxBlur(src, w, h, r) {
  const out = new Float32Array(src.length);
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= w || zz >= h) continue;
        s += src[zz * w + xx]; n++;
      }
      out[z * w + x] = s / n;
    }
  }
  return out;
}

function spread(world, cx, cz, amount, r) {
  if (amount <= 0) return;
  const N = world.N;
  let wsum = 0;
  const cells = [];
  for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(N - 1, Math.ceil(cz + r)); z++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(N - 1, Math.ceil(cx + r)); x++) {
      const f = 1 - Math.hypot(x - cx, z - cz) / r;
      if (f > 0) { cells.push(z * N + x, f); wsum += f; }
    }
  }
  for (let k = 0; k < cells.length; k += 2) {
    const i = cells[k];
    world.height[i] += amount * cells[k + 1] / wsum;
    world.prevHeight[i] = world.height[i];
    // Buried and smashed: plants, soil and forest age go
    world.vegetation[i] *= 0.3; world.humus[i] *= 0.5; world.forestAge[i] = 0;
  }
}
