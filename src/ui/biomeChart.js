// Biomes chart: a small window at the top right of the map with the share of the land in each
// biome (the same categories as the Biomes overlay and the inspector), as one stacked bar and a
// sorted list. Collapsed to its title until opened; while open it refreshes every couple of seconds.

import { BIOMES, classifyBiome } from '../render/biomes.js';

const rgb = (c) => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

/** Share of the land in each biome (0…1), and the sea's share of the map. */
export function biomeShares(world) {
  const N = world.N, H = world.height;
  const sea = world.meanSea !== undefined && world.meanSea > -999 ? world.meanSea : -1e9;
  const count = {};
  let land = 0, seaN = 0;
  for (let z = 0; z < N; z += 2) for (let x = 0; x < N; x += 2) { // (every fourth cell is plenty)
    const i = z * N + x;
    if (H[i] < sea) { seaN++; continue; }
    const gx = (H[x < N - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * 0.5;
    const gz = (H[z < N - 1 ? i + N : i] - H[z > 0 ? i - N : i]) * 0.5;
    const b = classifyBiome(world, i, Math.sqrt(gx * gx + gz * gz));
    count[b] = (count[b] || 0) + 1;
    land++;
  }
  const shares = Object.entries(count).map(([id, c]) => ({ id, share: c / Math.max(1, land) })).sort((a, b) => b.share - a.share);
  return { shares, sea: seaN / Math.max(1, land + seaN) };
}

export class BiomeChart {
  constructor(app, parent) {
    this.app = app;
    const win = (this.win = document.createElement('div'));
    win.className = 'biome-win';
    const head = document.createElement('button');
    head.className = 'graph-head';
    this.body = document.createElement('div');
    this.body.className = 'biome-body';
    let open = false;
    try { open = localStorage.getItem('geo.biomes') === '1'; } catch { /* storage blocked */ }
    this.setOpen = (o) => {
      this.open = o; this.body.hidden = !o; win.classList.toggle('open', o);
      head.textContent = o ? '🌍 Biomes ▾' : '🌍 Biomes ▸';
      try { localStorage.setItem('geo.biomes', o ? '1' : '0'); } catch { /* storage blocked */ }
      if (o) this.update();
    };
    head.title = 'How much of the land is in each biome (as in the Biomes overlay).';
    head.addEventListener('click', () => this.setOpen(!this.open));
    win.append(head, this.body);
    parent.append(win);
    this.setOpen(open);
  }

  /** Recount and redraw (only while open). */
  update() {
    if (!this.open) return;
    const { shares, sea } = biomeShares(this.app.world);
    const body = this.body;
    body.textContent = '';
    const bar = document.createElement('div');
    bar.className = 'biome-stack';
    for (const s of shares) {
      const b = BIOMES[s.id];
      if (!b || s.share < 0.002) continue;
      const seg = document.createElement('span');
      seg.style.width = `${s.share * 100}%`;
      seg.style.background = rgb(b.color);
      seg.title = `${b.label}: ${(s.share * 100).toFixed(1)}%`;
      bar.append(seg);
    }
    body.append(bar);
    for (const s of shares) {
      const b = BIOMES[s.id];
      if (!b) continue;
      const pct = s.share * 100;
      const row = document.createElement('div');
      row.className = 'biome-row';
      row.title = b.help || '';
      row.innerHTML = `<span class="biome-sw" style="background:${rgb(b.color)}"></span><span class="biome-name"></span>` +
        `<span class="biome-bar"><span style="width:${Math.min(100, pct)}%;background:${rgb(b.color)}"></span></span><span class="biome-pct">${pct < 0.1 ? '<0.1' : pct.toFixed(1)}%</span>`;
      row.querySelector('.biome-name').textContent = b.label;
      body.append(row);
    }
    const note = document.createElement('div');
    note.className = 'biome-note';
    note.textContent = sea > 0 ? `Share of the land · the sea covers ${Math.round(sea * 100)}% of the map` : 'Share of the land';
    body.append(note);
  }
}
