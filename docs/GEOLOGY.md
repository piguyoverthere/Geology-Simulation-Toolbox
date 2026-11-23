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

**Rain and big landslides** (`src/sim/landslides.js`). Water in the ground pushes grains apart
and cancels much of their friction, so saturated slopes fail at far gentler angles: that's why
most landslides strike during or right after heavy rain. The stable angle here drops by up to 45%
(the **Rain weakening** slider) as ground saturates, and the sim keeps scanning for steep, tall,
soaked slopes. When one fails, a spoon-shaped section of hillside detaches and pours downhill as a
debris avalanche that strips plants and soil and spreads into a debris fan. Where relief is large
it can be a **sector collapse** that takes out a whole mountain flank. In a test on the mountains
map, heavy rain set off 57 big slides (2 flank collapses) where dry weather set off one.
**Inspect** shows each spot's saturation and how close its slope is to failing.

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

| Rock | Hardness | Soil it weathers into |
| --- | --- | --- |
| Granite | 0.98 | acidic |
| Basalt | 0.90 | fertile, base-rich |
| Gneiss | 0.88 | acidic |
| Andesite | 0.82 | slightly base-rich |
| Rhyolite | 0.72 | acidic |
| Limestone | 0.60 | alkaline |
| Marble | 0.55 | alkaline |
| Sandstone | 0.45 | acidic |
| Schist | 0.40 | slightly acidic |
| Conglomerate | 0.35 | slightly acidic |
| Tuff | 0.18 | near neutral |
| Shale | 0.08 | neutral |

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

In the most violent eruptions the eruption column collapses under its own weight and sends out
**pyroclastic flows**: avalanches of hot ash, pumice and gas that race down the flanks at highway
speeds, hug the ground and pour into valleys. They bury the land in ash (*ignimbrite*) and set fire
to everything they cross. This is what destroyed Pompeii and the forests around Mount St Helens.

Magma that never reaches the surface cools slowly into **intrusions**. A **pluton** is a big body
of granite. It pushes the ground above into a dome, and only once erosion strips away the cover
does the granite appear at the surface. A **dike** is a vertical sheet of magma that fills a
crack. Basalt dikes are harder than the rock around them, so erosion leaves them as walls.

**Simulation.** Lava is a thick, sticky fluid: it only flows when its surface slope beats a yield
strength (much higher for rhyolite than basalt), it slows down as it cools, and once cold it
solidifies into new rock of its type on top of the old ground. Explosive eruptions first blast a
crater, then drop ash that thins away from the vent and drifts downwind; it settles as soft **tuff**.
A light dusting only weighs plants down; thick ash buries them. Rhyolitic (and, more weakly,
andesitic) eruptions also collapse in pulses that launch rings of pyroclastic flows: heavy parcels
that run downhill under gravity, slow on climbs and through water, lay a trail of tuff, and ignite
the vegetation they cross, so the destruction spreads as wildfire rather than happening all at once. All of it is real rock in the simulation: rivers erode lava flows and ash beds,
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
than isolated rock.

**Forest age.** Forests mature slowly while left alone, from young regrowth to old growth over
roughly 1,000+ vegetation steps, and lose their age when they thin out, burn or are buried. Old
growth is darker and far more robust. In tests comparing all-young with all-old forest on the
same map: after a drought, 29% of old forest survived versus none of the young; old forest ground
eroded about a third less under rain; and the same eruption's wildfire burned half as much old
forest. Old stands also build soil up to 40% faster, hold steeper slopes and lose less cover to
disturbance. See it with **Overlays → Forest age**.

See soil with **Overlays → Soil depth**, and where rock shows through (thin
soil, cliffs, fresh lava and ash) with **Overlays → Bare rock**, which colours exposed bedrock by
type and leaves soil-covered ground pale.

---

### Climate: temperature, tree line and snow (`src/sim/climate.js`)

Air cools as it rises, about 0.4 °C per unit of height here (from the **Temperature** slider's
sea-level value). Slopes facing the sun are up to 3 °C warmer and shady ones up to 3 °C colder,
so the tree line and snow line sit lower on shaded faces. Trees need more than ~2.5 °C, so colder
ground becomes tundra and then bare rock. Plants grow more slowly in the cold, and heat dries soil
and evaporates water faster.

