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
    const fires = on ? (w.fireLog || []).filter((f) => f.name && f.cells).sort((a, b) => b.cells - a.cells) : [];
    const placed = []; // (labels already shown: a smaller fire's label that would overlap one is hidden)
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
      const size = f.cells >= 1000 ? `${(f.cells / 1000).toFixed(f.cells >= 10000 ? 0 : 1)}k` : `${f.cells}`;
      const text = `${f.active ? '🔥' : ''}${f.name} · #${f.id} · yr ${f.year}${f.endYear && f.endYear !== f.year ? `–${f.endYear}` : ''} · ${size} cells`;
      const px = ((this.v.x + 1) / 2) * rect.width, py = ((1 - this.v.y) / 2) * rect.height;
      // (estimated box: centred above the point, about 6 px a character, 18 px tall, with a margin)
      const hw = text.length * 3.1 + 10, box = [px - hw, py - 20, px + hw, py + 2];
      const clash = placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      el.hidden = !visible || clash;
      if (el.hidden) continue;
      placed.push(box);
      el.style.left = `${px}px`;
      el.style.top = `${py}px`;
      if (el.textContent !== text) el.textContent = text;
      el.title = `Fire #${f.id}: ${f.cells} cells burnt`;
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) { el.remove(); this.labels.delete(id); }
  }
}
