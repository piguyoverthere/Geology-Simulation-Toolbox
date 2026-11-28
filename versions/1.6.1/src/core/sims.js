// Simulations: every level you make is a simulation of its own, kept in the browser (IndexedDB)
// until you delete it, and listed on the home screen. The list itself is stored under `sims`:
//   { id, name, N, preset, seed, settings, created, updated, saveKey, gridKey, thumb, history }
// Each simulation's level is saved under its saveKey (sim-<id>) and its world grid under its
// gridKey (grid-sim-<id>). Levels from before simulations existed (autosave-<size>) become
// simulations of their own the first time the home screen opens, keeping their keys, so nothing is
// lost and older versions of the app still find them.
//
// History: each simulation keeps earlier saves to roll back to (history: [{ key, t, label }]),
// one when a session starts and one an hour while it runs. When there are more than HISTORY_MAX
// the older ones are thinned out (every other one dropped), so the history still reaches back to
// the start.

import { storeLevel, fetchLevel, deleteLevel, listLevelKeys } from './save.js';

const LIST = 'sims';
const HISTORY_MAX = 24;
const SIZES = [128, 192, 256, 384, 512];

// Every change to the list is a read, a change and a write; two at once (an autosave while a new
// simulation is being made, say) would each write back the list they read, and one would drop what
// the other added. So they take turns.
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readList() {
  let list = await fetchLevel(LIST);
  if (!Array.isArray(list)) list = [];
  // Recover any simulation whose save is still stored but which the list has lost track of (and the
  // levels from before simulations existed, the first time)
  if (await recover(list)) await storeLevel(LIST, list);
  return list;
}

export function listSims() {
  return exclusive(async () => (await readList()).sort((a, b) => (b.updated || 0) - (a.updated || 0)));
}

export async function saveSims(list) { await exclusive(() => storeLevel(LIST, list)); }

export async function getSim(id) { return (await listSims()).find((s) => s.id === id) || null; }

export function updateSim(id, changes) {
  return exclusive(async () => {
    const list = await readList();
    const s = list.find((x) => x.id === id);
    if (!s) return null;
    Object.assign(s, changes);
    await storeLevel(LIST, list);
    return s;
  });
}

export function newSimMeta(opts) {
  const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const now = Date.now();
  return {
    id, name: opts.name || 'New simulation', N: opts.N, preset: opts.preset, seed: opts.seed,
    settings: opts.settings || {}, created: now, updated: now, saveKey: `sim-${id}`, gridKey: `grid-sim-${id}`,
    thumb: null, history: [], fresh: true,
  };
}

export function addSim(meta) {
  return exclusive(async () => {
    const list = await readList();
    // (if its save got stored first and the list already picked it up as recovered, this replaces that)
    const had = list.findIndex((x) => x.id === meta.id);
    if (had >= 0) list[had] = meta; else list.push(meta);
    await storeLevel(LIST, list);
    return meta;
  });
}

/** Delete a simulation: its level, its history and its world grid (with the cells frozen in it). */
export function deleteSim(id) {
  return exclusive(async () => {
  const list = await readList();
  const s = list.find((x) => x.id === id);
  if (!s) return;
  // (the list first, so a half-finished delete leaves no save for recovery to bring back as a ghost)
  await storeLevel(LIST, list.filter((x) => x.id !== id));
  await deleteLevel(s.saveKey);
  for (const h of s.history || []) await deleteLevel(h.key);
  try {
    const g = await fetchLevel(s.gridKey);
    if (g && g.cells) for (const k of Object.keys(g.cells)) await deleteLevel(`cell-${s.N}-${g.id}-${k}`);
  } catch { /* no grid */ }
  await deleteLevel(s.gridKey);
  });
}

/** Keep a copy of the simulation's level as it is now in its history. */
export function pushHistory(id, snap, label) {
  return exclusive(async () => {
  const list = await readList();
  const s = list.find((x) => x.id === id);
  if (!s || !snap) return;
  const t = Date.now(), key = `${s.saveKey}-h${t.toString(36)}`;
  await storeLevel(key, snap);
  s.history = s.history || [];
  s.history.push({ key, t, label });
  if (s.history.length > HISTORY_MAX) {
    // (thin out the older half: every other one goes)
    const half = Math.floor(s.history.length / 2), keep = [];
    for (let k = 0; k < s.history.length; k++) {
      if (k < half && k % 2 === 1) await deleteLevel(s.history[k].key);
      else keep.push(s.history[k]);
    }
    s.history = keep;
  }
  await storeLevel(LIST, list);
  });
}

