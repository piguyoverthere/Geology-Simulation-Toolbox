// Wildfire history: every fire is tracked as one event, numbered in order (#1, #2, …) and grouped
// from its first spark to when the last of it goes out: a cell that catches from a neighbour burnt
// by a fire still going joins that fire; a spark with no such neighbour starts a new one. Small
// fires stay just a number; a fire that grows large enough is given a name, like real wildfires,
// after the nearest town or the lie of the land where it started ("Bear Ridge Fire").
//
// world.fireScar (Uint16) is the number of the last fire to burn each cell; world.fireLog holds the
// fires ({ id, name, year, endYear, cells, sx, sz, x, z, active, last }). Shown in the *Historic
// wildfires* overlay, with labels on the named fires, and listed under Climate → Wildfire.

import { seasonParams } from './climate.js';

/** Cells a fire must burn before it is given a name. */
export const NAME_AT = 150;
const QUIET = 40; // fire steps with nothing burning before a fire counts as out
const KEEP_SMALL = 300; // unnamed fires kept in the log (named ones are kept for good)

const WORDS = ['Bear', 'Elk', 'Cedar', 'Pine', 'Eagle', 'Wolf', 'Copper', 'Lost', 'Dry', 'Thunder', 'Hawk', 'Aspen', 'Juniper', 'Coyote', 'Granite', 'Red', 'Black', 'Smoke', 'Owl', 'Deer', 'Fox', 'Bald', 'Sheep', 'Raven', 'Antelope', 'Willow', 'Sage', 'Bighorn', 'Cougar', 'Badger'];

function ensure(world) {
  const n = world.N * world.N;
  if (!world.fireScar || world.fireScar.length !== n) world.fireScar = new Uint16Array(n);
  if (!world.fireLog) world.fireLog = [];
  if (world.fireCount === undefined) world.fireCount = world.fireLog.reduce((m, f) => Math.max(m, f.id), 0);
}

/** The record of fire `id`, if it is still in the log. */
export function fireById(world, id) {
  if (!id || !world.fireLog) return null;
  if (!world._fireIndex || world._fireIndexN !== world.fireLog.length) {
    world._fireIndex = new Map(world.fireLog.map((f) => [f.id, f]));
    world._fireIndexN = world.fireLog.length;
  }
  return world._fireIndex.get(id) || null;
}

/** A name for a big fire: after a town close by, else after the land where it started. */
function nameFire(world, f) {
  const N = world.N, H = world.height;
  const used = new Set(world.fireLog.filter((g) => g.name).map((g) => g.name));
  let near = null, nd = 40;
  for (const t of world.towns || []) { const d = Math.hypot(t.x - f.x, t.z - f.z); if (d < nd) { nd = d; near = t; } }
  const i = f.z * N + f.x;
  const sea = world.meanSea > -999 ? world.meanSea : -1e9;
  let hi = 0, lo = 1e9;
  for (const h of H) { if (h > hi) hi = h; if (h < lo) lo = h; }
  const rel = (H[i] - Math.max(lo, sea)) / Math.max(1, hi - Math.max(lo, sea));
  const wet = world.nearWater ? world.nearWater[i] : 0;
  const feature = wet > 0.5 ? 'Creek' : rel > 0.65 ? 'Peak' : rel > 0.4 ? 'Ridge' : rel > 0.2 ? 'Canyon' : (world.vegetation[i] > 0.66 ? 'Woods' : 'Flats');
  const pick = (k) => WORDS[(f.id * 7 + k * 13) % WORDS.length];
  const candidates = [];
  if (near) candidates.push(`${near.name} Fire`);
  for (let k = 0; k < 6; k++) candidates.push(`${pick(k)} ${feature} Fire`);
  for (const c of candidates) if (!used.has(c)) return c;
  return `${candidates[0].replace(/ Fire$/, '')} Fire ${f.id}`;
}

