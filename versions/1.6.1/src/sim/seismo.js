// The seismograph: a record of the ground shaking.
//
// Every shock the simulation makes is logged with a magnitude (world.quakeLog, saved): earthquakes
// (Land events), faults slipping, volcanic eruptions and their explosions, big landslides and
// collapsing sea cliffs. Between shocks the needle is never quite still: a faint background hum,
// a steady tremor while a volcano erupts (magma moving), and the microseism of storm waves pounding
// the coast. ui/seismograph.js draws the trace, scrolling like a drum recorder, with the list of
// recent shocks.

import { seasonParams } from './climate.js';

const LEN = 900;
/** The live trace (not saved): ground motion, newest at `head`. */
export const trace = { v: new Float32Array(LEN), head: 0, len: LEN, tremor: 0, storm: 0 };
let shock = 0, phase = 0, frames = 0;

const KINDS = {
  quake: 'Earthquake', fault: 'Fault slip', eruption: 'Volcanic eruption', blast: 'Volcanic explosion',
  landslide: 'Landslide', megaslide: 'Giant landslide', cliff: 'Cliff collapse',
};
export const quakeKindLabel = (k) => KINDS[k] || k;

/** Log a shock of magnitude M at (x, z) and kick the needle. */
export function recordShock(world, kind, M, x, z, extra) {
  if (!world.quakeLog) world.quakeLog = [];
  const year = (seasonParams.year || 1) + (seasonParams.phase || 0);
  world.quakeLog.push({ kind, M: Math.round(M * 10) / 10, x: Math.round(x), z: Math.round(z), year: Math.round(year * 100) / 100, ...(extra || {}) });
  if (world.quakeLog.length > 200) world.quakeLog.splice(0, world.quakeLog.length - 200);
  // (amplitude grows ten-fold a magnitude, squashed so the trace keeps both small and big ones)
  shock = Math.max(shock, Math.min(1.4, 0.06 * Math.pow(10, (M - 2) / 2.2)));
  world.seismoNew = (world.seismoNew || 0) + 1;
}

/** Advance the trace by one frame. */
export function seismoSample(world) {
  // Volcanic tremor while anything erupts; the storm microseism from the waves on the coast
  let tremor = 0;
  for (const ev of world.events || []) if (ev.kind === 'eruption') tremor += 0.08 + 0.04 * (ev.size || 1);
  trace.tremor = Math.min(0.35, tremor);
  if (world.stormWave && ++frames % 30 === 0) {
    let s = 0, c = 0;
    const SW = world.stormWave;
    for (let i = 0; i < SW.length; i += 97) { s += SW[i]; c++; }
    trace.storm = Math.min(0.25, (s / Math.max(1, c)) * 0.8);
  }
  phase += 0.9;
  const noise = (Math.random() - 0.5) * 0.03;
  const trem = trace.tremor * Math.sin(phase * 1.7) * (0.6 + 0.4 * Math.random());
  const micro = trace.storm * Math.sin(phase * 0.23) * (0.7 + 0.3 * Math.random());
  const quake = shock * (Math.random() - 0.5) * 2 * (0.5 + 0.5 * Math.abs(Math.sin(phase * 2.3)));
  shock *= 0.96;
  if (shock < 0.002) shock = 0;
  trace.head = (trace.head + 1) % LEN;
  trace.v[trace.head] = noise + trem + micro + quake;
}
