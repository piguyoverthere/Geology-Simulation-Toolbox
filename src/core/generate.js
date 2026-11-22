import { createNoise2D, fbm, ridged, mulberry32 } from './noise.js';
import { initVegetation } from '../sim/vegetation.js';
import { generateGeology } from './rocks.js';
import { boxBlur, breachDepressions, carveRivers } from './grid.js';

/**
 * Terrain presets. Each fills world.height with a starting landscape that erosion can then work on.
 * Heights are in world units (1 unit = 1 grid cell horizontally).
 */
export const PRESETS = {
  hills: { label: 'Rolling hills' },
  mountains: { label: 'Ridged mountains' },
  plateau: { label: 'Layered plateau' },
  volcano: { label: 'Volcanic cone' },
  cascades: {
    label: 'Cascade Range',
    // Prevailing westerlies off the Pacific (wind blowing toward +x, i.e. east), cool temperate
    climate: { seaTemp: 12, windAngle: 0, summerDry: 0.8, oceanFog: 0.3 },
  },
  pugetsound: {
    label: 'Puget Sound',
    // The glacier-carved Sound: clustered islands across the whole map
    climate: { seaTemp: 11, windAngle: 0, summerDry: 0.8, oceanFog: 1 },
    sea: { enabled: true, level: 3 },
    coast: { tideRange: 3.5, waveErosion: 0.005 },
  },
  showcase: {
    label: 'Showcase (demo)',
    // A bit of everything, west to east: open ocean with islands and a reef-fringed lagoon, a
    // sheltered tidal bay, a forested coastal plain, a snowy range with a volcano and glaciers, and
    // a dry, wind-worn sandstone plateau in its rain shadow. A sea at coral's limit, real seasons.
    climate: { seaTemp: 19, lapse: 0.45, windAngle: 0, summerDry: 0.6, storms: 1.3, snowstorms: 1.2, oceanFog: 0.6 },
    seasons: { enabled: true, swing: 10 },
    weather: { lightning: 1 },
    sea: { enabled: true, level: 3 },
    coast: { tideRange: 3, waveErosion: 0.005, coral: 1.5 },
    ocean: { currents: 1, surge: 1.2, blooms: 1.2 },
  },
  flat: { label: 'Flat plain' },
};