**Clouds, precipitation and snow.** Moist air blows across the map with the prevailing wind (the
**Wind direction** slider). Where it is pushed uphill it cools, its water condenses into cloud and
falls: windward slopes get the most rain and snow. Beyond the crest the air is dry, so the lee side
sits in a **rain shadow** (on the volcano, windward slopes get about 6× the lee's precipitation).
Precipitation falls as snow when the *cloud* above a spot is below freezing, not the ground, so
snow can fall where the ground is slightly above zero. It then builds a **snowpack** that melts with
ground warmth (sunny slopes first) and drifts into hollows. Thin snow slides off steep slopes and
piles below them, but once the snowpack around a steep face is deep, the face holds snow too. At
the same height on the volcano, windward snow averaged 1.84 deep and lee snow 0.08. See
**Overlays → Precipitation** and **Overlays → Snow depth**, and hide the clouds with **View → Show
clouds**.

| Forest | Climate |
| --- | --- |
| Tropical jungle | hot (above ~19 °C) and very wet |
| Tropical dry forest | hot with a dry season |
| Temperate rainforest | mild and very wet |
| Broadleaf | mild, moderately moist |
| Conifer (taiga) | cold (below ~9 °C) |
| Dry woodland | the dry edge of forest |
| Swamp forest | waterlogged flats beside water |

On the volcano map, a sea-level temperature of 8 °C gives only taiga and a big snowcap; 22 °C gives
jungle, tropical dry forest, broadleaf, temperate rainforest and dry woodland with a small summit
cap; 30 °C gives only tropical forest and no snow. See it with **Overlays → Temperature**.

---

### Tree species and soil chemistry (`src/sim/species.js`)

Forests are mixes of species, each with its own preferences, so every spot has a percentage of
each species plus open ground between the trees:

| Species | Likes |
| --- | --- |
| Pine | very drought-resistant (deep taproot, needles that lose little water): holds woodland on ground far too dry for other trees, down to the edge of the desert; thin soil, steep slopes; pioneer; burns readily |
| Fir (abietoid) | wet, cool climates from mild rainy lowlands to high mountain slopes; steep ground and thin rocky soil; thickens as the forest ages |
| Spruce | cold, acidic soil |
| Larch | the coldest ground near the tree line; pioneer |
| Aspen | every young forest (sprouts first after disturbance), then shaded out |
| Birch | cool; pioneer that fills clearings |
| Oak | warm lowlands with moderately moist soil |
| Beech | moist old growth on deep neutral or lime-rich soil |
| Maple | fertile, base-rich soil (basalt, limestone) |
| Alder & willow | waterlogged riverbanks |
| Juniper | dry, rocky, limestone slopes |
| Tropical hardwoods | hot, wet old-growth jungle |
| Palm | hot, humid ground near water |
| Acacia | hot, dry savanna |

**Soil chemistry** comes from the rock beneath: granite, rhyolite and sandstone weather into
acidic soil; basalt into fertile base-rich soil; limestone and marble into alkaline soil. On the
hills map, pine and birch are common on acidic ground but almost absent on limestone, where maple,
beech and juniper take over. **Succession**: every young forest is full of aspen (over half the mix)
with other pioneers; as it ages, beech and fir move in and aspen fades to a few percent. On the
mountains map, pine leads on dry ground and fir dominates wet, cool, higher slopes. The mix sets the forest's colour,
flammability and soil-building rate. See **Overlays → Tree species** and **Overlays → Soil
chemistry**, and **Inspect** lists each spot's mix in percent.

**Valleys are wetter**: water drains off ridges and gathers in hollows, so valley floors average
about twice the soil moisture of ridges (0.51 vs 0.27 on the hills map).

**Cloud altitude**: clouds form lower in humid air (about 3 units above the ground) and higher in
drier air (up to ~10), and snow vs rain is decided by the temperature at that cloud base. Valley fog
pools in cool, damp valley bottoms, and a thin high-cloud layer drifts above the peaks.

---

### Seasons, storms and lightning (`src/sim/climate.js`, `phenology.js`, `weather.js`)

**Seasons** (**Water & climate → Seasons**, with **Season speed** in years per minute and
**Season swing**). Temperature swings around its yearly average, warmest a little after midsummer
and coldest a little after midwinter, because land and sea take time to warm and cool. The yearly
average still decides what can live where; today's temperature decides rain vs snow, melting,
evaporation and what the leaves are doing. Plants grow in the warm season and rest in the cold.

**Leaves.** Deciduous trees take their cue from shortening days and cooling nights. Their leaves
stop making chlorophyll and show their other pigments, then drop:

| Tree | Autumn colour | Why |
| --- | --- | --- |
| Birch, aspen, larch | yellow / gold | carotenoids, always present but hidden by green |
| Maple | red to orange | anthocyanins, made fresh in autumn from leftover sugar |
| Oak | russet brown | tannins |
| Beech | copper | carotenoids and tannins |
| Alder & willow | dull yellow-green | they drop their leaves still half green |

The colder a place's climate, the earlier autumn comes (about two days per °C), so the colour starts
on the high slopes and sweeps down the mountains, and spring leaf-out climbs back up. Exposed
ridges (cold wind, clear frosty nights) turn and drop first; sheltered valley floors count as up to
3 °C warmer and turn last. On the mountains map, at mid-height ridges were 51% turned when
valley floors at the same height were 28%. The effect is strongest where the forest is mostly
deciduous (**Overlays → Deciduous trees**). Pine, fir and spruce forests barely change. Where winters stay mild, trees keep their leaves.
New spring leaves and grass are a bright pale green for a few weeks. Grass browns to straw in
winter. Under leafless trees, winter snow shows on the forest floor.

**Storms.** Rain comes in storms rather than evenly everywhere (**Storms** slider). Frontal storms
are big regional systems (often a third of the map across); thunderstorms are smaller cells. Each
storm is a ragged cluster of rain cells drifting with the wind, with heavier and lighter bands moving through
it, and it rains hardest where its air is forced up windward slopes. A storm carries a limited
store of water vapour. Rain uses it up, fastest over mountains, so storms weaken as they cross a
range and die out beyond it: the **rain shadow**. Crossing the sea or a lake recharges them. Storm
rain goes straight into the rivers.

**The ground lags the air.** Soil stores the summer's heat and gives it up over weeks, so in early
winter the ground is still warmer than the air. The first snows melt as they land in the lowlands
and build a snowpack only in the high country. By midwinter the ground has chilled and snow sticks
low down too. On the Cascades map, snow covers the peaks from October and the upper slopes from
November, but reaches the lowland only from mid-December, peaking at the end of January; the
upper-slope pack lasts into June.

**Regional snowstorms.** A mountain snowstorm is a regional system, a third to half of the map
across. It moves slowly and lays an even blanket of heavy snow over a whole stretch of the range
(mostly on the high ground) rather than a patchwork. Only a few are on the map at once, and in the
season the next one builds quickly when none is. On the Cascades map the high ground went from a
patchy 55% cover in early October to 86% by late December and complete cover by early January,
about 3.5 units deep, with the depth far more even than before.

**Waves of snowstorms.** In the snow season the regional snowstorms come in waves: a run of
fronts rolls in off the ocean one after another, slows and stalls as it piles up against the
mountains and unloads its snow, then there's a break of a few days before the next wave (about two
waves a month). Below the snow level the lowlands get rain, except for one or two Arctic outbreaks
a winter, on random dates: cold air pours out over the whole region and a huge, slow storm buries
the lowlands in snow (on the Cascades map, 97% of the low ground white, about 4 units deep). The
Arctic air then sits there for a week or two (a cold snap): snow doesn't melt and every storm snows
right down to the lowest ground. Afterwards the thaw and the next rains clear it. A snowstorm called
in with the Storm tool also snows all the way down and brings a shorter cold snap.
Rain on snow melts it.

**Snowstorms pile it up.** Every storm that's snowing drops heavy snow (the travelling storms
nearly as much as the mountain snowstorms). Snow drifts on the wind rather than being wrung out on
windward slopes, so rain shadows get less but not much less. And while snow is falling on a spot it
hardly melts, because the falling snow chills the air to about freezing; it melts afterwards if
it's warm. A storm called in with the Storm tool covered the ground beneath it within seconds,
building to about 3.7 units deep.

**Spring melt.** Snow only melts above 2 °C, but then fairly quickly, so on the Cascades map the
lower alpine snow goes in April and early May and the high alpine pack melts out by early June.
Melted snow is mostly air, so the spring rise in the rivers is real but no flood. Snowfall and melt
scale with the season speed, so the timing is the same at any speed.

**Overcast fall and winter.** From late September to mid-March a grey cloud deck covers the region,
the light is dim and flat, and the sky is grey; storms darken it further at any time of year.
The default seasonal swing is ±13 °C.

**Rain soaks in.** Not all rain runs off: some soaks into the soil, more on dry ground and under
forest (leaf litter and roots), less on already-saturated ground. Water spread in thin sheets over
flat land (a flooded lowland or floodplain) slowly sinks in, while water on slopes keeps moving
and rivers and lakes barely lose any. So the flat Puget-style lowland of the Cascades map no longer
floods through the wet season (about 500–1,000 units of water on the map instead of 3,400), while
its rivers keep running all winter.

**The wet season.** From late October to mid-March the winter storm track sits over the region and
storms are practically constant: on the Cascades map there was a storm on the map 100% of the time
from mid-October to the end of March (2–4 travelling storms plus up to a dozen mountain snowstorms),
dropping to 40% in early April and 13% by late April. Mountain snowstorms start in mid-September,
before the lowland rains, and last through the wet season; the rest of the year storms are the
ordinary travelling kind, mostly rain. Rivers run high through the winter and again in April
with the snowmelt. Snowstorm clouds are drawn pale and soft, rain clouds
dark grey, thunderheads darker still. In the fall the mountain storms come one after another over the
high ground, each dropping heavy snow when it's cold aloft. Snow sticks to slopes up to the
**Snow slope limit** (47° by default; steeper crags shed it unless the pack around them is deep). On the Cascades map, 41% of the peaks were white by early
October. By late December, 71–76% of the high ground in the north and middle of the range was
snow-covered, about a metre deep on average (1 unit). The south, where much of the high ground is
the lower flanks of the volcanoes, is often warm enough for rain.

