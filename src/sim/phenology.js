// Phenology: what the plants are doing through the year (only with Seasons on).
//
// Deciduous trees take their cue from shortening days and cooling nights. In autumn they stop
// making chlorophyll and the leaves show their other pigments (yellow carotenoids in birch, aspen
// and larch; red anthocyanins in maple; brown tannins in oak), then the leaves drop. In spring the
// buds break and the new leaves are a bright, pale green for a few weeks before they darken.
//
// The colder a place's climate, the earlier autumn comes (about two days earlier per °C colder)
// and the later spring. Since temperature falls with height, autumn colour starts on the high
// slopes and sweeps down the mountains week by week, and spring climbs back up them. Exposed
// ridges and crests, open to cold wind and clear night skies, turn and drop first. Valley bottoms
// are sheltered and turn last (in this model a valley floor counts as up to 3 °C warmer).
//
// Fields (all 0..1, per cell):
//   world.leafOn  – how much of the deciduous canopy is in leaf
//   world.autumn  – how far its leaves have turned (0 green … 1 full autumn colour)
//   world.flush   – fresh spring green (new leaves and new grass)
// Grass follows the same clock: straw-brown and dormant in the cold, bright green in spring.

import { seasonParams } from './climate.js';

let lastPhase = null;

export function phenologyStep(world) {
  const n = world.N * world.N;
  if (!world.leafOn) {
    world.leafOn = new Float32Array(n).fill(1);
    world.autumn = new Float32Array(n);
    world.flush = new Float32Array(n);
  }
  const L = world.leafOn, A = world.autumn, F = world.flush;
  if (!seasonParams.enabled) { L.fill(1); A.fill(0); F.fill(0); lastPhase = null; return; }
  // Time since the last update, as a fraction of a year (handles wrap-around)
  const ph = seasonParams.phase;
  let dy = lastPhase === null ? 0.02 : ph - lastPhase;
  if (dy < 0) dy += 1;
  lastPhase = ph;
  if (dy > 0.25) dy = 0.25;
  const k = 1 - Math.exp(-dy * 45);   // leaves respond within ~a week or two
  const kc = 1 - Math.exp(-dy * 25);  // colour builds over a few weeks
  const decay = Math.exp(-dy * 7);    // spring freshness fades over ~2 months
  // A gentle spring greening everywhere (new growth on evergreens and grass too)
  const spring = ph < 0.25 ? smooth(0, 0.04, ph) * (1 - smooth(0.13, 0.22, ph)) : 0;
  // u: position in the year from the start of winter (0) through spring (0.25), summer (0.5) and
  // autumn (0.75)
  const u = (ph + 0.25) % 1;
  const T = world.temperature, Vy = world.valley;
  for (let i = 0; i < n; i++) {
    // The local climate the trees are tuned to: the yearly average, warmer in sheltered valleys,
    // colder on exposed crests
    const vy = Vy ? Vy[i] : 0;
    let Tl = T[i] + (vy > 0 ? 3 * vy : 2 * vy);
    Tl = Tl < -10 ? -10 : Tl > 28 ? 28 : Tl;
    // Autumn starts earlier where it's colder (about 2 days per °C), spring later
    const turn = Math.min(0.84, 0.75 + 0.005 * Tl), bud = 0.33 - 0.004 * Tl;
    let leafT, autT;
    if (u < bud) { leafT = u < 0.2 ? 0 : L[i]; autT = A[i]; }        // winter: bare (or still hanging on)
    else if (u < turn) { leafT = smooth(bud, bud + 0.04, u); autT = 0; } // spring and summer
    else { leafT = 1 - smooth(turn + 0.09, turn + 0.15, u); autT = smooth(turn, turn + 0.05, u); } // colour, peak, fall
    // Where winters stay mild, trees keep their leaves (and grass stays green) through the year
    const dormant = smooth(14, 4, Tl - seasonParams.swing);
    leafT = 1 - dormant * (1 - leafT);
    autT *= dormant;
    const before = L[i];
    L[i] += (leafT - before) * k;
    A[i] += (autT - A[i]) * (autT > A[i] ? kc : k);
    // New leaves are fresh green
    let f = F[i] * decay + Math.max(0, L[i] - before) * 1.6;
    if (spring * 0.55 > f) f += (spring * 0.55 - f) * k;
    F[i] = f > 1 ? 1 : f;
  }
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
