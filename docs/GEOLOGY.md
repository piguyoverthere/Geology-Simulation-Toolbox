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
forest (canopy shade and damp, still air). This also dries the soil a little on sunny, bare slopes.
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