**Fir climbs highest.** Where it's moist enough for fir (subalpine fir and mountain hemlock in
reality), closed forest reaches about 2.5 °C colder than the general tree line, about 6 units
higher up the mountain. Fir also grows on fairly dry ground mixed with pine (like Douglas fir with
ponderosa pine on the east side of the Cascades), so the dry slopes carry fir–pine forest that
turns to pure pine toward the desert.

**A ragged tree line.** Real tree lines aren't contour lines. Forest pushes up in tongues and
drops back in bays (good seed years, avalanche paths, old fires, soil), climbs higher in sheltered
gullies and stops lower on wind-blasted ridges. Here the tree line shifts up to about ±2.5 °C from
place to place, valleys lift it and crests lower it, and the forest thins over a band rather than
stopping dead. On the Cascades map, forest fades from 80% to 8% over about 14 units of height,
with fingers reaching higher still.

**Mountain storms come first.** The wet season reaches the high country weeks before the
lowlands. From mid-September, moist air forced up over the ranges breeds storms that cling to the
peaks, and with cold air aloft they fall as snow. All snow comes from storms (unless the Storms
slider is at 0). On the Cascades map the peaks had snow from early October, the upper slopes from
November, and by mid-January 56–60% of the high ground was snow-covered while the lowlands were
still nearly bare.

**Snow lasts.** A snowpack keeps itself cold: it reflects most sunlight, and melting soaks up a lot
of heat. So snow here only melts where it's above 2 °C, and slowly. On the Cascades map, 65% of the
high ground was still white at the end of May, 43% at the end of June and nearly a quarter at the
end of July. The coolest spots keep their snow the longest.

**Snowpack and the spring flood.** In winter, storm after storm drops snow (decided by the
temperature at the cloud base), building the pack up on the mountains. In spring it melts, and
the meltwater runs off into the streams, so the rivers run highest in late winter and spring.

**Thunderstorms and lightning.** Warm weather makes the air near the ground buoyant, so storms grow
into towering, compact thunderstorms: short-lived, with downpours and lightning (**Lightning**
slider). Lightning favours high ground and trees. A strike in forest often smoulders in a snag or
the leaf litter (a *holdover* fire) and breaks out only after the rain has moved on. Dry soil and
pine make that far more likely.

**Snow puts fires out.** Any lying snow smothers a fire completely: a burning spot that gets snowed
on goes out, fire can't spread onto snowy ground, and lightning (or the Wildfire brush) can't light
it. So the winter snowpack is a firebreak, and fire season ends with the first snows.

**Fires are harder to put out where it's dry.** Parched soil and dry litter keep smouldering and
flare up again, and resinous pine burns hot and long. So rain or standing water quenches a fire in
a damp broadleaf forest quickly but barely slows one in a dry pine wood.

**Fire season.** Fuels dry out through the summer (grass cures, litter and fallen wood dry, trees
get drought-stressed), so fire danger peaks in late summer, around mid-to-late August. At the peak,
fire spreads several times faster, is much harder to put out, runs through grass, and throws
embers downwind that start spot fires ahead of the front. From the same five ignitions on the
Cascades map, a late-summer fire burned about 3.5× more ground than a spring one in the same time.

**Dry summers and dry lightning.** With **Dry summers** up (the Cascade Range preset sets it),
storms come mostly from autumn to spring, like the Pacific Northwest, where the winter storm track
brings months of rain and mountain snow and a summer high-pressure ridge shuts it off. Late summer
then becomes fire season: everything burns more readily and is harder to put out. Thunderstorms in
dry, hot weather are often *dry*: their cloud base is so high that the rain evaporates on the way
down (*virga*, the streaks that fade before reaching the ground), but their lightning still strikes.
Fire also creeps slowly through grass and shrubland. In normal conditions such fires usually die
out, but in a dry summer they keep spreading.

**Biomes change gradually.** Snow and rain respond to a new temperature at once, but plants don't.
Grass and pioneers adjust within a few years. Established forest hangs on for decades to
centuries, because long-lived trees survive in a climate where their seedlings no longer could.
So biomes, forest types, species and the tree line follow a lagging "adapted" temperature that
drifts toward the new climate, slowly under forest and about 4× faster elsewhere.

