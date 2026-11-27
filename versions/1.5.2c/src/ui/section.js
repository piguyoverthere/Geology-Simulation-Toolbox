// Cross-section panel: a geological slice along a line across the map. Every point underground is
// coloured by the rock found there (the same lookup the simulation uses: strata, folds, intrusions,
// lava and ash), with the soil, snow, glacier ice and water drawn on top, and a height scale.

import { ROCKS } from '../core/rocks.js';

const W = 460, Hpx = 190, PAD_L = 34, PAD_B = 18, PAD_T = 8;

export class CrossSection {
  constructor(container, app) {
    this.app = app;
    const el = document.createElement('div');
    el.className = 'section-panel';
    el.hidden = true;
    const head = document.createElement('div');
    head.className = 'section-head';
    this.title = document.createElement('span');
    const close = document.createElement('button');
    close.textContent = '✕';
    close.title = 'Close';
    close.addEventListener('click', () => { el.hidden = true; });
    head.append(this.title, close);
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = Hpx;
    el.append(head, this.canvas);
    container.append(el);
    this.el = el;
  }

  /** Slice from grid point a to b. */
  show(a, b) {
    if (!a || !b) return;
    const w = this.app.world, N = w.N;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 2) return;
    this.el.hidden = false;
    const cols = W - PAD_L;
    // Sample the line
    const S = [];
    let top = -Infinity, bottom = Infinity;
    for (let c = 0; c < cols; c++) {
      const t = c / (cols - 1), x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const i = Math.min(N - 1, Math.max(0, Math.round(z))) * N + Math.min(N - 1, Math.max(0, Math.round(x)));
      const ground = w.sampleHeight(x, z);
      const ice = w.ice ? w.ice[i] : 0, snow = w.snow ? w.snow[i] * 0.25 : 0, water = w.water[i];
      const soil = w.vegetation[i] > 0.05 ? 0.3 + 1.2 * w.humus[i] : 0; // soil depth under plants
      S.push({ i, ground, ice, snow, water, soil });
      top = Math.max(top, ground + ice + snow + water);
      bottom = Math.min(bottom, ground);
    }
    const sea = w.seaLevel > -999 ? w.seaLevel : null;
    if (sea !== null) top = Math.max(top, sea);
    // Show some depth below the lowest point, so the layers can be read
    const relief = Math.max(8, top - bottom);
    const yTop = top + relief * 0.08, yBot = bottom - relief * 0.45;
    const plotH = Hpx - PAD_B - PAD_T;
    const toPx = (e) => PAD_T + ((yTop - e) / (yTop - yBot)) * plotH;
    const ctx = this.canvas.getContext('2d');
    const img = ctx.createImageData(W, Hpx);
    const put = (x, y, c) => { const o = (y * W + x) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; };
    const rgb = (c) => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
    const rockRGB = ROCKS.map((r) => rgb(r.color));
    const SKY = [236, 241, 246], SOIL = [104, 78, 52], SNOW = [252, 253, 255], ICE = [168, 208, 238], WATER = [70, 130, 190];
    for (let c = 0; c < cols; c++) {
      const s = S[c], px = PAD_L + c;
      for (let y = PAD_T; y < PAD_T + plotH; y++) {
        const e = yTop - ((y - PAD_T) / plotH) * (yTop - yBot);
        let col;
        if (e > s.ground) {
          const above = e - s.ground;
          if (above <= s.ice) col = ICE;
          else if (above <= s.ice + s.snow) col = SNOW;
          else if (above <= s.ice + s.snow + s.water || (sea !== null && e <= sea)) col = WATER;
          else col = SKY;
        } else if (s.ground - e < s.soil) {
          col = SOIL;
        } else {
          col = rockRGB[w.rockAt(e, s.i)] || [128, 128, 128];
        }
        put(px, y, col);
      }
    }
    ctx.putImageData(img, 0, 0);
    // Ground line and frame
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let c = 0; c < cols; c++) { const y = toPx(S[c].ground); c ? ctx.lineTo(PAD_L + c, y) : ctx.moveTo(PAD_L + c, y); }
    ctx.stroke();
    // Height scale
    ctx.fillStyle = '#c9d0d8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    const step = niceStep((yTop - yBot) / 5);
    for (let e = Math.ceil(yBot / step) * step; e <= yTop; e += step) {
      const y = toPx(e);
      ctx.fillText(e.toFixed(step < 1 ? 1 : 0), PAD_L - 4, y + 3);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(PAD_L, y, cols, 1); ctx.fillStyle = '#c9d0d8';
    }
    ctx.textAlign = 'left';
    ctx.fillText(`0`, PAD_L, Hpx - 4);
    ctx.textAlign = 'right';
    ctx.fillText(`${len.toFixed(0)} cells`, W - 4, Hpx - 4);
    const exag = (cols / len) / (plotH / (yTop - yBot));
    this.title.textContent = `Cross-section · ${len.toFixed(0)} cells long · vertical ×${(1 / exag).toFixed(1)}`;
  }
}

function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 0.01))));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
