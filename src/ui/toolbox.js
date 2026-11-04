// The right-hand toolbox panel and the bottom tool bar. Built with plain DOM so it is easy to
// extend: each control is bound to a property on some settings object and carries a `help` string
// that is shown in the info box when you hover it.

import { TOOLS, toolKey } from '../tools/brushes.js';
import { PRESETS } from '../core/generate.js';
import { COLOR_MODES } from '../render/terrainRenderer.js';
import { BIOMES } from '../render/biomes.js';

export class Toolbox {
  /**
   * @param {HTMLElement} root     the right-hand panel
   * @param {HTMLElement} barRoot  the bottom tool bar
   * @param {object} app  the App from main.js (state, world, actions)
   */
  constructor(root, barRoot, app) {
    this.root = root;
    this.app = app;
    this.toolButtons = new Map();
    this.build();
    this.buildToolbar(barRoot);
  }

  build() {
    const app = this.app;
    const r = this.root;
    r.innerHTML = '';

    const header = el('div', 'tb-header');
    header.append(el('h1', '', 'Geology Toolbox'));
    this.playBtn = button('', () => app.toggleSim(), 'tb-play');
    header.append(this.playBtn);
    r.append(header);

    this.statsEl = el('div', 'tb-stats');
    r.append(this.statsEl);

    // --- Erosion -----------------------------------------------------------------------------
    const ero = this.section('Erosion', true);
    const master = toggle('Erosion enabled', app.world, 'erosionEnabled',
      'Master switch for all erosion: rivers, weathering, landslides and the erosion brushes. Turn off to sculpt and watch water flow without the ground changing.', this, () => this.refresh());
    master.classList.add('tb-master');
    this.erosionControls = el('div', 'tb-group');
    this.erosionControls.append(
      toggle('River erosion', app.waterParams, 'erosionEnabled',
        'Let flowing water pick up and drop sediment. Turn off to just watch water flow and pool.', this),
      slider('Weathering', app.sim, 'dropletsPerFrame', 0, 3000, 50,
        'Raindrop erosion over the whole map each frame (particle model). Simulates centuries of rainfall: carves gullies and valleys.', this),
      toggle('Landslides', app.sim, 'thermal',
        'Thermal erosion: slopes steeper than the angle of repose crumble into scree.', this),
      slider('Repose angle °', app.thermalParams, 'talusAngle', 15, 60, 1,
        'Steepest stable slope for loose rock. Real rubble is about 30-40°. Hard strata can stand steeper.', this),
    );
    const eroBtns = el('div', 'tb-row');
    eroBtns.append(button('Erode ×50k drops', () => app.bulkErode(50000), '', 'Instantly run 50,000 raindrops of erosion over the whole map.', this));
    this.erosionControls.append(eroBtns);
    ero.append(master, this.erosionControls);

    // --- Water & climate ---------------------------------------------------------------------
    const sim = this.section('Water & climate', true);
    sim.append(
      slider('Sim speed', app.sim, 'substeps', 1, 20, 1,
        'Water-flow steps per frame. Higher = faster geological time, lower framerate.', this),
      slider('Global rain', app.waterParams, 'rain', 0, 0.1, 0.002,
        'Rainfall over the whole map, fed into the shallow-water flow model. Rivers form where runoff converges.', this),
      slider('Evaporation', app.waterParams, 'evaporate', 0, 0.3, 0.005,
        'How fast standing water dries up. Dry lakes leave their sediment behind as flat lake beds.', this),
      toggle('Plant growth', app.sim, 'vegetation',
        'Vegetation regrows toward what each spot can support (gentle, moist, not too high) and dies where ground is washed away, buried or flooded. Forest erodes ~4x slower than barren ground.', this),
      slider('Climate wetness', app.vegetationParams, 'climate', 0, 1.5, 0.05,
        'Long-term rainfall of the region. Dry it out and forests retreat to grassland, then to bare ground, holding on longest along rivers and lakes.', this),
      slider('Tree line', app.vegetationParams, 'treeLine', 5, 90, 1,
        'Height above which it is too cold for trees. Above it forests give way to alpine grassland, which thins to bare ground higher up.', this),
    );
    const simBtns = el('div', 'tb-row');
    simBtns.append(button('Clear water', () => app.clearWater(), '', 'Remove all water, suspended sediment and springs.', this));
    sim.append(simBtns);

    // --- Geology -----------------------------------------------------------------------------
    const geo = this.section('Geology', false);
    geo.append(
      toggle('Rock strata', app.world, 'strataEnabled',
        'Layers of hard and soft rock. Soft layers erode up to 5× faster, carving ledges, cliffs and mesas. Use the Rock hardness view to see them.', this, () => app.world.dirty = true),
      slider('Layer strength', app.world, 'strataStrength', 0, 1, 0.05,
        'How different hard and soft layers are. High values carve dramatic ledges and terraces; low values give subtle benches.', this, () => app.world.dirty = true),
      slider('Layer spacing', app.world, 'strataSpacing', 2, 25, 0.5,
        'Vertical thickness of each hard+soft rock band.', this, () => app.world.dirty = true),
      toggle('Sea', app.sim, 'seaEnabled',
        'Fill everything below sea level with ocean. Rivers slow down and drop sediment where they meet it, forming deltas.', this, () => app.applySea()),
      slider('Sea level', app.sim, 'seaLevel', 0, 50, 0.5, 'Height of the ocean surface.', this, () => app.applySea()),
      toggle('Drain at edges', app.world, 'edgeDrain', 'Let water flow off the edges of the map instead of being walled in.', this),
    );

    // --- Terrain -----------------------------------------------------------------------------
    const ter = this.section('Terrain', false);
    const presetSel = select('Preset', Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])),
      app.gen, 'preset', 'Starting landscape for the simulation.', this);
    const seed = numberInput('Seed', app.gen, 'seed', 'Random seed. Same seed + preset = same terrain.', this);
    ter.append(presetSel, seed);
    const terBtns = el('div', 'tb-row');
    terBtns.append(
      button('Generate', () => app.generate(), 'primary', 'Create a new terrain from the preset and seed.', this),
      button('Random', () => { app.gen.seed = (Math.random() * 1e6) | 0; this.refresh(); app.generate(); }, '', 'New random seed.', this),
    );
    const terBtns2 = el('div', 'tb-row');
    terBtns2.append(
      button('Undo', () => app.undo(), '', 'Undo the last terrain stroke (Ctrl/Cmd+Z).', this),
      button('Redo', () => app.redo(), '', 'Redo (Ctrl/Cmd+Shift+Z).', this),
      button('Set baseline', () => app.setBaseline(), '', 'Reset the erosion/deposition view so the current terrain counts as "no change".', this),
    );
    const terBtns3 = el('div', 'tb-row');
    terBtns3.append(
      button('Export PNG', () => app.exportPNG(), '', 'Download the heightmap as a greyscale PNG.', this),
      button('Import PNG', () => app.importPNG(), '', 'Load a greyscale heightmap image (brighter = higher).', this),
    );
    ter.append(terBtns, terBtns2, terBtns3);

    // --- View --------------------------------------------------------------------------------
    const view = this.section('View', false);
    view.append(
      select('Colour', COLOR_MODES, app.renderer, 'colorMode',
        'Natural: realistic colours with biomes blended. Biomes: hard biome categories (see legend). Erosion/deposition: red = ground removed, blue = sediment added since the baseline. Rock hardness: strata. Slope: steepness.', this, () => app.world.dirty = true),
      toggle('Show water', app.renderer, 'showWater', 'Show or hide surface water.', this, () => app.world.dirty = true),
      slider('Snow line', app.renderer, 'snowLine', 10, 120, 1, 'Height above which flat ground is snow-covered.', this, () => app.world.dirty = true),
      toggle('Wireframe', app.renderer.terrainMat, 'wireframe', 'Show the terrain grid.', this),
    );
    const legend = el('div', 'tb-legend');
    for (const b of Object.values(BIOMES)) {
      const item = el('div', 'tb-legend-item');
      const sw = el('span', 'tb-swatch');
      sw.style.background = `rgb(${b.color.map((c) => Math.round(c * 255)).join(',')})`;
      item.append(sw, el('span', '', b.label));
      this.helpOn(item, `<b>${b.label}</b> — ${b.help}`);
      legend.append(item);
    }
    view.append(el('div', 'tb-group-label', 'Biomes'), legend);

    // --- Info --------------------------------------------------------------------------------
    this.info = el('div', 'tb-info');
    r.append(this.info);
    this.setInfo(this.defaultInfo());
  }

  /** Bottom bar: every tool as a small icon button, grouped, plus the brush size/strength. */
  buildToolbar(bar) {
    const app = this.app;
    bar.innerHTML = '';
    const groups = [...new Set(Object.values(TOOLS).map((t) => t.group))];
    for (const g of groups) {
      const group = el('div', 'bar-group');
      group.append(el('div', 'bar-label', g));
      const icons = el('div', 'bar-icons');
      for (const [id, t] of Object.entries(TOOLS)) {
        if (t.group !== g) continue;
        const b = el('button', 'bar-tool');
        const key = toolKey(id);
        b.innerHTML = `<span class="bar-icon">${t.icon}</span>${key ? `<kbd>${key}</kbd>` : ''}`;
        b.title = `${t.label}${key ? ` (${key})` : ''}`;
        b.setAttribute('aria-label', t.label);
        b.addEventListener('click', () => app.setTool(id));
        this.helpOn(b, `<b>${t.label}</b>${key ? ` <kbd>${key}</kbd>` : ''} — ${t.help}`);
        icons.append(b);
        this.toolButtons.set(id, b);
      }
      group.append(icons);
      if (g === 'Erosion') this.erosionTools = group;
      bar.append(group);
    }
    const brush = el('div', 'bar-group bar-brush');
    brush.append(
      el('div', 'bar-label', 'Brush'),
      slider('Size', app.brush, 'radius', 2, 60, 1, 'Brush radius in cells. Shortcut: [ and ].', this),
      slider('Strength', app.brush, 'strength', 0.05, 1, 0.01, 'How fast the tool works. Hold Shift to invert most tools.', this),
    );
    bar.append(brush);
  }

  section(title, open) {
    const d = document.createElement('details');
    d.className = 'tb-section';
    d.open = open;
    d.append(el('summary', '', title));
    const body = el('div', 'tb-body');
    d.append(body);
    this.root.append(d);
    return body;
  }

  helpOn(node, html) {
    node.addEventListener('mouseenter', () => this.setInfo(html));
    node.addEventListener('mouseleave', () => this.setInfo(this.defaultInfo()));
  }

  defaultInfo() {
    const t = TOOLS[this.app.tool];
    return `<b>${t.label}</b> — ${t.help}<div class="tb-hint">Right-drag: orbit · Middle-drag: pan · Scroll: zoom · Shift: invert · Space: play/pause</div>`;
  }

  setInfo(html) { this.info.innerHTML = html; }

  /** Sync all controls and highlight the active tool. Called after state changes from code. */
  refresh() {
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === this.app.tool);
    this.playBtn.textContent = this.app.sim.running ? '❚❚ Pause' : '▶ Play';
    this.playBtn.classList.toggle('running', this.app.sim.running);
    document.querySelectorAll('[data-sync]').forEach((n) => n.sync());
    this.erosionControls.classList.toggle('tb-disabled', !this.app.world.erosionEnabled);
    this.erosionTools.classList.toggle('tb-disabled', !this.app.world.erosionEnabled);
    this.setInfo(this.defaultInfo());
  }

  setStats(html) { this.statsEl.innerHTML = html; }
}

