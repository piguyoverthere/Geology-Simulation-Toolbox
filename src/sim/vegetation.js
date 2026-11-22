// Vegetation cover and its feedback on erosion.
//
// world.vegetation holds a cover value per cell from 0 to 1:
//   0.0 – 0.33  barren   (bare soil/rock: erodes fastest)
//   0.33 – 0.66 grassland (roots bind the topsoil: medium erosion)
//   0.66 – 1.0  forest   (deep roots, leaf litter and canopy shield the ground: low erosion)
//
// Plants grow toward what the site can support. They like gentle slopes, water and moderate
// elevation. Flooding, burial by sediment and having the soil washed away all kill them off. This
// gives the classic feedback loop: bare ground erodes, and erosion keeps ground bare.
//
// Water: each cell keeps a soil-moisture store (world.soil) fed by the local climate, current
// rainfall and nearby rivers/lakes (the *riparian zone*, where the water table is high). Plants draw
// it down, forests most of all. Forests need moist soil, so when the supply drops (a spring is
// removed, rain stops, the climate dries), soil dries out and forests retreat to grassland, then
// grassland to bare ground. They hang on longest along rivers: the ribbon of trees along a desert river.
//
// Fresh volcanic ground: new lava is bare rock with no soil, so plants can't take hold until it
// weathers (lichens and mosses first, then grasses, and forest only much later). world.freshRock
// marks it (1 = just erupted) and fades as the rock breaks down, faster where it's moist. Ash
// weathers into fertile soil much sooner than solid lava does.
//
// Soil (world.humus, 0 = bare mineral ground, 1 = deep fertile soil) is built by plants: leaf
// litter, roots and the life they feed turn rock debris into soil. Forests build it about three
// times faster than grassland, at a rate that depends on the forest type. Erosion strips it,
// lava and ash bury it, and fire burns some of it off. Deep soil holds more water, lets plants
// regrow faster and protects the ground a little from erosion. Plant roots also pry apart fresh
// lava and ash, so recolonisation speeds up once pioneers (and nearby forest) get a foothold.
//
// Forest age (world.forestAge, 0 = young or none, 1 = old growth) builds up slowly while a spot
// stays forested and is lost quickly when the forest thins, burns or is buried. Old forest is more
// robust: deeper roots and a big soil store make it more drought-tolerant (it survives on drier
// soil and dies back more slowly), it shrugs off disturbance, holds steeper slopes, protects the
// ground from erosion better, resists fire, and builds soil a little faster.
//
// Cold (world.temperature, see sim/climate.js): below the tree-line temperature it is too cold for
// trees, so forest gives way to alpine grassland, which thins to bare rock where colder still.
// Since temperature also depends on sun exposure, shady slopes lose their trees lower down.
//
// Forests are communities, not individual cells: seeds spread from neighbouring trees and a canopy
// keeps its own ground moist and shaded. So whether a spot can hold forest is judged on its
// neighbourhood (averaged slope and moisture), and cover is pulled toward the local average. That
// grows continuous expanses with clean edges instead of a speckle of single-cell groves.

import { createNoise2D, fbm } from '../core/noise.js';
import { boxBlur } from '../core/grid.js';
import { FOREST, FOREST_TYPES, forestTypeAt } from './forests.js';
import { climateParams, seasonParams, updateTemperature, updatePrecip, updateSnow, seasonalAt } from './climate.js';
import { updateForestComposition } from './species.js';
import { waterParams } from './water.js';
import { coastParams } from './coast.js';

