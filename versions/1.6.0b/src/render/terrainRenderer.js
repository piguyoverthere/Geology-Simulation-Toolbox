import * as THREE from 'three';
import { BIOMES, classifyBiome, DRY_SOIL } from './biomes.js';
import { MOD } from '../core/mods.js';
import { ROCKS } from '../core/rocks.js';
import { forestColor } from '../sim/forests.js';
import { SHORES, SHORE, MARINE, MARINE_ID, seaTemp, waterTempAt, marineShown, marineColor, coastParams } from '../sim/coast.js';
import { waterQuality } from '../sim/waterQuality.js';
import { dominantAnimal } from '../sim/ecology.js';
import { SPECIES, OPEN, steadyCover } from '../sim/species.js';
import { DISEASE_BY_ID } from '../sim/disease.js';
import { carbonAt } from '../sim/forestCarbon.js';
import { fireColor } from '../sim/fireHistory.js';
import { climateParams, snowAt, seasonalAt } from '../sim/climate.js';

// Colour palette (linear-ish RGB 0..1)
const C = {
  forest: BIOMES.broadleaf.color,
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
  ash: [0.27, 0.26, 0.25],      // wildfire ash and charcoal
  eroded: [0.85, 0.25, 0.20],
  deposited: [0.20, 0.45, 0.90],
  neutral: [0.75, 0.75, 0.72],
};

/** Overlays replace the natural surface colours with one data layer. */
export const OVERLAYS = {
  natural: 'None (natural)',
  biome: 'Biomes',
  onebiome: 'Single biome',
  vegetation: 'Vegetation',
  moisture: 'Wetness',
  groundwater: 'Groundwater',
  carbon: 'Forest carbon',
  gwChange: 'Groundwater drawdown',
  soil: 'Soil depth',
  bare: 'Bare rock',
  age: 'Forest age',
  trees: 'Forest density',
  health: 'Forest health',
  species: 'Tree species',
  chem: 'Soil chemistry',
  temp: 'Temperature',
  precip: 'Precipitation',
  snowDepth: 'Snow depth',
  ice: 'Glacier ice',
  topo: 'Topographic map',
  coast: 'Coast & ocean',
  quality: 'Water quality',
  wind: 'Wind speed',
  wildlife: 'Wildlife',
  pollinators: 'Pollinators (bees)',
  beetles: 'Bark beetles',
  cropPests: 'Crop pests',
  soilSalt: 'Soil salt',
  ruins: 'Ruins',
  wetlands: 'Drained wetlands',
  heat: 'Urban heat',
  beaches: 'Starved beaches & levees',
  seeds: 'Seed dispersal',
  fireFollowers: 'Fire followers',
  fungi: 'Fungi & root rot',
  permafrost: 'Permafrost',
  fish: 'Fish stocks',
  landuse: 'Land use (clear view)',
  population: 'Population',
  air: 'Air pollution',
  invasive: 'Invasive trees',
  disease: 'Tree disease',
  fires: 'Historic wildfires',
  fuel: 'Fire fuel',
  decid: 'Deciduous trees',
  rock: 'Rock type',
  hardness: 'Rock hardness',
  change: 'Erosion / deposition',
  slope: 'Slope',
};

/** The overlays in alphabetical order (None first), for the menus. */
export function sortedOverlays() {
  const out = { natural: OVERLAYS.natural };
  for (const [k, v] of Object.entries(OVERLAYS).filter(([k]) => k !== 'natural').sort((a, b) => a[1].localeCompare(b[1]))) out[k] = v;
  return out;
}

/** Builds and updates the terrain + water meshes from a World. */
export class TerrainRenderer {
  /** @param {import('../core/world.js').World} world  @param {THREE.Scene} scene */
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.colorMode = 'natural'; // key of OVERLAYS
    this.showVegetation = true; // off: natural view shows bare ground and bedrock
    this.showClouds = true;
    this.showTownLabels = true; // (the town names over the map)
    this.singleBiome = 'wetland'; // (the biome the Single biome overlay picks out)
    this.showParkNames = true;  // (the names of the parks and National Forests)
    this.showTrailNames = true; // (the names written along the footpaths)
    // (the Land use overlay is a clear view: no clouds or fog over it)
    Object.defineProperty(this, 'cloudsOn', { get: () => this.showClouds && this.colorMode !== 'landuse' });
    this.showWater = true;
    this.showSea = true;    // off: hide the sea's surface to see the sea bed (its biomes, sand, reefs)

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

    // Lava: unlit so it glows, coloured by temperature
    this.lavaGeo = new THREE.BufferGeometry();
    this.lavaGeo.setIndex(indexAttr);
    this.lPos = new Float32Array(N * N * 3);
    this.lCol = new Float32Array(N * N * 4); // RGBA: alpha 0 marks "no lava/fire here"
    this.lavaGeo.setAttribute('position', new THREE.BufferAttribute(this.lPos, 3));
    this.lavaGeo.setAttribute('color', new THREE.BufferAttribute(this.lCol, 4));
    this.lava = new THREE.Mesh(this.lavaGeo, new THREE.MeshBasicMaterial({
      // Fragments where the interpolated alpha drops below 0.5 are discarded, so lava and fire end
      // cleanly halfway between a covered cell and an empty one. No need to bury hidden vertices.
      vertexColors: true, alphaTest: 0.5,
    }));
    this.lava.visible = false;
    scene.add(this.lava);

    // Base skirt so the terrain reads as a solid block of rock
    this.skirt = this.buildSkirt();
    scene.add(this.skirt);