// --- tiny DOM helpers ------------------------------------------------------------------------

function el(tag, cls = '', text = '') {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function button(label, onClick, cls = '', help = '', tb = null) {
  const b = el('button', 'tb-btn ' + cls, label);
  b.addEventListener('click', onClick);
  if (help && tb) tb.helpOn(b, help);
  return b;
}

function slider(label, obj, key, min, max, step, help, tb, onChange) {
  const row = el('label', 'tb-control');
  const name = el('span', 'tb-label', label);
  const input = el('input');
  Object.assign(input, { type: 'range', min, max, step });
  const val = el('span', 'tb-value');
  const fmt = (v) => (step >= 1 ? String(Math.round(v)) : Number(v).toFixed(step < 0.01 ? 3 : 2));
  row.sync = () => { input.value = obj[key]; val.textContent = fmt(obj[key]); };
  row.dataset.sync = '';
  input.addEventListener('input', () => {
    obj[key] = parseFloat(input.value);
    val.textContent = fmt(obj[key]);
    onChange && onChange();
  });
  row.append(name, input, val);
  row.sync();
  tb.helpOn(row, `<b>${label}</b> — ${help}`);
  return row;
}

function toggle(label, obj, key, help, tb, onChange) {
  const row = el('label', 'tb-control tb-toggle');
  const input = el('input');
  input.type = 'checkbox';
  row.sync = () => { input.checked = !!obj[key]; };
  row.dataset.sync = '';
  input.addEventListener('change', () => { obj[key] = input.checked; onChange && onChange(); });
  row.append(input, el('span', 'tb-label', label));
  row.sync();
  tb.helpOn(row, `<b>${label}</b> — ${help}`);
  return row;
}

function select(label, options, obj, key, help, tb, onChange) {
  const row = el('label', 'tb-control');
  const s = el('select');
  for (const [v, text] of Object.entries(options)) {
    const o = el('option', '', text);
    o.value = v;
    s.append(o);
  }
  row.sync = () => { s.value = obj[key]; };
  row.dataset.sync = '';
  s.addEventListener('change', () => { obj[key] = s.value; onChange && onChange(); });
  row.append(el('span', 'tb-label', label), s);
  row.sync();
  tb.helpOn(row, `<b>${label}</b> — ${help}`);
  return row;
}

function numberInput(label, obj, key, help, tb) {
  const row = el('label', 'tb-control');
  const input = el('input');
  input.type = 'number';
  row.sync = () => { input.value = obj[key]; };
  row.dataset.sync = '';
  input.addEventListener('change', () => { obj[key] = parseInt(input.value, 10) || 0; });
  row.append(el('span', 'tb-label', label), input);
  row.sync();
  tb.helpOn(row, `<b>${label}</b> — ${help}`);
  return row;
}
