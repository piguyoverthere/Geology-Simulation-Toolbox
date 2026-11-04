# Geology Simulation Toolbox

A 3D sandbox where you sculpt a landscape and watch geological processes reshape it. The first
process is **erosion**: rain, rivers, landslides and the sediment they move around.

## Run it

You don't need to install or build anything. The files are plain JavaScript modules served as-is.

```bash
python3 -m http.server 8173
```

Then open <http://localhost:8173>. You need a local server (not a double-clicked `index.html`)
because browsers block ES modules loaded from `file://`.

To put it online, turn on **GitHub Pages** for this repo (Settings → Pages → Deploy from branch →
`master` / root). The game will then live at `https://<user>.github.io/Geology-Simulation-Toolbox/`.

## Controls

| Input | Action |
| --- | --- |
| Left-drag | Use the selected tool |
| Right-drag | Orbit the camera |
| Middle-drag | Pan |
| Scroll | Zoom |
| Shift + tool | Invert it (Raise ↔ Lower, Rain → soak up, Spring → remove) |
| `1`–`9` | Pick a tool |
| `[` / `]` | Shrink / grow brush |
| Space | Pause / resume the simulation |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo / redo terrain strokes |

Hover any control in the toolbox to see what it does in the info box at the bottom.

### Toolbox

- **Sculpt**: Raise, Lower, Smooth, Flatten, Roughen.
- **Water**: Rain (paint water on) and Spring (a permanent water source that carves a river).
- **Life**: Plant (grow forest; Shift to clear it).
- **Erosion brushes**: Weather (thousands of raindrops in the brush area) and Crumble (landslides).
- **Erosion simulation**: global rain, sim speed, river erosion, evaporation, background
  weathering, landslides, plant growth, climate wetness, tree line and angle of repose.
- **Geology**: rock strata (hard and soft layers), sea level, edge drainage.
- **Terrain**: presets (hills, mountains, plateau, volcano, flat), seed, undo/redo, PNG
  heightmap export/import.
- **View**: colour modes (natural, biomes, erosion/deposition map, rock hardness, slope, vegetation, soil moisture) with a biome legend, water, snow
  line, wireframe.

Try this: pick **Layered plateau**, turn on **Sea** at level 8, drop two **Springs** on top, and set
**Colour → Erosion / deposition**. Red shows where ground was carved away and blue shows where
sediment piled up, such as the delta forming where the river meets the sea.

## How it works

The science behind each model is in **[docs/GEOLOGY.md](docs/GEOLOGY.md)**.

```
index.html              page + import map (three.js is vendored, no CDN needed)
src/main.js             App: scene, camera, input, main loop, toolbox actions
src/core/world.js       World: all simulated fields as flat Float32Arrays on a 256×256 grid
src/core/noise.js       Seeded simplex noise, fBm, ridged noise
src/core/generate.js    Terrain presets (with lowland smoothing, basin breaching and river carving)
src/core/grid.js        Grid helpers: box blur, depression breaching, river-network carving
src/sim/water.js        Shallow-water "virtual pipes" flow + sediment transport (rivers, lakes, deltas)
src/sim/droplet.js      Particle raindrop erosion (long-term weathering, gullies, valleys)
src/sim/thermal.js      Thermal erosion / mass wasting (slopes relax to the angle of repose)
src/sim/vegetation.js   Forest / grassland / barren cover that grows, dies and protects soil
src/tools/brushes.js    Tool definitions + undo history
src/render/terrainRenderer.js  Terrain/water meshes and colouring
src/render/biomes.js    Biome definitions and classification
src/ui/toolbox.js       Right-hand toolbox panel
vendor/three/           three.js r169 (MIT)
```

The whole world is a set of 2D grids (a *heightfield*): ground height, water depth, suspended
sediment, water flux and velocity. Each frame, the simulations update the grids and the renderer
turns them into a 3D mesh. Adding a new geological process means adding a field or two to `World`
and writing one more `sim/*.js` step function.

### Adding a tool

Add an entry to `TOOLS` in `src/tools/brushes.js`. It appears in the toolbox automatically:

```js
myTool: {
  label: 'My tool', group: 'Sculpt', icon: '★', editsTerrain: true,
  help: 'Shown in the info box.',
  apply({ world, x, z, radius, strength, dt, invert, stroke }) { /* modify world.height … */ },
},
```

## Why JavaScript + three.js?

| Option | Verdict |
| --- | --- |
| **JavaScript + three.js (chosen)** | Runs in any browser, deploys free on GitHub Pages, edits show up on refresh, and three.js handles the 3D. CPU simulation at 256² runs at interactive speed. |
| TypeScript + Vite | Type safety and a nicer workflow, but it needs a modern Node.js. This machine has Node 8, so it's an easy upgrade later. |
| WebGPU compute shaders (WGSL) | The natural next step for speed: the grid simulations map 1:1 onto GPU compute, giving 1024²+ grids in real time. |
| Rust → WebAssembly | 2–4× faster CPU simulation, but adds a toolchain. Worth it only if the GPU route isn't. |
| Godot / Unity / Unreal | Strong for a polished commercial game, but heavier to learn, harder to share, and the simulation would still be custom code. |

The simulation code is deliberately plain data-oriented loops over typed arrays, so porting it to
WGSL compute shaders or Rust later is mostly mechanical.

## Roadmap ideas

1. **GPU simulation** (WebGPU) for bigger maps and faster geological time.
2. **Layered ground**: separate bedrock, regolith and sediment layers instead of one height, so
   you can see what lies underneath and dig into it.
3. **Tectonics**: uplift zones, faults and folding to rebuild the mountains erosion wears down.
4. **Glaciers**: ice flow that carves U-shaped valleys, cirques and moraines.
5. **Coastal processes**: waves, longshore drift, sea cliffs and beaches.
6. **Volcanism**: lava flows that cool into new rock.
7. **Cross-section view**: slice the terrain to see the strata.
8. **Time-lapse and "geological clock"**: show how many years each step represents.
