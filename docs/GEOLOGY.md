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
roughly 1,000+ vegetation steps, and lose their age when they thin out, burn or are buried. A
stand thinned only a little (cover just under 0.66, by disease, browsing or a dry spell) keeps its
old trees and loses its age slowly; the loss rises steeply as the cover falls, and is at the full
rate (0.03 a step) once the cover is below 0.36, where the canopy is really gone. Old
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
each species plus open ground between the trees. The mix answers to the climate rather than the
season: it uses the ground's wetness and nearness to water averaged over about a year
(world.soilAvg, world.nearAvg), and the species readouts and graph weigh it by the tree cover
averaged the same way (world.vegAvg; the greater of that and the cover now, so forest that has
just grown back counts at once and isn't shown as open ground), so a wet spring or a flush of
leaves doesn't swing it. The averages are a true running mean from when they start (for about a
year of updates), then a slow moving average, so they settle within weeks instead of carrying the
season they began in (before
this, alder's share of the trees fell from 10.6% to 5.8% in one season; now it held between 10.8%
and 11.0% from late winter into spring):

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
| Alder & willow | waterlogged riverbanks, lake shores and swamps, in young forest (pioneers) |
| Cedar (wetland) | the same wet ground once the forest is old: it grows up under the alder and willow and takes over |
| Juniper | dry, rocky, limestone slopes |
| Tropical hardwoods | hot, wet old-growth jungle |
| Palm | hot, humid ground near water |
| Acacia | hot, dry savanna |

**Soil chemistry** comes from the rock beneath: granite, rhyolite and sandstone weather into
acidic soil; basalt into fertile base-rich soil; limestone and marble into alkaline soil. On the
hills map, pine and birch are common on acidic ground but almost absent on limestone, where maple,
beech and juniper take over. **Succession**: young forest in cool, high country is full of aspen,
with other pioneers; as it ages, beech and fir move in and aspen is shaded out completely. It fades
past a stand age of about 0.45, is gone by 0.7 (none in old growth), and doesn't grow in warm
lowlands, which are above 14 °C. On a test map, aspen made up 23% of young forest, 3% of middle-aged
forest, 0.1% of forest aged 0.6–0.8 and none of old growth. It made up 2% of the forest on the lowest
quarter of the land and 5–7% higher up; before this change it was 15% on the lowest quarter and 5% of
forest aged 0.6–0.8. On the
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

Standing water keeps soaking away even through soil that's already wet, slowly draining on down
into the groundwater, so water doesn't pool over flat land in sheets and lakes. Still ponds soak
away too; only fast-flowing rivers and deep lakes hold on to their water. The water that soaks in
wets the soil, so the plants keep it: unlike turning up evaporation, faster soaking doesn't dry the
forests out. The **Soaking in** slider (Climate tab, next to Evaporation) sets how fast. The
Forested plains preset uses a high setting, for its deep, spongy forest soils.
The **Stagnant water evaporation ×** slider (next to it, up to 1,000×) makes still, shallow standing water on
land evaporate faster: puddles, ponds and swampy sheets on flat ground. Flowing rivers, deep lakes
and the sea aren't affected. Only the standing water itself goes, not the moisture in the soil, so
turning it up stops water pooling without turning the forests into desert, unlike raising
Evaporation itself.

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

