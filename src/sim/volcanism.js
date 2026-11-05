// Volcanism: eruptions, lava flows, ash fall and intrusions.
//
// How runny lava is depends mostly on its silica content:
//   basalt    – low silica, hot and runny. Flows far in thin sheets, building broad, gentle
//               *shield volcanoes* (Hawaii) or flooding whole regions from long fissures.
//   andesite  – medium silica, sticky. Short, thick flows plus ash explosions build the steep
//               layered cones of *stratovolcanoes* (Fuji, Mount St Helens).
//   rhyolite  – high silica, very viscous and gas-rich. Erupts explosively (craters, huge ash
//               blankets) and the lava that does come out piles up as a steep *lava dome*.
//
// Lava is simulated as a thick, sticky fluid: it only moves when its surface slope beats a yield
// strength (stickier lava needs a steeper slope), runs more slowly as it cools, and solidifies into
// new rock of its type when it gets cold. Ash settles as soft tuff that buries plants.
//
// Magma that never reaches the surface forms *intrusions*: a pluton (a big body of granite that
// domes the ground above it, exposed only once erosion strips the cover) or a dike (a vertical
// sheet of basalt that, being hard, is left standing as a wall when the softer rock around wears away).

import { ROCK_INDEX } from '../core/rocks.js';

export const ERUPTION_TYPES = {
  basaltic: {
    label: 'Basaltic (shield / fissure)', rock: ROCK_INDEX.basalt,
    yield: 0.03, fluidity: 3.5, cool: 0.018, rate: 22, duration: 28,
    crater: 0, ash: 0,
    help: 'Hot, runny basalt lava that flows far and builds broad shields. Drag to open a fissure.',
  },
  andesitic: {
    label: 'Andesitic (stratovolcano)', rock: ROCK_INDEX.andesite,
    yield: 0.35, fluidity: 1.0, cool: 0.04, rate: 12, duration: 26,
    crater: 1.5, ash: 1.6, ashRadius: 28,
    help: 'Sticky andesite lava in short, thick flows with ash bursts: builds a steep layered cone.',
  },
  rhyolitic: {
    label: 'Rhyolitic (explosive / dome)', rock: ROCK_INDEX.rhyolite,
    yield: 1.3, fluidity: 0.25, cool: 0.08, rate: 7, duration: 22,
    crater: 6, ash: 3.2, ashRadius: 48,
    help: 'Explosive, gas-rich rhyolite: blasts a crater and a wide ash blanket, then a steep lava dome grows.',
  },
};
const TYPE_LIST = Object.values(ERUPTION_TYPES);

export const INTRUSION_TYPES = {
  pluton: { label: 'Pluton (granite)', help: 'A large body of magma that cools underground into granite, doming the ground above it. Click; brush size sets its size.' },
  dike: { label: 'Dike (basalt)', help: 'Magma forced up a vertical crack, cooling to a hard basalt wall. Drag to draw it.' },
};

export const volcanoSettings = {
  eruption: 'basaltic',
  size: 1,          // scales eruption volume / ash
  intrusion: 'pluton',
  wind: [1, 0.35],  // ash drifts downwind
};

const LAVA_DT = 0.05;
let dL = null, dHeat = null;

/** Start an eruption at a point, or along a fissure from a to b. Returns the event. */
export function startEruption(world, a, b, settings = volcanoSettings) {
  const typeKey = settings.eruption;
  const type = ERUPTION_TYPES[typeKey];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const vents = [];
  if (len < 4) vents.push({ x: a.x, z: a.z });
  else for (let t = 0; t <= len; t += 3) vents.push({ x: a.x + (b.x - a.x) * t / len, z: a.z + (b.z - a.z) * t / len });
  const ev = {
    kind: 'eruption', typeKey, type, vents, size: settings.size, t: 0,
    duration: type.duration * (0.6 + 0.4 * settings.size),
    // Explosive eruptions blast at the start; andesite also has smaller ash bursts later on
    ashLeft: type.ash * settings.size, crater: type.crater * Math.sqrt(settings.size),
    get active() { return this.t < this.duration; },
    update(world, dt) { return eruptionUpdate(world, this, dt); },
  };
  world.events.push(ev);
  return ev;
}