export function generateTerrain(world, preset = 'mountains', seed = 1) {
  const N = world.N;
  const noise = createNoise2D(seed);
  const h = world.height;
  // Noise is sampled per 256 cells, so a bigger map shows more land at the same level of detail;
  // the layout (centre, falloff, the Cascade crest) is relative to the map.
  const scale = 1 / 256, layout = 1 / N;
  world.cones = [];
  world.moistureBias = null;
  world.gapCold = null;
  const cascades = preset === 'cascades' ? cascadeLayout(N, noise) : null;
  if (cascades) {
    world.cones = cascades.cones; world.moistureBias = new Float32Array(N * N); world.gapCold = new Float32Array(N * N);
  }
  const puget = preset === 'pugetsound' ? pugetLayout(N, noise, seed) : null;
  const show = preset === 'showcase' ? showcaseLayout(seed) : null;
  if (show) { world.moistureBias = new Float32Array(N * N); world.cones = [{ x: show.vx * N, z: show.vz * N, r: 0.11 * N }]; }
  if (puget) world.moistureBias = new Float32Array(N * N);

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const u = x * scale, v = z * scale;
      // Distance from centre, for presets that fall off toward the edges
      const dx = x * layout - 0.5, dz = z * layout - 0.5;
      const r = Math.sqrt(dx * dx + dz * dz);
      let y = 0;

      switch (preset) {
        case 'hills':
          y = 18 + 22 * fbm(noise, u * 3, v * 3, 6);
          break;
        case 'mountains': {
          const falloff = 1 - Math.min(1, r * 1.6);
          y = 6 + 48 * ridged(noise, u * 2.2, v * 2.2, 7) * (0.35 + 0.65 * falloff) + 3 * fbm(noise, u * 8, v * 8, 4);
          break;
        }
        case 'plateau': {
          // A raised table of flat-lying rock with a gently tilted, noisy edge: perfect for
          // watching strata get cut into cliffs, mesas and buttes.
          const edge = 0.32 + 0.08 * fbm(noise, u * 4, v * 4, 4);
          const t = smoothstep(edge + 0.06, edge - 0.06, r);
          y = 6 + 32 * t + 3 * fbm(noise, u * 10, v * 10, 4);
          break;
        }
        case 'volcano': {
          const cone = Math.max(0, 1 - r * 2.6);
          const crater = Math.max(0, 1 - r * 22);
          y = 8 + 75 * Math.pow(cone, 1.6) - 22 * crater * crater + 3 * fbm(noise, u * 9, v * 9, 5);
          break;
        }
        case 'cascades':
          y = cascadeHeight(cascades, noise, x * layout, z * layout, u, v);
          world.moistureBias[z * N + x] = cascadeMoisture(cascades, x * layout, z * layout);
          world.gapCold[z * N + x] = cascadeGap(cascades, x * layout, z * layout);
          break;
        case 'pugetsound':
          y = pugetHeight(puget, noise, x * layout, z * layout, u, v);
          world.moistureBias[z * N + x] = 0.3; // the wet, mild lowland under the marine air
          break;
        case 'showcase':
          y = showcaseHeight(show, noise, x * layout, z * layout, u, v);
          world.moistureBias[z * N + x] = 0.35 - 0.8 * smoothstep(0.58, 0.8, x * layout); // wet coast, dry lee
          break;
        case 'flat':
        default:
          y = 10 + 0.6 * fbm(noise, u * 6, v * 6, 3);
      }
      h[z * N + x] = y;
    }
  }

  if (preset === 'cascades') {
    // Soften any remaining roughness; the big crests and summits survive a light blur
    h.set(boxBlur(h, N, 1));
  }
  if (preset === 'pugetsound') straightenShore(h, N, PRESETS.pugetsound.sea.level, 14);
  if (preset === 'showcase') straightenShore(h, N, PRESETS.showcase.sea.level, 8);
  if (preset !== 'flat') smoothLowlands(world, noise);
  // Real landscapes drain: almost every spot has a downhill route to the sea. Raw noise leaves
  // hundreds of closed basins where each river would die in its own little lake. Carve an outlet
  // from each one; the outlets merge into a branching valley network. The volcano keeps its crater
  // but not the little hollows on its flanks (left closed, they fill into stepped ponds).
  const crater = preset === 'volcano' ? (i) => Math.hypot(i % N - N / 2, ((i / N) | 0) - N / 2) < N * 0.06
    : preset === 'pugetsound' ? (i) => h[i] < PRESETS.pugetsound.sea.level // the Sound's basins are sea, not lakes to drain
    : preset === 'showcase' ? (i) => h[i] < PRESETS.showcase.sea.level || Math.hypot(i % N - show.vx * N, ((i / N) | 0) - show.vz * N) < N * 0.014
    : null;
  world.keepBasin = crater; // later re-breaching (after landslides) leaves the crater alone too
  breachDepressions(h, N, 0.02, crater);
  // Cut the drainage network: tributaries merging into deeper trunk channels
  if (preset !== 'flat') {
    // The Cascades have a few big rivers (Skagit, Snoqualmie, Yakima…) in broad valleys, not a
    // channel in every hollow, and the lowland and plateau are mostly flat
    carveRivers(h, N, preset === 'cascades' || preset === 'pugetsound' || preset === 'showcase' ? { threshold: 2500 * (N / 256) ** 2, depth: 1.2, perDoubling: 0.7, maxDepth: 4 } : undefined);
    breachDepressions(h, N, 0.02, crater);
  }

  generateGeology(world, preset, seed);
  world.setBaseline();
  world.clearWater();
  world.sources.length = 0;
  world.pollSources = [];
  world.currentPaths = [];
  // (your animals carry over to the new map, but with no population yet: paint them in)
  for (const k of ['dam', 'deadWood', 'browse', 'salmonN', 'treeKill', 'runners']) if (world[k]) world[k].fill(0);
  for (const a of world.animals || []) { for (const k of ['animal_', 'hunger_']) { const f = world[k + a.id]; if (f) f.fill(0); } a.stock = 1; a.starving = 0; }
  world.popHistory = {};
  world.statHistory = {};
  initVegetation(world, seed);
  world.dirty = true;
}

/**
 * Real lowlands are mostly smooth: valleys and plains are filled with sediment that buries the
 * small bumps. Raw noise leaves lots of little dimples there, which fill with water into a honeycomb
 * of puddles. Blur the low ground, but leave a few patches rough (like a field of kettle ponds).
 */
