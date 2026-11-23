import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { World } from './core/world.js';
import { generateTerrain, PRESETS } from './core/generate.js';
import { generateGeology } from './core/rocks.js';
import { TerrainRenderer } from './render/terrainRenderer.js';
import { TOOLS, TOOL_KEYS, History } from './tools/brushes.js';
import { runDroplets } from './sim/droplet.js';
import { thermalStep, thermalParams } from './sim/thermal.js';
import { waterStep, waterParams } from './sim/water.js';
import { initVegetation, vegetationStep, compositionStep, vegetationParams } from './sim/vegetation.js';
import { climateParams, seasonParams, advanceSeason, seasonName, updateTemperature, updatePrecip, updateSnow } from './sim/climate.js';
import { phenologyStep } from './sim/phenology.js';
import { updateForestComposition } from './sim/species.js';
import { weatherStep, weatherParams } from './sim/weather.js';
import { glacierFlow, glacierBalance, glacierParams } from './sim/glacier.js';
import { coastParams, coastStep, seaStep, tideLevel } from './sim/coast.js';
import { qualityParams } from './sim/waterQuality.js';
import { oceanParams } from './sim/ocean.js';
import { windParams, updateWind, windErosion } from './sim/wind.js';
import { CurrentPaths } from './render/currentPaths.js';
import { ecoParams, ecologyStep } from './sim/ecology.js';
import { WildlifeMarkers } from './render/wildlife.js';
import { recordStats } from './sim/stats.js';
import { recordProbes } from './sim/probes.js';
import { civParams, civStep } from './sim/civilization.js';
import { TownLabels } from './render/townLabels.js';
import { PathLabels } from './render/pathLabels.js';
import { Boats } from './render/boats.js';
import { Toolbox } from './ui/toolbox.js';
import { Inspector } from './ui/inspector.js';
import { MonthBar } from './ui/monthbar.js';
import { CrossSection } from './ui/section.js';
import { captureDefaults, snapshot, applySnapshot, encodeLevel, decodeLevel, storeLevel, fetchLevel, deleteLevel } from './core/save.js';
import { loadGrid, saveGrid, resetGrid, gridTick, gridStartup, travelTo } from './core/worldGrid.js';
import { Drawings, drawSettings } from './render/drawings.js';
import { lavaStep, flowStep, volcanoSettings } from './sim/volcanism.js';
import { fireStep, fireParams } from './sim/fire.js';
import { landslideCheck, debrisStep, landslideParams } from './sim/landslides.js';
import { faultSettings } from './sim/tectonics.js';
import { Effects } from './render/effects.js';

// Map size (cells per side) comes from the URL (?size=384), so changing it reloads the page.
export const MAP_SIZES = [128, 192, 256, 384, 512];
const params = new URLSearchParams(location.search);
const GRID = MAP_SIZES.includes(+params.get('size')) ? +params.get('size') : 256;

