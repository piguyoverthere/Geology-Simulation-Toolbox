// Faults: breaks in the crust where two blocks of rock slide past each other.
//
//   normal      – the crust is being pulled apart; one block (the hanging wall) drops down along
//                 the fault, leaving a cliff (*fault scarp*). Rift valleys and basin-and-range.
//   reverse     – the crust is being squeezed; one block is pushed up and over the other. Low-angle
//                 reverse faults (*thrusts*) stack up mountain ranges.
//   strike-slip – the blocks slide sideways past each other (San Andreas). Rivers and ridges
//                 crossing the fault get offset.
//
// Faults don't slip smoothly: stress builds until the rock snaps in an *earthquake*, moving it a
// little at a time. Slip is greatest in the middle of the fault and tapers to nothing at its tips,
// and the ground deforms less the further it is from the fault. Rock layers move with the blocks,
// so a fault juxtaposes different rocks across the scarp.

export const FAULT_TYPES = {
  normal: { label: 'Normal (pull-apart)', help: 'One block drops, leaving a cliff-like scarp. Drag along the fault line; flip the drag direction to drop the other side.' },
  reverse: { label: 'Reverse / thrust (squeeze)', help: 'One block is pushed up and over the other. Flip the drag direction to raise the other side.' },
  strikeSlip: { label: 'Strike-slip (sideways)', help: 'The two sides slide past each other horizontally, offsetting rivers and ridges.' },
};

export const faultSettings = {
  type: 'normal',
  slip: 6,        // total displacement over the whole event
  quakes: 8,      // number of earthquakes it is released in
};

const QUAKE_INTERVAL = 0.9; // simulated seconds between earthquakes

/** Start a fault along the dragged line a→b. */
export function startFault(world, a, b, settings = faultSettings) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 6) return null;
  const ev = {
    kind: 'fault', type: settings.type, a, b, len,
    dir: { x: (b.x - a.x) / len, z: (b.z - a.z) / len },
    slipPerQuake: settings.slip / settings.quakes, quakesLeft: settings.quakes, wait: 0,
    update(world, dt) { return faultUpdate(world, this, dt); },
  };
  world.faults.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, type: settings.type });
  world.events.push(ev);
  return ev;
}

function faultUpdate(world, ev, dt) {
  ev.wait -= dt;
  if (ev.wait > 0) return false;
  ev.wait = QUAKE_INTERVAL * (0.6 + Math.random() * 0.8);
  // Each quake ruptures a random stretch of the fault, so the scarp grows unevenly like a real one
  const patch = 0.35 + Math.random() * 0.65;
  if (ev.type === 'strikeSlip') slideSideways(world, ev, ev.slipPerQuake * (0.6 + 0.8 * Math.random()), patch);
  else moveVertically(world, ev, ev.slipPerQuake * (0.6 + 0.8 * Math.random()), patch);
  world.quake = Math.min(1.5, world.quake + 0.6 + ev.slipPerQuake * 0.15);
  world.dirty = true;
  return --ev.quakesLeft <= 0;
}

/** Fault-local coordinates of a cell: distance along the trace (0..len) and signed distance off it. */
function local(ev, x, z) {
  const dx = x - ev.a.x, dz = z - ev.a.z;
  return { along: dx * ev.dir.x + dz * ev.dir.z, across: dx * -ev.dir.z + dz * ev.dir.x };
}

/** Slip profile along the trace: 0 beyond the tips, rising smoothly to 1 in the middle. */
function alongWeight(ev, along, patch) {
  const t = along / ev.len;
  const half = patch / 2;
  const u = (t - 0.5) / Math.max(0.15, half + 0.15);
  return u <= -1 || u >= 1 ? 0 : Math.cos(u * Math.PI / 2) ** 2;
}

function moveVertically(world, ev, slip, patch) {
  const N = world.N, H = world.height;
  const reach = ev.len * 0.6;      // how far from the fault the blocks feel it
  const sign = ev.type === 'normal' ? -1 : 1;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const { along, across } = local(ev, x, z);
      const w = alongWeight(ev, along, patch);
      if (w === 0 || Math.abs(across) > reach) continue;
      const fall = 1 - Math.abs(across) / reach;
      // Left side (across > 0) is the moving block; the other side rebounds a little the other way.
      // The scarp itself is smoothed over ~1.5 cells.
      const side = smoothStep(-1.5, 1.5, across);
      const dh = slip * w * fall * (side * sign + (1 - side) * -sign * 0.25);
      const i = z * N + x;
      H[i] += dh;
      world.strataWarp[i] -= dh;        // rock layers ride with the block
      if (world.intrusionTop[i] > -Infinity) world.intrusionTop[i] += dh;
      if (world.surfaceRock[i] >= 0) world.surfaceBase[i] += dh;
      world.prevHeight[i] = H[i];
    }
  }
}

let tmp = null;
function slideSideways(world, ev, slip, patch) {
  const N = world.N, n = N * N;
  const reach = ev.len * 0.6;
  // Each side moves half the slip in opposite directions along the fault, fading with distance
  const offX = new Float32Array(n), offZ = new Float32Array(n);
  let anyMove = false;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const { along, across } = local(ev, x, z);
      const w = alongWeight(ev, along, patch);
      if (w === 0 || Math.abs(across) > reach) continue;
      const side = smoothStep(-1, 1, across) * 2 - 1; // -1 … 1
      const u = 0.5 * slip * w * side * (1 - Math.abs(across) / reach);
      offX[z * N + x] = u * ev.dir.x; offZ[z * N + x] = u * ev.dir.z;
      anyMove = true;
    }
  }
  if (!anyMove) return;
  // Resample every field that belongs to the ground from where it came from
  const floats = [world.height, world.strataWarp, world.vegetation, world.intrusionTop, world.surfaceBase, world.baseline];
  for (const f of floats) resample(f, N, offX, offZ, true);
  for (const f of [world.province, world.intrusionRock, world.surfaceRock]) resample(f, N, offX, offZ, false);
  world.prevHeight.set(world.height);
}

function resample(field, N, offX, offZ, bilinear) {
  if (!tmp || tmp.length !== field.length) tmp = new Float64Array(field.length);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (offX[i] === 0 && offZ[i] === 0) { tmp[i] = field[i]; continue; }
      const sx = Math.min(N - 1.001, Math.max(0, x - offX[i])), sz = Math.min(N - 1.001, Math.max(0, z - offZ[i]));
      const x0 = sx | 0, z0 = sz | 0;
      if (!bilinear) { tmp[i] = field[Math.round(sz) * N + Math.round(sx)]; continue; }
      const fx = sx - x0, fz = sz - z0, j = z0 * N + x0;
      const a = field[j], b = field[j + 1], c = field[j + N], d = field[j + N + 1];
      // Infinite values (no intrusion) can't be interpolated
      if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) { tmp[i] = field[Math.round(sz) * N + Math.round(sx)]; continue; }
      tmp[i] = (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
    }
  }
  for (let i = 0; i < field.length; i++) field[i] = tmp[i];
}

function smoothStep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