function smoothLowlands(world, noise) {
  const N = world.N, H = world.height;
  let lo = Infinity, hi = -Infinity;
  for (const h of H) { if (h < lo) lo = h; if (h > hi) hi = h; }
  // A light blur: enough to remove noise dimples, not so much that valleys turn into broad flat
  // floors (water spreads across those as a sheet instead of gathering into a river)
  const blurred = boxBlur(H, N, 2);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const t = (H[i] - lo) / (hi - lo || 1);
      const low = 1 - smoothstep(0.15, 0.4, t);
      const keepRough = smoothstep(0.68, 0.82, 0.5 + 0.5 * noise(x / 60 + 91.7, z / 60 - 13.2));
      const w = low * (1 - keepRough);
      H[i] += (blurred[i] - H[i]) * w;
    }
  }
}

/**
 * The Cascade Range, simplified. A north–south volcanic and metamorphic range across the middle of
 * the map, between a low, wet, forested lowland to the west (the Puget Sound lowland) and a high,
 * dry basalt plateau to the east (the Columbia Plateau), in the rain shadow.
 *
 * Along the range: the far north is a dense cluster of rugged, glaciated peaks (the North
 * Cascades); a lower gap crosses the range a little south of the middle (Snoqualmie Pass, where
 * I-90 crosses at only ~900 m); the south is a medium-height range topped by a few big, isolated
 * stratovolcanoes standing far above it (Rainier, Adams, St Helens). The crest wanders a little.
 */
function cascadeLayout(N, noise) {
  const cones = [];
  // Big volcanoes: one giant just west of the crest south of the pass, two smaller further south,
  // and one in the north cluster (Glacier Peak / Baker)
  const at = (u, v, height, radius) => cones.push({ x: u * N, z: v * N, height, r: radius * Math.min(N, 384) });
  at(0.47, 0.70, 46, 0.075);
  at(0.55, 0.88, 32, 0.06);
  at(0.42, 0.86, 26, 0.05);
  at(0.50, 0.14, 26, 0.05);
  return { N, cones, crest: (v) => 0.5 + 0.05 * noise(v * 2.2, 3.7) };
}

function cascadeHeight(c, noise, lu, lv, u, v) {
  const axis = c.crest(lv);
  const d = lu - axis; // − west, + east of the crest
  // Cross-section: low wet lowland in the west, the range, then a high dry plateau in the east
  // A flat-topped bell: the range rises fairly abruptly out of the lowland (small foothills)
  const range = Math.exp(-Math.pow(Math.abs(d) / 0.105, 2.6));
  const plateau = smoothstep(0.08, 0.28, d) * 6;
  const lowland = 3 + 3 * smoothstep(-0.45, -0.15, d);
  // Along the range: dense high cluster in the north, the pass, medium heights in the south
  const north = 1 - smoothstep(0.25, 0.42, lv);
  const pass = Math.exp(-((lv - 0.56) ** 2) / (2 * 0.035 * 0.035));
  const clusters = 0.5 + 0.5 * noise(lv * 4 + 11, 0.3); // other knots of higher peaks
  const amp = (34 + 18 * north + 12 * clusters) * (1 - 0.6 * pass);
  // Mountains as crests leading up to summits (as they look from above): a few octaves of warped
  // ridged noise give long, clean ridgelines with smooth flanks between them, and a broad "massif"
  // field lifts groups of crests into summits. No fine noise, so slopes aren't jagged.
  const wu = u + 0.12 * noise(u * 3 + 5.1, v * 3), wv = v + 0.12 * noise(u * 3, v * 3 + 9.3);
  const crest = ridged(noise, wu * 2.1, wv * 2.1, 3);
  const massif = 0.5 + 0.5 * noise(u * 1.4 + 21.7, v * 1.4 - 7.2);
  const mountain = (0.4 + 1.35 * Math.pow(crest, 1.4)) * (0.65 + 0.85 * massif * massif);
  let y = lowland + plateau + range * amp * mountain;
  // Gentle swells on the lowland and plateau (both are nearly flat in reality)
  y += (0.6 + 1.2 * range) * fbm(noise, u * 4, v * 4, 3);
  // Stratovolcanoes rise above everything around them
  for (const k of c.cones) {
    const r = Math.hypot(lu * c.N - k.x, lv * c.N - k.z) / k.r;
    if (r < 1) y += k.height * Math.pow(1 - r, 1.7);
  }
  return y;
}

/**
 * Winter cold-air gap flow: interior air spills west through the low pass (Snoqualmie Pass on I-90),
 * strongest in the pass itself and fading down its approaches.
 */
function cascadeGap(c, lu, lv) {
  const d = lu - c.crest(lv);
  const pass = Math.exp(-((lv - 0.56) ** 2) / (2 * 0.05 * 0.05));
  const near = Math.exp(-Math.pow(Math.abs(d) / 0.14, 2));
  return pass * near;
}

