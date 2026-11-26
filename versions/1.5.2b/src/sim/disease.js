// Tree diseases: introduced pathogens (blights, rusts, root rots) that each attack only certain
// native trees. None is here to begin with; they arrive only when introduced with the Tree disease
// brush. Each cell carries at most one disease (world.treeDisease: 0 none, else its id) and how
// heavily it is infected (world.diseaseLoad, 0…1).
//
// A disease is worst on young trees: seedlings and saplings of its hosts are killed outright or
// stunted (they stop maturing), so an infected stand loses its young growth and its forest health
// falls; now and then it kills a whole clump of trees, old ones too. It spreads from tree to tree to
// neighbouring cells where its hosts grow, and jumps on the wind (spores) or with animals, people and
// timber, mostly a few cells but sometimes clear across the map. Roads carry it too: traffic past an
// infected stand picks it up on wheels, boots and logs and carries it along the road network, and it
// gets into the host trees beside the road far from where it started. Footpaths carry it the same
// way on hikers' boots (fewer feet, so it fades sooner along them), with Trails spread on. Outbreaks don't last: the trees that
// survive an outbreak are the resistant ones (world.diseaseResist builds up while a cell is infected),
// so the infection burns out behind its spreading front, and patches clear up on their own in a good
// year. Resistance fades again over the years, so a disease can come back in waves. Where its hosts
// are gone it dies out.

import { SPECIES, SPECIES_INDEX, treeShares } from './species.js';
import { climateParams } from './climate.js';
import { civParams } from './civilization.js';

export const DISEASES = [
  { id: 1, label: 'Pine blister rust', hosts: ['pine', 'shorepine'], color: [0.95, 0.60, 0.10],
    help: 'A rust fungus of pines (like white pine blister rust): cankers girdle young pines and kill them; older pines lose branches but mostly survive.' },
  { id: 2, label: 'Sudden oak death', hosts: ['oak', 'beech', 'maple', 'larch'], color: [0.80, 0.20, 0.15],
    help: 'A water mould (Phytophthora) that bleeds cankers into oak, beech, maple and larch: kills saplings fast and stunts young stands.' },
  { id: 3, label: 'Alder root rot', hosts: ['alder'], color: [0.20, 0.55, 0.85],
    help: 'A water-borne root rot of alder and willow, spread along wet ground: the young streamside trees die back.' },
  { id: 4, label: 'Needle blight', hosts: ['spruce', 'fir', 'sitka'], color: [0.55, 0.30, 0.75],
    help: 'A fungal blight that browns and strips the needles of spruce, fir and Sitka spruce: young trees are killed or stunted.' },
  { id: 5, label: 'Birch & aspen canker', hosts: ['birch', 'aspen'], color: [0.90, 0.85, 0.30],
    help: 'A canker disease of the pioneer broadleaves: it kills the young birch and aspen that fill clearings and burnt ground.' },
  { id: 6, label: 'Cedar leaf blight', hosts: ['cedar'], color: [0.30, 0.75, 0.55],
    help: 'A leaf blight of wetland cedar: deadly to seedlings and saplings in the damp shade, so old cedar swamps stop regenerating.' },
];
export const DISEASE_BY_ID = Object.fromEntries(DISEASES.map((d) => [d.id, d]));
const HOSTS = DISEASES.map((d) => d.hosts.map((h) => SPECIES_INDEX[h]));
const shares = new Float32Array(SPECIES.length);
let memo = null;

/** Share of the trees at cell i that disease `id` can infect (0…1). */
export function hostShare(world, i, id) {
  if (world.vegetation[i] < 0.45) return 0;
  if (world.landUse && world.landUse[i] && world.landUse[i] !== 10) return 0; // (fields, towns…)
  treeShares(world, i, shares);
  let h = 0;
  for (const k of HOSTS[id - 1]) h += shares[k];
  // (the invasive pine is no host to any of them)
  if (world.invasive) h *= 1 - world.invasive[i];
  return h;
}

/** How badly the hosts at cell i suffer: young trees much worse than old. */
function youth(world, i) { const a = 1 - world.forestAge[i]; return Math.max(0.08, Math.min(1, 1.4 * a * Math.sqrt(a))); }

function ensure(world) {
  const n = world.N * world.N;
  if (!world.treeDisease || world.treeDisease.length !== n) { world.treeDisease = new Uint8Array(n); world.diseaseLoad = new Float32Array(n); }
  if (!world.diseaseResist || world.diseaseResist.length !== n) world.diseaseResist = new Float32Array(n);
}

