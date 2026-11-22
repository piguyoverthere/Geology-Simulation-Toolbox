// Sculpting and simulation brushes. Each tool's `apply` is called every frame while the mouse is
// held down over the terrain, with the brush centre in grid coordinates.

import { strike, spawnStormAt } from '../sim/weather.js';
import { addIce } from '../sim/glacier.js';
import { MinHeap } from '../core/grid.js';
import { paintShore, coastParams } from '../sim/coast.js';
import { createNoise2D } from '../core/noise.js';
import { runDroplets } from '../sim/droplet.js';
import { thermalStep } from '../sim/thermal.js';
import { addWater } from '../sim/water.js';
import { startEruption, startIntrusion, volcanoSettings } from '../sim/volcanism.js';
import { startFault, faultSettings } from '../sim/tectonics.js';

const detailNoise = createNoise2D(777);

/** Keyboard shortcuts, assigned to tools in TOOLS order. */
export const TOOL_KEYS = '1234567890-=';
const LETTER_KEYS = { draw: 'D', lightning: 'L', wildfire: 'F', storm: 'C', drain: 'W', snow: 'N', glacier: 'G', subside: 'B', uplift: 'U', age: 'A', lake: 'K', section: 'P', shoreline: 'O' };
export function toolKey(id) { return LETTER_KEYS[id] || TOOL_KEYS[Object.keys(TOOLS).indexOf(id)] || ''; }

/**
 * Fill the hollow at (x, z) to its spill level (a priority flood from the hollow's lowest point:
 * the water rises until it reaches the lowest point of the rim, beyond which the ground drops away).
 */
export function fillLake(world, x, z) {
  const N = world.N, H = world.height, D = world.water;
  if (x < 1 || z < 1 || x > N - 2 || z > N - 2) return 0;
  // Start from the bottom of the hollow
  let s = z * N + x;
  for (let k = 0; k < 500; k++) {
    let low = s;
    for (const j of [s - 1, s + 1, s - N, s + N]) if (H[j] < H[low]) low = j;
    if (low === s) break;
    s = low;
  }
  const seen = new Uint8Array(N * N), heap = new MinHeap(N * N), region = [];
  heap.push(s, H[s]); seen[s] = 1;
  let level = H[s];
  const cap = (N * N) / 6;
  while (heap.size) {
    const c = heap.pop(), h = H[c];
    if (h < level - 1e-4) break; // past the rim: the water would spill here
    level = Math.max(level, h);
    region.push(c);
    const cx = c % N, cz = (c / N) | 0;
    if (cx === 0 || cz === 0 || cx === N - 1 || cz === N - 1 || region.length > cap) break; // drains off the map
    for (const j of [c - 1, c + 1, c - N, c + N]) if (!seen[j]) { seen[j] = 1; heap.push(j, H[j]); }
  }
  let filled = 0;
  for (const c of region) if (level > H[c]) { D[c] = Math.max(D[c], level - H[c]); filled++; }
  world.dirty = true;
  return filled;
}

/** Raise (d > 0) or lower the whole landscape, keeping everything tied to the ground with it. */
export function shiftLand(world, d) {
  const n = world.N * world.N;
  for (let i = 0; i < n; i++) {
    world.height[i] += d;
    world.baseline[i] += d;
    world.prevHeight[i] += d;
    world.strataWarp[i] -= d; // the same rock stays at the surface
    world.surfaceBase[i] += d;
    if (world.intrusionTop[i] > -1e30) world.intrusionTop[i] += d;
  }
  if (world.geoRange) { world.geoRange.lo += d; world.geoRange.hi += d; }
  world.dirty = true;
}

/** Smooth bell-shaped falloff: 1 at the centre, 0 at the brush edge. */
function falloff(d, r) {
  const t = d / r;
  if (t >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(t * Math.PI);
}

/** Visit every cell under the brush with its falloff weight. */
function forEachCell(world, cx, cz, r, fn) {
  const N = world.N;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
  const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(N - 1, Math.ceil(cz + r));
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const w = falloff(Math.hypot(x - cx, z - cz), r);
      if (w > 0) fn(z * N + x, w, x, z);
    }
  }
}