/**
 * Puget Sound: the Puget lowland, carved by the Ice Age ice sheet into long north–south troughs now
 * flooded by the sea, with the glacial upland left between them as islands and peninsulas. The whole
 * map is the Sound: islands in clusters (Vashon and Maury, Bainbridge, the South Sound group, the San
 * Juans) with open basins between, sparse in places, plus a few lone islands out in open water.
 */
function pugetLayout(N, noise, seed) {
  // Clusters sit on a jittered 3×3 grid over the whole map; some grid cells are left empty, so the
  // islands are crowded in places and sparse in others. Each island is a lobe stretched north–south,
  // as the ice sheet streamlined them. (In map units, so bigger maps add detail, not more islands.)
  const rnd = mulberry32(seed * 977 + 13);
  const islands = [];
  const add = (x, z, size) => islands.push({
    x, z, rx: (0.012 + rnd() * 0.016) * size, rz: (0.03 + rnd() * 0.05) * size, tilt: (rnd() - 0.5) * 0.5,
  });
  const G = 3, cell = 1 / G;
  for (let gz = 0; gz < G; gz++) {
    for (let gx = 0; gx < G; gx++) {
      if (rnd() < 0.25) continue; // an open basin
      const cx = (gx + 0.25 + rnd() * 0.5) * cell, cz = (gz + 0.25 + rnd() * 0.5) * cell;
      const n = 2 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) add(cx + (rnd() - 0.5) * 0.18, cz + (rnd() - 0.5) * 0.22, k === 0 ? 2.1 + rnd() * 0.8 : 0.8 + rnd() * 0.8);
    }
  }
  for (let k = 0; k < 4; k++) add(0.06 + rnd() * 0.88, 0.06 + rnd() * 0.88, 0.4 + rnd() * 0.5);
  return { N, islands };
}

function pugetHeight(c, noise, lu, lv, u, v) {
  // The glacial upland of till, streamlined north–south by the ice (drumlins), standing ~8 above the
  // sea where it survives as islands
  let y = 13 + 2.5 * fbm(noise, u * 5, v * 2, 3);
  // Land vs water: the islands' lobes, slightly warped so no two are alike
  const wu = lu + 0.04 * noise(lu * 3 + 1.7, lv * 3), wv = lv + 0.04 * noise(lu * 3, lv * 3 + 3.3);
  let isl = -1;
  for (const k of c.islands) {
    const dx = wu - k.x, dz = wv - k.z;
    const ax = dx * Math.cos(k.tilt) - dz * Math.sin(k.tilt), az = dx * Math.sin(k.tilt) + dz * Math.cos(k.tilt);
    isl = Math.max(isl, 1 - Math.sqrt((ax / k.rx) ** 2 + (az / k.rz) ** 2));
  }
  // Island edges: lobed and irregular, with a little fine roughness on the shore that the waves
  // then straighten
  isl += 0.25 * fbm(noise, lu * 14 + 3.1, lv * 7 - 1.2, 3);
  const landness = isl * 0.25 + 0.02 * fbm(noise, lu * 22, lv * 14, 2);
  // The bigger islands rise a little toward their middles
  y += 5 * smoothstep(0.05, 0.5, isl) * (0.6 + 0.4 * fbm(noise, u * 4 + 9, v * 4, 3));
  // Water where the pattern dips below zero; the edge is a steep bluff, the channel floor broad and
  // deepening away from the islands (the troughs run 100–280 m deep in the real Sound)
  const water = smoothstep(0.02, -0.1, landness);
  y -= water * (17 + 5 * smoothstep(-0.1, -0.6, landness));
  return y;
}

/** Showcase: where the volcano and the islands go. */
function showcaseLayout(seed) {
  const rnd = mulberry32(seed * 613 + 7);
  const islands = [];
  const add = (x, z, size) => islands.push({ x, z, rx: (0.012 + rnd() * 0.014) * size, rz: (0.025 + rnd() * 0.04) * size, tilt: (rnd() - 0.5) * 0.6 });
  // Two clusters and a few lone islands out at sea
  for (const cz of [0.22 + rnd() * 0.12, 0.6 + rnd() * 0.15]) {
    const cx = 0.12 + rnd() * 0.08, k = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < k; j++) add(cx + (rnd() - 0.5) * 0.14, cz + (rnd() - 0.5) * 0.18, j === 0 ? 2.6 : 1.0 + rnd() * 0.9);
  }
  for (let j = 0; j < 3; j++) add(0.05 + rnd() * 0.18, 0.08 + rnd() * 0.84, 0.7 + rnd() * 0.5);
  return { islands, vx: 0.6 + rnd() * 0.06, vz: 0.22 + rnd() * 0.12 };
}