**Shelf reefs and cold-water coral.** The sea floor below the sunlit shallows is reef by default,
wherever the water is full-strength sea. In warm seas (above about 20 °C), coral reefs carry on
down to about 25 deep. Elsewhere, and deeper (down to about 40), reefs of cold-water corals (like
Lophelia) cover almost all of it, with only a few gaps. Only below about 40 is the sea floor bare.
Reefs die back where pollution, silt or low oxygen build up.
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
slopes. **Overlays → Biomes** shows the categories; hover the legend for descriptions. **Overlays → Single
biome** picks out one biome, chosen in the legend, in its own colour, with everything else flat grey
(light grey behind a dark biome, dark grey behind a light one such as snow or desert); the legend
says how much of the land it covers now. The **🌍 Biomes & trees**
window at the top right of the map has three line graphs over time, on tabs: **Biomes**, one line
per biome for its share of the land (counted on every fourth cell, looking through lying snow to the
biome beneath, so the lines don't swing with the winters); **Snow & ice**, the share of the land
under snow and under glacier ice; and **Trees**, one line per tree species for its share of all the
trees on the map (every ninth cell, weighted by tree cover averaged over about a year). A
point is recorded every couple of seconds whether or not the window is open, and saved with the
level (world.biomeHistory, world.snowHistory, world.treeHistory), so the graph runs from when recording began. Long
histories are thinned (every other point dropped past 400) rather than cut. Below the graph each
line is listed, largest first, with its share now; hover a name to pick out its line. Recording
takes about 10 ms every couple of seconds.

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

The **Remove animal** brush (🚫, under Wildlife) clears the animal chosen in the Wildlife panel from wherever you paint, as if it were hunted out, trapped or driven off. Brush strength sets how fast. Hold Shift to remove every kind of animal there.

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

**Sewage.** Every town, however small, pipes what its streets, works and harbours shed straight
out to the nearest open sea, wherever that is on the map, and its fields' runoff goes the same way.
It all pours out at one spot, the outfall, and spreads through the sea from there. No channels are
dug for it; sewer channels from older levels are filled in. A road's runoff stays beside the road,
with no foul stream down the valley. Only towns on a map with no sea still drain into their
streams.

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
runaway city. The steady clearing of new fields also slows as a town's farmland grows. Terracing only cuts ground that stands above the town, down to the terrace step below it. Ground below the town is never cut, and ground already on its step stays put, so cuttings can't deepen pass after pass into pits. Fields, plantations and canals that end up under the sea are destroyed: sunk, eroded away, or drowned by a storm surge. The crop or trees die and the land is no longer used, and the salt ruins the soil, so it takes years before the ground can be farmed again.

**Timber plantations.** Each town keeps about twice as much land under timber as under fields.
It picks the land where forest grows best, out to three times its town's reach, preferring an
existing forest. A plantation takes a compact block of that forest, grown out from the site up to
the **Plantation plot size** (120 cells by default; the slider goes from 20 to 2,000). On open
ground that suits trees, it plants a round block of that size instead. Small plots are felled and
regrown faster and rotate more often, and leave wild forest between them. A town-made plot far
bigger than the plot size, from an older level, is cut back to the part nearest its centre, and the
rest returns to the wild. Each town
keeps 2 to 4 plots to rotate among: it always starts a second, and goes on to up to four while its
timber land is less than twice its farmland. With the **Extra plantations** setting on, it keeps
starting more without limit, small villages included, wherever it finds land. Every
village (20 people or more) must have a plantation. A village without one looks twice as far afield
for land to plant. Failing that, it turns a block of its own fields over to timber, the fields that
would grow trees best, the outer ones first. In dry country these become watered, tended woodlots
that still grow. A plantation is only abandoned for worn soil after it has given at least one
crop. Plantations are planted with fast-growing stock and tended. A plantation is only cut once its
trees have grown back almost everywhere (80% of it near full cover). The town fells one plot at a
time, with a pause after each felling. The next plot it fells is always a different one (never the
same plot twice running while it has another): the one that has gone longest since it was last
cut. So it clears one plot, waits, moves on to another, and so on, while the others grow back. Then the whole plot
is clear-felled at once, leaving bare brown ground with slash
and the soil a little thinner. Natural forest joining onto it is felled with it and taken into the plantation, up to the plot size. Then the plot is replanted to grow again. Each crop of timber takes nutrients out of the soil (the
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

**Limited-harvest zones.** Any polygon can also be made a limited-harvest zone (🪓 in the Drawings
list), with or without protection. Its land is kept as woodland: towns never clear it for fields. Timber plantations inside are kept small: a quarter of the
Plantation plot size, and a felling can't spread past that into the forest beside it. A plot inside
is cut only when it has grown back fully (95% near full cover), and once cut it's left alone for a
long while (about 90 civilization steps) before it may be cut again, so harvesting goes much
slower there.

**Restrictions.** Each polygon also has its own set of restrictions (⚙ in the Drawings list opens
them under the shape, and the button shows how many are on). Each one is a separate switch:
- **No new towns:** no towns are founded inside, and towns don't spread their streets, industry or harbours into it.
- **No fields:** no land inside is cleared for fields.
- **No timber plantations:** towns don't plant timber inside or fell their plots there. Plantations you paint are still allowed.
- **No roads:** roads between towns, forest tracks and road widening keep out, going round it unless there's truly no other way. Footpaths are still allowed.
- **No earthworks:** no terracing, quarrying, quays, breakwaters, dams, or dumped spoil.
- **No hunting:** towns don't hunt your animals inside.
- **No fishing:** boats don't fish or trawl the sea inside, making it a marine reserve.
- **No fires set:** towns don't burn land inside to clear it, and no fires get away from them there. Lightning still can.

A protected zone (🛡) has the first five on, and a limited-harvest zone (🪓) has No fields on.


**The Land use overlay.** *Land use (clear view)* in the Overlay list shows what every cell is
used for in flat colours: fields (greener where irrigated), timber plantations (outlined, so you can
see where each one ends; brownish where just felled), towns, industry, roads, harbours, quays,
dams, canals, and wild land. Nothing is drawn over it: no pollution stains, no murky or silty
water, no clouds, fog or smoke.

**Painting plantations.** The **Plantation** brush (🌲, under Civilization) paints timber
plantation onto open land, and onto the nearest town's own fields, for the nearest town within
about 80 cells. The ground is planted with saplings, and the town tends it, fells it when grown
(together with any wild forest joining it), and replants it. Painted plantations are never given
up; the town rotates among them instead. When one's soil is worn out (nutrients below 30% or soil
depth below 10%), the town stops working it and lets it rest. A resting plantation is neither
tended nor felled: its trees grow back wild and its soil recovers. While none of a town's painted
plantations is being worked, it takes up the rested one whose soil has come back best (nutrients
60%, some depth of soil). So with two or more painted plantations, the town works one while the
others rest, in turn. Resting plantations show in the inspector and, paler, in the Land use
overlay. Painted cells join a painted plantation of that town nearby, or start a new one. Hold
Shift to clear plantation back to the wild.

**Footpaths.** The **Footpath** tool (🥾, under Civilization) lays a footpath where you drag. Shift-drag across one to cut out just that stretch (the rest stays, as separate footpaths); the ✕ in the **Footpaths** list removes a whole one, and **Remove all footpaths** clears them all. It
follows the lie of the land between the two ends like a road does (around the steepest ground,
along valleys), but it isn't built: no grading, no paving, and no upkeep, so it never wears out or
needs repair. Start the next drag at either end of a footpath (within about 4 cells) to carry the same path on, so a long winding path is laid a stretch at a time as one footpath with one name. It's drawn as a narrow, pale trodden trail. Feet keep plants from closing over it,
though there are no trees on the path itself. Each footpath's name is written small along the path
at its middle, turned to follow it. Name or remove footpaths in the **Footpaths** list (Life tab,
Civilization); hold Shift while dragging to remove the footpaths along a line.

**Bulldozing.** The **Bulldoze** brush (🏗, under Civilization) tears down anything built under it:
town streets and houses, industry, roads and bridges, harbours, quays, dams and canals. A dam's
wall is knocked down to the valley floor, letting its reservoir go, and a canal is filled in. It
leaves bare, broken ground that plants slowly come back to. Fields and plantations are left alone
unless you hold Shift. A town whose streets are all gone is abandoned.

**Towns live on timber.** A town burns and builds with wood all the time: it uses about 1.5 loads a
step for every thousand people. Its stock is filled by felling its plantations (and by the Harvest
tool). A small village gets by gathering fallen wood from the forest around it, but a town of a few
hundred or more can't. When the stock runs out and the wood coming in doesn't cover what the town
uses, it can support far fewer people (down to about a third) and shrinks until timber flows again.
Its label shows 🪵 while it's short. The town list shows its stock, what it uses, and how short it
is.

**Harvesting by hand.** The **Harvest** tool (🪵, under Civilization) clear-fells the plantation you
click, whether or not its trees are grown. It counts as its town's felling: the timber goes to the
town, the soil is worn (fewer nutrients, thinner), and the plot is replanted with saplings at once
and takes its turn in the town's rotation. Felling young trees gives little wood but wears the soil
just the same. The **Wood harvested** graph (Graphs window, Civilization) shows the timber felled between samples, by the towns and with the Harvest tool; each felled cell yields as much as its trees had grown.

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

## More of civilization: mines, smoke, migration, disease and worn-out land

**Mining.** A town of a few hundred sinks a mine into the hard, ore-bearing rock near it (granite,
basalt, gneiss, schist and the like, just beneath the surface), with a haul road out to the pit's
edge. More mines come as it grows (one more for every 3,000 people). The open pit is deepened year
by year, up to about 14 down, and the waste rock goes onto a spoil heap beside it, downhill. The
heap is raw and poisonous: nothing grows on it, little grows around it, and its acid, metal-laden
drainage fouls the streams down to the sea. Each working mine makes the town richer, so it can
support up to 40% more people. Mines are earthworks, so the No earthworks restriction keeps them
out, and the Destruction slider sets how fast they're dug.

**Air pollution and acid rain.** Smoke from industry (heavily), towns and mines drifts downwind with
the prevailing wind, about 2 cells a step, spreading and thinning as it goes. Where it settles, acid
rain falls: forest health drops, and where the smoke is thick, the trees die back. The soil of
fields turns sour and loses fertility. The *Air pollution* overlay shows it, and so does the
inspector.

**Wildfire smoke.** Every burning cell pours smoke into the air, far more than any town. It is kept
apart from the towns' smoke (world.fireSmoke) because it is soot and ash rather than the sulphur
that makes acid rain, so it doesn't sour the soil or kill trees. It drifts downwind the same way, and a
big fire's plume can cover a large part of the map. It clears faster than the towns' haze, and much
faster while it rains. A town under thick smoke has a few of its people die each step (😷 on its
label). The *Air pollution* overlay draws both kinds of smoke, the inspector shows *Wildfire smoke*
separately, and the *Smoky air* graph tracks how much of the map is under smoke.

**Migration.** People move along the roads and sea routes between linked towns. They leave the
town that is more crowded, nearer to or past what its land can support, for the more prosperous
one, faster the bigger the difference. Booming towns draw people in, and failing ones empty, some to
ghost towns. The town list says when people are moving in or away.

**Epidemics.** Now and then disease breaks out in a crowded town, more readily where its water is
dirty. It spreads through the town, killing some of those it strikes, and along roads and sea routes
to the towns it trades with. Then it burns out within about 40 steps, leaving the survivors immune
for a good while. A town with an outbreak shows 🤒 on its label. The **Epidemics** switch
(Civilization) turns them off.

**Overgrazing and desertification.** In dry country, the farms' livestock strip the grass and scrub
around the fields down to bare soil, which blows and washes away. The land degrades toward desert:
little grows back there, the soil thins, and the bare ground creeps outward where it's dry. Taken off
grazing, it slowly recovers, more slowly the drier it is. Degraded land shows sandy on the map and in
the inspector.

**Replanting.** Every plantation is replanted with saplings straight after it's felled, so it
never lies bare. Plantation land that used to be fields (fields a town turned over to timber, or
fields you painted with the Plantation brush) is planted out with nursery stock: it starts further
along and grows back about three times as fast.

**An invasive pine.** The plantations are planted with a fast-growing exotic pine, and it escapes.
Every plantation is all pine. From the plantations, and from wild forest it has already taken, its
seed spreads slowly into the native forest around: tree by tree, a few cells a decade, and now and
then a long jump on the wind or with birds. Seed also travels along the roads, on boots, wheels and
timber carts. A road that passes a plantation or invaded forest picks it up, carries it along the
road network, and the forest beside the road is invaded too, far from where it started. Where the
pine takes hold, the native trees' seedlings can't establish under it, so forest health falls. It
supports no wildlife: an animal can live in an invaded forest only as far as the native trees
remain. It doesn't grow on open ground, and dies back where the forest is cleared or burnt.

It shows as a darker, bluer green in the forest, in the *Invasive trees* overlay and in the
inspector. The **Invasive trees** brush (🌿, under Wildlife) paints it into forest, and Shift cuts it
out, though it will creep back from invaded forest nearby. The **Invasive plantation pine** switch
(Civilization) plants the plantations with native trees instead. Pine already loose in the wild
keeps spreading, though, into those native plantations too, and wild pine felled with a native
plantation is no use as timber.

**Old fields go back to forest.** Fields that go out of use are remembered as old fields. That
includes fields abandoned with their town, left fallow, given up as too steep, or cleared with the
Clear fields tool. With forest near enough to seed them, they grow back to forest, not grass, and
about twice as fast as other open ground: scrub and then trees, with no grass sward to hold them
back. Where the invasive pine is near, or its seed has come down a road, it's quick to colonise
them as a pioneer on bare, disturbed ground, the one place it grows outside forest. So an old field
can come back as native forest, pine or a mix. Once it's forest again, it's just forest.

**Water that doesn't blink.** A thin sheet of water drags on the ground (more friction the shallower
it is), so sheets creep and settle instead of sloshing to and fro. Soaking in and the extra
evaporation of still water go by how still the water has been over the last few seconds, not at
that instant, and take at most a few percent of it per step. So a pool shrinks steadily instead of
vanishing and refilling. On screen, water fades in and out, appears above 0.1 deep and disappears
only below 0.06, and the damp ground under it darkens gradually.

