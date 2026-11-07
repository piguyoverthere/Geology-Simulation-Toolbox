// Forest types. Which kind of forest grows depends on temperature (world.temperature, from height
// and sun), water (soil moisture) and drainage, and each kind behaves differently: how readily it
// burns and how fast its leaf litter and roots build soil.
//
//   jungle          – hot and very wet: tropical rainforest. Dense, humid, barely burns. Litter
//                     rots fast and nutrients stay in the plants, so soil builds only moderately
//   tropical dry    – hot with a dry season: monsoon/dry forest. Drops its leaves; burns in the dry
//   rainforest      – mild and very wet: temperate rainforest (giant conifers, mosses). Damp;
//                     builds deep soil fastest
//   broadleaf       – mild and moderately moist: oak, beech, maple. Rich leaf litter, deep soil
//   conifer         – cold: boreal forest/taiga of pine, spruce, fir. Resinous, burns hot; acidic
//                     needle litter builds soil slowly
//   woodland        – the dry edge where trees survive: open oak/pine woodland, fire-prone
//   swamp           – flat, waterlogged ground beside rivers and lakes; too wet to burn, peaty soil

/** Colours sRGB 0..1. flammability multiplies fire spread; soilBuild multiplies soil formation. */
export const FOREST_TYPES = [
  { id: 'jungle',      label: 'Tropical jungle',      color: [0.04, 0.38, 0.14], flammability: 0.3, soilBuild: 1.3,
    help: 'Hot, very wet lowland rainforest. Dense and humid: barely burns.' },
  { id: 'tropicalDry', label: 'Tropical dry forest',  color: [0.42, 0.46, 0.15], flammability: 1.3, soilBuild: 0.9,
    help: 'Hot forest with a long dry season; drops its leaves and burns in the dry months.' },
  { id: 'rainforest',  label: 'Temperate rainforest', color: [0.07, 0.30, 0.20], flammability: 0.35, soilBuild: 1.6,
    help: 'Mild, very wet forest of giant trees and moss. Damp: hard to burn. Builds soil fastest.' },
  { id: 'broadleaf',   label: 'Broadleaf forest',     color: [0.15, 0.34, 0.12], flammability: 1.0, soilBuild: 1.4,
    help: 'Temperate oak/beech forest on moist, mild ground. Rich leaf litter builds deep soil.' },
  { id: 'conifer',     label: 'Conifer forest (taiga)', color: [0.10, 0.22, 0.17], flammability: 1.5, soilBuild: 0.7,
    help: 'Pine, spruce and fir where it is cold. Resinous: burns hot. Acidic needles build soil slowly.' },
  { id: 'woodland',    label: 'Dry woodland',         color: [0.33, 0.40, 0.18], flammability: 1.35, soilBuild: 0.6,
    help: 'Open woodland at the dry edge of where trees survive. Fire-prone; thin soil.' },
  { id: 'swamp',       label: 'Swamp forest',         color: [0.17, 0.27, 0.18], flammability: 0.25, soilBuild: 1.5,
    help: 'Waterlogged forest beside rivers and lakes. Too wet to burn; builds peaty soil quickly.' },
];
export const FOREST = Object.fromEntries(FOREST_TYPES.map((f, k) => [f.id, k]));

const COLD = 9, HOT = 19; // °C: below COLD conifers take over; above HOT forests are tropical

/** Which forest type suits cell i (whether or not there are trees there now). */
export function forestTypeAt(world, i) {
  const soil = world.soil ? world.soil[i] : 0.5;
  const near = world.nearWater ? world.nearWater[i] : 0;
  const slope = world.standSlope ? world.standSlope[i] : 0.5;
  const T = world.temperature ? world.temperature[i] : 12;
  if (near > 0.6 && soil > 0.72 && slope < world.gentleSlope * 0.7) return FOREST.swamp;
  if (T < COLD) return FOREST.conifer;
  if (T > HOT) return soil > 0.85 ? FOREST.jungle : FOREST.tropicalDry;
  if (soil > 0.93) return FOREST.rainforest;
  if (soil < 0.68) return FOREST.woodland;
  return FOREST.broadleaf;
}

/** Smoothly blended forest colour for cell i (no hard seams between types). Writes into `out`. */
export function forestColor(world, i, out) {
  const soil = world.soil ? world.soil[i] : 0.5;
  const near = world.nearWater ? world.nearWater[i] : 0;
  const slope = world.standSlope ? world.standSlope[i] : 0.5;
  const T = world.temperature ? world.temperature[i] : 12;
  const C = (id) => FOREST_TYPES[FOREST[id]].color;
  const blend = (c, t) => { out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t; };
  const base = C('broadleaf');
  out[0] = base[0]; out[1] = base[1]; out[2] = base[2];
  blend(C('woodland'), 1 - smooth(0.63, 0.73, soil));
  blend(C('rainforest'), smooth(0.89, 0.96, soil));
  // Warm: tropical dry forest, turning to jungle where it's also very wet
  const hot = smooth(HOT - 1.5, HOT + 1.5, T);
  blend(C('tropicalDry'), hot * (1 - smooth(0.8, 0.9, soil)));
  blend(C('jungle'), hot * smooth(0.8, 0.9, soil));
  blend(C('conifer'), 1 - smooth(COLD - 1.5, COLD + 1.5, T));
  blend(C('swamp'), smooth(0.45, 0.75, near) * smooth(0.68, 0.8, soil) * (1 - smooth(world.gentleSlope * 0.5, world.gentleSlope * 0.8, slope)));
  return out;
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
