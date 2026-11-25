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

It's also online at <https://piguyoverthere.github.io/Geology-Simulation-Toolbox/> (GitHub Pages,
served from the `gh-pages` branch: update it with `git push origin master:gh-pages`). Simulations
are kept per site, so the online version starts with an empty list; export a simulation here and
import it there to move it.

## Simulations, saves and versions

The page opens on a grey **home screen** listing your simulations, all kept in the browser
(IndexedDB) until you delete them:

- **New simulation**: name it and set up the terrain (preset, seed, map size), the sea (as the
  terrain comes, on or off, and its level), and whether seasons, civilization and erosion are on.
- **📖 Guide** opens this guide and *How the simulation works* (docs/GEOLOGY.md) as web pages
  (`docs.html`), with a contents list; Help → Guide in the menu bar opens it too.
- **Open** a simulation to carry on where you left off. It saves itself every 30 seconds and when
  the page is hidden or closed. The 🏠 button at the top of the side panel goes back home.
- **Restore an earlier save**: each simulation keeps earlier saves to roll back to, one when each
  session starts and one an hour while it runs (the oldest thinned out past 24). Rolling back keeps
  the save you had in the history too.
- **Export** a simulation to a `.geolevel` file, **Import from file…** to add one, **Rename**, **Delete**.
- Levels from before the home screen appear as **My simulation**.
- While a simulation opens (or a new one is made, or you travel to another world-grid cell) a
  **loading screen** shows what it's doing and how far along it is.
- Simulations are kept **per web address and per browser**: the live site, `localhost:8174` and
  another browser each have their own list, so a simulation made on one doesn't show on another
  (use Export and Import to move it). If the list itself is ever lost, the home screen rebuilds it
  from the saves still stored, with their earlier saves and (for saves from 1.2 on) their names.
- The app's **version** is at the bottom, with a **Run an older version** menu: every release is
  kept in `versions/<version>/`. Older versions from before 1.2 don't have the home screen; they
  open the level that the new version lists as *My simulation*.
- **Experimental prereleases** (versions like `1.2.0-beta.1`): new features that may still be
  unstable. When there's one newer than the version you're running, a **Try a prerelease** panel
  on the right of the home screen offers it (and the versions menu marks it *experimental*);
  a prerelease shows a warning banner on its own home screen.
- **Going back isn't supported:** every save records the version of the app that made it, and a
  simulation (or file) saved by a newer version can't be opened in an older one; its card says
  which version it needs instead of *Open*. So try prereleases on a new simulation or an exported
  copy. (Versions before 1.2 predate this check.)
- Make a release with `python3 tools/release.py <version> "<what changed>"` (add `--pre` for a
  prerelease) after setting `APP_VERSION` (and `IS_PRERELEASE`) in `src/version.js`.

## Ecosystems and people (1.2, experimental)

Version 1.2.0-beta.1 adds (see *How the simulation works* for the details and test results):

- **Groundwater**: rain recharges it, it seeps out into streams in dry spells, towns pump it down
  (dry wells, sinking ground). Overlays: *Groundwater*, *Groundwater drawdown*.
- **Climate change** (Civilization setting): the towns' greenhouse gas slowly warms the climate and
  raises the sea; the land's **forest carbon** (overlay *Forest carbon*) feeds it.
- **Fire fuel and megafires**: fuel builds where nothing burns; light fuel means surface fires the
  trees survive, heavy fuel crown fires that kill them. **Fire suppression** and **prescribed
  burns** (Civilization). Overlay *Fire fuel*.
- **Trophic cascades**: grazers fear their predators; towns' livestock is taken by predators, which
  towns cull (**Predator control**, **Herding & fencing**). **+ Deer & wolves** starter food web.
- **Pollinators** that farm yields depend on, and **Pesticides** that kill them. Overlay *Pollinators*.
- **Fire followers**: fireweed, fire poppies and animals (**+ Fire followers**: fire beetles,
  woodpeckers, fireweed moths) that live on recent burns, but only the smaller ones. Overlay *Fire
  followers*.
