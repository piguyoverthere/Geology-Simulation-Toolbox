// Tree species and forest composition.
//
// A forest is a mix of species, each competing where conditions suit it best:
//   temperature    – spruce and larch take the cold, tropical hardwoods and palms the heat
//   moisture       – alder and willow need wet ground by water; acacia and juniper tolerate drought
//   forest age     – pioneers (aspen in every young forest, plus pine, birch, larch, acacia)
//                    colonise young or disturbed ground;
//                    shade-tolerant species (fir, beech, tropical hardwoods) take over old growth
//   soil depth     – beech and maple need deep soil; pine, juniper and fir manage on thin, rocky soil
//   slope          – pine and juniper cling to steep, rocky ground
//   soil chemistry – set by the rock beneath: granite, rhyolite and sandstone weather into acidic,
//                    nutrient-poor soil (pine, spruce, birch); limestone and marble into alkaline soil
//                    (beech, juniper); basalt into fertile, base-rich soil (maple, beech)
//
// Deciduous species (larch, birch, aspen, oak, beech, maple, alder & willow) carry an `autumn`
// colour: what their leaves turn before they fall (maple varies from red to orange, `autumn2`).
// See sim/phenology.js for when that happens.
//
// Each cell gets a share for every species, plus "open" ground (gaps, meadow, scrub) where the
// canopy is thin. The mix sets the forest's colour, how readily it burns and how fast it builds soil.

import { ROCK_CHEM } from '../core/rocks.js';

/** color: natural canopy colour; mapColor: distinct colour for the Tree species overlay.
 * temp/moist: comfortable range [lo, hi] (°C, soil moisture 0..1). age: preferred forest age
 * (0 pioneer … 1 old growth). soil: 'deep' needs deep soil, 'thin' copes with (and wins on) thin
 * soil, 'any'. slope: how steep (relative to the map's typical slope) it tolerates. chem: preferred
 * soil chemistry (−1 acidic … +1 alkaline) and how fussy it is (width). */