/** A place for a spore to land, `r` cells from (x, z) mostly downwind. */
function jumpTarget(N, x, z, wa, r) {
  const a = Math.random() < 0.65 ? wa + (Math.random() - 0.5) * 1.2 : Math.random() * Math.PI * 2;
  const jx = Math.round(x + Math.cos(a) * r), jz = Math.round(z + Math.sin(a) * r);
  return jx >= 0 && jz >= 0 && jx < N && jz < N ? jz * N + jx : -1;
}

/** Introduce disease `id` at cell i (brush), where its hosts grow. Returns true if it took. */
export function infect(world, i, id, amount) {
  ensure(world);
  const D = world.treeDisease, L = world.diseaseLoad;
  if (D[i] && D[i] !== id && L[i] > 0.1) return false;
  if (hostShare(world, i, id) < 0.03) return false;
  if (D[i] !== id) { D[i] = id; L[i] = 0; }
  L[i] = Math.min(1, L[i] + amount);
  return true;
}

/** Cure cell i (brush, Shift). */
export function cure(world, i, k) {
  if (!world.treeDisease) return;
  const L = world.diseaseLoad;
  L[i] *= 1 - k;
  if (L[i] < 0.02) { L[i] = 0; world.treeDisease[i] = 0; }
}

/** One step of every disease on the map. */
export function diseaseStep(world) {
  if (!world.treeDisease) return;
  ensure(world);
  const N = world.N, n = N * N, D = world.treeDisease, L = world.diseaseLoad, R = world.diseaseResist;
  const V = world.vegetation, A = world.forestAge, FH = world.forestHealth, TD = world.treeDensity, DW = world.deadWood;
  const active = [];
  for (let i = 0; i < n; i++) {
    if (D[i]) active.push(i);
    else if (R[i] > 0) R[i] = R[i] < 0.005 ? 0 : R[i] * 0.997; // (resistance fades over the years)
  }
  if (!active.length) return;
  // (host shares change slowly: each cell's is remembered for a few steps)
  if (!memo || memo.h.length !== n) memo = { h: new Float32Array(n), id: new Uint8Array(n), at: new Int32Array(n).fill(-99), step: 0 };
  const step = ++memo.step;
  const host = (i, id) => {
    if (memo.id[i] !== id || step - memo.at[i] > 6) { memo.h[i] = hostShare(world, i, id); memo.id[i] = id; memo.at[i] = step + ((i * 7) % 3); }
    return memo.h[i];
  };
  const seed = (j, id) => { D[j] = id; L[j] = 0.05; };
  const counts = new Array(DISEASES.length + 1).fill(0);
  const wa = ((climateParams.windAngle || 0) * Math.PI) / 180;
  for (const i of active) {
    const id = D[i];
    const h = host(i, id);
    let l = L[i];
    if (h < 0.03) { l *= 0.8; } // (no hosts left: it dies out)
    else {
      const y = youth(world, i), r = R[i];
      // Builds up on susceptible trees; the survivors are resistant, so it burns out behind the front
      l += 0.12 * h * y * (1 - l) * (1 - r) - (0.004 + 0.05 * r * r) * l;
      R[i] = Math.min(1, r + 0.002 + 0.004 * l);
      if (Math.random() < 0.0015) l *= 0.25; // (a patch clears up on its own: a dry spell, a good year)
      // Damage, mostly to the young trees: some killed outright, the rest stunted
      const e = l * h * y;
      // (dying saplings thin the cover; under an old canopy that hardly opens it)
      if (V[i] > (A[i] > 0.6 ? 0.68 : 0.35)) V[i] -= 0.006 * e;
      if (DW) DW[i] = Math.min(1, DW[i] + 0.006 * e);            // (and stand dead)
      if (FH) FH[i] = Math.max(0, FH[i] - 0.02 * e);             // (no young trees coming through)
      if (TD) TD[i] = Math.max(0, TD[i] - 0.004 * e);
      if (A[i] < 0.6) A[i] = Math.max(0, A[i] - 0.0012 * e);     // (stunted: a young stand stops maturing)
      // Now and then a whole clump of host trees dies, old ones too
      // (rarely among old trees, which mostly survive it)
      if (Math.random() < 0.04 * l * h * (0.1 + y)) {
        const k = h * (0.5 + 0.5 * Math.random());
        V[i] = Math.max(0.25, V[i] - 0.1 * k);
        if (TD) TD[i] = Math.max(0, TD[i] - 0.1 * k);
        if (DW) DW[i] = Math.min(1, DW[i] + 0.12 * k);
        if (FH) FH[i] = Math.max(0, FH[i] - 0.1 * k);
        A[i] = Math.max(0, A[i] - 0.04 * k);                       // (the gap fills with young trees)
      }
      // Spread to the neighbours where its hosts grow (more readily downwind)
      const x = i % N, z = (i / N) | 0;
      for (let d = 0; d < 8; d++) {
        const dx = [1, -1, 0, 0, 1, 1, -1, -1][d], dz = [0, 0, 1, -1, 1, -1, 1, -1][d];
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (D[j] === id) continue;
        if (D[j] && L[j] > 0.1) continue; // (another disease already holds it)
        const down = 1 + 0.8 * (dx * Math.cos(wa) + dz * Math.sin(wa)) / Math.hypot(dx, dz);
        if (Math.random() > 0.05 * l * down * (1 - R[j])) continue;
        const hj = host(j, id);
        if (hj < 0.03 || Math.random() > hj * 2) continue;
        seed(j, id);
      }
      // Jumps (spores on the wind, carried on animals, boots and timber): mostly a few cells, now and
      // then far across the map
      if (l > 0.2 && Math.random() < 0.012 * l) {
        const u = Math.random();
        const dist = u < 0.9 ? 4 + u * u * 40 : 30 + Math.random() * N * 0.6;
        const j = jumpTarget(N, x, z, wa, dist);
        if (j >= 0 && !D[j] && Math.random() > R[j] && host(j, id) > 0.08) seed(j, id);
      }
    }
    if (l < 0.01) { D[i] = 0; L[i] = 0; } else { L[i] = l; counts[id]++; }
  }
  roadSpread(world, host, seed);
  world.diseaseCells = counts;
  world.dirty = true;
}