- Towns, roads and parks the sea covers for good are **washed away**.
- Grassland the sea covers turns into **beach**, which takes decades to turn back into grassland.
- Coastal towns build up dense **waterfronts**: quays paved over the beaches with a sharp drop-off,
  docks out over dredged water, and packed streets behind (Civilization: **Waterfronts**).
- The app asks the browser to keep its storage, so a disk running low doesn't clear your
  simulations.
- Tools for **Fire fuel**, **Fire flowers**, **Groundwater**, **Fish**, **Wildlife crossings** and
  **Fish ladders** (Shift reverses each).
- More **Wildlife** settings: Food abundance, Predation, Roaming, Hard winters, Roadkill, Wildlife
  disease, Small burn size.
- **Roads** that kill and split land animals, with **Wildlife crossings**; **dams** that stop fish
  runs, with **Fish ladders**.
- **Fish stocks** that collapse when overfished and recover slowly, **Fishing quotas**, marine
  reserves that restock the water. Overlay *Fish stocks*.
- **Restoration** (setting): towns replant worn-out land and take down dams that block fish runs.

## The window

- **Menu bar** along the top, like a desktop app's: **File** (new simulation, all simulations,
  save/load a level file, new map size, keep saving automatically), **Edit** (undo, redo, clear
  drawings), **View** (every overlay, and what's shown: vegetation, clouds, water, sea, town labels,
  park names, trail names, wireframe), **Simulation** (play/pause, speed, erosion, seasons,
  civilization, sea, generate new terrain), **Tools** (every tool by group, with its key),
  **Window** (the Graphs and Biomes & trees windows, the side panel, each settings tab) and
  **Help** (controls, the guide, version). On the right: the technical readouts (frame rate,
  water, speed, sediment, eroded, deposited, springs, storms, events), the open simulation, when it
  was last saved, and play/pause.
- **Tool bar** along the bottom: compact icon buttons (the group names show on hover and in the
  Tools menu), with the brush size and strength at the end.
- **Side panel** on the right: settings by topic (Map, Land, Climate, Sea, Life), the overlay key,
  and help for whatever is under the mouse.

## Controls

| Input | Action |
| --- | --- |
| Left-drag | Use the selected tool |
| Right-drag | Orbit the camera |
| Middle-drag | Pan |
| Scroll | Zoom |
| Shift + tool | Invert it (Raise ↔ Lower, Rain → soak up, Spring → remove) |
| `1`–`9`, `0`, `-`, `=` | Pick a tool (numbers shown on the tool bar) |
| `D`, `L`, `F` | Draw paths and polygons, Lightning, Wildfire |
| `C`, `N`, `G`, `W`, `B`, `U` | Storm, Snow, Glacier, Drain, Sink land, Raise land |
| `A`, `K`, `P`, `O` | Age forest, Lake, Cross-section, Shoreline |
| Enter / double-click, Backspace, Esc | While drawing: finish, remove last point, cancel |
| `[` / `]` | Shrink / grow brush |
| Space | Pause / resume the simulation |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo / redo terrain strokes |

Hover any tool or control to see what it does in the info box at the bottom right.

### Tool bar (bottom)

