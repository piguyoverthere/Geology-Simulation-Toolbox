// Fungi: the fungal life of the soil and the forest (world.fungi, fungal diversity 0…1), and the
// honey mushroom (Armillaria), a root and butt rot (world.rootRot, 0…1).
//
// Fungal diversity: the mycorrhizal fungi partnering with the trees' roots and the decomposers
// breaking down their litter and dead wood. Richest under old forest of many kinds of trees, and most
// of all under trees whose roots partner closely with many fungi (pine, fir, spruce, oak, beech,
// birch…); poor under young or single-kind stands, on farmland and in timber plantations; set back
// by fire, by clearing and by pollution, and slow to come back (decades). Where it's rich, trees
// grow faster (the fungi feed their roots water and nutrients), dead wood rots away sooner, and the
// soil builds faster from the decaying matter (sim/vegetation.js).
//
// Honey mushroom (Armillaria): a root and butt rot. It spreads slowly underground from stand to
// stand along bootlace-like strands (rhizomorphs), and now and then by spores to a stand far away.
// It takes best in old, stressed trees (drought, dense even-aged plantations) and poorly where the
// soil's fungal life is rich (the other fungi crowd it out). Heavily infected stands die off over
// some years, leaving dead wood; with its hosts gone it dies out and the forest grows back.
// ecoParams.rootRot switches it on; ecoParams.rootRotStrength scales how hard it hits.

import { ecoParams } from './ecology.js';

const seaOf = (w) => (w.meanSea !== undefined && w.meanSea > -999 ? w.meanSea : -1e9);

function ensure(world) {
  const n = world.N * world.N;
  if (!world.fungi || world.fungi.length !== n) {
    world.fungi = new Float32Array(n);
    for (let i = 0; i < n; i++) world.fungi[i] = target(world, i);
  }
  if (!world.rootRot || world.rootRot.length !== n) world.rootRot = new Float32Array(n);
  if (!world.inoculum || world.inoculum.length !== n) world.inoculum = new Float32Array(n);
}

/** Make sure the fungi layers exist (for the Fungi and Root rot tools). */
export function ensureFungi(world) { ensure(world); }

/** The fungal diversity a cell would come to hold, left as it is. */
function target(world, i) {
  const v = world.vegetation[i];
  if (world.height[i] < seaOf(world) || v < 0.05) return 0;
  const age = world.forestAge[i];
  const cover = Math.min(1, v / 0.8);
  const rich = world.treeRichness ? world.treeRichness[i] : 0.3;
  const ecto = world.ectoShare ? world.ectoShare[i] : 0.5;
  let t = cover * (0.12 + 0.38 * (v > 0.6 ? age : age * 0.3) + 0.3 * rich + 0.2 * ecto * (v > 0.6 ? 1 : 0.3));
  const LU = world.landUse ? world.landUse[i] : 0;
  if (LU === 10) t *= 0.35;          // (a plantation: one kind of tree, cut young)
  else if (LU === 1) t *= 0.3;       // (ploughed and fertilised fields)
  else if (LU) t *= 0.1;             // (paved, built over)
  if (world.burnt[i] > 0) t *= 1 - 0.8 * Math.min(1, world.burnt[i]);
  if (world.airPollution && world.airPollution[i] > 0.1) t *= 1 - 0.5 * Math.min(1, world.airPollution[i]);
  // (fungi brought in with the Fungi tool: they hold on for years where something grows to host them)
  if (world.inoculum && world.inoculum[i] > 0) t += 0.45 * world.inoculum[i] * Math.min(1, v / 0.5);
  return Math.min(1, t);
}