export const vegetationParams = {
  growth: 0.03,       // how fast cover moves toward the site's potential per step
  disturbance: 0.6,   // cover lost per unit of ground removed or buried
  forestShare: 0.75,  // forest can take the gentlest this-fraction of the land (relative to the map)
  forestSlopeMax: 1.2,  // …but never on stands steeper than this (rise/run, ≈ 50°; conifers a bit more)
  forestSlopeMin: 0.9,  // …and always allowed up to this (≈ 42°), however gentle the rest of the map is
  riparianReach: 4,   // how far (cells, roughly ×2) the wet zone extends from open water
  riparianBoost: 5,   // extra growth speed right beside water (1 + boost times the normal rate)
  standRadius: 6,     // neighbourhood (cells) used to judge whether a stand of forest fits
  spread: 0.35,       // how strongly cover is pulled toward its neighbours' average (seed spread)
  aridSoil: 0.32,     // soil moisture below this counts as arid (desert / mesa country)
  grassBuffer: 10,    // forest keeps roughly 1–2× this many cells away from arid ground (grassland between)
  climate: 1,         // regional wetness multiplier (0 = desert, 1 = normal, 1.5 = rainforest)
  forestWater: 0.3,   // soil moisture a forest needs (drought-hardy species like pine take the driest)
  adapt: 0.003,       // how fast forests catch up with a changed climate per step (grass 4× faster)
  ageRate: 0.0012,    // forest maturity gained per step (≈ 830 steps from young to old growth)
  ageLoss: 0.03,      // maturity lost per step where cover drops below forest
  ashRecovery: 0.004, // how fast burnt ground recovers per step
  soilBuild: 0.004,      // soil formed per step under full plant cover (× forest type)
  forestSoilBoost: 3,    // forests build soil this many times faster than grassland
  soilDecay: 0.0015,     // bare soil slowly washes/blows away where nothing grows
  soilErosion: 1.5,      // soil lost per unit of ground eroded or buried
  weathering: 0.0009, // how fast fresh lava/ash breaks down into soil per step (×(0.4 + soil))
  uptake: 0.2,        // how much full plant cover draws down soil moisture
  soilMemory: 0.04,   // how fast soil moisture moves toward its supply each step
};

/** Build the climate moisture map and set soil water and vegetation straight to equilibrium. */
export function initVegetation(world, seed = 1) {
  const N = world.N;
  const noise = createNoise2D(seed * 31 + 5);
  if (!world.moisture) world.moisture = new Float32Array(N * N);
  if (!world.soil) world.soil = new Float32Array(N * N);
  world.humus.fill(0.3);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      // Wet and dry regions (rain shadows, soil differences) give distinct biome patches
      const bias = world.moistureBias ? world.moistureBias[z * N + x] : 0; // e.g. a preset's rain shadow
      world.moisture[z * N + x] = Math.min(1, Math.max(0, 0.5 + bias + 1.15 * (world.moistureBias ? 0.5 : 1) * fbm(noise, x / 170, z / 170, 3)));
    }
  }
  updateNearWater(world);
  updateTemperature(world);
  world.vegTemp = Float32Array.from(world.temperature); // a new map starts adapted to its climate
  world.vegetation.fill(0);
  updatePrecip(world);
  // A few passes of soil ⇄ vegetation lets the plants' own water use and seed spread settle in
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < N * N; i++) world.soil[i] = soilSupply(world, i);
    const f = neighbourhood(world);
    for (let i = 0; i < N * N; i++) world.vegetation[i] = potential(world, i, f);
    updateForestComposition(world); // which trees would grow here (conifers hold steeper ground)
    // Mature soils: deepest under long-standing forest
    for (let i = 0; i < N * N; i++) world.humus[i] = Math.min(1, 1.1 * world.vegetation[i] ** 1.5);
    // Existing forests start part-way mature; wetter, long-established stands are older
    for (let i = 0; i < N * N; i++) {
      world.forestAge[i] = world.vegetation[i] > 0.66 ? 0.3 + 0.55 * world.moisture[i] : 0;
    }
  }
  // Let the snowpack build to its seasonal state so a new map starts with realistic snow
  if (world.snow) world.snow.fill(0);
  updatePrecip(world);
  updateSnow(world, 250);
  updateForestComposition(world);
  world.prevHeight.set(world.height);
  world.dirty = true;
}