## Windstorms

Now and then a gale sweeps across the map with the prevailing wind, fast and wide. It throws trees:
patches of forest go down (windthrow), worst on exposed ridges and coasts, in old tall stands, and
on wet ground where the roots don't hold. The fallen trees become dead wood, fuel for later fires,
and their litter goes into the soil. A stand thins out, or in a bad storm it's flattened outright,
one tree taking the next down with it. The gaps grow back to forest: the seedlings and saplings already growing under the old trees come up in the light, even on ground where new forest couldn't start from scratch. Dead wood rots away over the years, feeding the soil as it goes, and only mildly slows the seedlings. In autumn the gale strips the broadleaf trees' leaves early,
and they stay off until spring. About one year in ten (with Seasons on) is a **windstorm year**
(💨 on the calendar bar), with gales far more often and fierce enough to clear whole forests. The
**Windstorms** slider (Climate tab) sets how often they come; 0 = none.

## Fire resiliency

The **Fire resiliency** setting (Wildfires) makes big fires harder for rain to put out. Once a fire
is large (more than about 80 cells burning, fully by about 500), its heat and the updraft over it
dry the air and drive the rain off, so rain puts it out far more slowly: about three times as
slowly at 0.5, five times at 1, and nine times at 2, where a big fire burns on through the rain.
Small fires, standing water and snow put fires out as before. 0 = rain puts out any fire alike.

**Towns clearing the pine.** A town clears the invasive pine only where it must: where it presses on
its own fields, streets and works, or where it has got into the town's plantations (when they're
native). Work gangs cut it out there, the worst first. The work costs the town people, about one for
every 0.4 of a cell's worth of pine cleared, and the cut pine is worthless as timber, so it isn't
added to the town's wood. The **Towns clear invasive pine** switch (Civilization) turns it off.

## Climate change (`src/sim/climateChange.js`)

A Civilization setting (**Climate change**, with an **Emissions** slider). Greenhouse gas in the air
(world.carbonPPM) starts at 280 ppm. The towns add to it: burning (1.5 × 10⁻⁶ ppm a person a town
step), industry (4 × 10⁻⁴ a cell) and wildfire (2 × 10⁻⁴ a burning cell); the sea and the land take
0.02% of the excess back up each step. The climate warms towards 3 °C for every doubling of the gas,
but slowly (0.3% of the way each step), and every temperature on the map includes the warming
(climateParams.warming), so snow lines and tree lines climb, glaciers shrink, species move uphill and
the sea warms. While it's warmer the sea rises (0.00025 a step for each degree), and the rise is
applied to the sea level a little at a time. Switched off, the warming fades away. The *Greenhouse
gas* and *Warming* graphs (Climate) track it, and the menu bar shows the warming. In a test, a city
of 8,000 with 200 cells of industry raised the gas from 280 to 401 ppm and the climate 1.28 °C in
three years (at about 500 town steps a year); with its emissions then stopped, the warming went on
rising to 1.43 °C a year later before slowly easing (1.27 °C two years on), and the sea had risen
0.73.

## Forest carbon (`src/sim/forestCarbon.js`)

Every cell holds carbon: in its trees (up to 4.5 t, more the denser and older the stand: young
regrowth holds a quarter of what old growth does), its grass (0.3 t) and its soil's organic matter
(up to 1.5 t, built up under long-standing forest). The map's store (world.carbonTotal) is recounted
every town step; what it loses to felling, clearing and fire goes into the air as greenhouse gas
(0.004 ppm a tonne) and what regrowing forest gains is taken out, so the land's carbon feeds climate
change. **Overlays → Forest carbon** maps it, the inspector shows it, and the *Carbon in the land*
graph tracks it. In a test the map held about 107,000 t, old growth 5.5 t a cell and bare ground
0.04; burning a 40×40 block of forest released 1,552 t, which became 6.2 ppm of greenhouse gas.

## Predators, livestock and trophic cascades (`src/sim/ecology.js`, `src/sim/civilization.js`)

Grazers already browse young trees (world.browse holds the forest back from regrowing). Now they
also fear their predators: where the animals that hunt them are about, they keep moving and browse
up to 65% less, so the young trees there get a chance (the landscape of fear). Towns' livestock
graze the land around their farms, and predators there take some of it (food lost, up to 30% of
the town's); towns cull the predators around them, hardest near their herds (**Predator control**,
Civilization), and guard their herds (**Herding & fencing**): fewer losses, and so less culling.
Cull the predators away and the grazers they kept in check boom and browse out the young trees, and
the forest stops regenerating: a trophic cascade. **+ Deer & wolves** (Life → Wildlife) and the New
simulation dialog's *Deer & wolves* add a starter food web: deer (meadows and young trees, avoiding
deep snow) and wolves hunting them. In a test over 260 steps, deer on their own rose to 0.65 (as a
share of what the land can hold) and browsed the land to 0.58, while with the wolves they stayed at
0.066 and browsing at 0.055, and land that was regrowing kept more cover (0.56 against 0.51 and
falling). Around a town of 1,500, culling cut the wolves nearby from 0.041 to 0.009 and the
livestock lost by half; good herding cut the losses to a sixth and left more wolves (0.015).

## Pollinators (`src/sim/pollinators.js`)

Bees, hoverflies and butterflies (world.pollinators, 0…1) live where there are flowers and nest
sites: meadows, scrub and old fields best, open woods and forest edges well, deep closed forest
poorly, towns, bare ground and plantations hardly at all, and the farmland itself only a little.
They forage about three cells out, and fewer are about in winter. The farms' **Pesticides**
(Civilization, 0–1) kill them on the fields and, drifting, around them, but save some crop from
pests (up to 10% more). A field's harvest depends on how many pollinators reach it: 70% with none,
100% with plenty. **Overlays → Pollinators** maps them (farmland hatched), and the inspector shows a
field's pollination. In a test on a farming town's 248 fields, its crops yielded 86% unsprayed (0.23
pollinators on the fields), 82% at the usual spraying (0.11) and 78% sprayed heavily (0.01), while
the meadows away from the fields kept 0.85.

## Fire followers (`src/sim/fireFollowers.js`)

Some plants and animals live only on freshly burnt ground, and only in the **smaller burns**. Each
connected stretch of burnt ground is measured once its fire is out; a burn up to **Small burn size**
cells (Wildlife, default 400) counts fully, fading to nothing at two and a half times that. The heart
of a big burn is out of reach of wind-blown seed and of animals moving in from the edges for years,
and its hot fire cooks the seeds waiting in the soil. Fire-follower ground (world.burnSuit) is
remembered for a few years after the ash has gone and fades as the burn greens over.

- **Fireweed** (world.fireweed) arrives on the wind from fireweed nearby (a little from far off),
  carpets small burns in magenta for a few years and is shaded out as shrubs and trees return.
- **Fire poppies** (world.firePoppy) sprout from a seed bank in the soil (world.poppySeeds, under
  scrub and open ground) only after a fire: a summer or two of flowers, which refill the seed bank.
  A big fire reduces the seed bank to a third.
- Fire flowers are rich in nectar, so pollinators thrive on small burns.
- Animals: a new habitat, **Recent small burns**, and two new foods, **fire-following flowers** and
  **burnt and dead trees**. Animals of that habitat hang on thinly in the forest between fires and
  are drawn from far off to a fresh small burn (as fire beetles home in on smoke). **+ Fire
  followers** adds fire beetles, black-backed woodpeckers that eat them, and fireweed moths.