/**
 * @typedef {object} BrushCtx
 * @property {import('../core/world.js').World} world
 * @property {number} x       brush centre (grid units)
 * @property {number} z
 * @property {number} radius
 * @property {number} strength 0..1
 * @property {number} dt       seconds since last frame
 * @property {object} stroke   per-stroke scratch state (reset when the mouse is pressed)
 * @property {boolean} invert  true while Shift is held
 */

/**
 * Tools: `apply` runs every frame while painting; `click` tools apply once per click; `line` tools
 * are dragged from a start to an end point and call `place(ctx, a, b)` on release.
 * @type {Record<string, {label:string, group:string, icon:string, help:string|(()=>string), apply?:(c:BrushCtx)=>void, place?:Function, editsTerrain?:boolean, click?:boolean, line?:boolean}>}
 */
export const TOOLS = {
  camera: {
    label: 'Orbit', group: 'View', icon: '✥', editsTerrain: false,
    help: 'Drag to orbit the camera. Scroll to zoom, right-drag to pan. (In any other tool, right-drag orbits and middle-drag pans.)',
    apply() {},
  },
  inspect: {
    label: 'Inspect', group: 'View', icon: '⌖', editsTerrain: false,
    help: 'Hover the terrain to read what is there: altitude, slope, biome, soil wetness, when it was last watered, plant cover, rock and erosion.',
    apply() {},
  },
  raise: {
    label: 'Raise', group: 'Sculpt', icon: '▲', editsTerrain: true,
    help: 'Push the ground up, like tectonic uplift. Hold Shift to lower instead.',
    apply({ world, x, z, radius, strength, dt, invert }) {
      const s = strength * 40 * dt * (invert ? -1 : 1);
      forEachCell(world, x, z, radius, (i, w) => { world.height[i] += s * w; });
    },
  },
  lower: {
    label: 'Lower', group: 'Sculpt', icon: '▼', editsTerrain: true,
    help: 'Dig the ground down, like subsidence. Hold Shift to raise instead.',
    apply(c) { TOOLS.raise.apply({ ...c, invert: !c.invert }); },
  },
  smooth: {
    label: 'Smooth', group: 'Sculpt', icon: '◠', editsTerrain: true,
    help: 'Average neighbouring heights to soften bumps and sharp edges.',
    apply({ world, x, z, radius, strength, dt }) {
      const N = world.N, H = world.height;
      const src = H.slice();
      const k = Math.min(1, strength * 12 * dt);
      forEachCell(world, x, z, radius, (i, w, cx, cz) => {
        if (cx < 1 || cz < 1 || cx >= N - 1 || cz >= N - 1) return;
        const avg = (src[i - 1] + src[i + 1] + src[i - N] + src[i + N] + src[i] * 2) / 6;
        H[i] += (avg - H[i]) * k * w;
      });
    },
  },
  flatten: {
    label: 'Flatten', group: 'Sculpt', icon: '▬', editsTerrain: true,
    help: 'Level the ground to the height where you started the stroke, like a wave-cut terrace.',
    apply({ world, x, z, radius, strength, dt, stroke }) {
      if (stroke.level === undefined) stroke.level = world.sampleHeight(x, z);
      const k = Math.min(1, strength * 8 * dt);
      forEachCell(world, x, z, radius, (i, w) => {
        world.height[i] += (stroke.level - world.height[i]) * k * w;
      });
    },
  },
  roughen: {
    label: 'Roughen', group: 'Sculpt', icon: '≋', editsTerrain: true,
    help: 'Add rocky noise so erosion has irregularities to work on.',
    apply({ world, x, z, radius, strength, dt }) {
      const s = strength * 25 * dt;
      forEachCell(world, x, z, radius, (i, w, cx, cz) => {
        world.height[i] += detailNoise(cx * 0.15, cz * 0.15) * s * w;
      });
    },
  },
  rain: {
    label: 'Rain', group: 'Water', icon: '☂', editsTerrain: false,
    help: 'Pour water onto the terrain. It flows downhill, pools in basins and erodes as it goes. Hold Shift to soak it up.',
    apply({ world, x, z, radius, strength, dt, invert }) {
      addWater(world, x, z, radius, strength * 6 * dt * (invert ? -1 : 1));
    },
  },
  spring: {
    label: 'Spring', group: 'Water', icon: '◉', editsTerrain: false, click: true,
    help: 'Click to place a spring that flows forever and carves a river. Shift-click removes nearby springs.',
    apply({ world, x, z, strength, invert }) {
      if (invert) {
        world.sources = world.sources.filter((s) => Math.hypot(s.x - x, s.z - z) > 8);
      } else {
        world.sources.push({ x, z, rate: 2 + strength * 18 });
      }
      world.dirty = true;
    },
  },
  plant: {
    label: 'Plant', group: 'Life', icon: '♣', editsTerrain: false,
    help: 'Grow vegetation: barren → grassland → forest. Plant cover protects soil from erosion. Hold Shift to clear it (deforestation).',
    apply({ world, x, z, radius, strength, dt, invert }) {
      const s = strength * 1.5 * dt * (invert ? -1 : 1);
      forEachCell(world, x, z, radius, (i, w) => {
        world.vegetation[i] = Math.min(1, Math.max(0, world.vegetation[i] + s * w));
      });
      world.dirty = true;
    },
  },
  droplets: {
    label: 'Weather', group: 'Erosion', icon: '⁂', editsTerrain: true,
    help: 'Long-term rainfall erosion under the brush: thousands of raindrops carve gullies and drop sediment in valleys.',
    apply({ world, x, z, radius, strength }) {
      runDroplets(world, Math.round(200 + 1800 * strength), { x, z, r: radius }, 1);
    },
  },
  thermal: {
    label: 'Crumble', group: 'Erosion', icon: '⛰', editsTerrain: true,
    help: 'Thermal erosion: slopes steeper than the angle of repose collapse into scree.',
    apply({ world, x, z, radius, strength }) {
      for (let k = 0; k < 3; k++) thermalStep(world, { x, z, r: radius }, strength);
    },
  },
  erupt: {
    label: 'Erupt', group: 'Tectonics', icon: '♨', editsTerrain: true, line: true,
    help: 'Click to open a volcanic vent, or drag to open a fissure. Choose the eruption type and size in the side panel under Volcanism & tectonics.',
    place({ world }, a, b) { startEruption(world, a, b, volcanoSettings); },
  },
  intrude: {
    label: 'Intrude', group: 'Tectonics', icon: '◍', editsTerrain: true, line: true,
    help: 'Inject magma underground. Pluton: click (brush size = size); it domes the ground and leaves granite beneath. Dike: drag to draw a basalt wall. Erode to expose them.',
    place({ world, radius }, a, b) { startIntrusion(world, a, b, radius, volcanoSettings); },
  },
  fault: {
    label: 'Fault', group: 'Tectonics', icon: '⫽', editsTerrain: true, line: true,
    help: 'Drag along a line to break the crust. It slips in a series of earthquakes. Choose normal, reverse or strike-slip in the side panel.',
    place({ world }, a, b) { startFault(world, a, b, faultSettings); },
  },
  storm: {
    label: 'Storm', group: 'Weather', icon: '☁', editsTerrain: false, click: true,
    help: 'Click to bring a storm in over that spot (about twice the brush size). It snows if it is cold enough up there and rains if not, and drifts slowly downwind. Shift-click for a thunderstorm with lightning.',
    apply({ world, x, z, radius, invert }) {
      spawnStormAt(world, x, z, Math.max(12, radius * 2), invert);
      world.dirty = true;
    },
  },
  snow: {
    label: 'Snow', group: 'Weather', icon: '❄', editsTerrain: false,
    help: 'Paint snow onto the ground. It melts away if it is warm (above 2 °C), slides off very steep slopes, and lasts where it is cold. Hold Shift to clear snow.',
    apply({ world, x, z, radius, strength, dt, invert }) {
      if (!world.snow) return;
      const s = strength * 4 * dt * (invert ? -1 : 1);
      forEachCell(world, x, z, radius, (i, w) => {
        world.snow[i] = Math.min(6, Math.max(0, world.snow[i] + s * w));
      });
      world.dirty = true;
    },
  },
  glacier: {
    label: 'Glacier', group: 'Weather', icon: '▼', editsTerrain: true,
    help: 'Paint glacier ice, e.g. into the head of a valley. The ice creeps downhill, grinding the valley into a U shape, carries the rock it erodes and drops it as moraines where it melts. It melts away below the snowline; above it, deep lasting snow keeps feeding it. Hold Shift to remove ice.',
    apply({ world, x, z, radius, strength, dt, invert }) {
      const s = strength * 6 * dt * (invert ? -1 : 1);
      forEachCell(world, x, z, radius, (i, w) => addIce(world, i, s * w));
    },
  },
  lightning: {
    label: 'Lightning', group: 'Weather', icon: 'ϟ', editsTerrain: false, click: true,
    help: 'Click to call down a lightning strike. In forest it usually starts a fire, most easily in dry woodland, in pine and during a dry summer; in grass or shrubland it starts a slow creeping fire; wet ground, standing water or bare rock won\'t burn.',
    apply({ world, x, z }) {
      const N = world.N, i = Math.min(N - 1, Math.max(0, Math.round(z))) * N + Math.min(N - 1, Math.max(0, Math.round(x)));
      strike(world, i, true);
    },
  },
  wildfire: {
    label: 'Wildfire', group: 'Weather', icon: '✹', editsTerrain: false,
    help: 'Paint to set the vegetation alight. Forest burns fast and hot, especially dry pine; grass and shrubland only creep, unless it\'s a dry summer. Wet ground, water and bare rock won\'t burn. Hold Shift to put fires out instead.',
    apply({ world, x, z, radius, strength, dt, invert }) {
      const N = world.N, r = Math.max(1.5, radius * 0.5), F = world.fire, V = world.vegetation;
      const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(N - 1, Math.ceil(x + r));
      const z0 = Math.max(0, Math.floor(z - r)), z1 = Math.min(N - 1, Math.ceil(z + r));
      for (let zz = z0; zz <= z1; zz++) {
        for (let xx = x0; xx <= x1; xx++) {
          if ((xx - x) ** 2 + (zz - z) ** 2 > r * r) continue;
          const i = zz * N + xx;
          if (invert) { F[i] = 0; continue; }
          // A scattering of spot fires that then spread on their own
          if (F[i] <= 0 && V[i] > 0.15 && world.water[i] < 0.05 && !(world.snow && world.snow[i] > 0.02) && Math.random() < strength * Math.max(dt, 1 / 60) * 6) F[i] = 0.6;
        }
      }
      world.dirty = true;
    },
  },
  draw: {
    label: 'Draw path / polygon', group: 'View', icon: '✎', editsTerrain: false, draw: true,
    help: 'Click to add points along the ground. Double-click or Enter finishes a path; click the first point again to close a polygon. Backspace removes the last point, Esc cancels. Each shape shows its length along the ground, climb and descent, height range and (polygons) area. Choose path or polygon and the colour under Drawings in the side panel.',
    apply() {},
  },
  drain: {
    label: 'Drain', group: 'Water', icon: '⊘', editsTerrain: false,
    help: 'Paint to soak up surface water and the sediment it carries: drain a lake, a flood or a river reach. (Springs keep flowing; remove those with Shift-click in the Spring tool.)',
    apply({ world, x, z, radius, strength, dt }) {
      const k = Math.min(1, strength * 8 * dt);
      forEachCell(world, x, z, radius, (i, w) => {
        world.water[i] *= 1 - k * w;
        world.sediment[i] *= 1 - k * w;
        if (world.water[i] < 1e-3) { world.water[i] = 0; world.sediment[i] = 0; }
      });
      world.dirty = true;
    },
  },
  subside: {
    label: 'Sink land', group: 'Tectonics', icon: '⤓', editsTerrain: false, // (reverse with Shift rather than Undo)
    help: 'Hold the mouse anywhere on the map to lower the whole area at once (regional subsidence, as when a basin sinks or crust cools and settles). Everything moves together: rock layers, lava, intrusions and the erosion baseline stay matched to the ground. Lower land is warmer, so the snow and tree lines climb, and with the sea on, coasts flood inland. Hold Shift to uplift the whole area instead (that is also how to undo it). Brush strength sets the speed.',
    apply({ world, strength, dt, invert }) {
      const d = strength * 3 * dt * (invert ? 1 : -1);
      shiftLand(world, d);
    },
  },
  uplift: {
    label: 'Raise land', group: 'Tectonics', icon: '⤒', editsTerrain: false,
    help: 'Hold the mouse anywhere on the map to raise the whole area at once (regional uplift, as when mountains are pushed up or land rebounds after an ice sheet melts). Everything moves together: rock layers, lava, intrusions and the erosion baseline stay matched to the ground. Higher land is colder, so the snow and tree lines drop, rivers cut down harder, and with the sea on, the coast pulls back. Hold Shift to lower it instead. Brush strength sets the speed.',
    apply({ world, strength, dt, invert }) {
      shiftLand(world, strength * 3 * dt * (invert ? -1 : 1));
    },
  },
  age: {
    label: 'Age forest', group: 'Life', icon: '⌛', editsTerrain: false,
    help: 'Paint to age the forest toward old growth: a darker, denser canopy, deeper soil, more shade-tolerant trees (fir, beech, tropical hardwoods) instead of pioneers (aspen, birch), and a forest that resists fire, drought and erosion better. Only forest ages (it is lost again where the forest is cleared or burns). Hold Shift to make it young again, as after a disturbance.',
    apply({ world, x, z, radius, strength, dt, invert }) {
      const s = strength * 0.8 * dt * (invert ? -1 : 1);
      forEachCell(world, x, z, radius, (i, w) => {
        if (world.vegetation[i] < 0.6 && !invert) return;
        world.forestAge[i] = Math.min(1, Math.max(0, world.forestAge[i] + s * w));
        // Old forests have built deep soil; making a stand young again doesn't take it away
        if (!invert) world.humus[i] = Math.min(1, world.humus[i] + s * w * 0.5);
      });
      world.dirty = true;
    },
  },
  lake: {
    label: 'Lake', group: 'Water', icon: '◒', editsTerrain: false, click: true,
    help: 'Click in a hollow to fill it with water up to the level where it would spill over its lowest rim, as a lake fills. The overflow then runs out and carves an outlet. (Most valleys here already drain, so their hollows are small; sculpt a dam first for a big lake.)',
    apply({ world, x, z }) {
      fillLake(world, Math.round(x), Math.round(z));
    },
  },
  section: {
    label: 'Cross-section', group: 'View', icon: '⊟', editsTerrain: false, line: true,
    help: 'Drag a line across the land to slice through it: a geological cross-section opens showing the rock layers underground in their colours, the soil, and any snow, glacier ice and water on top, with heights. Great for seeing folded strata, intrusions, U-shaped valleys or what a fault did.',
    place({ app }, a, b) { app.section.show(a, b); },
  },
  shoreline: {
    label: 'Shoreline', group: 'Water', icon: '≈', editsTerrain: true,
    help: 'Paint along a coast to give it a shore type (choose it under Ocean & coast → Shoreline type): mudflat (flattens it to a tidal flat), sand beach (adds sand), shingle beach (pebbles), rock cliff (steepens it) or basalt boulder beach (black basalt). Auto lets the conditions decide. Only works on the shore itself, around the tide line, with the sea on. Hold Shift to go back to auto.',
    apply({ world, x, z, radius, dt, invert }) {
      const type = invert ? 'auto' : coastParams.shoreType;
      forEachCell(world, x, z, radius, (i, w) => paintShore(world, i, w, type, dt));
    },
  },
};

/** Fixed-size undo stack of height snapshots taken at the start of each terrain-editing stroke. */
export class History {
  constructor(limit = 30) { this.limit = limit; this.stack = []; this.redoStack = []; }
  push(world) {
    this.stack.push(world.height.slice());
    if (this.stack.length > this.limit) this.stack.shift();
    this.redoStack.length = 0;
  }
  undo(world) {
    if (!this.stack.length) return false;
    this.redoStack.push(world.height.slice());
    world.height.set(this.stack.pop());
    world.dirty = true;
    return true;
  }
  redo(world) {
    if (!this.redoStack.length) return false;
    this.stack.push(world.height.slice());
    world.height.set(this.redoStack.pop());
    world.dirty = true;
    return true;
  }
}
