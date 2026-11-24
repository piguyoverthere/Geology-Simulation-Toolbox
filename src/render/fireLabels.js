// Names of the big wildfires, over the middle of the ground each burnt: shown only with the
// Historic wildfires overlay. Small fires are numbered but get no label.

import * as THREE from 'three';

export class FireLabels {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.labels = new Map(); // fire id → element
    this.v = new THREE.Vector3();
  }

  update() {
    const app = this.app, w = app.world;
    const on = app.renderer.colorMode === 'fires';
    const fires = on ? (w.fireLog || []).filter((f) => f.name && f.cells) : [];
    const seen = new Set();
    const rect = app.gl.domElement.getBoundingClientRect();
    for (const f of fires) {
      seen.add(f.id);
      let el = this.labels.get(f.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'fire-label';
        this.container.append(el);
        this.labels.set(f.id, el);
      }
      const x = f.sx / f.cells, z = f.sz / f.cells;
      const p = app.renderer.toWorld(x, z, Math.max(w.sampleHeight(x, z), w.seaLevel > -999 ? w.seaLevel : -1e9) + 3);
      this.v.copy(p).project(app.camera);
      const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      el.hidden = !visible;
      if (!visible) continue;
      el.style.left = `${((this.v.x + 1) / 2) * rect.width}px`;
      el.style.top = `${((1 - this.v.y) / 2) * rect.height}px`;
      const text = `${f.active ? '🔥' : ''}${f.name} · #${f.id} · year ${f.year}${f.endYear && f.endYear !== f.year ? `–${f.endYear}` : ''} · ${f.cells} cells`;
      if (el.textContent !== text) el.textContent = text;
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) { el.remove(); this.labels.delete(id); }
  }
}