**Overlays → Fire followers** shows fireweed, fire poppies, small burns, burns too big for them and
fires burning. In a test, an 8×8 burn was 69% fireweed with fire beetles at 0.54 and woodpeckers at
0.04 after 1,200 frames, while a 34×34 burn (1,156 cells) next to it had none of them. A 6×6 burn
over a seed bank of 0.33 flowered at 0.68 fire poppies, and the seed bank grew to 0.59.

## Towns and parks washed away by the sea (`washAway`, `src/sim/civilization.js`)

Wherever the land goes under the sea for good (a rising sea, sinking ground, the coast eroding
back), the sea washes away what the towns built there: streets, roads, industry, harbours, quays,
dams and mines, and the footpaths. A bridge stands until the water is a cell's depth over it. A
town whose centre goes under is lost, its people gone. A park more than 60% under the sea is gone,
its polygon and its record. Fields, plantations and canals were already destroyed by the sea and
by storm surges. This runs with the towns' step, whether or not Civilization is on, and the status
line names what was washed away. In a test, the sea was raised step by step over a town 3.3 above it and a beach park beside it:
the town was lost when the sea rose 3.5, everything it had built was gone at
7.5, and the park went then too, while a national forest inland stayed.

## Land the sea covers becomes beach (`drownedGrassStep`, `src/sim/coast.js`)

A strict rule: any land the sea covers, below high tide or under a storm surge, becomes beach. That
includes grassland, forest, scrub, desert, bare rock, fields and plantations; built-over ground is
washed away instead. The waves strip its plants and turf and leave beach of the kind that suits the
spot (world.beachSand, world.beachType):
- **Mudflat** on flat, soft ground.
- **Shingle** on steeper or hard, rocky ground (black **basalt boulders** where the rock is basalt).
- **Sand** everywhere else.

Where the waves have already made a shore of it, that's the kind it takes. Out of the water again it
stays that kind of beach on the map, in the biomes and in the inspector ("Drowned land"). Plants
there can't grow past what the beach allows: bare at first, then dune grass or salt marsh, and only
slowly the land it was. At this map's average rain (0.39, 3,600 frames a year) it looks like
grassland again after about 55 years and has fully recovered after about 90.

In a test, the sea was raised 3 over 3,603 cells of land and then lowered again. All 3,603 became
beach: 2,317 of grass and scrub, 977 of bare ground and 309 of forest. On that map's hard rock most
became shingle, with basalt boulders, sand and a few mudflats.

## Fungi and root rot (`src/sim/fungi.js`)

**Fungal diversity** (world.fungi, 0–1) is the fungal life in the soil: mycorrhizal fungi partnering
with the trees' roots, and decomposers breaking down litter and dead wood.
- **Where it's richest:** under old forest of many kinds of trees, and most of all under trees whose
  roots partner closely with many fungi: pine, fir, spruce, larch, birch, aspen, oak, beech, alder,
  shore pine, Sitka spruce and cork oak. A mod species can say which it is with `ecto: true`.
- **Where it's poor:** under young or single-kind stands, in plantations (35%), on fields (30%) and
  built-over ground (10%).
- **What sets it back:** fire and smoky, polluted air. It builds back over decades and is lost fast.
- **What it does:** where it's rich, forest grows back faster (up to 1.3 times), dead wood rots
  sooner (up to 1.6 times), and soil builds faster from the decaying matter (up to 1.4 times).

**Honey mushroom** (Armillaria, world.rootRot, 0–1) is a root and butt rot, switched on by **Root rot
(honey mushroom)** under Wildlife, with a **Root rot strength** slider.
- **How it starts:** an outbreak starts now and then in old forest where there's none.
- **How it spreads:** slowly underground from stand to stand along bootlace-like strands, and now and
  then by spores to a stand up to half the map away.
- **Where it takes best:** old trees, trees stressed by dry soil, and plantations. It takes poorly
  where the soil's fungal life is rich.
- **What it does:** it thins the stand from a light infection up. Infected trees lose roots and crown,
  so tree density falls (by up to about two thirds). Some rot at the base and fall, more the heavier
  the infection, the old trees first. While a stand is infected it can't close up again (its cover is
  held down by up to a third). A heavy infection (over 0.55) kills trees fast, and some of the stand
  stops being forest.
- **What stops it:** with its hosts gone, it dies out and the forest grows back.

In a test on three patches of old forest (density 0.90, cover 0.95) after ten steps:

| Patch | Tree density | Forest cover | Still forest |
|---|---|---|---|
| Healthy | 0.90 | 0.95 | 64 of 64 |
| Light infection (grew to 0.44) | 0.49 | 0.83 | 64 of 64 |
| Heavy infection (0.83) | 0.19 | 0.74 | 54 of 64 |

**Tools** (Life group of the tool bar, Shift reverses each):
- **🍄 Fungi** brings fungi into the soil, as foresters and gardeners inoculate it. Fungal diversity
  rises where you paint, and the added fungi (world.inoculum) hold it up for some years where plants
  grow to host them, fading over about five. **Shift** strips the fungi out (fungicide, or sterilised
  or scraped soil).
- **🟤 Root rot** introduces honey mushroom into forest (it takes only where trees are), and it spreads
  from there. **Shift** cures it. It needs Root rot switched on.

In tests on a grassland patch, painting raised fungal diversity from 0.28 to 0.69. It was 0.46 a year
later and back to 0.30 after five years, and Shift took it to 0.08. Root rot painted into old forest
at 0.25 built up to 0.95 and spread to 192 cells in a year; Shift cured it to 0.03.

