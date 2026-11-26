// Spotlight: hover over a town, park, path, animal, tree species, biome or land use (in the panel,
// the map key, the Biomes & trees window, or a label on the map) and the map shows just that: its
// cells keep their colours and everything else fades to white. Leave it and the map comes back.
//
// Each mask is a Float32Array over the grid: 1 = shown in full, 0 = faded out (in between, partly).

import { classifyBiome } from '../render/biomes.js';
import { SPECIES, SPECIES_INDEX, treeShares } from '../sim/species.js';

/** Light the map up through this mask (null to clear). */
export function spotlight(app, mask) {
  if (!app || !app.renderer || !app.renderer.setSpotlight) return;
  app.renderer.setSpotlight(mask);
}

/** Spotlight while the pointer is over `el`, using the mask `make()` builds then. */
export function spotOnHover(el, app, make) {
  if (!el) return;
  el.addEventListener('mouseenter', () => { try { spotlight(app, make()); } catch (err) { console.warn('Spotlight failed', err); } });
  el.addEventListener('mouseleave', () => spotlight(app, null));
}

function blank(world) { return new Float32Array(world.N * world.N); }

/** Soften a mask's edge a cell or two, so small things show up. */
function grow(world, M, r = 1) {
  const N = world.N, out = M.slice();
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x;
    if (M[i] < 1) continue;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
      const j = zz * N + xx;
      if (out[j] < 0.6) out[j] = 0.6;
    }
  }
  return out;
}

/** A town: its streets, fields, industry, roads and everything else it owns, and its centre. */
export function townMask(world, t) {
  const N = world.N, M = blank(world), OW = world.civOwner;
  if (OW) for (let i = 0; i < M.length; i++) if (OW[i] === t.num) M[i] = 1;
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const x = t.x + dx, z = t.z + dz;
    if (x >= 0 && z >= 0 && x < N && z < N && dx * dx + dz * dz <= 9) M[z * N + x] = 1;
  }
  return M;
}

/** A polygon (a park or a drawn area): the ground inside it. */
export function polygonMask(world, pts) {
  const N = world.N, M = blank(world);
  if (!pts || pts.length < 3) return M;
  let x0 = N, x1 = 0, z0 = N, z1 = 0;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  for (let z = Math.max(0, Math.floor(z0)); z <= Math.min(N - 1, Math.ceil(z1)); z++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(N - 1, Math.ceil(x1)); x++) {
      let o = false;
      for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) if ((pts[a].z > z) !== (pts[b].z > z) && x < ((pts[b].x - pts[a].x) * (z - pts[a].z)) / (pts[b].z - pts[a].z) + pts[a].x) o = !o;
      if (o) M[z * N + x] = 1;
    }
  }
  return M;
}

/** A path (a footpath or a drawn line): the cells along it, a little widened. */
export function pathMask(world, pts) {
  const N = world.N, M = blank(world);
  for (let k = 0; k < (pts || []).length; k++) {
    const a = pts[k], b = pts[k + 1] || a;
    const len = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let s = 0; s <= len; s++) {
      const x = Math.round(a.x + ((b.x - a.x) * s) / len), z = Math.round(a.z + ((b.z - a.z) * s) / len);
      if (x >= 0 && z >= 0 && x < N && z < N) M[z * N + x] = 1;
    }
  }
  return grow(world, M, 1);
}

/** A drawing: inside it if it's a closed area, along it if it's a line. */
export function shapeMask(world, s) { return s.closed ? polygonMask(world, s.points) : pathMask(world, s.points); }

/** An animal: where it lives, brighter the more of them. */
export function animalMask(world, a) {
  const M = blank(world), P = world['animal_' + a.id];
  if (P) for (let i = 0; i < M.length; i++) M[i] = P[i] > 0.01 ? Math.min(1, 0.35 + P[i] * 2) : 0;
  return M;
}

/** A tree species (by id or index): where it grows, brighter the bigger its share of the trees. */
export function speciesMask(world, sp) {
  const k = typeof sp === 'number' ? sp : SPECIES_INDEX[sp];
  const M = blank(world), out = new Float32Array(SPECIES.length + 1), V = world.vegetation;
  if (k === undefined || k < 0) return M;
  for (let i = 0; i < M.length; i++) {
    if (V[i] < 0.35) continue;
    if (world.domSpecies && world.domSpecies[i] === k) { M[i] = 1; continue; }
    treeShares(world, i, out);
    const share = out[k] || 0;
    if (share > 0.05) M[i] = Math.min(1, 0.3 + share * 1.6);
  }
  return M;
}

/** A biome: the cells of that biome. */
export function biomeMask(world, id, noSnow = false) {
  const N = world.N, M = blank(world), H = world.height;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x;
    const gx = (H[x < N - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * 0.5, gz = (H[z < N - 1 ? i + N : i] - H[z > 0 ? i - N : i]) * 0.5;
    if (classifyBiome(world, i, Math.sqrt(gx * gx + gz * gz), noSnow) === id) M[i] = 1;
  }
  return M;
}

/** A land use (a code, or a list of codes, from world.landUse). */
export function landUseMask(world, codes) {
  const set = new Set([].concat(codes)), M = blank(world), LU = world.landUse;
  if (LU) for (let i = 0; i < M.length; i++) if (set.has(LU[i])) M[i] = 1;
  return M;
}