Every tool as a small icon, grouped: **View** (Orbit, Inspect, Draw), **Weather** (Storm: click to
bring a storm in over a spot, snow or rain depending on the cold, Shift for a thunderstorm; Snow:
paint snowpack, Shift to clear; Glacier: paint ice into a valley and watch it flow, carve a U-shaped
trough and leave moraines, Shift to remove; Lightning: click for a strike that may start a fire;
Wildfire: paint fire onto the vegetation, Shift to put it out), **Water** also has Drain (soak up
water and sediment), **Sculpt** (Raise, Lower, Smooth,
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
- **Sink land** ⤓ / **Raise land** ⤒: hold to lower or raise the whole map at once (regional
  subsidence or uplift); Shift reverses either.
  Rock layers, lava and the erosion baseline move with the ground. Lower land is warmer, and with
  the sea on, the coast floods inland.
- **Fault** ⫽: drag a fault line; it slips in a series of earthquakes (the camera shakes).
  Normal faults drop a block, reverse/thrust faults raise one, strike-slip faults slide the two
  sides past each other, offsetting rivers and rock.

**Draw** ✎ marks up the map the way a globe viewer's path and polygon tools do. Click to add
points; double-click or Enter finishes a path, and clicking the first point again closes a
polygon (filled). Lines are draped over the ground and follow it as it erodes. Each shape is
labelled with its length along the ground, climb and descent, height range and, for polygons,
area. **Side panel → Drawings** picks path or polygon and the colour, and lists every shape (click
its dot to recolour, ✕ to delete).

**Month bar** (top of the view): the 12 months tinted by season, with a marker at today's date
and its name (e.g. "Mid August"). Click a month to jump the year there. With Seasons off it offers
to turn them on.

**Cross-section** ⊟ (View group): drag a line across the land and a geological slice opens along it,
showing the rock layers underground in their colours (folded strata, intrusions, lava and ash),
the soil, and any snow, glacier ice and water on top, with a height scale. It follows the line live
while you drag. **Age forest** ⌛ (Life): paint to age forest toward old growth (Shift: young
again). **Lake** ◒ (Water): click a hollow to fill it to its spill level.

**Shoreline** ≈ (Water): paint along a coast to make it a mudflat, sand beach, shingle beach,
rock cliff or basalt boulder beach (pick the type under **Ocean & coast**); Shift returns it to
the automatic choice. **Pollute water** ☣ (X) pours pollutants into the sea (Shift: mud);
**Clean water** ✧ (V) clears silt and pollutants so dead sea beds can recover.
**Stir water** ↻ (M) mixes pollutants and silt by hand, evening them out across the brush (nothing
is removed); drag it to smear a plume along.

**Ocean** tools (with Shoreline, Pollute, Clean and Stir): **Current** ➜ (J) drag across the sea to
push the water along, carrying what's in it; **Fresh water** ⊚ (Y) makes it brackish like a river
mouth (Shift: saltier); **Plankton bloom** ✺ (T) seeds a bloom (Shift: clears it); **Oxygen** ○ (E)
aerates the water (Shift: strips the oxygen out, a dead zone); **Sea ice** ❄ (I) freezes it (Shift:
melts it); **Storm surge** ⇡ (R) raises the whole sea, flooding low shores (Shift: lowers it); **Waves**
〰 (Q) whips up big waves that break as surf and pound the coast. **Pollution source** ⊗ (H): click to place a
source that pours pollutants into the nearest seawater without end (a sewage outfall or factory pipe),
marked by a brown post; Shift-click removes nearby ones. **Current path** ⇝ (S): draw a permanent current
like a Draw path: click points across the sea, Enter or double-click to finish (click the first point
again for a circling eddy; Backspace undoes a point, Escape cancels). The sea flows along it for ever,
carrying what's in the water, shown as flowing dashes and arrows; brush strength sets its speed and
brush size its width. Shift-click removes the nearest one.

**Civilization** (toolbar): **Settle** 🏘 founds a town at the most suitable spot near your click (a
comfortable climate, a river, lake or coast nearby, fertile flat land, timber and fish, safe from
floods; Shift-click abandons a town); **Road** 🛣 builds a road along a drag, terracing the hills to an
even grade, paving it and bridging rivers (Shift-drag tears it up). Towns clear patchwork farmland (three cells of it for every cell of town: any land, cleared,
levelled or terraced and irrigated from the nearest river or lake, which it draws down and pollutes),
grow toward what it feeds (drought years cut harvests), pave their streets (flat, sealed, nothing
grows), and pollute: lightly into water beside them and always heavily down the rivers below them to
the sea. They grow along their roads, crowded towns found daughter villages, big neighbours build
roads to each other, floods, fires, lava and storm surges cost them people, and dwindling towns are
abandoned and grow over. The Life tab lists the towns with population graphs; the Graphs window has
population, towns, paved land, farmland and polluted rivers. Sliders: **Population increase** and **Expansion speed**; roads must be kept up
by nearby towns or they break up, busy roads are widened to two or three lanes, towns past a few
hundred people build a mass-paved industrial area on the water that pollutes on a very large scale, big towns dam river valleys for reservoirs (blocking fish, polluting), roads cross water on bridges
that drip runoff into it, fields only go on ground flatter than the **Max farm slope** slider (steeper land must be terraced first), towns dig irrigation canals out to dry fields, push exploratory roads into deep forest, graze livestock in the woods (lowering forest health), need a harbour past a thousand people, build two cells of town (housing plus infrastructure) per cell of housing, and pollute the sea heavily (the **Destruction** slider scales burning, pollution and terracing), the **Harbour** tool builds (or moves) a town's harbour on any shore you click, the **Clear fields** tool turns farmland back into bare, worn-out ground, towns sink mines into hard rock (poisonous spoil heaps, foul drainage), their smoke drifts downwind as acid rain (Air pollution overlay), wildfire smoke drifts downwind too and makes the people of towns under it ill (Smoky air graph), every wildfire is numbered and the big ones named (Historic wildfires overlay, Fire history list), tree diseases (pine blister rust, sudden oak death, alder root rot, needle blight, birch & aspen canker, cedar leaf blight) that you introduce with the Tree disease brush attack their host trees, killing or stunting the young ones and now and then killing whole clumps, jump far across the map on the wind, travel along the roads and footpaths, and burn out where the surviving trees are resistant, coming back in waves, people migrate between linked towns, epidemics break out and spread along trade routes, and overgrazing turns dry land to desert; plantations are planted with an invasive exotic pine that escapes into the wild forest and spreads along the roads (no wildlife lives in it; Invasive trees overlay and brush), plantations on old fields regrow fast; towns set aside parks only around what is hard to find (Old Growth Reserves, Groves of trees rare on the map, Preserves of rare biomes, Refuges where wildlife is thick, the Last Woods of a cleared district, Beach parks on unbuilt beaches, Commons made from a hemmed-in old town's own fields, and vast Wilderness Areas in the remotest land; every map also has one or two large National Forests where no timber is cut, towns lay Old Forest Trails out to old-growth stands that may later become parks, each with its own restrictions; parks next to each other merge into larger ones) with trails through them (irregular outlines 10–18 cells across, scaled by a Park size slider, made as often as the Park frequency slider says, that stop at fields, roads and water), the **Footpath** tool lays named trails (no upkeep) with their names written along them, the **Bulldoze** brush tears down towns, roads, industry, harbours, dams and canals (Shift: fields and plantations too), the **Plantation** brush plants timber for the nearest town, sewage (and field runoff) is piped straight out to the nearest sea, a *Land use (clear view)* overlay shows fields, plantations (outlined), towns and roads with no pollution, clouds or smoke over them, towns keep timber plantations (twice their farmland, on forest land, felled and regrown in cycles, each linked to the town by road), big towns quarry whole hills and mountains away and tip the rock into breakwaters reaching out to sea and into reclaimed land, farmland keeps spreading even when a town isn't growing, fires are set to clear forest and escape by accident (worst when dry), bigger towns cut hills and slopes into level terraces and
dump the spoil into the sea to build new land (polluting it), coastal towns armour their shores with
quays (walled, raised above the tide, dredged deep in front: harbours are easy there, the sea bed
suffers) and build harbours whose fishing boats catch sea life, trawl the sea bed, pollute a little and carry settlers to
islands, young towns hunt your land animals, and roads between towns wind
over the land along valleys and contours.