export const SPECIES = [
  { id: 'pine', label: 'Pine', color: [0.16, 0.31, 0.20], mapColor: [0.20, 0.58, 0.26], temp: [-2, 22], moist: [0.12, 0.6], age: 0.15, ageW: 0.5, soil: 'thin', slope: 1.25, chem: -0.4, chemW: 2.4, flam: 1.6, soilBuild: 0.6,
    help: 'Drought-hardy pioneer conifer: dominates dry ground, and is first to colonise burnt or bare ground. Copes with thin, acidic soil and steep slopes. Resinous: burns readily.' },
  { id: 'fir', label: 'Fir (abietoid)', color: [0.05, 0.21, 0.15], mapColor: [0.12, 0.32, 0.62], temp: [-4, 13], moist: [0.5, 1.1], age: 0.75, ageW: 0.45, soil: 'shallow', slope: 1.9, chem: -0.2, chemW: 2.0, flam: 1.1, soilBuild: 0.9,
    help: 'Fir, Douglas fir and hemlock of wet, cool climates: mild rainy lowlands (like the Pacific Northwest) up to high mountain slopes. Clings to steep slopes and thin, rocky mountain soil. Shade-tolerant, so it thickens as the forest ages.' },
  { id: 'spruce', label: 'Spruce', color: [0.08, 0.19, 0.17], mapColor: [0.40, 0.28, 0.65], temp: [-6, 9], moist: [0.5, 1.05], age: 0.6, ageW: 0.6, soil: 'any', slope: 0.9, chem: -0.6, chemW: 1.2, flam: 1.4, soilBuild: 0.7,
    help: 'Cold-climate conifer of the boreal forest on acidic soil.' },
  { id: 'larch', label: 'Larch', autumn: [0.82, 0.62, 0.16], color: [0.40, 0.50, 0.22], mapColor: [0.88, 0.76, 0.22], temp: [-8, 6], moist: [0.35, 0.85], age: 0.1, ageW: 0.7, soil: 'any', slope: 1.1, chem: -0.3, chemW: 1.6, flam: 0.9, soilBuild: 0.9,
    help: 'Deciduous conifer of the coldest forests near the tree line; a pioneer on open ground.' },
  { id: 'birch', label: 'Birch', autumn: [0.90, 0.76, 0.14], color: [0.47, 0.60, 0.28], mapColor: [0.96, 0.92, 0.78], temp: [-4, 15], moist: [0.45, 0.95], age: 0.1, ageW: 0.8, soil: 'any', slope: 0.9, chem: -0.5, chemW: 1.4, flam: 0.8, soilBuild: 1.2,
    help: 'Pioneer broadleaf of cool climates: quickly fills clearings, then gives way to longer-lived trees.' },
  { id: 'aspen', label: 'Aspen', autumn: [0.95, 0.70, 0.08], color: [0.50, 0.64, 0.28], mapColor: [0.95, 0.55, 0.85], temp: [-8, 22], moist: [0.25, 1.0], age: 0, ageW: 1.1, youngBoost: 0.6, soil: 'any', slope: 1.2, chem: 0, chemW: 2.5, flam: 0.5, soilBuild: 1.3,
    help: 'Fast pioneer that sprouts in every young forest (often from root suckers after fire), then is shaded out as longer-lived trees take over.' },
  { id: 'oak', label: 'Oak', autumn: [0.56, 0.33, 0.12], color: [0.21, 0.36, 0.13], mapColor: [0.55, 0.35, 0.15], temp: [11, 24], moist: [0.45, 0.85], age: 0.6, ageW: 0.5, soil: 'any', slope: 0.9, chem: -0.2, chemW: 1.5, flam: 1.0, soilBuild: 1.2,
    help: 'Long-lived broadleaf of warm temperate forests; tolerates moderately dry and acidic soil.' },
  { id: 'beech', label: 'Beech', autumn: [0.80, 0.46, 0.12], color: [0.17, 0.40, 0.15], mapColor: [0.90, 0.50, 0.20], temp: [5, 18], moist: [0.6, 0.95], age: 0.95, ageW: 0.9, soil: 'deep', slope: 0.8, chem: 0.4, chemW: 1.2, flam: 0.6, soilBuild: 1.5,
    help: 'Shade-tolerant broadleaf that dominates moist old-growth forest on deep, lime-rich or neutral soil.' },
  { id: 'maple', label: 'Maple', autumn: [0.84, 0.16, 0.07], autumn2: [0.94, 0.46, 0.06], color: [0.26, 0.43, 0.12], mapColor: [0.82, 0.18, 0.22], temp: [4, 19], moist: [0.55, 0.95], age: 0.5, ageW: 0.5, soil: 'deep', slope: 0.8, chem: 0.4, chemW: 1.0, flam: 0.8, soilBuild: 1.5,
    help: 'Broadleaf of fertile, base-rich soils (e.g. over basalt or limestone).' },
  { id: 'alder', label: 'Alder & willow', autumn: [0.52, 0.52, 0.20], color: [0.23, 0.40, 0.24], mapColor: [0.22, 0.72, 0.78], temp: [-2, 24], moist: [0.75, 1.1], age: 0.3, ageW: 0.4, soil: 'any', slope: 0.6, chem: 0, chemW: 2, riparian: true, flam: 0.4, soilBuild: 1.4,
    help: 'Riverbank trees of waterlogged ground beside streams and lakes.' },
  { id: 'juniper', label: 'Juniper', color: [0.30, 0.37, 0.24], mapColor: [0.50, 0.56, 0.34], temp: [2, 26], moist: [0.15, 0.55], age: 0.5, ageW: 0.3, soil: 'thin', slope: 1.4, chem: 0.7, chemW: 1.2, flam: 1.4, soilBuild: 0.5,
    help: 'Tough, drought-hardy conifer of dry, rocky and limestone slopes.' },
  { id: 'tropical', label: 'Tropical hardwoods', color: [0.04, 0.38, 0.14], mapColor: [0.02, 0.45, 0.30], temp: [19, 40], moist: [0.8, 1.1], age: 0.85, ageW: 0.8, soil: 'any', slope: 1.0, chem: 0, chemW: 2, flam: 0.3, soilBuild: 1.3,
    help: 'Towering evergreen canopy trees of hot, wet old-growth jungle.' },
  { id: 'palm', label: 'Palm', color: [0.32, 0.52, 0.18], mapColor: [0.68, 0.88, 0.30], temp: [21, 40], moist: [0.65, 1.1], age: 0.25, ageW: 0.5, soil: 'any', slope: 0.7, chem: 0, chemW: 2, nearWater: true, flam: 0.6, soilBuild: 1.0,
    help: 'Palms of hot, humid lowlands, especially near water.' },
  { id: 'acacia', label: 'Acacia', color: [0.47, 0.49, 0.21], mapColor: [0.92, 0.62, 0.55], temp: [18, 40], moist: [0.15, 0.6], age: 0.2, ageW: 0.5, soil: 'any', slope: 1.0, chem: 0, chemW: 2, flam: 1.3, soilBuild: 0.8,
    help: 'Drought-hardy tree of hot, dry savanna and dry forest; fixes nitrogen.' },
];
export const OPEN = { label: 'Open ground', color: [0.52, 0.66, 0.30], mapColor: [0.80, 0.84, 0.70], help: 'Gaps, meadow and scrub between trees.' };

