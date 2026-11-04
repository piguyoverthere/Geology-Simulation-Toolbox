// Sculpting and simulation brushes. Each tool's `apply` is called every frame while the mouse is
// held down over the terrain, with the brush centre in grid coordinates.

import { createNoise2D } from '../core/noise.js';
import { runDroplets } from '../sim/droplet.js';
import { thermalStep } from '../sim/thermal.js';
import { addWater } from '../sim/water.js';
import { startEruption, startIntrusion, volcanoSettings } from '../sim/volcanism.js';
import { startFault, faultSettings } from '../sim/tectonics.js';

const detailNoise = createNoise2D(777);

/** Keyboard shortcuts, assigned to tools in TOOLS order. */
export const TOOL_KEYS = '1234567890-=';
export function toolKey(id) { return TOOL_KEYS[Object.keys(TOOLS).indexOf(id)] || ''; }

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
