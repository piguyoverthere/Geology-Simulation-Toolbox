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
| `1`–`9`, `0`, `-`, `=` | Pick a tool (numbers shown on the tool bar) |
| `[` / `]` | Shrink / grow brush |
| Space | Pause / resume the simulation |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo / redo terrain strokes |

Hover any tool or control to see what it does in the info box at the bottom right.

### Tool bar (bottom)

Every tool as a small icon, grouped: **View** (Orbit, Inspect), **Sculpt** (Raise, Lower, Smooth,
Flatten, Roughen), **Water** (Rain, Spring: a permanent source that carves a river), **Life**
(Plant; Shift to clear), **Erosion** (Weather: thousands of raindrops in the brush area;
Crumble: landslides) and **Tectonics**, plus brush **Size** and **Strength**:

- **Erupt** ♨: click for a vent or drag for a fissure. Basaltic lava runs far in thin flows;
  andesitic builds a steep cone with ash bursts; rhyolitic is violent: a big blast crater, a towering
  ash column and burning pyroclastic flows racing down the valleys, then a lava dome. Lava glows, flows, cools and becomes new rock; ash settles as tuff.
  Lava sets forests alight: wildfire races through forest (much slower in grass), leaving ash-grey
  burnt ground that recovers slowly.
- **Intrude** ◍: a granite pluton (click) domes the ground with granite hidden beneath until erosion
  exposes it; a basalt dike (drag) is a hard wall that erosion leaves standing.
- **Fault** ⫽: drag a fault line; it slips in a series of earthquakes (the camera shakes).
  Normal faults drop a block, reverse/thrust faults raise one, strike-slip faults slide the two
  sides past each other, offsetting rivers and rock.

**Inspect** shows a readout of the spot under the cursor: biome, altitude (and height above
sea level), slope, soil wetness, climate moisture, when it was last watered (rain, river or
lake), surface water depth and speed, sediment load, plant cover, rock hardness, erodibility,
and how much it has been eroded or built up since the baseline.

### Side panel

- **Erosion**: a master **Erosion enabled** switch, then the processes (river erosion,
  background weathering, landslides, angle of repose, bulk erode).
- **Volcanism & tectonics**: eruption type and size, intrusion type, fault type, slip and number
  of earthquakes, and a button to stop all running events.
- **Water & climate**: sim speed, global rain, evaporation, plant growth, climate wetness, tree line.
- **Overlays**: colour the map by one data layer (biomes, vegetation, forest age, wetness, soil
  depth, bare rock, rock type, rock hardness, erosion/deposition, slope) with a matching legend, and a **Show vegetation** switch that
  strips plants away to reveal bare ground and bedrock.
- **Geology**: rock types on/off, hardness contrast, layer thickness, sea level, edge drainage.
- **Terrain**: presets (hills, mountains, plateau, volcano, flat), seed, undo/redo, PNG
  heightmap export/import.
- **View**: water, snow line, wireframe.

Try this: pick **Layered plateau**, turn on **Sea** at level 8, drop two **Springs** on top, and set
**Overlays → Erosion / deposition**. Red shows where ground was carved away and blue shows where
sediment piled up, such as the delta forming where the river meets the sea.

## How it works

The science behind each model is in **[docs/GEOLOGY.md](docs/GEOLOGY.md)**.

```
index.html              page + import map (three.js is vendored, no CDN needed)
src/main.js             App: scene, camera, input, main loop, toolbox actions
src/core/world.js       World: all simulated fields as flat Float32Arrays on a 256×256 grid
src/core/rocks.js       Rock types, geological provinces and the rock-at-depth lookup
src/core/noise.js       Seeded simplex noise, fBm, ridged noise
src/core/generate.js    Terrain presets (with lowland smoothing, basin breaching and river carving)
src/core/grid.js        Grid helpers: box blur, depression breaching, river-network carving
src/sim/water.js        Shallow-water "virtual pipes" flow + sediment transport (rivers, lakes, deltas)
src/sim/droplet.js      Particle raindrop erosion (long-term weathering, gullies, valleys)
src/sim/thermal.js      Thermal erosion / mass wasting (slopes relax to the angle of repose)
src/sim/vegetation.js   Forest / grassland / barren cover that grows, dies and protects soil
src/sim/volcanism.js    Eruptions, lava flow and cooling, ash fall, plutons and dikes
src/sim/forests.js      Forest types (rainforest, broadleaf, conifer, dry woodland, swamp)
src/sim/fire.js         Wildfire: ignition by lava, spread through vegetation, burn scars
src/sim/tectonics.js    Faults: normal, reverse and strike-slip, slipping in earthquakes
src/render/effects.js   Eruption plumes, vent glow, fault traces and earthquake shake
src/tools/brushes.js    Tool definitions + undo history
src/render/terrainRenderer.js  Terrain/water meshes and colouring
src/render/biomes.js    Biome definitions and classification
src/ui/toolbox.js       Right-hand settings panel and bottom tool bar
src/ui/inspector.js     Inspect-tool readout
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
