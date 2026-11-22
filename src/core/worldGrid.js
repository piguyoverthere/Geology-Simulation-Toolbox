// The world grid: a world bigger than one map. The world is divided into cells, each a full map of
// its own; you work in one cell at a time and can travel to the cells around it. A level from before
// the grid simply becomes the centre cell (0, 0).
//
// Cells you aren't in are frozen: saved (compressed) to the browser's storage with the time they
// were left. When you come back, the cell catches up on the time it missed: its towns grow, farm,
// fell and spread, and its plants regrow (fast-forwarded, without the full water and erosion).
//
// Cells still interact across their borders:
//   • a new cell's terrain is generated to continue its neighbours' edges, and each time you enter
//     a cell its edges are eased back into line with the neighbours' (so the ground stays continuous
//     however each side has eroded);
//   • rivers flowing off the edge of one cell flow into the next (as springs at its border);
//   • towns know about the towns in the cells around them, and a big town builds a road to one
//     across the border: the road runs to the edge, and is continued on the far side, up to the
//     town there, when you next enter that cell (the two towns then trade over it).
//
// What's shared by the whole grid: the calendar (the year and season), every setting, the preset,
// your animal species. What's per cell: everything on the map (terrain, water, plants, towns,
// drawings, probes).
//
// Storage: the grid's manifest (which cells exist, when each was left, their edges, rivers, towns,
// road ends, and a small picture of each) is kept under `grid-<size>`; each frozen cell under
// `cell-<size>-<grid id>-<x>,<z>`. The cell you're in is the ordinary autosave.

import { snapshot, applySnapshot, encodeLevel, decodeLevel, storeLevel, fetchLevel, deleteLevel } from './save.js';
import { generateTerrain } from './generate.js';
import { seasonParams } from '../sim/climate.js';
import { civStep, routeRoad, buildRoad } from '../sim/civilization.js';
import { vegetationStep } from '../sim/vegetation.js';
import { updateWind } from '../sim/wind.js';
import { World } from './world.js';

const SEAM = 10;      // how far in (cells) a cell's edge is eased toward its neighbour's
const NEW_SEAM = 40;  // how far in a new cell's generated terrain is bent to meet its neighbours
const SIDES = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const OPP = { n: 's', s: 'n', w: 'e', e: 'w' };

const key = (x, z) => `${x},${z}`;
const now = () => (seasonParams.year || 1) + (seasonParams.phase || 0);

/** The manifest of the grid for this map size (made on first use, with the current level as (0, 0)). */
export async function loadGrid(app) {
  const N = app.world.N;
  let g = await fetchLevel(`grid-${N}`);
  if (!g || !g.cells) g = newManifest();
  app.grid = g;
  return g;
}

function newManifest() {
  return { id: Math.random().toString(36).slice(2, 8), cur: { x: 0, z: 0 }, cells: { '0,0': {} }, portals: [] };
}

export async function saveGrid(app) {
  if (app.grid) await storeLevel(`grid-${app.world.N}`, app.grid);
}

/** Forget the grid (a new level was generated): the frozen cells are deleted. */
export async function resetGrid(app) {
  const N = app.world.N, g = app.grid;
  if (g) for (const k of Object.keys(g.cells)) if (k !== key(g.cur.x, g.cur.z)) await deleteLevel(`cell-${N}-${g.id}-${k}`);
  app.grid = newManifest();
  await saveGrid(app);
}

/** After the page (re)loads the cell you were in: what it needs to know about its neighbours. */
export function gridStartup(app) {
  const g = app.grid;
  if (!g) return;
  foreignTowns(app, g.cur.x, g.cur.z);
}

/** Bookkeeping each civilization step (how many steps a year takes, for catching up). */
export function gridTick(app) {
  const g = app.grid;
  if (!g) return;
  const t = now();
  if (!g.rate) g.rate = { from: t, steps: 0 };
  g.rate.steps++;
  if (t - g.rate.from > 0.5) { g.perYear = g.rate.steps / (t - g.rate.from); g.rate = { from: t, steps: 0 }; }
}

// --- Leaving a cell ---------------------------------------------------------------------------

