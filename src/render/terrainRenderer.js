import * as THREE from 'three';
import { BIOMES, classifyBiome, DRY_SOIL } from './biomes.js';
import { vegetationParams } from '../sim/vegetation.js';

// Colour palette (linear-ish RGB 0..1)
const C = {
  forest: BIOMES.forest.color,
  grass: BIOMES.grassland.color,
  shrub: BIOMES.shrubland.color,
  desert: BIOMES.desert.color,
  mesa: BIOMES.mesa.color,
  barren: BIOMES.barren.color,
  marsh: BIOMES.wetland.color,
  tundra: BIOMES.tundra.color,
  soil: [0.56, 0.47, 0.34],     // freshly deposited sediment (alluvium)
  sand: [0.80, 0.72, 0.52],
  rockSoft: [0.68, 0.52, 0.40], // soft strata: reddish sandstone/shale
  rockHard: [0.58, 0.55, 0.51], // hard strata: grey caprock
  snow: [0.95, 0.96, 0.98],
  eroded: [0.85, 0.25, 0.20],
  deposited: [0.20, 0.45, 0.90],
  neutral: [0.75, 0.75, 0.72],
};

export const COLOR_MODES = {
  natural: 'Natural',
  biome: 'Biomes',
  change: 'Erosion / deposition',
  hardness: 'Rock hardness',
  slope: 'Slope',
  vegetation: 'Vegetation',
  moisture: 'Soil moisture',
};

/** Builds and updates the terrain + water meshes from a World. */
export class TerrainRenderer {
  /** @param {import('../core/world.js').World} world  @param {THREE.Scene} scene */
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.colorMode = 'natural';
    this.showWater = true;
    this.snowLine = 44;

    const N = world.N;
    this.offset = (N - 1) / 2;

