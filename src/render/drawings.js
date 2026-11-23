// Drawings: paths and polygons drawn on the landscape, like the path and polygon tools in a globe
// viewer. Lines are draped over the terrain and follow it as it erodes; polygons get a translucent
// fill. Each shape is labelled with its measurements: length along the ground, climb and descent,
// and (for polygons) area. Distances are in grid cells, the same units as the height readouts.
//
// Draw tool: click to add points. Double-click or Enter finishes a path; click the first point
// again (or Enter in Polygon mode) to close a polygon. Backspace removes the last point, Escape
// cancels.

import * as THREE from 'three';

export const drawSettings = {
  shape: 'path',      // 'path' | 'polygon'
  color: '#ffd24a',
  labels: true,
  fill: 0.12,         // how opaque a polygon's fill is (0 = see-through, 1 = solid)
};

export const DRAW_COLORS = { '#ffd24a': 'Yellow', '#ff5a4f': 'Red', '#4fc3ff': 'Blue', '#7dff6a': 'Green', '#ffffff': 'White', '#c77dff': 'Purple' };

const LIFT = 0.45;  // how far lines float above the ground (avoids z-fighting)

export class Drawings {
  constructor(scene, world, renderer, container) {
    this.scene = scene;
    this.world = world;
    this.renderer = renderer;
    this.container = container;     // element for the HTML labels
    this.shapes = [];               // { id, name, points: [{x, z}], closed, color, obj, label }
    this.current = null;            // shape being drawn
    this.nextId = 1;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.onChange = () => {};
    // Rubber-band segment from the last point to the cursor while drawing
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.band = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.8, gapSize: 0.5, depthTest: false, transparent: true, opacity: 0.85 }));
    this.band.frustumCulled = false;
    this.band.renderOrder = 10;
    this.band.visible = false;
    scene.add(this.band);
    this.refreshTimer = 0;
  }

  // --- Editing ---------------------------------------------------------------------------------

  /** Click with the draw tool at grid point p. */
  click(p) {
    if (!this.current) {
      this.current = { id: this.nextId++, points: [], closed: false, color: drawSettings.color, obj: null, label: null };
      this.current.name = `${drawSettings.shape === 'polygon' ? 'Polygon' : 'Path'} ${this.current.id}`;
      this.current.wantPolygon = drawSettings.shape === 'polygon';
    }
    const pts = this.current.points;
    // Clicking the first point closes the shape into a polygon
    if (pts.length >= 3 && Math.hypot(p.x - pts[0].x, p.z - pts[0].z) < this.snapRadius()) {
      this.finish(true);
      return;
    }
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.3) return; // double-click repeats a point
    pts.push({ x: p.x, z: p.z });
    this.build(this.current);
    this.onChange();
  }

  /** Finish the shape being drawn (as a polygon if asked or in Polygon mode). */
  finish(close = null) {
    const s = this.current;
    if (!s) return;
    this.current = null;
    this.band.visible = false;
    const closed = close ?? s.wantPolygon;
    if (s.points.length < 2 || (closed && s.points.length < 3)) { this.dispose(s); this.onChange(); return; }
    s.closed = closed;
    if (closed && s.name.startsWith('Path')) s.name = s.name.replace('Path', 'Polygon');
    if (!closed && s.name.startsWith('Polygon')) s.name = s.name.replace('Polygon', 'Path');
    this.shapes.push(s);
    this.build(s);
    this.onChange();
  }

  cancel() {
    if (!this.current) return;
    this.dispose(this.current);
    this.current = null;
    this.band.visible = false;
    this.onChange();
  }

  undoPoint() {
    const s = this.current;
    if (!s) return;
    s.points.pop();
    if (!s.points.length) { this.cancel(); return; }
    this.build(s);
    this.onChange();
  }

  remove(id) {
    const k = this.shapes.findIndex((s) => s.id === id);
    if (k < 0) return;
    this.dispose(this.shapes[k]);
    this.shapes.splice(k, 1);
    this.onChange();
  }

  clear() {
    for (const s of this.shapes) this.dispose(s);
    this.shapes.length = 0;
    this.cancel();
    this.onChange();
  }

  setColor(id, color) {
    const s = this.shapes.find((t) => t.id === id);
    if (!s) return;
    s.color = color;
    this.build(s);
  }

  snapRadius() { return 2.5; }

  // --- Geometry --------------------------------------------------------------------------------

  /** Ground (or water surface) height at a grid point, plus the lift. */
  groundY(x, z) {
    const w = this.world, N = w.N;
    const i = Math.min(N - 1, Math.max(0, Math.round(z))) * N + Math.min(N - 1, Math.max(0, Math.round(x)));
    return Math.max(w.sampleHeight(x, z) + w.water[i] * 0.9, w.seaLevel) + LIFT;
  }

  /** Points every half cell along the shape's outline, draped on the ground. */
  drape(points, closed) {
    const out = [];
    const n = points.length, segs = closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const a = points[k], b = points[(k + 1) % n];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 2));
      for (let s = 0; s < steps; s++) {
        const t = s / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        out.push(x, z);
      }
    }
    const last = closed ? points[0] : points[n - 1];
    out.push(last.x, last.z);
    return out;
  }

  /** (Re)build a shape's line, vertex dots, fill and label. */
  build(s) {
    if (s.obj) { this.group.remove(s.obj); disposeObj(s.obj); }
    const obj = new THREE.Group();
    const color = new THREE.Color(s.color);
    const closed = s.closed;
    const pts = s.points;
    if (pts.length >= 2) {
      const d = this.drape(pts, closed);
      // WebGL lines are always 1 px wide, so the line is a ribbon lying on the ground, with a
      // wider dark halo under it so it reads on any colour of ground
      const halo = new THREE.Mesh(this.ribbon(d, 1.5), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35, depthTest: false, side: THREE.DoubleSide }));
      halo.renderOrder = 8;
      const line = new THREE.Mesh(this.ribbon(d, 0.85), new THREE.MeshBasicMaterial({ color, depthTest: false, side: THREE.DoubleSide }));
      line.renderOrder = 9;
      obj.add(halo, line);
    }
    // Vertex markers
    const vp = new Float32Array(pts.length * 3);
    pts.forEach((p, k) => {
      const v = this.renderer.toWorld(p.x, p.z, this.groundY(p.x, p.z));
      vp[k * 3] = v.x; vp[k * 3 + 1] = v.y; vp[k * 3 + 2] = v.z;
    });
    const vg = new THREE.BufferGeometry();
    vg.setAttribute('position', new THREE.BufferAttribute(vp, 3));
    const dots = new THREE.Points(vg, new THREE.PointsMaterial({ color, size: 9, sizeAttenuation: false, depthTest: false }));
    dots.renderOrder = 10;
    obj.add(dots);
    if (closed) obj.add(this.fill(pts, color));
    obj.traverse((o) => { o.frustumCulled = false; });
    s.obj = obj;
    this.group.add(obj);
    s.stats = this.measure(s);
    this.updateLabel(s);
  }

  /** A flat strip `width` cells wide following the draped outline d ([x, z, x, z, …]). */
  ribbon(d, width) {
    const n = d.length / 2, pos = new Float32Array(n * 6), idx = [];
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
      let tx = d[b * 2] - d[a * 2], tz = d[b * 2 + 1] - d[a * 2 + 1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      const x = d[k * 2], z = d[k * 2 + 1], h = width / 2;
      const y = this.groundY(x, z);
      const p = this.renderer.toWorld(x - tz * h, z + tx * h, y), q = this.renderer.toWorld(x + tz * h, z - tx * h, y);
      pos.set([p.x, p.y, p.z, q.x, q.y, q.z], k * 6);
      if (k < n - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  /** Translucent fill draped over every grid cell inside the polygon. */
  fill(pts, color) {
    const w = this.world, N = w.N;
    let x0 = N, x1 = 0, z0 = N, z1 = 0;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    x0 = Math.max(0, Math.floor(x0)); z0 = Math.max(0, Math.floor(z0));
    x1 = Math.min(N - 2, Math.ceil(x1)); z1 = Math.min(N - 2, Math.ceil(z1));
    const pos = [], idx = [];
    const vid = new Map();
    const vert = (x, z) => {
      const key = z * N + x;
      let v = vid.get(key);
      if (v === undefined) {
        const p = this.renderer.toWorld(x, z, this.groundY(x, z) - 0.15);
        v = pos.length / 3;
        pos.push(p.x, p.y, p.z);
        vid.set(key, v);
      }
      return v;
    };
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        if (!inside(pts, x + 0.5, z + 0.5)) continue;
        const a = vert(x, z), b = vert(x + 1, z), c = vert(x, z + 1), d = vert(x + 1, z + 1);
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: drawSettings.fill, depthWrite: false, side: THREE.DoubleSide }));
    m.userData.isFill = true;
    m.visible = drawSettings.fill > 0.001;
    m.renderOrder = 5;
    return m;
  }

  /** Length along the ground, horizontal length, climb, descent, height range and area. */
  measure(s) {
    const pts = s.points, w = this.world;
    if (pts.length < 2) return null;
    const d = this.drape(pts, s.closed);
    let ground = 0, flat = 0, up = 0, down = 0, lo = Infinity, hi = -Infinity;
    let px = d[0], pz = d[1], ph = w.sampleHeight(px, pz);
    lo = hi = ph;
    for (let k = 2; k < d.length; k += 2) {
      const x = d[k], z = d[k + 1], h = w.sampleHeight(x, z);
      const run = Math.hypot(x - px, z - pz), rise = h - ph;
      flat += run; ground += Math.hypot(run, rise);
      if (rise > 0) up += rise; else down -= rise;
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      px = x; pz = z; ph = h;
    }
    let area = 0;
    if (s.closed) {
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        area += a.x * b.z - b.x * a.z;
      }
      area = Math.abs(area) / 2;
    }
    return { ground, flat, up, down, lo, hi, area };
  }

  /** One-line summary of a shape's measurements. */
  describe(s) {
    const m = s.stats;
    if (!m) return 'click to add points';
    const parts = [s.closed ? `perimeter ${m.ground.toFixed(1)}` : `${m.ground.toFixed(1)} long`];
    if (s.closed) parts.push(`area ${m.area.toFixed(0)}`);
    else parts.push(`↑${m.up.toFixed(1)} ↓${m.down.toFixed(1)}`);
    parts.push(`elev ${m.lo.toFixed(0)}–${m.hi.toFixed(0)}`);
    if (s.protected) parts.push('🛡 protected');
    if (s.limited) parts.push('🪓 limited harvest');
    const on = Object.entries(s.restrict || {}).filter(([, v]) => v).length;
    if (on) parts.push(`${on} restriction${on > 1 ? 's' : ''}`);
    return parts.join(' · ');
  }

  updateLabel(s) {
    if (!s.label) {
      s.label = document.createElement('div');
      s.label.className = 'draw-label';
      this.container.append(s.label);
    }
    s.label.innerHTML = `<b style="color:${s.color}">${s.name}</b><br>${this.describe(s)}`;
  }

  dispose(s) {
    if (s.obj) { this.group.remove(s.obj); disposeObj(s.obj); s.obj = null; }
    if (s.label) { s.label.remove(); s.label = null; }
  }

  // --- Per frame -------------------------------------------------------------------------------

  /** Keep lines draped on the changing terrain, move labels, draw the rubber band. */
  /** Apply the polygon transparency setting to every polygon's fill. */
  applyFill() {
    for (const s of this.shapes) if (s.obj) s.obj.traverse((o) => {
      if (o.userData && o.userData.isFill) { o.material.opacity = drawSettings.fill; o.visible = drawSettings.fill > 0.001; }
    });
  }

  update(dt, camera, hover, drawing) {
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0 && this.world.dirty !== undefined) {
      this.refreshTimer = 1.5;
      for (const s of this.shapes) this.build(s);
    }
    // Rubber band
    const cur = this.current;
    if (drawing && cur && cur.points.length && hover) {
      const a = cur.points[cur.points.length - 1];
      const pos = this.band.geometry.attributes.position;
      const n = pos.count;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1), x = a.x + (hover.x - a.x) * t, z = a.z + (hover.z - a.z) * t;
        const p = this.renderer.toWorld(x, z, this.groundY(x, z));
        pos.setXYZ(k, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
      this.band.computeLineDistances();
      this.band.material.color.set(cur.color);
      this.band.visible = true;
    } else this.band.visible = false;
    // Labels follow their shapes on screen
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const all = cur ? [...this.shapes, cur] : this.shapes;
    const v = new THREE.Vector3();
    for (const s of all) {
      if (!s.label) continue;
      if (!drawSettings.labels || !s.points.length) { s.label.style.display = 'none'; continue; }
      // Anchor: the centroid of a polygon, the last point of a path
      let ax, az;
      if (s.closed) { ax = 0; az = 0; for (const p of s.points) { ax += p.x; az += p.z; } ax /= s.points.length; az /= s.points.length; }
      else { const p = s.points[s.points.length - 1]; ax = p.x; az = p.z; }
      v.copy(this.renderer.toWorld(ax, az, this.groundY(ax, az) + 1.5)).project(camera);
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) { s.label.style.display = 'none'; continue; }
      s.label.style.display = '';
      s.label.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px) translate(-50%, -120%)`;
    }
  }
}

/** Even-odd point-in-polygon test. */
function inside(pts, x, z) {
  let c = false;
  for (let k = 0, j = pts.length - 1; k < pts.length; j = k++) {
    const a = pts[k], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

function disposeObj(o) {
  o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose(); });
}
