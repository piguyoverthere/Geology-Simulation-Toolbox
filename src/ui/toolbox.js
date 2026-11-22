// The right-hand toolbox panel and the bottom tool bar. Built with plain DOM so it is easy to
// extend: each control is bound to a property on some settings object and carries a `help` string
// that is shown in the info box when you hover it.

import { DRAW_COLORS } from '../render/drawings.js';
import { SHORES, MARINE } from '../sim/coast.js';
import { ENVIRONMENTS, applyEnvironment } from '../core/environments.js';
import { TOOLS, toolKey } from '../tools/brushes.js';
import { PRESETS } from '../core/generate.js';
import { OVERLAYS } from '../render/terrainRenderer.js';
import { ROCKS } from '../core/rocks.js';
import { ERUPTION_TYPES, INTRUSION_TYPES } from '../sim/volcanism.js';
import { FAULT_TYPES } from '../sim/tectonics.js';
import { SPECIES, OPEN } from '../sim/species.js';
import { BIOMES } from '../render/biomes.js';
import { STATS } from '../sim/stats.js';
import { PROBE_STATS } from '../sim/probes.js';
import { bestSite, foundTown, ensureCiv, updateProtectedZones } from '../sim/civilization.js';
import { YEAR_KINDS } from '../sim/climate.js';
import { HABITATS, PLANT_FOODS, HABITS, MIGRATION, newAnimal, removeAnimal, describeAnimal } from '../sim/ecology.js';

/** The sidebar's topic tabs and the settings sections on each. */
const TABS = {
  map: { label: 'Map', icon: '🗺', sections: ['Level', 'Overlays', 'Terrain', 'Drawings', 'View'], help: 'Your level (save, load), map overlays and their key, terrain presets and size, drawings, and what is shown.' },
  land: { label: 'Land', icon: '⛰', sections: ['Water', 'Erosion', 'Geology', 'Volcanism & tectonics'], help: 'Water on the land, erosion, rocks, volcanoes and faults.' },
  climate: { label: 'Climate', icon: '☀', sections: ['Climate', 'Seasons', 'Weather'], help: 'Environments, temperature and wind, the seasons (and good and bad years), storms and weather.' },
  sea: { label: 'Sea', icon: '🌊', sections: ['Ocean & coast'], help: 'The sea, tides, currents, coasts and water quality.' },
  life: { label: 'Life', icon: '🐾', sections: ['Wildlife', 'Civilization'], help: 'Your animals (design them, paint them in, follow their populations) and civilization: towns, farms, roads.' },
};

export class Toolbox {
  /**
   * @param {HTMLElement} root     the right-hand panel
   * @param {HTMLElement} barRoot  the bottom tool bar
   * @param {object} app  the App from main.js (state, world, actions)
   */
  constructor(root, barRoot, app) {
    this.root = root;
    this.app = app;
    this.toolButtons = new Map();
    this.build();
    this.buildToolbar(barRoot);
  }