/** Roll a simulation back to one of its earlier saves (the save now is kept in its history first). */
export async function restoreHistory(id, key) {
  const s = await getSim(id);
  if (!s) return false;
  const old = await fetchLevel(key);
  if (!old) return false;
  const now = await fetchLevel(s.saveKey);
  if (now) await pushHistory(id, now, 'Before rolling back');
  await storeLevel(s.saveKey, old);
  await updateSim(id, { updated: Date.now() });
  return true;
}

/**
 * Add to the list every simulation whose save is stored but isn't listed: saves of simulations
 * (sim-<id>) the list lost, and levels from before simulations existed (autosave-<size>). The save
 * itself carries the simulation's name (from 1.2 on); older ones are named after their map.
 */
async function recover(list) {
  let keys;
  try { keys = await listLevelKeys(); } catch { return false; }
  const known = new Set();
  for (const s of list) { known.add(s.saveKey); for (const h of s.history || []) known.add(h.key); }
  const have = new Set(keys);
  let added = false;
  const orphans = keys.filter((k) => !known.has(k) && (/^sim-[a-z0-9]+$/.test(k) || SIZES.some((N) => k === `autosave-${N}`)));
  for (const key of orphans) {
    let snap = null;
    try { snap = await fetchLevel(key); } catch { /* unreadable */ }
    if (!snap || !snap.meta) continue;
    const m = snap.meta, N = m.N, legacy = key.startsWith('autosave-');
    const id = legacy ? `legacy-${N}` : key.slice(4);
    if (list.some((x) => x.id === id)) continue;
    const t = Date.parse(m.savedAt) || Date.now();
    const gen = (m.params && m.params.gen) || {};
    const name = (m.sim && m.sim.name) || (legacy ? `My simulation${N !== 256 ? ` (${N}×${N})` : ''}` : `Recovered simulation (${N}×${N})`);
    // (its earlier saves, if they're still there)
    const history = keys.filter((k) => k.startsWith(`${key}-h`)).map((k) => ({ key: k, t: parseInt(k.slice(key.length + 2), 36) || t, label: 'Earlier save' })).sort((a, b) => a.t - b.t);
    const gridKey = legacy ? `grid-${N}` : `grid-${key}`;
    list.push({
      id, name, N, preset: gen.preset || 'mountains', seed: gen.seed, settings: (m.sim && m.sim.settings) || {},
      created: (m.sim && m.sim.created) || t, updated: t, saveKey: key, gridKey: have.has(gridKey) || !legacy ? gridKey : `grid-${N}`,
      thumb: null, history, appVersion: m.appVersion, recovered: !legacy,
    });
    added = true;
  }
  return added;
}

/**
 * Copy a simulation into a new one (to try things on without touching the original): its save and
 * its world grid, with the grid's frozen cells copied under a grid of its own, so changing or
 * deleting either never affects the other. Its earlier saves aren't copied. Returns the copy.
 */
export async function duplicateSim(id, name) {
  const s = await getSim(id);
  if (!s) return null;
  const copy = newSimMeta({ name: name || `${s.name} (test copy)`, N: s.N, preset: s.preset, seed: s.seed, settings: { ...(s.settings || {}) } });
  copy.fresh = !!s.fresh;
  copy.thumb = s.thumb || null;
  copy.appVersion = s.appVersion;
  copy.copyOf = s.name;
  await addSim(copy); // (listed first, so its save is never taken for a lost one while it's copied)
  const snap = await fetchLevel(s.saveKey);
  if (snap) await storeLevel(copy.saveKey, snap);
  try {
    const g = await fetchLevel(s.gridKey);
    if (g && g.cells) {
      const g2 = JSON.parse(JSON.stringify(g));
      g2.id = Math.random().toString(36).slice(2, 8);
      for (const k of Object.keys(g.cells)) {
        const cell = await fetchLevel(`cell-${s.N}-${g.id}-${k}`);
        if (cell) await storeLevel(`cell-${s.N}-${g2.id}-${k}`, cell);
      }
      await storeLevel(copy.gridKey, g2);
    }
  } catch { /* no grid */ }
  return copy;
}
