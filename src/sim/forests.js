// Forest types. Which kind of forest grows depends on water, warmth (height below the tree line)
// and drainage, and each kind behaves differently: how readily it burns and how fast its leaf
// litter and roots build soil.
//
//   rainforest   – very wet, warm lowland: dense evergreen canopy, rapid litter turnover, damp
//                  enough that fire barely takes hold
//   broadleaf    – moderately moist, temperate: oak, beech, maple. Rich leaf litter builds deep,
//                  fertile soil
//   conifer      – cool ground just below the tree line: pine, spruce, fir. Resinous and dry
//                  underneath, so it burns hot; acidic needle litter builds soil slowly
//   woodland     – dry edge of where trees survive: open oak/pine woodland, fire-prone, thin soil
//   swamp        – flat, waterlogged ground beside rivers and lakes: cypress, mangrove, willow.
//                  Too wet to burn; organic peaty soil builds quickly

/** Colours sRGB 0..1. flammability multiplies fire spread; soilBuild multiplies soil formation. */
export const FOREST_TYPES = [
  { id: 'rainforest', label: 'Rainforest',     color: [0.07, 0.30, 0.20], flammability: 0.35, soilBuild: 1.6,
    help: 'Very wet lowland forest. Dense and damp: hard to burn. Builds soil fastest.' },
  { id: 'broadleaf',  label: 'Broadleaf forest', color: [0.15, 0.34, 0.12], flammability: 1.0, soilBuild: 1.4,
    help: 'Temperate oak/beech forest on moist, gentle ground. Rich leaf litter builds deep soil.' },
  { id: 'conifer',    label: 'Conifer forest', color: [0.10, 0.22, 0.17], flammability: 1.5, soilBuild: 0.7,
    help: 'Pine and spruce on cool ground below the tree line. Resinous: burns hot. Acidic needles build soil slowly.' },
  { id: 'woodland',   label: 'Dry woodland',   color: [0.33, 0.40, 0.18], flammability: 1.35, soilBuild: 0.6,
    help: 'Open woodland at the dry edge of where trees survive. Fire-prone; thin soil.' },
  { id: 'swamp',      label: 'Swamp forest',   color: [0.17, 0.27, 0.18], flammability: 0.25, soilBuild: 1.5,
    help: 'Waterlogged forest beside rivers and lakes. Too wet to burn; builds peaty soil quickly.' },
];
export const FOREST = Object.fromEntries(FOREST_TYPES.map((f, k) => [f.id, k]));

/**
 * Which forest type suits cell i at height h (whether or not there are trees there now).
 * @param {import('../core/world.js').World} world
 */
export function forestTypeAt(world, i, h, treeLine) {
  const soil = world.soil ? world.soil[i] : 0.5;
  const near = world.nearWater ? world.nearWater[i] : 0;
  const slope = world.standSlope ? world.standSlope[i] : 0.5;
  if (near > 0.6 && soil > 0.72 && slope < world.gentleSlope * 0.7) return FOREST.swamp;
  if (h > treeLine - 16) return FOREST.conifer;
  if (soil > 0.93) return FOREST.rainforest;
  if (soil < 0.68) return FOREST.woodland;
  return FOREST.broadleaf;
}

/**
 * Smoothly blended forest colour for cell i (avoids hard seams between forest types).
 * Writes into `out`.
 */
export function forestColor(world, i, h, treeLine, out) {
  const soil = world.soil ? world.soil[i] : 0.5;
  const near = world.nearWater ? world.nearWater[i] : 0;
  const slope = world.standSlope ? world.standSlope[i] : 0.5;
  const T = FOREST_TYPES;
  const blend = (c, t) => { out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t; };
  out[0] = T[1].color[0]; out[1] = T[1].color[1]; out[2] = T[1].color[2];
  blend(T[3].color, 1 - smooth(0.63, 0.73, soil));
  blend(T[0].color, smooth(0.89, 0.96, soil));
  blend(T[2].color, smooth(treeLine - 19, treeLine - 13, h));
  blend(T[4].color, smooth(0.45, 0.75, near) * smooth(0.68, 0.8, soil) * (1 - smooth(world.gentleSlope * 0.5, world.gentleSlope * 0.8, slope)));
  return out;
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
