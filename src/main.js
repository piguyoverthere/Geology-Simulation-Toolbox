import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { World } from './core/world.js';
import { generateTerrain } from './core/generate.js';
import { generateGeology } from './core/rocks.js';
import { TerrainRenderer } from './render/terrainRenderer.js';
import { TOOLS, TOOL_KEYS, History } from './tools/brushes.js';
import { runDroplets } from './sim/droplet.js';
import { thermalStep, thermalParams } from './sim/thermal.js';
import { waterStep, waterParams } from './sim/water.js';
import { initVegetation, vegetationStep, vegetationParams } from './sim/vegetation.js';
import { Toolbox } from './ui/toolbox.js';
import { Inspector } from './ui/inspector.js';

const GRID = 256;

class App {
  constructor() {
    this.world = new World(GRID);
    this.history = new History();
    this.waterParams = waterParams;
    this.thermalParams = thermalParams;
    this.vegetationParams = vegetationParams;

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
    this.gen = { preset: 'mountains', seed: 7 };

    this.setupThree();
    generateTerrain(this.world, this.gen.preset, this.gen.seed);
    this.renderer = new TerrainRenderer(this.world, this.scene);
    this.setupCursor();
    this.setupInput();

    this.toolbox = new Toolbox(document.getElementById('toolbox'), document.getElementById('toolbar'), this);
    this.inspector = new Inspector(document.getElementById('inspector'), this);
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
    scene.fog = new THREE.Fog(0x9cc4e4, 400, 900);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 3000);
    this.camera.position.set(190, 170, 220);

    this.controls = new OrbitControls(this.camera, gl.domElement);
    this.controls.target.set(0, 15, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 900;

    scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x4a3b2a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(-160, 220, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -180; sc.right = 180; sc.top = 180; sc.bottom = -180; sc.near = 10; sc.far = 700;
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
  }

  updateCursor(hit) {
    const show = !!hit && this.tool !== 'camera';
    this.cursor.visible = show;
    if (!show) return;
    const pos = this.cursor.geometry.attributes.position;
    const r = this.tool === 'spring' ? 3 : this.tool === 'inspect' ? 1.5 : this.brush.radius;
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
    window.addEventListener('pointerup', () => { this.painting = false; });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      this.shift = e.shiftKey;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (e.key === ' ') { e.preventDefault(); this.toggleSim(); return; }
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
    for (let t = 0; t < 2500; t += step) {
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
      world: this.world, x: hit.x, z: hit.z, radius: this.brush.radius, strength: this.brush.strength,
      dt, stroke: this.stroke || {}, invert: this.shift,
    };
  }

  // --- Actions (called by the toolbox) ---------------------------------------------------------

  setTool(id) {
    this.tool = id;
    const M = THREE.MOUSE;
    // Free the left button for painting unless the orbit tool is active
    this.controls.mouseButtons = id === 'camera'
      ? { LEFT: M.ROTATE, MIDDLE: M.DOLLY, RIGHT: M.PAN }
      : { LEFT: -1, MIDDLE: M.PAN, RIGHT: M.ROTATE };
    this.toolbox.refresh();
  }

  toggleSim() { this.sim.running = !this.sim.running; this.toolbox.refresh(); }

  generate() {
    generateTerrain(this.world, this.gen.preset, this.gen.seed);
    this.history.push(this.world);
    this.applySea();
  }

  applySea() {
    this.world.seaLevel = this.sim.seaEnabled ? this.sim.seaLevel : -1000;
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
    this.updateCursor(hit);
    if (this.tool === 'inspect' && this.frame % 3 === 0) this.inspector.update(hit);
    else if (this.tool !== 'inspect') this.inspector.update(null);
    if (this.painting && hit) TOOLS[this.tool].apply(this.brushCtx(hit, dt));

    if (this.sim.running) {
      for (let k = 0; k < this.sim.substeps; k++) waterStep(this.world);
      if (this.sim.dropletsPerFrame > 0) runDroplets(this.world, this.sim.dropletsPerFrame);
      if (this.sim.thermal && this.frame % 4 === 0) thermalStep(this.world, null, 0.5);
      if (this.sim.vegetation && this.frame % 10 === 0) vegetationStep(this.world);
    }

    this.renderer.update();
    this.controls.update();
    this.gl.render(this.scene, this.camera);

    if (this.frame % 15 === 0) {
      const s = this.world.stats();
      this.toolbox.setStats(
        `<span>${this.fps.toFixed(0)} fps</span><span>water ${fmt(s.water)}</span>` +
        `<span>sediment ${fmt(s.sed)}</span><span class="ero">eroded ${fmt(s.eroded)}</span>` +
        `<span class="dep">deposited ${fmt(s.deposited)}</span><span>springs ${this.world.sources.length}</span>`);
    }
  }
}

function fmt(v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0); }
function clampI(v, n) { return Math.min(n - 1, Math.max(0, Math.round(v))); }

window.app = new App();
