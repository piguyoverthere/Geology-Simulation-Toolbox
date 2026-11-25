# Modding

Mods are JavaScript files that add to the simulation: new tree species, tools, map overlays,
settings, rules of their own that run every step, and starter animals. They are kept in your
browser (like your simulations) and loaded when the page starts.

## Adding a mod

1. Open the **🧩 Mods** tab in the panel on the right.
2. Click **+ Add mod file…** and pick a `.js` file, or **+ Add from URL…** and paste the address
   of one (the site it's on must allow loading from other sites).
3. Click **Reload to apply**. The mod's tools appear in the tool bar, its overlays in the Overlay
   menu, its settings under **Mod settings**, and its starter animals under Wildlife.

Each mod has a switch to turn it off, and ✕ to remove it. A mod that fails to load is switched off,
and its error is shown next to it.

Mods run with the app's full access to the page, so only add mods you trust.

Try the example in the repository, [mods/example-mod.js](../mods/example-mod.js). It adds a tree
species (the baobab), a Seed bomb tool, an Altitude bands overlay, a Dry lightning setting that
starts fires, and an Elephants starter animal.

## Writing a mod

A mod is an ES module whose default export is a function. The app calls it once at start-up, before
anything is built, with the mod API:

```js
export default function (api) {
  api.addSpecies({ id: 'baobab', label: 'Baobab', color: [0.48, 0.47, 0.28], temp: [20, 40], moist: [0.1, 0.5], age: 0.8 });
  api.addTool('seedBomb', { label: 'Seed bomb', icon: '🌱', help: 'Greens up bare ground.', apply(ctx) { /* … */ } });
  api.addOverlay('altitude', 'Altitude bands', (world, i) => [0.5, 0.5, 0.5]);
  const rain = api.addSetting({ key: 'rain', label: 'Rain boost', min: 0, max: 2, step: 0.1, value: 1 });
  api.onStep((world, app) => { /* runs every 30 frames */ }, 30);
}
```

## The mod API

| Call | What it does |
|---|---|
| `api.addSpecies(def)` | A new tree species, competing with the others wherever conditions suit it. |
| `api.addTool(id, def)` | A new tool in the tool bar. |
| `api.addOverlay(id, label, color, legend)` | A new map overlay. |
| `api.addSetting({ key, label, min, max, step, value, help })` | A slider (or, if `value` is `true` or `false`, a switch) under **Mod settings**. Returns an object whose `.value` is the current setting; it's remembered between visits. |
| `api.onStep(fn, every = 30)` | Calls `fn(world, app)` every `every` frames while the simulation runs. A step that fails five times is stopped. |
| `api.addStarterAnimals(label, add, help)` | A button under Wildlife that calls `add(world)` to add animals. |
| `api.newAnimal(opts)`, `api.animalField(world, a)`, `api.canLive(world, a, i)`, `api.ensureEcology(world)` | The wildlife helpers, for making animals (see `src/sim/ecology.js` for the options). |
| `api.world`, `api.app` | The running world and app (inside steps, tools and overlays). |
| `api.params` | The simulation's settings: `civ`, `eco`, `fire`, `climate`, `season`, `water`, `coast`, `groundwater`. Change them to change how it behaves. |
| `api.species` | The list of tree species. |
| `api.version` | The app's version, e.g. `'1.2.2'`. |
| `api.log(...)` | Writes to the browser console, labelled with the mod's name. |

### Species

Required: `id`, `label`, `color` (`[r, g, b]`, each 0–1), `temp` (`[lo, hi]` °C it grows in),
`moist` (`[lo, hi]` soil wetness 0–1) and `age` (the forest age it does best in: 0 a pioneer of
young or burnt ground, 1 old growth).

Optional:

| Field | Meaning |
|---|---|
| `mapColor` | Its colour on the Tree species overlay. |
| `height` | Grown height in metres. |
| `ageW` | How fussy it is about forest age (higher is fussier). |
| `soil` | `'any'`, `'deep'` (needs deep soil), `'thin'` (wins on thin soil) or `'shallow'`. |
| `slope` | How steep a slope it tolerates, relative to the map's typical slope. |
| `chem`, `chemW` | Preferred soil chemistry (−1 acidic … +1 alkaline) and how fussy it is about it. |
| `flam` | How readily it burns (1 is ordinary). |
| `soilBuild` | How fast it builds soil (1 is ordinary). |
| `fireproof` | 0–1. Thick-barked trees live through smaller fires and gain ground after fire. |
| `giant` | Stores far more carbon. |
| `conifer` | Counts as a conifer. |
| `autumn` | `[r, g, b]`: it's deciduous, and turns this colour in autumn. |
| `coastal`, `riparian` | Grows only on the coast, or only beside water. |
| `help` | Its description. |

### Tools

`def` is `{ label, icon, group, help, click, apply(ctx) }`:
- `icon` is an emoji.
- `group` is the tool bar group to put it in (default `'Mods'`).
- `click: true` calls `apply` once per click instead of every frame while the mouse is held.
- `apply` gets `ctx = { world, app, x, z, radius, strength, dt, invert }`: the brush centre in grid
  cells, its size and strength, the time step, and whether Shift is held. Set `world.dirty = true`
  after changing the world, so the map is redrawn.

### Overlays

`color(world, i)` returns `[r, g, b]` (each 0–1) for cell `i`; the map shades it with the lie of the
land. `legend` is an optional list of `{ label, color }` for the map key.

### The world

The grid is `world.N` × `world.N` cells, and cell `i` is at `x = i % N`, `z = Math.floor(i / N)`.
Every layer is a typed array indexed by `i`. The main ones:

| Layer | What it holds |
|---|---|
| `height` | Ground height. |
| `water` | Surface water depth. |
| `vegetation` | Plant cover, 0–1 (above about 0.66 is forest). |
| `forestAge` | 0 young … 1 old growth. |
| `soil` | Soil wetness, 0–1. |
| `humus` | Soil depth. |
| `temperature` | °C. |
| `snow`, `ice` | Snow depth and glacier ice. |
| `fire` | Fire intensity; burning cells are also listed in `world.fireCells`. |
| `burnt` | 1 when freshly burnt. |
| `landUse` | 1 farmland, 2 town, 3 road, 4 industry, 5 harbour, 6 quay, 7 dam, 10 timber plantation, 13 dock. |
| `groundwater`, `fuel`, `fishStock`, `pollinators` | The later ecosystem layers. |

The sea level is `world.meanSea`. Towns are `world.towns` (`{ name, x, z, pop, … }`), and animals
are `world.animals`, each with a density layer `world['animal_' + a.id]`. Typed-array layers a mod
adds to `world` are saved with the simulation.

## Things to know

- **Simulations and mods.** A simulation saved with a mod's species or animals still opens without
  the mod: its species drop out of the forest mix, and its animals stay as ordinary animals.
- **Mods are per browser.** Like simulations, they're kept per web address and per browser.
- **Versions.** Mods are written against the current version. An older version of the app may lack
  things a mod relies on.