    // Springs
    this.springGroup = new THREE.Group();
    scene.add(this.springGroup);
    this.springGeo = new THREE.CylinderGeometry(0.8, 1.4, 3, 10);
    this.springMat = new THREE.MeshStandardMaterial({ color: 0x3fa9ff, emissive: 0x0a3a66 });
    this.outfallGroup = new THREE.Group();
    scene.add(this.outfallGroup);
    this.outfallMat = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, emissive: 0x3a2400 });
    this.probeGroup = new THREE.Group();
    scene.add(this.probeGroup);
    this.probeGeo = new THREE.CylinderGeometry(0.35, 0.35, 5, 8);
    this.probeGeo.translate(0, 2.5, 0);
    this.probeTopGeo = new THREE.SphereGeometry(1.1, 12, 8);
    this.probeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x2a3a4a });
    this.probeTopMat = new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0x501010 });

    // Heights change every frame, so use fixed generous bounds instead of recomputing them
    const bounds = new THREE.Sphere(new THREE.Vector3(), N * 1.5);
    for (const g of [this.terrainGeo, this.waterGeo, this.lavaGeo, this.skirt.geometry]) g.boundingSphere = bounds;

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

  /** Show only the cells of `mask` (Float32Array, 1 shown … 0 faded to white); null shows everything. */
  setSpotlight(mask) {
    if (mask === this.spotMask) return;
    this.spotMask = mask && mask.length === this.world.N * this.world.N ? mask : null;
    this.spotChanged = true;
    this.world.dirty = true;
  }

  update(force = false) {
    const w = this.world;
    if (!w.dirty && !force) return;
    if (force) { this.dispD = null; this.wVis = null; } // (a new or reloaded map: draw its water as it is)
    w.dirty = false;
    const N = w.N, H = w.height, D = w.water, S = w.sediment, BASE = w.baseline;
    const off = this.offset;
    const mode = this.colorMode;
    const sea = w.seaLevel;
    const LV = w.lava, LT = w.lavaTemp, FI = w.fire, IC = w.ice;
    // Sea colours from the water temperature (once per update)
    if (sea > -999) {
      const Tw = seaTemp();
      this.seaShallow = Tw > 20 ? mix(SEA_TEMP_SHALLOW, SEA_TROP_SHALLOW, Math.min(1, (Tw - 20) / 6), [0, 0, 0]) : Tw < 8 ? mix(SEA_TEMP_SHALLOW, SEA_COLD_SHALLOW, Math.min(1, (8 - Tw) / 8), [0, 0, 0]) : SEA_TEMP_SHALLOW.slice();
      this.seaDeep = Tw > 20 ? mix(SEA_TEMP_DEEP, SEA_TROP_DEEP, Math.min(1, (Tw - 20) / 6), [0, 0, 0]) : Tw < 8 ? mix(SEA_TEMP_DEEP, SEA_COLD_DEEP, Math.min(1, (8 - Tw) / 8), [0, 0, 0]) : SEA_TEMP_DEEP.slice();
      this.seaIce = Tw < -1.5;
      this.coralNear = Tw > 20 ? Math.min(1, (Tw - 20) / 4) : 0;
    }
    let anyLava = false;
    // Colouring is the expensive part. On big maps recolour an interleaved share of the rows each
    // frame (the full map every few frames); heights, normals and water still update every frame.
    // (colours change slowly, so on all but small maps a share of the rows is recoloured each frame:
    // a half at 192, a third at 256, a quarter from 384 up; the whole map every few frames)
    const stride = N * N >= 140000 ? 4 : N * N >= 48000 ? 3 : N * N >= 30000 ? 2 : 1;
    // Topographic map: elevation range and a round contour interval (~15–30 contours over the relief)
    let topoLo = 0, topoInt = 1, topoSea = sea;
    if (mode === 'topo') {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < H.length; i += 7) { if (H[i] < lo) lo = H[i]; if (H[i] > hi) hi = H[i]; }
      const step = niceStep((hi - Math.max(lo, sea)) / 20);
      topoInt = step; topoLo = Math.max(lo, sea > -999 ? sea : lo);
      this.topo = { lo: topoLo, hi, interval: step };
    }
    const allColor = force || stride === 1 || mode !== this.lastMode || this.showVegetation !== this.lastVeg || this.spotChanged;
    this.spotChanged = false;
    const SM = this.spotMask; // (a spotlight: everything outside it fades to white, see ui/spotlight.js)
    this.lastMode = mode; this.lastVeg = this.showVegetation;
    this.colorPhase = ((this.colorPhase || 0) + 1) % stride;
    const phase = this.colorPhase;

    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x, i3 = i * 3;
        const h = H[i];
        this.tPos[i3] = x - off;
        // The water as drawn eases toward the real depth over a few frames, so shallow water that
        // soaks in and gathers again (or evaporates and is topped up) doesn't flicker on and off,
        // neither the water itself nor the damp ground under it
        if (!this.dispD || this.dispD.length !== D.length) this.dispD = D.slice();
        const DD = this.dispD;
        DD[i] += (D[i] - DD[i]) * (D[i] > DD[i] ? 0.25 : 0.08);
        // Glacier ice is drawn on top of its bed
        const ice = IC ? IC[i] : 0;
        this.tPos[i3 + 1] = h + ice;
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
        let col = null;
        if (!allColor && z % stride !== phase) {
          // this row is recoloured on another frame
        } else if (MOD.overlays[mode]) {
          // (an overlay a mod added: its own colour for each cell)
          let c = null;
          try { c = MOD.overlays[mode].color(w, i); } catch { c = null; }
          col = shade(c && c.length >= 3 ? [c[0], c[1], c[2]] : [0.5, 0.5, 0.5], 0.72 + 0.28 * ny, S3);
        } else if (mode === 'change') {
          const d = h - BASE[i];
          const t = Math.min(1, Math.abs(d) / 4);
          col = shade(mix(C.neutral, d < 0 ? C.eroded : C.deposited, t, S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'hardness') {
          // Soft (yellow) → medium (orange) → hard (navy), stretched over the map's range
          const t = Math.min(1, Math.max(0, (w.hardnessAt(h, i) - 0.1) / 0.8)) * 2;
          col = shade(t < 1 ? mix(HARD_SOFT, HARD_MID, t, S3) : mix(HARD_MID, HARD_HARD, t - 1, S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'vegetation') {
          col = shade(vegColor(w.vegetation[i], S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'age') {
          const v = w.vegetation[i];
          col = v > 0.6
            ? mix(AGE_YOUNG, AGE_OLD, w.forestAge[i], S3)
            : mix(NO_FOREST, AGE_YOUNG, smooth(0.45, 0.6, v) * 0.5, S3);
          shade(col, 0.75 + 0.25 * ny, col);
        } else if (mode === 'bare') {
          // Exposed bedrock in its own colour; soil-covered ground pale
          col = shade(mix(SOIL_COVER, this.rockColor(h, i), w.bareExposure(i, tan), S3), 0.7 + 0.3 * ny, S3);
        } else if (mode === 'species') {
          // Dominant species where there's forest; open ground and bare land pale
          const d = w.domSpecies ? w.domSpecies[i] : -1, v = steadyCover(w, i); // (the cover now or its year's average, whichever is greater)
          col = shade(d >= 0 && v > 0.5 ? SPECIES[d].mapColor : v > 0.3 ? OPEN.mapColor : NO_FOREST, 0.75 + 0.25 * ny, S3);
        } else if (mode === 'chem') {
          const c = w.soilChem ? w.soilChem[i] : 0;
          col = shade(c < 0 ? mix(CHEM_NEUTRAL, CHEM_ACID, -c, S3) : mix(CHEM_NEUTRAL, CHEM_ALKALI, c, S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'soil') {
          // Square-root scale so thin-but-present soil stands out from bare rock
          const t = Math.sqrt(w.humus[i]) * 2;
          col = shade(t < 1 ? mix(SOIL_THIN, SOIL_MID, t, S3) : mix(SOIL_MID, SOIL_DEEP, t - 1, S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'moisture') {
          const m = w.soil ? w.soil[i] : 0;
          col = shade(mix(DRY, WET, m, S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'rock') {
          col = shade(this.rockColor(h, i), 0.7 + 0.3 * ny, S3);
        } else if (mode === 'biome') {
          col = shade(BIOMES[classifyBiome(w, i, tan)].color, 0.8 + 0.2 * ny, S3);
        } else if (mode === 'onebiome') {
          // One biome picked out in its colour; everything else flat grey, light behind a dark biome and
          // dark behind a light one (snow, desert, sand) so it always stands out
          const pick = this.singleBiome, pc = BIOMES[pick] ? BIOMES[pick].color : [0.5, 0.5, 0.5];
          const b = classifyBiome(w, i, tan, pick !== 'snow');
          col = b === pick ? pc.slice() : (0.3 * pc[0] + 0.59 * pc[1] + 0.11 * pc[2] > 0.55 ? ONE_DARK : ONE_LIGHT).slice();
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'precip') {
          col = shade(mix(PRECIP_DRY, PRECIP_WET, w.precip ? w.precip[i] : 0, S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'snowDepth') {
          const d = w.snow ? w.snow[i] : 0;
          col = shade(d < 0.02 ? NO_SNOW : d < 1.5 ? mix(SNOW_THIN, SNOW_MID, d / 1.5, S3) : mix(SNOW_MID, SNOW_DEEP, Math.min(1, (d - 1.5) / 3), S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'decid') {
          // Share of the ground under deciduous trees (the ones that change colour and drop leaves)
          const d = w.decid ? w.decid[i] : 0;
          col = shade(w.vegetation[i] > 0.3 ? mix(DECID_NONE, DECID_FULL, Math.min(1, d / 0.8), S3) : NO_FOREST, 0.75 + 0.25 * ny, S3);
        } else if (mode === 'coast') {
          const sh = w.shore ? w.shore[i] : -1, m = w.marine ? marineShown(w, i) : -1, du = w.dune ? w.dune[i] : 0;
          col = shade(w.mangrove && w.mangrove[i] > 0.3 ? MANGROVE : sh >= 0 ? SHORES[sh].color : m >= 0 ? marineColor(w, i, false, BED_TMP) : du > 0.3 ? DUNE : NO_FOREST, 0.75 + 0.25 * ny, S3);
        } else if (mode === 'topo') {
          if (h < topoSea) {
            // Water: blue, deeper → darker
            col = mix(TOPO_SHALLOW, TOPO_DEEP, Math.min(1, (topoSea - h) / 15), S3);
          } else {
            // Elevation bands: the colour steps from one contour interval to the next
            const k = Math.floor(h / topoInt);
            const t = Math.min(1, Math.max(0, (k * topoInt + topoInt * 0.5 - topoLo) / Math.max(1, this.topo.hi - topoLo)));
            col = topoColor(t, S3);
            // Contour lines: drawn on the cell just above each contour level; every 5th is bold
            const kl = Math.floor(hl / topoInt), kr = Math.floor(hr / topoInt), ku = Math.floor(hu / topoInt), kd = Math.floor(hd / topoInt);
            const below = Math.min(kl, kr, ku, kd);
            if (below < k) {
              const major = k % 5 === 0;
              shade(col, major ? 0.42 : 0.68, col);
            }
          }
          shade(col, 0.82 + 0.18 * ny, col);
        } else if (mode === 'ice') {
          const t = IC ? IC[i] : 0;
          col = shade(t < 0.02 ? NO_SNOW : t < 3 ? mix(ICE_THIN, ICE_MID, t / 3, S3) : mix(ICE_MID, ICE_DEEP, Math.min(1, (t - 3) / 8), S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'temp') {
          // Today's temperature (annual mean + season); under the sea, the water's
          const wt = waterTempAt(w, i);
          col = shade(tempColor(wt !== null ? wt : w.temperature[i] + seasonalAt(w, i), S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'trees') {
          // How closely the trees stand: pale open ground → dark, closed canopy
          const td = w.treeDensity ? w.treeDensity[i] : 0;
          col = shade(td < 0.02 ? mix(TREES_NONE, TREES_NONE, 0, S3) : td < 0.5 ? mix(TREES_SPARSE, TREES_MID, td * 2, S3) : mix(TREES_MID, TREES_DENSE, (td - 0.5) * 2, S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'health') {
          // Forest health (young trees replacing the old): red = failing, yellow = struggling, green = renewing
          const fh = w.forestHealth ? w.forestHealth[i] : 0;
          col = w.vegetation[i] < 0.3 ? TREES_NONE.slice() : fh < 0.5 ? mix(HEALTH_BAD, HEALTH_MID, fh * 2, S3) : mix(HEALTH_MID, HEALTH_GOOD, (fh - 0.5) * 2, S3);
          shade(col, 0.75 + 0.25 * ny, col);
        } else if (mode === 'wildlife') {
          // The most common animal here, its colour stronger where there are more of them
          const da = w.animals && w.animals.length ? dominantAnimal(w, i) : null;
          col = da ? mix(WILD_NONE, da[0].color, Math.min(1, 0.35 + da[1] * 0.8), S3) : WILD_NONE.slice();
          shade(col, 0.75 + 0.25 * ny, col);
        } else if (mode === 'wind') {
          col = shade(windColor(w.wind ? w.wind[i] : 0, S3), 0.75 + 0.25 * ny, S3);
        } else if (mode === 'slope') {
          const t = Math.min(1, slope / 0.35);
          col = mix(SLOPE_LO, SLOPE_HI, t, S3);
        } else if (mode === 'invasive') {
          // How much of the forest is the invasive pine: native forest green, invaded purple-red
          const iv = w.invasive ? w.invasive[i] : 0, v = w.vegetation[i];
          col = v < 0.4 ? INV_OPEN.slice() : mix(INV_NATIVE, INV_FULL, Math.min(1, iv), S3);
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'fires') {
          // Wildfire history: each cell in the colour of the last fire to burn it (named fires each
          // their own colour, small ones a dull brown, fires still burning orange) over pale ground
          const fid = w.fireScar ? w.fireScar[i] : 0;
          col = mix(FIRE_BG_LO, FIRE_BG_HI, Math.min(1, w.vegetation[i]), S3);
          if (fid) mix(col, fireColor(w, fid, FIRE_TMP), 0.85, col);
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'disease') {
          // Tree diseases: forest pale green, each disease in its own colour, stronger where heavier
          const dd = w.treeDisease ? w.treeDisease[i] : 0, v = w.vegetation[i];
          col = v < 0.4 ? INV_OPEN.slice() : DIS_HEALTHY.slice();
          if (dd && DISEASE_BY_ID[dd]) mix(col, DISEASE_BY_ID[dd].color, 0.35 + 0.65 * Math.min(1, w.diseaseLoad[i]), col);
          else if (w.roadDisease && w.roadDisease[i] && DISEASE_BY_ID[w.roadDisease[i]]) { // (a road carrying its spores: greyed)
            col = [0.55, 0.55, 0.52]; mix(col, DISEASE_BY_ID[w.roadDisease[i]].color, 0.25 + 0.5 * Math.min(1, w.roadSpores[i]), col);
          }
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'fish') {
          // Fish in the sea: collapsed (red) through low (yellow) to plentiful (deep blue); land grey
          if (h >= (w.meanSea > -999 ? w.meanSea : -1e9)) col = shade(FISH_LAND, 0.7 + 0.3 * ny, S3);
          else {
            const f = w.fishStock ? w.fishStock[i] : 0.9;
            col = f < 0.2 ? mix(FISH_GONE, FISH_LOW, f / 0.2, S3) : mix(FISH_LOW, FISH_FULL, Math.min(1, (f - 0.2) / 0.7), S3);
            if (w.zoneFlags && (w.zoneFlags[i] & 64) && (x + z) % 5 === 0) mix(col, FISH_RESERVE, 0.5, col); // (marine reserve)
          }
        } else if (OV_SIMPLE[mode]) {
          // The world-dynamics layers (sim/dynamics.js): each a colour ramp over grey land
          const o = OV_SIMPLE[mode], sea = w.meanSea > -999 ? w.meanSea : -1e9;
          if (h < sea) col = OV_SEA.slice();
          else {
            const t = o.value(w, i);
            col = t > 0.02 ? mix(o.lo, o.hi, Math.min(1, t), S3) : (o.base ? o.base(w, i) : OV_LAND).slice();
          }
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'permafrost') {
          // Permafrost: frozen ground blue (deeper the more ice), near to thawing pale cyan, thawing
          // now red, thawed brown; ground that was never frozen grey
          const pf = w.permafrost ? w.permafrost[i] : 0, th = w.pfThawed ? w.pfThawed[i] : 0, now = w.pfThawing ? w.pfThawing[i] : 0;
          if (h < (w.meanSea > -999 ? w.meanSea : -1e9)) col = PF_SEA.slice();
          else if (now > 0.3) col = PF_THAWING.slice();
          else if (pf > 0.05) col = mix(PF_EDGE, PF_FROZEN, w.temperature[i] < -3 ? Math.min(1, 0.4 + pf * 0.6) : 0.15, S3);
          else if (th > 0.05) col = mix(PF_NONE, PF_THAWED, Math.min(1, 0.4 + th), S3);
          else col = PF_NONE.slice();
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'fungi') {
          // Fungal diversity: none (pale) through some (green) to rich (deep violet); honey-mushroom
          // root rot over it in orange, red where it's killing the trees
          const fg = w.fungi ? w.fungi[i] : 0, rr = w.rootRot ? w.rootRot[i] : 0;
          col = fg < 0.4 ? mix(FU_NONE, FU_SOME, fg / 0.4, S3) : mix(FU_SOME, FU_RICH, Math.min(1, (fg - 0.4) / 0.45), S3);
          if (rr > 0.03) mix(col, rr > 0.55 ? FU_KILL : FU_ROT, Math.min(1, 0.3 + rr), col);
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'fireFollowers') {
          // Fire followers: fireweed (magenta) and fire poppies (orange) on recent small burns
          // (pale ash); burns too big for them dark grey; the rest of the land pale green-grey
          const fw = w.fireweed ? w.fireweed[i] : 0, fp = w.firePoppy ? w.firePoppy[i] : 0, su = w.burnSuit ? w.burnSuit[i] : 0;
          const big = w.burnt[i] > 0.15 && su < 0.1;
          col = w.fire[i] > 0 ? FF_FIRE.slice() : big ? FF_BIG.slice() : su > 0.05 ? mix(FF_BG, FF_ASH, Math.min(1, su * 1.5), S3) : FF_BG.slice();
          if (fw > 0.03) mix(col, FF_WEED, Math.min(1, fw * 1.3), col);
          if (fp > 0.03) mix(col, FF_POPPY, Math.min(1, fp * 1.5), col);
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'pollinators') {
          // Bees and the like: none (grey) to plenty (golden yellow); farmland outlined darker
          const p = w.pollinators ? Math.min(1, w.pollinators[i]) : 0;
          col = mix(POL_NONE, POL_FULL, p, S3);
          if (w.landUse && w.landUse[i] === 1 && (x + z) % 4 === 0) mix(col, POL_FIELD, 0.45, col);
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'fuel') {
          // Fuel on the forest floor: little (green), building (yellow), heavy enough for a crown fire (red)
          const f = w.fuel ? w.fuel[i] : 0, v = w.vegetation[i];
          col = v < 0.2 ? FUEL_NONE.slice() : f < 0.35 ? mix(FUEL_LOW, FUEL_MID, f / 0.35, S3) : mix(FUEL_MID, FUEL_HIGH, Math.min(1, (f - 0.35) / 0.45), S3);
          if (w.fireGuard && w.fireGuard[i] > 0.05 && ((x + z) % 6 === 0)) mix(col, FUEL_GUARD, 0.5, col); // (hatched where towns fight fires)
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'carbon') {
          // Carbon held in the trees and soil: bare ground pale, old dense forest deep green-black
          const c = Math.min(1, carbonAt(w, i) / 6);
          col = shade(c < 0.4 ? mix(CARB_LOW, CARB_MID, c / 0.4, S3) : mix(CARB_MID, CARB_HIGH, (c - 0.4) / 0.6, S3), 0.72 + 0.28 * ny, S3);
        } else if (mode === 'groundwater') {
          // How much water is in the ground: dry ground sandy, a full aquifer deep blue
          const g = w.groundwater ? w.groundwater[i] : 0;
          col = shade(g < 0.5 ? mix(GW_DRY, GW_MID, g / 0.5, S3) : mix(GW_MID, GW_FULL, (g - 0.5) / 0.5, S3), 0.72 + 0.28 * ny, S3);
        } else if (mode === 'gwChange') {
          // Drawn down by pumping (red) or as it would be (pale); sunk ground (subsidence) darker
          const g = w.groundwater ? w.groundwater[i] : 0, nat = w.gwNatural ? w.gwNatural[i] : g;
          const drop = Math.max(0, Math.min(1, (nat - g) / Math.max(0.05, nat)));
          col = mix(GW_SAME, GW_DOWN, Math.sqrt(drop), S3);
          if (w.subsided && w.subsided[i] > 0.05) mix(col, GW_SUNK, Math.min(1, w.subsided[i] / 1.5) * 0.7, col);
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'population') {
          // People per cell as a heatmap (log scale: a village shows as well as a city): the land a
          // muted grey, then deep purple through red and orange to pale yellow where it's crowded
          const p = w.popDensity ? w.popDensity[i] : 0;
          if (p < 0.3) col = shade(POP_BG, 0.7 + 0.3 * ny, S3);
          else {
            const t = Math.min(1, Math.log(1 + p) / Math.log(1 + 60));
            col = t < 0.33 ? mix(POP_HEAT[0], POP_HEAT[1], t / 0.33, S3) : t < 0.66 ? mix(POP_HEAT[1], POP_HEAT[2], (t - 0.33) / 0.33, S3) : mix(POP_HEAT[2], POP_HEAT[3], (t - 0.66) / 0.34, S3);
            shade(col, 0.85 + 0.15 * ny, col);
          }
        } else if (mode === 'air') {
          // Smoke and acid rain: clean air pale, thick smoke dark brown-grey
          const ap = Math.min(1, Math.sqrt((w.airPollution ? w.airPollution[i] : 0) + (w.fireSmoke ? w.fireSmoke[i] : 0)) * 0.9);
          col = mix(AIR_CLEAN, AIR_DIRTY, ap, S3);
          shade(col, 0.72 + 0.28 * ny, col);
        } else if (mode === 'landuse') {
          // Land use, plainly: what each cell is used for in flat colours, with nothing drawn over it
          // (no pollution stains, murky water, clouds or fog), and plantations outlined
          const lu = w.landUse ? w.landUse[i] : 0;
          if (!lu) {
            const v = w.vegetation[i];
            col = mix(LU_OPEN, LU_WILD, Math.min(1, v * 1.3), S3);
          } else {
            col = (lu === 2 && w.townCore && w.townCore[i] ? LU_CORE : LU_COLORS[lu] || LU_OPEN).slice();
            if (lu === 1 && w.irrigated && w.irrigated[i]) mix(col, LU_IRRIGATED, 0.35, col);
            if (lu === 10) {
              if (w.timberRest && w.timberRest[i]) mix(col, LU_RESTING, 0.65, col); // (resting: soil recovering)
              else if (w.vegetation[i] < 0.5) mix(col, LU_FELLED, 0.6, col); // (felled, regrowing)
              // (the plantation's edge: a dark line where it meets anything else)
              const o = w.civOwner[i];
              const edge = (j) => w.landUse[j] !== 10 || w.civOwner[j] !== o;
              if ((x > 0 && edge(i - 1)) || (x < N - 1 && edge(i + 1)) || (z > 0 && edge(i - N)) || (z < N - 1 && edge(i + N))) col = LU_EDGE.slice();
            }
          }
          if (w.footpath && w.footpath[i]) col = FOOTPATH.slice();
          shade(col, 0.72 + 0.28 * ny, col);
        } else {
          col = this.naturalColor(h, slope, tan, h - BASE[i], DD[i], i);
          // Stained, fouled banks along polluted rivers
          if (w.riverPollution && w.riverPollution[i] > 0.05 && DD[i] < 0.1) mix(col, POLLUTED_BANK, Math.min(0.5, Math.sqrt(w.riverPollution[i]) * 0.45), col);
          // Forest taken over by the invasive pine: a darker, bluer, uniform green
          if (w.invasive && w.invasive[i] > 0.05 && w.vegetation[i] > 0.5 && !(w.landUse && w.landUse[i])) mix(col, INVASIVE, Math.min(0.6, w.invasive[i] * 0.6), col);
          // Land worn out by overgrazing: bare, sandy, desert-like
          if (w.degraded && w.degraded[i] > 0.1) mix(col, DEGRADED, Math.min(0.75, w.degraded[i] * 0.8), col);
          // Footpaths: a narrow, pale trodden trail
          if (w.footpath && w.footpath[i]) mix(col, FOOTPATH, 0.75, col);
          // (sim/dynamics.js) bark beetles reddening the conifers; ruins under the regrowth; salt
          // crust on worn-out irrigated land; pest-blighted fields
          if (w.barkBeetle && w.barkBeetle[i] > 0.1) mix(col, BARK_BEETLE, Math.min(0.6, w.barkBeetle[i] * 0.7), col);
          if (w.ruins && w.ruins[i] > 0.05) mix(col, (x % 3 === 0 || z % 3 === 0) ? RUIN_A : RUIN_B, Math.min(0.75, w.ruins[i]) * (1 - 0.6 * smooth(0.5, 0.9, w.vegetation[i])), col);
          if (w.soilSalt && w.soilSalt[i] > 0.15) mix(col, SALT_CRUST, Math.min(0.8, (w.soilSalt[i] - 0.15) * 1.4), col);
          // Civilization: fields in a patchwork of crops, towns, roads
          if (w.landUse && w.landUse[i]) {
            const lu = w.landUse[i];
            if (lu === 1) { mix(col, ((x >> 1) + (z >> 1)) & 1 ? FIELD_A : FIELD_B, 0.65, col); if (w.cropPest && w.cropPest[i] > 0.1) mix(col, BLIGHT, Math.min(0.7, w.cropPest[i] * 0.8), col); }
            else if (lu === 2 && w.townCore && w.townCore[i]) mix(col, (x % 3 === 0 || z % 3 === 0) ? CORE_STREET : ((x * 5 + z * 11) % 4 === 0 ? CORE_ROOF : CORE_BLOCK), 0.97, col); // (downtown: solid blocks and streets)
            else if (lu === 2) mix(col, ((x * 7 + z * 13) % 5) < 2 ? TOWN_ROOF : TOWN_PAVE, 0.9 * w.paved[i], col);
            else if (lu === 7) mix(col, DAM, 0.95, col);
            else if (lu === 8) mix(col, CANAL, 0.85, col);
            else if (lu === 9) mix(col, SEWER, 0.9, col);
            else if (lu === 11) mix(col, (x + z) & 1 ? MINE_A : MINE_B, 0.9, col);
            else if (lu === 12) mix(col, SPOIL, 0.9, col);
            else if (lu === 10) {
              // A timber plantation: even rows of planted trees; felled stands bare, brown with slash
              const v = w.vegetation[i];
              if (v < 0.5) mix(col, CLEARCUT, Math.min(0.85, (0.55 - v) * 1.8), col);
              else mix(col, (x + 2 * z) % 3 === 0 ? PLANTATION_ROW : PLANTATION, 0.4, col);
            }
            else if (lu === 14) mix(col, ((x * 7 + z * 5) % 3) === 0 ? QUAY_DARK : BOULDER, 0.95, col);
            else if (lu === 6) mix(col, (x * 5 + z * 3) % 3 === 0 ? QUAY_DARK : QUAY, 0.92, col);
            else if (lu === 5) mix(col, (x + z) & 1 ? HARBOR_A : HARBOR_B, 0.9, col);
            else if (lu === 4) mix(col, ((x * 3 + z * 5) % 4) === 0 ? INDUSTRY_DARK : INDUSTRY, 0.95 * w.paved[i], col);
            else if (lu === 3 && w.paved[i] > 0.1) {
              // A worn road fades and cracks toward the ground beside it
              const rc = w.roadCond ? w.roadCond[i] : 1;
              mix(col, rc > 0.5 ? ROAD : ROAD_WORN, 0.9 * Math.min(1, rc * 1.6), col);
            }
          }
          // Trees killed by animals (bark beetles and the like): red-brown dying stands, grey snags
          if (this.showVegetation && w.deadWood) {
            const dw = w.deadWood[i], tk = w.treeKill ? w.treeKill[i] : 0;
            if (tk > 0.05) mix(col, BEETLE_RED, Math.min(0.55, tk * 0.8), col);
            if (dw > 0.06) mix(col, DEAD_WOOD, Math.min(0.45, (dw - 0.06) * 1.0), col); // (fallen timber: fades as it rots)
          }
        }
        // Palette is authored in sRGB; vertex colours are linear, so square to approximate the conversion
        // Glacier ice: blue-white, greyer where it carries rock debris
        if (col && ice > 0.02 && (mode === 'natural' || mode === 'ice')) {
          const t = Math.min(1, ice / 0.6);
          const dirty = Math.min(0.5, (w.iceDebris ? w.iceDebris[i] : 0) * 2);
          mix(col, mix(ICE, ICE_DIRTY, dirty, S4), t * 0.92, col);
        }
        if (col && SM && SM[i] < 1) mix(col, SPOT_WHITE, 0.9 * (1 - SM[i]), col);
        if (col) { this.tCol[i3] = col[0] * col[0]; this.tCol[i3 + 1] = col[1] * col[1]; this.tCol[i3 + 2] = col[2] * col[2]; }

        // Lava and fire layer: alpha 1 where present, 0 (discarded) elsewhere
        const l4 = i * 4;
        this.lPos[i3] = x - off; this.lPos[i3 + 2] = z - off;
        let lc = null;
        if (LV[i] > 0.02) {
          this.lPos[i3 + 1] = h + Math.max(LV[i], 0.1);
          lc = lavaColor(LT[i]);
        } else if (FI[i] > 0.02) {
          // Fire glows just above the ground; only its colour flickers (moving single vertices up
          // and down makes spikes)
          this.lPos[i3 + 1] = h + 0.15;
          lc = lavaColor(0.45 + 0.5 * FI[i] * (0.75 + 0.25 * Math.random()));
        } else {
          this.lPos[i3 + 1] = h + 0.05;
        }
        if (lc) {
          anyLava = true;
          this.lCol[l4] = lc[0] * lc[0]; this.lCol[l4 + 1] = lc[1] * lc[1]; this.lCol[l4 + 2] = lc[2] * lc[2];
          this.lCol[l4 + 3] = 1;
        } else {
          this.lCol[l4 + 3] = 0;
        }

        // Water surface: hide (sink below ground) where it is too thin to see
        const d = DD[i];
        const i4 = i * 4;
        this.wPos[i3] = x - off;
        this.wPos[i3 + 2] = z - off;
        // Thin runoff films just darken the ground; draw a water surface only where it's a real stream/lake
        const dirtyStream = mode !== 'landuse' && w.riverPollution && w.riverPollution[i] > 0.05 && d > 0.02;
        // (hysteresis: water comes into view above 0.1 deep and only goes again below 0.06, so a
        // sheet hovering around the line doesn't blink)
        if (!this.wVis || this.wVis.length !== D.length) this.wVis = new Uint8Array(D.length);
        this.wVis[i] = d > 0.1 ? 1 : d < 0.06 ? 0 : this.wVis[i];
        if ((this.wVis[i] || dirtyStream) && ice < 0.2 && (this.showSea || !(h < sea))) { // (meltwater under a glacier stays hidden)
          this.wPos[i3 + 1] = h + d;
          const mud = Math.min(1, (S[i] / Math.max(d, 0.05)) * 4);
          const deep = Math.min(1, d / 6);
          const isSea = h < sea;
          let base;
          if (isSea) {
            // Sea water colour follows its temperature: dark green-blue cold seas, deep blue temperate,
            // turquoise tropical shallows
            base = mix(this.seaShallow, this.seaDeep, Math.min(1, d / 10), S4);
          } else {
            base = mix(WATER_SHALLOW, WATER_DEEP, deep, S4);
            // A run of fish up the river (salmon and the like) turns it red
            if (w.runners && w.runners[i] > 0.1) base = mix(base, SALMON_RUN, Math.min(0.6, w.runners[i] * 0.5), S4);
            // Polluted rivers below towns run murky grey-brown
            if (mode !== 'landuse' && w.riverPollution && w.riverPollution[i] > 0.02) base = mix(base, DIRTY_RIVER, Math.min(0.92, Math.sqrt(w.riverPollution[i]) * 0.95), S4);
          }
          let wc = mix(base, MUD, mud * 0.8, S4);
          if (isSea && w.silt && mode !== 'landuse') {
            // Dirty seawater: silt turns it brown, pollutants a murky olive (overlay: by quality)
            if (mode === 'quality') wc = qualityColor(waterQuality(w, i), S4);
            else {
              wc = mix(wc, SILT_WATER, Math.min(0.95, w.silt[i] * 1.2), S4);
              wc = mix(wc, FOUL_WATER, Math.min(0.5, Math.sqrt(w.pollution[i]) * 0.4), S4); // (a thin plume still shows)
              // A plankton bloom turns it green (a red tide in warm water)
              const pl = w.plankton ? w.plankton[i] : 0;
              if (pl > 0.3) wc = mix(wc, seaTemp() > 18 ? RED_TIDE : BLOOM, Math.min(0.6, (pl - 0.3) * 0.45), S4);
              // Surf: white water where the waves break along exposed shores, rolling in in bands
              const sf = w.surf ? w.surf[i] : 0;
              if (sf > 0.05) {
                const roll = 0.5 + 0.5 * Math.sin((w.time || 0) * 2.2 - (x * 0.9 + z * 0.7) * 0.35 + i * 0.13);
                wc = mix(wc, FOAM, Math.min(0.85, sf * (0.35 + 0.65 * roll * roll)), S4);
              }
            }
          }
          // Sea ice, cell by cell: thin new ice is grey and see-through, thick pack ice white
          const si = isSea && w.seaIce ? w.seaIce[i] : 0;
          const iced = si > 0.05;
          if (iced) wc = mix(wc, ICE_SEA, Math.min(1, si * 1.6), S4);
          this.wCol[i4] = wc[0] * wc[0]; this.wCol[i4 + 1] = wc[1] * wc[1]; this.wCol[i4 + 2] = wc[2] * wc[2];
          this.wCol[i4 + 3] = iced ? Math.max(Math.min(0.9, 0.45 + (d - 0.1) * 0.5), Math.min(0.97, 0.5 + si)) : Math.min(isSea ? 0.9 : 0.85, (isSea ? 0.45 : 0.25) + (d - 0.1) * 0.5);
          // (shallow water on land fades in and out rather than popping into view)
          if (!isSea && !iced) this.wCol[i4 + 3] *= Math.min(1, Math.max(0.08, (d - 0.04) / 0.14));
          // A bridge: its deck over the water
          if (w.bridge && w.bridge[i] && w.paved[i] > 0.3) {
            const b = BRIDGE;
            this.wCol[i4] = b[0] * b[0]; this.wCol[i4 + 1] = b[1] * b[1]; this.wCol[i4 + 2] = b[2] * b[2]; this.wCol[i4 + 3] = 0.97;
          }
          // (polluted river water is murky: opaque even in a thin stream, so it shows)
          if (mode !== 'landuse' && !isSea && w.riverPollution && w.riverPollution[i] > 0.05) this.wCol[i4 + 3] = Math.max(this.wCol[i4 + 3], Math.min(0.92, 0.55 + Math.sqrt(w.riverPollution[i]) * 0.5));
          // (the mangrove canopy stands above the tide)
          if (w.mangrove && w.mangrove[i] > 0.05) this.wCol[i4 + 3] *= 1 - 0.85 * Math.min(1, w.mangrove[i] * 1.2);
          // (the temperature map colours the sea by its water temperature: let it show through)
          if (mode === 'temp' && isSea) {
            // The temperature map shows the sea's own surface temperature, spot by spot
            const tw = w.seaT && !Number.isNaN(w.seaT[i]) ? w.seaT[i] : seaTemp();
            const tc = tempColor(tw, S4);
            const sv = 0.85 + 0.15 * Math.min(1, d / 10); // (a touch darker over deep water)
            this.wCol[i4] = (tc[0] * sv) ** 2; this.wCol[i4 + 1] = (tc[1] * sv) ** 2; this.wCol[i4 + 2] = (tc[2] * sv) ** 2;
            this.wCol[i4 + 3] = 0.88;
          }
          if (mode === 'quality' && isSea) this.wCol[i4 + 3] = 0.92;
          if (mode === 'wind' && isSea) {
            const wc2 = windColor(w.wind ? w.wind[i] : 0, S4);
            this.wCol[i4] = wc2[0] * wc2[0]; this.wCol[i4 + 1] = wc2[1] * wc2[1]; this.wCol[i4 + 2] = wc2[2] * wc2[2];
            this.wCol[i4 + 3] = 0.9;
          }
          // (the coast overlay is for looking at the sea bed: make the sea nearly clear)
          if ((mode === 'coast' || mode === 'wildlife') && isSea) this.wCol[i4 + 3] *= 0.25;
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
    this.lava.visible = anyLava;
    if (anyLava) {
      this.lavaGeo.attributes.position.needsUpdate = true;
      this.lavaGeo.attributes.color.needsUpdate = true;
    }

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
    this.syncOutfalls();
    this.syncProbes();
  }

  /** The forest's colour from its species mix (falls back to the forest-type blend). Writes S4. */
  forestMix(w, i) {
    const c = w.forestColor;
    if (!c) return forestColor(w, i, S4);
    S4[0] = c[i * 3]; S4[1] = c[i * 3 + 1]; S4[2] = c[i * 3 + 2];
    // Seasons: the deciduous part of the canopy turns its autumn colours, then drops to bare twigs,
    // and comes back fresh green in spring. Evergreens just get a little spring flush.
    if (!w.leafOn) return S4;
    const d = w.decid ? w.decid[i] : 0;
    if (d > 0.005) {
      const L = w.leafOn[i], a = w.autumn[i], DC = w.decidColor, AC = w.autumnColor, i3 = i * 3;
      // Autumn colour is boosted so it reads through the open ground and evergreens mixed in
      const boost = 1 + 1.3 * Math.min(1, d * 1.4);
      for (let k = 0; k < 3; k++) {
        const leaves = DC[i3 + k] + (AC[i3 + k] - DC[i3 + k]) * a * boost;
        const v = S4[k] + L * leaves + (1 - L) * d * TWIGS[k] - DC[i3 + k];
        S4[k] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
    }
    const f = w.flush[i];
    if (f > 0.01) mix(S4, FLUSH, f * (0.18 + 0.4 * Math.min(1, (w.decid ? w.decid[i] : 0) * 1.5)), S4);
    return S4;
  }

  /** Bedrock colour: the rock type's own colour, or plain strata browns when rock types are off. */
  rockColor(h, i) {
    const w = this.world;
    if (w.rocksEnabled) return ROCKS[w.rockAt(h, i)].color;
    return mix(C.rockSoft, C.rockHard, w.hardnessAt(h, i), S1);
  }

  /** Vegetation hidden: weathered bedrock, with loose soil on gentle ground and fresh sediment. */
  bareColor(h, slope, change, water, i) {
    const w = this.world;
    const col = mix(C.barren, this.rockColor(h, i), 0.55 + 0.45 * smooth(0.05, 0.25, slope), S3);
    if (change > 0.15) mix(col, C.soil, Math.min(0.8, change / 3) * (1 - smooth(0.1, 0.25, slope)), col);
    this.coastColor(w, i, h, 0, col);
    if (water > 0.002) shade(col, 1 - 0.12 * Math.min(1, (water - 0.002) / 0.05), col); // (damp ground: darker the wetter, no sudden step)
    return col;
  }

  naturalColor(h, slope, tan, change, water, i) {
    const w = this.world;
    if (!this.showVegetation) return this.bareColor(h, slope, change, water, i);
    // Writes into scratch arrays: this runs for every vertex every frame, so avoid allocating
    const v = w.vegetation[i];
    const soil = w.soil ? w.soil[i] : 0.5;
    const near = w.nearWater ? w.nearWater[i] : 0;
    const dry = 1 - smooth(DRY_SOIL - 0.1, DRY_SOIL + 0.1, soil);
    // Desert vs mesa follows the neighbourhood's slope so they form whole regions
    const g = w.gentleSlope;
    const steep = smooth(g * 0.95, g * 1.25, w.standSlope ? w.standSlope[i] : tan);

    // Bare ground: brown soil, yellow desert sand where dry and flat, banded red mesa rock where dry and steep
    const bare = mix(C.barren, C.desert, dry * (1 - steep), S1);
    const mesa = dry * steep;
    if (mesa > 0) shade(mix(bare, C.mesa, mesa, bare), 1 - 0.14 * mesa * (0.5 + 0.5 * Math.sin(h * 1.7)), bare);
    // Sparse cover: green grass on moist ground, olive scrub as it dries
    const low = mix(C.grass, C.shrub, 1 - smooth(0.28, 0.42, soil), S2);
    // Seasons: grass goes dormant (straw) in the cold and greens up brightly in spring
    if (w.leafOn) {
      const L = w.leafOn[i];
      if (L < 0.99) mix(low, STRAW, 0.7 * (1 - L), low);
      const f = w.flush[i];
      if (f > 0.01) mix(low, FLUSH, 0.45 * f, low);
    }
    // Forests take the colour of whichever type suits the spot (blended at the borders)
    const col = v < 0.5 ? mix(bare, low, smooth(0.12, 0.42, v), S3)
      // Old-growth forest is darker and denser than young regrowth
      // (turning leaves show even where the canopy is a little thinner)
      : mix(low, shade(this.forestMix(w, i), 1.1 - 0.25 * w.forestAge[i] * (1 - (w.autumn ? w.autumn[i] : 0)), S4),
        Math.max(smooth(0.55, 0.8, v), w.autumn && w.decid ? w.autumn[i] * Math.min(1, w.decid[i] * 1.5) * smooth(0.45, 0.65, v) : 0), S3);
    // Autumn: pull the whole canopy toward its deciduous trees' turning colours, so the colour
    // shows strongly even through the evergreens and open ground mixed in
    if (w.autumn && w.decid && v > 0.4) {
      const d = w.decid[i], a = w.autumn[i] * w.leafOn[i];
      if (d > 0.02 && a > 0.02) {
        const AC = w.autumnColor, i3 = i * 3, t = a * Math.min(1, d * 1.6) * 0.6 * smooth(0.4, 0.6, v);
        S4[0] = Math.min(1, AC[i3] / d); S4[1] = Math.min(1, AC[i3 + 1] / d); S4[2] = Math.min(1, AC[i3 + 2] / d);
        mix(col, S4, t, col);
      }
    }
    // Tundra where it's too cold for trees
    const T = (w.vegTemp || w.temperature)[i], tl = climateParams.treeLineTemp;
    if (T < tl + 1) mix(col, C.tundra, smooth(tl + 1, tl - 3, T) * smooth(0.08, 0.3, v) * (1 - smooth(0.6, 0.8, v)) * 0.85, col); // not over forest
    // Wetlands on flat, waterlogged ground beside rivers and lakes
    const marsh = smooth(0.4, 0.8, near) * smooth(0.65, 0.85, soil) * (1 - smooth(0.15, 0.35, tan)) * smooth(0.3, 0.5, v);
    if (marsh > 0) mix(col, C.marsh, marsh * 0.8, col);

    // Bare rock on cliffs in its own colour, reddened by desert varnish in dry country
    const rc = this.rockColor(h, i);
    const rock = mix(rc, C.mesa, dry * 0.5, S1);
    mix(col, rock, smooth(0.2, 0.42, slope) * (1 - 0.6 * v), col);
    // Fresh sediment (deposits) shows as bare soil
    if (change > 0.15) mix(col, C.soil, Math.min(0.7, change / 3) * (1 - smooth(0.1, 0.25, slope)) * (1 - v), col);
    // Wildfire ash and charred ground, hidden again as plants return
    const burnt = w.burnt[i];
    if (burnt > 0) mix(col, C.ash, burnt * 0.9 * (1 - smooth(0.2, 0.6, v)), col);
    // The coast: each shore type in its own colours, dunes behind sand beaches, the sea floor by
    // ocean biome (kelp, seagrass, coral, open sea)
    this.coastColor(w, i, h, v, col);
    // Snow where it's below freezing, shaped by moisture, steepness, hollows, canopy and sun
    if (w.snow && w.snow[i] > 0.005) mix(col, C.snow, snowAt(w, i, tan), col);
    // Wet ground is darker
    if (water > 0.002) shade(col, 1 - 0.12 * Math.min(1, (water - 0.002) / 0.05), col); // (damp ground: darker the wetter, no sudden step)
    return col;
  }

  /** Shore, dune and sea-floor colouring (shared by the natural and bare views). Writes into col. */
  coastColor(w, i, h, v, col) {
    const sea = w.meanSea !== undefined ? w.meanSea : w.seaLevel;
    if (sea < -999) return;
    const sh = w.shore ? w.shore[i] : -1;
    if (sh >= 0) {
      let c = SHORES[sh].color;
      if (sh === SHORE.sand) {
        // Coral sand is near-white; volcanic or river sand darker and greyer
        c = mix(c, CORAL_SAND, Math.min(1, (w.coral ? this.coralNear : 0)), S1);
        c = mix(SHORES[SHORE.shingle].color, c, Math.min(1, (w.sand ? w.sand[i] : 0) * 1.2), S1);
      }
      if (sh === SHORE.cliff) c = shade(mix(this.rockColor(h, i), c, 0.45, S1), 0.82, S1); // the cliff's own rock, in shadow
      // Each kind of coast in its own colour, strongly (vegetation softens the upper shore)
      const t = 0.95 * (1 - 0.55 * smooth(0.45, 0.8, v));
      mix(col, c, t, col);
      // The wet lower shore, below high tide, darker (the tide line shows); mudflats glisten wet
      const high = sea + 0.5 * coastParams.tideRange;
      if (h < high) shade(col, sh === SHORE.mudflat ? 0.78 : 0.86, col);
      else if (sh === SHORE.mudflat && w.water[i] > 0.01) shade(col, 0.82, col);
    } else if (h >= sea && w.beachSand && w.beachSand[i] > 0.05) {
      // Land the sea once covered: beach of the kind it became (sand, shingle, mudflat, basalt),
      // fading as plants take it back
      const bt = w.beachType ? w.beachType[i] : SHORE.sand;
      const c = SHORES[bt >= 0 && bt < SHORES.length ? bt : SHORE.sand].color;
      mix(col, c, 0.92 * Math.min(1, w.beachSand[i] * 1.3) * (1 - 0.55 * smooth(0.45, 0.8, v)), col);
    } else if (h < sea) {
      const m = w.marine ? marineShown(w, i) : -1;
      // The sea bed: silt and sand, darker mud in the deep, and its meadows, kelp and reefs
      mix(col, m >= 0 ? marineColor(w, i, true, BED_TMP) : C.soil, 0.75, col);
      // Dead coral rubble: pale, broken coral on the reef flat
      const rb = w.coralRubble ? w.coralRubble[i] : 0;
      if (rb > 0.05) mix(col, CORAL_SAND, Math.min(0.8, rb * 0.6), col);
    }
    const dune = w.dune ? w.dune[i] : 0;
    if (dune > 0.05) mix(col, DUNE, dune * 0.75 * (1 - smooth(0.6, 0.85, v)), col);
    // Mangrove canopy over the mudflats and shallows
    const mg = w.mangrove ? w.mangrove[i] : 0;
    if (mg > 0.03) mix(col, MANGROVE, Math.min(1, mg * 1.1), col);
  }

  /** Markers for the probes: a white post with a red ball, like a survey pin. */
  syncProbes() {
    const g = this.probeGroup, list = this.world.probes || [];
    while (g.children.length > list.length) g.remove(g.children[g.children.length - 1]);
    while (g.children.length < list.length) {
      const pin = new THREE.Group();
      pin.add(new THREE.Mesh(this.probeGeo, this.probeMat));
      const top = new THREE.Mesh(this.probeTopGeo, this.probeTopMat);
      top.position.y = 5.4;
      pin.add(top);
      g.add(pin);
    }
    list.forEach((p, k) => {
      const ground = this.world.sampleHeight(p.x, p.z), sea = this.world.seaLevel > -999 ? this.world.seaLevel : -1e9;
      g.children[k].position.copy(this.toWorld(p.x, p.z, Math.max(ground, sea)));
    });
  }

  /** Markers for the pollution sources: brown-orange posts. */
  syncOutfalls() {
    const g = this.outfallGroup, src = this.world.pollSources || [];
    while (g.children.length > src.length) g.remove(g.children[g.children.length - 1]);
    while (g.children.length < src.length) g.add(new THREE.Mesh(this.springGeo, this.outfallMat));
    src.forEach((s, k) => {
      const ground = this.world.sampleHeight(s.x, s.z), sea = this.world.seaLevel > -999 ? this.world.seaLevel : -1e9;
      g.children[k].position.copy(this.toWorld(s.x, s.z, Math.max(ground, sea) + 1.5));
    });
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
const SOIL_THIN = [0.88, 0.85, 0.76], SOIL_MID = [0.72, 0.48, 0.24], SOIL_DEEP = [0.22, 0.13, 0.07];
const SOIL_COVER = [0.86, 0.84, 0.78];
const CHEM_ACID = [0.55, 0.30, 0.62], CHEM_NEUTRAL = [0.88, 0.86, 0.80], CHEM_ALKALI = [0.20, 0.62, 0.56];
const HARD_SOFT = [0.98, 0.84, 0.36], HARD_MID = [0.86, 0.45, 0.24], HARD_HARD = [0.16, 0.20, 0.44];
const PRECIP_DRY = [0.86, 0.74, 0.52], PRECIP_WET = [0.12, 0.35, 0.75];
const NO_SNOW = [0.55, 0.53, 0.48], SNOW_THIN = [0.88, 0.92, 0.98], SNOW_MID = [0.55, 0.72, 0.95], SNOW_DEEP = [0.18, 0.30, 0.75];
const TOPO_STOPS = [[0.0, [0.42, 0.62, 0.38]], [0.2, [0.62, 0.76, 0.46]], [0.42, [0.90, 0.86, 0.58]],
  [0.62, [0.80, 0.62, 0.40]], [0.82, [0.62, 0.48, 0.40]], [1.0, [0.97, 0.97, 0.97]]];
const TOPO_SHALLOW = [0.62, 0.80, 0.92], TOPO_DEEP = [0.25, 0.45, 0.72];
/** Classic hypsometric tints: green lowlands → tan → brown → white summits. */
function topoColor(t, out) {
  for (let k = 1; k < TOPO_STOPS.length; k++) {
    if (t <= TOPO_STOPS[k][0]) {
      const [t0, c0] = TOPO_STOPS[k - 1], [t1, c1] = TOPO_STOPS[k];
      return mix(c0, c1, (t - t0) / (t1 - t0), out);
    }
  }
  return mix(TOPO_STOPS[5][1], TOPO_STOPS[5][1], 0, out);
}
/** A round contour interval (1, 2, 2.5, 5 × a power of ten) near x. */
function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 0.01))));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p;
}
const DUNE = [0.86, 0.82, 0.62], CORAL_SAND = [0.97, 0.95, 0.88], MANGROVE = [0.12, 0.30, 0.16];
const SEA_COLD_SHALLOW = [0.20, 0.38, 0.40], SEA_COLD_DEEP = [0.06, 0.20, 0.27];
const SEA_TEMP_SHALLOW = [0.22, 0.48, 0.62], SEA_TEMP_DEEP = [0.08, 0.26, 0.48];
const SEA_TROP_SHALLOW = [0.30, 0.78, 0.80], SEA_TROP_DEEP = [0.06, 0.38, 0.62];
const ICE = [0.80, 0.89, 0.97], ICE_DIRTY = [0.55, 0.55, 0.55];
const ICE_THIN = [0.82, 0.93, 0.98], ICE_MID = [0.45, 0.72, 0.92], ICE_DEEP = [0.12, 0.28, 0.62];
const DECID_NONE = [0.10, 0.32, 0.22], DECID_FULL = [0.95, 0.60, 0.12];
const TWIGS = [0.40, 0.34, 0.29], FLUSH = [0.58, 0.80, 0.30], STRAW = [0.72, 0.64, 0.40];
const AGE_YOUNG = [0.72, 0.86, 0.42], AGE_OLD = [0.05, 0.24, 0.10], NO_FOREST = [0.84, 0.82, 0.76];
const WATER_SEA = [0.16, 0.42, 0.62], WATER_SHALLOW = [0.40, 0.68, 0.82], WATER_DEEP = [0.18, 0.45, 0.70], MUD = [0.55, 0.42, 0.28];
const BED_TMP = [0, 0, 0];
const SPOT_WHITE = [0.97, 0.97, 0.96];
const OV_LAND = [0.80, 0.80, 0.78], OV_SEA = [0.30, 0.38, 0.48];
/** The world-dynamics overlays: value(world, i) 0…1 shown from `lo` to `hi` over grey land. */
const OV_SIMPLE = {
  beetles: { lo: [0.86, 0.62, 0.30], hi: [0.62, 0.18, 0.10], value: (w, i) => (w.barkBeetle ? w.barkBeetle[i] : 0), base: (w, i) => (w.conifer && w.vegetation[i] > 0.6 && w.conifer[i] > 0.5 ? [0.40, 0.58, 0.42] : OV_LAND) },
  cropPests: { lo: [0.92, 0.80, 0.40], hi: [0.52, 0.32, 0.12], value: (w, i) => (w.cropPest && w.landUse && w.landUse[i] === 1 ? Math.max(0.03, w.cropPest[i]) : 0) },
  soilSalt: { lo: [0.86, 0.82, 0.62], hi: [0.98, 0.98, 0.96], value: (w, i) => (w.soilSalt ? w.soilSalt[i] * 1.3 : 0), base: (w, i) => (w.irrigated && w.irrigated[i] ? [0.45, 0.66, 0.78] : OV_LAND) },
  ruins: { lo: [0.62, 0.58, 0.52], hi: [0.30, 0.28, 0.26], value: (w, i) => (w.ruins ? w.ruins[i] : 0) },
  wetlands: { lo: [0.82, 0.62, 0.34], hi: [0.52, 0.30, 0.14], value: (w, i) => (w.drained && w.drained[i] ? 0.5 + 0.5 * (w.humus ? Math.min(1, w.humus[i]) : 0.5) : 0), base: (w, i) => (w.nearWater && w.soil && w.nearWater[i] > 0.5 && w.soil[i] > 0.7 && w.vegetation[i] > 0.35 ? [0.26, 0.52, 0.48] : OV_LAND) },
  heat: { lo: [0.98, 0.86, 0.50], hi: [0.86, 0.16, 0.10], value: (w, i) => (w.heatIsland ? w.heatIsland[i] / 2.5 : 0) },
  beaches: { lo: [0.96, 0.66, 0.40], hi: [0.80, 0.20, 0.14], value: (w, i) => (w.starved ? w.starved[i] : 0), base: (w, i) => (w.levee && w.levee[i] > 0 ? [0.20, 0.30, 0.80] : w.shore && w.shore[i] === 1 ? [0.94, 0.86, 0.62] : OV_LAND) },
  seeds: { lo: [0.86, 0.90, 0.70], hi: [0.10, 0.40, 0.20], value: (w, i) => { const S = w.speciesHere; if (!S || w.vegetation[i] < 0.2) return 0; let b = S[i], c = 0; while (b) { b &= b - 1; c++; } return c / 8; } },
};
const PF_NONE = [0.78, 0.78, 0.76], PF_FROZEN = [0.16, 0.36, 0.72], PF_EDGE = [0.62, 0.86, 0.92], PF_THAWING = [0.86, 0.24, 0.16], PF_THAWED = [0.56, 0.40, 0.26], PF_SEA = [0.30, 0.38, 0.48];
const BARK_BEETLE = [0.62, 0.30, 0.16], RUIN_A = [0.58, 0.56, 0.52], RUIN_B = [0.46, 0.45, 0.42], SALT_CRUST = [0.93, 0.92, 0.88], BLIGHT = [0.52, 0.42, 0.22];
const LU_CORE = [0.55, 0.10, 0.12];
const CORE_STREET = [0.34, 0.34, 0.36], CORE_BLOCK = [0.52, 0.51, 0.50], CORE_ROOF = [0.42, 0.36, 0.34];
const FU_NONE = [0.86, 0.84, 0.78], FU_SOME = [0.45, 0.66, 0.40], FU_RICH = [0.40, 0.22, 0.55], FU_ROT = [0.95, 0.62, 0.20], FU_KILL = [0.80, 0.18, 0.12];
const FF_BG = [0.74, 0.78, 0.70], FF_ASH = [0.62, 0.58, 0.54], FF_BIG = [0.30, 0.29, 0.29], FF_FIRE = [0.95, 0.35, 0.10], FF_WEED = [0.85, 0.20, 0.62], FF_POPPY = [0.98, 0.58, 0.10];
const FISH_LAND = [0.70, 0.70, 0.68], FISH_GONE = [0.80, 0.20, 0.15], FISH_LOW = [0.95, 0.80, 0.30], FISH_FULL = [0.10, 0.30, 0.65], FISH_RESERVE = [0.20, 0.80, 0.50], POL_NONE = [0.55, 0.55, 0.57], POL_FULL = [1.0, 0.80, 0.15], POL_FIELD = [0.35, 0.22, 0.10], FUEL_NONE = [0.80, 0.80, 0.78], FUEL_LOW = [0.35, 0.65, 0.35], FUEL_MID = [0.95, 0.80, 0.25], FUEL_HIGH = [0.80, 0.15, 0.10], FUEL_GUARD = [0.20, 0.40, 0.90], CARB_LOW = [0.90, 0.88, 0.80], CARB_MID = [0.55, 0.70, 0.35], CARB_HIGH = [0.05, 0.22, 0.12], GW_DRY = [0.86, 0.76, 0.55], GW_MID = [0.55, 0.72, 0.80], GW_FULL = [0.10, 0.28, 0.62], GW_SAME = [0.84, 0.86, 0.88], GW_DOWN = [0.80, 0.15, 0.12], GW_SUNK = [0.25, 0.10, 0.08], POP_BG = [0.55, 0.56, 0.58], POP_HEAT = [[0.25, 0.10, 0.45], [0.80, 0.15, 0.25], [0.98, 0.55, 0.10], [1.0, 0.95, 0.60]], ONE_LIGHT = [0.86, 0.86, 0.88], ONE_DARK = [0.26, 0.27, 0.30], FOOTPATH = [0.80, 0.68, 0.48], INVASIVE = [0.10, 0.26, 0.28], INV_OPEN = [0.86, 0.85, 0.80], INV_NATIVE = [0.30, 0.62, 0.30], INV_FULL = [0.66, 0.16, 0.38], MINE_A = [0.30, 0.27, 0.25], MINE_B = [0.38, 0.33, 0.29], SPOIL = [0.70, 0.48, 0.26], DEGRADED = [0.82, 0.72, 0.52], AIR_CLEAN = [0.86, 0.90, 0.92], DIS_HEALTHY = [0.55, 0.70, 0.52], FIRE_BG_LO = [0.86, 0.84, 0.80], FIRE_BG_HI = [0.70, 0.78, 0.68], FIRE_TMP = [0, 0, 0], AIR_DIRTY = [0.35, 0.28, 0.22];
const LU_OPEN = [0.86, 0.85, 0.80], LU_WILD = [0.62, 0.70, 0.56], LU_IRRIGATED = [0.55, 0.80, 0.45], LU_FELLED = [0.70, 0.60, 0.36], LU_EDGE = [0.02, 0.18, 0.06], LU_RESTING = [0.56, 0.80, 0.56];
const BOULDER = [0.56, 0.55, 0.52];
const LU_COLORS = { 11: [0.30, 0.27, 0.25], 12: [0.85, 0.50, 0.20], 1: [0.95, 0.80, 0.30], 2: [0.86, 0.28, 0.22], 3: [0.30, 0.30, 0.34], 4: [0.58, 0.36, 0.74], 5: [0.98, 0.55, 0.15], 6: [0.70, 0.70, 0.72], 7: [0.95, 0.95, 0.95], 8: [0.25, 0.80, 0.90], 9: [0.35, 0.25, 0.15], 10: [0.09, 0.48, 0.20], 13: [0.55, 0.42, 0.30], 14: [0.48, 0.48, 0.46] };
const FIELD_A = [0.78, 0.70, 0.38], FIELD_B = [0.52, 0.62, 0.30], TOWN_PAVE = [0.62, 0.60, 0.57], TOWN_ROOF = [0.66, 0.40, 0.32], ROAD = [0.30, 0.30, 0.32], ROAD_WORN = [0.55, 0.52, 0.46], INDUSTRY = [0.50, 0.53, 0.57], HARBOR_A = [0.46, 0.34, 0.22], QUAY = [0.66, 0.65, 0.61], DAM = [0.78, 0.77, 0.74], CANAL = [0.56, 0.52, 0.44], SEWER = [0.30, 0.26, 0.20], PLANTATION = [0.16, 0.30, 0.15], PLANTATION_ROW = [0.11, 0.22, 0.11], CLEARCUT = [0.47, 0.39, 0.27], BRIDGE = [0.36, 0.34, 0.33], QUAY_DARK = [0.46, 0.45, 0.43], HARBOR_B = [0.60, 0.58, 0.55], INDUSTRY_DARK = [0.24, 0.25, 0.28], DIRTY_RIVER = [0.58, 0.47, 0.16], POLLUTED_BANK = [0.42, 0.36, 0.20];
const TREES_NONE = [0.86, 0.84, 0.78], TREES_SPARSE = [0.78, 0.84, 0.58], TREES_MID = [0.36, 0.62, 0.30], TREES_DENSE = [0.06, 0.26, 0.12];
const HEALTH_BAD = [0.80, 0.25, 0.18], HEALTH_MID = [0.92, 0.78, 0.30], HEALTH_GOOD = [0.18, 0.60, 0.28];
const BEETLE_RED = [0.62, 0.32, 0.18], DEAD_WOOD = [0.52, 0.48, 0.44], SALMON_RUN = [0.80, 0.30, 0.30], WILD_NONE = [0.80, 0.80, 0.78];
const WIND_CALM = [0.86, 0.90, 0.92], WIND_BREEZE = [0.45, 0.72, 0.80], WIND_STRONG = [0.20, 0.38, 0.72], WIND_GALE = [0.52, 0.20, 0.58];
/** Wind overlay colour: calm (pale) → breezy (teal) → strong (blue) → gale (purple). */
function windColor(v, out) {
  return v < 0.6 ? mix(WIND_CALM, WIND_BREEZE, v / 0.6, out) : v < 1.1 ? mix(WIND_BREEZE, WIND_STRONG, (v - 0.6) / 0.5, out) : mix(WIND_STRONG, WIND_GALE, Math.min(1, (v - 1.1) / 0.6), out);
}
const BLOOM = [0.32, 0.58, 0.30], RED_TIDE = [0.62, 0.36, 0.24], FOAM = [0.95, 0.97, 0.98], ICE_SEA = [0.90, 0.94, 0.97];
const SILT_WATER = [0.78, 0.58, 0.34], FOUL_WATER = [0.58, 0.58, 0.30];
const Q_FOUL = [0.45, 0.25, 0.12], Q_MID = [0.78, 0.68, 0.36], Q_CLEAR = [0.20, 0.55, 0.85];
/** Water-quality overlay colour: brown (foul) → khaki → clear blue. */
function qualityColor(q, out) { return q < 0.5 ? mix(Q_FOUL, Q_MID, q * 2, out) : mix(Q_MID, Q_CLEAR, (q - 0.5) * 2, out); }

/** Barren brown (0) → light-green grassland (0.5) → deep-green forest (1). */
function vegColor(v, out) {
  // Sharpen the transitions a little so the three biomes read as distinct patches
  if (v < 0.5) return mix(C.barren, C.grass, smooth(0.15, 0.45, v), out);
  return mix(C.grass, C.forest, smooth(0.55, 0.8, v), out);
}

/** Temperature ramp: deep blue (−15 °C) → white (0) → green (12) → yellow (22) → red (35). */
const TEMP_RAMP = [[-15, [0.15, 0.25, 0.65]], [0, [0.92, 0.94, 0.98]], [12, [0.35, 0.65, 0.35]], [22, [0.95, 0.80, 0.30]], [35, [0.80, 0.20, 0.12]]];
function tempColor(t, out) {
  if (t <= TEMP_RAMP[0][0]) return mix(TEMP_RAMP[0][1], TEMP_RAMP[0][1], 0, out);
  for (let k = 1; k < TEMP_RAMP.length; k++) {
    if (t <= TEMP_RAMP[k][0]) {
      const [t0, c0] = TEMP_RAMP[k - 1], [t1, c1] = TEMP_RAMP[k];
      return mix(c0, c1, (t - t0) / (t1 - t0), out);
    }
  }
  return mix(TEMP_RAMP[4][1], TEMP_RAMP[4][1], 0, out);
}

/** Lava glow by temperature: dark crust → red → orange → yellow-white at the vent. */
const LAVA_RAMP = [[0.18, 0.09, 0.07], [0.62, 0.10, 0.04], [1.0, 0.42, 0.08], [1.0, 0.86, 0.45]];
function lavaColor(t) {
  const x = Math.min(0.999, Math.max(0, t)) * (LAVA_RAMP.length - 1);
  const k = x | 0;
  return mix(LAVA_RAMP[k], LAVA_RAMP[k + 1], x - k, S4);
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