/** Soil moisture a cell would settle at: climate + rain + nearby water − what its plants use. */
function soilSupply(world, i) {
  const p = vegetationParams;
  const s = p.climate * world.moisture[i]
    + waterParams.rain * 8
    + 0.6 * world.nearWater[i]
    - p.uptake * world.vegetation[i]
    - 0.012 * Math.max(0, world.temperature[i] - 18) // heat dries the soil out faster
    + (world.precip ? 0.3 * (world.precip[i] - 0.5) : 0) // windward slopes wetter, rain shadows drier
    + (world.valley ? 0.28 * world.valley[i] : 0)     // valley bottoms collect water; ridges drain dry
    - (world.evapSoil ? 0.08 * (world.evapSoil[i] - 1) : 0); // sunny, bare ground dries out; shade keeps it damp
    + 0.15 * world.humus[i]; // deep, organic soil holds water like a sponge
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

/** Per-cell slope plus neighbourhood averages of slope, soil moisture and plant cover. */
function neighbourhood(world) {
  const N = world.N, H = world.height, r = vegetationParams.standRadius;
  const slope = new Float32Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const gx = (H[x < N - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * 0.5;
      const gz = (H[z < N - 1 ? i + N : i] - H[z > 0 ? i - N : i]) * 0.5;
      slope[i] = Math.sqrt(gx * gx + gz * gz);
    }
  }
  const standSlope = boxBlur(slope, N, r);
  world.standSlope = standSlope; // also used by the renderer to split desert (flat) from mesa (steep)
  // How much arid ground lies nearby. Forest needs a margin of grassland between it and the
  // desert: the moisture gradient at a dry edge is too steep and windblown for a closed canopy.
  const arid = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) arid[i] = world.soil[i] < vegetationParams.aridSoil ? 1 : 0;
  const nearArid = boxBlur(boxBlur(arid, N, vegetationParams.grassBuffer), N, vegetationParams.grassBuffer);
  // "Gentle" is relative to this landscape: the slope below which `forestShare` of the land lies
  // (estimated from a fixed sample of cells so it's cheap and stable from step to step)
  // Only land moist enough for trees counts: a big flat desert elsewhere on the map shouldn't make
  // the forested hills look steep by comparison
  const sample = [];
  for (let k = 0; k < 4096; k++) {
    const i = (k * 2654435761) % (N * N) >>> 0;
    if (world.soil[i] >= vegetationParams.aridSoil) sample.push(standSlope[i]);
  }
  if (sample.length < 200) for (let k = 0; k < 4096; k++) sample.push(standSlope[(k * 2654435761) % (N * N) >>> 0]);
  sample.sort((a, b) => a - b);
  const p = vegetationParams;
  const gentle = Math.max(p.forestSlopeMin, Math.min(p.forestSlopeMax, sample[Math.floor(p.forestShare * (sample.length - 1))]));
  world.gentleSlope = gentle; // renderer: dry ground gentler than this is desert, steeper is mesa
  return {
    slope,
    gentle,
    standSlope,
    nearArid,
    standSoil: boxBlur(world.soil, N, r),
    standCover: boxBlur(world.vegetation, N, 2),
  };
}