  build() {
    const app = this.app;
    const r = this.root;
    r.innerHTML = '';

    const header = el('div', 'tb-header');
    header.append(el('h1', '', 'Geology Toolbox'));
    this.playBtn = button('', () => app.toggleSim(), 'tb-play');
    header.append(this.playBtn);
    r.append(header);

    this.statsEl = el('div', 'tb-stats');
    r.append(this.statsEl);
    // Topic tabs: one topic's settings at a time
    this.tabBar = el('div', 'tb-tabs');
    this.tabButtons = {};
    for (const [id, t] of Object.entries(TABS)) {
      const b = el('button', 'tb-tab');
      b.append(el('span', 'tb-tab-icon', t.icon), el('span', '', t.label));
      b.addEventListener('click', () => this.showTab(id));
      this.helpOn(b, `<b>${t.label}</b> — ${t.help}`);
      this.tabBar.append(b);
      this.tabButtons[id] = b;
    }
    r.append(this.tabBar);

    // --- Overlays ----------------------------------------------------------------------------
    const ov = this.section('Overlays', true);
    ov.append(
      select('Overlay', OVERLAYS, app.renderer, 'colorMode',
        'Colour the map by one data layer instead of its natural look. Wetness: soil moisture. Rock type: the bedrock exposed at the surface. Erosion/deposition: red = ground removed, blue = sediment added since the baseline. Topographic map: elevation bands with contour lines, like a printed topo map.', this, () => { app.renderer.update(true); this.updateLegend(); }),
      toggle('Show vegetation', app.renderer, 'showVegetation',
        'Turn off to strip the plants away in the natural view and see bare ground and bedrock (each rock type in its own colour).', this, () => { app.world.dirty = true; this.updateLegend(); }),
    );
    this.legendTitle = el('div', 'tb-group-label');
    this.legendEl = el('div', 'tb-legend');
    ov.append(this.legendTitle, this.legendEl);

    // --- Erosion -----------------------------------------------------------------------------
    const ero = this.section('Erosion', false);
    const master = toggle('Erosion enabled', app.world, 'erosionEnabled',
      'Master switch for all erosion: rivers, weathering, landslides and the erosion brushes. Turn off to sculpt and watch water flow without the ground changing.', this, () => this.refresh());
    master.classList.add('tb-master');
    this.erosionControls = el('div', 'tb-group');
    this.erosionControls.append(
      toggle('River erosion', app.waterParams, 'erosionEnabled',
        'Let flowing water pick up and drop sediment. Turn off to just watch water flow and pool.', this),
      slider('Weathering', app.sim, 'dropletsPerFrame', 0, 3000, 50,
        'Raindrop erosion over the whole map each frame (particle model). Simulates centuries of rainfall: carves gullies and valleys.', this),
      toggle('Landslides', app.sim, 'thermal',
        'Thermal erosion: slopes steeper than the angle of repose crumble into scree.', this),
      slider('Repose angle °', app.thermalParams, 'talusAngle', 15, 60, 1,
        'Steepest stable slope for loose rock. Real rubble is about 30-40°. Hard strata can stand steeper.', this),
      toggle('Big landslides', app.landslideParams, 'enabled',
        'Whole hillsides fail and pour downhill as debris avalanches, mostly on steep, soaked slopes during heavy rain. Tall, steep mountains can occasionally collapse an entire flank.', this),
      slider('Slide frequency', app.landslideParams, 'frequency', 0, 5, 0.1,
        'How often big landslides happen.', this),
      slider('Rain weakening', app.landslideParams, 'satWeakening', 0, 0.8, 0.05,
        'How much saturated ground loses its grip. Water pressure between grains cancels friction, so soaked slopes slump at much gentler angles.', this),
    );
    const eroBtns = el('div', 'tb-row');
    eroBtns.append(button('Erode ×50k drops', () => app.bulkErode(50000), '', 'Instantly run 50,000 raindrops of erosion over the whole map.', this));
    this.erosionControls.append(
      slider('Wind erosion', app.windParams, 'erosion', 0, 5, 0.1, 'How fast the wind wears down bare sedimentary rock (sandstone, shale, limestone, conglomerate) where it blows strongly and nothing grows: grain by grain, extremely slowly. The grains are dropped downwind, into the sea as silt. 0 turns it off.', this),
    );
    this.erosionControls.append(eroBtns);
    ero.append(master, this.erosionControls);

    // --- Volcanism & tectonics ---------------------------------------------------------------
    const vt = this.section('Volcanism & tectonics', false);
    const labels = (types) => Object.fromEntries(Object.entries(types).map(([k, v]) => [k, v.label]));
    const helps = (types) => Object.values(types).map((v) => `<br>• <b>${v.label}</b>: ${v.help}`).join('');
    vt.append(
      el('div', 'tb-group-label', 'Eruption (♨ tool)'),
      select('Type', labels(ERUPTION_TYPES), app.volcanoSettings, 'eruption',
        `What kind of magma erupts.${helps(ERUPTION_TYPES)}`, this),
      slider('Size', app.volcanoSettings, 'size', 0.3, 2.5, 0.1,
        'Volume of lava and ash, and how long the eruption lasts.', this),
      el('div', 'tb-group-label', 'Intrusion (◍ tool)'),
      select('Type', labels(INTRUSION_TYPES), app.volcanoSettings, 'intrusion',
        `Magma that cools underground.${helps(INTRUSION_TYPES)}`, this),
      el('div', 'tb-group-label', 'Fault (⫽ tool)'),
      select('Type', labels(FAULT_TYPES), app.faultSettings, 'type',
        `How the crust breaks.${helps(FAULT_TYPES)}`, this),
      slider('Slip', app.faultSettings, 'slip', 1, 20, 0.5,
        'Total displacement across the fault once all its earthquakes have happened.', this),
      slider('Earthquakes', app.faultSettings, 'quakes', 1, 20, 1,
        'How many quakes the slip is released in. Fewer = bigger, sharper jumps.', this),
      el('div', 'tb-group-label', 'Wildfire'),
      toggle('Wildfires', app.fireParams, 'enabled',
        'Lava sets touching vegetation alight. Fire races through forest, creeps through grass, runs faster uphill and is stopped by bare ground, water and rain. Burnt land turns to ash and regrows slowly.', this),
      slider('Fire spread', app.fireParams, 'spread', 0.5, 6, 0.1,
        'How readily fire jumps to neighbouring plants.', this),
    );
    const vtBtns = el('div', 'tb-row');
    vtBtns.append(button('Stop all events', () => { app.world.events.length = 0; app.world.flows.length = 0; }, '', 'End all running eruptions, intrusions, faults and pyroclastic flows. Lava already out keeps flowing until it cools.', this));
    vt.append(vtBtns);

    // --- Water ---------------------------------------------------------------------------------
    const sim = this.section('Water', true);
    sim.append(
      slider('Sim speed', app.sim, 'substeps', 1, 20, 1,
        'Water-flow steps per frame. Higher = faster geological time, lower framerate.', this),
      slider('Global rain', app.waterParams, 'rain', 0, 0.1, 0.002,
        'Rainfall over the whole map, fed into the shallow-water flow model. Rivers form where runoff converges.', this),
      slider('Evaporation', app.waterParams, 'evaporate', 0, 0.3, 0.005,
        'Overall evaporation rate. Each spot evaporates faster in warm air, in sun and on bare ground, and slower in shaded valleys and under forest (see Inspect → Evaporation). Lakes and ponds high up evaporate much faster (thin, dry, windy air and strong sun), so high basins hold only small tarns. Dry lakes leave their sediment behind as flat lake beds.', this),
      slider('Summer evaporation ×', app.waterParams, 'summerEvap', 1, 5, 0.1,
        'With Seasons on: how many times faster lakes and ponds evaporate at the height of summer (long, hot, sunny days), easing in from spring and back out in autumn. Higher values shrink lakes and dry out ponds over the summer.', this, () => app.climateChanged()),
      toggle('Plant growth', app.sim, 'vegetation',
        'Vegetation regrows toward what each spot can support (gentle, moist, not too high) and dies where ground is washed away, buried or flooded. Forest erodes ~4x slower than barren ground.', this),
    );
    const simBtns = el('div', 'tb-row');
    simBtns.append(button('Clear water', () => app.clearWater(), '', 'Remove all water, suspended sediment and springs.', this));
    sim.append(simBtns);

    // --- Climate -------------------------------------------------------------------------------
    const cli = this.section('Climate', true);
    const envOpts = { custom: 'Choose an environment…', ...Object.fromEntries(Object.entries(ENVIRONMENTS).map(([k, e]) => [k, e.label])) };
    app.env = app.env || { id: 'custom' };
    cli.append(select('Environment', envOpts, app.env, 'id',
      'Ready-made climates, applied to this map without changing the terrain: temperature, seasons, rain and dry summers, storms and snowstorms, lightning, ocean fog, wetness, evaporation and tides, all at once. Fine-tune with the sliders afterwards.' +
        Object.values(ENVIRONMENTS).map((e) => `<br>• <b>${e.label}</b>: ${e.help}`).join(''), this,
      () => { if (app.env.id !== 'custom') applyEnvironment(app, app.env.id); }));
    cli.append(
      slider('Temperature °C', app.climateParams, 'seaTemp', -10, 35, 0.5,
        'Sea-level temperature. It gets about 0.4 °C colder per unit of height, and sunny slopes are warmer than shady ones. Sets the tree line, which forests grow (tropical jungle when hot and wet, conifers when cold) and whether clouds drop snow or rain. Snow and rain respond at once, but plants shift gradually: grassland within a short while, established forests much more slowly.', this, () => app.climateChanged()),
      slider('Lapse rate °C', app.climateParams, 'lapse', 0.05, 1.2, 0.01,
        'How much colder it gets per unit of height (and warmer going down). Real air cools about 6.5 °C per km. Raise it for sharp climate zones: snowy, treeless peaks above warm valleys; lower it for mountains that are barely colder than the lowlands. Plants follow the new temperatures gradually.', this, () => app.climateChanged()),
      slider('Climate wetness', app.vegetationParams, 'climate', 0, 1.5, 0.05,
        'Long-term rainfall of the region. Dry it out and forests retreat to grassland, then to bare ground, holding on longest along rivers and lakes.', this),
      slider('Wind direction °', app.climateParams, 'windAngle', 0, 360, 5,
        'Direction the moist prevailing wind blows toward. Slopes facing into it get the most rain and snow; the far side of a range sits in a dry rain shadow. See the Precipitation overlay.', this, () => app.climateChanged()),
      slider('Wind strength', app.windParams, 'strength', 0, 3, 0.1,
        'How hard the prevailing wind blows. It is strongest over open sea (building up over the water it crosses) and on exposed ridges and coasts; land blocks it, leaving calm water and ground in its lee. Drives the sea\'s surface currents and waves, chills exposed water and wears down bare soft rock very slowly.', this),
      slider('Dry summers', app.climateParams, 'summerDry', 0, 1, 0.05,
        'With Seasons on: how much of the year\'s rain comes from autumn to spring instead of summer. High values give a Mediterranean-type climate like the Pacific Northwest: wet, stormy winters that build the snowpack, and dry summers with fewer storms and a wildfire season. The Cascade Range preset sets this.', this),
    );

    // --- Seasons -------------------------------------------------------------------------------
    const sea = this.section('Seasons', false);
    sea.append(
      toggle('Seasons', app.seasonParams, 'enabled',
        'Cycle through spring, summer, autumn and winter. Winter storms build up snow that melts in spring and swells the rivers. Deciduous trees turn colour in autumn (birch and aspen yellow, maple red and orange, oak brown), from the high slopes down to the valleys, drop their leaves, and come back fresh green in spring. Exposed ridges turn first; sheltered valleys last.', this, () => app.climateChanged()),
      slider('Season speed', app.seasonParams, 'speed', 0.1, 6, 0.1,
        'Years per minute of real time (while the simulation runs).', this),
      slider('Season swing °C', app.seasonParams, 'swing', 0, 20, 0.5,
        'How much warmer midsummer is (and colder midwinter) than the yearly average.', this, () => app.climateChanged()),
      slider('Year-to-year variation', app.seasonParams, 'variability', 0, 2.5, 0.1,
        'How often a year turns out extreme. Some summers bring drought and heat waves (a high-pressure ridge parks over the region: hotter, nearly rainless, dry lightning, fuels drying out early, so wildfires spread far and wide); others are mild, cool and showery with little fire. At 1 about one year in six is a drought year and one in five a mild one; 0 makes every year alike. A new kind of year is drawn each spring.', this),
      select('This year', Object.fromEntries(Object.entries(YEAR_KINDS).map(([k, y]) => [k, y.label])), app.seasonParams, 'yearKind',
        'What kind of year it is (drawn at random each spring; pick one to make it so now). A drought & heat wave year is up to 5 °C hotter in summer, with the summer rain almost gone and a long, fierce fire season; a mild summer is cooler and showery with few fires.', this, () => { app.seasonParams.yearStrength = 1; app.climateChanged(); }),
    );

    // --- Weather -------------------------------------------------------------------------------
    const wx = this.section('Weather', false);
    wx.append(
      slider('Storms', app.climateParams, 'storms', 0, 4, 0.1,
        'How often storms blow in from upwind. Each is a ragged cluster of rain cells drifting with the wind, heaviest on windward slopes. Storms carry a limited supply of moisture and rain it out fastest climbing over mountains, so they die out beyond a range (rain shadow). Rain raises the rivers; snow builds the snowpack. Warm weather brings thunderstorms. 0 = no storms.', this),
      slider('Snowstorms', app.climateParams, 'snowstorms', 0, 3, 0.05,
        'How many snowstorms build over the mountains each year (×1 = normal). They come in waves through fall and winter and are the main source of the mountain snowpack. 0 = none (only the ordinary storms bring snow).', this),
      slider('Lightning', app.weatherParams, 'lightning', 0, 4, 0.1,
        'How often thunderstorms (warm weather only) throw lightning. Strikes can start wildfires, most easily in dry woodland and pine; fires there are also much harder for rain to put out.', this),
      slider('Snow slope limit °', app.climateParams, 'snowSlope', 15, 75, 1,
        'Steepest slope snow builds up on. Steeper faces shed their snow in small slides that pile up below, unless the snowpack around them is already deep. Lower it for bare rocky crags above snowy slopes, raise it to plaster the mountains white.', this, () => app.climateChanged()),
      slider('Ocean fog', app.climateParams, 'oceanFog', 0, 1.5, 0.05,
        'How often the marine layer (sea fog) rolls in over the sea and coastal lowlands, mostly in summer when the land behind is warm. Needs the sea on. The Puget Sound preset sets it high.', this, () => app.climateChanged()),
    );

    // --- Drawings ----------------------------------------------------------------------------
    const dr = this.section('Drawings', false);
    dr.append(
      select('Shape', { path: 'Path (line)', polygon: 'Polygon (area)' }, app.drawSettings, 'shape',
        'What the Draw tool (✎, key D) makes. A path is an open line; a polygon closes back to its first point and is filled. You can also close a path into a polygon by clicking its first point.', this, () => app.setTool('draw')),
      select('Colour', DRAW_COLORS, app.drawSettings, 'color', 'Colour for new shapes. Click a shape\'s dot in the list below to cycle its colour.', this),
      toggle('Show labels', app.drawSettings, 'labels', 'Show each shape\'s name and measurements on the map.', this),
    );
    this.drawList = el('div', 'draw-list');
    dr.append(this.drawList);
    const drBtns = el('div', 'tb-row');
    drBtns.append(button('Clear drawings', () => app.drawings.clear(), '', 'Delete every path and polygon.', this));
    dr.append(drBtns);
    app.drawings.onChange = () => { this.updateDrawList(); updateProtectedZones(app.world, app.drawings.shapes); app.world.dirty = true; };
    this.updateDrawList();

    // --- Geology -----------------------------------------------------------------------------
    const geo = this.section('Geology', false);
    geo.append(
      toggle('Rock types', app.world, 'rocksEnabled',
        'Bedrock differs by type: granite and basalt resist erosion, shale and schist give way fast, so hard rock stands up as ridges, cliffs and caprock. Off = uniform rock. See the Rock type overlay.', this, () => app.world.dirty = true),
      slider('Hardness contrast', app.world, 'strataStrength', 0, 1, 0.05,
        'How much rock types differ in hardness. High values carve dramatic ledges and stand-out ridges; low values let everything erode alike.', this, () => app.world.dirty = true),
      slider('Layer thickness', app.world, 'strataSpacing', 2, 25, 0.5,
        'Thickness of the layers in sedimentary, volcanic and metamorphic rock.', this, () => app.world.dirty = true),

      toggle('Drain at edges', app.world, 'edgeDrain', 'Let water flow off the edges of the map instead of being walled in.', this),
    );

    // --- Level -------------------------------------------------------------------------------
    const lvl = this.section('Level', true);
    const lvlBtns = el('div', 'tb-row');
    lvlBtns.append(
      button('Save level', () => app.saveLevelFile(), 'primary', 'Download everything about this level to a .geolevel file: terrain, water, vegetation, soil, snow, rocks, lava and burn scars, springs, drawings, camera and every setting.', this),
      button('Load level', () => app.loadLevelFile(), '', 'Open a .geolevel file saved earlier (it switches map size if needed).', this),
    );
    lvl.append(lvlBtns,
      toggle('Keep level on reload', app.keepLevel, 'on',
        'Autosave the level to this browser every 30 seconds (and when you leave the page), and bring it back when the page reloads, e.g. after an update. Each map size keeps its own. Generate starts a new level.', this,
        () => { try { localStorage.setItem('geo.keepLevel', app.keepLevel.on ? '1' : '0'); } catch { /* storage blocked */ } if (app.keepLevel.on) app.autosave(); }));
    this.saveStatusEl = el('div', 'tb-save-status', app.saveStatus || '');
    lvl.append(this.saveStatusEl);

    // --- Ocean & coast -----------------------------------------------------------------------
    const oc = this.section('Ocean & coast', false);
    oc.append(
      toggle('Sea', app.sim, 'seaEnabled',
        'Fill everything below sea level with ocean. Rivers slow down and drop sediment where they meet it, forming deltas. The sea has tides, its own biomes and shores.', this, () => app.applySea()),
      slider('Sea level', app.sim, 'seaLevel', 0, 50, 0.5, 'Mean height of the ocean surface. Moving it switches the sea on.', this, () => {
        if (!app.sim.seaEnabled) { app.sim.seaEnabled = true; this.refresh(); }
        app.applySea();
      }),
      slider('Tide range', app.coastParams, 'tideRange', 0, 6, 0.1,
        'Height between low and high tide. The strip between them floods and drains every cycle: mudflats in bays, wet beaches. (Puget Sound tides are 3–4 m; the open Pacific coast about 2–3 m.)', this),
      slider('Tide period', app.coastParams, 'tidePeriod', 5, 120, 1, 'Simulated seconds from one high tide to the next.', this),
      slider('Wave erosion', app.coastParams, 'waveErosion', 0, 0.02, 0.0005,
        'How hard waves attack the shore: exposed, soft coasts retreat fastest; beaches with deep sand protect the land behind.', this),
      slider('Coral growth', app.coastParams, 'coral', 0, 3, 0.1, 'How much white coral sand reefs make in warm seas (above ~20 °C water).', this),
      slider('Tidal currents', app.oceanParams, 'currents', 0, 3, 0.1, 'Strength of the tidal currents: the sea floods into the bays and channels as the tide rises and ebbs back out as it falls, fastest in narrow passages, carrying silt, pollutants, plankton and river water back and forth.', this),
      slider('Great storms every (years)', app.oceanParams, 'greatStorms', 0, 40, 1, 'About how many years apart great storms come (a hurricane or a once-in-a-generation gale; 0 = never). A great storm forms far out at sea and drives onto the coast: its surge floods far inland over the low coast, its giant waves cut back cliffs and bluffs, strip the beaches of their sand and flatten the dunes, and the salt water kills the coastal forest it floods. They come mostly from late summer to winter.', this),
      button('🌀 Send a great storm now', () => { import('../sim/ocean.js').then((m) => { if (!m.startGreatStorm(app.world)) this.setInfo('<b>Great storm</b> — needs the sea (Sea on) with open water to form over.'); }); }, '', 'Start a great storm out at sea now; it drives onto the coast.', this),
      slider('Storm surge', app.oceanParams, 'surge', 0, 3, 0.1, 'How much storms over the sea raise it (storm surge, flooding low shores for a while) and how big their waves are (they pound and erode the coast and break as surf).', this),
      slider('Plankton blooms', app.oceanParams, 'blooms', 0, 3, 0.1, 'How readily plankton blooms on nutrients (pollutants, river water) in warm, sunny water. Big blooms turn the water green and, rotting in deep, sheltered water, use up its oxygen: dead zones that suffocate sea life.', this),
      slider('Pollutant spread', app.qualityParams, 'spread', 0, 0.6, 0.01, 'How fast pollutants spread out over the water from where they come in: a plume that slowly widens and thins, carried by the tides. 0 keeps them where they are.', this),
      select('Shoreline type', { auto: 'Auto (by conditions)', mudflat: 'Mudflat', sand: 'Sand beach', shingle: 'Shingle beach', cliff: 'Rock cliff', basalt: 'Basalt boulder beach' },
        app.coastParams, 'shoreType', 'What the Shoreline tool (≈, key O) paints.', this, () => app.setTool('shoreline')),
    );

    // --- Terrain -----------------------------------------------------------------------------
    const ter = this.section('Terrain', false);
    ter.append(select('Map size', Object.fromEntries([128, 192, 256, 384, 512].map((n) => [n, `${n} × ${n}${n > 256 ? ' (slower)' : n < 256 ? ' (faster)' : ''}`])),
      app.gen, 'size', 'Cells per side. A bigger map shows more land at the same detail but takes more work every frame (512 is 4× the work of 256). Changing it starts a new map with the current preset and seed.', this,
      () => app.setMapSize(app.gen.size)));
    const presetSel = select('Preset', Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])),
      app.gen, 'preset', 'Starting landscape for the simulation.', this);
    const seed = numberInput('Seed', app.gen, 'seed', 'Random seed. Same seed + preset = same terrain.', this);
    ter.append(presetSel, seed);
    const terBtns = el('div', 'tb-row');
    terBtns.append(
      button('Generate', () => app.generate(), 'primary', 'Create a new terrain from the preset and seed.', this),
      button('Random', () => { app.gen.seed = (Math.random() * 1e6) | 0; this.refresh(); app.generate(); }, '', 'New random seed.', this),
    );
    const terBtns2 = el('div', 'tb-row');
    terBtns2.append(
      button('Undo', () => app.undo(), '', 'Undo the last terrain stroke (Ctrl/Cmd+Z).', this),
      button('Redo', () => app.redo(), '', 'Redo (Ctrl/Cmd+Shift+Z).', this),
      button('Set baseline', () => app.setBaseline(), '', 'Reset the erosion/deposition view so the current terrain counts as "no change".', this),
    );
    const terBtns3 = el('div', 'tb-row');
    terBtns3.append(
      button('Export PNG', () => app.exportPNG(), '', 'Download the heightmap as a greyscale PNG.', this),
      button('Import PNG', () => app.importPNG(), '', 'Load a greyscale heightmap image (brighter = higher).', this),
    );
    ter.append(terBtns, terBtns2, terBtns3);

    // --- View --------------------------------------------------------------------------------
    // --- Wildlife ------------------------------------------------------------------------------
    const wild = this.section('Wildlife', false);
    this.animalList = el('div', 'tb-animals');
    this.animalForm = el('div', 'tb-animal-form');
    this.animalForm.hidden = true;
    wild.append(
      toggle('Wildlife', app.ecoParams, 'enabled', 'Animals you design: give each a name and colour, say where it lives, what it eats (plants, plankton, seaweed or your other animals) and its habits. They grow where there is food, starve where there is none, are thinned out by whatever eats them, and change the land and sea (grazing, damming streams, killing trees, cropping plankton or kelp). Paint them in with the Animal tool.', this),
      slider('Population speed', app.ecoParams, 'speed', 0.2, 3, 0.1, 'How fast the animal populations grow, decline and move.', this),
      toggle('Show animals', app.wildlife, 'visible', 'Show the animals as small dots in their colours where they live (and in the map key).', this, () => this.updateLegend()),
      this.animalList,
      button('+ Add animal', () => this.editAnimal(null), 'tb-add-animal', 'Design a new animal: its name, colour, where it lives, what it eats and its habits.', this),
      this.animalForm,
    );
    this.renderAnimals();
    // --- Civilization ------------------------------------------------------------------------
    const civ = this.section('Civilization');
    this.townList = el('div', 'tb-animals');
    civ.append(
      toggle('Civilization', app.civParams, 'enabled', 'Towns that grow on the land. Found them with the Settle tool (or the button below): each clears farmland, grows toward what its land can feed, paves its streets (flat, sealed, nothing grows) and pollutes, lightly into water beside it and heavily down every river below it. Roads (Road tool, or built between big neighbouring towns) are terraced through the hills and let towns spread along them. Drought years cut harvests; floods, fires, lava and storm surges cost people; big towns found daughter villages; dwindling towns are abandoned.', this),
      slider('Population increase', app.civParams, 'popRate', 0.2, 4, 0.1, 'How fast the towns\' populations increase toward what their food supports.', this),
      slider('Expansion speed', app.civParams, 'growth', 0.2, 4, 0.1, 'How fast civilization spreads: crowded towns founding new villages, and young towns hunting.', this),
      button('🏘 Found a town at the best spot', () => {
        ensureCiv(app.world);
        const site = bestSite(app.world, app.world.N / 2, app.world.N / 2, app.world.N);
        if (site) { foundTown(app.world, site.i); this.renderTowns(); app.world.dirty = true; }
        else this.setInfo('<b>Found a town</b> — there is nowhere suitable left (a liveable climate, fresh water or the coast, farmable flat land, away from other towns).');
      }, '', 'Pick the most suitable place on the whole map to settle (away from existing towns) and found a town there.', this),
      this.townList,
    );
    this.renderTowns();
    const view = this.section('View', false);
    view.append(
      toggle('Show clouds', app.renderer, 'showClouds', 'Show the clouds that form where moist air is pushed up over terrain.', this),
      toggle('Show water', app.renderer, 'showWater', 'Show or hide surface water.', this, () => app.world.dirty = true),
      toggle('Show sea', app.renderer, 'showSea', 'Turn off to hide the sea\'s surface and look at the sea bed: kelp, seagrass, coral reefs, die-offs, sand and the shape of the bottom. The sea is still there (tides, coasts, sea life and everything else carry on).', this, () => { app.world.dirty = true; app.renderer.update(true); }),
      toggle('Wireframe', app.renderer.terrainMat, 'wireframe', 'Show the terrain grid.', this),
    );

    // --- Graphs: a window at the bottom left of the map, expanded on demand ------------------
    const win = el('div', 'graph-win');
    const graphBody = el('div', 'graph-body');
    let open = false;
    try { open = localStorage.getItem('geo.graphs') === '1'; } catch { /* storage blocked */ }
    const head = el('button', 'graph-head');
    const setOpen = (o) => {
      open = o; graphBody.hidden = !o; win.classList.toggle('open', o);
      head.textContent = o ? '📈 Graphs ▾' : '📈 Graphs ▸';
      try { localStorage.setItem('geo.graphs', o ? '1' : '0'); } catch { /* storage blocked */ }
      if (o) this.drawStats();
    };
    head.addEventListener('click', () => setOpen(!open));
    graphBody.append(el('div', 'tb-note', 'How the whole map changes over time (sampled every couple of seconds while the simulation runs). Click a row to expand its chart.'));
    this.statRows = [];
    let lastGroup = null;
    for (const st of STATS) {
      if (st.group !== lastGroup) { graphBody.append(el('div', 'tb-form-title', st.group)); lastGroup = st.group; }
      const row = el('div', 'tb-stat');
      const name = el('span', 'tb-stat-name', st.label);
      const val = el('span', 'tb-stat-val', '—');
      const spark = el('canvas', 'tb-spark');
      spark.width = 64; spark.height = 18;
      row.append(name, val, spark);
      row.title = st.help;
      const big = el('canvas', 'tb-popchart');
      big.width = 270; big.height = 120; big.hidden = true;
      row.addEventListener('click', () => { big.hidden = !big.hidden; this.drawStats(); });
      graphBody.append(row, big);
      this.statRows.push({ st, val, spark, big });
    }
    // Tabs: the whole map, and one per probe
    this.mapPane = el('div', 'graph-pane');
    while (graphBody.firstChild) this.mapPane.append(graphBody.firstChild);
    this.graphTabsEl = el('div', 'graph-tabs');
    this.probePane = el('div', 'graph-pane');
    graphBody.append(this.graphTabsEl, this.mapPane, this.probePane);
    win.append(head, graphBody);
    document.getElementById('viewport').append(win);
    this.graphWin = win;
    this.graphOpen = setOpen;
    this.graphTab = 'map';
    this.renderGraphTabs();
    setOpen(open);

    // Put each tab's sections in order, and open the last-used tab
    const order = Object.values(TABS).flatMap((t) => t.sections);
    const secs = [...r.querySelectorAll(':scope > .tb-section')];
    const pos = (d) => { const k = order.indexOf(d.dataset.title); return k < 0 ? 99 : k; };
    secs.sort((a, b) => pos(a) - pos(b));
    let after = this.tabBar;
    for (const d of secs) { after.after(d); after = d; }
    let saved = 'map';
    try { saved = localStorage.getItem('geo.tab') || 'map'; } catch { /* storage blocked */ }
    this.showTab(saved);

    // --- Info --------------------------------------------------------------------------------
    this.info = el('div', 'tb-info');
    r.append(this.info);
    this.setInfo(this.defaultInfo());
    this.updateLegend();
  }

  /** The Drawings list: each shape with its measurements, colour dot and delete button. */
  updateDrawList() {
    const d = this.app.drawings, L = this.drawList;
    if (!L) return;
    L.innerHTML = '';
    const all = d.current ? [...d.shapes, d.current] : d.shapes;
    if (!all.length) { L.append(el('div', 'draw-empty', 'No drawings yet. Pick ✎ Draw (D) and click on the map.')); return; }
    const colors = Object.keys(DRAW_COLORS);
    for (const s of all) {
      const row = el('div', 'draw-item');
      const dot = el('span', 'dot');
      dot.style.background = s.color;
      dot.title = 'Change colour';
      dot.addEventListener('click', () => { d.setColor(s.id, colors[(colors.indexOf(s.color) + 1) % colors.length]); this.updateDrawList(); });
      const txt = el('div', 'txt');
      txt.append(el('span', '', s === d.current ? `${s.name} (drawing…)` : s.name), el('small', '', d.describe(s)));
      txt.title = d.describe(s);
      row.append(dot, txt);
      // A closed shape can be made a protected zone (kept wild: no towns, farms or industry)
      if (s !== d.current && s.closed) {
        const prot = el('button', 'draw-protect' + (s.protected ? ' on' : ''), '🛡');
        prot.title = s.protected ? 'Protected zone: no towns, farms, industry or new roads inside. Click to unprotect.' : 'Make this a protected zone: towns, farms and industry can\'t expand into it, and roads between towns go round it.';
        prot.addEventListener('click', () => { s.protected = !s.protected; d.onChange(); });
        row.append(prot);
        if (s.protected) row.classList.add('protected');
      }
      if (s !== d.current) {
        const del = el('button', '', '✕');
        del.title = 'Delete';
        del.addEventListener('click', () => d.remove(s.id));
        row.append(del);
      }
      L.append(row);
    }
  }

  /** Legend for the current overlay: swatches for categories, a ramp for continuous values. */
  /** The list of animals in the Wildlife panel. */
  renderAnimals() {
    const app = this.app, w = app.world, L = this.animalList;
    L.innerHTML = '';
    this.graphs = [];
    if (!this.openGraphs) this.openGraphs = new Set();
    const list = w.animals || [];
    if (!list.length) L.append(el('div', 'tb-note', 'No animals yet. Add one, then paint it onto the map with the Animal tool.'));
    for (const a of list) {
      const row = el('div', 'tb-animal' + (app.animalChoice === a.id ? ' chosen' : ''));
      const sw = el('span', 'tb-swatch');
      sw.style.background = rgb(a.color);
      const name = el('span', 'tb-animal-name', a.name);
      const status = el('span', 'tb-animal-status');
      name.append(status);
      const paint = button('Paint', () => { app.animalChoice = a.id; app.setTool('animal'); this.renderAnimals(); }, 'tb-small', `Paint ${a.name} onto the map (Animal tool; Shift removes).`, this);
      const edit = button('Edit', () => this.editAnimal(a), 'tb-small', `Change ${a.name}.`, this);
      const del = button('✕', () => { removeAnimal(w, a.id); if (app.animalChoice === a.id) app.animalChoice = null; this.renderAnimals(); this.updateLegend(); }, 'tb-small', `Remove ${a.name} (and all of them from the map).`, this);
      // A small live population graph; click it to expand a bigger one
      const spark = el('canvas', 'tb-spark');
      spark.width = 64; spark.height = 18;
      spark.title = 'Population over time (click to expand)';
      row.append(sw, name, spark, paint, edit, del);
      this.helpOn(row, `<b>${escapeHtml(a.name)}</b> — ${escapeHtml(describeAnimal(w, a))}`);
      L.append(row);
      const big = el('canvas', 'tb-popchart');
      big.width = 270; big.height = 120;
      big.hidden = !this.openGraphs.has(a.id);
      spark.addEventListener('click', () => {
        if (this.openGraphs.has(a.id)) this.openGraphs.delete(a.id); else this.openGraphs.add(a.id);
        big.hidden = !this.openGraphs.has(a.id);
        this.drawGraphs();
      });
      L.append(big);
      this.graphs.push({ a, spark, big, status });
    }
  }

  /** The list of towns (Civilization section), each with a population graph. */
  renderTowns() {
    if (!this.townList) return;
    const w = this.app.world, L = this.townList;
    L.innerHTML = '';
    this.townGraphs = [];
    if (!this.openTowns) this.openTowns = new Set();
    const towns = w.towns || [];
    this.townKey = towns.map((t) => t.id).join(',');
    if (!towns.length) { L.append(el('div', 'tb-note', 'No towns yet: use the Settle tool on the map, or the button above.')); return; }
    for (const t of towns) {
      const row = el('div', 'tb-stat');
      const val = el('span', 'tb-stat-val', '');
      const spark = el('canvas', 'tb-spark');
      spark.width = 64; spark.height = 18;
      row.append(el('span', 'tb-stat-name', `🏘 ${t.name}`), val, spark);
      const big = el('canvas', 'tb-popchart');
      big.width = 270; big.height = 120; big.hidden = !this.openTowns.has(t.id);
      row.addEventListener('click', () => { if (this.openTowns.has(t.id)) this.openTowns.delete(t.id); else this.openTowns.add(t.id); big.hidden = !this.openTowns.has(t.id); this.drawGraphs(); });
      this.helpOn(row, `<b>${escapeHtml(t.name)}</b> — founded in year ${t.founded}. Population ${Math.round(t.pop)} of the ${Math.round(t.capacity || 0)} its land can feed; ${t.cells || 0} cells of town, ${t.industry || 0} of industry, ${t.farm || 0} of farmland${t.hunted > 0.01 ? '; still hunting much of its food' : ''}${t.boats ? `; a harbour with ${t.boats} fishing boat${t.boats > 1 ? 's' : ''}` : ''}${t.byBoat ? '; settled by boat' : ''}${t.links && t.links.length ? `; roads to ${t.links.length} town${t.links.length > 1 ? 's' : ''} (${Math.round((t.roadsWorking ?? 1) * 100)}% in working order)` : ''}. Click for its population chart.`);
      L.append(row, big);
      this.townGraphs.push({ t, val, spark, big });
    }
  }

  /** Redraw the population graphs (sparklines, and the expanded charts that are open). */
  drawGraphs() {
    const w = this.app.world, hist = w.popHistory || {};
    // Towns (rebuild the list when towns come and go)
    if ((w.towns || []).map((t) => t.id).join(',') !== this.townKey) this.renderTowns();
    for (const g of this.townGraphs || []) {
      const fmtP = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
      g.val.textContent = fmtP(g.t.pop);
      drawLine(g.spark, [{ data: g.t.history, color: '#d9a066', width: 1.5 }], false);
      if (!g.big.hidden) drawLine(g.big, [{ data: g.t.history, color: '#d9a066', width: 2, label: `${g.t.name} (people)` }], true, fmtP);
    }
    for (const g of this.graphs || []) {
      const data = hist[g.a.id] || [];
      drawLine(g.spark, [{ data, color: rgb(g.a.color), width: 1.5 }], false);
      // Starving: a warning beside the name
      const st = g.a.starving || 0, gone = data.length && data[data.length - 1] < 0.5;
      g.status.textContent = gone ? ' · died out' : st > 0.05 ? ` · ${Math.round(st * 100)}% starving` : '';
      g.status.className = 'tb-animal-status' + (gone || st > 0.3 ? ' bad' : st > 0.05 ? ' warn' : '');
      if (!g.big.hidden) {
        // The animal itself, with what it eats and what eats it (fainter) for comparison
        const series = [{ data, color: rgb(g.a.color), width: 2, label: g.a.name }];
        for (const b of w.animals || []) {
          if (b.id === g.a.id) continue;
          const rel = g.a.prey.includes(b.id) ? 'eats' : b.prey.includes(g.a.id) ? 'eaten by' : null;
          if (rel) series.push({ data: hist[b.id] || [], color: rgb(b.color), width: 1, dashed: true, label: `${rel} ${b.name}` });
        }
        drawLine(g.big, series, true);
      }
    }
  }

  /** Redraw the whole-map graphs (Graphs panel). */
  /** The Graphs window's tabs (Map + one per probe); `select` opens that probe's tab. */
  renderGraphTabs(select) {
    if (!this.graphTabsEl) return;
    const w = this.app.world, probes = w.probes || [];
    this.probeKey = probes.map((p) => p.id).join(',');
    if (select) { this.graphTab = select; this.graphOpen(true); }
    if (this.graphTab !== 'map' && !probes.some((p) => p.id === this.graphTab)) this.graphTab = 'map';
    const T = this.graphTabsEl;
    T.innerHTML = '';
    T.hidden = !probes.length;
    const tab = (id, label) => {
      const b = el('button', 'graph-tab' + (this.graphTab === id ? ' active' : ''), label);
      b.addEventListener('click', () => { this.graphTab = id; this.renderGraphTabs(); });
      T.append(b);
    };
    tab('map', 'Whole map');
    for (const p of probes) tab(p.id, `📍 ${p.num}`);
    this.mapPane.hidden = this.graphTab !== 'map';
    this.probePane.hidden = this.graphTab === 'map';
    this.probeRows = [];
    const P = this.probePane;
    P.innerHTML = '';
    const p = probes.find((q) => q.id === this.graphTab);
    if (p) {
      const head = el('div', 'probe-head');
      head.append(el('b', '', p.name), el('span', 'tb-note', `cell ${p.x}, ${p.z}`));
      const del = button('Remove', () => { w.probes = w.probes.filter((q) => q.id !== p.id); w.dirty = true; this.graphTab = 'map'; this.renderGraphTabs(); }, 'tb-small');
      head.append(del);
      P.append(head);
      // The biome over time: a strip of its colours, the current one named
      this.biomeStrip = el('canvas', 'probe-biomes');
      this.biomeStrip.width = 270; this.biomeStrip.height = 14;
      this.biomeLabel = el('div', 'tb-note', '');
      P.append(el('div', 'tb-form-title', 'Biome'), this.biomeStrip, this.biomeLabel);
      for (const st of PROBE_STATS) {
        const row = el('div', 'tb-stat');
        const val = el('span', 'tb-stat-val', '—');
        const spark = el('canvas', 'tb-spark');
        spark.width = 64; spark.height = 18;
        row.append(el('span', 'tb-stat-name', st.label), val, spark);
        row.title = st.help;
        const big = el('canvas', 'tb-popchart');
        big.width = 270; big.height = 120; big.hidden = true;
        row.addEventListener('click', () => { big.hidden = !big.hidden; this.drawStats(); });
        P.append(row, big);
        this.probeRows.push({ st, row, val, spark, big, probe: p });
      }
    }
    this.drawStats();
  }

  drawStats() {
    if (this.graphWin && !this.graphWin.classList.contains('open')) return;
    if (this.graphTab && this.graphTab !== 'map') { this.drawProbe(); return; }
    const hist = this.app.world.statHistory || {};
    for (const r of this.statRows || []) {
      const data = hist[r.st.id] || [];
      const fmt = r.st.unit === '%' ? (v) => `${v.toFixed(v < 10 ? 1 : 0)}%`
        : r.st.unit === 'people' ? (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)
        : r.st.unit === '' ? (v) => `${Math.round(v)}` : (v) => `${v.toFixed(1)} ${r.st.unit}`;
      r.val.textContent = data.length ? fmt(data[data.length - 1]) : '—';
      drawLine(r.spark, [{ data, color: '#e0a458', width: 1.5 }], false);
      if (!r.big.hidden) drawLine(r.big, [{ data, color: '#e0a458', width: 2, label: r.st.label }], true, fmt);
    }
  }

  /** Redraw the open probe's charts and biome strip. */
  drawProbe() {
    const rows = this.probeRows || [];
    if (!rows.length) return;
    const p = rows[0].probe;
    for (const r of rows) {
      const data = p.history[r.st.id] || [];
      const has = data.some((v) => v !== null);
      r.row.hidden = !has; // (only what applies here: land readings on land, sea readings at sea)
      if (!has) { r.big.hidden = true; continue; }
      const u = r.st.unit, fmt = u === '%' ? (v) => `${v.toFixed(0)}%` : u ? (v) => `${v.toFixed(1)} ${u}` : (v) => v.toFixed(2);
      const last = [...data].reverse().find((v) => v !== null);
      r.val.textContent = last !== undefined ? fmt(last) : '—';
      drawLine(r.spark, [{ data, color: '#ff8a7a', width: 1.5 }], false);
      if (!r.big.hidden) drawLine(r.big, [{ data, color: '#ff8a7a', width: 2, label: r.st.label }], true, fmt);
    }
    // Biome strip
    const cv = this.biomeStrip, ctx = cv.getContext('2d'), b = p.biomes || [];
    ctx.clearRect(0, 0, cv.width, cv.height);
    const info = (id) => (typeof id === 'string' && id.startsWith('sea_') ? MARINE[+id.slice(4)] : BIOMES[id]);
    b.forEach((id, k) => {
      const c = info(id) ? info(id).color : [0.5, 0.5, 0.5];
      ctx.fillStyle = rgb(c);
      const x0 = Math.floor((k / b.length) * cv.width), x1 = Math.ceil(((k + 1) / b.length) * cv.width);
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), cv.height);
    });
    const now = b.length ? info(b[b.length - 1]) : null;
    const changes = b.filter((id, k) => k && id !== b[k - 1]).length;
    this.biomeLabel.textContent = now ? `Now: ${now.label}${changes ? ` · changed ${changes}×` : ''}` : '';
  }

  /** The add / edit form for an animal (a = null: a new one). */
  editAnimal(a) {
    const app = this.app, w = app.world, F = this.animalForm;
    const draft = a ? JSON.parse(JSON.stringify(a)) : newAnimal({ color: [0.3 + Math.random() * 0.6, 0.3 + Math.random() * 0.5, 0.2 + Math.random() * 0.5] });
    F.innerHTML = '';
    F.hidden = false;
    const field = (label, input) => { const r = el('label', 'tb-form-row'); r.append(el('span', 'tb-label', label), input); return r; };
    const name = el('input'); name.type = 'text'; name.value = draft.name; name.maxLength = 40;
    const color = el('input'); color.type = 'color';
    color.value = '#' + draft.color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    const hab = el('select');
    for (const [k, t] of Object.entries(HABITATS)) { const o = el('option', '', t); o.value = k; hab.append(o); }
    hab.value = draft.habitat;
    const checks = (title, entries, isOn) => {
      const box = el('div', 'tb-form-group');
      box.append(el('div', 'tb-form-title', title));
      const inputs = {};
      for (const [k, label, help] of entries) {
        const r = el('label', 'tb-check');
        const c = el('input'); c.type = 'checkbox'; c.checked = isOn(k);
        r.append(c, el('span', '', label));
        if (help) this.helpOn(r, `<b>${label}</b> — ${help}`);
        box.append(r);
        inputs[k] = c;
      }
      return { box, inputs };
    };
    const plants = checks('Eats (plants)', Object.entries(PLANT_FOODS).map(([k, t]) => [k, t]), (k) => !!draft.eats[k]);
    const others = (w.animals || []).filter((b) => b.id !== draft.id);
    const prey = checks('Eats (animals)', others.length ? others.map((b) => [b.id, b.name]) : [], (k) => draft.prey.includes(k));
    if (!others.length) prey.box.append(el('div', 'tb-note', 'Add more animals to choose prey.'));
    const habits = checks('Habits', Object.entries(HABITS).map(([k, [t, h]]) => [k, t, h]), (k) => !!draft.habits[k]);
    const breed = el('select');
    for (const [v, t] of [[0.5, 'Slowly'], [1, 'Normally'], [2, 'Quickly']]) { const o = el('option', '', t); o.value = v; breed.append(o); }
    breed.value = String(draft.breed);
    const roam = el('select');
    for (const [v, t] of [[1, 'A small home range'], [3, 'A medium range'], [6, 'Far and wide']]) { const o = el('option', '', t); o.value = v; roam.append(o); }
    roam.value = String(draft.roam);
    const migr = el('select');
    for (const [v, t] of Object.entries(MIGRATION)) { const o = el('option', '', t); o.value = v; migr.append(o); }
    migr.value = draft.migrates || 'none';
    // Temperature range it's comfortable in
    const tRow = el('div', 'tb-temp-range');
    const tMin = el('input'); tMin.type = 'number'; tMin.step = 1; tMin.value = draft.tempMin ?? -10;
    const tMax = el('input'); tMax.type = 'number'; tMax.step = 1; tMax.value = draft.tempMax ?? 30;
    tRow.append(tMin, el('span', 'tb-label', 'to'), tMax, el('span', 'tb-label', '°C'));
    this.helpOn(tRow, '<b>Likes temperatures</b> — The range it is comfortable in (the air on land, the water at sea). Inside it the animal thrives and spreads fastest; beyond it the place supports fewer of them, they breed slower and suffer heat or cold stress, fading out about 5 °C past the limit. Animals with different ranges spread at different rates and shift with the seasons.');
    const save = button(a ? 'Save' : 'Add animal', () => {
      draft.name = name.value.trim() || 'Animal';
      const hex = color.value;
      draft.color = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
      draft.habitat = hab.value;
      draft.eats = Object.fromEntries(Object.entries(plants.inputs).filter(([, c]) => c.checked).map(([k]) => [k, true]));
      draft.prey = Object.entries(prey.inputs).filter(([, c]) => c.checked).map(([k]) => k);
      draft.habits = Object.fromEntries(Object.entries(habits.inputs).filter(([, c]) => c.checked).map(([k]) => [k, true]));
      draft.breed = parseFloat(breed.value);
      draft.roam = parseFloat(roam.value);
      draft.migrates = migr.value;
      let lo = parseFloat(tMin.value), hi = parseFloat(tMax.value);
      if (!isFinite(lo)) lo = -10; if (!isFinite(hi)) hi = 30;
      if (lo > hi) [lo, hi] = [hi, lo];
      draft.tempMin = lo; draft.tempMax = hi;
      if (!w.animals) w.animals = [];
      const at = w.animals.findIndex((b) => b.id === draft.id);
      if (at >= 0) w.animals[at] = draft; else w.animals.push(draft);
      app.animalChoice = draft.id;
      F.hidden = true;
      this.renderAnimals();
      this.updateLegend();
      w.dirty = true;
    }, 'tb-primary');
    const cancel = button('Cancel', () => { F.hidden = true; });
    const btns = el('div', 'tb-form-buttons');
    btns.append(save, cancel);
    F.append(el('div', 'tb-form-head', a ? `Edit ${a.name}` : 'New animal'),
      field('Name', name), field('Colour', color), field('Lives in', hab),
      plants.box, prey.box,
      field('Likes', tRow), field('Breeds', breed), field('Roams', roam), field('Migrates', migr),
      habits.box, btns);
    name.focus();
    name.select();
  }

  updateLegend() {
    const mode = this.app.renderer.colorMode;
    const L = this.legendEl;
    L.innerHTML = '';
    L.className = 'tb-legend';
    const items = (title, list) => {
      this.legendTitle.textContent = title;
      for (const it of list) {
        const item = el('div', 'tb-legend-item');
        const sw = el('span', 'tb-swatch');
        sw.style.background = rgb(it.color);
        item.append(sw, el('span', '', it.label));
        if (it.help) this.helpOn(item, `<b>${it.label}</b> — ${it.help}`);
        L.append(item);
      }
    };
    const ramp = (title, lo, hi, colors) => {
      this.legendTitle.textContent = title;
      L.className = 'tb-ramp';
      const bar = el('div', 'tb-ramp-bar');
      bar.style.background = `linear-gradient(to right, ${colors.map(rgb).join(', ')})`;
      const labels = el('div', 'tb-ramp-labels');
      labels.append(el('span', '', lo), el('span', '', hi));
      L.append(bar, labels);
    };
    if (mode === 'rock' || (mode === 'natural' && !this.app.renderer.showVegetation)) items('Rock types', ROCKS);
    else if (mode === 'bare') items('Exposed rock (pale = under soil)', [{ label: 'Soil-covered', color: [0.86, 0.84, 0.78], help: 'Bedrock buried under soil deep enough to grow on.' }, ...ROCKS]);
    else if (mode === 'natural' || mode === 'biome') {
      items(mode === 'biome' ? 'Biomes' : 'Biomes (blended)', Object.values(BIOMES));
      // Your animals, when shown on the map
      const animals = this.app.world.animals || [];
      if (mode === 'natural' && animals.length && this.app.wildlife.visible) {
        L.append(el('div', 'tb-legend-sub', 'Animals'));
        for (const an of animals) {
          const item = el('div', 'tb-legend-item');
          const sw = el('span', 'tb-swatch tb-dot');
          sw.style.background = rgb(an.color);
          item.append(sw, el('span', '', an.name));
          this.helpOn(item, `<b>${escapeHtml(an.name)}</b> — ${escapeHtml(describeAnimal(this.app.world, an))}`);
          L.append(item);
        }
      }
    }
    else if (mode === 'precip') ramp('Precipitation', 'dry (rain shadow)', 'wet (windward)', [[0.86, 0.74, 0.52], [0.12, 0.35, 0.75]]);
    else if (mode === 'snowDepth') ramp('Snow depth (grey = none)', 'thin', 'deep', [[0.88, 0.92, 0.98], [0.55, 0.72, 0.95], [0.18, 0.30, 0.75]]);
    else if (mode === 'coast') items('Shores, dunes and ocean biomes', [...SHORES, { label: 'Coastal dunes', color: [0.86, 0.82, 0.62], help: 'Wind-blown sand behind sand beaches.' }, { label: 'Mangrove forest', color: [0.12, 0.30, 0.16], help: 'Forest standing in the tide on warm, sheltered mudflats.' }, ...MARINE]);
    else if (mode === 'trees') ramp('Forest density (how closely the trees stand)', 'open', 'closed canopy', [[0.78, 0.84, 0.58], [0.36, 0.62, 0.30], [0.06, 0.26, 0.12]]);
    else if (mode === 'health') ramp('Forest health: young trees replacing the old (pale = no forest)', 'failing', 'renewing', [[0.80, 0.25, 0.18], [0.92, 0.78, 0.30], [0.18, 0.60, 0.28]]);
    else if (mode === 'wildlife') items((this.app.world.animals || []).length ? 'Most common animal (stronger colour = more of them)' : 'No animals yet (add them under Wildlife)', (this.app.world.animals || []).map((an) => ({ label: an.name, color: an.color, help: describeAnimal(this.app.world, an) })));
    else if (mode === 'wind') ramp('Wind speed (land blocks it: calm in its lee)', 'calm', 'gale', [[0.86, 0.90, 0.92], [0.45, 0.72, 0.80], [0.20, 0.38, 0.72], [0.52, 0.20, 0.58]]);
    else if (mode === 'quality') ramp('Seawater quality', 'foul (silt, pollutants)', 'clear', [[0.45, 0.25, 0.12], [0.78, 0.68, 0.36], [0.20, 0.55, 0.85]]);
    else if (mode === 'topo') {
      const t = this.app.renderer.topo || { lo: 0, hi: 50, interval: 2.5 };
      ramp(`Elevation · contours every ${t.interval} (bold every ${t.interval * 5})`, t.lo.toFixed(0), t.hi.toFixed(0), [[0.42, 0.62, 0.38], [0.62, 0.76, 0.46], [0.90, 0.86, 0.58], [0.80, 0.62, 0.40], [0.62, 0.48, 0.40], [0.97, 0.97, 0.97]]);
    }
    else if (mode === 'ice') ramp('Glacier ice (grey = none)', 'thin', 'thick', [[0.82, 0.93, 0.98], [0.45, 0.72, 0.92], [0.12, 0.28, 0.62]]);
    else if (mode === 'decid') ramp('Deciduous share (pale = no forest)', 'evergreen', 'all deciduous', [[0.10, 0.32, 0.22], [0.95, 0.60, 0.12]]);
    else if (mode === 'temp') ramp('Temperature today (land: air · sea: surface water)', '−15 °C', '35 °C', [[0.15, 0.25, 0.65], [0.92, 0.94, 0.98], [0.35, 0.65, 0.35], [0.95, 0.80, 0.30], [0.80, 0.20, 0.12]]);
    else if (mode === 'species') items('Dominant tree species', [...SPECIES, OPEN].map((s) => ({ ...s, color: s.mapColor })));
    else if (mode === 'chem') ramp('Soil chemistry (from the rock below)', 'acidic (granite, sandstone)', 'alkaline (limestone, marble)', [[0.55, 0.30, 0.62], [0.88, 0.86, 0.80], [0.20, 0.62, 0.56]]);
    else if (mode === 'age') ramp('Forest age (pale = no forest)', 'young', 'old growth', [[0.72, 0.86, 0.42], [0.05, 0.24, 0.10]]);
    else if (mode === 'soil') ramp('Soil depth', 'bare rock', 'deep soil', [[0.88, 0.85, 0.76], [0.72, 0.48, 0.24], [0.22, 0.13, 0.07]]);
    else if (mode === 'moisture') ramp('Soil wetness', 'dry', 'saturated', [[0.85, 0.72, 0.5], [0.15, 0.4, 0.8]]);
    else if (mode === 'vegetation') items('Plant cover', [BIOMES.barren, BIOMES.grassland, { ...BIOMES.broadleaf, label: 'Forest' }]);
    else if (mode === 'hardness') ramp('Rock hardness', 'soft (shale, tuff)', 'hard (granite, basalt)', [[0.98, 0.84, 0.36], [0.86, 0.45, 0.24], [0.16, 0.20, 0.44]]);
    else if (mode === 'change') ramp('Since baseline', 'eroded', 'deposited', [[0.85, 0.25, 0.2], [0.75, 0.75, 0.72], [0.2, 0.45, 0.9]]);
    else if (mode === 'slope') ramp('Slope', 'flat', 'steep', [[0.2, 0.7, 0.3], [0.9, 0.2, 0.15]]);
  }

  /** Bottom bar: every tool as a small icon button, grouped, plus the brush size/strength. */
  buildToolbar(bar) {
    const app = this.app;
    bar.innerHTML = '';
    const groups = [...new Set(Object.values(TOOLS).map((t) => t.group))];
    for (const g of groups) {
      const group = el('div', 'bar-group');
      group.append(el('div', 'bar-label', g));
      const icons = el('div', 'bar-icons');
      for (const [id, t] of Object.entries(TOOLS)) {
        if (t.group !== g) continue;
        const b = el('button', 'bar-tool');
        const key = toolKey(id);
        b.innerHTML = `<span class="bar-icon">${t.icon}</span>${key ? `<kbd>${key}</kbd>` : ''}`;
        b.title = `${t.label}${key ? ` (${key})` : ''}`;
        b.setAttribute('aria-label', t.label);
        b.addEventListener('click', () => app.setTool(id));
        this.helpOn(b, `<b>${t.label}</b>${key ? ` <kbd>${key}</kbd>` : ''} — ${t.help}`);
        icons.append(b);
        this.toolButtons.set(id, b);
      }
      group.append(icons);
      if (g === 'Erosion') this.erosionTools = group;
      bar.append(group);
    }
    const brush = el('div', 'bar-group bar-brush');
    brush.append(
      el('div', 'bar-label', 'Brush'),
      slider('Size', app.brush, 'radius', 2, 60, 1, 'Brush radius in cells. Shortcut: [ and ].', this),
      slider('Strength', app.brush, 'strength', 0.05, 1, 0.01, 'How fast the tool works. Hold Shift to invert most tools.', this),
    );
    bar.append(brush);
  }

  /** A collapsible section; whether it's open is remembered between visits. */
  /** A settings group under a heading, shown on its topic's tab (see TABS). */
  section(title) {
    const d = el('div', 'tb-section');
    d.dataset.tab = Object.keys(TABS).find((k) => TABS[k].sections.includes(title)) || 'map';
    d.dataset.title = title;
    d.append(el('div', 'tb-sec-title', title));
    const body = el('div', 'tb-body');
    d.append(body);
    this.root.append(d);
    return body;
  }

  /** Show one topic's settings. */
  showTab(id) {
    this.tab = TABS[id] ? id : 'map';
    try { localStorage.setItem('geo.tab', this.tab); } catch { /* storage blocked */ }
    for (const [k, b] of Object.entries(this.tabButtons)) b.classList.toggle('active', k === this.tab);
    for (const d of this.root.querySelectorAll(':scope > .tb-section')) d.hidden = d.dataset.tab !== this.tab;
    this.root.scrollTop = 0;
  }

  helpOn(node, html) {
    node.addEventListener('mouseenter', () => this.setInfo(html));
    node.addEventListener('mouseleave', () => this.setInfo(this.defaultInfo()));
  }

  defaultInfo() {
    const t = TOOLS[this.app.tool];
    return `<b>${t.label}</b> — ${t.help}<div class="tb-hint">Right-drag: orbit · Middle-drag: pan · Scroll: zoom · Shift: invert · Space: play/pause</div>`;
  }

  setInfo(html) { this.info.innerHTML = html; }

  setSaveStatus(text) { if (this.saveStatusEl) this.saveStatusEl.textContent = text; }

  /** Sync all controls and highlight the active tool. Called after state changes from code. */
  refresh() {
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === this.app.tool);
    this.playBtn.textContent = this.app.sim.running ? '❚❚ Pause' : '▶ Play';
    this.playBtn.classList.toggle('running', this.app.sim.running);
    document.querySelectorAll('[data-sync]').forEach((n) => n.sync());
    if (this.animalList) this.renderAnimals();
    // (after loading a level: rebuild the probe tabs if the probes are different)
    const pk = (this.app.world.probes || []).map((p) => p.id).join(',');
    if (pk !== this.probeKey) { this.probeKey = pk; this.renderGraphTabs(); }
    this.erosionControls.classList.toggle('tb-disabled', !this.app.world.erosionEnabled);
    this.erosionTools.classList.toggle('tb-disabled', !this.app.world.erosionEnabled);
    this.setInfo(this.defaultInfo());
  }

  setStats(html) { this.statsEl.innerHTML = html; }
}