**Wildlife**: design your own animals. Under **Wildlife → + Add animal**, name it, pick its colour and
the temperatures it likes (it thrives inside that range and fades out beyond it), where it lives (anywhere on land, forest, meadows, mountains, streams and ponds, the sea, coastal
shallows), what it eats (grass, shrubs and young trees, deciduous trees, conifers, plankton, seaweed,
and any of your other animals), how fast it breeds, how far it roams and whether it migrates (to the far side of the map with the
seasons, north–south or east–west, or wandering the whole map after food), and its habits (avoids deep
snow, harmed by pollution, killed by hard frost, builds dams, kills the trees it eats, fertilises the
ground, swims up rivers in autumn). Paint it onto the map with the **Animal** tool 🐾 (Paint button,
Shift removes). Each lives where it finds food, starves where it doesn't, is thinned out by whatever
eats it, and changes the place (grazers stop forest regrowing, dam-builders raise ponds, tree-killers
leave fire fuel, plankton- and seaweed-eaters crop the sea). Each has a small live population graph
in the Wildlife panel (click it to expand a chart, with what it eats and what eats it for comparison). They appear in the map key, the
**Wildlife** overlay, the inspector and as dots on the map, and are saved with the level.

**Inspect** shows a readout of the spot under the cursor: biome, altitude (and height above
sea level), slope, soil wetness, climate moisture, when it was last watered (rain, river or
lake), surface water depth and speed, sediment load, plant cover, rock hardness, erodibility,
and how much it has been eroded or built up since the baseline.

