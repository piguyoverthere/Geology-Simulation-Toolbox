// Small helpers for N×N grids stored as flat Float32Arrays.

/** Separable box blur with radius r (edges use the cells that exist). Returns a new array. */
export function boxBlur(src, N, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(N - 1, x + r); k++) { s += src[z * N + k]; c++; }
      tmp[z * N + x] = s / c;
    }
  }
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, z - r); k <= Math.min(N - 1, z + r); k++) { s += tmp[k * N + x]; c++; }
      out[z * N + x] = s / c;
    }
  }
  return out;
}
