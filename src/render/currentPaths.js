// Drawn ocean currents (the Current path tool).
//
// Click points across the sea to lay out a path; Enter or a double-click finishes it, clicking the
// first point again closes it into a loop (an eddy that circulates for ever), Backspace takes the
// last point back and Escape cancels. Shift-click removes the path nearest the click.
//
// Each path is kept in world.currentPaths ({ pts, closed, strength, width }, saved with the level)
// and drives a constant current along it in the sea (sim/ocean.js), on top of the tides and wind.
// It's shown on the water as a ribbon of dashes flowing along the path, with arrowheads.

import * as THREE from 'three';

export class CurrentPaths {
  constructor(scene, world, renderer) {
    this.scene = scene;
    this.world = world;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.draft = null;      // the path being drawn: { pts, strength, width }
    this.draftObj = null;
    this.built = [];        // per finished path: { line, arrows }
    this.lineMat = new THREE.LineDashedMaterial({ color: 0xbff4ff, dashSize: 2.2, gapSize: 1.6, transparent: true, opacity: 0.95, depthWrite: false });
    this.draftMat = new THREE.LineBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.95, depthWrite: false });
    this.arrowGeo = new THREE.ConeGeometry(0.9, 2.4, 8);
    this.arrowGeo.rotateX(Math.PI / 2); // point along +z
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.9, depthWrite: false });
    this.key = '';
    this.flow = 0;
  }

  get paths() {
    if (!this.world.currentPaths) this.world.currentPaths = [];
    return this.world.currentPaths;
  }

  /** Click with the tool at grid point p (shift: remove the nearest path). */
  click(p, shift, strength, width) {
    if (shift) { this.removeNear(p); return; }
    if (!this.draft) this.draft = { pts: [], strength, width };
    const pts = this.draft.pts;
    // Clicking the first point closes the path into a loop (an eddy)
    if (pts.length >= 3 && Math.hypot(p.x - pts[0].x, p.z - pts[0].z) < 3) { this.finish(true); return; }
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.3) return; // (a double-click repeats a point)
    pts.push({ x: p.x, z: p.z });
    this.buildDraft();
  }

  finish(closed = false) {
    const d = this.draft;
    this.draft = null;
    this.clearDraft();
    if (!d || d.pts.length < 2) return;
    this.paths.push({ pts: d.pts, closed, strength: d.strength, width: d.width });
    this.world.currentPathsChanged = true;
  }

  cancel() { this.draft = null; this.clearDraft(); }

  undoPoint() {
    if (!this.draft) return;
    this.draft.pts.pop();
    if (!this.draft.pts.length) { this.cancel(); return; }
    this.buildDraft();
  }

  removeNear(p) {
    const list = this.paths;
    let best = -1, bd = 12;
    list.forEach((c, k) => {
      const n = c.pts.length;
      for (let s = 0; s < n - 1 + (c.closed ? 1 : 0); s++) {
        const a = c.pts[s], b = c.pts[(s + 1) % n];
        const d = segDist(p.x, p.z, a.x, a.z, b.x, b.z);
        if (d < bd) { bd = d; best = k; }
      }
    });
    if (best >= 0) { list.splice(best, 1); this.world.currentPathsChanged = true; }
  }

  // --- Drawing on the map ----------------------------------------------------------------------

  /** Height to draw at: on the water (above high tide) or just above the ground on land. */
  y(x, z) {
    const w = this.world, sea = w.meanSea !== undefined && w.meanSea > -999 ? w.meanSea + 1.9 : -1e9;
    return Math.max(w.sampleHeight(x, z) + 0.4, sea);
  }

  /** Densified points along a path (every ~1.5 cells). */
  dense(pts, closed) {
    const out = [];
    const n = pts.length, segs = n - 1 + (closed ? 1 : 0);
    for (let s = 0; s < segs; s++) {
      const a = pts[s], b = pts[(s + 1) % n];
      const len = Math.hypot(b.x - a.x, b.z - a.z), k = Math.max(1, Math.ceil(len / 1.5));
      for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, z: a.z + ((b.z - a.z) * j) / k });
    }
    const end = closed ? pts[0] : pts[n - 1];
    out.push({ x: end.x, z: end.z });
    return out;
  }

  lineFor(pts, closed, mat) {
    const d = this.dense(pts, closed);
    const pos = new Float32Array(d.length * 3);
    d.forEach((p, k) => {
      const v = this.renderer.toWorld(p.x, p.z, this.y(p.x, p.z));
      pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const line = new THREE.Line(g, mat);
    line.computeLineDistances();
    line.renderOrder = 5;
    return { line, d };
  }

  buildDraft() {
    this.clearDraft();
    if (!this.draft || this.draft.pts.length < 1) return;
    const pts = this.draft.pts.length === 1 ? [this.draft.pts[0], { x: this.draft.pts[0].x + 0.01, z: this.draft.pts[0].z }] : this.draft.pts;
    this.draftObj = this.lineFor(pts, false, this.draftMat).line;
    this.group.add(this.draftObj);
  }

  clearDraft() {
    if (this.draftObj) { this.group.remove(this.draftObj); this.draftObj.geometry.dispose(); this.draftObj = null; }
  }

  rebuild() {
    for (const b of this.built) {
      this.group.remove(b.line); b.line.geometry.dispose();
      for (const a of b.arrows) this.group.remove(a);
    }
    this.built = [];
    for (const c of this.paths) {
      const { line, d } = this.lineFor(c.pts, c.closed, this.lineMat);
      this.group.add(line);
      // Arrowheads every ~10 cells, pointing downstream
      const arrows = [];
      let acc = 0;
      for (let k = 1; k < d.length; k++) {
        acc += Math.hypot(d[k].x - d[k - 1].x, d[k].z - d[k - 1].z);
        if (acc < 10) continue;
        acc = 0;
        const a = new THREE.Mesh(this.arrowGeo, this.arrowMat);
        const p = this.renderer.toWorld(d[k].x, d[k].z, this.y(d[k].x, d[k].z) + 0.2);
        const q = this.renderer.toWorld(d[k].x + (d[k].x - d[k - 1].x), d[k].z + (d[k].z - d[k - 1].z), p.y);
        a.position.copy(p);
        a.lookAt(q.x, p.y, q.z);
        a.scale.setScalar(0.7 + 0.5 * Math.min(2, c.strength));
        a.renderOrder = 5;
        this.group.add(a);
        arrows.push(a);
      }
      this.built.push({ line, arrows });
    }
  }

  /** Per frame: rebuild when the paths or the sea change, and make the dashes flow. */
  update(dt) {
    const w = this.world;
    const key = `${this.paths.length}:${this.paths.map((c) => c.pts.length + (c.closed ? 'c' : '')).join(',')}:${Math.round((w.meanSea ?? -1e9) * 4)}:${w.N}`;
    if (key !== this.key || w.currentPathsChanged) {
      this.key = key;
      w.currentPathsChanged = false;
      w.currentFieldKey = null; // (the sim rebuilds its current field)
      this.rebuild();
    }
    // Dashes stream along the path (LineDashedMaterial has no offset: shift the distances)
    this.flow = (this.flow + dt * 3) % 3.8;
    for (const b of this.built) {
      const ld = b.line.geometry.getAttribute('lineDistance');
      if (!ld) continue;
      if (!b.base) b.base = Float32Array.from(ld.array);
      for (let k = 0; k < ld.count; k++) ld.array[k] = b.base[k] - this.flow;
      ld.needsUpdate = true;
    }
  }
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