### Side panel

Sections are grouped from everyday to specialist, and each remembers whether you left it open:

- **Erosion**: a master **Erosion enabled** switch, then the processes (river erosion,
  background weathering, landslides, angle of repose, big landslides with frequency and rain
  weakening, bulk erode).
- **Volcanism & tectonics**: eruption type and size, intrusion type, fault type, slip and number
  of earthquakes, and a button to stop all running events.
- **Water & climate**: sim speed, global rain, evaporation, plant growth, climate wetness, and
  **Temperature** (sea-level °C), **Lapse rate** (how much colder it gets per unit of height), which sets the tree line, forest types and whether clouds drop
  snow or rain, and **Wind direction**, which decides where clouds form (windward slopes wet, rain
  shadows dry), **Storms** (ragged rain/snow storms drifting downwind that run out of moisture
  beyond mountain ranges; thunderstorms in warm weather), **Snowstorms** (how many snowstorms build over the mountains each year), **Lightning** (strikes can start
  wildfires, worst in dry pine woods), **Seasons** with **Season speed** and **Season swing** (winter
  snowpack, spring meltwater floods, autumn colours sweeping down from the high slopes: birch and
  aspen yellow, maple red-orange, oak brown) and regional **Evaporation** (faster in sun, heat and on
  bare ground; slower in shaded valleys and under forest) and **Dry summers** (with Seasons: rain
  mostly from autumn to spring, and a summer fire season with dry lightning storms), and **Snow slope
  limit** (the steepest slope snow builds up on).
The settings are on five tabs at the top of the panel: **Map** (level, overlays and key, terrain,
drawings, view), **Land** (water, erosion, geology, volcanism and tectonics), **Climate** (climate,
seasons, weather), **Sea** (ocean and coast) and **Life** (wildlife).

- **Overlays**: colour the map by one data layer (biomes, vegetation, tree species, forest age,
  coast & ocean (shore types, dunes, mangroves, ocean biomes), water quality, wind speed, wildlife, forest density, forest health, topographic map (elevation bands with contour lines, index contours every fifth), temperature,
  precipitation, snow depth, glacier ice, deciduous trees, wetness, soil chemistry, soil depth, bare rock, rock type, rock hardness, erosion/deposition, slope) with a matching legend, and a **Show vegetation** switch that
  strips plants away to reveal bare ground and bedrock.
- **Drawings**: shape (path or polygon), colour, labels on/off, the list of drawn shapes. A polygon
  can be made a **protected zone** (🛡): no towns, farms, industry or new roads inside it.