The **Fungi & root rot** overlay shows fungal diversity (pale to green to violet) with the rot over it
(orange, red where it's killing the trees). The inspector shows both, and the graphs add
**Fungal diversity** and **Root rot**. In a test seeded with three outbreaks and run without regrowth
for 600 steps (about five years), the rot reached 1,745 cells and killed 5.8% of the forest, still
spreading. In the full simulation the killed stands grow back once the rot has died out of them.

## Spotlight (`src/ui/spotlight.js`)

Hover over something and the map shows just that: its cells keep their colours and everything else
fades to white, until the pointer moves off. It works for:
- **Towns**: their row in Civilization, or their name on the map. Everything the town owns lights up
  (streets, fields, industry, roads, harbour), with its centre.
- **Parks and drawings**: their row in Drawings, or their name on the map. The area inside them (or
  along them, for a line) lights up.
- **Footpaths**: their row in the footpath list.
- **Animals**: their row in Wildlife. Brighter where there are more of them.
- **Tree species**: in the Tree species map key, or the Trees tab of Biomes & trees. Where each species
  grows, brighter the bigger its share.
- **Biomes**: in the Biomes map key, or the Biomes tab of Biomes & trees.
- **Snow and ice**: in the Snow & ice tab.
- **Land uses**: in the Land use map key.

Working out a mask takes a few milliseconds: 33 ms for a species and 11 ms for a biome on a 256×256
map.

## Fire-resistant and giant trees (`src/sim/species.js`, `src/sim/fire.js`)

Three new tree species have thick, fire-resistant bark (`fireproof`):
- **Giant sequoia**: cool, fairly dry mountain slopes with deep soil, up to about 90 m.
- **Coast redwood**: in the summer fog a little way in from a cool coast, out of the salt spray, over
  100 m.
- **Cork oak**: warm, dry country, about 20 m.

Every species now has a typical grown height. The inspector shows the stand's **Tree height** (now,
and when grown, growing with the stand's age), its share of **giant trees**, and its **Fire
resistance**. Giant stands hold up to three times the carbon of an ordinary old stand.

- **They live through smaller fires.** Where fire-resistant trees make up enough of the stand
  (world.fireproof over 0.15), a crown fire burns there as a surface fire: the undergrowth goes,
  most of the canopy stays, and the stand keeps its age.
- **A megafire still kills most of them.** Once a fire has burnt more than 2% of the map in all, or
  1.2% is alight at once, only about a third of even the thickest-barked stands it reaches survive.
- **They gain ground where fire comes back.** Without fire they grow slowly and lose out to faster
  neighbours (rare on a map that never burns); where fire has been through in the last few decades
  (fading over about 30 years) they're up to three times as competitive.

Tests with dense forest of fire-resistant trees (0.9) and heavy fuel:

| Fire | Fire-resistant forest left | Ordinary forest left |
|---|---|---|
| 100 cells | 100 of 100 | 0 of 100 |
| 400 cells | 400 of 400 | (not run) |
| 2,025 cells (a megafire) | 1,219 of 2,025 | 0 of 2,025 |

On a map with no recent fire, sequoia led 10 cells, redwood 7 and cork oak 93. Surface fires now go
out as soon as the undergrowth is burnt up; before, they could smoulder on without end.

## Farmland cap (`farmCapStep`, Civilization: Farmland cap %)

The most of the map's land that may be farmland, all the towns together (1–100%, default 100 = no
cap). Once the fields reach it, towns clear no more and grow only on the food they already have
(and the sea's). Lowered below what's farmed now, the fields farthest from their towns are given up
a few at a time (a tenth of the excess a step, at least 20 cells) and go back to the wild as old
fields. In a test with towns held at 4,000 people, farmland at 1.44% of the land fell to a 1% cap
over nine town steps and stayed there.

## Keeping trails from getting too dense

Towns' trails (park trails, old-growth trails, wilderness trails) used to pile up: each one was
walked out from the town centre along its own route, and a town laid a new old-growth trail every
time a park took one of its trails over. Now:
- A new trail **keeps to the paths already trodden** where it can (path routing costs a fifth as much
  along an existing footpath), and **branches off the nearest footpath** when that's much nearer than
  the town.
- No new old-growth trail, and no new park trail loop, where footpaths already cover more than 7% of
  the ground around. A town's old-growth trails all count towards its limit, including those a park
  has taken over.
- **Thinning**: wherever footpaths cover more than about a sixth of the ground around, the newest
  town-made trails there are taken up and grow over, until it's thin enough. Paths you drew are never
  touched, and every park keeps at least one trail. This also clears trail mazes already on a map.

In a test, a lattice of 26 town trails over a 60×60 block (37% of the ground footpath) was thinned
to 4 (8%), keeping a path drawn by hand, and a second trail out to a spot near the first one's end
shared 47% of its route with it.

## Bare ground in reach of the waves is shore

Bare ground (plant cover 25% or less) below the reach of the waves (high tide plus 1.2, plus any storm
surge running) is never classed as Barren, Desert or Mesa. It is shore, of whatever kind the waves
have made of it (sim/coast.js): **Mudflat** on flat, sheltered shores, **Sand beach** where sand
gathers, **Shingle beach** on steeper or exposed shores with little sand (and basalt boulder
beaches), or **Sea cliff** on steep faces. The shore zone reaches as high as a storm surge does.
Ground flooded farther inland than the shore zone (water standing on it) becomes mudflat if it's
flat and shingle if not. This sets the biome the inspector, the Biomes overlay and the biome graphs
show. On the natural map each kind of coast has its own colour, strongly enough to tell them apart:
warm gold sand, cool blue-grey shingle, dark olive mudflat, dark rock for sea cliffs and near-black
basalt boulders. The wet lower shore below high tide is darker, so the tide line shows. In a test on a rocky island,
all 1,467 bare cells in reach of the waves (1,369 with a surge of 2) came out as shingle or sand
beach, apart from a little dune sand just above the waves' reach; none came out Barren.

## World dynamics (`src/sim/dynamics.js`)

Sixteen processes that make the world change and surprise, each a setting. They run every 30 frames,
and big events are announced in the status line.

**Land events** (Land tab):
- **River floods** (and *Flood frequency*): in storms and wet spells a flood now and then comes down
  the rivers for some days, swelling them over their banks onto the low ground beside them.
- **Town levees:** towns of 600 or more raise their river banks where their streets meet the river,
  keeping ordinary floods out. A flood that overtops a levee can breach it, and the town loses people.
- **Meandering rivers:** on flat ground the current cuts into the outside of each bend and builds up
  the inside, so the bends grow and walk across the valley floor.
- **Debris flows:** heavy rain on a fresh burn scar sends mud, ash and rock down the slope and along
  the gully, burying the ground and blocking the stream where it stops.
- **Starved beaches:** a dam traps its river's sand, so the beaches near that river's mouth get none;
  sea walls and docks starve the beaches beside them too. Starved beaches lose their sand, then the
  shore wears back.

**Climate events** (Climate tab):
- **Drought cycles:** dry and wet runs of years over a 6–12 year cycle (like El Niño), with drought
  years several running and then a run of mild ones. Needs Seasons.
- **Earthquakes** (and *Earthquake frequency*): a quake of magnitude 5 to 8 (big ones rare) sets off
  landslides on the steep slopes in reach, damages towns and lifts the ground along the rupture. An
  undersea quake over magnitude 6.3 sends a tsunami: it floods the low coast nearby, strips it to
  beach and hits the towns there hard.
- **Permafrost:** ground frozen all year where the mean is below about −3 °C. As it warms it thaws:
  the ground slumps, ponds form, and its rotting peat gives off greenhouse gas (with Climate change
  on).
  **Overlays → Permafrost** shows frozen ground (deep blue, colder and icier), ground still frozen
  but within about 1.5 °C of thawing (pale cyan), ground thawing now (red), thawed ground (brown) and
  ground never frozen (grey). Its key counts the frozen and thawed cells. In a test, a map cooled by
  15 °C froze 11,656 cells; warmed back, they all thawed within about 20 steps, a sudden jump.
- **Bark beetle outbreaks:** native beetles erupt in drought years or after mild winters, spread
  through stressed conifer stands and kill them, the forest going red then grey. Hard winters and
  the end of a drought knock them back.

**Ecosystem changes** (Life tab):
- **Wetland drainage:** towns ditch the wetlands near them; the ground dries out, its peat rots and
  sinks, and dry peat that catches fire smoulders underground and creeps on. **Rewet wetlands** lets
  them fill back up.
- **Seed dispersal:** each tree species grows only where its seeds have reached (world.speciesHere).
  Wind-blown pioneers spread fast, heavy-seeded trees slowly, with a few long flights by birds, so
  forest comes back from its edges after a big fire or clearing.
- **Invasive animals:** feral pigs escape from farming towns (rooting up soil and seedlings), feral
  goats are let loose by the harbours (stripping young trees), and ship rats come ashore and prey on
  the small animals.
- **Crop pests** (and **Crop rotation**): pests and blights break out in big blocks of fields and
  spread field to field. An infested field yields up to 60% less. Hedgerows and wild ground among
  the fields slow them, and so does rotation.

**Town life** (Life tab):
- **Trade:** towns joined by working roads, or both with harbours and boats, trade. Each specialises
  in what its land is best for (farming, timber, mining, fishing or industry). Food a town can spare
  is sold to its partners, more to those that make something else, so a trading town can grow past
  what its own land feeds. The town's tooltip shows its specialty and partners.
- **Urban heat & smog:** towns are up to 2.5 °C warmer than the country around them, and on still
  days their smoke builds up as smog, sickening people and plants.
- **Salt in irrigated fields:** in dry, hot country irrigation leaves salt behind (world.soilSalt). The
  harvest falls, and a field too salty to farm is abandoned under a white crust.
- **Ruins:** abandoned towns' streets and buildings stand as ruins, crumbling over the decades as
  forest grows up through them. Old roads stay visible as tracks.

**Overlays** for these layers:

| Overlay | What it shows |
|---|---|
| Bark beetles | the beetles, over the conifer forest they could reach |
| Crop pests | every field, by its pests |
| Soil salt | salt in the soil, over the irrigated fields |
| Ruins | ruins of abandoned towns and old roads |
| Drained wetlands | drained wetlands, darker over deep peat, and the wetlands still wet |
| Urban heat | how much warmer the towns are |
| Starved beaches & levees | beaches losing sand, healthy sand beaches, and town levees |
| Seed dispersal | how many tree species have seeded in at each place |

The Pollinators overlay is now called **Pollinators (bees)**, and both overlay menus are sorted
alphabetically, with None first.

Tests, on a 256×256 map:

| Feature | Result |
|---|---|
| Speed | 82 ms a frame with these off, 79 ms with all of them on |
| River flood | land water rose to about 800 units and drained away again |
| Earthquake | magnitude 5.0, one landslide |
| Tsunami | an undersea magnitude 6.8 quake set off three landslides and a tsunami |
| Bark beetles | conifer forest around an outbreak fell 34% in 12 steps (an untouched area 10%), the outbreak growing from 49 to 75 cells |
| Seed dispersal | seeds reached 78 of 400 cells of an emptied patch in 20 steps |
| Feral pigs, ship rats | arrived, with news |
| Wetland drainage | towns drained 8 wetland cells |
| Crop pests | 53 of 201 fields infested and the harvest at 90% without rotation; 35 and 97% with it |
| Trade | two harbour towns traded by boat; one bought in food for about 650 people |
| Urban heat | up to 2.5 °C over the town centres |
| Ruins | an abandoned town left 66 cells of ruins |
| Debris flows | 26 ran off a burnt, rained-on slope |
| Starved beaches | 253 beach cells near sea walls and docks |
| Drought cycles | 40 years ran `w....ww.........DD...D.w.wwDDD.D.wDww..D` (D drought, w wet): runs, not scattered years |

Levees, meanders, salt and permafrost run without errors but weren't measured: the test map has no
river through a big town, no dry irrigated country and no frozen ground.

## Town centres (`townCoreStep`, `src/sim/civilization.js`)

Every town grows a downtown out from its centre (Civilization: **Town centres**, on by default).
- **What's in it:** it's entirely paved: solid streets, squares and buildings, with no gaps of grass
  or trees.
- **How it grows:** a cheapest-path flood from the town's centre takes the gentlest ground first and
  flows round steep slopes, water, other towns and protected areas. It grows a few cells a step, to
  about one cell for every 80 people.
- **What it replaces:** fields, plantations and open ground in its way are built over. Roads,
  industry, harbours and the rest stay as they are, and a centre cell turned into one of those stops
  being centre.
- **On the map:** dense grey blocks and streets, the **Town centre** biome, and dark red on the Land
  use overlay.

In a test, a town held at 5,000 people grew a centre of 61 cells (its target 62) in 15 town steps,
every cell of it fully paved.

## Built-up waterfronts (`buildQuay`, `buildDock`, `waterfrontSprawl`)

Coastal towns build up their waterfronts, as hard as the **Waterfronts** setting says (Civilization,
0–2, default 1):
- **Quays** go up sooner and far more of them (up to about three times as many at 1), out to a wider
  reach, and they take the **beaches first**: the sand and shingle are paved over for raised decks
  with a sharp drop-off into dredged deep water.
- **Docks**: paved piers built straight out from the quays over the water, standing above the tide,
  with deep water dredged along both sides and off the end. They are spaced along the waterfront,
  about one for every six quay cells.
- **Dredged berths** (world.berth) beside quays and docks are kept deep: spoil from the town's
  earthworks is never dumped there, so reclaimed land doesn't swallow the docks.
- **Dense streets** fill the open ground behind the quays and docks, nearest first.
At 0 a town only walls the odd stretch of shore, as before. In a test, a town of 3,000 built 42 quay
cells, 4 dock cells and 70 town cells in 10 town steps, against 52 town cells without the sprawl,
and every dock cell had deep water beside it.

## Keeping your simulations

The app asks the browser to keep its storage persistent (navigator.storage.persist), so that a
browser short of disk space doesn't clear the site's data. If the browser declines, the home screen
says so and suggests exporting the simulations you want to keep. If the list of simulations is lost
but their saves are still there, the home screen rebuilds the list from them.

## Tools for fuel, fire flowers, groundwater, fish, crossings and fish ladders

Brushes for the newer parts of the simulation. Hold Shift to reverse each one.
- **🍂 Fire fuel** (Life): piles up fuel on the forest floor where there's vegetation. Shift clears
  it, like thinning or clearing brush.
- **🌸 Fire flowers** (Life): sows fire poppy seed into the soil, and on fire-follower ground (a
  recent small burn) brings up fireweed, plus fire poppies if it's freshly burnt. Shift clears the
  flowers and their seed.
- **💧 Groundwater** (Water): raises the water table. Shift draws it down, as heavy pumping would.
  Left alone it drifts back to its natural level.
- **🐟 Fish** (Ocean): restocks the sea. Shift fishes it out, and below about a fifth a stock
  collapses.
- **🌉 Wildlife crossing** (Civilization): builds crossings on the road cells painted over. Shift
  removes them.
- **🪜 Fish ladder** (Civilization): gives the dams painted over a fish ladder. Shift removes them.

Pollinators, forest carbon and the greenhouse gas have no brush: they are worked out from the land
each step, so you change them through what they depend on.

## More wildlife settings

Wildlife has new settings alongside Population speed:
- **Food abundance** (0.3–2): how many animals each place supports.
- **Predation** (0–2): how hard predators hit their prey.
- **Roaming** (0.3–3): how far animals range and how fast they spread.
- **Hard winters** (0–2.5): how much cold, heat and deep snow kill (at 0, never).
- **Roadkill** (on): roads kill animals and split their ranges. Off, roads don't affect them.
- **Wildlife disease** (off): an outbreak now and then sweeps a crowded population for a while, worst
  where it's densest.
- **Fire followers** (on) and **Small burn size**.

## Roads, wildlife crossings, dams and fish ladders

**Roads split habitat.** Land animals crossing a road are killed by the traffic (4% plus a share for
every 3,000 people a day, up to 60% of those on the road each step), and they shun the noisy band
about three cells either side of a busy road (its carrying capacity there falls up to 97%), so a
busy road slows them spreading across and splits their range. With **Wildlife crossings**
(Civilization) towns of 500 or more build over- or underpasses (world.crossing) on busy stretches
of their roads where animals live thickly on both sides, at least 12 cells apart; animals cross
there safely and don't shun the ground around them. The inspector shows a road's traffic and what it
kills. In a test, deer filling the land north of a road 1,500 people a day used took about three
times as long to start colonising the empty land south of it (0.005 against 0.016 after 150 steps)
and were 16% fewer there after 600 steps; with crossings every 25 cells they did a little better
(0.007, then 11% fewer). (Animals still trickle across: the effect is a strong slowing, not a wall.)

**Dams block fish runs.** A town's dam (towns over about 700 people dam a river valley) now stops a
run like salmon reaching its spawning grounds upstream, all but 2% of it. With **Fish ladders**
(Civilization) towns give their dams fish ladders (world.fishLadder) and most of the run (60% of the
usual passage) gets past. The inspector says whether a dam has one. (Not yet tested in a running
simulation: the test map's rivers didn't reach the sea, so no run started.)

## Fish stocks, quotas and restoration (`src/sim/civilization.js`)

**Fish stocks.** The sea holds fish (world.fishStock) up to what it can feed (world.fishK: healthy
beds, oxygen, clean water). They breed back (3% a step at most, fastest half full) and drift through
the sea, so a marine reserve (an area drawn with *No fishing*) restocks the water around it. Fished
below about a fifth of full, they can't spawn well and recover only very slowly: a collapse. Boats
take their catch from the stock, fishing hardest near their harbour, and a town's catch is only what
its grounds hold. With **Fishing quotas** (Civilization) a town cuts its catch back once its grounds
(weighted by where it fishes hardest) fall under half full, and stops near a collapse. **Overlays →
Fish stocks** maps them (reserves hatched green); the *Fish stocks* graph tracks the sea's. In a
test over 600 steps on one harbour's grounds, 8 boats left them at 58% of full; 40 boats fished them
down to 3% without quotas but held them at 22% with quotas; 120 boats crashed them even with quotas
(they bit too late), and a crashed stock left alone had only recovered to 9% after 400 steps.

**Restoration** (Civilization, a setting): towns of 400 or more replant native trees on the
worn-out, burnt and grazed-out land around them, more when they're bigger and wild land near them is
scarce (the cover rises, the land stops degrading, world.replanted marks it for the inspector), and
take down a dam that blocks a fish run. In a test a town of 2,500 replanted 72 of the 876 worn-out
cells around it in 30 town steps.

## Groundwater (`src/sim/groundwater.js`)

Beneath the soil every cell holds groundwater (world.groundwater, 0 dry … 1 full). Left alone it
settles at a natural level (world.gwNatural) set by the rain, the soil and the lie of the land
(valley floors and hollows fill highest). Rain recharges it (less under pavement), water standing
on the ground leaks down into it, it seeps slowly towards its neighbours, and where it's full in a
valley bottom it seeps out into the stream as base flow, which keeps rivers running through dry
spells. Towns pump it from wells in a cone around them: their people (0.00004 a person a step) and
their farmland. Pumped faster than the rain refills it, the water table falls; where it's pumped
nearly dry the ground settles (subsidence, world.subsided, up to 1.5) and the town runs short of
water (its carrying capacity falls 30%). Stop pumping and it slowly refills. **Overlays →
Groundwater** shows how full the ground is, **Groundwater drawdown** how far the wells have drawn it
below its natural level (and where the ground has sunk); the inspector shows it and the *Groundwater*
graph tracks the map's total. Settings (Land → Water): *Groundwater* on/off, *Well pumping*. In a test
over 400 steps on ground whose natural level was 0.58, a village of 400 drew its wells down to 0.43,
a town of 3,000 to 0.23, a city of 8,000 to 0.09 (wells dry, ground sunk 0.2) and the same city
pumping three times as hard to 0 (sunk 0.52); left alone, the drawn-down city's wells refilled to
0.43. The step takes about 1 ms.

## Tree diseases (`src/sim/disease.js`)

Introduced pathogens, each attacking only certain native trees. None is present until you introduce
one: pick it under **Life → Wildlife → Tree diseases** (Introduce) and paint it in with the **🦠 Tree
disease** brush (Shift cures; *Cure* wipes one off the map).

| Disease | Hosts |
|---|---|
| Pine blister rust | pine, shore pine |
| Sudden oak death | oak, beech, maple, larch |
| Alder root rot | alder & willow |
| Needle blight | spruce, fir, Sitka spruce |
| Birch & aspen canker | birch, aspen |
| Cedar leaf blight | wetland cedar |

Each cell holds at most one disease (world.treeDisease) and how heavily it is infected
(world.diseaseLoad). The infection builds up in proportion to the hosts' share of the trees, and it
is worst on young trees: saplings are killed (cover thins, dead wood builds up), forest health
collapses because no young trees come through, and young stands are stunted (they stop maturing).
Now and then a whole clump of host trees dies at once, old ones too (cover and
tree density drop, dead wood piles up, and the gap fills with young trees). It spreads to
neighbouring cells where its hosts grow (more readily downwind) and jumps on spores, animals, boots
and timber: mostly 4–45 cells, mostly downwind, and one jump in ten lands 30 cells to over half the
map away. Roads carry it too: a road passing a heavily infected stand picks it up on wheels, boots
and logs (world.roadDisease, world.roadSpores, fading about 4% a cell along the road), and the host
trees beside a road carrying it catch it now and then, far from where it started. The *Tree disease*
overlay tints those roads in the disease's colour and the inspector shows *Carrying disease*. In a
test with a road through birch forest, a canker reached 227 cells in 40 steps (17 without the road),
43 of them beside the road more than 30 cells from where it began (none without it). Outbreaks burn out: the trees that survive are resistant (world.diseaseResist builds up
while a cell is infected and slows both the infection and its spread into that cell), so the load
collapses behind the spreading front, and an infected patch sometimes clears up on its own in a good
year. Resistance fades again over the years, so the disease comes back in waves. In a test, a canker
introduced in one spot reached across the map within 200 steps, infected 8,500 cells at its peak,
fell to about 850 by step 1,000 as the stands became resistant, then rose and fell in smaller waves
(1,000–2,200 cells). It dies out where its hosts are gone. The invasive pine is host to none of them. In a test, needle blight
dropped forest health by 0.55 in young stands and by 0.05 in old ones. The *Tree disease* overlay
colours each disease, the inspector names it, and the *Diseased forest* graph tracks its share of
the forest. Under an old canopy (age above 0.6) the steady thinning stops at cover 0.68, and whole
clumps die far less often, so an outbreak no longer strips the age off old forest: in a test,
needle blight spreading to 11,600 cells took 0.6% of the old growth (it took 18% before this).

With **Invasive plantation pine** off, every plantation is replanted with native trees at once and
kept weeded of pine; the pine already loose in the wild keeps spreading through wild forest.

**Population overlay.** *Overlays → Population* is a heatmap of where the towns' people live, in
people per cell: each town's people spread over the land it owns (most in its streets and houses,
by how built up they are; some in its works, harbour and quays; a few out on its farms, plantations
and mines), blurred a little, on a log scale (deep purple → red → orange → pale yellow at 60 or more
a cell) so a village shows as well as a city; land with nobody on it is grey. The inspector shows
*People here*. world.popDensity is rebuilt every town step and not saved. In a test, a town of 2,577
peaked at 28 people a cell and a village of 203 at 9, and the map summed to the 2,783 people of
both.

