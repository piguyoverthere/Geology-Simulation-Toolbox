# The geology behind the simulation

Erosion is the process of breaking rock down and moving the pieces somewhere else. It has three
parts that this sandbox models:

1. **Weathering** breaks rock into smaller pieces (frost, roots, chemistry, rain impact).
2. **Transport** moves those pieces downhill (gravity, running water, wind, ice).
3. **Deposition** drops them when the transporting agent loses energy.

Every landform you sculpt sits between two opposing forces. Uplift (tectonics, or the Raise
tool) builds relief, and erosion tears it down. Gravity always wins in the end, so a landscape left
alone slowly turns into a low plain (geologists call this a *peneplain*).

---

## 1. Running water: the virtual-pipe model (`src/sim/water.js`)

**Real world.** Rain that doesn't soak in runs off as sheet flow, collects into rills, then
gullies, streams and rivers. Faster water carries more sediment. A river's *transport capacity*
grows roughly with flow speed and slope. Where a river speeds up (on steep ground) it cuts down into
its bed. Where it slows (entering a lake, the sea, or a flat valley) it drops its load. That is
how **deltas**, **alluvial fans** and **floodplains** form.

**Simulation.** Each grid cell is a water column linked to its four neighbours by virtual pipes.
Water accelerates through a pipe in proportion to the difference in water-surface height
(`ground + water`). That one rule makes water flow downhill, fill basins into lakes, spill over
their rims, and gather into channels. From the flow we get a velocity per cell, and then:

```
capacity = Kc · sin(slope) · speed · depthFactor
if sediment < capacity:  erode   Ks · (capacity − sediment) · erodibility
else:                    deposit Kd · (sediment − capacity)
```

Suspended sediment is carried along with the velocity field. When a puddle evaporates completely,
whatever it carried settles out, which is why dried lakes leave flat lake beds.

**Try it.** Drop a **Spring** on a mountain and watch it find a path, pool in a basin, overflow
and cut a notch in the rim. Switch to **Overlays → Erosion / deposition**: the channel shows red
(cut) and the lake bed shows blue (filled).

> Model: Mei, Decaudin & Hu, *Fast Hydraulic Erosion Simulation and Visualization on GPU* (2007).

---

## 2. Long-term rainfall: droplet erosion (`src/sim/droplet.js`)

**Real world.** Over thousands of years, countless rainstorms carve a landscape's drainage
network. Valleys deepen and branch upstream (*headward erosion*), ridges sharpen between them, and
sediment collects in valley floors.

**Simulation.** Instead of simulating water as a fluid, we release thousands of individual
raindrops. Each one rolls downhill with a bit of momentum, picks up sediment while it is moving fast
and going downhill, and drops it when it slows or climbs into a pit. A single droplet stands for
centuries of rain on that spot. This is much faster than the fluid model for big time spans, but it
has no lakes and no visible water.

**Try it.** Press **Erode ×50k drops** on the *Ridged mountains* preset. The smooth noise turns
into branching valleys with sharp ridges and sediment-filled valley floors.

> Model: Hans Theobald Beyer, *Implementation of a method for hydraulic erosion* (2015).

---

## 3. Landslides and scree: thermal erosion (`src/sim/thermal.js`)