- **Geology**: rock types on/off, hardness contrast, layer thickness, sea level, edge drainage.
- **Climate → Environment**: ready-made climates applied to the current map without changing the
  terrain: Pacific Northwest coast, Inland Northwest, Alpine, Mediterranean, Tropical rainforest,
  Desert, Boreal / subarctic and Arctic, plus **Puget Sound** (big tides, cool water, marine fog, grey
  winters, rare lowland snow; it also turns the sea on, flooding the lowest ground if it was off). Each sets temperature, seasons, rain, storms,
  snowstorms, lightning, ocean fog, wetness, evaporation and tides at once.
- **Ocean & coast**: sea on/off and level, tide range and period, wave erosion, coral growth,
  tidal currents, storm surge, plankton blooms, pollutant spread, and
  the Shoreline tool's type. **Weather** has **Ocean fog** (the marine layer).
- **Level**: **Save level** downloads everything (terrain, water, vegetation, soil, snow, rocks,
  lava and burn scars, springs, drawings, camera and every setting) to a `.geolevel` file, and
  **Load level** opens one. With **Keep level on reload** (on by default) the level is also
  autosaved to the browser every 30 seconds and when you leave the page, and restored when the page
  reloads, so updates don't cost you your level. Each map size keeps its own; **Generate** starts a
  new one. If the browser won't let the page save (site data blocked, a private
  window, a full disk), a red warning appears over the map with a button to save the level to a file,
  and the browser asks before you reload or close the page.
- **Terrain**: map size (128–512 cells per side; bigger maps show more land and run slower),
  presets (hills, mountains, plateau, volcano, Cascade Range, Puget Sound, flat), seed, undo/redo, PNG
  heightmap export/import. The **Cascade Range** preset builds a north–south range with a rugged
  northern cluster, a low pass like the I-90 corridor, big stratovolcanoes in the south, a wet
  forested west and a dry plateau in the rain shadow, with westerly wind and dry summers. The
  **Puget Sound** preset makes the whole map the Sound: open water broken by clusters of lobed,
  north–south islands like Vashon and Maury, crowded in places and sparse in others, with open
  basins between and straight beaches below steep bluffs. The **Showcase (demo)** preset packs in a
  bit of everything, west to east: open ocean with island clusters, a sheltered tidal bay, a forested
  coastal plain, a snowy range with a volcano (glaciers, lava), and a dry, wind-worn sandstone plateau
  in its rain shadow, with real seasons, storms, big tides and a sea right at coral's limit. The
  **Forested plains** preset is low, gently rolling plains cut by slow rivers, under a mild, wet
  climate with rain all year, few droughts and little lightning. It's tuned for dense, continuous
  forest: wetter vegetation, forest allowed on nearly all the land, faster growth and seed spread, and
  slower fire. Within a few dozen steps nearly all the land is closed-canopy forest. Presets
  bring their own settings and put back the previous preset's when you switch.
- **Population** overlay: a heatmap of where the towns' people live (people per cell, log scale).
- **Single biome** overlay: one biome, picked in the legend, highlighted on the map with everything else grey.
- **Biomes & trees** window (top right of the map, click to open): three line graphs over time on
  tabs, one line per biome (share of the land, the same categories as the Biomes overlay, looking
  through snow), snow cover and glacier ice, and one line per tree species (share of the trees,
  steady through the seasons), recorded every couple of seconds and saved with the
  level; hover a name below the graph to pick out its line.
- **Graphs** window (bottom left of the map, click to open): how the whole map changes over time,
  sampled every couple of seconds while the simulation runs and saved with the level: forest cover,
  grassland and shrubs, bare ground, old growth, forest health, tree density, snow cover, glacier ice,
  burnt ground, dead forest, average temperature, and for the sea its area, clean water, low-oxygen
  water, healthy sea beds, coral reef and sea ice. Each row shows its value and a small graph; click
  it for the full chart.
  **Probes** 📍 (toolbar, key Z): click to drop a measuring station; each gets its own tab in the
  Graphs window recording that spot over time: temperature, rain or snow, snow depth, surface water,
  soil wetness, plant cover, tree density, forest health, wind, at sea the water quality, oxygen and
  salinity, the animals there, and a coloured strip of the biome (or sea bed) through time. Shift-click
  removes probes; a probe's tab also has a Remove button.