**Regional evaporation.** The **Evaporation** slider is the overall rate. Each spot evaporates
faster in warm air, in direct sun and on bare ground, and slower in shaded valley bottoms and under
forest (canopy shade and damp, still air). Water also evaporates faster the higher it sits (thin,
dry, windy air and strong sun), which more than makes up for the cold: on the Cascades map in late
July, alpine tarns evaporate about 2.6× as fast as lowland water and near the summits about 3.3×,
so high lakes shrink through the summer. (Alpine soil isn't dried by this: snowmelt keeps it moist.) This also dries the soil a little on sunny, bare slopes.
**Inspect** shows each spot's rate.

---

## Cascade Range preset

A simplified Cascade Range of Washington, with the prevailing westerlies blowing in off the
Pacific:

- **West: the Puget lowland.** Low, wet and mild, under fir (Douglas fir and hemlock in reality)
  with broadleaf patches.
- **The range.** North–south across the middle. The far north is a dense cluster of rugged, glaciated
  peaks (the North Cascades, granite and gneiss). A little south of the middle, a low pass crosses
  it, like Snoqualmie Pass, where I-90 crosses at only about 900 m. To the south is a medium-height
  forested range topped by isolated stratovolcanoes standing far above it (Rainier, Adams, St Helens;
  Glacier Peak in the north).
- **East: the rain shadow.** The air has dropped its water on the west slopes, so the east side dries
  out quickly. Pine woodland (ponderosa pine in reality) grows right up to the edge of the
  shrub-steppe, then comes juniper and shrubland, and finally the dry basalt plateau of the
  Columbia flood basalts.

The range rises steeply out of the lowland with only small foothills. Its mountains are long crests
leading up to summits (as in satellite images), with smooth slopes between them rather than
jagged noise. The lowland and the plateau are nearly flat, and only a few big rivers cut them, as
in reality (the Skagit, the Snoqualmie, the Yakima). Broadleaf trees thin out with height and
give way to conifers, gradually and patchily: on the 512 map they are about 47% of the lowland
forest, about 30% at mid-height, and about 10% near the tree line (mostly hardy aspen and birch). On a 512 map, forest covers about 85% of the western lowland and 80% of the western
mid-slopes, with fir leading at every height (58% of the lowland forest, 66% mid-slope, still
first just below the tree line). Pine leads the drier east slopes, and desert or shrub-steppe
covers most of the far east. Forests and biomes count as conifer or temperate rainforest when most
of their trees are conifers.

Forest doesn't need soaking-wet ground: plant cover levels off once the soil is moderately moist,
and trees grow on slopes up to about 45°. So the mountains are forested up to the tree line
without the lowlands having to flood.

## Glaciers (`src/sim/glacier.js`)

A glacier is a river of ice. Where snow survives the summer year after year it compacts into ice
(here: whatever snow is still lying at the end of summer). Thick ice creeps downhill under its
own weight, fastest where it is thickest and steepest, so it flows down valleys as a tongue that
tapers to a snout.

**Carving.** The sliding ice grinds and plucks its bed, and scours the valley walls hardest (it
presses against them as it flows past). The walls are cut back until the floor is broad and flat,
while above the ice they are untouched: the V of a river valley becomes a **U-shaped trough**. In a
test valley, a glacier turned a V that bottomed out at a point into a floor flat across ~10 cells with
steeper walls above. Ice holds the valley walls up, so they don't slump while it fills the valley.

**Moraines.** The rock the glacier erodes rides along in the ice (`iceDebris`) and is dropped where
the ice melts: ridges along its sides and a horseshoe at the snout, left behind when it retreats.

**Melt.** Bare ice melts above freezing, feeding meltwater into the streams; the glacier ends where
flow and melt balance. Nothing grows on ice. Paint ice with the **Glacier** tool (keep painting at
the head of a valley to feed it) and watch it with **Overlays → Glacier ice**; **Inspect** shows its
thickness, flow and the rock it carries.

**Wildfire smoke.** Big fires pour out smoke: dense columns that rise, bend over and stream
downwind, and a brown smog haze that settles over the land and lingers long after. The sky turns
smoky tan and the sun dims and reddens, like a wildfire smoke day.

## Coasts and the ocean (`src/sim/coast.js`)

**Tides.** The sea rises and falls twice a "day" over the Tide range; the intertidal strip floods
and drains every cycle.

**Shores.** Each stretch of coast becomes one of:

| Shore | Where |
| --- | --- |
| Mudflat | sheltered, very gentle bays and estuaries (Willapa Bay, the Skagit and Nisqually deltas) |
| Sand beach | where sand collects: from rivers, eroded soft rock and, in warm seas, coral |
| Shingle beach | exposed shores with little sand: pebbles and cobbles (much of Puget Sound) |
| Rock cliff | steep coasts with height behind them; the waves undercut them and they retreat |
| Basalt boulder beach | where basalt meets the sea (the Olympic coast) |

**Straight beaches.** Waves running along the shore (longshore drift) fill coves with sand and plane
off small bumps, so beaches straighten into long, gently curving stretches between points (like
Three Tree Point), while hard-rock headlands hold out. The Puget Sound preset starts that way and the
waves keep at it as the simulation runs.

Waves erode the shore hardest where it faces open water and the rock is soft; the debris becomes
sand (soft rock) or shingle (hard rock). **Sand depth** builds from that, from river sediment and
from coral, and waves strip it away on exposed shores; a deep beach protects the land behind. Wind
blows sand off sand beaches into **coastal dunes**, where dune grass and **shore pine** grow.
Salt spray and sea fog keep most trees back from the shore: **Sitka spruce** and shore pine are the
coastal specialists.

**Mangroves.** Where the sea is tropical (water above about 20 °C), mangrove forests take over the
sheltered mudflats and quiet sandy shores: salt-tolerant trees standing in the tidal water on
stilt roots. A stand creeps out into the shallows beside it, its roots trap mud so the flat slowly
builds up, and the tangle breaks the waves, so a mangrove shore erodes far less. Cool the sea and
the mangroves die back to bare mud.

**Salt water kills forests.** Land the sea floods, or that the high tide reaches, is salted. Ordinary
trees can't take salt in their roots and die within a season or two, even old forest (the "ghost
forests" left where the coast sinks or the sea rises); the tidal fringe keeps only salt-marsh grass.
Mangroves are the exception, and swamp forest hangs on in the brackish tidal fringe and where it is
only shallowly flooded.

**Water temperature.** Under the sea the temperature (map overlay and inspector) is the water's: the
surface follows the sea temperature with a damped season, and it cools with depth toward the cold
deep water (about 4 °C).

**Seawater quality.** Two things foul the sea. **Silt** (mud and fine particles) comes from rivers
carrying sediment into the sea, from waves eating at the shore (mudflats wash out fastest where
nothing holds them; mangroves and seagrass hold the mud down) and from landslides that run into the
water. It turns the water brown and blocks the light, but settles out within days, and where it
settles in quiet shallows it builds the tidal flats back up. **Pollutants** (sewage, runoff, spills:
the Pollute tool) linger much longer and poison sea life. Silt is stirred about quickly; pollutants
**spread out slowly** from where they come in, a plume that widens and thins over time (Ocean & coast →
**Pollutant spread**). Both are flushed out to the open ocean at the edge of the map. Seagrass meadows, kelp forests, coral reefs and
mangroves clean the water, in proportion to how healthy they are; but where it stays too dirty they
decline. Seagrass and kelp **thin out gradually**: their density falls shoot by shoot over a long
spell of dirty water, bare seabed showing through more and more, and the thinner meadow cleans less.
A **dense meadow resists**: it slows the water so dirt settles before reaching the shoots, its roots
hold the bed and it has reserves to ride out a bad spell, so it tolerates dirtier water and declines
more slowly; a sparse, already weakened meadow goes downhill fast (kelp shields itself less).
Coral is the most sensitive and dies faster. A bed that is gone leaves bare seabed that cleans
nothing, so a badly polluted bay can tip into a dead zone. Once the water is clean they slowly grow
back in. The inspector shows the water quality, silt, pollutants and seagrass or kelp density (or
reef health), and the **Water quality** overlay maps it.

**Ocean biomes** follow the water temperature (the sea lags the air and swings less) and depth:
sea ice, kelp forests on cool rocky shores, seagrass meadows, coral reefs in warm shallows (they
make white coral sand), the open shelf and the deep ocean. The water itself shifts from dark
green-blue in cold seas to tropical turquoise.

The sea beds follow the sea's **long-term** climate, not the seasons: kelp doesn't vanish each summer
or coral each winter (only the sea ice comes and goes with the seasons). They track the year-average
water temperature as they have adapted to it, lagging a few years behind, and each spot's limits
differ a little. When the sea warms or cools, the beds that no longer suit a spot are replaced patch
by patch over several years, the newcomers starting sparse and filling in, so coral spreads and kelp
retreats (or the reverse) over many cycles.

**Coral** is tropical: water colder than about 18 °C (a cold snap or a cooling sea) kills a reef
outright within weeks, however healthy it was. It grows back only in warm water and only slowly,
over many years, spreading from living coral nearby; a reef killed off completely is recolonised
only very slowly. The dead coral's skeletons are left as **rubble**, which piles up in the shallows,
building the reef flat up until it emerges as a wider beach (or a little coral-sand island, a cay),
and which the waves break up into white coral sand much faster than a living reef makes it.

**Cold-water coral.** Below the sunlit shallows, in cool (about 3–14 °C), full-strength seawater, deep
reefs of cold-water corals (like Lophelia) grow in patches across wide stretches of the sea floor.
They are the most sensitive sea bed of all: silt, pollutants, low oxygen and brackish water damage
them quickly, trawling, dredging and dumping wreck them, and they grow back only very slowly.

**Tidal currents.** As the tide rises (the flood) the sea pours into the bays and channels from the
open ocean, and as it falls (the ebb) it drains back out. The current runs along each channel,
fastest in narrow passages and slowed by friction in the shallows, with a slow drift with the wind
on top. It carries silt, pollutants, plankton and river water back and forth with every tide. You can also
draw permanent currents (the Current path tool): the sea flows along the path for ever, on top of the
tides and wind, like a coastal current or a circling eddy.

**Wind.** The prevailing wind blows hardest over open water, building up over the stretch of sea it
crosses (the fetch), and land blocks it: an island or headland casts a wind shadow behind it, longer
the higher it stands, so its lee is calm. Over land it is strongest on exposed ridges and coasts. The
wind drags the sea's surface along as a **wind-driven current** (turning aside to run along a coast
rather than into it, on top of the tidal currents), raises the waves (surf and wave erosion are
fiercest on windward shores, calm in the lee), stirs oxygen in and chills exposed water. It also wears
down bare **sedimentary rock** (sandstone, shale, limestone, conglomerate) where nothing grows, grain by
grain and extremely slowly, dropping the grains downwind (into the sea as silt). The **Wind speed**
overlay maps it; Climate → **Wind strength** and Erosion → **Wind erosion** set it.

