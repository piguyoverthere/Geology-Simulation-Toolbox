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

import { storeLevel, fetchLevel, deleteLevel } from './save.js';

const LIST = 'sims';
const HISTORY_MAX = 24;
const SIZES = [128, 192, 256, 384, 512];

export async function listSims() {
  let list = await fetchLevel(LIST);
  if (!Array.isArray(list)) list = await migrate();
  return list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export async function saveSims(list) { await storeLevel(LIST, list); }

export async function getSim(id) { return (await listSims()).find((s) => s.id === id) || null; }

export async function updateSim(id, changes) {
  const list = await listSims();
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  Object.assign(s, changes);
  await saveSims(list);
  return s;
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

export async function addSim(meta) {
  const list = await listSims();
  list.push(meta);
  await saveSims(list);
  return meta;
}

/** Delete a simulation: its level, its history and its world grid (with the cells frozen in it). */
export async function deleteSim(id) {
  const list = await listSims();
  const s = list.find((x) => x.id === id);
  if (!s) return;
  await deleteLevel(s.saveKey);
  for (const h of s.history || []) await deleteLevel(h.key);
  try {
    const g = await fetchLevel(s.gridKey);
    if (g && g.cells) for (const k of Object.keys(g.cells)) await deleteLevel(`cell-${s.N}-${g.id}-${k}`);
  } catch { /* no grid */ }
  await deleteLevel(s.gridKey);
  await saveSims(list.filter((x) => x.id !== id));
}

/** Keep a copy of the simulation's level as it is now in its history. */
export async function pushHistory(id, snap, label) {
  const list = await listSims();
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
  await saveSims(list);
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

/** The first time: levels kept from before simulations existed become simulations of their own. */
async function migrate() {
  const list = [];
  for (const N of SIZES) {
    let snap = null;
    try { snap = await fetchLevel(`autosave-${N}`); } catch { /* none */ }
    if (!snap || !snap.meta) continue;
    const t = Date.parse(snap.meta.savedAt) || Date.now();
    const gen = (snap.meta.params && snap.meta.params.gen) || {};
    list.push({
      id: `legacy-${N}`, name: `My simulation${N !== 256 ? ` (${N}×${N})` : ''}`, N, preset: gen.preset || 'mountains', seed: gen.seed,
      settings: {}, created: t, updated: t, saveKey: `autosave-${N}`, gridKey: `grid-${N}`, thumb: null, history: [],
    });
  }
  await saveSims(list);
  return list;
}
