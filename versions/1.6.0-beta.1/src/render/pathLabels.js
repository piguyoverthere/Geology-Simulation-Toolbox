// Footpath names on the map: written small along the path itself, curving with it as it winds (SVG
// text on a path), the right way up, and repeated along a long trail, one every couple of hundred
// pixels of it on screen, so you can follow a trail by its name wherever you look.

import * as THREE from 'three';

const NS = 'http://www.w3.org/2000/svg';
const FONT = 8;               // px
const CHAR_W = FONT * 0.56;   // rough width of a character (italic, semi-bold)
const GAP = 170;              // px of trail between one label and the next

export class PathLabels {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'path-labels');
    container.append(this.svg);
    this.defs = document.createElementNS(NS, 'defs');
    this.svg.append(this.defs);
    this.pool = [];   // reusable { path, text, tp }
    this.v = new THREE.Vector3();
    this.uid = Math.random().toString(36).slice(2, 7);
  }

  /** A label slot (its curve in <defs>, its text on the map). */
  slot(k) {
    if (this.pool[k]) return this.pool[k];
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('id', `pl-${this.uid}-${k}`);
    this.defs.append(path);
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('class', 'path-label');
    const tp = document.createElementNS(NS, 'textPath');
    tp.setAttribute('href', `#pl-${this.uid}-${k}`);
    tp.setAttribute('startOffset', '50%');
    tp.setAttribute('text-anchor', 'middle');
    text.append(tp);
    this.svg.append(text);
    return (this.pool[k] = { path, text, tp });
  }

  update() {
    const app = this.app, w = app.world, paths = w.footpaths || [];
    const rect = app.gl.domElement.getBoundingClientRect();
    this.svg.setAttribute('width', rect.width);
    this.svg.setAttribute('height', rect.height);
    let used = 0;
    const show = app.renderer.showTrailNames !== false;
    if (show) for (const fp of paths) {
      if (!fp.pts || fp.pts.length < 2 || !fp.name) continue;
      // The trail on screen: projected, gaps where it goes off screen or behind the camera
      const runs = [];
      let run = [];
      const step = fp.pts.length > 400 ? 2 : 1;
      for (let k = 0; k < fp.pts.length; k += step) {
        const p = fp.pts[k];
        this.v.copy(app.renderer.toWorld(p.x, p.z, w.sampleHeight(p.x, p.z) + 0.6)).project(app.camera);
        const on = this.v.z < 1 && Math.abs(this.v.x) < 1.15 && Math.abs(this.v.y) < 1.15;
        if (!on) { if (run.length > 1) runs.push(run); run = []; continue; }
        run.push([((this.v.x + 1) / 2) * rect.width, ((1 - this.v.y) / 2) * rect.height]);
      }
      if (run.length > 1) runs.push(run);
      const textW = fp.name.length * CHAR_W + 6;
      for (const r of runs) {
        const s = smooth(r);
        // cumulative length along it
        const L = [0];
        for (let k = 1; k < s.length; k++) L.push(L[k - 1] + Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1]));
        const total = L[L.length - 1];
        if (total < textW + 8) continue; // (too short on screen to write along)
        // As many labels as fit, spaced evenly along it
        const n = Math.max(1, Math.floor((total + GAP) / (textW + GAP)));
        const spacing = total / n;
        for (let j = 0; j < n; j++) {
          const c = spacing * (j + 0.5);
          const piece = slice(s, L, c - textW / 2 - 4, c + textW / 2 + 4);
          if (piece.length < 2) continue;
          // (kept the right way up: written left to right)
          if (piece[piece.length - 1][0] < piece[0][0]) piece.reverse();
          const sl = this.slot(used++);
          sl.path.setAttribute('d', 'M' + piece.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L'));
          if (sl.tp.textContent !== fp.name) sl.tp.textContent = fp.name;
          sl.text.style.display = '';
        }
      }
    }
    for (let k = used; k < this.pool.length; k++) this.pool[k].text.style.display = 'none';
  }
}

/** Smooth a screen polyline (the trail steps cell by cell): a few passes of neighbour averaging. */
function smooth(pts) {
  let a = pts.map((p) => [p[0], p[1]]);
  for (let pass = 0; pass < 3; pass++) {
    const b = a.map((p) => [p[0], p[1]]);
    for (let k = 1; k < a.length - 1; k++) {
      b[k][0] = (a[k - 1][0] + 2 * a[k][0] + a[k + 1][0]) / 4;
      b[k][1] = (a[k - 1][1] + 2 * a[k][1] + a[k + 1][1]) / 4;
    }
    a = b;
  }
  return a;
}

/** The part of polyline `s` (with cumulative lengths L) between lengths a and b. */
function slice(s, L, a, b) {
  const total = L[L.length - 1];
  a = Math.max(0, a); b = Math.min(total, b);
  const at = (d) => {
    let k = 1;
    while (k < L.length - 1 && L[k] < d) k++;
    const t = (d - L[k - 1]) / Math.max(1e-6, L[k] - L[k - 1]);
    return [s[k - 1][0] + (s[k][0] - s[k - 1][0]) * t, s[k - 1][1] + (s[k][1] - s[k - 1][1]) * t];
  };
  const out = [at(a)];
  for (let k = 0; k < s.length; k++) if (L[k] > a && L[k] < b) out.push(s[k]);
  out.push(at(b));
  return out;
}