**Water temperature varies from place to place.** The whole sea follows the seasons, but shallow,
exposed water heats up fast in the summer sun and is chilled fast by the wind, so it swings widely,
while deep or sheltered water stays steadier and lags behind; a strong wind also stirs cooler water up
from below. The Temperature overlay shows the sea's own surface temperature, spot by spot.

**Brackish water.** Most sea beds can't stand fresher water: kelp and coral need full-strength
seawater, and even seagrass (eelgrass copes best) dies back where rivers keep the water brackish.

**The shore's edge.** Between the tide lines the sea scours the ground bare twice a day: grass,
shrubs and trees are stripped away (only mangroves, and swamp forest in brackish water, hold on), and
the waves slowly bring sand in and spread it over the bare ground, building it up into beach (except
on sheltered mudflats and at the foot of cliffs). Forest doesn't run down to the high-tide line either: just above it, storm surges and
storm waves wash over the ground every so often, leaving only grass and low scrub. Behind exposed
shores, salt spray and the sea wind thin and stunt the trees, and loose, dry beach and dune sand holds
little; there the coastal specialists take over (shore pine on the sand, Sitka spruce in the spray and
fog), while ordinary trees struggle.

**Estuaries.** Rivers pour fresh water into the sea, and it floats out over the seawater as a plume.
Near a river mouth the water is brackish (part fresh, part salt) and forms an **estuary**, mixing back
to full seawater (about 35 ‰) further out. Coral and kelp need full-strength seawater; eelgrass and
salt marsh don't mind brackish water.

**Plankton blooms and dead zones.** Microscopic algae bloom where the water is warm, sunny (spring and
summer) and rich in nutrients: sewage and farm runoff (the pollutants) and river water. A big bloom
turns the water green (reddish-brown in warm seas: a red tide). When it dies and rots in deep water
that is rarely flushed out (far up a long inlet, like Hood Canal), it uses up the oxygen there:
**hypoxia**, and at worst a dead zone that suffocates the sea beds. Healthy sea beds take up the
nutrients first and keep blooms down; open water and storms stir oxygen back in.

**Sea ice** freezes cell by cell: seawater freezes at about −1.9 °C, fresher water closer to 0 °C, and
sheltered, shallow bays freeze first, open, wavy water last. Thin new ice thickens into white pack
ice through the winter and thaws again in spring.

**Storm surge and storm waves.** A storm over the sea raises it (low pressure lifts the surface and
the wind piles water against the coast), flooding low shores for a while, and its big waves pound
the coast, eroding it several times faster. **Surf** breaks in white bands along exposed shores,
fiercest under a storm.

**Great storms.** Every so many years (on average; Sea → **Great storms every … years**, 0 = never;
mostly from late summer to winter) a great storm, a hurricane or a once-in-a-generation gale, forms
far out at sea and drives onto the coast. Its surge piles the sea up about twice as high as an
ordinary storm's, flooding far inland over the low coast; its giant waves cut back cliffs and
bluffs several times faster and drag the sand off the beaches into deeper water, so the dunes behind
flatten; and the salt water kills the coastal forest and plants it floods. The coast then slowly
recovers: the waves bring the sand back, dunes rebuild and the forest regrows from its edges. The
month bar shows a great storm while it lasts; **Send a great storm now** starts one.

Under **Ocean & coast**, sliders set the strength of the tidal currents, the storm surge and waves,
and how readily plankton blooms. The inspector shows the current (speed, direction, flood or ebb, any
storm surge), salinity, plankton, oxygen and sea ice.

**Maritime climate.** The sea stores heat, so near the coast the seasons swing about half as much
(mild winters, cool summers) and far inland more (continental). On the Puget Sound map the swing was
0.74× normal along the coast and 1.1× inland. **Ocean fog** (the marine layer) drifts over the sea and
coastal lowlands, mostly in summer.

**Mountain-pass cold.** In winter, cold interior air pours west through low passes (gap flow, as at
Snoqualmie Pass on I-90), so a pass is far colder than its height suggests: on the Cascade Range map
the pass averaged −14 °C in midwinter against −9 °C at the same height elsewhere. That is why the
temperate lowland forest gives way so suddenly to deep subarctic snowpack at the pass.

## 8. Biomes

Plant cover, soil water, slope and height together decide what the surface looks like:

| Biome | Where | Look |
| --- | --- | --- |
| Forest (7 types) | moist ground warm enough for trees: jungle, tropical dry, temperate rainforest, broadleaf, conifer, dry woodland, swamp | shades of green |
| Wetland | flat, waterlogged ground beside rivers and lakes | dark olive |
| Grassland | moderately moist ground, or slopes too steep for forest | light green |
| Shrubland | semi-arid: drying soil, sparse cover | olive tan |
| Desert | dry and flat | sand yellow |
| Mesa | dry and steep: bare, banded rock (mesas, buttes, badlands) | orange-red |
| Barren | recently eroded or buried ground, not dry enough for desert | brown |
| Tundra | too cold for trees | grey-green |
| Snow | below freezing, on slopes that can hold it | white |

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

Sediment capacity also grows faster than linearly with water depth, so deepening channels cut
harder, gather more water and organise runoff into rivers rather than sheets. Water never digs a
cell below its lowest neighbour and only drops sediment into low spots. Pits followed by sediment
lips are what turn a slope into a staircase of pools, so neither is allowed to form. Valley
floors are only lightly smoothed and channels are cut narrow and deep, so the river stays in its
channel instead of spreading across a flat floor.

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

## Good years and bad years

With Seasons on, no two years are quite alike. Most are ordinary, but now and then a summer of
**drought and heat waves** comes (a ridge of high pressure parks over the region for weeks): up to
5 °C hotter, the summer rain all but gone, dry thunderstorms throwing lightning with no rain, and
the fuels dried out early, so the fire season starts sooner, burns fiercer and runs further, with
embers spotting far ahead of the fires. Other summers are **mild**: cool and showery, green, with
little fire. A new kind of year is drawn each spring; Seasons → **Year-to-year variation** sets how
often the extremes come (at 1, about one year in six is a drought year and one in five a mild one)
and **This year** shows (or sets) the current one. The month bar names the year and flags drought or
mild summers.

## Forest density and forest health

**Tree density** is how closely the trees stand (canopy closure): it comes from the tree cover, is
thicker in old forest and is opened up by dead trees. **Forest health** is whether young trees are
coming up to replace the old ones as they die. Seedlings need seed trees nearby, a climate and soil
that suit trees, and moisture; browsing animals eat them, and dead wood and fire set them back. A
healthy forest renews itself and fills its gaps quickly; one with too few seedlings slowly thins out
as its old trees die. Both have overlays (Forest density, Forest health) and show in the inspector.

