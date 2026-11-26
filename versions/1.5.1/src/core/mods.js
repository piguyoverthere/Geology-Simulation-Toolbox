// Mods: JavaScript files that add to the simulation, kept in the browser (like simulations) and
// loaded when the app starts, before anything is built. See docs/MODDING.md for how to write one.
//
// A mod is an ES module whose default export is a function taking the mod API:
//
//   export default function (api) {
//     api.addSpecies({ id: 'baobab', label: 'Baobab', ... });
//     api.addTool('seedBomb', { label: 'Seed bomb', icon: '🌱', group: 'Mods', help: '…', apply(ctx) { … } });
//     api.addOverlay('altitude', 'Altitude bands', (world, i) => [r, g, b], [{ label, color }]);
//     const s = api.addSetting({ key: 'rain', label: 'Rain boost', min: 0, max: 2, step: 0.1, value: 1 });
//     api.onStep((world, app) => { … }, 30);
//   }
//
// The list of mods is stored under the key `mods`: [{ id, name, source, enabled, added, error }].
// A mod that throws while loading is switched off and its error shown in the Mods panel.

import { storeLevel, fetchLevel } from './save.js';
import { APP_VERSION } from '../version.js';
import { SPECIES, refreshSpecies } from '../sim/species.js';
import { TOOLS } from '../tools/brushes.js';
import { OVERLAYS } from '../render/terrainRenderer.js';
import { civParams } from '../sim/civilization.js';
import { ecoParams, newAnimal, animalField, canLive, ensureEcology } from '../sim/ecology.js';
import { fireParams } from '../sim/fire.js';
import { climateParams, seasonParams } from '../sim/climate.js';
import { waterParams } from '../sim/water.js';
import { coastParams } from '../sim/coast.js';
import { groundwaterParams } from '../sim/groundwater.js';

const KEY = 'mods';

/** What the loaded mods have added: the app, renderer and panels read these. */
export const MOD = {
  loaded: [],      // [{ id, name }] mods that loaded
  steps: [],       // [{ mod, fn, every }] called during the simulation
  overlays: {},    // id → { mod, label, color(world, i), legend }
  settings: [],    // [{ mod, key, label, min, max, step, help, obj }] shown in the Mods panel
  animals: [],     // [{ mod, label, help, add(world) }] starter-animal buttons in Wildlife
};

export async function listMods() {
  const list = await fetchLevel(KEY).catch(() => null);
  return Array.isArray(list) ? list : [];
}
export async function saveMods(list) { await storeLevel(KEY, list); }

/** Add a mod from its source text (from a .js file or a URL). Returns it. */
export async function addMod(name, source) {
  const list = await listMods();
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const mod = { id, name: name.replace(/\.m?js$/i, '').slice(0, 60) || 'Mod', source, enabled: true, added: Date.now(), error: null };
  list.push(mod);
  await saveMods(list);
  return mod;
}

export async function setModEnabled(id, on) {
  const list = await listMods();
  const m = list.find((x) => x.id === id);
  if (m) { m.enabled = on; if (on) m.error = null; await saveMods(list); }
}

export async function removeMod(id) {
  await saveMods((await listMods()).filter((x) => x.id !== id));
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(`mod:${id}:`)) localStorage.removeItem(k); } catch { /* no storage */ }
}