    const index = [];
    for (let z = 0; z < N - 1; z++) {
      for (let x = 0; x < N - 1; x++) {
        const a = z * N + x, b = a + 1, c = a + N, d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const indexAttr = new THREE.Uint32BufferAttribute(index, 1);

    // Terrain
    this.terrainGeo = new THREE.BufferGeometry();
    this.terrainGeo.setIndex(indexAttr);
    this.tPos = new Float32Array(N * N * 3);
    this.tNorm = new Float32Array(N * N * 3);
    this.tCol = new Float32Array(N * N * 3);
    this.terrainGeo.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3));
    this.terrainGeo.setAttribute('normal', new THREE.BufferAttribute(this.tNorm, 3));
    this.terrainGeo.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3));
    for (const a of ['position', 'normal', 'color']) this.terrainGeo.getAttribute(a).setUsage(THREE.DynamicDrawUsage);
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false });
    this.terrain = new THREE.Mesh(this.terrainGeo, this.terrainMat);
    this.terrain.castShadow = true;
    this.terrain.receiveShadow = true;
    scene.add(this.terrain);

    // Water: same grid, vertex alpha fades out shallow water
    this.waterGeo = new THREE.BufferGeometry();
    this.waterGeo.setIndex(indexAttr);
    this.wPos = new Float32Array(N * N * 3);
    this.wCol = new Float32Array(N * N * 4);
    this.waterGeo.setAttribute('position', new THREE.BufferAttribute(this.wPos, 3));
    this.waterGeo.setAttribute('color', new THREE.BufferAttribute(this.wCol, 4));
    this.waterMat = new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, roughness: 0.15, metalness: 0.1, depthWrite: false,
    });
    this.water = new THREE.Mesh(this.waterGeo, this.waterMat);
    this.water.renderOrder = 1;
    scene.add(this.water);

    // Base skirt so the terrain reads as a solid block of rock
    this.skirt = this.buildSkirt();
    scene.add(this.skirt);

    // Springs
    this.springGroup = new THREE.Group();
    scene.add(this.springGroup);
    this.springGeo = new THREE.CylinderGeometry(0.8, 1.4, 3, 10);
    this.springMat = new THREE.MeshStandardMaterial({ color: 0x3fa9ff, emissive: 0x0a3a66 });

    // Heights change every frame, so use fixed generous bounds instead of recomputing them
    const bounds = new THREE.Sphere(new THREE.Vector3(), N * 1.5);
    for (const g of [this.terrainGeo, this.waterGeo, this.skirt.geometry]) g.boundingSphere = bounds;

    this.update(true);
  }

  /** Grid coords -> world-space position */
  toWorld(x, z, y = 0) { return new THREE.Vector3(x - this.offset, y, z - this.offset); }
  /** World-space position -> grid coords */
  toGrid(p) { return { x: p.x + this.offset, z: p.z + this.offset }; }

  buildSkirt() {
    const N = this.world.N;
    const perim = [];
    for (let x = 0; x < N; x++) perim.push([x, 0]);
    for (let z = 1; z < N; z++) perim.push([N - 1, z]);
    for (let x = N - 2; x >= 0; x--) perim.push([x, N - 1]);
    for (let z = N - 2; z >= 0; z--) perim.push([0, z]);
    this.skirtCells = perim;
    const pos = new Float32Array(perim.length * 2 * 3);
    const idx = [];
    for (let k = 0; k < perim.length - 1; k++) {
      const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, c, b, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1, side: THREE.DoubleSide });
    return new THREE.Mesh(geo, mat);
  }

  update(force = false) {
    const w = this.world;
    if (!w.dirty && !force) return;
    w.dirty = false;
    const N = w.N, H = w.height, D = w.water, S = w.sediment, BASE = w.baseline;
    const off = this.offset;
    const mode = this.colorMode;
    const sea = w.seaLevel;

    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x, i3 = i * 3;
        const h = H[i];
        this.tPos[i3] = x - off;
        this.tPos[i3 + 1] = h;
        this.tPos[i3 + 2] = z - off;

        // Normal from central differences
        const hl = H[x > 0 ? i - 1 : i], hr = H[x < N - 1 ? i + 1 : i];
        const hu = H[z > 0 ? i - N : i], hd = H[z < N - 1 ? i + N : i];
        let nx = hl - hr, ny = 2, nz = hu - hd;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= len; ny /= len; nz /= len;
        this.tNorm[i3] = nx; this.tNorm[i3 + 1] = ny; this.tNorm[i3 + 2] = nz;

        const slope = 1 - ny; // 0 = flat, ~0.3 = 45°
        const tan = Math.sqrt((hl - hr) * (hl - hr) + (hu - hd) * (hu - hd)) * 0.5; // rise/run
        let col;
        if (mode === 'change') {
          const d = h - BASE[i];
          const t = Math.min(1, Math.abs(d) / 4);
          col = shade(mix(C.neutral, d < 0 ? C.eroded : C.deposited, t, S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'hardness') {
          const hard = w.hardnessAt(h, i);
          col = mix(C.rockSoft, C.rockHard, hard, S3);
        } else if (mode === 'vegetation') {
          col = shade(vegColor(w.vegetation[i], S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'moisture') {
          const m = w.soil ? w.soil[i] : 0;
          col = shade(mix(DRY, WET, m, S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'biome') {
          col = shade(BIOMES[classifyBiome(w, i, tan, this.snowLine)].color, 0.8 + 0.2 * ny, S3);
        } else if (mode === 'slope') {
          const t = Math.min(1, slope / 0.35);
          col = mix(SLOPE_LO, SLOPE_HI, t, S3);
        } else {
          col = this.naturalColor(h, slope, tan, h - BASE[i], D[i], i);
        }
        // Palette is authored in sRGB; vertex colours are linear, so square to approximate the conversion
        this.tCol[i3] = col[0] * col[0]; this.tCol[i3 + 1] = col[1] * col[1]; this.tCol[i3 + 2] = col[2] * col[2];

        // Water surface: hide (sink below ground) where it is too thin to see
        const d = D[i];
        const i4 = i * 4;
        this.wPos[i3] = x - off;
        this.wPos[i3 + 2] = z - off;
        // Thin runoff films just darken the ground; draw a water surface only where it's a real stream/lake
        if (d > 0.1) {
          this.wPos[i3 + 1] = h + d;
          const mud = Math.min(1, (S[i] / Math.max(d, 0.05)) * 4);
          const deep = Math.min(1, d / 6);
          const isSea = h < sea;
          const base = isSea ? WATER_SEA : mix(WATER_SHALLOW, WATER_DEEP, deep, S4);
          const wc = mix(base, MUD, mud * 0.8, S4);
          this.wCol[i4] = wc[0] * wc[0]; this.wCol[i4 + 1] = wc[1] * wc[1]; this.wCol[i4 + 2] = wc[2] * wc[2];
          this.wCol[i4 + 3] = Math.min(0.85, 0.25 + (d - 0.1) * 0.5);
        } else {
          this.wPos[i3 + 1] = h - 0.3;
          this.wCol[i4 + 3] = 0;
        }
      }
    }

    this.terrainGeo.attributes.position.needsUpdate = true;
    this.terrainGeo.attributes.normal.needsUpdate = true;
    this.terrainGeo.attributes.color.needsUpdate = true;
    this.waterGeo.attributes.position.needsUpdate = true;
    this.waterGeo.attributes.color.needsUpdate = true;
    this.water.visible = this.showWater;

    // Skirt follows terrain edge down to a fixed floor
    let minH = Infinity;
    for (let i = 0; i < H.length; i++) if (H[i] < minH) minH = H[i];
    const floor = Math.min(0, minH) - 6;
    const sp = this.skirt.geometry.attributes.position.array;
    this.skirtCells.forEach(([x, z], k) => {
      const h = H[z * N + x];
      sp.set([x - off, h, z - off, x - off, floor, z - off], k * 6);
    });
    this.skirt.geometry.attributes.position.needsUpdate = true;
    this.skirt.geometry.computeVertexNormals();

    this.syncSprings();
  }

  naturalColor(h, slope, tan, change, water, i) {
    const w = this.world;
    // Writes into scratch arrays: this runs for every vertex every frame, so avoid allocating
    const v = w.vegetation[i];
    const soil = w.soil ? w.soil[i] : 0.5;
    const near = w.nearWater ? w.nearWater[i] : 0;
    const dry = 1 - smooth(DRY_SOIL - 0.1, DRY_SOIL + 0.1, soil);
    const steep = smooth(0.45, 0.8, tan);

    // Bare ground: brown soil, yellow desert sand where dry and flat, banded red mesa rock where dry and steep
    const bare = mix(C.barren, C.desert, dry * (1 - steep), S1);
    const mesa = dry * steep;
    if (mesa > 0) shade(mix(bare, C.mesa, mesa, bare), 1 - 0.14 * mesa * (0.5 + 0.5 * Math.sin(h * 1.7)), bare);
    // Sparse cover: green grass on moist ground, olive scrub as it dries
    const low = mix(C.grass, C.shrub, 1 - smooth(0.32, 0.52, soil), S2);
    const col = v < 0.5 ? mix(bare, low, smooth(0.12, 0.42, v), S3) : mix(low, C.forest, smooth(0.55, 0.8, v), S3);
    // Tundra above the tree line
    const tl = vegetationParams.treeLine;
    if (h > tl) mix(col, C.tundra, smooth(tl, tl + 8, h) * smooth(0.08, 0.3, v) * 0.85, col);
    // Wetlands on flat, waterlogged ground beside rivers and lakes
    const marsh = smooth(0.4, 0.8, near) * smooth(0.65, 0.85, soil) * (1 - smooth(0.15, 0.35, tan)) * smooth(0.3, 0.5, v);
    if (marsh > 0) mix(col, C.marsh, marsh * 0.8, col);

    // Bare rock on cliffs: strata colours, reddened in dry country
    const rock = mix(C.rockSoft, C.rockHard, w.hardnessAt(h, i), S1);
    mix(rock, C.mesa, dry * 0.7, rock);
    mix(col, rock, smooth(0.2, 0.42, slope) * (1 - 0.6 * v), col);
    // Fresh sediment (deposits) shows as bare soil
    if (change > 0.15) mix(col, C.soil, Math.min(0.7, change / 3) * (1 - smooth(0.1, 0.25, slope)) * (1 - v), col);
    // Beaches just above sea level
    if (h > w.seaLevel - 0.3 && h < w.seaLevel + 1.5) mix(col, C.sand, 0.8, col);
    else if (h <= w.seaLevel - 0.3) mix(col, C.soil, 0.6, col); // muddy sea floor
    // Snow on high, gentle ground
    if (h > this.snowLine) mix(col, C.snow, smooth(this.snowLine, this.snowLine + 6, h) * (1 - smooth(0.12, 0.3, slope)), col);
    // Wet ground is darker
    if (water > 0.005) shade(col, 0.88, col);
    return col;
  }

  syncSprings() {
    const g = this.springGroup;
    const src = this.world.sources;
    while (g.children.length > src.length) g.remove(g.children[g.children.length - 1]);
    while (g.children.length < src.length) g.add(new THREE.Mesh(this.springGeo, this.springMat));
    src.forEach((s, k) => {
      const m = g.children[k];
      m.position.copy(this.toWorld(s.x, s.z, this.world.sampleHeight(s.x, s.z) + 1.5));
    });
  }
}

// Scratch colour buffers reused by the per-vertex colour code
const S1 = [0, 0, 0], S2 = [0, 0, 0], S3 = [0, 0, 0], S4 = [0, 0, 0];
const SLOPE_LO = [0.2, 0.7, 0.3], SLOPE_HI = [0.9, 0.2, 0.15];
const DRY = [0.85, 0.72, 0.50], WET = [0.15, 0.40, 0.80];
const WATER_SEA = [0.16, 0.42, 0.62], WATER_SHALLOW = [0.40, 0.68, 0.82], WATER_DEEP = [0.18, 0.45, 0.70], MUD = [0.55, 0.42, 0.28];

/** Barren brown (0) → light-green grassland (0.5) → deep-green forest (1). */
function vegColor(v, out) {
  // Sharpen the transitions a little so the three biomes read as distinct patches
  if (v < 0.5) return mix(C.barren, C.grass, smooth(0.15, 0.45, v), out);
  return mix(C.grass, C.forest, smooth(0.55, 0.8, v), out);
}

/** Linear blend of two RGB arrays into `out` (safe when `out` is `a` or `b`). */
function mix(a, b, t, out = [0, 0, 0]) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}
function shade(c, k, out = [0, 0, 0]) { out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k; return out; }
function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