// --- tiny DOM helpers ------------------------------------------------------------------------

function el(tag, cls = '', text = '') {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function button(label, onClick, cls = '', help = '', tb = null) {
  const b = el('button', 'tb-btn ' + cls, label);
  b.addEventListener('click', onClick);
  if (help && tb) tb.helpOn(b, help);
  return b;
}

function slider(label, obj, key, min, max, step, help, tb, onChange) {
  const row = el('label', 'tb-control');
  const name = el('span', 'tb-label', label);
  const input = el('input');
  Object.assign(input, { type: 'range', min, max, step });
  const val = el('span', 'tb-value');
  const fmt = (v) => (step >= 1 ? String(Math.round(v)) : Number(v).toFixed(step < 0.01 ? 3 : 2));
  row.sync = () => { input.value = obj[key]; val.textContent = fmt(obj[key]); };
  row.dataset.sync = '';
  input.addEventListener('input', () => {
    obj[key] = parseFloat(input.value);
    val.textContent = fmt(obj[key]);
    onChange && onChange();
  });
  row.append(name, input, val);
  row.sync();
  tb.helpOn(row, `<b>${label}</b> — ${help}`);
  return row;
}

function toggle(label, obj, key, help, tb, onChange) {
  const row = el('label', 'tb-control tb-toggle');
  const input = el('input');
  input.type = 'checkbox';
  row.sync = () => { input.checked = !!obj[key]; };
  row.dataset.sync = '';
  input.addEventListener('change', () => { obj[key] = input.checked; onChange && onChange(); });
  row.append(input, el('span', 'tb-label', label));
  row.sync();
  tb.helpOn(row, `<b>${label}</b> — ${help}`);
  return row;
}

function select(label, options, obj, key, help, tb, onChange) {
  const row = el('label', 'tb-control');
  const s = el('select');
  for (const [v, text] of Object.entries(options)) {
    const o = el('option', '', text);
    o.value = v;
    s.append(o);
  }
  row.sync = () => { s.value = obj[key]; };
  row.dataset.sync = '';
  s.addEventListener('change', () => { obj[key] = s.value; onChange && onChange(); });
  row.append(el('span', 'tb-label', label), s);
  row.sync();
  tb.helpOn(row, `<b>${label}</b> — ${help}`);
  return row;
}

function numberInput(label, obj, key, help, tb) {
  const row = el('label', 'tb-control');
  const input = el('input');
  input.type = 'number';
  row.sync = () => { input.value = obj[key]; };
  row.dataset.sync = '';
  input.addEventListener('change', () => { obj[key] = parseInt(input.value, 10) || 0; });
  row.append(el('span', 'tb-label', label), input);
  row.sync();
  tb.helpOn(row, `<b>${label}</b> — ${help}`);
  return row;
}

function rgb(c) { return `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`; }

function escapeHtml(t) { return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/**
 * Draw line series on a canvas; `axes` adds a scale (for the first series), the time direction and
 * a legend with each series' latest value. Other series are drawn on their own scale (dashed), so
 * their rises and falls can be compared even when their numbers are very different.
 */
function drawLine(cv, series, axes, fmt = fmtPop) {
  const ctx = cv.getContext('2d');
  if (axes) cv.height = 104 + 13 * series.length;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const pad = axes ? { l: 34, r: 6, t: 8, b: 16 + 13 * series.length } : { l: 1, r: 1, t: 2, b: 2 };
  const range = (d) => { let lo = Infinity, hi = -Infinity; for (const v of d) { if (v === null) continue; lo = Math.min(lo, v); hi = Math.max(hi, v); } if (!isFinite(lo)) return null; lo = Math.min(lo, 0); if (hi - lo < 1e-6) hi = lo + 1; return [lo, hi]; };
  const main = range(series[0].data);
  if (!main) {
    if (axes) { ctx.fillStyle = '#9aa3ae'; ctx.font = '11px system-ui, sans-serif'; ctx.fillText('No history yet: run the simulation', 10, 50); }
    return;
  }
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const X = (k, len) => pad.l + (len <= 1 ? pw : (k / (len - 1)) * pw);
  const Yf = ([lo, hi]) => (v) => pad.t + ph - ((v - lo) / (hi - lo)) * ph;
  if (axes) {
    const Y = Yf(main);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    ctx.fillStyle = '#9aa3ae'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right';
    for (const v of [main[0], (main[0] + main[1]) / 2, main[1]]) { const y = Y(v); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillText(fmt(v), pad.l - 4, y + 3); }
    ctx.textAlign = 'left'; ctx.fillText('earlier', pad.l, pad.t + ph + 12); ctx.textAlign = 'right'; ctx.fillText('now', W - pad.r, pad.t + ph + 12);
  }
  for (let k = (axes ? series.length : 1) - 1; k >= 0; k--) {
    const s = series[k], d = s.data, rg = k === 0 ? main : range(d);
    if (!d.length || !rg) continue;
    const Y = Yf(rg);
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.setLineDash(s.dashed ? [3, 3] : []);
    ctx.globalAlpha = s.dashed ? 0.75 : 1;
    ctx.beginPath();
    let pen = false; // (gaps where there was no reading)
    d.forEach((v, j) => { if (v === null) { pen = false; return; } const x = X(j, d.length), y = Y(v); pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; });
    ctx.stroke();
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (axes) {
    // Legend below the chart: each series and its latest value
    ctx.textAlign = 'left'; ctx.font = '10px system-ui, sans-serif';
    let y = pad.t + ph + 26;
    series.forEach((s, k) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(pad.l, y - 6, 10, k ? 1.5 : 2.5);
      const lastV = [...s.data].reverse().find((v) => v !== null);
      ctx.fillText(`${s.label}: ${lastV !== undefined ? fmt(lastV) : '—'}${k ? ' (own scale)' : ''}`, pad.l + 14, y - 2);
      y += 13;
    });
  }
}

function fmtPop(v) { return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 10 ? Math.round(v).toString() : v.toFixed(1); }
