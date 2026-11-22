// Animals on the map: small coloured dots scattered where each population lives, more where there
// are more of them (deer herds, wolf packs, beaver lodges, schools of fish, otter rafts). Bark
// beetles show as dying red-grey forest and salmon runs as reddened rivers, in the terrain colours.

import * as THREE from 'three';
import { SPECIES_ECO } from '../sim/ecology.js';

const SHOWN = { deer: 220, wolves: 60, beaver: 50, fish: 160, otter: 60 }; // most dots per kind

export class WildlifeMarkers {
  constructor(scene, world, renderer) {
    this.world = world;
    this.renderer = renderer;
    this.max = Object.values(SHOWN).reduce((a, b) => a + b, 0);
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, sizeAttenuation: true }));
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.visible = true;
    this.timer = 0;
  }

  update(dt) {
    this.points.visible = this.visible;
    if (!this.visible) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.6;
    const w = this.world, N = w.N, n = N * N;
    if (!w.deer) { this.points.geometry.setDrawRange(0, 0); return; }
    const sea = w.meanSea !== undefined && w.meanSea > -999 ? w.seaLevel : -1e9;
    let c = 0;
    for (const s of SPECIES_ECO) {
      const cap = SHOWN[s.id];
      if (!cap) continue;
      const F = w[s.id];
      let placed = 0;
      for (let t = 0; t < cap * 30 && placed < cap; t++) {
        const i = (Math.random() * n) | 0;
        if (Math.random() > F[i] * 0.6) continue;
        const x = (i % N) + Math.random() - 0.5, z = ((i / N) | 0) + Math.random() - 0.5;
        const y = Math.max(w.sampleHeight(x, z), sea) + 0.7;
        const p = this.renderer.toWorld(x, z, y);
        this.pos[c * 3] = p.x; this.pos[c * 3 + 1] = p.y; this.pos[c * 3 + 2] = p.z;
        // (colours are linear, as for the terrain: square them)
        this.col[c * 3] = s.color[0] ** 2; this.col[c * 3 + 1] = s.color[1] ** 2; this.col[c * 3 + 2] = s.color[2] ** 2;
        c++; placed++;
      }
    }
    const g = this.points.geometry;
    g.setDrawRange(0, c);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}
