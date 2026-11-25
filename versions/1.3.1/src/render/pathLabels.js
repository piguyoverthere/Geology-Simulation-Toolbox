// Footpath names on the map: each footpath's name written small along the path itself, at its middle,
// turned to run the way the path runs on screen (and kept the right way up).

import * as THREE from 'three';

export class PathLabels {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.labels = new Map(); // footpath id → element
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.c = new THREE.Vector3();
  }

  update() {
    const app = this.app, w = app.world, paths = w.footpaths || [];
    const seen = new Set();
    const rect = app.gl.domElement.getBoundingClientRect();
    const toScreen = (v, p) => {
      v.copy(app.renderer.toWorld(p.x, p.z, w.sampleHeight(p.x, p.z) + 0.6)).project(app.camera);
      return v;
    };
    for (const fp of paths) {
      if (!fp.pts || fp.pts.length < 2) continue;
      seen.add(fp.id);
      let el = this.labels.get(fp.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'path-label';
        this.container.append(el);
        this.labels.set(fp.id, el);
      }
      const m = Math.floor(fp.pts.length / 2), k = Math.max(1, Math.min(4, Math.floor(fp.pts.length / 4)));
      const pa = fp.pts[Math.max(0, m - k)], pb = fp.pts[Math.min(fp.pts.length - 1, m + k)];
      const mid = toScreen(this.c, fp.pts[m]);
      const visible = mid.z < 1 && Math.abs(mid.x) < 1.1 && Math.abs(mid.y) < 1.1;
      el.hidden = !visible || app.renderer.showTrailNames === false;
      if (el.hidden) continue;
      toScreen(this.a, pa); toScreen(this.b, pb);
      const ax = ((this.a.x + 1) / 2) * rect.width, ay = ((1 - this.a.y) / 2) * rect.height;
      const bx = ((this.b.x + 1) / 2) * rect.width, by = ((1 - this.b.y) / 2) * rect.height;
      let ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      if (ang > 90) ang -= 180; else if (ang < -90) ang += 180; // (never upside down)
      el.style.left = `${((mid.x + 1) / 2) * rect.width}px`;
      el.style.top = `${((1 - mid.y) / 2) * rect.height}px`;
      el.style.transform = `translate(-50%, -50%) rotate(${ang.toFixed(1)}deg)`;
      if (el.textContent !== fp.name) el.textContent = fp.name;
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) { el.remove(); this.labels.delete(id); }
  }
}
