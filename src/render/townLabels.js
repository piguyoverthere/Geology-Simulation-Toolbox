// Town names on the map: a small label over each town with its name and population, kept in place
// over the town as the camera moves.

import * as THREE from 'three';

export class TownLabels {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.labels = new Map(); // town id → element
    this.v = new THREE.Vector3();
  }

  update() {
    const app = this.app, w = app.world, towns = w.towns || [];
    const seen = new Set();
    const rect = app.gl.domElement.getBoundingClientRect();
    for (const t of towns) {
      seen.add(t.id);
      let el = this.labels.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'town-label';
        this.container.append(el);
        this.labels.set(t.id, el);
      }
      const p = app.renderer.toWorld(t.x, t.z, Math.max(w.sampleHeight(t.x, t.z), w.seaLevel > -999 ? w.seaLevel : -1e9) + 4);
      this.v.copy(p).project(app.camera);
      const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      el.hidden = !visible;
      if (!visible) continue;
      el.style.left = `${((this.v.x + 1) / 2) * rect.width}px`;
      el.style.top = `${((1 - this.v.y) / 2) * rect.height}px`;
      const pop = Math.round(t.pop);
      const text = `${t.name} · ${pop >= 1000 ? (pop / 1000).toFixed(1) + 'k' : pop}${t.sick > 0.01 ? ' 🤒' : ''}${t.woodSupply < 0.9 ? ' 🪵' : ''}${t.smoky ? ' 😷' : ''}`;
      if (el.textContent !== text) el.textContent = text;
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) { el.remove(); this.labels.delete(id); }
  }
}
