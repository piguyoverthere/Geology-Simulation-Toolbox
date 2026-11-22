// Readout for the Inspect tool: everything the simulation knows about the cell under the cursor.

import { BIOMES, classifyBiome } from '../render/biomes.js';
import { waterParams } from '../sim/water.js';
import { ROCKS, PROVINCES, ROCK_INDEX } from '../core/rocks.js';
import { saturation, stableSlope } from '../sim/landslides.js';
import { snowAt, cloudTempAt, seasonalAt } from '../sim/climate.js';
import { SHORES, MARINE, waterTempAt, marineShown } from '../sim/coast.js';
import { waterQuality, qualityLabel } from '../sim/waterQuality.js';
import { compositionAt } from '../sim/species.js';

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
    const biome = BIOMES[classifyBiome(w, i, slope)];

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
      waterTempAt(w, i) !== null
        ? ['Water temp.', `${waterTempAt(w, i).toFixed(1)} °C <span class="ins-dim">· year avg ${waterTempAt(w, i, false).toFixed(1)}</span>`]
        : ['Temperature', w.seasonT ? `${(w.temperature[i] + seasonalAt(w, i)).toFixed(1)} °C <span class="ins-dim">· year avg ${w.temperature[i].toFixed(1)}</span>` : `${w.temperature[i].toFixed(1)} °C`],
      ['Evaporation', `${bar(Math.min(1, (w.evapRate ? w.evapRate[i] : 1) / 2), '#e0a24f')} <span class="ins-dim">×${(w.evapRate ? w.evapRate[i] : 1).toFixed(2)}</span>`],
      ['Cloud base', w.cloudBase ? `${(w.cloudBase[i] - h).toFixed(1)} above · ${cloudTempAt(w, i).toFixed(1)} °C` : '—'],
      ['Precipitation', `${bar(w.precip ? w.precip[i] : 0, '#4f8ce0')} <span class="ins-dim">${cloudTempAt(w, i) < 0 ? 'snow' : 'rain'}</span>`],
      ...(w.shore && w.shore[i] >= 0 ? [['Shore', `${SHORES[w.shore[i]].label}${w.shoreSet && w.shoreSet[i] >= 0 ? ' <span class="ins-dim">(painted)</span>' : ''} <span class="ins-dim">· sand ${(w.sand ? w.sand[i] : 0).toFixed(2)}</span>`]] : []),
      ...(w.marine && w.marine[i] >= 0 ? [['Sea', `${MARINE[marineShown(w, i)].label} <span class="ins-dim">· tide ${(w.tide || 0) >= 0 ? '+' : ''}${(w.tide || 0).toFixed(2)}</span>`]] : []),
      ...(w.silt && w.meanSea > -999 && h < w.meanSea ? [['Water quality', `${bar(waterQuality(w, i), waterQuality(w, i) > 0.65 ? '#4fb0e0' : waterQuality(w, i) > 0.4 ? '#b09a5a' : '#8a5a2e')} <span class="ins-dim">${qualityLabel(waterQuality(w, i))} · silt ${w.silt[i].toFixed(2)} · pollutants ${w.pollution[i].toFixed(2)}</span>`]] : []),
      ...(w.marine && w.marine[i] >= 0 && ['kelp', 'seagrass', 'coral'].includes(MARINE[w.marine[i]].id) ? [['Sea-bed health', bar(w.marineHealth[i], w.marineHealth[i] > 0.5 ? '#5cbf6a' : '#c96a4a')]] : []),
            ...(w.dune && w.dune[i] > 0.1 ? [['Dunes', bar(w.dune[i], '#d8c99a')]] : []),
      ...(w.mangrove && w.mangrove[i] > 0.05 ? [['Mangroves', bar(w.mangrove[i], '#2e6b3a')]] : []),
      ...(w.ice && w.ice[i] > 0.02 ? [['Glacier ice', `${w.ice[i].toFixed(2)} thick · flowing ${(w.iceFlow ? w.iceFlow[i] * 100 : 0).toFixed(1)}${w.iceDebris && w.iceDebris[i] > 0.01 ? ` <span class="ins-dim">· carrying ${w.iceDebris[i].toFixed(2)} rock</span>` : ''}`]] : []),
      ...(w.snow && w.snow[i] > 0.01 ? [['Snow depth', `${w.snow[i].toFixed(2)} <span class="ins-dim">· covers ${Math.round(snowAt(w, i, slope) * 100)}%</span>`]] : []),
      ['Soil wetness', bar(w.soil ? w.soil[i] : 0, '#4f8ce0')],
      ['Climate', bar(w.moisture ? w.moisture[i] : 0, '#7fa7d6')],
      ['Last watered', lastWater],
      ...(w.lava[i] > 0.01 ? [['Lava', `<span style="color:#ff8a4a">${w.lava[i].toFixed(2)} thick · ${Math.round(w.lavaTemp[i] * 100)}% hot</span>`]] : []),
      ['Surface water', depth > 0.005 ? `${depth.toFixed(2)} deep · ${speed.toFixed(1)} speed` : 'dry'],
      ['Sediment load', w.sediment[i] > 0.001 ? w.sediment[i].toFixed(3) : '—'],
      ['Plant cover', `${bar(v, '#4caf50')} <span class="ins-dim">${cover}</span>`],
      ...(v > 0.6 ? [['Forest age', `${bar(w.forestAge[i], '#2e7d32')} <span class="ins-dim">${w.forestAge[i] > 0.75 ? 'old growth' : w.forestAge[i] > 0.35 ? 'mature' : 'young'}</span>`]] : []),
      ...(v > 0.3 ? [['Forest mix', compositionAt(w, i).slice(0, 4).map((s) => `<div><span class="tb-swatch ins-swatch" style="background:${rgb(s.color)}"></span>${s.label} ${Math.round(s.share * 100)}%</div>`).join('')]] : []),
      ...(w.leafOn && w.decid && w.decid[i] > 0.02 && w.seasonT !== undefined && w.flush ? [['Leaves', leafLabel(w, i)]] : []),
      ['Soil depth', bar(w.humus[i], '#8a6a45')],
      ['Soil chemistry', chemLabel(w.soilChem ? w.soilChem[i] : 0)],
      ['Bare rock', bar(w.bareExposure(i, slope), '#b0a090')],
      ['Saturation', bar(saturation(w, i), '#4f8ce0')],
      ['Slope stability', stability(slope / stableSlope(w, i))],
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

