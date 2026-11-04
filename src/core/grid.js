// Small helpers for N×N grids stored as flat Float32Arrays.

/** Separable box blur with radius r (edges average the cells that exist). Returns a new array. */
export function boxBlur(src, N, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  // Sliding-window sums: cost doesn't grow with r
  for (let z = 0; z < N; z++) {
    const row = z * N;
    let s = 0, c = 0;
    for (let k = 0; k <= Math.min(N - 1, r); k++) { s += src[row + k]; c++; }
    for (let x = 0; x < N; x++) {
      tmp[row + x] = s / c;
      const add = x + r + 1, rem = x - r;
      if (add < N) { s += src[row + add]; c++; }
      if (rem >= 0) { s -= src[row + rem]; c--; }
    }
  }
  for (let x = 0; x < N; x++) {
    let s = 0, c = 0;
    for (let k = 0; k <= Math.min(N - 1, r); k++) { s += tmp[k * N + x]; c++; }
    for (let z = 0; z < N; z++) {
      out[z * N + x] = s / c;
      const add = z + r + 1, rem = z - r;
      if (add < N) { s += tmp[add * N + x]; c++; }
      if (rem >= 0) { s -= tmp[rem * N + x]; c--; }
    }
  }
  return out;
}

/**
 * Breach depressions instead of filling them: from the bottom of every closed basin, carve a
 * channel downhill along the priority-flood drainage tree until it reaches lower ground. Paths
 * from neighbouring basins join the same tree, so the carved channels merge into a branching
 * (dendritic) network that drains to the map edge. Modifies `H` in place.
 */
export function breachDepressions(H, N, eps = 0.02) {
  const n = N * N;
  const done = new Uint8Array(n);
  const parent = new Int32Array(n).fill(-1);
  const spill = new Float32Array(H);
  const heap = new MinHeap(n);
  for (let k = 0; k < N; k++) {
    for (const i of [k, (N - 1) * N + k, k * N, k * N + N - 1]) {
      if (!done[i]) { done[i] = 1; heap.push(i, H[i]); }
    }
  }
  while (heap.size) {
    const i = heap.pop();
    const x = i % N, z = (i / N) | 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if ((dx === 0 && dz === 0) || nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (done[j]) continue;
        done[j] = 1;
        parent[j] = i;
        spill[j] = Math.max(H[j], spill[i]);
        heap.push(j, spill[j]);
      }
    }
  }
  // Basin floors: cells sitting below their spill level that are local minima
  const pits = [];
  for (let i = 0; i < n; i++) {
    if (spill[i] - H[i] < 1e-4) continue;
    const x = i % N, z = (i / N) | 0;
    let isMin = true;
    for (let dz = -1; dz <= 1 && isMin; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N || (dx === 0 && dz === 0)) continue;
      if (H[nz * N + nx] < H[i]) { isMin = false; break; }
    }
    if (isMin) pits.push(i);
  }
  pits.sort((a, b) => H[a] - H[b]);
  for (const pit of pits) {
    let level = H[pit];
    for (let c = parent[pit]; c !== -1; c = parent[c]) {
      level -= eps;
      if (H[c] <= level) break; // reached ground that already drains
      H[c] = level;
    }
  }
}

/**
 * Carve a dendritic river network. Every cell drains to its steepest-downhill neighbour (D8);
 * the area draining through each cell is summed from the ridges down. Where that drainage area
 * passes `threshold` cells a channel is cut, deeper for bigger rivers (depth grows with the log of
 * drainage area), so small tributaries feed into ever-deeper trunk streams. Run after
 * breachDepressions so every cell has somewhere to drain. Modifies `H` in place.
 */
export function carveRivers(H, N, { threshold = 150, depth = 1.5, perDoubling = 0.9, maxDepth = 7 } = {}) {
  const n = N * N;
  const receiver = new Int32Array(n).fill(-1);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      let best = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if ((dx === 0 && dz === 0) || nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        const drop = (H[i] - H[j]) / (dx && dz ? Math.SQRT2 : 1);
        if (drop > best) { best = drop; receiver[i] = j; }
      }
    }
  }
  // Accumulate drainage area from the highest cells down
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => H[b] - H[a]);
  const area = new Float32Array(n).fill(1);
  for (const i of order) if (receiver[i] >= 0) area[receiver[i]] += area[i];

  const cut = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (area[i] >= threshold) cut[i] = Math.min(maxDepth, depth + perDoubling * Math.log2(area[i] / threshold));
  }
  // Give channels some width: a soft V across ~3 cells
  const soft = boxBlur(cut, N, 1);
  for (let i = 0; i < n; i++) H[i] -= Math.max(soft[i], cut[i] * 0.8);
}

class MinHeap {
  constructor(cap) { this.idx = new Int32Array(cap); this.key = new Float32Array(cap); this.size = 0; }
  push(i, k) {
    let p = this.size++;
    while (p > 0) {
      const parent = (p - 1) >> 1;
      if (this.key[parent] <= k) break;
      this.idx[p] = this.idx[parent]; this.key[p] = this.key[parent];
      p = parent;
    }
    this.idx[p] = i; this.key[p] = k;
  }
  pop() {
    const top = this.idx[0];
    const lastI = this.idx[--this.size], lastK = this.key[this.size];
    let p = 0;
    for (;;) {
      let c = 2 * p + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.key[c + 1] < this.key[c]) c++;
      if (this.key[c] >= lastK) break;
      this.idx[p] = this.idx[c]; this.key[p] = this.key[c];
      p = c;
    }
    this.idx[p] = lastI; this.key[p] = lastK;
    return top;
  }
}