/** The cover a cell can support (0..1), given the neighbourhood fields `f`. */
function potential(world, i, f) {
  const h = world.height[i];
  if (h < world.seaLevel) return world.mangrove && world.mangrove[i] > 0 ? 0.92 * world.mangrove[i] : 0;
  const p = vegetationParams;
  const slope = f.slope[i];

  // Blend this cell's soil with its neighbourhood's: a stand shares (and shades) its water
  const soil = 0.4 * world.soil[i] + 0.6 * f.standSoil[i];
  const age = world.forestAge[i];
  // Trees cling to slopes up to ~45° and beyond (only cliffs stay bare)
  const steep = 1 - 0.85 * smoothstep(1.0, 2.4, slope);
  // Above the tree line plants get sparser, down to bare ground at the top of the alpine band
  // Too cold above the tree line: plants thin out to bare ground as it gets colder still
  // Fir (subalpine fir, mountain hemlock) is the hardiest tree of the mountains: where it's moist
  // enough for fir, closed forest climbs ~2.5 °C colder (about 6 units higher) than elsewhere
  // The tree line is ragged, not a contour: it pushes up in tongues and drops back in bays
  // (seed years, avalanche paths, old fires, soil), climbs higher in sheltered gullies and stops
  // lower on wind-blasted ridges and crests
  const valley = world.valley ? world.valley[i] : 0;
  const tl = climateParams.treeLineTemp - 2.5 * smoothstep(0.3, 0.5, soil)
    - 2.4 * treeLinePatch(world, i) - 1.6 * valley;
  const T = (world.vegTemp || world.temperature)[i];
  const alpine = 1 - 0.95 * smoothstep(tl, tl - 7, T);
  // Lakes drown plants; shallow floodwater on a floodplain does not
  // (and nothing grows on glacier ice)
  const drowned = (1 - smoothstep(1, 3, world.water[i])) * (world.ice ? 1 - smoothstep(0.05, 0.4, world.ice[i]) : 1);
  // Drought-hardy trees (pine, juniper) still form open woodland on dry-ish ground in temperate
  // climates, so cover there is higher than soil moisture alone would allow
  const dryWood = 0.32 * smoothstep(0.15, 0.32, soil) * (1 - smoothstep(0.45, 0.6, soil)) * smoothstep(-2, 2, T) * (1 - smoothstep(22, 26, T));
  // Pine is far more drought-resistant than other trees (deep taproots, needles that lose little
  // water): in temperate climates it holds open woodland down to quite dry soil, where everything
  // else is steppe. pineDry is how well this spot suits that dry pine woodland.
  const pineDry = smoothstep(0.06, 0.2, soil) * (1 - smoothstep(0.45, 0.6, soil)) * smoothstep(-2, 2, T) * (1 - smoothstep(22, 26, T));
  // Cover rises quickly with water and then levels off: once the soil is moderately moist, more
  // water doesn't make a site much greener (so forests cover a broad range of wetness, and you don't
  // need to flood the lowlands to get trees onto drier mountain slopes)
  const wet = smoothstep(0.1, 0.5, soil);
  let v = Math.max(0.08 + 0.95 * wet + 0.4 * dryWood, 0.74 * pineDry) * steep * alpine * drowned;
  // Shifting dune sand holds only sparse dune grass until shore pine stabilises it
  if (world.dune && world.dune[i] > 0) v *= 1 - 0.45 * world.dune[i];
  // Seed spread: pulled toward the neighbours' cover, so groves fill in and merge
  v += (f.standCover[i] - v) * p.spread * steep * drowned;

  // Forest (cover above ~0.6) needs all three, judged over the whole stand: gentle ground for deep
  // soil, enough water, and to be below the tree line. Otherwise the site tops out as grassland.
  // Conifer stands (fir especially) hold steeper ground than broadleaf ones
  const steepOk = f.gentle * (1 + 0.45 * (world.conifer ? world.conifer[i] : 0));
  const forestOk = (1 - smoothstep(steepOk * 0.85, steepOk * 1.1, f.standSlope[i]))
    // Old forest's deep roots reach water young trees can't, so it survives on drier ground
    * Math.max(smoothstep(p.forestWater - 0.15 - 0.12 * age, p.forestWater + 0.05 - 0.12 * age, soil), pineDry)
    * smoothstep(tl - 1.5, tl + 1.5, T) // closed forest thins out over a band at the tree line
    // (drought-hardy pine woodland is the exception: it runs right up to the steppe)
    * (1 - smoothstep(0.005, 0.06, f.nearArid[i]) * (1 - 0.9 * pineDry));
  v = Math.min(v, 0.58 + 0.42 * forestOk);
  // Mangrove forest stands in the tide where nothing else survives
  if (world.mangrove && world.mangrove[i] > 0) v = Math.max(v, 0.92 * world.mangrove[i]);
  return Math.max(0, Math.min(1, v));
}