/** After each fire step: assign newly burning cells to fires, name the big ones, close finished ones. */
export function trackFires(world) {
  const cells = world.fireCells;
  ensure(world);
  const N = world.N, F = world.fire, SC = world.fireScar;
  world.fireTick = (world.fireTick || 0) + 1;
  const tick = world.fireTick;
  const isActive = (id) => { const f = id && fireById(world, id); return f && f.active ? f : null; };
  if (cells && cells.length) {
    const TEMP = 65535;
    for (const i of cells) {
      if (!(F[i] > 0)) continue;
      const own = isActive(SC[i]);
      if (own) { own.last = tick; continue; }
      // A newly burning patch: gather it, and look for a fire still going right next to it
      const group = [i];
      SC[i] = TEMP;
      let found = null;
      for (let k = 0; k < group.length; k++) {
        const j = group[k], x = j % N, z = (j / N) | 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const m = nz * N + nx;
          if (SC[m] === TEMP) continue;
          if (F[m] > 0 && !isActive(SC[m])) { SC[m] = TEMP; group.push(m); continue; }
          if (!found) found = isActive(SC[m]);
        }
      }
      // (or embers blown ahead of a fire still going: spot fires belong to the fire that threw them)
      if (!found && world.fireLog.some((g) => g.active)) {
        const x0 = i % N, z0 = (i / N) | 0;
        let bd = 1e9;
        for (let dz = -MERGE_GAP; dz <= MERGE_GAP; dz++) for (let dx = -MERGE_GAP; dx <= MERGE_GAP; dx++) {
          const nx = x0 + dx, nz = z0 + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const m = nz * N + nx, d = dx * dx + dz * dz;
          if (d < bd && SC[m] !== TEMP && F[m] > 0) { const g = isActive(SC[m]); if (g) { found = g; bd = d; } }
        }
      }
      let f = found;
      if (!f) {
        world.fireCount++;
        f = { id: world.fireCount, name: null, year: seasonParams.year || 1, endYear: null, cells: 0, sx: 0, sz: 0, x: i % N, z: (i / N) | 0, active: true, last: tick };
        world.fireLog.push(f);
      }
      for (const j of group) { SC[j] = f.id; f.cells++; f.sx += j % N; f.sz += (j / N) | 0; }
      f.last = tick;
      if (!f.name && f.cells >= NAME_AT) f.name = nameFire(world, f);
    }
  }
  // Fires that have gone quiet are out
  let pruned = false;
  for (const f of world.fireLog) if (f.active && tick - f.last > QUIET) { f.active = false; f.endYear = seasonParams.year || 1; pruned = true; }
  // Fires close together at the same time are one fire (also tidies up logs from before merging)
  if (pruned || !world.firesMerged || tick % 200 === 0) { mergeFires(world); world.firesMerged = true; }
  if (pruned && world.fireLog.length > KEEP_SMALL + 50) {
    const small = world.fireLog.filter((f) => !f.name && !f.active);
    const drop = new Set(small.slice(0, small.length - KEEP_SMALL).map((f) => f.id));
    world.fireLog = world.fireLog.filter((f) => !drop.has(f.id));
  }
}

/** How far apart (cells, edge to edge) two fires burning in the same or the next year can be and still count as one. */
export const MERGE_GAP = 15;

/**
 * Merge fires that burnt close together at about the same time (their years overlapping or a year
 * apart, their burnt areas within MERGE_GAP cells): a fire season's outbreaks in one stretch of
 * country, its spot fires and flare-ups, are one fire. The merged fire keeps the number and name of
 * the biggest of them, and is named if together they are big enough.
 */
export function mergeFires(world) {
  ensure(world);
  const log = world.fireLog;
  if (log.length < 2) return;
  const now = seasonParams.year || 1;
  const remap = new Map();
  let merged = true;
  while (merged) {
    merged = false;
    log.sort((a, b) => b.cells - a.cells);
    for (let a = 0; a < log.length; a++) {
      const A = log[a];
      if (!A.cells) continue;
      const ax = A.sx / A.cells, az = A.sz / A.cells, ra = Math.sqrt(A.cells / Math.PI), aEnd = A.active ? now : A.endYear ?? now;
      for (let b = a + 1; b < log.length; b++) {
        const B = log[b];
        if (!B.cells) continue;
        const bEnd = B.active ? now : B.endYear ?? now;
        if (A.year > bEnd + 1 || B.year > aEnd + 1) continue;
        const gap = Math.hypot(B.sx / B.cells - ax, B.sz / B.cells - az) - ra - Math.sqrt(B.cells / Math.PI);
        if (gap > MERGE_GAP) continue;
        // B joins A (the bigger)
        A.cells += B.cells; A.sx += B.sx; A.sz += B.sz;
        A.year = Math.min(A.year, B.year);
        A.active = A.active || B.active; A.last = Math.max(A.last || 0, B.last || 0);
        A.endYear = A.active ? null : Math.max(A.endYear ?? 0, B.endYear ?? 0) || null;
        if (!A.name && B.name) A.name = B.name;
        remap.set(B.id, A.id);
        for (const [k, v] of remap) if (v === B.id) remap.set(k, A.id);
        log.splice(b, 1); b--;
        merged = true;
      }
      if (!A.name && A.cells >= NAME_AT) A.name = nameFire(world, { ...A, x: Math.round(A.sx / A.cells), z: Math.round(A.sz / A.cells) });
    }
  }
  log.sort((a, b) => a.id - b.id);
  if (remap.size) {
    const SC = world.fireScar;
    for (let i = 0; i < SC.length; i++) { const r = SC[i] && remap.get(SC[i]); if (r) SC[i] = r; }
    world._fireIndex = null;
    world.dirty = true;
  }
}

/** Colour for fire `id` on the Historic wildfires overlay. */
export function fireColor(world, id, out) {
  const f = fireById(world, id);
  if (!f) { out[0] = 0.62; out[1] = 0.58; out[2] = 0.54; return out; } // (an old small fire, forgotten)
  if (f.active) { out[0] = 1.0; out[1] = 0.35; out[2] = 0.08; return out; }
  if (!f.name) { out[0] = 0.66; out[1] = 0.58; out[2] = 0.50; return out; }
  // Named fires: each its own hue
  const h = (f.id * 0.618034) % 1, s = 0.65, l = 0.5;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const ch = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  out[0] = ch(h + 1 / 3); out[1] = ch(h); out[2] = ch(h - 1 / 3);
  return out;
}
