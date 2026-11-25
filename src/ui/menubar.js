// The menu bar along the top of the window, like a desktop app's: the app's name and its menus on
// the left (File, Edit, View, Simulation, Tools, Window, Help), and on the right the technical
// readouts (frame rate, water, sediment, erosion…), the open simulation, when it was last saved and
// the play/pause button. Click a menu to open it; while one is open, moving over the others opens
// them; click outside or press Escape to close.

import { OVERLAYS } from '../render/terrainRenderer.js';
import { TOOLS, toolKey } from '../tools/brushes.js';
import { MAP_SIZES } from '../main.js';
import { APP_VERSION } from '../version.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = mac ? '⌘' : 'Ctrl+';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class MenuBar {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    root.className = 'menubar';
    const left = el('div', 'mb-left');
    left.append(el('span', 'mb-app', 'Geology Toolbox'));
    this.titles = [];
    for (const [name, items] of Object.entries(this.menus())) {
      const t = el('button', 'mb-title', name);
      t.addEventListener('mousedown', (e) => { e.preventDefault(); this.openMenu === name ? this.close() : this.open(name, t, items); });
      t.addEventListener('mouseenter', () => { if (this.openMenu && this.openMenu !== name) this.open(name, t, items); });
      left.append(t);
      this.titles.push(t);
    }
    const right = el('div', 'mb-right');
    this.stats = el('div', 'mb-stats');
    this.simName = el('span', 'mb-sim', '');
    this.save = el('span', 'mb-save', '');
    this.play = el('button', 'mb-play', '');
    this.play.addEventListener('click', () => app.toggleSim());
    right.append(this.stats, this.simName, this.save, this.play);
    root.append(left, right);
    document.addEventListener('mousedown', (e) => { if (this.openMenu && !root.contains(e.target) && !e.target.closest('.mb-drop')) this.close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.openMenu) this.close(); });
    this.refresh();
  }

  /** The menus: each item { label, key, action, checked, disabled } or '-' or { label, sub: () => items }. */
  menus() {
    const app = this.app, r = () => app.renderer, toggle = (label, obj, k, after) => ({ label, checked: () => !!obj()[k], action: () => { obj()[k] = !obj()[k]; after?.(); app.toolbox.refresh(); } });
    const redraw = () => { app.world.dirty = true; app.renderer.update(true); };
    return {
      File: [
        { label: 'New simulation…', action: () => { app.goHome().then(() => app.home.newDialog()); } },
        { label: 'All simulations (home)', action: () => app.goHome() },
        '-',
        { label: 'Save level to a file', key: '', action: () => app.saveLevelFile() },
        { label: 'Load level from a file…', action: () => app.loadLevelFile() },
        '-',
        { label: 'New map size', sub: () => MAP_SIZES.map((n) => ({ label: `${n} × ${n}`, checked: () => app.world.N === n, action: () => { if (app.world.N !== n) app.setMapSize(n); } })) },
        toggle('Keep saving automatically', () => app.keepLevel, 'on', () => { try { localStorage.setItem('geo.keepLevel', app.keepLevel.on ? '1' : '0'); } catch { /* storage blocked */ } if (app.keepLevel.on) app.autosave(); }),
      ],
      Edit: [
        { label: 'Undo', key: `${MOD}Z`, action: () => app.undo() },
        { label: 'Redo', key: `⇧${MOD}Z`, action: () => app.redo() },
        '-',
        { label: 'Clear drawings', action: () => { if (confirm('Remove all your drawings (paths and polygons, parks included)?')) app.drawings.clear(); } },
      ],
      View: [
        { label: 'Overlay', sub: () => Object.entries(OVERLAYS).map(([k, label]) => ({ label, checked: () => app.renderer.colorMode === k, action: () => { app.renderer.colorMode = k; redraw(); app.toolbox.refresh(); app.toolbox.updateLegend(); } })) },
        '-',
        toggle('Show vegetation', r, 'showVegetation', redraw),
        toggle('Show clouds', r, 'showClouds'),
        toggle('Show water', r, 'showWater', redraw),
        toggle('Show sea', r, 'showSea', redraw),
        '-',
        toggle('Show town labels', r, 'showTownLabels'),
        toggle('Show park names', r, 'showParkNames'),
        toggle('Show trail names', r, 'showTrailNames'),
        '-',
        { label: 'Wireframe', checked: () => app.renderer.terrainMat.wireframe, action: () => { app.renderer.terrainMat.wireframe = !app.renderer.terrainMat.wireframe; } },
      ],
      Simulation: [
        { label: () => (app.sim.running ? 'Pause' : 'Play'), key: 'Space', action: () => app.toggleSim() },
        { label: 'Speed', sub: () => [1, 2, 4, 6, 10, 15, 20].map((n) => ({ label: `${n} step${n > 1 ? 's' : ''} a frame${n === 6 ? ' (standard)' : ''}`, checked: () => app.sim.substeps === n, action: () => { app.sim.substeps = n; app.toolbox.refresh(); } })) },
        '-',
        toggle('Erosion', () => app.world, 'erosionEnabled'),
        toggle('Seasons', () => app.seasonParams, 'enabled'),
        toggle('Civilization', () => app.civParams, 'enabled'),
        toggle('Sea', () => app.sim, 'seaEnabled', () => app.applySea()),
        '-',
        { label: 'Generate new terrain', action: () => { if (confirm('Replace this map with newly generated terrain (same preset and seed settings as the Terrain panel)?')) app.generate(); } },
      ],
      Tools: () => {
        const groups = [...new Set(Object.values(TOOLS).map((t) => t.group))];
        return groups.map((g) => ({ label: g, sub: () => Object.entries(TOOLS).filter(([, t]) => t.group === g).map(([id, t]) => ({ label: `${t.icon}  ${t.label}`, key: toolKey(id), checked: () => app.tool === id, action: () => app.setTool(id) })) }));
      },
      Window: [
        { label: 'Graphs', checked: () => !!app.toolbox.graphsOpen?.(), action: () => app.toolbox.setGraphsOpen?.(!app.toolbox.graphsOpen()) },
        { label: 'Biomes & trees', checked: () => !!app.biomeChart.open, action: () => app.biomeChart.setOpen(!app.biomeChart.open) },
        { label: 'Side panel', checked: () => !document.getElementById('toolbox').hidden, action: () => { const t = document.getElementById('toolbox'); t.hidden = !t.hidden; } },
        '-',
        { label: 'Settings', sub: () => Object.entries(app.toolbox.tabLabels || {}).map(([k, label]) => ({ label, checked: () => app.toolbox.tab === k, action: () => { document.getElementById('toolbox').hidden = false; app.toolbox.showTab(k); } })) },
      ],
      Help: [
        { label: 'Controls', action: () => alert('Left-drag: use the tool\nRight-drag: orbit · Middle-drag: pan · Scroll: zoom\nShift + tool: invert it\nSpace: play / pause\n1–9, 0, -, = and letters: pick a tool (shown on the tool bar and in the Tools menu)\n[ and ]: brush size\n' + `${MOD}Z / ⇧${MOD}Z: undo / redo`) },
        { label: 'Read the guide (README)', action: () => window.open('https://github.com/piguyoverthere/Geology-Simulation-Toolbox#readme', '_blank') },
        '-',
        { label: `About · version ${APP_VERSION}`, action: () => alert(`Geology Simulation Toolbox\nVersion ${APP_VERSION}\n\nOlder versions can be run from the home screen.`) },
      ],
    };
  }

  open(name, title, items) {
    this.close();
    this.openMenu = name;
    title.classList.add('open');
    const list = typeof items === 'function' ? items() : items;
    this.drop = this.buildList(list);
    const r = title.getBoundingClientRect();
    this.drop.style.left = `${r.left}px`;
    this.drop.style.top = `${r.bottom}px`;
    document.body.append(this.drop);
  }

  buildList(list) {
    const d = el('div', 'mb-drop');
    for (const it of list) {
      if (it === '-') { d.append(el('div', 'mb-sep')); continue; }
      const row = el('div', 'mb-item');
      const label = typeof it.label === 'function' ? it.label() : it.label;
      const check = it.checked ? (it.checked() ? '✓' : '') : '';
      row.append(el('span', 'mb-check', check), el('span', 'mb-label', label), el('span', 'mb-key', it.sub ? '›' : it.key || ''));
      if (it.sub) {
        let sub = null;
        row.addEventListener('mouseenter', () => {
          for (const s of d.querySelectorAll(':scope > .mb-item.sub-open')) if (s !== row) { s.classList.remove('sub-open'); s._sub?.remove(); }
          if (sub) return;
          sub = this.buildList(it.sub());
          row._sub = sub;
          row.classList.add('sub-open');
          const rr = row.getBoundingClientRect();
          sub.style.left = `${rr.right - 2}px`;
          sub.style.top = `${rr.top - 4}px`;
          document.body.append(sub);
          // (keep a long submenu on the screen)
          const sb = sub.getBoundingClientRect();
          if (sb.bottom > innerHeight - 4) sub.style.top = `${Math.max(4, innerHeight - 4 - sb.height)}px`;
          if (sb.right > innerWidth - 4) sub.style.left = `${Math.max(4, rr.left - sb.width + 2)}px`;
          const closeSub = () => { sub?.remove(); sub = null; row.classList.remove('sub-open'); };
          row._close = closeSub;
          (this.subs ||= []).push(sub);
        });
        row.addEventListener('mouseleave', (e) => { if (sub && !sub.contains(e.relatedTarget)) { /* stays open until another row is hovered */ } });
        d.addEventListener('mouseover', (e) => { const target = e.target.closest('.mb-item'); if (target && target !== row && row._close) row._close(); });
      } else {
        row.addEventListener('click', () => { this.close(); it.action?.(); this.refresh(); });
      }
      d.append(row);
    }
    return d;
  }

  close() {
    this.drop?.remove();
    this.drop = null;
    for (const s of this.subs || []) s.remove();
    this.subs = [];
    this.openMenu = null;
    for (const t of this.titles) t.classList.remove('open');
  }

  setStats(html) { this.stats.innerHTML = html; }

  setSave(text) { this.save.textContent = text || ''; this.save.title = text || ''; }

  refresh() {
    const app = this.app;
    this.play.textContent = app.sim.running ? '❚❚ Pause' : '▶ Play';
    this.play.classList.toggle('running', !!app.sim.running);
    this.simName.textContent = app.simMeta ? app.simMeta.name : '';
  }
}