/** Update soil water, then grow/decay vegetation one step. */
export function vegetationStep(world) {
  const V = world.vegetation, H = world.height, P = world.prevHeight, S = world.soil;
  const p = vegetationParams;
  updateNearWater(world);
  updateTemperature(world);
  updatePrecip(world);
  updateSnow(world, 1, true);
  adaptTemperature(world);
  const VT = world.vegTemp;
  // With seasons on, plants grow in the warm season and rest in the cold
  const st = world.seasonT || 0, seasonal = seasonParams.enabled;
  const W = world.nearWater, F = world.freshRock, SO = world.humus;
  for (let i = 0; i < V.length; i++) S[i] += (soilSupply(world, i) - S[i]) * p.soilMemory;
  const f = neighbourhood(world);
  // Seawater: land the sea has flooded (below mean sea level) or that the high tide reaches is
  // salted. Ordinary trees and shrubs can't take salt in their roots and die within a season or
  // two (the "ghost forests" left where the land sinks or the sea rises); only mangroves, and swamp
  // forest in the brackish tidal fringe, survive. The tidal fringe still holds salt marsh grasses.
  const meanSea = world.meanSea, seaOn = meanSea !== undefined && meanSea > -999;
  const highTide = seaOn ? meanSea + 0.5 * coastParams.tideRange : -Infinity;
  if (!world.swampy || world.swampy.length !== V.length) world.swampy = new Uint8Array(V.length);
  const SW = world.swampy;
  for (let i = 0; i < V.length; i++) {

    // Burning cells don't regrow; burnt ground recovers slowly while plants creep back
    if (world.fire[i] > 0) continue;
    const burnt = world.burnt[i];
    // Slow creep is tolerated; only real scouring or burial damages plants
    const change = Math.max(0, Math.abs(H[i] - P[i]) - 0.05);
    const age = world.forestAge[i];
    let v = V[i] - change * p.disturbance * (1 - 0.6 * age); // old stands shrug off disturbance
    let target = potential(world, i, f);
    // Salt: 0 dry land, 1 tidal fringe, 2 under the sea
    const salt = H[i] < highTide ? (H[i] < meanSea ? 2 : 1) : 0;
    // (a swamp remembers it was one, so it keeps its tolerance once the sea comes in)
    if (salt === 0) SW[i] = v > 0.5 && forestTypeAt(world, i) === FOREST.swamp ? 1 : 0;
    const mang = world.mangrove ? world.mangrove[i] : 0;
    let saltKill = false;
    if (salt > 0) {
      const swampOK = SW[i] && (salt === 1 || H[i] > meanSea - 0.4); // brackish fringe, shallow flooding
      // (the tide scours the ground between the tide lines bare: only mangroves and swamp forest
      // hold on; grass and shrubs are stripped away)
      const tolerated = Math.max(0.92 * mang, swampOK ? 0.8 : 0);
      target = salt === 2 ? tolerated : Math.min(target, tolerated);
      saltKill = v > target;
    } else if (seaOn) {
      // Just above high tide, storm surges and storm waves wash over the ground every so often:
      // grass and low scrub only, no forest down to the waterline
      const surgeTop = highTide + 1.2 + Math.max(0, world.surge || 0);
      if (H[i] < surgeTop && mang < 0.2) {
        target = Math.min(target, 0.35 + 0.3 * smoothstep(highTide, surgeTop, H[i]));
        if (v > target + 0.05) saltKill = true; // (salt-water floods kill even old trees)
      }
      // Salt spray and sea wind thin and stunt the forest behind exposed shores, and loose, dry
      // sand holds little: sparser cover there (the coastal specialists are what grows)
      const sp = world.spray ? world.spray[i] : 0, sd = world.sandy ? world.sandy[i] : 0;
      target *= (1 - 0.45 * sp) * (1 - 0.35 * sd);
    }
    // Regrowth is faster near water and on deep soil; dieback (drought, cold) is slowed by forest
    // age, since mature trees ride out bad years on their reserves
    // (and slower in the cold: a short growing season)
    // Grazing and browsing (sim/ecology.js): deer nip off seedlings and young trees, holding
    // meadows open and keeping cleared ground from growing back into forest
    const browse = world.browse ? Math.min(1, world.browse[i]) : 0;
    if (browse > 0.02 && salt === 0) target = Math.max(Math.min(target, 0.5), target - 0.45 * browse * (1 - age));
    // (salmon carcasses fertilise the banks of salmon rivers: plants there grow faster)
    const salmonFed = world.salmonN ? world.salmonN[i] : 0;
    let rate = target > v
      ? p.growth * (1 + p.riparianBoost * W[i] + 1.5 * salmonFed) * (0.5 + SO[i]) * (0.25 + 0.75 * smoothstep(-2, 12, VT[i]))
        * (seasonal ? 0.3 + 1.1 * smoothstep(0, 10, world.temperature[i] + seasonalAt(world, i, st)) : 1)
      : p.growth * (1 - 0.75 * age);
    if (burnt > 0) {
      if (target > v) rate *= 1 - 0.8 * burnt;
      world.burnt[i] = Math.max(0, burnt - p.ashRecovery * (1 + 2 * SO[i]));
    }
    const fresh = F[i];
    if (fresh > 0) {
      // Bare new rock can only hold sparse pioneers, and colonisation is slow until soil forms
      const exposed = world.surfaceRock[i] >= 0 && H[i] > world.surfaceBase[i] + 1e-3;
      if (!exposed) F[i] = 0; // eroded away: the old ground (and its soil) is back
      else {
        target = Math.min(target, 1 - fresh);
        if (target > v) rate *= (1 - fresh) * (1 - fresh);
        // Roots of the pioneers here and of the forest nearby break the rock down faster
        F[i] = Math.max(0, fresh - p.weathering * (0.4 + S[i]) * (1 + 3 * v + 4 * f.standCover[i]));
      }
    }
    if (saltKill) rate = Math.max(rate, 0.12); // salt kills even old trees, fast
    v += (target - v) * Math.min(1, rate);
    V[i] = v < 0 ? 0 : v > 1 ? 1 : v;

    // Soil: built by plants (forests fastest, by type), lost to erosion/burial and on bare ground
    let soil = SO[i];
    const build = v > 0.66
      ? p.forestSoilBoost * (world.forestSoilBuild ? world.forestSoilBuild[i] : FOREST_TYPES[forestTypeAt(world, i)].soilBuild) * (1 + 0.4 * age)
      : 1;
    soil += p.soilBuild * v * v * build * (1 - soil) - p.soilDecay * soil * (1 - v) - change * p.soilErosion;
    if (F[i] > 0) soil = Math.min(soil, 1 - F[i]);
    SO[i] = soil < 0 ? 0 : soil > 1 ? 1 : soil;

    // Forest age: matures while forested, lost quickly when the cover thins or the ground is torn up
    let a = age;
    if (v > 0.66) a += p.ageRate * (1 - a);
    else a -= p.ageLoss;
    a -= change * 2;
    if (saltKill) a -= 0.05;
    world.forestAge[i] = a < 0 ? 0 : a > 1 ? 1 : a;
  }
  P.set(H);
  world.dirty = true;
}

