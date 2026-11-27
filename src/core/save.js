// Saving and loading levels.
//
// A level is everything needed to pick up where you left off: every per-cell field of the world
// (terrain, water, sediment, vegetation, soil, snow, rocks, lava, fire scars…), the world's
// settings, the sources, drawings, camera, and every settings panel value. It is written:
//   • to a file (Save level / Load level): gzip-compressed binary, `.geolevel`
//   • to the browser's own storage (IndexedDB) every so often and when the page is hidden, and
//     restored on the next load, so reloading the page (e.g. after an update) keeps your level.
//
// Loading is forgiving: fields the saved level doesn't have keep their freshly generated values,
// and fields this version doesn't know are ignored, so levels survive updates to the simulation.

import { APP_VERSION } from '../version.js';

const MAGIC = 'GEOLEVEL1';
// Transient or derived state that isn't worth saving (rebuilt on the fly)
const SKIP_ARRAYS = new Set(['flux', 'strataWarp0', 'pathU', 'pathV', 'popDensity', 'fishK', 'burnSize']);
// Plain-data lists and objects on the world that are saved as JSON
const WORLD_JSON = ['sources', 'pollSources', 'currentPaths', 'animals', 'popHistory', 'statHistory', 'probes', 'towns', 'cones', 'geoRange', 'storms', 'holdovers', 'faults', 'landslides', 'portalsOut', 'settlersOut', 'footpaths', 'fireLog', 'fireCount', 'parkSites', 'biomeHistory', 'treeHistory', 'snowHistory'];
// Settings objects on the app (all plain values)
const PARAMS = ['waterParams', 'thermalParams', 'vegetationParams', 'climateParams', 'seasonParams', 'weatherParams',
  'volcanoSettings', 'faultSettings', 'fireParams', 'landslideParams', 'coastParams', 'qualityParams', 'oceanParams', 'windParams', 'ecoParams', 'civParams', 'groundwaterParams', 'dynParams', 'riverParams', 'glacierParams', 'sim', 'gen', 'brush', 'drawSettings'];

// Settings as this version of the code starts them. Levels store only the settings you changed from
// these, so improvements to the simulation's tuning in later versions still reach saved levels.
let DEFAULTS = null;
export function captureDefaults(app) {
  DEFAULTS = {};
  for (const k of PARAMS) if (app[k]) DEFAULTS[k] = plain(app[k]);
}

/** Put every settings panel back to this version's defaults (for a new simulation). */
export function resetParams(app) {
  if (!DEFAULTS) return;
  for (const k of PARAMS) if (app[k] && DEFAULTS[k]) mergePlain(app[k], DEFAULTS[k]);
}

/** Capture the app's current level. Returns { meta, arrays } (arrays are copies). */
export function snapshot(app) {
  const w = app.world;
  const arrays = {};
  const scalars = {};
  for (const [k, v] of Object.entries(w)) {
    if (ArrayBuffer.isView(v)) { if (!SKIP_ARRAYS.has(k)) arrays[k] = v.slice(); }
    else if (['number', 'boolean', 'string'].includes(typeof v)) scalars[k] = v;
  }
  const json = {};
  for (const k of WORLD_JSON) if (w[k] !== undefined && w[k] !== null) json[k] = w[k];
  const params = {};
  for (const k of PARAMS) {
    if (!app[k]) continue;
    const now = plain(app[k]), def = DEFAULTS && DEFAULTS[k];
    const diff = {};
    for (const [key, v] of Object.entries(now)) if (!def || def[key] !== v) diff[key] = v;
    // The level's identity always travels with it
    if (k === 'gen') Object.assign(diff, { preset: now.preset, seed: now.seed });
    if (k === 'seasonParams') Object.assign(diff, { enabled: now.enabled, phase: now.phase });
    params[k] = diff;
  }
  const r = app.renderer;
  const meta = {
    magic: MAGIC, savedAt: new Date().toISOString(), appVersion: APP_VERSION, N: w.N, paramDiffs: true,
    sim: app.simMeta ? { id: app.simMeta.id, name: app.simMeta.name, created: app.simMeta.created, settings: app.simMeta.settings } : undefined,
    scalars, json, params,
    view: { colorMode: r.colorMode, showVegetation: r.showVegetation, showClouds: r.showClouds, showWater: r.showWater, showTownLabels: r.showTownLabels, showParkNames: r.showParkNames, showTrailNames: r.showTrailNames, singleBiome: r.singleBiome },
    camera: { position: app.camera.position.toArray(), target: app.controls.target.toArray() },
    drawings: app.drawings.shapes.map((s) => ({ name: s.name, points: s.points, closed: s.closed, color: s.color, protected: !!s.protected, limited: !!s.limited, restrict: s.restrict ? { ...s.restrict } : undefined, park: s.park || undefined })),
    drawNextId: app.drawings.nextId,
  };
  return { meta, arrays };
}