function eruptionUpdate(world, ev, dt) {
  const N = world.N, type = ev.type;
  // Opening blast: excavate a crater
  if (ev.t === 0 && ev.crater > 0) {
    for (const v of ev.vents) {
      forDisc(N, v.x, v.z, 2 + ev.crater, (i, f) => {
        world.height[i] -= ev.crater * f * f;
        world.vegetation[i] = 0;
      });
    }
  }
  ev.t += dt;
  if (ev.t >= ev.duration) return true;

  // Lava pours out of each vent, fastest early on and tapering off
  const pulse = 1 - 0.7 * (ev.t / ev.duration);
  const perVent = (type.rate * ev.size * pulse * dt) / ev.vents.length;
  for (const v of ev.vents) {
    let w = 0;
    forDisc(N, v.x, v.z, 2, (i, f) => { w += f; });
    forDisc(N, v.x, v.z, 2, (i, f) => {
      const add = perVent * f / w;
      const L = world.lava[i];
      world.lavaTemp[i] = (world.lavaTemp[i] * L + 1 * add) / (L + add);
      world.lava[i] = L + add;
      world.lavaType[i] = TYPE_LIST.indexOf(type);
      world.water[i] = 0;
    });
  }

  // Ash: most falls in the first third of the eruption
  if (ev.ashLeft > 0 && ev.t < ev.duration * 0.35) {
    const amount = Math.min(ev.ashLeft, type.ash * ev.size * dt / (ev.duration * 0.35));
    ev.ashLeft -= amount;
    for (const v of ev.vents) ashFall(world, v.x, v.z, type.ashRadius * Math.sqrt(ev.size), amount / ev.vents.length);
  }
  world.dirty = true;
  return false;
}

/** Spread a layer of ash (peak thickness `amount`) around a vent, drifting downwind. */
function ashFall(world, vx, vz, radius, amount) {
  const N = world.N, H = world.height;
  const [wx, wz] = volcanoSettings.wind;
  const cx = vx + wx * radius * 0.35, cz = vz + wz * radius * 0.35;
  forDisc(N, cx, cz, radius * 1.4, (i, f, x, z) => {
    const d = Math.hypot(x - vx, z - vz) / radius;
    const thick = amount * Math.exp(-2.2 * d) * Math.min(1, f * 2);
    if (thick < 0.002) return;
    depositRock(world, i, thick, ROCK_INDEX.tuff);
    world.vegetation[i] *= 1 - Math.min(0.95, 0.3 + thick * 4);
    // Ash weathers into soil fairly quickly; thick beds take longer
    world.freshRock[i] = Math.max(world.freshRock[i], Math.min(0.85, 0.5 + thick * 2));
  });
}

/** Add `thick` of new rock on top of cell i, recording it as a surface deposit. */
function depositRock(world, i, thick, rock) {
  const h = world.height[i];
  // Continue an existing deposit of the same rock, otherwise start a new one at the current ground
  const exposed = world.surfaceRock[i] >= 0 && h > world.surfaceBase[i] + 1e-3;
  if (!(exposed && world.surfaceRock[i] === rock)) {
    world.surfaceRock[i] = rock;
    world.surfaceBase[i] = h;
  }
  world.height[i] = h + thick;
  world.prevHeight[i] = world.height[i]; // the vegetation step shouldn't count this as erosion
  world.humus[i] = 0;                    // the old soil is buried
}

/**
 * Advance lava flow one step. Lava moves toward lower lava-surface neighbours when the drop beats
 * its yield strength, carrying its heat; it cools (thin flows faster) and solidifies into rock.
 */
export function lavaStep(world, dt = LAVA_DT) {
  const N = world.N, n = N * N;
  const L = world.lava, T = world.lavaTemp, K = world.lavaType, H = world.height;
  if (!dL || dL.length !== n) { dL = new Float32Array(n); dHeat = new Float32Array(n); }
  dL.fill(0); dHeat.fill(0);
  let any = false;
  const nb = [0, 0, 0, 0], wts = [0, 0, 0, 0];

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (L[i] < 1e-3) continue;
      any = true;
      const type = TYPE_LIST[K[i]];
      const s = H[i] + L[i];
      nb[0] = x > 0 ? i - 1 : -1; nb[1] = x < N - 1 ? i + 1 : -1;
      nb[2] = z > 0 ? i - N : -1; nb[3] = z < N - 1 ? i + N : -1;
      // Lava reaching the map edge flows off it instead of piling up against the border
      if (x === 0 || z === 0 || x === N - 1 || z === N - 1) {
        L[i] -= Math.min(L[i], L[i] * 0.3 + 0.02);
        if (L[i] < 1e-3) { L[i] = 0; T[i] = 0; continue; }
      }
      let total = 0;
      for (let k = 0; k < 4; k++) {
        const j = nb[k];
        wts[k] = 0;
        if (j < 0) continue;
        const d = s - (H[j] + L[j]) - type.yield;
        if (d > 0) { wts[k] = d; total += d; }
      }
      if (total <= 0) continue;
      // Hot lava runs; cooling lava stiffens
      const temp = T[i];
      const amount = Math.min(L[i] * 0.45, type.fluidity * temp * temp * total * dt * 6);
      for (let k = 0; k < 4; k++) {
        if (wts[k] <= 0) continue;
        const q = amount * wts[k] / total;
        dL[nb[k]] += q; dHeat[nb[k]] += q * temp;
        if (L[nb[k]] < 1e-3) K[nb[k]] = K[i];
      }
      dL[i] -= amount; dHeat[i] -= amount * temp;
    }
  }
  if (!any) return false;

  for (let i = 0; i < n; i++) {
    if (dL[i] === 0 && L[i] < 1e-3) continue;
    const heat = L[i] * T[i] + dHeat[i];
    L[i] += dL[i];
    if (L[i] < 1e-4) { L[i] = 0; T[i] = 0; continue; }
    T[i] = Math.max(0, heat / L[i]);
    const type = TYPE_LIST[K[i]];
    // Thin lava loses heat faster; a thick flow keeps a hot core
    T[i] -= type.cool * dt * (0.4 + 0.6 / (L[i] + 0.4));
    world.water[i] = 0;
    world.vegetation[i] = 0;
    if (T[i] < 0.08 || (L[i] < 0.03 && T[i] < 0.4)) {
      depositRock(world, i, L[i], type.rock);
      world.freshRock[i] = 1; // bare new rock: no soil for plants to root in yet
      L[i] = 0; T[i] = 0;
    }
  }
  world.dirty = true;
  return true;
}

