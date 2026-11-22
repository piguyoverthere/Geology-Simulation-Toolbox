// Readout for the Inspect tool: everything the simulation knows about the cell under the cursor.

import { BIOMES, classifyBiome } from '../render/biomes.js';
import { waterParams } from '../sim/water.js';
import { ROCKS, PROVINCES, ROCK_INDEX } from '../core/rocks.js';
import { saturation, stableSlope } from '../sim/landslides.js';
import { snowAt, cloudTempAt, seasonalAt } from '../sim/climate.js';
import { SHORES, MARINE, waterTempAt, marineShown, marineThins, coastParams } from '../sim/coast.js';
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

    const dim = (t) => `<span class="ins-dim">${t}</span>`;
    const wet = w.meanSea !== undefined && w.meanSea > -999 && h < w.meanSea;
    const groups = [];
    const group = (title, rows) => { const r = rows.filter(Boolean); if (r.length) groups.push([title, r]); };

    // --- Weather ---
    const wt = waterTempAt(w, i);
    group('Weather', [
      wt !== null
        ? ['Water', `${wt.toFixed(1)} °C ${dim(`· year ${waterTempAt(w, i, false).toFixed(1)}`)}`]
        : ['Temperature', w.seasonT ? `${(w.temperature[i] + seasonalAt(w, i)).toFixed(1)} °C ${dim(`· year ${w.temperature[i].toFixed(1)}`)}` : `${w.temperature[i].toFixed(1)} °C`],
      ['Rain / snow', `${bar(w.precip ? w.precip[i] : 0, '#4f8ce0')} ${dim(`${cloudTempAt(w, i) < 0 ? 'snow' : 'rain'}${w.cloudBase ? ` · clouds ${(w.cloudBase[i] - h).toFixed(0)} up` : ''}`)}`],
      w.wind ? ['Wind', `${Math.round(w.wind[i] * 40)} km/h ${dim(`${w.wind[i] > 1.1 ? 'exposed' : w.wind[i] > 0.6 ? 'breezy' : 'sheltered'} · evaporation ×${(w.evapRate ? w.evapRate[i] : 1).toFixed(1)}`)}`] : null,
      w.snow && w.snow[i] > 0.01 ? ['Snow', `${w.snow[i].toFixed(2)} deep ${dim(`· covers ${Math.round(snowAt(w, i, slope) * 100)}%`)}`] : null,
    ]);

    // --- Sea ---
    if (wet || (w.shore && w.shore[i] >= 0)) {
      const m = w.marine ? w.marine[i] : -1;
      const q = w.silt ? waterQuality(w, i) : 1;
      group('Sea', [
        w.shore && w.shore[i] >= 0 ? ['Shore', `${SHORES[w.shore[i]].label}${w.shoreSet && w.shoreSet[i] >= 0 ? ' (painted)' : ''} ${dim(`· sand ${(w.sand ? w.sand[i] : 0).toFixed(1)}`)}`] : null,
        m >= 0 ? ['Sea bed', `${MARINE[marineShown(w, i)].label}${['kelp', 'seagrass', 'coral', 'deepcoral'].includes(MARINE[m].id) ? ` ${dim(`· ${marineThins(m) ? 'density' : 'health'} ${Math.round(w.marineHealth[i] * 100)}%`)}` : ''}`] : null,
        w.coral && (w.coral[i] > 0.03 || (w.coralRubble && w.coralRubble[i] > 0.05)) ? ['Coral', `${Math.round(Math.min(1, w.coral[i]) * 100)}% living ${w.coralRubble[i] > 0.05 ? dim(`· rubble ${w.coralRubble[i].toFixed(1)}`) : ''}`] : null,
        wet && w.curU ? ['Current', (() => { const sp = Math.hypot(w.curU[i], w.curV[i]); const dir = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][Math.round(((Math.atan2(w.curV[i], w.curU[i]) * 180 / Math.PI + 360) % 360) / 45) % 8]; return `${sp < 0.03 ? 'slack' : `${(sp * 1.5).toFixed(1)} kn ${dir}`} ${dim(`· ${Math.cos(2 * Math.PI * (w.time || 0) / coastParams.tidePeriod) >= 0 ? 'rising' : 'falling'} tide ${(w.tide || 0) >= 0 ? '+' : ''}${(w.tide || 0).toFixed(1)}${w.surge > 0.05 ? ` · surge +${w.surge.toFixed(1)}` : ''}`)}`; })()] : null,
        wet && w.silt ? ['Quality', `${bar(q, q > 0.65 ? '#4fb0e0' : q > 0.4 ? '#b09a5a' : '#8a5a2e')} ${dim(`${qualityLabel(q)} · ${(35 * (w.salinity ? w.salinity[i] : 1)).toFixed(0)} ‰ salt`)}`] : null,
        wet && w.plankton ? ['Life', `${dim(`plankton ${w.plankton[i] > 1.2 ? 'bloom' : w.plankton[i] > 0.4 ? 'plentiful' : 'sparse'} · oxygen ${Math.round(w.oxygen[i] * 100)}%${w.oxygen[i] < 0.3 ? ' (dead zone)' : w.oxygen[i] < 0.6 ? ' (low)' : ''}`)}`] : null,
        wet && w.seaIce && w.seaIce[i] > 0.05 ? ['Sea ice', `${w.seaIce[i] > 0.8 ? 'pack ice' : w.seaIce[i] > 0.3 ? 'ice' : 'thin new ice'}`] : null,
        w.mangrove && w.mangrove[i] > 0.05 ? ['Mangroves', bar(w.mangrove[i], '#2e6b3a')] : null,
        w.dune && w.dune[i] > 0.1 ? ['Dunes', bar(w.dune[i], '#d8c99a')] : null,
      ]);
    }

    // --- Water and soil moisture (land) ---
    if (!wet) {
      group('Water', [
        w.riverPollution && w.riverPollution[i] > 0.05 ? ['Pollution', `${bar(Math.min(1, w.riverPollution[i] / 2), '#8a6a3a')} ${dim('from towns upstream')}`] : null,
        ['Surface', depth > 0.005 ? `${depth.toFixed(2)} deep ${dim(`· ${speed > 0.4 ? 'flowing' : 'standing'}${w.sediment[i] > 0.001 ? ` · silt ${w.sediment[i].toFixed(2)}` : ''}`)}` : `dry ${dim(`· last wet ${lastWater}`)}`],
        ['Soil wetness', `${bar(w.soil ? w.soil[i] : 0, '#4f8ce0')} ${dim(`· climate ${Math.round((w.moisture ? w.moisture[i] : 0) * 100)}%`)}`],
        w.ice && w.ice[i] > 0.02 ? ['Glacier', `${w.ice[i].toFixed(2)} thick ${dim(`· flow ${(w.iceFlow ? w.iceFlow[i] * 100 : 0).toFixed(1)}${w.iceDebris && w.iceDebris[i] > 0.01 ? ` · rock ${w.iceDebris[i].toFixed(2)}` : ''}`)}`] : null,
        w.lava[i] > 0.01 ? ['Lava', `<span style="color:#ff8a4a">${w.lava[i].toFixed(2)} thick · ${Math.round(w.lavaTemp[i] * 100)}% hot</span>`] : null,
      ]);

      // --- Plants and forest ---
      const td = w.treeDensity ? w.treeDensity[i] : 0, fh = w.forestHealth ? w.forestHealth[i] : 0;
      const mix3 = v > 0.3 ? compositionAt(w, i).slice(0, 3) : [];
      group('Plants', [
        ['Cover', `${bar(v, '#4caf50')} ${dim(cover)}`],
        v > 0.45 ? ['Trees', `${bar(td, '#2e6b3a')} ${dim(`${td > 0.75 ? 'closed canopy' : td > 0.45 ? 'dense' : td > 0.2 ? 'open' : 'scattered'} · ${w.forestAge[i] > 0.75 ? 'old growth' : w.forestAge[i] > 0.35 ? 'mature' : 'young'}`)}`] : null,
        v > 0.3 ? ['Forest health', `${bar(fh, fh > 0.6 ? '#4caf50' : fh > 0.35 ? '#d8b84a' : '#c96a4a')} ${dim(fh > 0.6 ? 'young trees replacing old' : fh > 0.35 ? 'few seedlings' : 'not renewing: thinning')}`] : null,
        mix3.length ? ['Species', mix3.map((s2) => `<span class="ins-chip"><span class="tb-swatch ins-swatch" style="background:${rgb(s2.color)}"></span>${s2.label} ${Math.round(s2.share * 100)}%</span>`).join(' ')] : null,
        w.leafOn && w.decid && w.decid[i] > 0.02 && w.seasonT !== undefined && w.flush ? ['Leaves', leafLabel(w, i)] : null,
        w.deadWood && w.deadWood[i] > 0.05 ? ['Dead wood', `${bar(w.deadWood[i], '#8a7f75')} ${dim('burns fiercely')}`] : null,
        w.fire[i] > 0 ? ['Fire', `<span style="color:#ff8a4a">burning · ${Math.round(w.fire[i] * 100)}%</span>`] : null,
        w.burnt[i] > 0.01 ? ['Burnt', `${bar(w.burnt[i], '#777')} ${dim('ash')}`] : null,
      ]);

      // --- Ground and rock ---
      group('Ground', [
        ['Soil', `${bar(w.humus[i], '#8a6a45')} ${dim(chemText(w.soilChem ? w.soilChem[i] : 0))}`],
        ['Bedrock', `<span class="tb-swatch ins-swatch" style="background:${rgb(rock.color)}"></span>${rock.label} ${dim(`· ${formation(w, i, h)} · ${w.rocksEnabled ? `hardness ${Math.round(w.hardnessAt(h, i) * 100)}%` : 'uniform'}`)}`],
        ['Exposure', `${dim(`bare rock ${Math.round(w.bareExposure(i, slope) * 100)}% · erodibility ${w.erodibilityAt(h, i).toFixed(2)}×`)}`],
        ['Stability', `${stability(slope / stableSlope(w, i))} ${dim(`· soaked ${Math.round(saturation(w, i) * 100)}%`)}`],
        w.freshRock[i] > 0.01 ? ['Fresh rock', `${bar(w.freshRock[i], '#ff8a4a')} ${dim('no soil yet')}`] : null,
        w.dam && w.dam[i] > 0.05 ? ['Dam', `${w.dam[i].toFixed(2)} high`] : null,
        w.terraform && w.terraform[i] ? ['Earthworks', w.terraform[i] === 2 ? 'Reclaimed land (built from spoil dumped in the sea)' : 'Cut and terraced by a town'] : null,
        w.landUse && w.landUse[i] ? ['Land use', (() => { const t = (w.towns || []).find((u) => u.num === w.civOwner[i]); const lu = w.landUse[i]; const tr = w.roadTraffic ? w.roadTraffic[i] : 0; return `${lu === 1 ? `Farmland${w.irrigated && w.irrigated[i] ? ' (irrigated)' : ''} ${dim(`· soil ${Math.round((w.farmSoil ? w.farmSoil[i] : 1) * 100)}%${(w.farmSoil ? w.farmSoil[i] : 1) < 0.15 ? ' (worn out)' : ''}`)}` : lu === 2 ? 'Town (paved)' : lu === 4 ? 'Industrial area' : lu === 7 ? 'Dam (reservoir behind)' : lu === 8 ? 'Irrigation canal' : lu === 9 ? `Sewer ${dim(`· ${(w.riverPollution ? w.riverPollution[i] : 0) > 1 ? 'foul, running full' : 'running'} to the outfall`)}` : lu === 10 ? `Timber plantation ${dim(`· monoculture, no wildlife · soil ${Math.round((w.farmSoil ? w.farmSoil[i] : 1) * 100)}% · ${w.vegetation[i] < 0.5 ? 'felled, regrowing' : w.vegetation[i] > 0.7 ? 'grown, ready to fell' : 'growing'} · trees ${Math.round((w.treeDensity ? w.treeDensity[i] : w.vegetation[i]) * 100)}%`)}` : lu === 6 ? 'Quay (sea wall)' : lu === 3 && w.bridge && w.bridge[i] ? `Bridge ${dim(`· condition ${Math.round((w.roadCond ? w.roadCond[i] : 1) * 100)}%`)}` : lu === 5 ? `Harbour ${dim(`· ${(w.towns || []).find((u) => u.harbor === i)?.boats || 0} boats`)}` : `Road ${dim(`· condition ${Math.round((w.roadCond ? w.roadCond[i] : 1) * 100)}%${(w.roadCond ? w.roadCond[i] : 1) < 0.4 ? ' (broken)' : ''} · ${tr > 1500 ? 'very busy (3 lanes)' : tr > 600 ? 'busy (2 lanes)' : tr > 100 ? 'quiet' : 'little used'}`)}`}${t ? ` ${dim(`· ${esc(t.name)}, ${Math.round(t.pop)} people`)}` : lu === 2 ? ` ${dim('· abandoned')}` : ''}`; })()] : null,
        Math.abs(change) > 0.05 ? ['Change', `<span style="color:${change < 0 ? 'var(--erode)' : 'var(--deposit)'}">${change >= 0 ? '+' : ''}${change.toFixed(2)}</span> ${dim(change < 0 ? 'eroded' : 'deposited')}`] : null,
      ]);
    }

    // --- Wildlife ---
    group('Wildlife', (w.animals || []).filter((an) => w['animal_' + an.id] && w['animal_' + an.id][i] > 0.03).map((an) =>
      [esc(an.name), `${bar(Math.min(1, w['animal_' + an.id][i]), rgb(an.color))} ${hungerText(w['hunger_' + an.id] ? w['hunger_' + an.id][i] : 0)}${an.habits.runsRivers ? ` ${dim(`· run ${Math.round((an.stock || 0) * 100)}%`)}` : ''}`]));

    this.root.innerHTML =
      `<div class="ins-head"><span class="tb-swatch" style="background:${swatch}"></span><b>${biome.label}</b>` +
      `<span class="ins-dim">cell ${x}, ${z}</span></div>` +
      `<div class="ins-sub">Altitude ${h.toFixed(1)}${sea ? ` (${(h - w.seaLevel) >= 0 ? '+' : ''}${(h - w.seaLevel).toFixed(1)} vs sea)` : ''} · slope ${(Math.atan(slope) * 180 / Math.PI).toFixed(0)}°</div>` +
      groups.map(([t, rows]) => `<div class="ins-group">${t}</div><table>${rows.map(([k, val]) => `<tr><th>${k}</th><td>${val}</td></tr>`).join('')}</table>`).join('') +
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

/** Well fed / hungry / starving, for an animal at a cell. */
function hungerText(h) {
  return h > 0.4 ? '<span style="color:#ff7a5a">starving</span>' : h > 0.12 ? '<span style="color:#e0c060">hungry</span>' : '<span class="ins-dim">well fed</span>';
}

function chemText(c) {
  return c < -0.45 ? 'acidic' : c < -0.15 ? 'slightly acidic' : c <= 0.15 ? 'neutral' : c <= 0.5 ? 'base-rich' : 'alkaline (limey)';
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

function esc(t) { return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
