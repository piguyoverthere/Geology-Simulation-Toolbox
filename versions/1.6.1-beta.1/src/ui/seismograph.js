// The seismograph window (bottom right of the map): the ground-motion trace scrolling past like a
// drum recorder, and the latest shocks with their magnitudes (sim/seismo.js). Click a shock to
// look at where it happened.

import { trace, quakeKindLabel } from '../sim/seismo.js';

export class Seismograph {
  constructor(app, parent) {
    this.app = app;
    const win = (this.win = document.createElement('div'));
    win.className = 'seismo-win';
    const head = document.createElement('button');
    head.className = 'graph-head';
    this.body = document.createElement('div');
    this.body.className = 'seismo-body';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'seismo-trace';
    this.list = document.createElement('div');
    this.list.className = 'seismo-list';
    this.body.append(this.canvas, this.list);
    win.append(head, this.body);
    parent.append(win);
    head.title = 'A record of the ground shaking: earthquakes, faults slipping, eruptions, landslides and collapsing sea cliffs, with their magnitudes. Between them, volcanic tremor while a volcano erupts and the hum of storm waves on the coast.';
    let open = false;
    try { open = localStorage.getItem('geo.seismo') === '1'; } catch { /* storage blocked */ }
    this.setOpen = (o) => {
      this.open = o; this.body.hidden = !o; win.classList.toggle('open', o); parent.classList.toggle('seismo-open', o); // (the biome window keeps clear of it)
      head.textContent = o ? '〰 Seismograph ▾' : '〰 Seismograph ▸';
      try { localStorage.setItem('geo.seismo', o ? '1' : '0'); } catch { /* storage blocked */ }
      if (o) { this.lastCount = -1; this.draw(); }
    };
    head.addEventListener('click', () => this.setOpen(!this.open));
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-x]');
      if (row && this.app.focusOn) this.app.focusOn(+row.dataset.x, +row.dataset.z);
    });
    this.setOpen(open);
  }

  /** Each frame while open: redraw the trace (and the list when a shock is logged). */
  draw() {
    if (!this.open) return;
    const cv = this.canvas, dpr = window.devicePixelRatio || 1, W = 300, Hh = 86;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = Hh * dpr; cv.style.width = W + 'px'; cv.style.height = Hh + 'px'; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#f3efe4'; g.fillRect(0, 0, W, Hh); // (the paper)
    g.strokeStyle = 'rgba(80,90,110,0.18)'; g.lineWidth = 1;
    for (let y = 0; y <= Hh; y += Hh / 6) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
    for (let x = 0; x <= W; x += 30) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, Hh); g.stroke(); }
    // The trace, newest at the right
    const n = Math.min(trace.len, W * 2), mid = Hh / 2;
    g.strokeStyle = '#1b1f2a'; g.lineWidth = 1; g.beginPath();
    for (let k = 0; k < n; k++) {
      const v = trace.v[(trace.head - (n - 1 - k) + trace.len) % trace.len];
      const x = (k / (n - 1)) * W, y = mid - Math.max(-1, Math.min(1, v)) * (mid - 3);
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    g.fillStyle = '#c0392b'; g.beginPath(); g.arc(W - 2, mid - Math.max(-1, Math.min(1, trace.v[trace.head])) * (mid - 3), 2.2, 0, Math.PI * 2); g.fill(); // (the pen)
    const log = this.app.world.quakeLog || [];
    if (log.length === this.lastCount && this.lastWorld === this.app.world) return;
    this.lastCount = log.length; this.lastWorld = this.app.world;
    const status = [];
    if (trace.tremor > 0.05) status.push('volcanic tremor');
    if (trace.storm > 0.08) status.push('storm microseism');
    this.list.innerHTML = (log.length ? log.slice(-8).reverse().map((q) => `<div class="seismo-row" data-x="${q.x}" data-z="${q.z}" title="Click to look there"><b class="m${q.M >= 6 ? ' big' : ''}">M ${q.M.toFixed(1)}</b> ${quakeKindLabel(q.kind)}${q.tsunami ? ' · tsunami' : ''}<span>yr ${Math.floor(q.year)}</span></div>`).join('')
      : '<div class="seismo-none">No shocks recorded yet.</div>') + (status.length ? `<div class="seismo-none">Now: ${status.join(', ')}</div>` : '');
  }
}