/**
 * Refresh the species mix. It changes slowly, so each call redoes a quarter of the rows; the app
 * runs it on a different frame from vegetationStep to spread the work.
 */
export function compositionStep(world) {
  world.compPhase = ((world.compPhase || 0) + 1) % 4;
  updateForestComposition(world, 4, world.compPhase);
  world.dirty = true;
}

/**
 * world.vegTemp: the temperature the plant cover has adapted to. When the climate changes,
 * vegetation doesn't switch at once: grassland and pioneers respond within years, but an
 * established forest hangs on for decades to centuries (long-lived trees survive in a climate where
 * their seedlings no longer would). So biomes, forest types, species mixes and the tree line all
 * follow this lagging temperature, and drift toward the new climate over a while.
 */
function adaptTemperature(world) {
  const T = world.temperature, n = T.length, V = world.vegetation;
  if (!world.vegTemp || world.vegTemp.length !== n) { world.vegTemp = Float32Array.from(T); return; }
  const VT = world.vegTemp, k = vegetationParams.adapt;
  for (let i = 0; i < n; i++) {
    const forest = smoothstep(0.45, 0.8, V[i]);
    VT[i] += (T[i] - VT[i]) * k * (4 - 3 * forest);
  }
}

/** Patchy −1..1 offset of the tree line at cell i (fixed per map: tongues and bays of forest). */
function treeLinePatch(world, i) {
  if (!world.treeLineNoise || world.treeLineNoise.length !== world.N * world.N) {
    const N = world.N, a = createNoise2D(777), out = new Float32Array(N * N);
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        // Broad bays and tongues plus finer, ragged fingers
        const v = 0.75 * fbm(a, x / 40, z / 40, 3) + 0.45 * fbm(a, x / 9 + 50, z / 9 - 20, 2);
        out[z * N + x] = Math.max(-1, Math.min(1, v * 1.6));
      }
    }
    world.treeLineNoise = out;
  }
  return world.treeLineNoise[i];
}

/** world.nearWater: 1 at open water, fading to 0 a few cells away from it. */
function updateNearWater(world) {
  const D = world.water;
  const wet = new Float32Array(D.length);
  for (let i = 0; i < D.length; i++) wet[i] = D[i] > 0.05 ? 1 : 0;
  const r = vegetationParams.riparianReach;
  const spread = boxBlur(boxBlur(wet, world.N, r), world.N, r);
  for (let i = 0; i < spread.length; i++) spread[i] = Math.min(1, spread[i] * 3);
  world.nearWater = spread;

  // Valleyness: how far a spot sits below the surrounding ground (−1 ridge … +1 valley floor).
  // Groundwater and runoff gather in hollows and drain away from crests.
  const H = world.height, around = boxBlur(H, world.N, 10);
  if (!world.valley) world.valley = new Float32Array(H.length);
  for (let i = 0; i < H.length; i++) {
    const v = (around[i] - H[i]) / 6;
    world.valley[i] = v < -1 ? -1 : v > 1 ? 1 : v;
  }
}

function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