**Forest spreads from its edges.** Trees spread by seed, and seeds fall near the trees that made
them. Open ground next to forest, above all healthy forest full of seed trees and saplings, fills
in with trees quickly; plains far from any forest get only a few stray seeds and turn to woodland
only slowly. So a clearing in a healthy forest closes over within a few years, while a big burn or
an open plain is re-forested from its edges inward.

## Wildlife: an ecosystem of your own animals

You design the animals (Wildlife → Add animal): a name and colour, where it lives, what it eats and
its habits. Each is a population density that grows where there is food, starves where there is
none and moves toward better feeding over its roaming range, and each links to the rest:

- **Food.** An animal can live only where there is something it eats: grass and meadow plants,
  shrubs and young trees, deciduous trees, conifers (all buried by deep snow), plankton, seaweed
  (kelp and seagrass) or other animals. Predators are fed by the prey within their range, thin
  it out, and starve without it, so predator and prey numbers rise and fall together.
- **Effects on the place.** Grazers and browsers hold meadows open and stop cleared or burnt ground
  from growing back into forest; plankton-eaters keep blooms down; seaweed-eaters can strip kelp and
  seagrass into bare barrens.
- **Habits.** *Avoids deep snow* (hard winters kill some); *harmed by pollution*; *killed by hard
  frost* (below about −12 °C, like bark beetles); *builds dams* (on streams, slowly raising ponds and
  wetland, and felling the deciduous trees around them; abandoned dams wash out); *kills the trees it
  eats* (whole stands turn red, then grey, leaving dead wood that burns fiercely); *fertilises the
  ground* (plants grow faster where it lives); *swims up rivers in autumn* (a run like salmon from
  the sea up cool, clean rivers, held back by warm water, mud and dams; the spawners die and
  fertilise the stream banks, and next year's run depends on how many made it).
- Every sea animal suffocates in low-oxygen water.
- **Temperature.** Each animal has a range it's comfortable in (the air on land, the water at
  sea). Inside it the animal thrives and spreads fastest; beyond it the place supports fewer of
  them, they breed slower and suffer heat or cold stress, fading out about 5 °C past the limit. So
  animals with different ranges spread at different rates, sort themselves by climate (cold-lovers
  up the mountains, warm-lovers in the lowlands) and shift with the seasons.
- **Migration.** An animal can stay put, migrate with the seasons to the opposite side of the map
  (north in summer and south in winter, or east in summer and west in winter: in the Showcase map
  that's up into the mountains for the summer and down to the coast for the winter), or wander the
  whole map following the food. Migrants trek over ground they can live on (land animals can't cross
  the sea), slowing as they reach the far side; on the trek they graze less, so a long journey
  through poor country costs them. Seasonal migration needs Seasons on.
- **Starving.** Each animal has a hunger level where it lives: it builds where there is less food
  than the animals there need (too many of them, the plants grazed bare or buried by snow, the prey
  gone) and eases where food is plentiful. Hungry animals stop breeding; starving ones die off fast
  and wander further looking for food. The inspector shows each animal as well fed, hungry or
  starving, and the Wildlife panel warns how many are starving (or that they have died out).

Paint them in with the Animal tool. They show in the map key, the Wildlife overlay (the most common
animal in each place), the inspector and as small dots in their colours; dying forest and river runs
also show in the terrain colours.

## Lakes up high, and snow in the lowlands

Still water evaporates far faster the higher it lies (thin, dry, windy air and strong sun: up to
about twelve times the lowland rate), so high basins hold only small tarns, not big lakes; running
water in streams, fed from upstream, doesn't get that boost. With Seasons on, Water → **Summer
evaporation ×** multiplies how fast lakes and ponds evaporate at the height of summer, easing in
from spring and out in autumn.

Snow in a maritime lowland rarely lasts: near the sea the air stays mild and moist, so snow there
melts at a lower temperature and faster; mild lowland ground melts snow from below all winter; and
rain falling on snow washes it away. Lowland snow is gone within days to a couple of weeks, the
foothills clear in spring, and only the high mountains keep their snowpack into summer.

## Civilization

Towns are founded where people would choose to settle: a comfortable climate (a yearly mean of
roughly 8–20 °C), fresh water or the coast close by, fertile flat land, timber and fish within reach,
safe from floods and lava, and away from other towns. A town clears farmland around it (fields: no
forest grows back there) and grows toward what its fields, and the sea if it's on the coast, can
feed; farmers clear more land than they need, so a town grows until the fertile land around it runs
out. Drought years cut the harvest and mild summers improve it; a town with no river or lake nearby
stays small; dirty drinking water slows it; floods, wildfires, lava and storm surges cost it people.

**Farmland.** Every cell of town needs at least three cells of farmland, so a town builds out only
once its fields allow. Any land can be made into farmland if it can be watered and has a growing
season: it is cleared (forest and all), levelled, or on a slope cut into terraces (level steps), and
irrigated from the nearest river or lake, which it draws down (a dry year or too many fields can run
a stream dry, and then the fields get only the rain). Fertiliser and soil wash off the fields into
the nearest water, polluting it. Farmland is its own biome (as are towns).

As it grows it paves its streets: pavement is flattened, sealed (rain runs straight off), doesn't
erode and grows nothing. It lightly pollutes any water beside it, and every patch of pavement always
sends heavy pollution down the drainage: the rivers below towns run murky, and the pollution pours
into the sea at their mouths (where it spreads with the currents, feeds blooms and harms the sea
beds and sea life).

Roads are laid out over the land as road builders would: along valleys and contours rather than
straight over the hills, avoiding steep slopes, crossing rivers only where they must. They have to be
kept up: weather, frost, floods, fire, landslides and steep ground wear them, and the towns near them
repair them (a bigger town keeps up more road, farther out). A neglected road cracks, then breaks up
and grows over; only a road in working order lets towns grow along it and brings trade.

Roads carry the traffic of the towns they serve (nearer and bigger towns most). A busy road is
widened to two lanes, a very busy one to three, the new lanes graded and paved beside it (and more
road to keep up).

**Worn-out fields.** Cropping wears out a field's soil (faster when irrigated, worked harder): a
freshly cleared field is rich, and over the years its harvest falls. Worn-out fields next to the town
are paved and built on (housing, shops, workshops), so the town grows into its old fields; worn-out
fields farther out are left fallow, and slowly recover. Either way the farmers clear fresh ground
farther out, so a town grows in rings, its core spreading over the fields as the fields move outward,
and when the good land within reach is used up its numbers rise and fall with the soil.

**Industry.** A town past a few hundred people builds an industrial area on the water's edge (a
river, lake or the coast: for transport, cooling and dumping), one solid mass-paved block that grows
with the town. It brings work and trade (the town can support more people), and it pours pollution
on a very large scale straight into the water beside it and down the drainage. Industry counts as
town for the three-fields-per-cell rule.

A young settlement hunts the game around it (your land animals) for much of its food, thinning it
out; as it grows and takes to farming, hunting fades away.

