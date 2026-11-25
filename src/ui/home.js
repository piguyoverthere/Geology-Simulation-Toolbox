// The home screen: what you see first when the page opens. A grey screen listing your simulations
// (each kept in the browser until you delete it), with buttons to make a new one, import one from
// a file, and for each: open it, roll it back to an earlier save, export it to a file, rename it or
// delete it. At the bottom: the app's version, and a menu to run an older version of the app.

import { PRESETS } from '../core/generate.js';
import { listSims, newSimMeta, addSim, deleteSim, updateSim, restoreHistory } from '../core/sims.js';
import { fetchLevel, storeLevel, encodeLevel, decodeLevel } from '../core/save.js';
import { APP_VERSION, IS_PRERELEASE, compareVersions, tooNew } from '../version.js';

const SIZES = [128, 192, 256, 384, 512];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(text, onClick, cls = '') {
  const b = el('button', `home-btn ${cls}`, text);
  b.addEventListener('click', onClick);
  return b;
}
const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export class Home {
  constructor(app) {
    this.app = app;
    const root = (this.root = el('div', 'home'));
    root.hidden = true;
    const box = el('div', 'home-box');
    const head = el('div', 'home-head');
    head.append(el('h1', '', 'Geology Simulation Toolbox'), el('div', 'home-sub', 'Your simulations are kept in this browser. Export one to a file to keep it safe or move it to another computer.'));
    const actions = el('div', 'home-actions');
    const guide = btn('📖 Guide', () => { location.href = 'docs.html'; });
    guide.title = 'How to use the toolbox, and how each part of the simulation works';
    actions.append(btn('＋ New simulation', () => this.newDialog(), 'primary'), btn('Import from file…', () => this.importFile()), guide);
    this.list = el('div', 'home-list');
    this.status = el('div', 'home-status');
    const foot = el('div', 'home-foot');
    this.versionSel = el('select', 'home-versions');
    this.versionSel.title = 'Run an older version of the app (your simulations stay; an older version may not understand features added since)';
    this.versionSel.addEventListener('change', () => {
      const v = this.versionSel.value;
      if (!v) return;
      if (confirm(`Open version ${v} of the app? You can come back to this version (${APP_VERSION}) from the address bar or its own menu.`)) location.href = `versions/${v}/index.html`;
      this.versionSel.value = '';
    });
    foot.append(el('span', 'home-version', `Version ${APP_VERSION}`), this.versionSel);
    // (a side panel: experimental prereleases to try)
    this.side = el('aside', 'home-side');
    this.side.hidden = true;
    const mainCol = el('div', 'home-main');
    if (IS_PRERELEASE) mainCol.append(el('div', 'home-pre-banner', `⚗ You're running ${APP_VERSION}, an experimental prerelease: it may be unstable. Simulations saved here can't be opened again in older versions.`));
    mainCol.append(head, actions, this.status, this.list, foot);
    box.append(mainCol, this.side);
    root.append(box);
    document.body.append(root);
    this.loadVersions();
  }

  async show(message) {
    this.root.hidden = false;
    this.app.sim.running = false;
    document.title = 'Geology Simulation Toolbox';
    if (message) this.setStatus(message);
    await this.render();
  }

  hide() { this.root.hidden = true; }

  setStatus(text) { this.status.textContent = text || ''; }

  async loadVersions() {
    const sel = this.versionSel;
    sel.innerHTML = '';
    const first = el('option', '', 'Run an older version…');
    first.value = '';
    sel.append(first);
    try {
      const res = await fetch('versions/versions.json', { cache: 'no-store' });
      const list = res.ok ? await res.json() : [];
      for (const v of list.filter((x) => x.version !== APP_VERSION).reverse()) {
        const o = el('option', '', `${v.version}${v.prerelease ? ' (experimental)' : ''}${v.date ? ` · ${v.date}` : ''}${v.notes ? ` — ${v.notes}` : ''}`);
        o.value = v.version;
        sel.append(o);
      }
      if (sel.options.length === 1) sel.hidden = true;
      this.renderPrereleases(list);
    } catch { sel.hidden = true; }
  }

  /** The side panel: prereleases newer than this version, to try out (they may be unstable). */
  renderPrereleases(list) {
    const pre = list.filter((v) => v.prerelease && compareVersions(v.version, APP_VERSION) > 0).reverse();
    const S = this.side;
    S.textContent = '';
    S.hidden = !pre.length;
    if (!pre.length) return;
    S.append(el('h3', '', '⚗ Try a prerelease'), el('p', 'home-side-note', 'Experimental versions with features still being worked on. They might be unstable, and a simulation you open and save in one can\'t be opened again in this version (going back to an older version isn\'t supported), so try them on a new simulation or an exported copy.'));
    for (const v of pre) {
      const card = el('div', 'home-pre');
      card.append(el('div', 'home-pre-ver', v.version), el('div', 'home-pre-notes', v.notes || ''), el('div', 'home-pre-date', v.date || ''));
      card.append(btn('Try it', () => { if (confirm(`Open experimental version ${v.version}? It might be unstable. Simulations you save in it can't be opened again in older versions.`)) location.href = `versions/${v.version}/index.html`; }));
      S.append(card);
    }
  }

  async render() {
    const L = this.list;
    L.textContent = '';
    let sims = [];
    try { sims = await listSims(); } catch (err) { this.setStatus(`This browser won't let the page store data, so simulations can't be kept: ${err.message}`); }
    if (!sims.length) { L.append(el('div', 'home-empty', 'No simulations yet. Make a new one to begin.')); return; }
    for (const s of sims) L.append(this.card(s));
  }

  card(s) {
    const c = el('div', 'home-card');
    const pic = el('div', 'home-thumb');
    if (s.thumb) pic.style.backgroundImage = `url(${s.thumb})`;
    const info = el('div', 'home-info');
    const name = el('div', 'home-name', s.name);
    const meta = el('div', 'home-meta', `${PRESETS[s.preset]?.label || s.preset || 'Map'} · ${s.N}×${s.N}${s.seed !== undefined ? ` · seed ${s.seed}` : ''} · last played ${when(s.updated)}${s.appVersion ? ` · version ${s.appVersion}` : ''}`);
    info.append(name, meta);
    const row = el('div', 'home-card-actions');
    if (tooNew(s.appVersion)) {
      // (saved by a newer version of the app: this one can't open it)
      const b = btn(`Needs version ${s.appVersion}`, () => this.setStatus(`"${s.name}" was saved by version ${s.appVersion}, newer than this one (${APP_VERSION}). Opening a newer version's simulation in an older version isn't supported.`));
      b.classList.add('locked');
      row.append(b);
    } else row.append(btn('Open', () => this.app.openSim(s.id), 'primary'));
    // Earlier saves to roll back to
    if (s.history && s.history.length) {
      const sel = el('select', 'home-history');
      const o0 = el('option', '', `Restore an earlier save (${s.history.length})…`);
      o0.value = '';
      sel.append(o0);
      for (const h of [...s.history].reverse()) {
        const o = el('option', '', `${when(h.t)}${h.label ? ` — ${h.label}` : ''}`);
        o.value = h.key;
        sel.append(o);
      }
      sel.addEventListener('change', async () => {
        const key = sel.value;
        if (!key) return;
        const h = s.history.find((x) => x.key === key);
        if (confirm(`Roll "${s.name}" back to its save from ${when(h.t)}? The way it is now is kept in its history, so you can come back to it.`)) {
          this.setStatus('Restoring…');
          const ok = await restoreHistory(s.id, key);
          this.setStatus(ok ? `"${s.name}" is back as it was on ${when(h.t)}.` : 'That save could not be found.');
          await this.render();
        } else sel.value = '';
      });
      row.append(sel);
    }
    row.append(
      btn('Export', () => this.exportSim(s)),
      btn('Rename', async () => {
        const n = prompt('Name this simulation:', s.name);
        if (n && n.trim()) { await updateSim(s.id, { name: n.trim().slice(0, 60) }); await this.render(); }
      }),
      btn('Delete', async () => {
        if (!confirm(`Delete "${s.name}" for good? Its saves and history in this browser are removed and can't be brought back (export it first to keep a copy).`)) return;
        await deleteSim(s.id);
        this.setStatus(`Deleted "${s.name}".`);
        await this.render();
      }, 'danger'),
    );
    c.append(pic, info, row);
    return c;
  }

  async exportSim(s) {
    this.setStatus(`Exporting "${s.name}"…`);
    try {
      const snap = s.id === this.app.simMeta?.id ? null : await fetchLevel(s.saveKey);
      const blob = snap ? await encodeLevel(snap) : await this.app.encodeCurrent();
      if (!blob) { this.setStatus(`"${s.name}" has nothing saved yet: open it first.`); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${s.name.replace(/[^\w\- ]+/g, '').trim() || 'simulation'}.geolevel`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      this.setStatus(`Exported "${s.name}" (${(blob.size / 1e6).toFixed(1)} MB).`);
    } catch (err) { this.setStatus(`Couldn't export: ${err.message}`); }
  }

  importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geolevel';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        this.setStatus(`Importing ${file.name}…`);
        const snap = await decodeLevel(file);
        if (tooNew(snap.meta.appVersion)) { this.setStatus(`${file.name} was saved by version ${snap.meta.appVersion}, newer than this one (${APP_VERSION}). Importing a newer version's simulation into an older version isn't supported.`); return; }
        const gen = (snap.meta.params && snap.meta.params.gen) || {};
        const meta = newSimMeta({ name: file.name.replace(/\.geolevel$/i, '').slice(0, 60), N: snap.meta.N, preset: gen.preset, seed: gen.seed });
        meta.fresh = false;
        meta.appVersion = snap.meta.appVersion;
        await storeLevel(meta.saveKey, snap);
        await addSim(meta);
        this.setStatus(`Imported "${meta.name}". Open it from the list.`);
        await this.render();
      } catch (err) { this.setStatus(`Couldn't import ${file.name}: ${err.message}`); }
    };
    input.click();
  }

  /** The New simulation dialog: a name and the basics of the terrain and world. */
  newDialog() {
    const back = el('div', 'home-modal');
    const f = el('form', 'home-form');
    f.append(el('h2', '', 'New simulation'));
    const field = (label, input, note) => {
      const r = el('label', 'home-field');
      r.append(el('span', '', label), input);
      if (note) r.append(el('small', '', note));
      f.append(r);
      return input;
    };
    const name = field('Name', Object.assign(el('input'), { value: `Simulation ${new Date().toLocaleDateString()}`, maxLength: 60, required: true }));
    const preset = el('select');
    for (const [k, p] of Object.entries(PRESETS)) { const o = el('option', '', p.label || k); o.value = k; preset.append(o); }
    preset.value = 'mountains';
    field('Terrain', preset, 'The kind of landscape to start from (some come with their own climate and sea).');
    const seedRow = el('div', 'home-seed');
    const seed = Object.assign(el('input'), { type: 'number', value: Math.floor(Math.random() * 100000), min: 0 });
    seedRow.append(seed, btn('🎲', (e) => { e.preventDefault(); seed.value = Math.floor(Math.random() * 100000); }));
    field('Seed', seedRow, 'The same terrain and seed always make the same map.');
    const size = el('select');
    for (const n of SIZES) { const o = el('option', '', `${n} × ${n}${n === 256 ? ' (standard)' : n > 256 ? ' (slower)' : ''}`); o.value = n; size.append(o); }
    size.value = 256;
    field('Map size', size);
    const sea = el('select');
    for (const [v, t] of [['preset', 'As the terrain comes'], ['on', 'Sea'], ['off', 'No sea']]) { const o = el('option', '', t); o.value = v; sea.append(o); }
    field('Sea', sea);
    const level = Object.assign(el('input'), { type: 'number', value: 12, step: 1 });
    field('Sea level', level, 'Height of the sea, if there is one.');
    const check = (label, on, note) => {
      const r = el('label', 'home-check');
      const cb = Object.assign(el('input'), { type: 'checkbox', checked: on });
      r.append(cb, el('span', '', label));
      if (note) r.append(el('small', '', note));
      f.append(r);
      return cb;
    };
    const seasons = check('Seasons', true, 'Summer and winter, snow, leaf fall.');
    const civ = check('Civilization', true, 'Towns can be founded and grow.');
    const erosion = check('Erosion', true, 'Rain and rivers wear the land down.');
    const btns = el('div', 'home-form-buttons');
    const cancel = btn('Cancel', (e) => { e.preventDefault(); back.remove(); });
    const create = el('button', 'home-btn primary', 'Create');
    create.type = 'submit';
    btns.append(cancel, create);
    f.append(btns);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const meta = newSimMeta({
        name: name.value.trim() || 'New simulation', N: +size.value, preset: preset.value, seed: +seed.value || 1,
        settings: { sea: sea.value, seaLevel: +level.value, seasons: seasons.checked, civ: civ.checked, erosion: erosion.checked },
      });
      await addSim(meta);
      back.remove();
      this.app.openSim(meta.id);
    });
    back.append(f);
    back.addEventListener('mousedown', (e) => { if (e.target === back) back.remove(); });
    this.root.append(back);
    name.focus();
    name.select();
  }
}