/** Freeze the current cell: save it, and record what its neighbours need to know about it. */
async function freezeCurrent(app) {
  const w = app.world, N = w.N, g = app.grid, ck = key(g.cur.x, g.cur.z);
  // (springs that stood in for rivers flowing in from neighbours aren't part of the cell)
  w.sources = w.sources.filter((s) => !s.border);
  const blob = await encodeLevel(snapshot(app));
  await storeLevel(`cell-${N}-${g.id}-${ck}`, blob);
  const info = g.cells[ck] || (g.cells[ck] = {});
  info.frozenAt = now();
  info.edges = edgeRows(w);
  info.rivers = outflowingRivers(w);
  info.towns = (w.towns || []).map((t) => ({ id: t.id, name: t.name, x: t.x, z: t.z, pop: Math.round(t.pop) }));
  info.thumb = thumbnail(w);
  info.preset = app.gen.preset;
  // Roads this cell's towns have built to its edges, to be continued in the cells beyond
  for (const p of w.portalsOut || []) g.portals.push({ ...p, fromCell: ck });
  w.portalsOut = [];
}

/** The height along each edge of the map. */
function edgeRows(w) {
  const N = w.N, H = w.height, out = {};
  out.n = Array.from({ length: N }, (_, k) => H[k]);
  out.s = Array.from({ length: N }, (_, k) => H[(N - 1) * N + k]);
  out.w = Array.from({ length: N }, (_, k) => H[k * N]);
  out.e = Array.from({ length: N }, (_, k) => H[k * N + N - 1]);
  return out;
}

/** Rivers running off each edge: [{ pos, rate }] (where, along the edge, and how much). */
function outflowingRivers(w) {
  const N = w.N, H = w.height, D = w.water, sea = w.meanSea > -999 ? w.meanSea : -1e9, out = {};
  for (const side of Object.keys(SIDES)) {
    const list = [];
    let run = null;
    for (let k = 1; k < N - 1; k++) {
      const i = edgeCell(N, side, k, 0)[0], j = edgeCell(N, side, k, 4)[0];
      // (water standing at the edge, on land, running downhill toward it, and not just a river
      // that came in from that neighbour in the first place)
      const flowing = H[i] >= sea && D[i] > 0.08 && H[j] + D[j] > H[i] + D[i] && !(w.sources || []).some((s) => s.border && Math.hypot(s.x - (i % N), s.z - ((i / N) | 0)) < 4);
      if (flowing) {
        if (!run) run = { pos: k, depth: 0, n: 0 };
        run.depth = Math.max(run.depth, D[i]); run.n++;
      } else if (run) { list.push({ pos: Math.round(run.pos + run.n / 2), rate: Math.min(40, 6 + run.depth * 30 * Math.sqrt(run.n)) }); run = null; }
    }
    if (run) list.push({ pos: Math.round(run.pos + run.n / 2), rate: Math.min(40, 6 + run.depth * 30 * Math.sqrt(run.n)) });
    out[side] = list;
  }
  return out;
}

/** Cell index `depth` cells in from `side`, at position k along it. */
function edgeCell(N, side, k, depth) {
  switch (side) {
    case 'n': return [depth * N + k];
    case 's': return [(N - 1 - depth) * N + k];
    case 'w': return [k * N + depth];
    default: return [k * N + (N - 1 - depth)];
  }
}