Roads are built by terracing the hills along the route to an even grade and paving it, bridging the
rivers. Towns grow out along their roads; big neighbours build roads to each other; a crowded town
sends people to found a daughter village nearby, linked by road. A town that dwindles away is
abandoned: its fields go back to the wild and its pavement slowly breaks up and grows over.

**Boats and harbours.** A coastal town builds a harbour on the shore, and its fishing fleet grows
with the town (you see the boats working the water around it). The boats catch whatever lives under
the water within their range (your sea animals among it) and land it as food; they trawl the sea bed
(seagrass, kelp and coral are torn up) and foul the water a little. A wrecked, polluted or fished-out
sea yields less, so a big fleet can collapse its own fishery. Boats also carry settlers across the
water: a town with a harbour can found villages on islands and other shores (linked by sea, not road),
and sends boats out to settle islands nobody lives on yet; without boats, towns can't cross the sea.

**Quays.** A coastal town of a few hundred armours its shore, more of it as it grows: the land along
the water is raised above high tide and walled, and the water in front dredged deep, making a steep
drop-off where the tide can't reach in (no tidal flats, no flooding at high tide) and where boats can
tie up, so harbours are easy to build there. Building it destroys the sea bed it dredges, damages
the beds around and clouds the water with silt and pollution; a working quay keeps fouling the
water at its foot and wearing the beds there down. Waves don't wear a quay and no sand gathers on it.

**Earthworks.** A town past a few hundred people reshapes the land around it: hillsides and unwanted
slopes are cut into level terrace platforms (high ground dug away, low ground filled up to the same
level), and knobs rising above the town are cut down. The spoil is dumped into the shallow sea along
its coast, building new flat land out from the shore above high tide (land reclamation), or, with no
sea in reach, tipped into hollows. Dumping smothers the sea bed and clouds and pollutes the water.
The inspector marks cut, terraced and reclaimed ground.

Polluted rivers show clearly: murky ochre-brown water, opaque even in a thin stream, with stained
banks.

**Dams, bridges and fires.** A town past about 700 people walls off a narrow river valley near it with
a concrete dam (its crest about 4 above the river), and a reservoir fills behind it for the town's
water; the dam stops fish swimming upriver, traps the river's sediment, and its works pollute the
river. Where roads cross rivers or the sea they're carried on bridges, which need upkeep like the
road and drip their runoff into the water below. And people start fires: farmers burn forest off to
clear it for fields (slash and burn), and fires get away from towns by accident, far more often in a
dry season; either can escape into a wildfire.

**Flat fields, canals and forest roads.** Only ground gentler than the **Max farm slope**
slider (15° by default) is cleared for fields; steeper hillsides must first be cut into level
terraces by the town's earthworks. A field's own surface is what counts, so a level terrace step
passes even though the riser beside it is steep. A field that later turns too steep (a landslide, a
river cutting into it) is given up. A town of a few hundred whose fields are largely dry digs up to
three **irrigation canals**: stone-lined channels from the nearest river or lake out to the middle
of its dry fields. Sluices keep a working canal running, so the fields along it are irrigated, and
it draws down the river it taps. Roads bridge canals rather than paving
over them, and an abandoned channel silts up. Towns also push **exploratory roads** out into the
deepest forest nearby (one at first, up to four as they grow). Each road fells a strip of trees,
thins the forest either side, and lets the town spread out along it. Towns pollute the sea heavily
from their shores, outfalls and drains. A town can only grow about a third beyond what its streets
house, so it grows as fast as it builds and doesn't boom and crash.

**Sewage.** A town of more than about 150 people pipes everything its streets, works and harbours
shed straight out to the nearest open sea, wherever that is on the map. It all pours out at one spot,
the outfall, and spreads through the sea from there. No channels are dug for it; sewer channels
from older levels are filled in. Roads, and towns on a map with no sea, still drain downhill into
their streams.

**Kept ground and growth limits.** Ground people keep up doesn't erode: farmland, towns, roads,
industry, harbours, quays, dams, canals, plantations, anything paved, and ground that's been cut,
terraced, quarried or reclaimed. It barely washes away (about 3% of the usual rate), and it doesn't
slump, slide or blow away, because its walls, banks and drains are maintained. At the coast, the
waves don't wear it away either: it's banked and armoured like a quay. Terraces, reclaimed land and
quarry floors are built about 1.6 above high tide, out of the waves' reach, so the sea can't eat
into flattened lowland. Terracing and quarrying lower the streets, works, roads, fields and
plantations in their way along with the ground around them (a road is re-graded, not left on a
ridge); bridges are left as they are. Each step, any spike left standing above the ground around it
is levelled, on kept ground or at the edge of cuttings and quarries, single cells and small clumps
alike, and any hole left in kept ground is filled. A scrap of kept ground left standing out in the
sea, its surroundings long washed away, is washed away too. Harbours, quays, dams and canals are
left as built. A town's growth tails off smoothly as it gets big (a soft limit): what it can support
is scaled by 1 / (1 + support / (25,000 × Expansion speed)), so even huge farmland can't feed a
runaway city. The steady clearing of new fields also slows as a town's farmland grows. Terracing only cuts ground that stands above the town, down to the terrace step below it. Ground below the town is never cut, and ground already on its step stays put, so cuttings can't deepen pass after pass into pits.

**Timber plantations.** Each town keeps about twice as much land under timber as under fields.
It picks the land where forest grows best, out to three times its town's reach, preferring an
existing forest. A plantation takes in that entire forest: every connected forest cell, however big
it is. On open ground that suits trees, it plants a block about 12 cells across instead. A new
plantation is only started while the town's timber land is less than twice its farmland. Every
village (20 people or more) must have a plantation. A village without one looks twice as far afield
for land to plant. Failing that, it turns a block of its own fields over to timber, the fields that
would grow trees best, the outer ones first. In dry country these become watered, tended woodlots
that still grow. A plantation is only abandoned for worn soil after it has given at least one
crop. Plantations are planted with fast-growing stock and tended. Once most of a plantation's trees
are grown (60%), the whole plantation is clear-felled at once, leaving bare brown ground with slash
and the soil a little thinner. All the natural forest that joins onto it is felled with it and
taken into the plantation. Then the whole plantation is replanted to grow again, on a rotation of
roughly 40 civilization steps. Each crop of timber takes nutrients out of the soil (the
plantation's soil falls by about a fifth with every felling), and trees regrow more slowly on worn
soil. Each clear-fell also strips the soil itself: hauling, ruts and bare ground washing off take
about 30% of its depth. A plantation builds almost none back, since it's a young crop of one kind
whose litter goes with the timber. Trees regrow more slowly on thin soil, too. When a plantation's nutrients are exhausted (below 30%) or its soil is stripped too thin (below 10% depth), it is abandoned to recover. It goes back to
the wild and its soil slowly comes back (about 270 steps from worn out to plantable). The town starts
a new plantation on fresh land elsewhere, and plants only land whose soil has recovered (nutrients to 60% and some depth of soil), so
plantations rotate around the country. A road runs from the town centre out to each plantation. The wood adds to the town's trade (up to
30%). A town's own farms and streets can take over its plantation land, and an abandoned
plantation goes back to the wild. Plantations are monocultures of even-aged
trees, with no understory, no old or dead trees and no food, so they have very low biodiversity and
support no wildlife. Your animals die out or move away from them, and the Animal tool can't put
any there.