function chemLabel(c) {
  const name = c < -0.45 ? 'acidic' : c < -0.15 ? 'slightly acidic' : c <= 0.15 ? 'neutral' : c <= 0.5 ? 'base-rich' : 'alkaline (limey)';
  return `${name} <span class="ins-dim">${c >= 0 ? '+' : ''}${c.toFixed(2)}</span>`;
}

/** Slope vs. its stable limit: below ~0.8 is safe, near 1 is failing. */
function stability(r) {
  const label = r < 0.6 ? 'stable' : r < 0.85 ? 'marginal' : r < 1 ? 'unstable' : 'failing';
  const color = r < 0.6 ? 'inherit' : r < 0.85 ? '#e0c060' : '#ff6a4a';
  return `<span style="color:${color}">${label}</span> <span class="ins-dim">${Math.round(r * 100)}% of limit</span>`;
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

/** Deciduous canopy state: in leaf / turning / bare / fresh spring leaves. */
function leafLabel(w, i) {
  const L = w.leafOn[i], a = w.autumn[i], f = w.flush[i], d = Math.round(w.decid[i] * 100);
  const state = L < 0.15 ? 'bare (leaves fallen)' : a > 0.15 ? `turning ${Math.round(a * 100)}%` + (L < 0.85 ? ', falling' : '')
    : f > 0.25 ? 'fresh spring leaves' : L < 0.85 ? 'leafing out' : 'in leaf';
  return `${state} <span class="ins-dim">· ${d}% deciduous</span>`;
}