/** The API a mod's function is given. */
function apiFor(mod) {
  const settingKey = (k) => `mod:${mod.id}:${k}`;
  return {
    version: APP_VERSION,
    name: mod.name,
    /** The running app (once it exists) and its world: use inside onStep, tools and overlays. */
    get app() { return window.app; },
    get world() { return window.app ? window.app.world : null; },
    /** The simulation's settings objects (change them to change how it behaves). */
    params: { civ: civParams, eco: ecoParams, fire: fireParams, climate: climateParams, season: seasonParams, water: waterParams, coast: coastParams, groundwater: groundwaterParams },
    /** The tree species list (read it; add to it with addSpecies). */
    species: SPECIES,
    /**
     * A new tree species. Required: id, label, color [r,g,b] 0–1, temp [lo, hi] °C, moist [lo, hi]
     * 0–1, age (0 pioneer … 1 old growth). Optional: mapColor, height (m), ageW, soil ('any', 'deep',
     * 'thin', 'shallow'), slope, chem, chemW, flam, soilBuild, fireproof (0–1), giant, conifer,
     * autumn [r,g,b] (deciduous), coastal, riparian, help.
     */
    addSpecies(def) {
      if (!def || !def.id || SPECIES.some((s) => s.id === def.id)) throw new Error(`species "${def && def.id}" is missing an id or already exists`);
      SPECIES.push({ height: 25, ageW: 0.5, soil: 'any', slope: 1, chem: 0, chemW: 2, flam: 1, soilBuild: 1, mapColor: def.color, help: `Added by the mod "${mod.name}".`, ...def, mod: mod.name });
      refreshSpecies();
    },
    /**
     * A new tool in the tool bar. def: { label, icon (an emoji), group (tool bar group; default
     * 'Mods'), help, click (true: once per click instead of while held), apply(ctx) } where ctx is
     * { world, app, x, z, radius, strength, dt, invert }.
     */
    addTool(id, def) {
      TOOLS[`${mod.id}_${id}`] = { group: 'Mods', icon: '🧩', editsTerrain: false, help: '', ...def, label: def.label || id };
    },
    /** A new overlay: color(world, i) returns [r, g, b] (0–1) for cell i; legend: [{ label, color }]. */
    addOverlay(id, label, color, legend = null) {
      const key = `mod_${mod.id}_${id}`;
      OVERLAYS[key] = `${label} (mod)`;
      MOD.overlays[key] = { mod: mod.name, label, color, legend };
    },
    /**
     * A setting in the Mods panel: a slider (min/max/step) or, for a true/false value, a switch.
     * Returns an object whose .value is the current setting (remembered between visits).
     */
    addSetting({ key, label, min = 0, max = 1, step = 0.01, value = 0, help = '' }) {
      const obj = { value };
      try { const v = localStorage.getItem(settingKey(key)); if (v !== null) obj.value = JSON.parse(v); } catch { /* none */ }
      const s = { mod: mod.name, key, label: label || key, min, max, step, help, obj, save: () => { try { localStorage.setItem(settingKey(key), JSON.stringify(obj.value)); } catch { /* none */ } } };
      MOD.settings.push(s);
      return obj;
    },
    /** Run fn(world, app) every `every` frames while the simulation runs. */
    onStep(fn, every = 30) { MOD.steps.push({ mod, fn, every: Math.max(1, Math.round(every)) }); },
    /** A button under Wildlife that adds animals: add(world, api) should push animals made with api.newAnimal. */
    addStarterAnimals(label, add, help = '') { MOD.animals.push({ mod: mod.name, label, help, add: (w) => add(w, this) }); },
    newAnimal, animalField, canLive, ensureEcology,
    log: (...a) => console.log(`[mod ${mod.name}]`, ...a),
  };
}

/** Load every switched-on mod (called once at start-up, before the app is built). */
export async function loadMods() {
  let list;
  try { list = await listMods(); } catch { return; }
  let changed = false;
  for (const m of list) {
    if (!m.enabled) continue;
    const url = URL.createObjectURL(new Blob([m.source], { type: 'text/javascript' }));
    try {
      const module = await import(url);
      const fn = module.default || module.setup;
      if (typeof fn !== 'function') throw new Error('it has no default export function (export default function (api) { … })');
      await fn(apiFor(m));
      MOD.loaded.push({ id: m.id, name: m.name });
      if (m.error) { m.error = null; changed = true; }
    } catch (err) {
      console.warn(`Mod "${m.name}" failed to load`, err);
      m.error = String(err && err.message || err); m.enabled = false; changed = true;
    } finally { URL.revokeObjectURL(url); }
  }
  if (changed) await saveMods(list).catch(() => {});
}

/** Run the mods' step functions (from the app's main loop). A mod that keeps failing is stopped. */
export function runModSteps(app) {
  for (const s of MOD.steps) {
    if (s.dead || app.frame % s.every !== 0) continue;
    try { s.fn(app.world, app); } catch (err) {
      s.fails = (s.fails || 0) + 1;
      console.warn(`Mod "${s.mod.name}" step failed`, err);
      if (s.fails >= 5) { s.dead = true; app.setSaveStatus?.(`Mod "${s.mod.name}" stopped: its step keeps failing (${err.message})`); }
    }
  }
}