/** A small picture of the cell for the grid map (land, water, forest, towns). */
function thumbnail(w) {
  const N = w.N, S = 32, step = N / S, H = w.height, sea = w.meanSea > -999 ? w.meanSea : -1e9;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
    const i = Math.floor(z * step) * N + Math.floor(x * step), o = (z * S + x) * 4;
    let r, gr, b;
    const lu = w.landUse ? w.landUse[i] : 0;
    if (H[i] < sea) { r = 30; gr = 70; b = 120; }
    else if (w.water[i] > 0.3) { r = 50; gr = 100; b = 150; }
    else if (lu === 2 || lu === 4) { r = 200; gr = 120; b = 90; }
    else if (lu === 1) { r = 200; gr = 180; b = 100; }
    else {
      const v = w.vegetation[i], hh = Math.min(1, (H[i] - sea) / 60);
      r = 120 - v * 70 + hh * 80; gr = 130 + v * 30 + hh * 40; b = 80 - v * 30 + hh * 90;
    }
    img.data[o] = r; img.data[o + 1] = gr; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

// --- Entering a cell --------------------------------------------------------------------------

/** Travel to cell (x, z): freeze this one, then load (or create) that one. */
export async function travelTo(app, x, z, status = () => {}) {
  if (app.travelling) return;
  app.travelling = true;
  try {
    const g = app.grid || await loadGrid(app);
    if (g.cur.x === x && g.cur.z === z) return;
    status('Saving this cell…');
    await freezeCurrent(app);
    const N = app.world.N, ck = key(x, z), info = g.cells[ck];
    // Everything shared by the whole grid is kept as it is: the calendar, the settings, the camera,
    // your animal species
    const animals = app.world.animals;
    if (info && info.frozenAt !== undefined) {
      status('Loading the cell…');
      const blob = await fetchLevel(`cell-${N}-${g.id}-${ck}`);
      const snap = await decodeLevel(blob);
      snap.meta.params = {}; snap.meta.camera = null;
      if (snap.meta.json) delete snap.meta.json.animals;
      app.loadingLevel = true;
      freshen(app);
      applySnapshot(app, snap);
      app.loadingLevel = false;
    } else {
      status('Making a new cell…');
      makeCell(app, x, z);
      g.cells[ck] = {};
    }
    app.world.animals = animals;
    g.cur = { x, z };
    const w = app.world;
    // Line the edges up with the neighbours, bring rivers in across the borders, and learn about
    // the towns next door and the roads that reach this cell from them
    seamSync(app, x, z, SEAM);
    borderRivers(app, x, z);
    foreignTowns(app, x, z);
    continuePortals(app, x, z);
    // Catch up on the time it missed
    if (info && info.frozenAt !== undefined) {
      const years = Math.max(0, now() - info.frozenAt);
      if (years > 0.05) { status(`Catching up ${years.toFixed(1)} years…`); await catchUp(app, years); }
    }
    w.dirty = true;
    app.afterLoad();
    await saveGrid(app);
    app.autosave();
    status(`In cell ${x}, ${z}`);
  } finally {
    app.travelling = false;
    app.toolbox?.renderGrid?.();
  }
}

/** Generate a new cell: the preset's kind of land, its own layout, bent at the edges to continue
 * the cells already there. */
function makeCell(app, x, z) {
  const w = app.world, N = w.N;
  // (a preset built around one centrepiece, like the volcano, carries on as mountains around it)
  const preset = app.gen.preset === 'volcano' ? 'mountains' : app.gen.preset;
  const seed = (app.gen.seed * 7919 + x * 104729 + z * 1299709) >>> 0;
  app.loadingLevel = true;
  freshen(app);
  app.drawings.clear(); app.drawings.onChange();
  generateTerrain(w, preset, seed % 1000000);
  app.loadingLevel = false;
  seamSync(app, x, z, NEW_SEAM);
  w.setBaseline();
  w.clearWater();
  w.towns = []; w.portalsOut = [];
  app.applySea();
  updateWind(w, true);
  if (app.effects && app.effects.deck) app.effects.deck.ready = false; // (the cloud deck, for the new ground)
}

/**
 * Wipe the world back to a blank map before another cell is put into it, so nothing of the cell
 * we left lingers: every field the World starts with is reset, every field the simulation added
 * since (civilization, ocean, ecology…) is dropped (each is made afresh when next needed), and the
 * lists of what's going on are emptied. The world's switches (erosion, rocks, edges) are kept.
 */
function freshen(app) {
  const w = app.world, fresh = new World(w.N);
  for (const k of Object.keys(w)) {
    if (ArrayBuffer.isView(w[k])) { if (ArrayBuffer.isView(fresh[k])) w[k] = fresh[k]; else delete w[k]; }
    else if (k.startsWith('_')) delete w[k];
  }
  w.resetEvents();
  for (const k of ['sources', 'faults', 'landslides', 'storms', 'holdovers', 'cones', 'towns', 'probes', 'pollSources', 'currentPaths', 'portalsOut']) w[k] = [];
  for (const k of ['moisture', 'soil', 'nearWater', 'standSlope', 'moistureBias', 'gapCold']) w[k] = null;
  w.popHistory = {}; w.statHistory = {};
  w.coastInit = false;
}

/**
 * Ease this cell's edges into line with its neighbours': along each side with a neighbour, the
 * ground within `depth` cells of the edge is shifted so that the edge meets the neighbour's edge,
 * the shift fading out inland.
 */
function seamSync(app, x, z, depth) {
  const g = app.grid, w = app.world, N = w.N, H = w.height;
  for (const [side, [dx, dz]] of Object.entries(SIDES)) {
    const nb = g.cells[key(x + dx, z + dz)];
    const row = nb && nb.edges && nb.edges[OPP[side]];
    if (!row) continue;
    for (let k = 0; k < N; k++) {
      const edge = edgeCell(N, side, k, 0)[0];
      // (this edge is brought to the neighbour's: the two lie side by side)
      const off = row[k] - H[edge];
      if (!Number.isFinite(off)) continue;
      for (let d = 0; d < depth; d++) {
        const i = edgeCell(N, side, k, d)[0], f = (1 - d / depth) ** 2;
        H[i] += off * f;
        if (w.prevHeight) w.prevHeight[i] = H[i];
      }
    }
  }
  w.dirty = true;
}

/** Rivers flowing off the neighbours' edges toward this cell come in as springs at its border. */
function borderRivers(app, x, z) {
  const g = app.grid, w = app.world, N = w.N;
  w.sources = (w.sources || []).filter((s) => !s.border);
  for (const [side, [dx, dz]] of Object.entries(SIDES)) {
    const nb = g.cells[key(x + dx, z + dz)];
    const list = nb && nb.rivers && nb.rivers[OPP[side]];
    if (!list) continue;
    for (const r of list) {
      const i = edgeCell(N, side, r.pos, 1)[0];
      w.sources.push({ x: i % N, z: (i / N) | 0, rate: r.rate, border: true });
    }
  }
}

/** The towns in the cells around this one, in this cell's coordinates (outside 0…N). */
function foreignTowns(app, x, z) {
  const g = app.grid, w = app.world, N = w.N, list = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dz) continue;
    const ck = key(x + dx, z + dz), nb = g.cells[ck];
    for (const t of (nb && nb.towns) || []) list.push({ ...t, cell: ck, gx: t.x + dx * N, gz: t.z + dz * N, side: dx && dz ? null : Object.keys(SIDES).find((s) => SIDES[s][0] === dx && SIDES[s][1] === dz) });
  }
  w.foreignTowns = list;
  if (!w.portalsOut) w.portalsOut = [];
}