class App {
  constructor() {
    this.world = new World(GRID);
    this.history = new History();
    this.waterParams = waterParams;
    this.thermalParams = thermalParams;
    this.vegetationParams = vegetationParams;
    this.climateParams = climateParams;
    this.seasonParams = seasonParams;
    this.weatherParams = weatherParams;
    this.volcanoSettings = volcanoSettings;
    this.faultSettings = faultSettings;
    this.fireParams = fireParams;
    this.landslideParams = landslideParams;
    this.glacierParams = glacierParams;
    this.coastParams = coastParams;
    this.qualityParams = qualityParams;
    this.oceanParams = oceanParams;
    this.windParams = windParams;
    this.ecoParams = ecoParams;
    this.civParams = civParams;

    this.tool = 'raise';
    this.brush = { radius: 12, strength: 0.5 };
    this.sim = {
      running: true,
      substeps: 6,
      dropletsPerFrame: 0,
      thermal: true,
      vegetation: true,
      seaEnabled: false,
      seaLevel: 12,
    };
    this.gen = { preset: PRESETS[params.get('preset')] ? params.get('preset') : 'mountains', seed: +params.get('seed') || 7, size: GRID };

    this.setupThree();
    // (the code's own defaults, before any preset's climate, are what levels are compared against)
    this.drawSettings = this.drawSettings || drawSettings;
    this.brush = this.brush || { radius: 12, strength: 0.5 };
    captureDefaults(this);
    this.applyPresetSettings(this.gen.preset);
    generateTerrain(this.world, this.gen.preset, this.gen.seed);
    this.world.seaLevel = this.sim.seaEnabled ? this.sim.seaLevel : -1000; // (coast is set up in applySea below)
    this.renderer = new TerrainRenderer(this.world, this.scene);
    this.effects = new Effects(this.scene, this.world, this.renderer);
    this.drawSettings = drawSettings;
    this.drawings = new Drawings(this.scene, this.world, this.renderer, document.getElementById('labels'));
    this.currentPaths = new CurrentPaths(this.scene, this.world, this.renderer);
    this.wildlife = new WildlifeMarkers(this.scene, this.world, this.renderer);
    this.townLabels = new TownLabels(document.getElementById('labels'), this);
    this.pathLabels = new PathLabels(document.getElementById('labels'), this);
    this.boats = new Boats(this.scene, this);
    this.effects.climateParams = climateParams;
    this.setupCursor();
    this.setupInput();

    // Keep the level across reloads (autosave to the browser, restore on start-up)
    let keep = true;
    try { keep = localStorage.getItem('geo.keepLevel') !== '0'; } catch { /* storage blocked */ }
    this.keepLevel = { on: keep };
    this.toolbox = new Toolbox(document.getElementById('toolbox'), document.getElementById('toolbar'), this);
    this.inspector = new Inspector(document.getElementById('inspector'), this);
    this.monthBar = new MonthBar(document.getElementById('monthbar'), this);
    this.section = new CrossSection(document.getElementById('viewport'), this);
    setInterval(() => this.autosave(), 30000);
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.autosave(); });
    addEventListener('pagehide', () => this.autosave());
    this.restoreLevel();
    this.setTool(this.tool);

    this.clock = new THREE.Clock();
    this.frame = 0;
    this.fps = 60;
    this.gl.setAnimationLoop(() => this.loop());
  }

  // --- Scene -----------------------------------------------------------------------------------

  setupThree() {
    const container = document.getElementById('viewport');
    this.container = container;
    const gl = new THREE.WebGLRenderer({ antialias: true });
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    container.append(gl.domElement);
    this.gl = gl;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9cc4e4);
    const k = GRID / 256; // camera, fog and shadows scale with the map
    scene.fog = new THREE.Fog(0x9cc4e4, 400 * k, 900 * k);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 3000 * k);
    this.camera.position.set(190 * k, 170 * k, 220 * k);

    this.controls = new OrbitControls(this.camera, gl.domElement);
    this.controls.target.set(0, 15, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 900 * k;

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a3b2a, 1.1);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun = sun;
    sun.position.set(-160 * k, 220 * k, 90 * k);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -180 * k; sc.right = 180 * k; sc.top = 180 * k; sc.bottom = -180 * k; sc.near = 10; sc.far = 700 * k;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.6;
    scene.add(sun);

    const resize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      gl.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(container);
    resize();
  }

  setupCursor() {
    const pts = [];
    for (let k = 0; k <= 64; k++) pts.push(new THREE.Vector3());
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.cursor = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85 }));
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
    this.scene.add(this.cursor);

    // Preview of a dragged line (fissures, dikes, faults)
    const lpts = new Array(40).fill(0).map(() => new THREE.Vector3());
    this.linePreview = new THREE.Line(new THREE.BufferGeometry().setFromPoints(lpts),
      new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true, opacity: 0.95 }));
    this.linePreview.renderOrder = 11;
    this.linePreview.visible = false;
    this.scene.add(this.linePreview);
  }

  updateLinePreview(a, b) {
    this.linePreview.visible = !!(a && b);
    if (!this.linePreview.visible) return;
    const pos = this.linePreview.geometry.attributes.position;
    for (let k = 0; k < 40; k++) {
      const t = k / 39;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const p = this.renderer.toWorld(x, z, this.world.sampleHeight(x, z) + 0.5);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    this.linePreview.geometry.computeBoundingSphere();
  }

  updateCursor(hit) {
    const show = !!hit && this.tool !== 'camera';
    this.cursor.visible = show;
    if (!show) return;
    const pos = this.cursor.geometry.attributes.position;
    const small = { spring: 3, inspect: 1.5, erupt: 3, fault: 1.5, draw: 1.2, lightning: 2, section: 1.2, lake: 2 };
    if (this.tool === 'storm') small.storm = Math.max(12, this.brush.radius * 2);
    const r = this.tool === 'intrude' && volcanoSettings.intrusion === 'dike' ? 1.5 : small[this.tool] ?? this.brush.radius;
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const gx = hit.x + Math.cos(a) * r, gz = hit.z + Math.sin(a) * r;
      const y = this.world.sampleHeight(gx, gz) + this.world.water[this.world.idx(clampI(gx, GRID), clampI(gz, GRID))] + 0.4;
      const p = this.renderer.toWorld(gx, gz, y);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    this.cursor.geometry.computeBoundingSphere();
  }

  // --- Input -----------------------------------------------------------------------------------

  setupInput() {
    const canvas = this.gl.domElement;
    this.pointer = new THREE.Vector2();
    this.pointerInside = false;
    this.painting = false;
    this.shift = false;
    this.raycaster = new THREE.Raycaster();

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dblclick', () => { if (TOOLS[this.tool].draw) this.drawings.finish(); if (TOOLS[this.tool].drawCurrent) this.currentPaths.finish(); });
    const track = (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.pointerInside = true;
      this.shift = e.shiftKey;
    };
    canvas.addEventListener('pointermove', track);
    canvas.addEventListener('pointerleave', () => { this.pointerInside = false; });
    canvas.addEventListener('pointerdown', (e) => {
      track(e);
      if (e.button !== 0 || this.tool === 'camera') return;
      const hit = this.pick();
      if (!hit) return;
      const t = TOOLS[this.tool];
      if (t.draw) { this.drawings.click(hit); return; }
      if (t.drawCurrent) { this.currentPaths.click(hit, e.shiftKey, 0.4 + 1.6 * this.brush.strength, Math.max(3, Math.min(20, this.brush.radius))); return; }
      if (t.line) {
        // Drag tools: remember the start; placed on release
        this.lineStart = hit;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (t.editsTerrain) this.history.push(this.world);
      if (t.click) {
        t.apply(this.brushCtx(hit, 0));
        return;
      }
      this.painting = true;
      this.stroke = {};
      t.apply(this.brushCtx(hit, 1 / 60)); // first dab, so a quick click still does something
      canvas.setPointerCapture(e.pointerId);
    });
    window.addEventListener('pointerup', () => {
      this.painting = false;
      if (this.lineStart) {
        const end = this.pick() || this.lastHit || this.lineStart;
        const t = TOOLS[this.tool];
        if (t.line) {
          if (t.editsTerrain) this.history.push(this.world);
          t.place(this.brushCtx(this.lineStart, 0), this.lineStart, end);
        }
        this.lineStart = null;
        this.updateLinePreview(null, null);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      this.shift = e.shiftKey;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (e.key === ' ') { e.preventDefault(); this.toggleSim(); return; }
      if (TOOLS[this.tool].draw && this.drawings.current) {
        if (e.key === 'Enter') { this.drawings.finish(); return; }
        if (e.key === 'Escape') { this.drawings.cancel(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); this.drawings.undoPoint(); return; }
      }
      if (TOOLS[this.tool].drawCurrent && this.currentPaths.draft) {
        if (e.key === 'Enter') { this.currentPaths.finish(); return; }
        if (e.key === 'Escape') { this.currentPaths.cancel(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); this.currentPaths.undoPoint(); return; }
      }
      if (e.key === 'd' && !mod) { this.setTool('draw'); return; }
      if (e.key === 'l' && !mod) { this.setTool('lightning'); return; }
      if (e.key === 'f' && !mod) { this.setTool('wildfire'); return; }
      const letters = { c: 'storm', w: 'drain', n: 'snow', g: 'glacier', b: 'subside', u: 'uplift', a: 'age', k: 'lake', p: 'section', o: 'shoreline', x: 'pollute', v: 'clean', m: 'stir', j: 'current', y: 'freshen', t: 'bloom', e: 'oxygen', i: 'seaice', r: 'surge', q: 'waves', h: 'outfall', s: 'currentPath', z: 'probe' };
      if (letters[e.key] && !mod) { this.setTool(letters[e.key]); return; }
      if (e.key === '[') { this.brush.radius = Math.max(2, this.brush.radius - 2); this.toolbox.refresh(); }
      if (e.key === ']') { this.brush.radius = Math.min(60, this.brush.radius + 2); this.toolbox.refresh(); }
      const k = TOOL_KEYS.indexOf(e.key);
      const ids = Object.keys(TOOLS);
      if (k >= 0 && k < ids.length && !mod) this.setTool(ids[k]);
    });
    window.addEventListener('keyup', (e) => { this.shift = e.shiftKey; });
  }

  /** March the mouse ray across the height field; returns grid coords of the hit or null. */
  pick() {
    if (!this.pointerInside) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const off = this.renderer.offset;
    const w = this.world;
    const step = 0.5;
    let prevT = 0;
    for (let t = 0; t < 2500 * GRID / 256; t += step) {
      const x = origin.x + direction.x * t + off, z = origin.z + direction.z * t + off, y = origin.y + direction.y * t;
      if (x < 0 || z < 0 || x > GRID - 1 || z > GRID - 1) { prevT = t; continue; }
      if (y <= w.sampleHeight(x, z)) {
        // Refine with a few bisection steps
        let a = prevT, b = t;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) / 2;
          const mx = origin.x + direction.x * m + off, mz = origin.z + direction.z * m + off, my = origin.y + direction.y * m;
          if (my <= w.sampleHeight(mx, mz)) b = m; else a = m;
        }
        return { x: origin.x + direction.x * b + off, z: origin.z + direction.z * b + off };
      }
      prevT = t;
    }
    return null;
  }

  brushCtx(hit, dt) {
    return {
      world: this.world, app: this, x: hit.x, z: hit.z, radius: this.brush.radius, strength: this.brush.strength,
      dt, stroke: this.stroke || {}, invert: this.shift,
    };
  }

  // --- Actions (called by the toolbox) ---------------------------------------------------------

  setTool(id) {
    if (this.tool === 'draw' && id !== 'draw' && this.drawings) this.drawings.finish();
    this.tool = id;
    const M = THREE.MOUSE;
    // Free the left button for painting unless the orbit tool is active
    this.controls.mouseButtons = id === 'camera'
      ? { LEFT: M.ROTATE, MIDDLE: M.DOLLY, RIGHT: M.PAN }
      : { LEFT: -1, MIDDLE: M.PAN, RIGHT: M.ROTATE };
    this.toolbox.refresh();
  }

  toggleSim() { this.sim.running = !this.sim.running; this.toolbox.refresh(); }

  // --- Saving levels -----------------------------------------------------------------------------

  /** Rebuild everything derived from the saved fields after a level is loaded. */
  afterLoad() {
    const w = this.world;
    updateTemperature(w);
    updatePrecip(w);
    phenologyStep(w);
    updateForestComposition(w);
    this.history = new History();
    this.history.push(w);
    this.applySea();
    w.dirty = true;
    this.renderer.update(true);
    this.toolbox.refresh();
    this.toolbox.updateLegend();
    this.toolbox.updateDrawList();
    this.monthBar.update();
  }

  /** Download the current level as a .geolevel file. */
  async saveLevelFile() {
    const blob = await encodeLevel(snapshot(this));
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    a.href = URL.createObjectURL(blob);
    a.download = `geology-${this.gen.preset}-${GRID}-${stamp}.geolevel`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    this.setSaveStatus(`Saved to file (${(blob.size / 1e6).toFixed(1)} MB)`);
  }

  /** Pick a .geolevel file and load it (reloading at its map size if different). */
  loadLevelFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geolevel';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const snap = await decodeLevel(file);
        if (snap.meta.N !== GRID) {
          // Different map size: hand it over to a reload at the right size
          await storeLevel('pending', snap);
          location.search = new URLSearchParams({ size: snap.meta.N, restore: 'pending' }).toString();
          return;
        }
        applySnapshot(this, snap);
        this.setSaveStatus(`Loaded ${file.name}`);
        this.autosave();
      } catch (err) {
        this.setSaveStatus(`Couldn't load: ${err.message}`);
      }
    };
    input.click();
  }

  /** Save to the browser so a reload (or an update) picks up where you left off. */
  async autosave() {
    if (!this.keepLevel.on || this.loadingLevel) return;
    try {
      await storeLevel(`autosave-${GRID}`, snapshot(this));
      await saveGrid(this);
      this.setSaveStatus(`Autosaved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (err) {
      this.setSaveStatus(`Autosave failed: ${err.message}`);
    }
  }

  /** On start-up: load a level handed over by a reload, or the last autosave for this map size. */
  async restoreLevel() {
    this.loadingLevel = true;
    try {
      let snap = null, from = '';
      if (params.get('restore') === 'pending') {
        snap = await fetchLevel('pending');
        await deleteLevel('pending');
        from = 'Loaded level';
        window.history.replaceState(null, '', `?size=${GRID}`);
      } else if (this.keepLevel.on) {
        snap = await fetchLevel(`autosave-${GRID}`);
        from = 'Restored your last level';
      }
      if (snap && snap.meta.N === GRID) {
        applySnapshot(this, snap);
        // (a level from a file is a world of its own: a new grid around it)
        if (from === 'Loaded level') { await loadGrid(this); await resetGrid(this); }
        this.setSaveStatus(`${from} (saved ${new Date(snap.meta.savedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })})`);
      }
    } catch (err) {
      console.warn('Level restore failed', err);
      this.setSaveStatus(`Couldn't restore the last level: ${err.message}`);
    }
    this.loadingLevel = false;
    // The world grid: which cell this is, and its neighbours
    try { if (!this.grid) await loadGrid(this); gridStartup(this); this.toolbox?.renderGrid?.(); } catch (err) { console.warn('World grid unavailable', err); }
  }

  /** Travel to another cell of the world grid. */
  travel(x, z) {
    return travelTo(this, x, z, (msg) => this.setSaveStatus(msg));
  }

  setSaveStatus(text) { this.saveStatus = text; this.toolbox.setSaveStatus?.(text); }

  /**
   * Overcast fall and winter: from late September to mid-March a grey cloud deck covers the region,
   * the light is dim and flat and the sky grey. Storms darken it further at any time of year.
   */
  updateSky() {
    const ph = seasonParams.phase;
    const season = seasonParams.enabled ? smoothstep(0.49, 0.57, ph) * (1 - smoothstep(0.96, 0.995, ph)) : 0;
    const storms = this.world.storms ? Math.min(1, this.world.storms.length / 6) : 0;
    const o = Math.min(1, season * 0.85 + storms * 0.35 * (this.renderer.cloudsOn ? 1 : 0.5));
    this.overcast = o;
    this.sun.intensity = 2.6 * (1 - 0.55 * o);
    this.hemi.intensity = 1.1 * (1 - 0.15 * o);
    // Wildfire smoke: a brown-orange sky and a dim, reddened sun
    const smog = this.effects.smogLevel || 0;
    this.sun.intensity *= 1 - 0.55 * smog;
    this.sun.color.copy(SUN_CLEAR).lerp(SUN_SMOKY, smog);
    const sky = SKY_CLEAR.clone().lerp(SKY_GREY, o).lerp(SKY_SMOKE, Math.min(1, smog * 1.1));
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.effects.overcast = season;
  }

  /** Reload with a different map size, keeping the preset and seed. */
  setMapSize(size) {
    const q = new URLSearchParams({ size, preset: this.gen.preset, seed: this.gen.seed });
    location.search = q.toString();
  }

  /**
   * Presets come with their own settings (the Cascades' westerly wind and dry summers, Puget Sound's
   * sea, tides and ocean fog). Settings the previous preset set are put back first, so switching to a
   * plain preset doesn't leave the sea or fog on.
   */
  applyPresetSettings(preset) {
    if (this.presetKeys) for (const [obj, key, val] of this.presetKeys) obj[key] = val;
    this.presetKeys = [];
    const set = (obj, vals) => { for (const [k, v] of Object.entries(vals || {})) { this.presetKeys.push([obj, k, obj[k]]); obj[k] = v; } };
    const pr = PRESETS[preset] || {};
    set(climateParams, pr.climate);
    set(coastParams, pr.coast);
    set(this.seasonParams, pr.seasons);
    set(this.weatherParams, pr.weather);
    set(oceanParams, pr.ocean);
    set(vegetationParams, pr.vegetation);
    set(fireParams, pr.fire);
    set(this.waterParams, pr.water);
    if (pr.sea) set(this.sim, { seaEnabled: pr.sea.enabled, seaLevel: pr.sea.level });
  }

  generate() {
    this.applyPresetSettings(this.gen.preset);
    this.toolbox?.refresh();
    generateTerrain(this.world, this.gen.preset, this.gen.seed);
    this.history.push(this.world);
    this.applySea();
    updateWind(this.world, true);
    this.effects.deck.ready = false; // rebuild the cloud deck for the new terrain
    this.autosave(); // a new level replaces the kept one
    resetGrid(this).then(() => this.toolbox?.renderGrid?.()); // (and starts a new world grid around it)
  }

  applySea() {
    this.world.seaLevel = this.sim.seaEnabled ? this.sim.seaLevel : -1000;
    this.world.meanSea = this.world.seaLevel;
    this.world.tide = 0;
    if (this.sim.seaEnabled) {
      // Fill (or lower) the sea straight away, even while paused. Lowering it drains the strip it
      // used to cover, rather than leaving the old seawater standing there.
      const H = this.world.height, D = this.world.water, sea = this.world.seaLevel;
      const prev = this.lastSea ?? sea;
      for (let i = 0; i < D.length; i++) {
        if (H[i] < sea) D[i] = sea - H[i];
        else if (H[i] < prev && Math.abs(H[i] + D[i] - prev) < 0.5) D[i] = 0;
      }
    }
    this.lastSea = this.sim.seaEnabled ? this.world.seaLevel : undefined;
    coastStep(this.world);
    if (!this.sim.seaEnabled) {
      // Drain the old ocean
      const H = this.world.height, D = this.world.water;
      for (let i = 0; i < D.length; i++) if (H[i] + D[i] <= this.sim.seaLevel + 0.01) D[i] = 0;
    }
    this.world.dirty = true;
  }

  bulkErode(n) {
    if (!this.world.erosionEnabled) return;
    this.history.push(this.world);
    const t0 = performance.now();
    runDroplets(this.world, n);
    for (let k = 0; k < 5; k++) thermalStep(this.world);
    // This stands for centuries, so plants have had time to re-establish rather than being wiped out
    this.world.prevHeight.set(this.world.height);
    console.log(`Eroded ${n} droplets in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  clearWater() { this.world.clearWater(); this.world.sources.length = 0; this.applySea(); }
  undo() { this.history.undo(this.world); }
  redo() { this.history.redo(this.world); }
  /** Recompute temperatures after the climate changes, and redraw. */
  climateChanged() {
    updateWind(this.world, true);
    updateTemperature(this.world);
    updatePrecip(this.world);
    updateSnow(this.world, 30); // let the snowpack respond quickly to the new climate
    phenologyStep(this.world);
    updateForestComposition(this.world); // all of it, so the new climate shows at once
    this.world.dirty = true;
  }

  setBaseline() { this.world.setBaseline(); this.world.dirty = true; }

  exportPNG() {
    const N = GRID, H = this.world.height;
    let min = Infinity, max = -Infinity;
    for (const h of H) { if (h < min) min = h; if (h > max) max = h; }
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const v = Math.round(((H[i] - min) / (max - min || 1)) * 255);
      img.data.set([v, v, v, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    const a = document.createElement('a');
    a.download = `heightmap-${min.toFixed(1)}-${max.toFixed(1)}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }

  importPNG() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = GRID;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, GRID, GRID);
        const data = ctx.getImageData(0, 0, GRID, GRID).data;
        this.history.push(this.world);
        // Use the range in the filename if this is one of our exports, else 0..60
        const m = file.name.match(/heightmap-(-?[\d.]+)-(-?[\d.]+)/);
        const lo = m ? parseFloat(m[1]) : 0, hi = m ? parseFloat(m[2]) : 60;
        for (let i = 0; i < GRID * GRID; i++) this.world.height[i] = lo + (data[i * 4] / 255) * (hi - lo);
        this.world.setBaseline();
        this.world.clearWater();
        generateGeology(this.world, 'imported', this.gen.seed);
        initVegetation(this.world, this.gen.seed);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    };
    input.click();
  }

  // --- Main loop -------------------------------------------------------------------------------

  loop() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.frame++;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;

    const hit = this.pick();
    if (hit) this.lastHit = hit;
    this.updateCursor(hit);
    if (this.lineStart) {
      this.updateLinePreview(this.lineStart, hit || this.lastHit);
      // The cross-section follows the line live while dragging
      if (this.tool === 'section' && this.frame % 3 === 0) this.section.show(this.lineStart, hit || this.lastHit);
    }
    if (this.tool === 'inspect' && this.frame % 3 === 0) this.inspector.update(hit);
    else if (this.tool !== 'inspect') this.inspector.update(null);
    if (this.painting && hit) TOOLS[this.tool].apply(this.brushCtx(hit, dt));

    if (this.sim.running) {
      advanceSeason(dt);
      // Tides: the sea rises and falls about its mean level
      if (this.sim.seaEnabled) this.world.seaLevel = tideLevel(this.world, this.sim.seaLevel);
      // Water substeps, within a time budget so big maps stay responsive (the simulation then runs
      // slower than the Sim speed setting asks for, rather than the frame rate collapsing)
      const t0 = performance.now();
      let done = 0;
      while (done < this.sim.substeps) {
        waterStep(this.world);
        done++;
        if (performance.now() - t0 > 28) break;
      }
      this.stepsDone = (this.stepsDone ?? done) * 0.9 + done * 0.1;
      // Weather runs every other frame with the time of both (half the cost; storms move slowly)
      this.weatherDt = (this.weatherDt || 0) + done * this.waterParams.dt;
      if (this.frame % 2 === 0) {
        if (this.climateParams.storms > 0 || this.world.storms?.length || this.world.holdovers?.length) weatherStep(this.world, this.weatherDt);
        this.weatherDt = 0;
      }
      if (this.sim.dropletsPerFrame > 0) runDroplets(this.world, this.sim.dropletsPerFrame);
      // Landslides keep pace with the water: faster sim speed means more relaxation per frame
      if (this.sim.thermal && this.frame % 2 === 0) thermalStep(this.world, null, Math.min(1, 0.25 * this.sim.substeps / 6 * 2));
      if (this.frame % 10 === 0) {
        if (this.sim.vegetation) vegetationStep(this.world); // also refreshes temperature
        else { updateTemperature(this.world); updatePrecip(this.world); updateSnow(this.world, 1, true); } // terrain may have changed
        phenologyStep(this.world);
        glacierBalance(this.world);
        coastStep(this.world);
        if (seasonParams.enabled || this.seasonWasOn) this.world.dirty = true;
        this.seasonWasOn = seasonParams.enabled;
      }
      // Look for slopes about to fail a few times a second (scaled with sim speed)
      if (this.frame % 10 === 5 && this.sim.vegetation) compositionStep(this.world);
      if (this.frame % 10 === 3) seaStep(this.world);
      // Wind (recomputed only when the wind, sea or land changes) and its very slow erosion
      if (this.frame % 30 === 15) { civStep(this.world); gridTick(this); } // (towns, farms, roads and their pollution)
      if (this.frame % 10 === 9) { this.ecoPart = ((this.ecoPart ?? -1) + 1) % 3; ecologyStep(this.world, this.ecoPart); }
      if (this.frame % 10 === 7) { updateWind(this.world); if (this.world.erosionEnabled) windErosion(this.world); }
      // Glacier ice creeps a little every frame (faster at higher sim speed)
      if (this.world.ice) glacierFlow(this.world, this.sim.substeps / 6);
      if (this.frame % 5 === 0) landslideCheck(this.world, 0.25 * this.sim.substeps / 6);
      // Eruptions, intrusions and faults advance in simulated time, faster at higher sim speed
      const steps = Math.max(1, Math.round(this.sim.substeps / 3));
      for (let k = 0; k < steps; k++) {
        const w = this.world;
        for (let e = w.events.length - 1; e >= 0; e--) if (w.events[e].update(w, 0.05)) w.events.splice(e, 1);
        lavaStep(w, 0.05);
        flowStep(w, 0.05);
        debrisStep(w, 0.05);
        fireStep(w, 0.05);
      }
    }

    this.renderer.update();
    this.effects.update(dt);
    this.drawings.update(dt, this.camera, hit, this.tool === 'draw');
    this.currentPaths.update(dt);
    this.wildlife.update(dt);
    this.townLabels.update();
    this.pathLabels.update();
    this.boats.update(dt);
    if (this.frame % 30 === 0) { this.toolbox.drawGraphs(); this.toolbox.drawStats(); } // (population and map graphs)
    if (this.sim.running && this.frame % 120 === 60) { recordStats(this.world); recordProbes(this.world); } // (whole-map statistics and probes, every couple of seconds)
    this.controls.update();
    this.effects.applyShake(this.camera, dt);
    this.gl.render(this.scene, this.camera);
    this.effects.removeShake(this.camera);

    if (this.frame % 6 === 0) { this.monthBar.update(); this.updateSky(); }
    if (this.frame % 15 === 0) {
      const s = this.world.stats();
      this.toolbox.setStats(
        `<span>${this.fps.toFixed(0)} fps</span><span>water ${fmt(s.water)}</span>` +
        (this.stepsDone !== undefined && this.stepsDone < this.sim.substeps - 0.5 ? `<span title="Water steps per frame actually run: the map is too big for the requested sim speed">speed ${this.stepsDone.toFixed(1)}/${this.sim.substeps}</span>` : '') +
        `<span>sediment ${fmt(s.sed)}</span><span class="ero">eroded ${fmt(s.eroded)}</span>` +
        `<span class="dep">deposited ${fmt(s.deposited)}</span><span>springs ${this.world.sources.length}</span>` +
        (this.world.events.length ? `<span class="evt">events ${this.world.events.length}</span>` : '') +
        (this.world.storms?.length ? `<span>storms ${this.world.storms.length}</span>` : ''));
    }
  }
}

const SKY_CLEAR = new THREE.Color(0x9cc4e4), SKY_GREY = new THREE.Color(0x98a1aa), SKY_SMOKE = new THREE.Color(0xb59a78);
const SUN_CLEAR = new THREE.Color(0xfff1dc), SUN_SMOKY = new THREE.Color(0xffa060);
function smoothstep(e0, e1, x) { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); }
function fmt(v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0); }
function clampI(v, n) { return Math.min(n - 1, Math.max(0, Math.round(v))); }

window.app = new App();