/**
 * Spores carried along the roads: a road beside a heavily infected stand picks the disease up
 * (world.roadDisease: which one, world.roadSpores: how much, fading with distance along the road),
 * and the host trees beside a road carrying it catch it now and then.
 */
function roadSpread(world, host, seed) {
  const LU = world.landUse;
  if (!LU) return;
  const N = world.N, n = N * N, D = world.treeDisease, L = world.diseaseLoad, R = world.diseaseResist;
  if (!world.roadSpores || world.roadSpores.length !== n) { world.roadSpores = new Float32Array(n); world.roadDisease = new Uint8Array(n); }
  const S = world.roadSpores, RD = world.roadDisease;
  const nb = [-1, 1, -N, N];
  const roads = [];
  const FP = civParams.trailsSpread && world.footpath && world.footpath.length === n ? world.footpath : null;
  const way = (i) => LU[i] === 3 || (FP && FP[i] === 1);
  for (let pass = 0; pass < 2; pass++) {
    // (alternate directions so it travels both ways along the road in a step)
    for (let k = 0; k < n; k++) {
      const i = pass ? n - 1 - k : k;
      if (!way(i)) { if (S[i]) { S[i] = 0; RD[i] = 0; } continue; }
      if (!pass) roads.push(i);
      const x = i % N;
      let s = S[i] * (pass ? 1 : 0.97), id = RD[i];
      for (const o of nb) {
        const j = i + o;
        if (j < 0 || j >= n || (o === -1 && x === 0) || (o === 1 && x === N - 1)) continue;
        if (way(j)) { const f = LU[j] === 3 ? 0.96 : 0.95; if (S[j] * f > s) { s = S[j] * f; id = RD[j]; } }
        else if (D[j] && L[j] > 0.3 && L[j] > s) { s = L[j]; id = D[j]; } // (picked up from an infected stand)
      }
      S[i] = s < 0.02 ? 0 : s; RD[i] = S[i] ? id : 0;
    }
  }
  // The host trees beside a spore-carrying road catch it
  for (const i of roads) {
    const s = S[i];
    if (s < 0.1) continue;
    const id = RD[i], x = i % N;
    for (const o of nb) {
      const j = i + o;
      if (j < 0 || j >= n || (o === -1 && x === 0) || (o === 1 && x === N - 1)) continue;
      if (way(j) || D[j] || Math.random() > 0.02 * s * (1 - R[j])) continue;
      if (host(j, id) > 0.05) seed(j, id);
    }
  }
}