**Real world.** Loose material can only pile up so steeply before it slides. That maximum is the
**angle of repose**, about 30–40° for dry rubble (like a sand pile's sides). Frost wedging keeps
prying blocks off cliffs, which tumble down and collect as **talus/scree slopes** at the base.
Solid, hard rock can hold much steeper faces than loose or soft rock.

**Simulation.** For every cell, if the slope to any neighbour is steeper than the repose angle, a
fraction of the excess height moves down to the lower neighbours. Repeat until everything is
stable. With rock types on, harder rock gets a steeper limit.

**Try it.** Raise a tall spike with a small brush, then use **Crumble** on it, or set the
**Repose angle** to 20° and watch the whole landscape slump.

---

## 4. Rock types: differential erosion (`src/core/rocks.js`)

**Real world.** Bedrock is not one material. Granite and basalt are tough; shale crumbles. Where
soft rock wears away faster than the hard rock beside or above it, the hard rock is left standing
as ridges, ledges, caprock, mesas and hoodoos. This is **differential erosion**, and it's why
the Grand Canyon has stepped walls and why granite so often forms the highest peaks.

**Simulation.** Each map is divided into geological **provinces**, each with its own rocks:

| Province | Rocks | Story |
| --- | --- | --- |
| Sedimentary basin | sandstone, shale, limestone, conglomerate | layers laid down by seas, rivers and deltas |
| Volcanic plateau | basalt (mostly), andesite, rhyolite | stacked lava flows |
| Plutonic core | granite | magma that cooled slowly underground, now exposed under high ground |
| Metamorphic belt | gneiss, schist, marble | rock baked and squeezed around the granite |
| Stratovolcano (volcano preset) | basalt base, andesite flanks, rhyolite summit | lava gets more silica-rich over a volcano's life |

| Rock | Hardness | Notes |
| --- | --- | --- |
| Granite | 0.95 | hardest; domes and peaks |
| Basalt | 0.85 | dark lava flows; plateaus and cliffs |
| Gneiss | 0.85 | banded metamorphic |
| Andesite | 0.80 | grey volcano-building lava |
| Rhyolite | 0.70 | pale, silica-rich lava |
| Marble | 0.60 | recrystallised limestone |
| Limestone | 0.55 | ancient sea floor; dissolves into karst |
| Sandstone | 0.50 | cemented sand; cliffs and arches |
| Schist | 0.50 | flaky, mica-rich |
| Conglomerate | 0.45 | cemented gravel |
| Shale | 0.15 | compacted mud; softest |

Layered provinces are three-dimensional: which rock is at the surface depends on the current
ground height, so as rivers cut down they expose the layers underneath. The layers dip and
fold, so they wander across the landscape instead of tracing contour lines. Hardness scales how
fast water erodes the rock and how steep it can stand before sliding. **Hardness contrast** sets
how much the rocks differ.

**Try it.** Choose **Overlays → Rock type** to see the geological map, or untick **Show
vegetation** to see the bare rock in the natural view. Run **Erode ×50k drops** with high
hardness contrast and watch granite and basalt stand up as ridges while shale valleys open
between them. Hover with **Inspect** to read the bedrock and province anywhere.

---

## 5. Volcanoes and intrusions (`src/sim/volcanism.js`)

**Real world.** How a volcano behaves depends mostly on how much silica its magma holds:

| Magma | Lava | Eruption style | Landform |
| --- | --- | --- | --- |
| Basaltic (low silica) | hot, runny | gentle fountains and long flows, often from fissures | broad shield volcanoes, lava plateaus |
| Andesitic | sticky | thick flows plus ash explosions | steep, layered stratovolcanoes |
| Rhyolitic (high silica) | very viscous, gas-rich | violent explosions, huge ash clouds | craters and calderas, lava domes, ash plains |

Magma that never reaches the surface cools slowly into **intrusions**. A **pluton** is a big body
of granite. It pushes the ground above into a dome, and only once erosion strips away the cover
does the granite appear at the surface. A **dike** is a vertical sheet of magma that fills a
crack. Basalt dikes are harder than the rock around them, so erosion leaves them as walls.

**Simulation.** Lava is a thick, sticky fluid: it only flows when its surface slope beats a yield
strength (much higher for rhyolite than basalt), it slows down as it cools, and once cold it
solidifies into new rock of its type on top of the old ground. Explosive eruptions first blast a
crater, then drop ash that thins away from the vent and drifts downwind; it settles as soft **tuff**
and buries plants. All of it is real rock in the simulation: rivers erode lava flows and ash beds,
and cutting through them exposes what was underneath.

New volcanic ground is sterile: bare rock with no soil. Plants come back only as it weathers,
starting with sparse pioneers and reaching forest much later. Ash beds weather into fertile soil
within a short while; solid lava flows stay bare several times longer (moisture speeds this up).
Hover with **Inspect** to see a spot's "Fresh rock" level.

**Wildfire** (`src/sim/fire.js`). Lava is around 1000 °C, so plants it touches catch fire.
Fire races through forest, where the crowns touch and there's plenty of fuel, but barely crosses
grassland, and bare ground, water and rain stop it. It also runs faster uphill. Burnt land is left
as bare, ash-grey ground that regrows slowly, and until it does it erodes like barren ground, which
is why burn scars after eruptions and wildfires are prone to gullying and mudflows. In testing, a
small basalt eruption beside a forest burned ~93% of that forest but under 1% of the surrounding
grassland. **Wildfires** and **Fire spread** are in the Volcanism & tectonics panel.

**Try it.** From a hilltop, erupt each type at the same size: basalt runs 40–50 cells down the
valleys, andesite about 30, and rhyolite stays as a dome at the vent under a wide ash blanket.
Drop a pluton, run **Erode ×50k drops** a few times, and watch the granite core appear on the
**Rock type** overlay.

---

## 6. Faults and earthquakes (`src/sim/tectonics.js`)

**Real world.** Faults are breaks where blocks of crust move past each other. **Normal**
faults form where the crust is stretched: one block drops, leaving a cliff (a *fault scarp*), and
side-by-side normal faults make rift valleys. **Reverse** and **thrust** faults form under
compression: one block rides up over the other, stacking up mountains. **Strike-slip** faults move
sideways, like the San Andreas, offsetting rivers and ridges. Faults lock, build up stress and then
slip suddenly: each slip is an **earthquake**. Displacement is largest mid-fault and dies out at
its tips.

**Simulation.** A fault slips in a series of earthquakes, each rupturing part of the trace and
shaking the camera. Vertical faults raise or drop a block that tapers with distance from the fault;
strike-slip faults slide the ground (and its rocks, plants and intrusions) sideways. Rock layers
move with the blocks, so different rocks end up side by side across the fault. New scarps steeper
than the angle of repose crumble, and rivers adjust to the new slopes.

---

## 7. Vegetation: biomes that resist erosion (`src/sim/vegetation.js`)

**Real world.** Plants are one of the strongest controls on erosion. Leaves break the impact of
raindrops, leaf litter slows runoff, and roots bind the soil and even hold steep slopes together.
A forested hillside can lose soil hundreds of times more slowly than the same slope stripped bare.
It works in reverse too: once vegetation is lost (drought, fire, overgrazing, logging), the topsoil
washes away, and without soil plants struggle to come back. That feedback is behind badlands,
gullied farmland, and the Dust Bowl.

**Simulation.** Every cell has a plant-cover value from 0 to 1, shown as three biomes:

| Cover | Biome | Colour | Erosion rate |
| --- | --- | --- | --- |
| 0.66 – 1 | Forest | deep green | ≈ 0.15–0.5× |
| 0.33 – 0.66 | Grassland | light green | ≈ 0.6–1× |
| 0 – 0.33 | Barren | brown | ≈ 1–1.4× |

Cover slowly grows toward what each spot can support. That depends on moisture (a wet/dry
pattern across the map, plus extra near water), slope (cliffs stay bare) and height (forests thin
out above the tree line). Ground that is scoured, buried by sediment, or drowned under deep water
loses its plants. Forest also lets slopes stand about 30% steeper before they slide. Forests are judged as whole
stands (neighbourhood-averaged slope and moisture) and spread seed to their neighbours, so they
grow as continuous expanses. "Gentle" is relative: forest can take the gentlest half of the land.

**Water budget.** Every cell has a soil-moisture store. The local climate (some regions are
wetter than others), current rainfall and nearby rivers and lakes fill it, and plants drain it,
forests most of all. A forest needs moist soil to survive. When the supply drops (you remove a
spring, stop the rain, or turn **Climate wetness** down), the soil dries out over the following
seconds and forests **retreat** to grassland, then grassland to bare ground. Trees hang on longest
beside water. Use **Overlays → Wetness** to watch the water supply directly.

**Elevation.** Above the **tree line** it is too cold, windy and short-seasoned for trees, so
forest gives way to alpine grassland (tundra), which thins out to bare rock and scree higher up.
That's the same zonation you see climbing any big mountain. Drag the **Tree line** slider down
to watch forests retreat downhill, as they do in a cooling climate.

Land beside rivers, lakes and springs is the **riparian zone**: its water table is high, so plants
there regrow up to 6× faster and grow denser. That's why rivers in dry country are lined with a
ribbon of trees. Place a **Spring** on bare ground and watch a green belt spread along its channel.

**Try it.** Turn on **Global rain** and switch **Overlays → Erosion / deposition**: barren
patches turn red much faster than forests. Then **Shift-drag with Plant** to clear-cut a
forested hillside and watch gullies open up where the trees were.

---

### Forest types and soil

Forests differ with water, warmth and drainage:

| Forest | Grows where | Fire | Builds soil |
| --- | --- | --- | --- |
| Rainforest | wettest lowland ground | hard to burn | fastest |
| Broadleaf | moderately moist, gentle ground | normal | fast (rich leaf litter) |
| Conifer | cool ground within ~16 units below the tree line | burns hottest (resin) | slow (acidic needles) |
| Dry woodland | the dry edge of where trees survive | fire-prone | slow |
| Swamp forest | flat, waterlogged ground beside rivers and lakes | barely burns | fast (peat) |

**Soil depth** is built by plants: litter, roots and soil life turn rock debris into soil.
Forests build it about six times faster than grassland in practice (three times the base rate,
times their type's rate), so a stripped forest floor recovers most of its soil quickly while
grassland takes far longer. Erosion strips soil, lava and ash bury it, and fire burns part of it.
Deep soil holds water (wetter ground), speeds plant regrowth and slightly reduces erosion. Roots
also break up fresh lava and ash, so new rock next to a forest weathers into soil much faster
than isolated rock. See it with **Overlays → Soil depth**.

---

## 8. Biomes

Plant cover, soil water, slope and height together decide what the surface looks like:

| Biome | Where | Look |
| --- | --- | --- |
| Forest (5 types) | moist ground below the tree line: rainforest, broadleaf, conifer, dry woodland, swamp | shades of green |
| Wetland | flat, waterlogged ground beside rivers and lakes | dark olive |
| Grassland | moderately moist ground, or slopes too steep for forest | light green |
| Shrubland | semi-arid: drying soil, sparse cover | olive tan |
| Desert | dry and flat | sand yellow |
| Mesa | dry and steep: bare, banded rock (mesas, buttes, badlands) | orange-red |
| Barren | recently eroded or buried ground, not dry enough for desert | brown |
| Tundra | above the tree line | grey-green |
| Snow | high, gentle ground above the snow line | white |

Biomes follow broad climate regions (wet and dry zones a hundred or more cells across), so
they form large areas rather than patches. Forest never borders desert directly: a closed
canopy can't survive at a dry edge, so it keeps a belt of grassland (and a little scrub) between
itself and arid country, as in the prairie and savanna belts between real forests and deserts.
Whether dry ground is flat desert or steep mesa is judged over the surrounding land, relative to
the map's typical slope, so each forms whole regions.

Bare biomes (desert, mesa, barren) erode fastest, which is why arid landscapes are so sharply
carved: there are no roots to hold the ground when the rare storms come. Turn **Climate wetness**
down and watch forest give way to shrubland and then desert, while mesas emerge on the dry
slopes. **Overlays → Biomes** shows the categories; hover the legend for descriptions.

---

## 9. Drainage networks

**Real world.** Rivers organise into branching (*dendritic*) networks: small streams join into
bigger ones, which join a single trunk river. The more area drains through a point, the bigger and
deeper the channel. Closed basins with no outlet are rare outside deserts; water fills them until
it spills over and cuts an outlet.

**Simulation.** New terrain gets the same treatment before you start:

1. **Breaching**: every closed basin gets an outlet channel carved downhill to the map edge
   (priority-flood from the edges).
2. **River carving**: each cell drains to its steepest neighbour, and the drainage area through
   each cell is summed. Where more than ~150 cells drain through a point, a channel is cut, deeper
   for larger drainage areas. So tributaries feed into ever-deeper trunk streams instead of each
   spreading out into its own delta.

Sediment capacity also grows with discharge (depth × speed), so big rivers keep their load moving
and keep cutting down, capturing the smaller flows around them.

---

## 10. Base level and the sea

**Real world.** A river can't erode below the level of the water body it flows into. That
lowest level is its **base level**, usually the sea. When the sea rises, rivers slow down and fill
their valleys with sediment. When it falls, they cut down again, leaving river terraces behind.

**Simulation.** With **Sea** on, all ground below sea level is held under water. Rivers that
reach it slow down and drop their load, building deltas. Try raising and lowering the sea level
while a spring runs.

---

## Time scale

The sandbox mixes time scales on purpose. The water model runs in something like minutes to days
per second, so you can watch water move. The droplet and thermal models jump centuries per click.
A future "geological clock" could make this explicit.

## Further reading

- *Geomorphology: The Mechanics and Chemistry of Landscapes*, Anderson & Anderson (2010)
- Musgrave, Kolb & Mace, *The Synthesis and Rendering of Eroded Fractal Terrains* (SIGGRAPH 1989): the original thermal + hydraulic terrain erosion paper
- Sebastian Lague, *Coding Adventure: Hydraulic Erosion* (YouTube), a very approachable intro to the droplet model
