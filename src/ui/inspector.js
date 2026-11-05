// Readout for the Inspect tool: everything the simulation knows about the cell under the cursor.

import { BIOMES, classifyBiome } from '../render/biomes.js';
import { waterParams } from '../sim/water.js';
import { ROCKS, PROVINCES, ROCK_INDEX } from '../core/rocks.js';

export class Inspector {
  /** @param {HTMLElement} root  @param {object} app */
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.root.hidden = true;
  }

  /** Show data for the grid position `hit` ({x, z}), or hide when null. */
  update(hit) {
    if (!hit) { this.root.hidden = true; return; }
    const app = this.app, w = app.world, N = w.N, H = w.height;
    const x = Math.min(N - 1, Math.max(0, Math.round(hit.x)));
    const z = Math.min(N - 1, Math.max(0, Math.round(hit.z)));
    const i = z * N + x;
    const h = H[i];

    const gx = (H[x < N - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * 0.5;
    const gz = (H[z < N - 1 ? i + N : i] - H[z > 0 ? i - N : i]) * 0.5;
    const slope = Math.sqrt(gx * gx + gz * gz);
    const biome = BIOMES[classifyBiome(w, i, slope, app.renderer.snowLine)];

    const depth = w.water[i];
    const speed = Math.hypot(w.velX[i], w.velZ[i]);
    let lastWater;
    if (depth > 0.05) lastWater = speed > 0.4 ? 'now (flowing)' : 'now (standing)';
    else if (waterParams.rain > 0) lastWater = 'now (rain)';
    else if (w.lastWet[i] < 0) lastWater = 'never';
    else lastWater = `${fmtTime(w.time - w.lastWet[i])} ago`;

    const v = w.vegetation[i];
    const cover = v > 0.66 ? 'forest' : v > 0.33 ? 'grassland' : 'barren';
    const change = h - w.baseline[i];
    const sea = w.seaLevel > -999;
    const swatch = rgb(biome.color);
    const rock = ROCKS[w.rockAt(h, i)];

    const rows = [
      ['Altitude', `${h.toFixed(1)}${sea ? ` <span class="ins-dim">(${(h - w.seaLevel) >= 0 ? '+' : ''}${(h - w.seaLevel).toFixed(1)} vs sea)</span>` : ''}`],
      ['Slope', `${(Math.atan(slope) * 180 / Math.PI).toFixed(0)}°`],
      ['Soil wetness', bar(w.soil ? w.soil[i] : 0, '#4f8ce0')],
      ['Climate', bar(w.moisture ? w.moisture[i] : 0, '#7fa7d6')],
      ['Last watered', lastWater],
      ...(w.lava[i] > 0.01 ? [['Lava', `<span style="color:#ff8a4a">${w.lava[i].toFixed(2)} thick · ${Math.round(w.lavaTemp[i] * 100)}% hot</span>`]] : []),
      ['Surface water', depth > 0.005 ? `${depth.toFixed(2)} deep · ${speed.toFixed(1)} speed` : 'dry'],
      ['Sediment load', w.sediment[i] > 0.001 ? w.sediment[i].toFixed(3) : '—'],
      ['Plant cover', `${bar(v, '#4caf50')} <span class="ins-dim">${cover}</span>`],
      ...(v > 0.6 ? [['Forest age', `${bar(w.forestAge[i], '#2e7d32')} <span class="ins-dim">${w.forestAge[i] > 0.75 ? 'old growth' : w.forestAge[i] > 0.35 ? 'mature' : 'young'}</span>`]] : []),
      ['Soil depth', bar(w.humus[i], '#8a6a45')],
      ['Bare rock', bar(w.bareExposure(i, slope), '#b0a090')],
      ...(w.fire[i] > 0 ? [['Fire', `<span style="color:#ff8a4a">burning · ${Math.round(w.fire[i] * 100)}% intensity</span>`]] : []),
      ...(w.burnt[i] > 0.01 ? [['Burnt', `${bar(w.burnt[i], '#777')} <span class="ins-dim">ash</span>`]] : []),
      ...(w.freshRock[i] > 0.01 ? [['Fresh rock', `${bar(w.freshRock[i], '#ff8a4a')} <span class="ins-dim">no soil yet</span>`]] : []),
      ['Bedrock', `<span class="tb-swatch ins-swatch" style="background:${rgb(rock.color)}"></span>${rock.label}`],
      ['Formation', `<span class="ins-dim">${formation(w, i, h)}</span>`],
      ['Rock hardness', w.rocksEnabled ? bar(w.hardnessAt(h, i), '#b0a090') : 'uniform'],
      ['Erodibility', `${w.erodibilityAt(h, i).toFixed(2)}×`],
      ['Since baseline', `<span style="color:${change < -0.05 ? 'var(--erode)' : change > 0.05 ? 'var(--deposit)' : 'inherit'}">${change >= 0 ? '+' : ''}${change.toFixed(2)}</span> ${change < -0.05 ? 'eroded' : change > 0.05 ? 'deposited' : ''}`],
    ];

    this.root.innerHTML =
      `<div class="ins-head"><span class="tb-swatch" style="background:${swatch}"></span><b>${biome.label}</b>` +
      `<span class="ins-dim">cell ${x}, ${z}</span></div>` +
      `<table>${rows.map(([k, val]) => `<tr><th>${k}</th><td>${val}</td></tr>`).join('')}</table>` +
      `<div class="ins-foot">Sim time ${fmtTime(w.time)}</div>`;
    this.root.hidden = false;
  }
}

/** Where the exposed rock came from: a lava flow, ash fall, an intrusion, or the original bedrock. */
function formation(w, i, h) {
  const s = w.surfaceRock[i];
  if (s >= 0 && h > w.surfaceBase[i] + 1e-3) return s === ROCK_INDEX.tuff ? 'Ash fall' : 'Lava flow';
  if (w.intrusionRock[i] >= 0 && h <= w.intrusionTop[i]) return w.intrusionTop[i] === Infinity ? 'Dike' : 'Pluton';
  return PROVINCES[w.province[i]];
}

function rgb(c) { return `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`; }

function bar(t, color) {
  const pct = Math.round(Math.min(1, Math.max(0, t)) * 100);
  return `<span class="ins-bar"><span style="width:${pct}%;background:${color}"></span></span> ${pct}%`;
}

function fmtTime(s) {
  if (s < 60) return `${s.toFixed(0)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