const K = SPECIES.length;
const MIXA = [0, 0, 0];
const CONIFER = SPECIES.map((s) => ['pine', 'fir', 'spruce', 'larch', 'juniper'].includes(s.id));
// Broadleaf trees give way to conifers with height: their thin leaves and soft wood can't take the
// short, cold growing season and heavy snow. The change is gradual and patchy (aspect, shelter,
// soil), not a line on the mountain. Pioneers (birch, aspen) climb a few degrees higher.
const BROAD_COLD = SPECIES.map((s) => (CONIFER[SPECIES.indexOf(s)] ? null : s.id === 'birch' || s.id === 'aspen' ? -2.5 : 1.5));
const PINE = SPECIES.findIndex((s) => s.id === 'pine');
const scratch = new Float32Array(K);

function band(x, lo, hi, soft) {
  return smooth(lo - soft, lo + soft, x) * (1 - smooth(hi - soft, hi + soft, x));
}

/** How well each species suits cell i (writes into `out`); returns the total. */
function suitability(world, i, out) {
  const T = (world.vegTemp || world.temperature)[i]; // the climate the forest has adapted to
  const m = world.soil ? world.soil[i] : 0.5;
  const age = world.forestAge[i];
  const soil = world.humus[i];
  const slope = (world.standSlope ? world.standSlope[i] : 0.5) / (world.gentleSlope || 0.6);
  const chem = world.soilChem ? world.soilChem[i] : 0;
  const near = world.nearWater ? world.nearWater[i] : 0;
  // A patchy ±1.5 °C offset so the broadleaf limit wanders up and down the slopes
  const px = i % world.N, pz = (i / world.N) | 0;
  const patch = 1.5 * Math.sin(px * 0.21 + pz * 0.13) * Math.cos(pz * 0.17 - px * 0.08);
  let total = 0;
  for (let k = 0; k < K; k++) {
    const s = SPECIES[k];
    let f = band(T, s.temp[0], s.temp[1], 3) * band(m, s.moist[0], s.moist[1], 0.08);
    if (f > 0 && BROAD_COLD[k] !== null) f *= smooth(BROAD_COLD[k], BROAD_COLD[k] + 6, T + patch);
    if (f <= 0) { out[k] = 0; continue; }
    f *= Math.max(0.1, 1 - s.ageW * Math.abs(age - s.age));
    if (s.youngBoost) f *= 1 + s.youngBoost * Math.max(0, 1 - age / 0.4); // thrives in young stands
    if (s.soil === 'deep') f *= 0.2 + 0.8 * smooth(0.15, 0.55, soil);
    else if (s.soil === 'thin') f *= 1 - 0.45 * smooth(0.45, 0.9, soil); // out-competed on rich, deep soil
    else if (s.soil === 'shallow') f *= 1.3 - 0.3 * smooth(0.15, 0.5, soil); // roots in rock cracks: at home on thin mountain soil, fine on deep
    f *= 1 - 0.85 * smooth(s.slope, s.slope + 0.6, slope);
    f *= Math.max(0.08, 1 - Math.abs(chem - s.chem) / s.chemW);
    if (s.riparian) f *= smooth(0.3, 0.8, near);
    else if (s.nearWater) f *= 0.4 + 0.6 * smooth(0.2, 0.7, near);
    f = f * f; // sharpen: the best-suited species dominate
    out[k] = f;
    total += f;
  }
  return total;
}

/** Tree share of the ground (the rest is open), from plant cover. */
function treeCover(v) { return smooth(0.35, 0.85, v); }

/**
 * Recompute the soil chemistry and the per-cell forest mix: blended colour, flammability and
 * soil-building rate (world.forestColor / forestFlam / forestSoilBuild) and the dominant species.
 */