let tick = 0;
/** One fungi step (every 30 frames). */
export function fungiStep(world) {
  ensure(world);
  const N = world.N, n = N * N, FG = world.fungi, R = world.rootRot, V = world.vegetation, A = world.forestAge;
  // Fungal diversity follows the forest, slowly (it builds over decades; fire and clearing wipe it fast)
  const IN = world.inoculum;
  for (let i = 0; i < n; i++) {
    const t = target(world, i);
    FG[i] += (t - FG[i]) * (t > FG[i] ? 0.004 : 0.04);
    if (IN[i] > 0) { IN[i] = Math.max(0, IN[i] - 0.0015); } // (fades over some years, unless the forest takes it up)
  }
  if (!ecoParams.rootRot) { if (++tick % 10 === 0) R.fill(0); return; }
  const k = ecoParams.rootRotStrength ?? 1;
  if (k <= 0) return;
  // How well a stand suits the honey mushroom: forest, the older the better, more if stressed
  // (dry soil, a plantation), less where the soil's other fungi are rich
  const host = (i) => {
    if (V[i] < 0.5) return 0;
    const dry = world.soil ? 1 + 0.6 * Math.max(0, 0.45 - world.soil[i]) / 0.45 : 1;
    const plant = world.landUse && world.landUse[i] === 10 ? 1.6 : 1;
    return Math.min(1.5, (0.3 + 0.7 * A[i]) * dry * plant * (1.15 - 0.7 * FG[i]));
  };
  // A first outbreak now and then in old forest, where there is none
  let total = 0;
  for (let i = 0; i < n; i += 7) total += R[i];
  if (total < 0.5 && Math.random() < 0.03 * k) {
    for (let t = 0; t < 40; t++) { const i = Math.floor(Math.random() * n); if (V[i] > 0.7 && A[i] > 0.6) { R[i] = 0.4; break; } }
  }
  const next = R.slice();
  let dead = 0;
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = z * N + x, r = R[i], h = host(i);
    // (underground: along the strands from infected stands next door, slowly)
    const near = (R[i - 1] + R[i + 1] + R[i - N] + R[i + N]) * 0.25;
    let g = next[i];
    if (h > 0) {
      g += 0.05 * k * near * h * (1 - g);            // creeping in
      g += 0.06 * k * g * (1 - g) * (h - 0.3);       // building up (or dwindling in a poor host)
    } else g -= 0.03 * g;                            // no hosts: it dies out
    // (a rich fungal community holds it in check)
    if (FG[i] > 0.6) g -= 0.004 * (FG[i] - 0.6) * g;
    next[i] = g < 0.0002 ? 0 : g > 1 ? 1 : g;
    // The infected trees die: from a light infection up, some trees rot at the base and fall (butt
    // rot), more the heavier it is; the stand thins, the old trees go first, dead wood is left
    if (r > 0.15 && V[i] > 0.4) {
      const heavy = Math.max(0, r - 0.55);
      const kill = k * (0.0012 * (r - 0.15) + 0.004 * heavy) * (0.5 + A[i]);
      V[i] = Math.max(0.2, V[i] - kill);
      A[i] = Math.max(0, A[i] - kill * 1.5);
      if (world.deadWood) world.deadWood[i] = Math.min(1, world.deadWood[i] + kill * 8); // (rotten trunks, snapped and fallen)
      dead += kill;
    }
  }
  // Spores: now and then a heavily infected stand seeds a new outbreak far away (it takes only in
  // a stand that suits it)
  for (let tries = 0; tries < 6; tries++) {
    const i = Math.floor(Math.random() * n);
    if (R[i] < 0.6 || Math.random() > 0.25 * k) continue;
    const ang = Math.random() * Math.PI * 2, d = 10 + Math.random() * N * 0.5;
    const x = Math.round((i % N) + Math.cos(ang) * d), z = Math.round(((i / N) | 0) + Math.sin(ang) * d);
    if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
    const j = z * N + x;
    if (Math.random() < 0.5 * host(j)) next[j] = Math.max(next[j], 0.25);
  }
  world.rootRot = next;
  world.rootRotKill = dead;
  world.dirty = true;
}