**Town labels.** *Show town labels* (View) hides every town's name label over the map. *Show park names* (View) shows
each park's and National Forest's name over it (the name alone, without the measurements your own
drawings show), and *Show trail names* shows the names written along the footpaths and park
trails: small, curving along the trail as it winds (smoothed, always the right way up), and repeated
along a long trail, one every couple of hundred pixels of it on screen. Turning either off hides
just those names. All three are saved with the level.

## Town parks (`parkStep` in `src/sim/civilization.js`)

A town of 400 people or more sets aside parks near it, each 10–18 cells across (times the **Park
size** slider, 0.3–3, under Life → Civilization; Wilderness Areas aren't affected). In a test, new
parks covered 21–53 cells at 0.5, 117–148 at 1 and 306–662 at 2. The **Park frequency** slider (0–5) sets how
often towns make parks and how many a town keeps (about one per 1,500 people, plus one, times the
slider); 0 stops new parks and Wilderness Areas. In a test, a town of 3,000 made 0, 2.3 and 7.7
parks in 150 steps at 0, 1 and 3. A park's outline is
an irregular blob, often drawn out longer one way than the other (up to about twice as long as it
is wide), with bays and lobes. It stops short where the wild land ends: at fields, streets, roads,
the sea, lakes and big rivers (a Commons only at streets, works and water). Most
parks go in wild land within 10–50 cells of the town, with nothing built, farmed or planted there. The town lays a trail out to each park and round it in a loop for people to walk. The kind
of park depends on what the forest holds, and each kind has its own restrictions. Every park bans
timber, fields, new towns and roads (footpaths are still allowed).

Parks protect only what is hard to find; where nothing rare is near a town, it makes no park.

**Out in the wild country.** A town looks for park sites up to 90 cells away, and a site counts for
much less the more of the land within 12 cells is developed (fields, streets, roads, plantations,
works); distance from the town counts only a little. So parks go to wild country rather than among
the town's own land. Old growth is always worth keeping: where old forest is common on the map it
still keeps at least 90% of its score, an old stand with nothing developed within 12 cells scores
higher, and each Old Growth Reserve already made lowers the next only a little (×0.88; other kinds
×0.55). Plantations beside old growth don't count against it. In a test where a town of 4,000 had
farmed and planted the land round it, its parks went an average of 63 cells out with about 4% of the
land around them developed; 3 of 11 were Old Growth Reserves, where before none were.

| Park | Chosen for | Also restricted |
|---|---|---|
| Old Growth Reserve | the oldest stands (age above 0.8), worth less where old forest is common on the map; at the edge of a timber plantation (within 6 cells) age above 0.72 will do and it scores higher, so old growth beside plantations is kept from the next felling (plantations nearby don't count against a site, other development does) | no fires, no hunting, no earthworks |
| Grove (*Fir Grove*, *Cedar Grove*…) | a tree under 8% of the map's forest that makes up at least 40% of the trees there | no hunting (no earthworks for towns over 2,000) |
| Preserve (*Wetland Preserve*, *Tundra Preserve*…) | a wild biome under 6% of the map's land (forest types, wetland, grassland, shrubland, tundra, mangrove, dunes, mesa, desert) covering most of the ground | no earthworks; hunting allowed |
| Refuge (*Deer Refuge*…) | an animal living several times more thickly than its average over the land | no hunting, no earthworks |
| Last Woods | forest where less than 30% of the land within 20 cells is still wild forest | no fires, no earthworks; hunting allowed |
| Beach (*Beach*, *Pebble Beach*, *Black Beach*) | an unbuilt stretch of sand, shingle or basalt beach within 55 cells (at least six beach cells together), its middle set a few cells inland so it takes in the beach and the land behind; each beach park already on the map makes another count for less | no earthworks (no quays, breakwaters or dumped spoil); hunting allowed |
| Commons | a block of the town's own fields, only for a town over 10 years old with less than 15% wild forest left within 20 cells | no fires, no hunting |
| Wilderness | see below | no fires, no earthworks; hunting allowed |

Woods and Game Woods (ordinary forest) are no longer made; any already on a map stay. In a test with
eight plantation blocks in a stand of 0.76-old forest, a town made 2.3 Old Growth Reserves (2 of
them at a plantation's edge) against 1 without the plantations, out of 9 parks either way.

**Old Growth Reserves on their own.** Old growth isn't left to compete with the other parks: each
town also reserves old growth separately, with an allowance of its own (about one reserve for every
1,200 people, plus one, times **Park frequency**). It looks up to 120 cells out for old growth
(older than 0.78 over the stand) in wild country (less than a fifth of the land within 12 cells
developed; plantations beside it don't count), preferring the biggest old stands and ones on its
Old Forest Trails. These reserves are larger (12–26 cells across, times **Park size**), and the
outline follows the old growth out to where the forest gets younger (below 0.7, letting a few
younger cells through), the sea, or anything built; next to an existing park the reserve joins it.
In the same test as above, 10 of 22 parks were Old Growth Reserves (89–566 cells each), reserving
about 960 of the map's 3,778 cells of old growth per run.

**Old-growth trails.** Outside the parks, a town of 300 or more now and then lays a trail out to a
stand of old growth near it (older than 0.75, wild, 10–45 cells away, outside any park), ending in a
short loop through the stand: the *Old Forest Trail* (numbered if a town has several). A town keeps
about one for every 2,000 people, plus one, times **Park frequency**. A stand people walk to is
more likely to become a park: within 8 cells of one, an Old Growth Reserve needs only age 0.72 and
scores higher, and when a park forms there it takes the trail in as its own (renamed after the park).
In a test in a stand of 0.78-old forest, a town laid three Old Forest Trails, and one of their stands
became an Old Growth Reserve in each run, taking in its trail; without the trails, none did.

**National Forests.** Every map gets one or two (chosen once, world.nationalTarget) large National
Forests, set aside for the whole map rather than by a town, but only once the map has a civilization
(at least one town, with civilization on): a map with no towns gets no parks of any kind.
Each covers the most heavily forested stretch of the map not already in one (over 45% forest within
about 45 cells), 60–90 cells across. Its outline follows the forest out to where it gives out (the
sea, or more than five cells of open ground) and is smoothed a little. No timber is cut inside (no
plantations planted or felled), and that is its only restriction: towns, farms and roads can still
go there, and towns can make their own parks inside. A trail runs through it the long way. It is
named after the nearest town within 60 cells, or else given a name of its own (*Stillwater*, *Eagle
Ridge*…). A young map waits until it has enough forest. Turn them off with **National Forests**
(Life → Civilization). In a test, the two National Forests covered 4,135 and 3,149 cells (80×79 and
78×67), 95% of it forest.

**Wilderness Areas.** A town of 1,500 people or more now and then sets aside a very large tract,
36–70 cells across, of the remotest wild land it can find 40–130 cells away. It picks the point
farthest from any town, field, road, works or park centre, with mostly living land around it.
Its outline stops at the sea, lakes and anything built, and a long trail leads out to it from
the town, ending in a loop through its heart. Each town makes one; it doesn't merge with other
parks and doesn't count toward the town's other parks. In a test, a town's Wilderness covered
3,666 cells, 127 cells away, and finding it took 125 ms (once).


A Commons lets a town hemmed in by its own development still make parks: the fields inside are taken
out of farming and marked as old fields, so they go back to the wild (and the restriction keeps them
from being farmed again). Parks go anywhere outside other parks: polygons you've drawn yourself, whatever they restrict, never
keep a park out (in a test, a polygon over the whole map with every restriction on still got seven
parks). Something the map's parks already protect counts for less, so each new park tends to protect
something different. A town may have about one park piece for every 1,500 people, plus one.

**Merging.** A new park whose centre is within a few cells of an existing park's edge joins it,
and ground next to a park scores a little higher, so parks tend to grow together. The merged park's
outline follows both parks' edges (keeping their bays, bridging the gap between them), it keeps the restrictions of both, and its name becomes *… Park*
(for example *Tordale Beech Grove Park*). The new ground's trail loop is linked from the middle of
the park it joins, and the park's trails are numbered. In a test, 11 park pieces formed 6 parks:
three merged parks of 2–3 pieces, 15–28 cells across, and three single ones. With the larger outlines, single parks covered 140–210 cells (for example 10×20 and 23×14 cells) and a park merged from three pieces about 400. In other tests, a town ringed by its own fields made Commons
(some of which merged), and a herd of deer packed into one patch got a *Deer Refuge* 3 cells from its
centre. A town whose district was farmed all round but for one wood made that wood its *Last
Woods*, and a big town found a *Tundra Preserve* and a *Coastal Dunes Preserve*. A coastal town made *Glenfield Beach*, taking in 21 cells of sand beach and the land behind, with no sea inside. A beach park's trail doesn't loop inland: it comes out from the town to the nearer end
of the beach and runs along the beach itself to the other end, a single narrow track over the sand,
shingle or boulders (the longest connected stretch of beach in and just outside the park). In tests,
beach trails ran 11–16 cells along the beach, many of them right at the water's edge.

The parks appear in the **Drawings** list as green polygons, where you can change their
restrictions or delete them; world.parkSites remembers each park. Turn them off with **Town parks**
(Life → Civilization).

**Trails spread disease and pine.** With **Trails spread disease & pine** on, footpaths (park trails
and your own) carry tree diseases and invasive pine seed on hikers' boots, the same way roads do.
They fade sooner along a trail than along a road (5% a cell rather than 3–4%). The host trees
beside a trail catch the disease far from where it started. In a test, spores fell from 0.83 to
0.05 over about 45 cells of trail.

## Fire fuel, megafires and firefighting (`src/sim/fire.js`)

Dead wood, litter and undergrowth build up on the forest floor (world.fuel, 0…1) where nothing
burns: faster under dense, old forest and where trees have died, gone where fire has passed. A fire
through light fuel (under 0.35) is a **surface fire**: it clears the undergrowth, but the canopy
stays and the trees keep their age. Through heavier fuel it climbs into the crowns: it spreads up to
2.5 times as readily, throws embers further ahead, and kills the stand. So a forest that burns a
little every few years stays safe, and one where every fire is put out builds up fuel until a fire
gets away as a megafire. In a test, the same fire through the same forest reached about 1,400
forest cells either way; with light fuel it killed no stands and no old growth, with heavy fuel it
killed 1,059 stands, 663 of them old growth.

**Fire suppression** (Civilization, 0–1, default 0.5): around each town (15 cells plus more for a
bigger town; world.fireGuard) firefighters put fires out, strongly near the town and less further
out; a big fire (300+ cells burning) overwhelms them. In a test a fire started beside a town was out
in 6 steps with full suppression and killed 1,063 stands with none. **Prescribed burns** (a
setting): in the cool, damp part of the year towns burn off heavy fuel in their parks and the forest
around them, a patch (9 cells across) at a time; in a test this took the fuel around a town from 0.8
to 0.62 over 300 steps. **Overlays → Fire fuel** maps the fuel (with the firefighters' ground
hatched in blue) and the inspector shows it.

## Wildfire history (`src/sim/fireHistory.js`)

Every wildfire is tracked as one event and numbered in order (#1, #2, …). After each fire step,
newly burning cells are grouped: a patch that catches next to a fire still going joins that fire,
and so does a spot fire started by embers within 10 cells of one; any other spark starts a new fire.
A fire is out once nothing of it has burnt for 40 fire steps. Fires burning at the same time (within a few dozen fire steps
of each other) whose burnt ground comes within **Merge fires within** cells (Climate → Wildfire →
Fire history; 4 by default, 0 = never) are merged into one: the smaller joins the bigger, keeping the
bigger one's number and name (and is named if together they pass the size for a name). Fires at
different times are never merged, however close. A spark within 10 cells of a fire still burning
joins it straight away (embers blown ahead). On the overlay, a smaller fire's label is hidden where it would overlap a bigger one's. Small fires are only numbered. Once a
fire has burnt 150 cells it is given a name, as real wildfires are: after a town within 40 cells
("Redwick Fire"), else after the land where it started ("Bear Ridge Fire", "Lost Creek Fire",
"Cedar Flats Fire"), never reusing a name.

world.fireScar remembers the number of the last fire to burn each cell, and world.fireLog the fires
themselves: year started and ended, cells burnt, and where. Named fires are kept for good; only the
last 300 small ones are kept. The **Historic wildfires** overlay colours the ground by the last fire to
burn it: each named fire its own colour with its name, number, year and size written over it, small
fires a dull brown, and fires still burning orange. **Climate → Wildfire → Fire history** counts the
fires and lists the named ones, newest first, and the inspector shows the last fire at each spot.
