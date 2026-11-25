// Biomes & trees window: a small window at the top right of the map with two line graphs over
// time, one line per biome (share of the land, the same categories as the Biomes overlay) and one
// line per tree species (share of the trees). The shares are recorded every couple of seconds
// whether or not the window is open (world.biomeHistory, world.treeHistory, saved with the level),
// so the graph has the whole story when it's opened. Long histories are thinned (every other
// point dropped) rather than cut, so the graph always runs from the start. Hover a name below the
// graph to pick out its line.

import { BIOMES, classifyBiome } from '../render/biomes.js';
import { SPECIES, treeShares, steadyCover } from '../sim/species.js';
import { seasonParams, snowAt } from '../sim/climate.js';

const rgb = (c, a = 1) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
const MAX_POINTS = 400;

/**
 * Share of the land in each biome (0…1), the sea's share of the map, and the share of the land under
 * snow and under glacier ice. With noSnow (the default) snow is looked through to the biome beneath,
 * so the biome lines don't swing with the winters; snow has a graph of its own.
 */
export function biomeShares(world, noSnow = true) {
  const N = world.N, H = world.height;
  const sea = world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9;
  const count = {};
  let land = 0, seaN = 0, snowN = 0, iceN = 0;
  const ice = world.ice;
  for (let z = 0; z < N; z += 2) for (let x = 0; x < N; x += 2) { // (every fourth cell is plenty)
    const i = z * N + x;
    if (H[i] < sea) { seaN++; continue; }
    const gx = (H[x < N - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * 0.5;
    const gz = (H[z < N - 1 ? i + N : i] - H[z > 0 ? i - N : i]) * 0.5;
    const slope = Math.sqrt(gx * gx + gz * gz);
    const b = classifyBiome(world, i, slope, noSnow);
    count[b] = (count[b] || 0) + 1;
    if (snowAt(world, i, slope) > 0.5) snowN++;
    if (ice && ice[i] > 0.05) iceN++;
    land++;
  }
  const shares = Object.entries(count).map(([id, c]) => ({ id, share: c / Math.max(1, land) })).sort((a, b) => b.share - a.share);
  return { shares, sea: seaN / Math.max(1, land + seaN), snow: snowN / Math.max(1, land), ice: iceN / Math.max(1, land) };
}

/** Each tree species' share of all the trees on the map (weighted by how much tree cover). */
export function speciesShares(world) {
  const N = world.N, LU = world.landUse, K = SPECIES.length;
  const sum = new Float64Array(K), sh = new Float32Array(K);
  let tot = 0;
  for (let z = 1; z < N; z += 3) for (let x = 1; x < N; x += 3) { // (every ninth cell)
    const i = z * N + x;
    const v = steadyCover(world, i); // (steady through the seasons, regrowth counted at once)
    if (v < 0.4 || (LU && LU[i] && LU[i] !== 10)) continue;
    const w = Math.min(1, (v - 0.35) * 2);
    treeShares(world, i, sh);
    for (let k = 0; k < K; k++) sum[k] += sh[k] * w;
    tot += w;
  }
  return SPECIES.map((s, k) => ({ id: s.id, share: tot > 0 ? sum[k] / tot : 0 })).sort((a, b) => b.share - a.share);
}

/** Add one point to a history { t: [], s: { id: [] } }, thinning it when it grows long. */
function record(h, time, shares) {
  const n = h.t.length;
  h.t.push(time);
  for (const id of Object.keys(h.s)) h.s[id].push(0);
  for (const { id, share } of shares) {
    if (!h.s[id]) h.s[id] = new Array(n + 1).fill(0);
    h.s[id][n] = +share.toFixed(4);
  }
  if (h.t.length > MAX_POINTS) {
    const keep = (a) => a.filter((_, k) => k % 2 === 0 || k === a.length - 1);
    h.t = keep(h.t);
    for (const id of Object.keys(h.s)) h.s[id] = keep(h.s[id]);
  }
}

const SNOW = {
  snow: { label: 'Snow cover', color: [0.92, 0.95, 1.0], help: 'Land under lying snow (comes and goes with the seasons).' },
  ice: { label: 'Glacier ice', color: [0.45, 0.70, 0.95], help: 'Land under glacier ice.' },
};
const TABS = {
  biomes: { label: 'Biomes', key: 'biomeHistory', info: (id) => BIOMES[id], color: (id) => BIOMES[id]?.color, what: 'of the land' },
  snow: { label: 'Snow & ice', key: 'snowHistory', info: (id) => SNOW[id], color: (id) => SNOW[id]?.color, what: 'of the land' },
  trees: { label: 'Trees', key: 'treeHistory', info: (id) => SPECIES.find((s) => s.id === id), color: (id) => SPECIES.find((s) => s.id === id)?.mapColor, what: 'of the trees' },
};

export class BiomeChart {
  constructor(app, parent) {
    this.app = app;
    const win = (this.win = document.createElement('div'));
    win.className = 'biome-win';
    const head = document.createElement('button');
    head.className = 'graph-head';
    this.body = document.createElement('div');
    this.body.className = 'biome-body';
    let open = false;
    try { open = localStorage.getItem('geo.biomes') === '1'; this.tab = localStorage.getItem('geo.biomeTab') || 'biomes'; } catch { /* storage blocked */ }
    if (!TABS[this.tab]) this.tab = 'biomes';
    this.setOpen = (o) => {
      this.open = o; this.body.hidden = !o; win.classList.toggle('open', o);
      head.textContent = o ? '🌍 Biomes & trees ▾' : '🌍 Biomes & trees ▸';
      try { localStorage.setItem('geo.biomes', o ? '1' : '0'); } catch { /* storage blocked */ }
      if (o) this.draw();
    };
    head.title = 'How the share of the land in each biome, and of the trees in each species, changes over time.';
    head.addEventListener('click', () => this.setOpen(!this.open));
    // Tabs, graph and legend
    this.tabs = document.createElement('div');
    this.tabs.className = 'biome-tabs';
    for (const [k, t] of Object.entries(TABS)) {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.dataset.tab = k;
      b.addEventListener('click', () => { this.tab = k; try { localStorage.setItem('geo.biomeTab', k); } catch { /* storage blocked */ } this.draw(); });
      this.tabs.append(b);
    }
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'biome-graph';
    this.legend = document.createElement('div');
    this.legend.className = 'biome-legend';
    this.note = document.createElement('div');
    this.note.className = 'biome-note';
    this.body.append(this.tabs, this.canvas, this.legend, this.note);
    win.append(head, this.body);
    parent.append(win);
    this.hot = null;
    this.setOpen(open);
  }

  /** Record the shares now (always), and redraw if open. */
  update() {
    const w = this.app.world;
    const time = +((seasonParams.year || 1) + (seasonParams.phase || 0)).toFixed(3);
    w.biomeHistory ||= { t: [], s: {} };
    w.treeHistory ||= { t: [], s: {} };
    w.snowHistory ||= { t: [], s: {} };
    // (a time earlier than the last point means a different level was loaded or the year reset)
    for (const h of [w.biomeHistory, w.treeHistory, w.snowHistory]) if (h.t.length && time < h.t[h.t.length - 1] - 0.01) { h.t = []; h.s = {}; }
    if (w.biomeHistory.s.snow) delete w.biomeHistory.s.snow; // (snow has its own graph now)
    const b = biomeShares(w);
    this.sea = b.sea;
    record(w.biomeHistory, time, b.shares.filter((s) => BIOMES[s.id]));
    record(w.treeHistory, time, speciesShares(w));
    record(w.snowHistory, time, [{ id: 'snow', share: b.snow }, { id: 'ice', share: b.ice }]);
    if (this.open) this.draw();
  }

  /** Redraw the graph and its list of names. */
  draw() {
    for (const b of this.tabs.children) b.classList.toggle('on', b.dataset.tab === this.tab);
    const ids = this.paint();
    const tab = TABS[this.tab], h = this.app.world[tab.key];
    this.legend.textContent = '';
    if (!ids) { this.note.textContent = ''; return; }
    // Legend: every line, largest now first, with its share now (hover one to pick out its line)
    const n = h.t.length;
    const now = ids.map((id) => ({ id, v: h.s[id][n - 1] || 0 })).sort((a, b) => b.v - a.v);
    for (const { id, v } of now) {
      const info = tab.info(id);
      const row = document.createElement('div');
      row.className = 'biome-row';
      row.title = info?.help || '';
      row.innerHTML = `<span class="biome-sw" style="background:${rgb(tab.color(id))}"></span><span class="biome-name"></span><span class="biome-pct">${v * 100 < 0.1 ? '<0.1' : (v * 100).toFixed(1)}%</span>`;
      row.querySelector('.biome-name').textContent = info?.label || id;
      row.addEventListener('mouseenter', () => { this.hot = id; row.classList.add('hot'); this.paint(); });
      row.addEventListener('mouseleave', () => { if (this.hot === id) this.hot = null; row.classList.remove('hot'); this.paint(); });
      this.legend.append(row);
    }
    this.note.textContent = this.tab === 'biomes'
      ? `Share of the land (looking through snow to the biome beneath)${this.sea > 0 ? ` · the sea covers ${Math.round(this.sea * 100)}% of the map` : ''}`
      : this.tab === 'snow' ? 'Share of the land under snow and under glacier ice'
      : 'Share of all the trees on the map (by tree cover)';
  }

  /** Draw the graph; returns the ids drawn (null if there's nothing yet). */
  paint() {
    const tab = TABS[this.tab], w = this.app.world, h = w[tab.key];
    const cv = this.canvas, dpr = window.devicePixelRatio || 1, W = 258, Hh = 140;
    cv.width = W * dpr; cv.height = Hh * dpr; cv.style.width = `${W}px`; cv.style.height = `${Hh}px`;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, Hh);
    const L = 30, R = 6, T = 6, B = 16, pw = W - L - R, ph = Hh - T - B;
    if (!h || h.t.length < 2) {
      g.fillStyle = '#8a93a0'; g.font = '11px sans-serif';
      g.fillText('Collecting… (a point every couple of seconds)', L, T + ph / 2);
      return null;
    }
    const n = h.t.length, t0 = h.t[0], t1 = h.t[n - 1];
    // (lines worth drawing: any that reached half a percent)
    const ids = Object.keys(h.s).filter((id) => tab.color(id) && (this.tab === 'snow' || Math.max(...h.s[id]) >= 0.005));
    let top = 0;
    for (const id of ids) for (const v of h.s[id]) top = Math.max(top, v);
    top = Math.min(1, Math.ceil((top * 1.1) * 10) / 10 || 0.1);
    const X = (t) => L + ((t - t0) / Math.max(1e-6, t1 - t0)) * pw, Y = (v) => T + ph - (v / top) * ph;
    // Axes and grid
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.fillStyle = '#8a93a0'; g.font = '9.5px sans-serif'; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const v = (top * k) / 4, y = Y(v);
      g.beginPath(); g.moveTo(L, y + 0.5); g.lineTo(L + pw, y + 0.5); g.stroke();
      g.fillText(`${Math.round(v * 100)}%`, 2, y + 3);
    }
    g.fillText(`yr ${Math.floor(t0)}`, L, Hh - 3);
    const endLabel = `yr ${Math.floor(t1)}`;
    g.fillText(endLabel, L + pw - g.measureText(endLabel).width, Hh - 3);
    // Lines (the one hovered drawn last and bold, the rest faded while one is picked out)
    const order = ids.filter((id) => id !== this.hot).concat(ids.includes(this.hot) ? [this.hot] : []);
    for (const id of order) {
      const c = tab.color(id), hot = id === this.hot;
      g.strokeStyle = rgb(c, this.hot && !hot ? 0.18 : 0.95);
      g.lineWidth = hot ? 2.4 : 1.4;
      g.beginPath();
      const s = h.s[id];
      for (let k = 0; k < n; k++) { const x = X(h.t[k]), y = Y(s[k] || 0); if (k) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    return ids;
  }
}