**Livestock, harbours and the Destruction slider.** Towns grow in pairs of cells: each cell of housing
needs another of infrastructure (streets, markets, workshops, wells). Once a town has a few hundred
people it can terrace moderately steep ground (up to about 35°) into level fields; terraced fields
count as level on their benches. Farm **livestock** graze the understory of the woods around the
fields (within about 5 cells), eating and trampling seedlings, so forest health falls there. A town
past a thousand people **needs a harbour** for its trade: it looks farther along the coast, then
for a river or lake landing (no fishing fleet there). A town without one can't grow past about a
thousand. The **Destruction** slider (0 careful, 1 normal, 3 ruthless) scales three things:
slash-and-burn clearing, every pollution load from streets, works, farms and sewage, and how often
and how much the towns cut hills into terraces.
The **Harbour** tool (⚓, under Civilization) builds a harbour where you click on the shore of the
sea, a lake or a big river. It goes to the nearest town (within about 40 cells), and a town that
already has one moves it there. A sea harbour gets a fishing fleet; a lake or river one is a trade
landing. Shift-click closes the nearest harbour, though a coastal town will build itself a new one
in time.

**Quarries, breakwaters and reclaimed land.** Towns past about 250 people terrace often and in bulk
(up to 20 platforms at a time). Towns past 500 **quarry** whole hills and mountains, in one
concentrated place: each town works a single pit well out beyond the town and its fields (at least
10 cells past its reach), on the biggest hill it can find there and away from other towns, with a
haul road out to it. The quarry face moves about inside the pit, cutting the highest ground down a
level at a time. The pit widens bit by bit, up to about 12 cells across, until the hill there is
down to the town's level. Only then is a new pit opened somewhere else. A big town works several
faces at once, all in the same pit. The rock
first goes into the harbour's **breakwater**, a causeway three cells wide and faced as quay. It is
tipped from the harbour toward the deepest water nearby and grows longer with the town (up to 40
cells), and the harbour moves out to its tip. What's left builds new land along the shallow coast.
Every tipping smothers the sea bed and clouds and fouls the water; quarrying fouls the streams below
it. Quarry pit walls are cut back in benches to about 50°, never left sheer, and quarried,
terraced and reclaimed ground counts as kept ground, so rain doesn't gully it into spikes. The
**Quarrying** switch turns quarrying off entirely. A pit is never dug deeper than the lowest ground around it, so it always drains rather than becoming a closed basin, and streets and works in its way are re-graded with it, never left standing on pillars. The Destruction slider scales how fast all of this goes. Farmers also keep clearing a little
more land each year even while the town isn't growing.

Towns spread fast and hard, with no caps on their expansion. A town's reach grows with its
population (times the Expansion speed), and its fields reach twice that far. Each step a town builds
at least 6 cells of town and clears at least 14 of fields, or half of what it still needs if that's
more. There is no limit on the number of towns, their quarries' reach, their breakwaters' length,
their quays, industry, canals or forest roads; only the land and its people limit them. Daughter
villages are founded twice as often as before. About 30% of new fields are burnt off first.
Pollution loads are 1.5× what they were, quarries cut 2.2 deep with a wider face, and livestock
graze farther into the woods. The **Expansion speed** slider goes up to 10 and the **Destruction**
slider up to 10. Above 1 they raise both the chances and the amounts: how many cells a town builds
or clears in a step, how far out it reaches, how many terraces it cuts, and how many quarries it
works at once.

**Protected zones.** Any polygon you draw can be made a protected zone (🛡 in the Drawings list): it
is kept wild. No town is founded or built inside it, no farmland is cleared, no industry is built,
and roads between towns go around it (unless there is truly no other way). What was there already
stays.


**Painting plantations.** The **Plantation** brush (🌲, under Civilization) paints timber
plantation onto open land, and onto the nearest town's own fields, for the nearest town within
about 80 cells. The ground is planted with saplings. The town then tends the plantation like its
own: it fells it when grown, together with any wild forest joining it, and replants it. Painted cells join a painted plantation of that town nearby, or start a
new one. A plantation you paint is kept for good: it's felled and replanted as usual, regrowing more slowly as its soil wears thin, but the town never abandons it. Hold Shift to clear plantation back to the wild.

**Clearing fields.** The **Clear fields** tool (🚜, under Civilization) takes farmland out of
farming. The fields you paint over are abandoned and left as bare ground with poor, worn-out soil:
little humus, almost no plants and no irrigation. Plants return only slowly, and no town will farm
the ground again until its soil has recovered. Holding Shift wears out the soil of any ground the
same way without clearing anything.

## The world grid

The world goes on past the edges of the map. It is divided into cells, each a full map of its own,
laid out on a grid; you work in one cell at a time and travel between them from **World grid** in
the Map tab (click a square next to yours, or any you've been to). A level from before the grid
becomes the centre cell, (0, 0).

**Frozen cells catch up.** The cell you leave is saved, compressed, to the browser with the date it
was left, and nothing happens there while you're away. When you come back it catches up on the
years it missed: its towns grow, farm, fell timber and spread, and its plants regrow. This is a fast-
forward (up to about 80 civilization steps, at most a few seconds) without the full water and
erosion. The calendar (year and season), every setting, the preset and your animal species are
shared by the whole grid; the map itself (terrain, water, plants, towns, drawings, probes) belongs
to each cell.

**New cells continue the land.** A new cell is generated with the same preset and its own layout (a
seed taken from its position on the grid; the volcano preset carries on as mountains around its
centre cell). Its terrain is then bent, over about 40 cells in from each edge, to meet the edges of
the cells already beside it. Each time you enter a cell, its edges are eased back into line with its
neighbours' over about 10 cells, so the ground stays continuous however each side has eroded.

**Across the borders.**
- *Rivers:* a river running off the edge of one cell comes into the next as a spring at the border,
  in the same place, with about the same flow.
- *Towns and roads:* each cell knows the towns in the cells around it. A town of a few hundred people
  builds a road toward the nearest town in the cell next door (within about 160 cells). The road
  runs to the border where the straight line between the towns crosses it. When you next enter the
  other cell, the road is continued from the same spot on its edge up to the town. The two towns
  are then linked and trade over the road.
- *Animals:* the outer few cells along each border are drawn toward the numbers of your animals
  along the facing edge of the cell next door, as they were when it was left. Animals wander in
  where there are more of them across the border, and out where there are fewer; ordinary
  spreading carries them on inland. A cell's animals along its edges are recorded each time it is
  left.
- *The sea:* pollution, silt and saltiness mix across the border the same way, so a fouled sea next
  door seeps in along the shared coast.
- *Boats:* a town with a fleet of two or more boats and a few hundred people now and then sends 50
  settlers across the sea to a neighbouring cell, sailing out where open sea meets the edge. When
  that cell is next visited, or first made, they found a village on the best coast near where they
  crossed, linked to the town they came from.

Storage: the grid's list of cells (their edges, rivers, towns, road ends, when each was left and a
small picture of each) is kept under `grid-<size>`; each frozen cell under
`cell-<size>-<grid id>-<x>,<z>`; the cell you're in is the ordinary autosave. Generating a new map,
or loading a level from a file, starts a new grid.