function showcaseHeight(c, noise, lu, lv, u, v) {
  const coast = 0.3 + 0.03 * noise(lv * 4, 7.7);
  const inland = lu - coast;
  // The range: a ridged crest down the middle, rising from a forested coastal plain
  const crest = 0.58 + 0.04 * noise(lv * 3, 2.2), dm = lu - crest;
  const range = Math.exp(-(dm * dm) / (2 * 0.07 * 0.07));
  let y = 6 + 9 * smoothstep(0, 0.25, inland) + range * (16 + 36 * Math.pow(ridged(noise, u * 2.4, v * 2.4, 6), 1.3)) + 2.5 * fbm(noise, u * 5, v * 5, 4);
  // The dry plateau in its lee, capped by flat-lying sandstone
  y += smoothstep(0.66, 0.8, lu) * (9 + 2.5 * fbm(noise, u * 3 + 4, v * 3, 3));
  // A stratovolcano on the range, with a summit crater
  const r = Math.hypot(lu - c.vx, lv - c.vz);
  const cone = Math.max(0, 1 - r / 0.11), crater = Math.max(0, 1 - r / 0.014);
  y += 46 * Math.pow(cone, 1.7) - 9 * crater * crater;
  // Land vs sea: the coast, the islands' lobes, and a long sheltered bay cut into the plain
  let isl = -1;
  const wu = lu + 0.03 * noise(lu * 3 + 1.7, lv * 3), wv = lv + 0.03 * noise(lu * 3, lv * 3 + 3.3);
  for (const k of c.islands) {
    const dx = wu - k.x, dz = wv - k.z;
    const ax = dx * Math.cos(k.tilt) - dz * Math.sin(k.tilt), az = dx * Math.sin(k.tilt) + dz * Math.cos(k.tilt);
    isl = Math.max(isl, 1 - Math.sqrt((ax / k.rx) ** 2 + (az / k.rz) ** 2));
  }
  isl += 0.25 * fbm(noise, lu * 14 + 3.1, lv * 7 - 1.2, 3);
  const bay = Math.exp(-(((lv - 0.72 - 0.03 * noise(lu * 6, 9.1)) / 0.06) ** 2)) * smoothstep(coast + 0.2, coast + 0.02, lu);
  const landness = Math.max(isl * 0.25, inland * 2.5) - bay * 0.6 + 0.02 * fbm(noise, lu * 22, lv * 14, 2);
  const water = smoothstep(0.02, -0.1, landness);
  // The sea floor: a shallow shelf near land, deepening offshore; the bay stays shallow (tidal flats)
  const floor = 1.5 - 6 * smoothstep(-0.02, -0.3, landness) * (1 - 0.7 * bay) - 8 * smoothstep(0.12, 0.0, lu);
  // Islands stand lower than the mainland
  const islandTop = 5 + 6 * smoothstep(0.05, 0.5, isl);
  if (inland < 0) y = Math.min(y, islandTop + 2 * fbm(noise, u * 6, v * 6, 3));
  return y + (floor - y) * water;
}

/** Long-term wetness offset: the Pacific side soaked, the plateau beyond the mountains dry. */
function cascadeMoisture(c, lu, lv) {
  const d = lu - c.crest(lv);
  // Wet west; pine on the drier east slopes; then shrub-steppe, and desert only far to the east
  return 0.45 - 0.75 * smoothstep(-0.04, 0.34, d);
}

/**
 * Waves and longshore drift straighten a coast: sand fills the coves and the bumps are planed off, so
 * beaches run in fairly straight stretches between points. Here: repeatedly blend heights near the
 * waterline toward their neighbours' average.
 */
export function straightenShore(H, N, sea, iters = 1, k = 0.5) {
  const tmp = new Float32Array(H.length);
  for (let it = 0; it < iters; it++) {
    tmp.set(H);
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        const i = z * N + x, h = tmp[i];
        if (h < sea - 3 || h > sea + 3) continue;
        const avg = (tmp[i - 1] + tmp[i + 1] + tmp[i - N] + tmp[i + N] + tmp[i - N - 1] + tmp[i - N + 1] + tmp[i + N - 1] + tmp[i + N + 1]) / 8;
        H[i] = h + (avg - h) * k;
      }
    }
  }
}

function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
