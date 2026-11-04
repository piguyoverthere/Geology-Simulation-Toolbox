// Rock types and the geological map.
//
// The bedrock of each map is divided into *provinces*, large regions with a shared history:
//   sedimentary basin   – layers of sandstone, shale, limestone and conglomerate laid down in
//                         seas, rivers and deltas, stacked like a layer cake
//   volcanic plateau    – stacked lava flows: mostly basalt, with some andesite and rhyolite
//   plutonic core       – granite: magma that cooled slowly deep underground, now exposed by
//                         erosion, usually forming the hardest, highest ground
//   metamorphic belt    – gneiss, schist and marble: rocks cooked and squeezed around the
//                         granite (a "contact aureole") or in old mountain roots
//   stratovolcano       – the volcano preset's cone: basalt at the base, andesite flanks and
//                         silica-rich rhyolite near the summit
//
// Layered provinces are 3D: which rock is exposed depends on the current ground height, so as
// erosion cuts down you dig into the layers below. Layers dip and fold (world.strataWarp).

import { createNoise2D, fbm } from './noise.js';

/** Colours are sRGB 0..1. hardness 0..1 = resistance to erosion. Order is the legend order. */
export const ROCKS = [
  { id: 'basalt',       label: 'Basalt',       color: [0.24, 0.24, 0.26], hardness: 0.85, help: 'Dark, fine-grained volcanic rock from runny lava flows. Very hard; forms plateaus, cliffs and columns.' },
  { id: 'andesite',     label: 'Andesite',     color: [0.47, 0.46, 0.45], hardness: 0.80, help: 'Grey volcanic rock of stratovolcanoes, between basalt and rhyolite in silica. Hard.' },
  { id: 'rhyolite',     label: 'Rhyolite',     color: [0.82, 0.66, 0.62], hardness: 0.70, help: 'Pale pink, silica-rich volcanic rock from thick, explosive lava. Fairly hard.' },
  { id: 'granite',      label: 'Granite',      color: [0.80, 0.74, 0.72], hardness: 0.95, help: 'Coarse speckled rock from magma that cooled slowly underground. Hardest here; forms domes and peaks.' },
  { id: 'gneiss',       label: 'Gneiss',       color: [0.58, 0.55, 0.53], hardness: 0.85, help: 'Banded metamorphic rock cooked at high temperature and pressure. Hard.' },
  { id: 'schist',       label: 'Schist',       color: [0.48, 0.52, 0.44], hardness: 0.50, help: 'Flaky, glittery metamorphic rock full of mica. Splits easily along its layers.' },
  { id: 'marble',       label: 'Marble',       color: [0.93, 0.92, 0.89], hardness: 0.60, help: 'Recrystallised limestone: white and fairly soft, and dissolves slowly in rainwater.' },
  { id: 'sandstone',    label: 'Sandstone',    color: [0.84, 0.63, 0.40], hardness: 0.50, help: 'Cemented sand, often red or tan. Medium strength; forms cliffs, arches and mesas.' },
  { id: 'shale',        label: 'Shale',        color: [0.40, 0.37, 0.35], hardness: 0.15, help: 'Compacted mud. Very soft; wears back quickly into slopes beneath harder caprock.' },
  { id: 'limestone',    label: 'Limestone',    color: [0.84, 0.82, 0.72], hardness: 0.55, help: 'Rock made of shells and lime mud from ancient seas. Medium; dissolves into caves and karst.' },
  { id: 'conglomerate', label: 'Conglomerate', color: [0.66, 0.55, 0.45], hardness: 0.45, help: 'Rounded pebbles cemented together: an old river or beach gravel. Medium-soft.' },
];
const R = Object.fromEntries(ROCKS.map((r, k) => [r.id, k]));

export const PROVINCES = ['Sedimentary basin', 'Volcanic plateau', 'Plutonic core', 'Metamorphic belt', 'Stratovolcano'];
const SED = 0, VOLC = 1, PLUT = 2, META = 3, STRATO = 4;

// Layer sequences, repeated upward. Each entry is one layer of (spacing × thickness).
const SEQUENCES = {
  [SED]: { thick: 0.8, layers: [R.sandstone, R.shale, R.sandstone, R.limestone, R.shale, R.conglomerate, R.shale, R.limestone] },
  [VOLC]: { thick: 0.7, layers: [R.basalt, R.basalt, R.andesite, R.basalt, R.basalt, R.rhyolite] },
  [META]: { thick: 0.6, layers: [R.schist, R.gneiss, R.schist, R.gneiss, R.marble, R.gneiss] },
};

/** Build world.province for a freshly generated terrain. */
export function generateGeology(world, preset, seed) {
  const N = world.N, H = world.height;
  const a = createNoise2D(seed * 7 + 3), b = createNoise2D(seed * 13 + 1);
  let lo = Infinity, hi = -Infinity;
  for (const h of H) { if (h < lo) lo = h; if (h > hi) hi = h; }
  world.geoRange = { lo, hi };
  const P = world.province;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const t = (H[i] - lo) / (hi - lo || 1);
      let p = SED;
      if (fbm(b, x / 130 + 40, z / 130, 3) > 0.22) p = VOLC;
      // Granite cores sit under the high ground, wrapped in a metamorphic belt
      const core = fbm(a, x / 110, z / 110, 3) + 0.35 * t;
      if (core > 0.42) p = META;
      if (core > 0.58) p = PLUT;
      if (preset === 'volcano') {
        const r = Math.hypot(x / N - 0.5, z / N - 0.5);
        if (r < 0.4) p = STRATO;
      }
      P[i] = p;
    }
  }
}

/** Index into ROCKS of the bedrock exposed at cell i when the ground is at height h. */
export function rockAt(world, i, h) {
  const p = world.province[i];
  if (p === PLUT) return R.granite;
  if (p === STRATO) {
    const { lo, hi } = world.geoRange;
    const t = (h + world.strataWarp[i] * 0.15 - lo) / (hi - lo || 1);
    return t < 0.3 ? R.basalt : t < 0.75 ? R.andesite : R.rhyolite;
  }
  const seq = SEQUENCES[p];
  const k = Math.floor((h + world.strataWarp[i]) / (world.strataSpacing * seq.thick));
  const n = seq.layers.length;
  return seq.layers[((k % n) + n) % n];
}