/** Put a snapshot back into the running app (same map size). */
export function applySnapshot(app, snap) {
  const { meta, arrays } = snap;
  const w = app.world;
  if (meta.N !== w.N) throw new Error(`level is ${meta.N}×${meta.N}, map is ${w.N}×${w.N}`);
  for (const [k, src] of Object.entries(arrays)) {
    const dst = w[k];
    if (ArrayBuffer.isView(dst) && dst.length === src.length && dst.constructor === src.constructor) dst.set(src);
    else if (!ArrayBuffer.isView(dst) || dst.length !== src.length) w[k] = src.slice(); // new or reshaped field
  }
  for (const [k, v] of Object.entries(meta.scalars || {})) if (k !== 'N' && k !== 'dirty') w[k] = v;
  for (const [k, v] of Object.entries(meta.json || {})) w[k] = v;
  // Settings: newer levels hold only what was changed from the defaults. Older levels saved every
  // value, including internal tuning that has since been improved, so from those only the level's
  // identity is taken (preset, seed, where in the year it was)
  for (const [k, v] of Object.entries(meta.params || {})) {
    if (!app[k]) continue;
    if (meta.paramDiffs) mergePlain(app[k], v);
    else if (k === 'gen') mergePlain(app[k], { preset: v.preset, seed: v.seed });
    else if (k === 'seasonParams') mergePlain(app[k], { enabled: v.enabled, phase: v.phase });
    else if (k === 'sim') mergePlain(app[k], { seaEnabled: v.seaEnabled, seaLevel: v.seaLevel });
  }
  // The crater of the volcano preset stays a closed basin
  const N = w.N;
  w.keepBasin = app.gen.preset === 'volcano' ? (i) => Math.hypot(i % N - N / 2, ((i / N) | 0) - N / 2) < N * 0.06 : null;
  w.events = []; w.flows = []; w.debris = []; w.fireCells = []; w.slideAreas = [];
  const r = app.renderer, v = meta.view || {};
  for (const k of ['colorMode', 'showVegetation', 'showClouds', 'showWater', 'showTownLabels', 'showParkNames', 'showTrailNames', 'singleBiome']) if (v[k] !== undefined) r[k] = v[k];
  if (meta.camera) {
    app.camera.position.fromArray(meta.camera.position);
    app.controls.target.fromArray(meta.camera.target);
    app.controls.update();
  }
  app.drawings.clear();
  for (const d of meta.drawings || []) {
    const s = { id: app.drawings.nextId++, name: d.name, points: d.points, closed: d.closed, color: d.color, protected: !!d.protected, limited: !!d.limited, restrict: d.restrict ? { ...d.restrict } : {}, park: d.park, obj: null, label: null };
    app.drawings.shapes.push(s);
    app.drawings.build(s);
  }
  if (meta.drawNextId) app.drawings.nextId = Math.max(app.drawings.nextId, meta.drawNextId);
  app.drawings.onChange(); // (rebuilds the protected zones from the drawings, and the list)
  app.afterLoad();
}

// --- File format: "GEOLEVEL1" + header length + JSON header + raw array bytes, gzip-compressed ---

const TYPES = { Float32Array, Int8Array, Uint8Array, Int16Array, Int32Array, Uint16Array, Uint32Array, Float64Array };

export async function encodeLevel(snap) {
  const entries = [];
  let offset = 0;
  for (const [k, a] of Object.entries(snap.arrays)) {
    entries.push({ k, type: a.constructor.name, length: a.length, offset });
    offset += a.byteLength;
    offset = (offset + 7) & ~7; // keep every array 8-byte aligned
  }
  const header = new TextEncoder().encode(JSON.stringify({ meta: snap.meta, entries }));
  const head = new Uint8Array(16);
  head.set(new TextEncoder().encode(MAGIC));
  new DataView(head.buffer).setUint32(12, header.length, true);
  const pad = (8 - ((16 + header.length) % 8)) % 8;
  const body = new Uint8Array(offset);
  for (const e of entries) body.set(new Uint8Array(snap.arrays[e.k].buffer, snap.arrays[e.k].byteOffset, snap.arrays[e.k].byteLength), e.offset);
  const raw = new Blob([head, header, new Uint8Array(pad), body]);
  if (typeof CompressionStream === 'undefined') return raw;
  return new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

export async function decodeLevel(blob) {
  let buf = new Uint8Array(await blob.arrayBuffer());
  // gzip starts with 1f 8b
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  if (new TextDecoder().decode(buf.subarray(0, MAGIC.length)) !== MAGIC) throw new Error('not a Geology Toolbox level file');
  const hlen = new DataView(buf.buffer, buf.byteOffset).getUint32(12, true);
  const { meta, entries } = JSON.parse(new TextDecoder().decode(buf.subarray(16, 16 + hlen)));
  const start = 16 + hlen + ((8 - ((16 + hlen) % 8)) % 8);
  const arrays = {};
  for (const e of entries) {
    const T = TYPES[e.type];
    if (!T) continue;
    const bytes = buf.slice(start + e.offset, start + e.offset + e.length * T.BYTES_PER_ELEMENT);
    arrays[e.k] = new T(bytes.buffer);
  }
  return { meta, arrays };
}

// --- Browser autosave (IndexedDB) ---------------------------------------------------------------

const DB = 'geology-toolbox', STORE = 'levels';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeLevel(key, snap) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snap, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function fetchLevel(key) {
  const db = await openDB();
  const snap = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return snap;
}

/** Every key stored (to find saves the simulations list has lost track of). */
export async function listLevelKeys() {
  const db = await openDB();
  const keys = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return keys.map(String);
}

export async function deleteLevel(key) {
  const db = await openDB();
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
  db.close();
}

function plain(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (['number', 'boolean', 'string'].includes(typeof v)) out[k] = v;
  return out;
}

function mergePlain(target, src) {
  for (const [k, v] of Object.entries(src)) if (k in target && typeof target[k] === typeof v) target[k] = v;
}