/** Roads built to this cell's border from next door: continued from the border to their town. */
function continuePortals(app, x, z) {
  const g = app.grid, w = app.world, N = w.N, ck = key(x, z);
  const mine = g.portals.filter((p) => p.toCell === ck);
  g.portals = g.portals.filter((p) => p.toCell !== ck);
  for (const p of mine) {
    const i = edgeCell(N, OPP[p.side], p.pos, 1)[0];
    const from = { x: i % N, z: (i / N) | 0 };
    let t = (w.towns || []).find((u) => u.id === p.toId);
    if (!t && w.towns && w.towns.length) t = w.towns.reduce((a, b) => (Math.hypot(a.x - from.x, a.z - from.z) < Math.hypot(b.x - from.x, b.z - from.z) ? a : b));
    if (!t) continue;
    const path = routeRoad(w, from, t);
    if (path && path.length > 1) buildRoad(w, path);
    if (!t.links.includes(p.fromId)) t.links.push(p.fromId);
  }
}

/** Fast-forward a cell through the years it was frozen: its towns and its plants. */
async function catchUp(app, years) {
  const w = app.world, g = app.grid;
  const steps = Math.min(80, Math.round(years * (g.perYear || 30)));
  const t0 = performance.now();
  for (let k = 0; k < steps; k++) {
    civStep(w);
    if (k % 4 === 0) vegetationStep(w);
    if (performance.now() - t0 > 6000) break;
    if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0)); // (let the page breathe)
  }
}