/** Start an intrusion: a pluton at point a (radius r), or a dike along a→b. */
export function startIntrusion(world, a, b, radius, settings = volcanoSettings) {
  const ev = settings.intrusion === 'dike'
    ? { kind: 'dike', a, b, t: 0, duration: 4 }
    : { kind: 'pluton', x: a.x, z: a.z, r: Math.max(6, radius), t: 0, duration: 10, lift: 0 };
  ev.update = (world, dt) => (ev.kind === 'dike' ? dikeUpdate(world, ev, dt) : plutonUpdate(world, ev, dt));
  world.events.push(ev);
  return ev;
}

function plutonUpdate(world, ev, dt) {
  const N = world.N, H = world.height;
  const total = ev.r * 0.45;          // final dome height
  if (ev.t === 0) {
    // The granite body: its top sits a few units below the surface at the centre and dives deeper
    // toward the edges, so erosion of the dome exposes the core first.
    forDisc(N, ev.x, ev.z, ev.r, (i, f) => {
      world.intrusionRock[i] = ROCK_INDEX.granite;
      world.intrusionTop[i] = H[i] - 3 - (1 - f) * ev.r * 0.8;
    });
  }
  const before = ev.lift;
  ev.t = Math.min(ev.duration, ev.t + dt);
  ev.lift = total * smooth(ev.t / ev.duration);
  const step = ev.lift - before;
  // Uplift the dome; the rock layers above it bend upward with the ground
  forDisc(N, ev.x, ev.z, ev.r * 1.3, (i, f) => {
    const up = step * f * f * (3 - 2 * f);
    H[i] += up;
    world.intrusionTop[i] += up;
    world.strataWarp[i] -= up;
    if (world.surfaceRock[i] >= 0) world.surfaceBase[i] += up;
    world.prevHeight[i] = H[i];
  });
  world.dirty = true;
  return ev.t >= ev.duration;
}

function dikeUpdate(world, ev, dt) {
  // The sheet propagates from a to b over its duration
  const N = world.N;
  const p0 = ev.t / ev.duration;
  ev.t = Math.min(ev.duration, ev.t + dt);
  const p1 = ev.t / ev.duration;
  const len = Math.max(1, Math.hypot(ev.b.x - ev.a.x, ev.b.z - ev.a.z));
  for (let s = p0 * len; s <= p1 * len; s += 0.5) {
    const x = ev.a.x + (ev.b.x - ev.a.x) * s / len, z = ev.a.z + (ev.b.z - ev.a.z) * s / len;
    forDisc(N, x, z, 1.6, (i) => {
      world.intrusionRock[i] = ROCK_INDEX.basalt;
      world.intrusionTop[i] = Infinity; // reaches the surface
      world.height[i] += 0.04;          // magma pressure bulges the ground a little
      world.prevHeight[i] = world.height[i];
    });
  }
  world.dirty = true;
  return ev.t >= ev.duration;
}

/** Visit cells within radius r of (cx, cz) with falloff f (1 at the centre, 0 at the edge). */
function forDisc(N, cx, cz, r, fn) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
  const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(N - 1, Math.ceil(cz + r));
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d < r) fn(z * N + x, 1 - d / r, x, z);
    }
  }
}

function smooth(t) { return t * t * (3 - 2 * t); }