- **View**: clouds, water, **sea** (hide the sea's surface to see the sea bed: its sand and silt,
  seagrass, kelp, reefs and die-offs; the sea keeps running), wireframe. The **Coast & ocean**
  overlay draws the sea nearly clear so its sea-bed biomes show through.

Try this: pick **Layered plateau**, turn on **Sea** at level 8, drop two **Springs** on top, and set
**Overlays → Erosion / deposition**. Red shows where ground was carved away and blue shows where
sediment piled up, such as the delta forming where the river meets the sea.

## The world grid

The world goes on past the map's edges: the **World grid** section of the Map tab shows the cells
around the one you're in. Click a neighbour to travel there (a new cell is generated to continue the
land). The cell you leave is frozen and catches up on the years it missed when you return. Rivers
cross the borders, animals wander across, the sea's pollution mixes over them, boats carry settlers to neighbouring cells, and towns build roads to the towns in neighbouring cells. Your existing level is
the centre cell. See docs/GEOLOGY.md for details.

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
src/sim/climate.js      Temperature (height, sun, seasons), clouds, precipitation, evaporation, snowpack
src/sim/weather.js      Storms, thunderstorms and lightning
src/sim/glacier.js      Glaciers: ice flow, U-shaped valley carving, moraines, melt
src/sim/coast.js        Tides, shore types, wave erosion, beach sand, dunes, mangroves, ocean biomes
src/sim/waterQuality.js Seawater silt and pollutants, filtering by sea beds, die-off and recovery
src/sim/ocean.js        Water temperature by place, tidal and wind currents, salinity and estuaries, plankton blooms and oxygen, sea ice, storm surge, surf
src/sim/wind.js         Wind field (fetch over the sea, shadows behind land) and slow wind erosion of sedimentary rock
src/sim/ecology.js      Wildlife: the animals you design, what they eat, their habits and effects
src/render/wildlife.js  The animals as dots on the map
src/render/currentPaths.js  Drawn permanent currents
src/sim/stats.js        Whole-map statistics over time (the Graphs panel)
src/sim/probes.js       Probes: per-spot readings over time (Graphs window tabs)
src/sim/civilization.js Towns: siting, farms, paving, roads, pollution downstream, growth rules
src/render/townLabels.js Town names on the map
src/render/boats.js     Fishing boats on the water
src/core/environments.js  Environment presets (ready-made climates)
src/sim/phenology.js    Seasonal leaves: autumn colour, leaf fall, spring flush
src/sim/species.js      Tree species, their preferences, and each cell's forest mix
src/sim/forests.js      Forest types (jungle, tropical dry, temperate rainforest, broadleaf, conifer, dry woodland, swamp)
src/sim/fire.js         Wildfire: ignition by lava, spread through vegetation, burn scars
src/sim/landslides.js   Rain-triggered big landslides, sector collapses and debris avalanches
src/sim/tectonics.js    Faults: normal, reverse and strike-slip, slipping in earthquakes
src/render/drawings.js  Draw tool: draped paths and polygons with measurements
src/render/effects.js   Eruption plumes, vent glow, fault traces and earthquake shake
src/tools/brushes.js    Tool definitions + undo history
src/render/terrainRenderer.js  Terrain/water meshes and colouring
src/render/biomes.js    Biome definitions and classification
src/ui/toolbox.js       Right-hand settings panel and bottom tool bar
src/ui/inspector.js     Inspect-tool readout
src/ui/monthbar.js      Month bar: today's date in the seasonal year
src/ui/section.js       Cross-section panel: a geological slice along a line
src/core/save.js        Level save/load (.geolevel files) and browser autosave
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