export function updateForestComposition(world, stride = 1, phase = 0) {
  const N = world.N, n = N * N, H = world.height, V = world.vegetation;
  if (!world.forestColor) {
    world.forestColor = new Float32Array(n * 3);
    world.forestFlam = new Float32Array(n).fill(1);
    world.forestSoilBuild = new Float32Array(n).fill(1);
    world.domSpecies = new Int8Array(n).fill(-1);
    world.soilChem = new Float32Array(n);
    world.decid = new Float32Array(n);            // deciduous share of the ground
    world.decidColor = new Float32Array(n * 3);   // their summer colour × share
    world.autumnColor = new Float32Array(n * 3);  // their autumn colour × share
    world.pineShare = new Float32Array(n);        // pine share of the ground (fire behaviour)
    world.conifer = new Float32Array(n);          // conifer share of the trees (forest type)
  }
  const CF = world.conifer;
  const PS = world.pineShare;
  const DS = world.decid, DC = world.decidColor, AC = world.autumnColor;
  const C = world.forestColor, F = world.forestFlam, B = world.forestSoilBuild, D = world.domSpecies, CH = world.soilChem;
  // With stride > 1 only every stride-th row is redone (the mix changes slowly, so the map is
  // refreshed in interleaved passes to spread the cost over several steps)
  for (let i = 0; i < n; i++) {
    if (stride > 1 && ((i / N) | 0) % stride !== phase) { i += N - 1; continue; }
    CH[i] = world.rocksEnabled ? ROCK_CHEM[world.rockAt(H[i], i)] : 0;
    DS[i] = 0; PS[i] = 0; CF[i] = 0; DC[i * 3] = DC[i * 3 + 1] = DC[i * 3 + 2] = 0; AC[i * 3] = AC[i * 3 + 1] = AC[i * 3 + 2] = 0;
    if (V[i] < 0.3) { D[i] = -1; F[i] = 1; B[i] = 1; continue; }
    const total = suitability(world, i, scratch);
    const tc = treeCover(V[i]);
    let r = OPEN.color[0] * (1 - tc), g = OPEN.color[1] * (1 - tc), b = OPEN.color[2] * (1 - tc);
    let flam = 0, build = 0, best = -1, bestShare = 0;
    if (total > 1e-6) {
      for (let k = 0; k < K; k++) {
        const share = (scratch[k] / total) * tc;
        if (share <= 0) continue;
        const s = SPECIES[k];
        r += s.color[0] * share; g += s.color[1] * share; b += s.color[2] * share;
        flam += s.flam * share; build += s.soilBuild * share;
        if (k === PINE) PS[i] = share;
        if (CONIFER[k]) CF[i] += share / tc;
        if (s.autumn) {
          let a = s.autumn;
          if (s.autumn2) { // vary tree to tree (smoothly, in patches)
            const x = i % N, z = (i / N) | 0, t = 0.5 + 0.5 * Math.sin(x * 0.29 + z * 0.13) * Math.cos(z * 0.21 - x * 0.09);
            a = MIXA; a[0] = s.autumn[0] + (s.autumn2[0] - s.autumn[0]) * t; a[1] = s.autumn[1] + (s.autumn2[1] - s.autumn[1]) * t; a[2] = s.autumn[2] + (s.autumn2[2] - s.autumn[2]) * t;
          }
          DS[i] += share;
          DC[i * 3] += s.color[0] * share; DC[i * 3 + 1] += s.color[1] * share; DC[i * 3 + 2] += s.color[2] * share;
          AC[i * 3] += a[0] * share; AC[i * 3 + 1] += a[1] * share; AC[i * 3 + 2] += a[2] * share;
        }
        if (share > bestShare) { bestShare = share; best = k; }
      }
      flam /= tc; build /= tc;
    } else {
      // Nothing suits: the canopy is just generic forest
      const base = [0.15, 0.34, 0.12];
      r += base[0] * tc; g += base[1] * tc; b += base[2] * tc; flam = 1; build = 1;
    }
    C[i * 3] = r; C[i * 3 + 1] = g; C[i * 3 + 2] = b;
    F[i] = flam || 1; B[i] = build || 1; D[i] = best;
  }
}

/** Full mix at one cell for the Inspect readout: [{label, color, share}] sorted, including open ground. */
export function compositionAt(world, i) {
  const total = suitability(world, i, scratch);
  const tc = treeCover(world.vegetation[i]);
  const out = [];
  if (total > 1e-6) {
    for (let k = 0; k < K; k++) {
      const share = (scratch[k] / total) * tc;
      if (share >= 0.01) out.push({ label: SPECIES[k].label, color: SPECIES[k].mapColor, share });
    }
  }
  if (1 - tc >= 0.01) out.push({ label: OPEN.label, color: OPEN.mapColor, share: 1 - tc });
  return out.sort((a, b) => b.share - a.share);
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
