// The right-hand toolbox panel and the bottom tool bar. Built with plain DOM so it is easy to
// extend: each control is bound to a property on some settings object and carries a `help` string
// that is shown in the info box when you hover it.

import { DRAW_COLORS } from '../render/drawings.js';
import { SHORES, MARINE } from '../sim/coast.js';
import { ENVIRONMENTS, applyEnvironment } from '../core/environments.js';
import { TOOLS, toolKey } from '../tools/brushes.js';
import { PRESETS } from '../core/generate.js';
import { OVERLAYS, sortedOverlays } from '../render/terrainRenderer.js';
import { ROCKS } from '../core/rocks.js';
import { ERUPTION_TYPES, INTRUSION_TYPES } from '../sim/volcanism.js';
import { FAULT_TYPES } from '../sim/tectonics.js';
import { SPECIES, OPEN } from '../sim/species.js';
import { DISEASES, DISEASE_BY_ID } from '../sim/disease.js';
import { NAME_AT, fireColor } from '../sim/fireHistory.js';
import { BIOMES } from '../render/biomes.js';
import { STATS } from '../sim/stats.js';
import { PROBE_STATS } from '../sim/probes.js';
import { bestSite, foundTown, ensureCiv, updateProtectedZones, RESTRICTIONS } from '../sim/civilization.js';
import { YEAR_KINDS } from '../sim/climate.js';
import { HABITATS, PLANT_FOODS, HABITS, MIGRATION, newAnimal, removeAnimal, describeAnimal } from '../sim/ecology.js';
import { MOD, listMods, addMod, setModEnabled, removeMod } from '../core/mods.js';
import { spotOnHover, townMask, shapeMask, pathMask, animalMask, speciesMask, biomeMask, landUseMask } from './spotlight.js';
const app_autosave = async (app) => { try { await app.autosave(); } catch { /* not saved */ } };

/** The sidebar's topic tabs and the settings sections on each. */
const TABS = {
  map: { label: 'Map', icon: '🗺', sections: ['Level', 'Overlays', 'Terrain', 'Drawings', 'View'], help: 'Your level (save, load), map overlays and their key, terrain presets and size, drawings, and what is shown.' },
  land: { label: 'Land', icon: '⛰', sections: ['Water', 'Erosion', 'Geology', 'Volcanism & tectonics', 'Land events'], help: 'Water on the land, erosion, rocks, volcanoes and faults.' },
  climate: { label: 'Climate', icon: '☀', sections: ['Climate', 'Seasons', 'Weather', 'Climate events'], help: 'Environments, temperature and wind, the seasons (and good and bad years), storms and weather.' },
  sea: { label: 'Sea', icon: '🌊', sections: ['Ocean & coast'], help: 'The sea, tides, currents, coasts and water quality.' },
  life: { label: 'Life', icon: '🐾', sections: ['Wildlife', 'Civilization', 'Ecosystem changes', 'Town life'], help: 'Your animals (design them, paint them in, follow their populations) and civilization: towns, farms, roads.' },
  mods: { label: 'Mods', icon: '🧩', sections: ['Mods'], help: 'Mods: JavaScript files that add tree species, tools, overlays, settings and rules to the simulation. Add them here; see the Modding guide.' },
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
    const home = button('🏠', () => app.goHome(), 'tb-home', 'Home: your simulations (this one is saved first).', this);
    this.simNameEl = el('h1', '', app.simMeta ? app.simMeta.name : 'Geology Toolbox');
    this.simNameEl.title = 'The simulation you have open';
    header.append(home, this.simNameEl);
    // (play/pause, the readouts and saving are in the menu bar at the top)
    this.tabLabels = Object.fromEntries(Object.entries(TABS).map(([k, t]) => [k, t.label]));
    r.append(header);


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
      select('Overlay', sortedOverlays(), app.renderer, 'colorMode',
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
      slider('Fire resiliency', app.fireParams, 'resiliency', 0, 3, 0.05, 'How much a big fire shrugs off the rain. Once a fire is large (a few hundred cells burning), its heat and updraft dry the air and drive the rain off, so rain puts it out far more slowly: at 1 about three times as slowly, at 3 more than ten times. Small fires, standing water and snow still put fires out as before. 0 = rain puts out any fire alike.', this),
      slider('Fire spread', app.fireParams, 'spread', 0.5, 6, 0.1,
        'How readily fire jumps to neighbouring plants.', this),
      el('div', 'tb-group-label', 'Fire history'),
      slider('Merge fires within', app.fireParams, 'mergeGap', 0, 15, 1, 'Two fires burning at the same time whose burnt ground comes within this many cells of each other count as one fire (a front that split around a lake and joined up again, two outbreaks side by side). Fires at different times are never merged. 0 = never merge. Merges already made stay merged.', this),
      (this.fireList = el('div', 'tb-fire-list')),
    );
    const vtBtns = el('div', 'tb-row');
    vtBtns.append(button('Stop all events', () => { app.world.events.length = 0; app.world.flows.length = 0; }, '', 'End all running eruptions, intrusions, faults and pyroclastic flows. Lava already out keeps flowing until it cools.', this));
    vt.append(vtBtns);

    // --- Water ---------------------------------------------------------------------------------
    const sim = this.section('Water', true);
    sim.append(
      slider('Sim speed', app.sim, 'substeps', 1, 20, 1,
        'Water-flow steps per frame. Higher = faster geological time, lower framerate.', this),
      toggle('Groundwater', app.groundwaterParams, 'enabled', 'Water stored in the ground: rain refills it, it seeps to lower ground and out into springs and streams in the valleys (keeping rivers running through dry spells), and towns pump it from wells. See it with the Groundwater and Groundwater drawdown overlays.', this),
      slider('Well pumping', app.groundwaterParams, 'pumping', 0, 4, 0.1, 'How hard the towns pump groundwater for their people and fields (1 = usual). Pumped faster than the rain refills it, the water table falls in a cone around each town: streams fail, the town runs short of water and the ground sinks where it\'s pumped dry.', this),
      slider('Global rain', app.waterParams, 'rain', 0, 0.1, 0.002,
        'Rainfall over the whole map, fed into the shallow-water flow model. Rivers form where runoff converges.', this),
      slider('Evaporation', app.waterParams, 'evaporate', 0, 0.3, 0.005,
        'Overall evaporation rate. Each spot evaporates faster in warm air, in sun and on bare ground, and slower in shaded valleys and under forest (see Inspect → Evaporation). Lakes and ponds high up evaporate much faster (thin, dry, windy air and strong sun), so high basins hold only small tarns. Dry lakes leave their sediment behind as flat lake beds.', this),
      slider('Stagnant water evaporation ×', app.waterParams, 'stagnantEvap', 1, 1000, 1,
        'How many times faster still, shallow standing water on land evaporates: puddles, ponds and swampy sheets on flat ground. Flowing rivers, deep lakes and the sea aren\'t affected, and the soil isn\'t dried out (only the standing water itself goes), so the forests keep their moisture. Turn it up to stop water pooling over the land.', this),
      slider('Soaking in', app.waterParams, 'infiltration', 0, 0.5, 0.01,
        'How fast standing water on land soaks into the ground: on flat ground and in still ponds most, on slopes and in fast rivers and deep lakes hardly at all. What soaks in wets the soil (the plants drink it) and drains on down into the groundwater, even through soil that\'s already wet, so water doesn\'t pool over the land. Higher: drier ground with fewer puddles and sheets of water, without drying the forests out the way more evaporation does.', this),
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
      slider('Windstorms', app.climateParams, 'windstorms', 0, 5, 0.1,
        'How often gales sweep across the map with the prevailing wind. They throw trees (worst on exposed ridges and coasts, in old tall stands and on wet ground): forests thin out or, in a bad storm, are flattened, the fallen wood rotting into the soil. In autumn they strip the leaves early. A windstorm year (with Seasons on) brings them often and fierce. 0 = none.', this),
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
      toggle('Show polygon edges', app.drawSettings, 'edges', 'Draw polygons\' outlines and corner dots (parks included). Off: polygons show as their fill alone, with no edges. Lines (paths) keep theirs.', this, () => app.drawings.rebuildAll()),
      slider('Simplify outlines', app.drawSettings, 'simplify', 0, 1, 0.05, 'Draw outlines with fewer corners: the small wiggles smoothed away (0 exact, 1 simplest). Only how they look: a shape, and a park\'s restrictions, still follow every point.', this, () => app.drawings.rebuildAll()),
      slider('Polygon opacity', app.drawSettings, 'fill', 0, 1, 0.02, 'How solid a polygon\'s fill is drawn over the map: 0 shows only its outline, 1 is a solid colour. Its outline and label are always shown.', this, () => app.drawings.applyFill()),
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

    // --- Level: saving and loading are in the File menu; this keeps the save status ------------
    const lvl = this.section('Level', true);
    this.saveStatusEl = el('div', 'tb-save-status', app.saveStatus || '');
    lvl.append(el('div', 'tb-note', 'Save, load, new simulations and map size are in the File menu at the top.'), this.saveStatusEl);

    // --- World grid --------------------------------------------------------------------------
    const wg = this.section('World grid', true);
    this.gridEl = el('div', 'tb-grid');
    this.gridNote = el('div', 'tb-note', '');
    wg.append(this.gridEl, this.gridNote);
    this.helpOn(wg.querySelector ? this.gridEl : wg, '<b>World grid</b> — the world goes on past the edges of the map. Each square is a map of its own; click one next to yours (or any you have been to) to travel there. The one you leave is frozen, and catches up on the years it missed when you come back. A new square continues the land around it. Rivers flow across the borders, and towns build roads to the towns next door.');
    this.renderGrid();

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
      slider('Food abundance', app.ecoParams, 'abundance', 0.3, 2, 0.05, 'How much food the land and sea offer: how many animals each place can support. Lower it for a lean, hungry landscape; raise it for a rich one.', this),
      slider('Predation', app.ecoParams, 'predation', 0, 2, 0.05, 'How hard predators hit their prey. Low, and prey grows plentiful (and grazes harder); high, and predators can eat their prey out and then starve themselves.', this),
      slider('Roaming', app.ecoParams, 'roaming', 0.3, 3, 0.1, 'How far animals range for food, and so how fast they spread into new ground and refill places they were wiped out of.', this),
      slider('Hard winters', app.ecoParams, 'winters', 0, 2.5, 0.05, 'How hard cold, heat and deep snow are on the animals: at 0 the weather never kills them; high, and hard winters thin them out (and frost-killed pests die in milder freezes).', this),
      toggle('Roadkill', app.ecoParams, 'roadkill', 'Traffic kills land animals crossing roads, and they shun the noisy band either side of a busy road, so busy roads split their ranges (unless the towns build wildlife crossings). Off: roads don\'t affect them.', this),
      toggle('Wildlife disease', app.ecoParams, 'disease', 'Now and then an outbreak of disease sweeps through a crowded population, hitting hardest where they\'re packed in, then dies down. Predators that keep a population thinned keep it healthier.', this),
      toggle('Root rot (honey mushroom)', app.ecoParams, 'rootRot', 'Honey mushroom (Armillaria), a root and butt rot: it spreads slowly underground from stand to stand and now and then by spores to a stand far away, takes best in old or stressed trees and plantations, and kills heavily infected stands over some years. Rich fungal life in the soil holds it back. Overlay: Fungi & root rot.', this),
      slider('Root rot strength', app.ecoParams, 'rootRotStrength', 0, 2, 0.05, 'How fast the honey mushroom spreads and how hard it hits.', this),
      toggle('Fire followers', app.ecoParams, 'fireFollowers', 'Plants that come up only on fresh burns, and only the smaller ones: fireweed (wind-blown seed from the edges) and fire poppies (seeds that wait in the soil for a fire). They feed pollinators, and animals living in the Recent small burns habitat. Overlay: Fire followers.', this),
      slider('Small burn size', app.ecoParams, 'smallBurn', 20, 3000, 10, 'The largest burn (in cells) fire followers fully take to; up to two and a half times that, fewer. Beyond it the heart of the burn is too far from seed and shelter, and the fire burnt hot enough to cook the seed in the soil.', this),
      toggle('Show animals', app.wildlife, 'visible', 'Show the animals as small dots in their colours where they live (and in the map key).', this, () => this.updateLegend()),
      this.animalList,
      button('+ Add animal', () => this.editAnimal(null), 'tb-add-animal', 'Design a new animal: its name, colour, where it lives, what it eats and its habits.', this),
      button('+ Deer & wolves', async () => { const { addStarterFoodWeb } = await import('../sim/ecology.js'); addStarterFoodWeb(app.world); this.renderAnimals(); this.updateLegend(); }, 'tb-add-animal', 'A starter food web spread over the land: deer that graze and browse young trees, and wolves that hunt them. Cull the wolves (Predator control) and the deer boom and browse the young trees out: the forest stops regenerating (a trophic cascade).', this),
      button('+ Fire followers', async () => { const { addFireFollowers } = await import('../sim/ecology.js'); addFireFollowers(app.world); this.renderAnimals(); this.updateLegend(); }, 'tb-add-animal', 'Animals of recent small burns: fire beetles that home in on the smoke to lay their eggs in the scorched trees, black-backed woodpeckers that follow them, and moths that feed at the fireweed. Between fires they hang on thinly in the forest.', this),
      this.animalForm,
      el('div', 'tb-form-title', 'Tree diseases'),
      el('div', 'tb-note', 'Pathogens that each attack certain native trees, worst on young ones (killing or stunting them). None is here until you introduce one with the Tree disease brush (🦠; Shift cures). Overlay: Tree disease.'),
      (this.diseaseList = el('div', 'tb-animals')),
    );
    this.renderAnimals();
    this.renderDiseases();
    // (starter animals that mods add)
    for (const m of MOD.animals) wild.insertBefore(button(m.label, () => { m.add(app.world); this.renderAnimals(); this.updateLegend(); }, 'tb-add-animal', `${m.help || 'Animals'} (from the mod "${m.mod}").`, this), this.animalForm);
    this.buildMods();
    this.buildDynamics();
    // --- Civilization ------------------------------------------------------------------------
    const civ = this.section('Civilization');
    this.townList = el('div', 'tb-animals');
    this.pathList = el('div', 'tb-animals');
    civ.append(
      toggle('Civilization', app.civParams, 'enabled', 'Towns that grow on the land. Found them with the Settle tool (or the button below): each clears farmland, grows toward what its land can feed, paves its streets (flat, sealed, nothing grows) and pollutes, lightly into water beside it and heavily down every river below it. Roads (Road tool, or built between big neighbouring towns) are terraced through the hills and let towns spread along them. Drought years cut harvests; floods, fires, lava and storm surges cost people; big towns found daughter villages; dwindling towns are abandoned.', this),
      slider('Population increase', app.civParams, 'popRate', 0.2, 4, 0.1, 'How fast the towns\' populations increase toward what their food supports.', this),
      slider('Farmland cap %', app.civParams, 'farmCap', 1, 100, 1, 'The most of the land that may be farmland, all the towns together (100 = no cap). Once the map\'s fields reach it, towns clear no more, and grow only on the food they have (and the sea\'s). Lower it below what\'s farmed now and the fields farthest from their towns are given up, a few at a time, and go back to the wild.', this),
      slider('Max farm slope °', app.civParams, 'farmSlope', 2, 40, 1, 'The steepest ground that can be farmed (degrees). Steeper land has to be cut into flat terraces first (the towns\' earthworks do that); a field that later turns too steep for this is given up.', this),
      slider('Destruction', app.civParams, 'destruction', 0, 10, 0.05, 'How hard the towns are on the land: how much forest they burn off to clear fields, how much pollution their streets, works, farms and sewers put into the rivers and sea, and how much they cut hills into terraces. 0: careful, 1: normal, 10: strip the land bare.', this),
      slider('Plantation plot size', app.civParams, 'plotSize', 20, 2000, 10, 'The largest plot (cells) a town lays out as one plantation, and how far a felling may spread into the forest beside it. Small plots are felled and regrown faster and rotate more often, leaving more wild forest between them; big ones take in whole forests. Plots you paint keep the size you paint them.', this),
      toggle('Invasive plantation pine', app.civParams, 'invasive', 'Plantations are planted with a fast-growing exotic pine that escapes into the wild forest around them (and spreads along the roads): it crowds out the native trees and supports no wildlife. Off: every plantation is replanted with native trees at once and kept weeded of pine; the pine already loose in the wild keeps spreading through the wild forest.', this),
      toggle('Fishing quotas', app.civParams, 'fishingQuotas', 'When a town\'s fishing grounds fall under half of what they could hold, it cuts its catch back hard so the fish can recover, and fishes freely again once they have. Without quotas towns fish on until a stock collapses. Marine reserves (draw an area with No fishing) restock the water round them.', this),
      toggle('Restoration', app.civParams, 'restoration', 'Towns replant native trees on the worn-out, burnt and grazed-out land around them (more when they\'re bigger and wild land near them is scarce), and take down a dam that blocks a fish run.', this),
      toggle('Wildlife crossings', app.civParams, 'wildlifeCrossings', 'Roads kill the land animals crossing them (more on a busier road), splitting their range so a population cut off can dwindle. With this on, towns build crossings (over- or underpasses) where their busy roads cut through animals\' ranges, and the animals cross there safely.', this),
      toggle('Town centres', app.civParams, 'townCores', 'Every town grows a downtown out from its centre, entirely paved (solid streets, squares and buildings, no gaps of green), sprawling over the gentlest ground first to about one cell for every 80 people. Fields and open ground in its way are built over.', this),
      slider('Waterfronts', app.civParams, 'waterfronts', 0, 2, 0.1, 'How hard coastal towns build up their waterfronts: quays paved over the beaches (raised above the tide, a sharp drop-off into dredged deep water), docks out over the water, and dense streets packed in behind. At 0 a town only walls the odd stretch of shore.', this),
      toggle('Fish ladders', app.civParams, 'fishLadders', 'A dam stops a run like salmon reaching its spawning grounds upstream (all but a few). With this on, towns give their dams fish ladders, and most of the run gets past.', this),
      slider('Pesticides', app.civParams, 'pesticides', 0, 1, 0.05, 'How much the farms spray. It saves some of the crop from pests (up to 10% more), but kills the pollinators on the fields and, drifting, around them, and most crops need pollinators (a field gets 70% of its harvest with none). See the Pollinators overlay.', this),
      slider('Predator control', app.civParams, 'predatorControl', 0, 1, 0.05, 'How hard the towns cull the predators (your animals that hunt others) around them, most of all near their livestock. Kill off the predators and the grazers they kept in check boom and browse out the young trees: the forest stops regenerating.', this),
      slider('Herding & fencing', app.civParams, 'herding', 0, 1, 0.05, 'How well the towns guard their livestock (herders, dogs, fences): fewer animals lost to predators, so less food lost and less culling.', this),
      slider('Fire suppression', app.civParams, 'fireSuppression', 0, 1, 0.05, 'How hard the towns fight the wildfires near them. Putting every fire out protects the towns now, but the fuel on the forest floor builds up until a fire gets away as a megafire; letting small fires burn keeps the fuel down. Big fires overwhelm the firefighters.', this),
      toggle('Prescribed burns', app.civParams, 'prescribedBurns', 'In the cool, damp part of the year the towns burn off heavy fuel in their parks and the forest around them, a patch at a time, so the next wildfire there stays on the ground. See it with the Fire fuel overlay.', this),
      toggle('Climate change', app.civParams, 'climateChange', 'The towns give off greenhouse gas (burning, more with more people; industry; wildfires) that slowly warms the climate, about 3 °C for every doubling: snow lines, tree lines and glaciers retreat uphill, species move, the sea warms and slowly rises over the coast. The sea and forests take the gas back up slowly, so the warming lags and outlasts the emissions. Off: the climate settles back. Graphs: Greenhouse gas, Warming.', this),
      slider('Emissions', app.civParams, 'emissions', 0, 5, 0.1, 'How much greenhouse gas the towns give off (1 = usual, 0 = none).', this),
      toggle('Town parks', app.civParams, 'townParks', 'A town of a few hundred people sets aside parks around what is hard to find near it, with a trail out from the town and round each in a loop; where nothing rare is near, it makes none. Each kind has its own rules (all: no timber, fields, new towns or roads; footpaths allowed). Old Growth Reserve (the oldest stands, and more readily at the edge of a timber plantation): also no fires, hunting or earthworks. Grove (a tree under 8% of the map\'s forest, e.g. Fir Grove): also no hunting. Preserve (a biome under 6% of the map\'s land, e.g. Wetland Preserve): no earthworks. Refuge (where an animal lives far more thickly than across the map): no hunting or earthworks. Last Woods (forest where little else is left within 20 cells): no fires or earthworks. Beach (an unbuilt stretch of sand, shingle or basalt beach and the land behind it: Beach, Pebble Beach, Black Beach): no earthworks, so no quays or breakwaters. Commons (only for an old town with next to no wild forest left nearby): a block of its own fields left to go wild, no fires or hunting. Wilderness (towns of 1,500+, once each): a vast tract 36–70 cells across of the remotest wild land, reached by a long trail; no fires or earthworks, hunting allowed. A new park next to an existing one joins it into one larger park with the rules of both. Bigger towns add more parks. Towns also lay Old Forest Trails out to old-growth stands outside the parks; a stand with a trail is more likely to become an Old Growth Reserve later, which takes the trail in. Your own drawn areas never keep a park out. They appear in the Drawings list, where you can change their rules or delete them.', this),
      toggle('National Forests', app.civParams, 'nationalForests', 'Each map gets one or two large National Forests (60–90 cells across) over its most heavily forested stretch, following the forest\'s edge, with a trail through each: no timber is cut inside. Towns, farms and roads can still go there, and towns can make their own parks inside. A young map waits until it has enough forest. Off: no more are made (ones already made stay).', this),
      slider('Park frequency', app.civParams, 'parkRate', 0, 5, 0.1, 'How often towns make parks: 1 is the usual (a town keeps about one park for every 1,500 people, plus one); 2 makes them twice as often and lets a town keep twice as many; 0 stops new parks (and Wilderness Areas). Parks already made stay.', this),
      slider('Park size', app.civParams, 'parkSize', 0.3, 3, 0.1, 'How large the towns make their parks (not Wilderness Areas): 1 is the usual 10–18 cells across, 2 twice that across, 0.5 half. Parks already made keep their size; the outline still stops where the wild land ends.', this),
      toggle('Trails spread disease & pine', app.civParams, 'trailsSpread', 'Hikers on the footpaths (park trails and your own) carry tree diseases and invasive pine seed on their boots, like traffic on the roads: the trees beside a trail catch them far from where they started. Off: only roads carry them.', this),
      toggle('Towns clear invasive pine', app.civParams, 'clearInvasive', 'Towns cut the invasive pine out only where they must: where it presses on their own fields, streets and works,. It costs them people (about one for every 0.4 of a cell of pine cleared), and the cut pine is worthless as timber.', this),
      toggle('Epidemics', app.civParams, 'epidemics', 'Now and then disease breaks out in a crowded town, more readily where its water is dirty; it kills some of its people and spreads along roads and sea routes to the towns it trades with, then burns out, leaving the survivors immune for a while.', this),
      toggle('Extra plantations', app.civParams, 'extraPlantations', 'Towns keep starting new timber plantations even when they already have all they need (normally they stop at about twice their farmland). Every village plants, however small, and the plantations spread on over the forests around.', this),
      toggle('Quarrying', app.civParams, 'quarrying', 'Whether big towns quarry hills and mountains away (one pit per town, well out beyond it) for rock to build their breakwaters and new land. Off: no quarrying (terracing and other earthworks go on).', this),
      slider('Expansion speed', app.civParams, 'growth', 0.2, 10, 0.1, 'How fast civilization spreads: crowded towns founding new villages, and young towns hunting.', this),
      button('🏘 Found a town at the best spot', () => {
        ensureCiv(app.world);
        const site = bestSite(app.world, app.world.N / 2, app.world.N / 2, app.world.N);
        if (site) { foundTown(app.world, site.i); this.renderTowns(); app.world.dirty = true; }
        else this.setInfo('<b>Found a town</b> — there is nowhere suitable left (a liveable climate, fresh water or the coast, farmable flat land, away from other towns).');
      }, '', 'Pick the most suitable place on the whole map to settle (away from existing towns) and found a town there.', this),
      this.townList,
    );
    this.renderTowns();
    civ.append(el('div', 'tb-legend-sub', 'Footpaths'), this.pathList);
    this.renderFootpaths();
    const view = this.section('View', false);
    view.append(
      toggle('Show clouds', app.renderer, 'showClouds', 'Show the clouds that form where moist air is pushed up over terrain.', this),
      toggle('Show town labels', app.renderer, 'showTownLabels', 'Show the names of the towns (with their population and news) over the map. Off: every town label is hidden; the towns themselves carry on.', this),
      toggle('Show park names', app.renderer, 'showParkNames', 'Show the name of each park and National Forest over it (just its name). Off: the names are hidden; the parks are still drawn and still apply.', this),
      toggle('Show trail names', app.renderer, 'showTrailNames', 'Show the names written along the footpaths and park trails. Off: the trails are still drawn, without their names.', this),
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
    this.setGraphsOpen = setOpen; this.graphsOpen = () => open; // (the Window menu opens and closes it)
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
      if (s !== d.current) spotOnHover(row, this.app, () => shapeMask(this.app.world, s));
      let after = null; // (the restrictions panel, shown under the row)
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
        const lim = el('button', 'draw-protect' + (s.limited ? ' on' : ''), '🪓');
        lim.title = s.limited ? 'Limited harvest: plantations inside are small and cut seldom. Click to lift the limit.' : 'Limit the harvest here: no new fields are cleared inside, and timber plantations inside are kept small (a quarter of the plot size) and are cut only when fully grown back, and then left a long while.';
        lim.addEventListener('click', () => { s.limited = !s.limited; d.onChange(); });
        // (and any of the separate restrictions, in a panel under the shape)
        const nOn = RESTRICTIONS.filter((r) => s.restrict && s.restrict[r.key]).length;
        const gear = el('button', 'draw-protect' + (nOn ? ' on' : ''), nOn ? `⚙${nOn}` : '⚙');
        gear.title = 'Restrictions on this area: choose what towns may and may not do inside it.';
        gear.addEventListener('click', () => { s.showRestrict = !s.showRestrict; this.updateDrawList(); });
        row.append(prot, lim, gear);
        if (s.protected) row.classList.add('protected');
        if (s.showRestrict) {
          after = el('div', 'draw-restrict');
          if (!s.restrict) s.restrict = {};
          for (const r of RESTRICTIONS) {
            const lab = el('label', 'draw-restrict-item');
            const cb = el('input');
            cb.type = 'checkbox';
            cb.checked = !!s.restrict[r.key] || (s.protected && ['towns', 'fields', 'timber', 'roads', 'earthworks'].includes(r.key));
            cb.disabled = s.protected && ['towns', 'fields', 'timber', 'roads', 'earthworks'].includes(r.key);
            cb.addEventListener('change', () => { s.restrict[r.key] = cb.checked; d.onChange(); });
            lab.append(cb, el('span', '', `${r.icon} ${r.label}`));
            this.helpOn(lab, `<b>${r.label}</b> — ${r.help}${cb.disabled ? ' (on: this is a protected zone)' : ''}`);
            after.append(lab);
          }
        }
      }
      if (s !== d.current) {
        const del = el('button', '', '✕');
        del.title = 'Delete';
        del.addEventListener('click', () => d.remove(s.id));
        row.append(del);
      }
      L.append(row);
      if (after) L.append(after);
    }
  }

  /** Legend for the current overlay: swatches for categories, a ramp for continuous values. */
  /** The tree diseases in the Wildlife panel: pick one to introduce, see how far each has spread. */
  renderDiseases() {
    const app = this.app, L = this.diseaseList;
    L.innerHTML = '';
    this.diseaseCounts = [];
    for (const d of DISEASES) {
      const row = el('div', 'tb-disease' + ((app.diseaseChoice || 1) === d.id && app.tool === 'disease' ? ' chosen' : ''));
      const sw = el('span', 'tb-swatch');
      sw.style.background = rgb(d.color);
      const name = el('span', 'tb-animal-name', d.label);
      const status = el('span', 'tb-animal-status');
      const intro = button('Introduce', () => { app.diseaseChoice = d.id; app.setTool('disease'); this.renderDiseases(); }, 'tb-small', `Paint ${d.label} into the forest with the Tree disease brush (Shift cures).`, this);
      const cureAll = button('Cure', () => { const D = app.world.treeDisease; if (!D) return; for (let i = 0; i < D.length; i++) if (D[i] === d.id) { D[i] = 0; app.world.diseaseLoad[i] = 0; } app.world.dirty = true; this.updateDiseaseCounts(); }, 'tb-small', `Wipe ${d.label} off the map.`, this);
      row.append(sw, name, status, intro, cureAll);
      this.helpOn(row, `<b>${d.label}</b> — ${d.help} Hosts: ${d.hosts.map((h) => SPECIES.find((s) => s.id === h).label).join(', ')}.`);
      L.append(row);
      this.diseaseCounts.push({ d, status });
    }
    this.updateDiseaseCounts();
    this.renderFires();
  }

  /** The fire history list (Climate → Wildfire): how many fires, and the named ones, newest first. */
  renderFires() {
    const w = this.app.world, L = this.fireList;
    if (!L) return;
    const log = w.fireLog || [];
    const named = log.filter((f) => f.name);
    const key = `${w.fireCount || 0}|${named.map((f) => `${f.id}:${f.cells}:${f.active ? 1 : 0}`).join(',')}`;
    if (key === this.fireKey) return;
    this.fireKey = key;
    L.innerHTML = '';
    const burning = log.filter((f) => f.active).length;
    L.append(el('div', 'tb-note', w.fireCount ? `${w.fireCount} fire${w.fireCount > 1 ? 's' : ''} so far${burning ? `, ${burning} burning now` : ''}; ${named.length} grew big enough (${NAME_AT}+ cells) to be named. Overlay: Historic wildfires.` : 'No fires yet. Every fire is numbered; those that grow big enough are named. Overlay: Historic wildfires.'));
    for (const f of named.slice(-12).reverse()) {
      const row = el('div', 'tb-fire');
      const sw = el('span', 'tb-swatch');
      sw.style.background = rgb(fireColor(w, f.id, [0, 0, 0]));
      row.append(sw, el('span', 'tb-animal-name', `${f.active ? '🔥 ' : ''}${f.name}`), el('span', 'tb-animal-status', `#${f.id} · yr ${f.year} · ${f.cells} cells`));
      row.title = `Fire #${f.id}: started in year ${f.year}${f.active ? ', still burning' : f.endYear ? `, out in year ${f.endYear}` : ''}; ${f.cells} cells burnt.`;
      L.append(row);
    }
  }

  updateDiseaseCounts() {
    const w = this.app.world, D = w.treeDisease;
    const counts = new Array(DISEASES.length + 1).fill(0);
    if (D) for (let i = 0; i < D.length; i++) if (D[i]) counts[D[i]]++;
    for (const { d, status } of this.diseaseCounts || []) {
      const c = counts[d.id], land = Math.max(1, w.N * w.N);
      status.textContent = c ? `${(100 * c / land).toFixed(1)}% of map` : 'not present';
      status.className = 'tb-animal-status' + (c ? ' bad' : '');
    }
  }

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
      spotOnHover(row, app, () => animalMask(app.world, a));
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
  /** The world grid map: the squares around the one you're in. */
  renderGrid() {
    if (!this.gridEl) return;
    const app = this.app, g = app.grid, G = this.gridEl;
    G.innerHTML = '';
    if (!g) { this.gridNote.textContent = 'Loading…'; return; }
    const cx = g.cur.x, cz = g.cur.z, R = 2;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx, z = cz + dz, info = g.cells[`${x},${z}`];
      const here = !dx && !dz, near = Math.abs(dx) + Math.abs(dz) === 1 || (Math.abs(dx) === 1 && Math.abs(dz) === 1);
      const known = info && (info.frozenAt !== undefined || here);
      const b = el('button', 'tb-grid-cell' + (here ? ' here' : '') + (known ? ' known' : '') + (near ? ' near' : ''));
      if (info && info.thumb && !here) b.style.backgroundImage = `url(${info.thumb})`;
      b.title = here ? `Cell ${x}, ${z} (you are here)` : known ? `Cell ${x}, ${z}: travel here${info.towns && info.towns.length ? ` (${info.towns.length} town${info.towns.length > 1 ? 's' : ''})` : ''}` : near ? `Cell ${x}, ${z}: unexplored, travel here to make it` : '';
      b.textContent = here ? '●' : known ? '' : near ? '+' : '';
      b.disabled = here || app.travelling || (!known && !near);
      b.onclick = () => { app.travel(x, z).then(() => this.renderGrid()); this.renderGrid(); };
      G.append(b);
    }
    const explored = Object.entries(g.cells).filter(([k, c]) => c.frozenAt !== undefined && k !== `${cx},${cz}`).length + 1;
    this.gridNote.textContent = app.travelling ? 'Travelling…' : `Cell ${cx}, ${cz} · ${explored} explored`;
  }

  /** The footpaths: rename each (its label on the map follows), or remove it. */
  renderFootpaths() {
    if (!this.pathList) return;
    const w = this.app.world, L = this.pathList;
    L.innerHTML = '';
    const paths = w.footpaths || [];
    if (!paths.length) { L.append(el('div', 'tb-note', 'No footpaths yet: drag with the Footpath tool (🥾) to lay one.')); return; }
    L.append(button('Remove all footpaths', async () => {
      const { markFootpaths } = await import('../sim/civilization.js');
      w.footpaths = [];
      markFootpaths(w);
      this.renderFootpaths();
    }, 'tb-small', 'Remove every footpath on the map (yours and the towns\' park trails). To take out just a stretch, Shift-drag across it with the Footpath tool.', this));
    for (const fp of paths) {
      const row = el('div', 'tb-path-row');
      const name = el('input');
      name.value = fp.name;
      name.maxLength = 40;
      name.oninput = () => { fp.name = name.value || 'Footpath'; };
      const del = button('✕', async () => {
        const { markFootpaths } = await import('../sim/civilization.js');
        w.footpaths = w.footpaths.filter((p) => p !== fp);
        markFootpaths(w);
        this.renderFootpaths();
      }, 'tb-small', `Remove ${fp.name}.`, this);
      row.append(el('span', '', '🥾'), name, del);
      spotOnHover(row, this.app, () => pathMask(w, fp.pts));
      L.append(row);
    }
  }

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
      this.helpOn(row, `<b>${escapeHtml(t.name)}</b> — founded in year ${t.founded}. Population ${Math.round(t.pop)} of the ${Math.round(t.capacity || 0)} its land can feed; ${t.cells || 0} cells of town, ${t.industry || 0} of industry, ${t.farm || 0} of farmland${t.hunted > 0.01 ? '; still hunting much of its food' : ''}${t.boats ? `; a harbour with ${t.boats} fishing boat${t.boats > 1 ? 's' : ''}` : ''}${t.byBoat ? '; settled by boat' : ''}${t.dam >= 0 ? '; has dammed a river for a reservoir' : ''}${t.canals ? `; ${t.canals} irrigation canal${t.canals > 1 ? 's' : ''}` : ''}${t.seaOutfall >= 0 ? '; its sewage piped out to the nearest sea' : ''}${t.timberCells ? `; ${t.timberCells} cells of timber plantation` : ''}${t.invCleared ? `; has cleared ${t.invCleared.toFixed(0)} cells' worth of invasive pine (at a cost of ${Math.round(t.invLost || 0)} people)` : ''}${t.woodNeed ? `; timber: ${Math.round(t.woodStock || 0)} in stock, using ${t.woodNeed.toFixed(1)} a step${t.woodSupply < 1 ? ` (short: only ${Math.round(t.woodSupply * 100)}% of what it needs coming in)` : ''}` : ''}${t.mineCount ? `; ${t.mineCount} mine${t.mineCount > 1 ? 's' : ''}` : ''}${t.sick > 0 ? `; an epidemic: ${Math.round(t.sick * 100)}% sick` : t.outbreaks ? `; ${t.outbreaks} outbreak${t.outbreaks > 1 ? 's' : ''} of disease (last in year ${t.lastOutbreak})` : ''}${Math.abs(t.migrants || 0) > 2 ? `; people ${t.migrants > 0 ? 'moving in' : 'moving away'}` : ''}${t.lastFire ? `; a fire got away from it in year ${t.lastFire}` : ''}${t.smoky ? '; under wildfire smoke, people falling ill' : ''}${t.links && t.links.length ? `; roads to ${t.links.length} town${t.links.length > 1 ? 's' : ''} (${Math.round((t.roadsWorking ?? 1) * 100)}% in working order)` : ''}${t.special ? `; specialises in ${t.special}` : ''}${t.tradePartners ? `; trades with ${t.tradePartners} town${t.tradePartners > 1 ? 's' : ''}${t.tradeFood > 1 ? `, buying in food for about ${Math.round(t.tradeFood)} people` : ''}` : ''}${t.core ? `; a town centre of ${t.core} cells` : ''}. Click for its population chart.`);
      spotOnHover(row, this.app, () => townMask(w, t));
      L.append(row, big);
      this.townGraphs.push({ t, val, spark, big });
    }
  }

  /** Redraw the population graphs (sparklines, and the expanded charts that are open). */
  drawGraphs() {
    const w = this.app.world, hist = w.popHistory || {};
    this.updateDiseaseCounts();
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

  /** Show the open simulation's name in the header. */
  setSimName(name) { if (this.simNameEl) this.simNameEl.textContent = name; }

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
        // (hover: the map shows just this)
        const w = this.app.world;
        if (it.lu) spotOnHover(item, this.app, () => landUseMask(w, it.lu));
        else if (it.biome) spotOnHover(item, this.app, () => biomeMask(w, it.biome, mode !== 'natural' && mode !== 'biome'));
        else if (it.speciesId) spotOnHover(item, this.app, () => speciesMask(w, it.speciesId));
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
    if (MOD.overlays[mode]) {
      const o = MOD.overlays[mode];
      if (o.legend && o.legend.length) items(o.label, o.legend); else this.legendTitle.textContent = o.label;
      L.append(el('div', 'tb-note', `An overlay from the mod "${o.mod}".`));
    }
    else if (mode === 'rock' || (mode === 'natural' && !this.app.renderer.showVegetation)) items('Rock types', ROCKS);
    else if (mode === 'bare') items('Exposed rock (pale = under soil)', [{ label: 'Soil-covered', color: [0.86, 0.84, 0.78], help: 'Bedrock buried under soil deep enough to grow on.' }, ...ROCKS]);
    else if (mode === 'fish') {
      ramp('Fish stocks (share of what the sea can hold)', 'collapsed', 'plentiful', [[0.80, 0.20, 0.15], [0.95, 0.80, 0.30], [0.10, 0.30, 0.65]]);
      L.append(el('div', 'tb-note', 'Fish breed back towards what the sea can feed and drift about; fishing takes them down. Fished below about a fifth, a stock collapses and recovers only slowly. Green hatching: marine reserves (No fishing areas), which restock the water round them.'));
    }
    else if (mode === 'permafrost') {
      items('Permafrost (ground frozen all year)', [
        { label: 'Frozen (deep blue: icier, colder)', color: [0.16, 0.36, 0.72], help: 'Ground frozen all year round, where the mean temperature is below about −3 °C.' },
        { label: 'Frozen, close to thawing', color: [0.62, 0.86, 0.92], help: 'Still frozen, but the mean temperature is within about 1.5 °C of where it starts to thaw: the first to go as the climate warms.' },
        { label: 'Thawing now', color: [0.86, 0.24, 0.16], help: 'The ice in the ground is melting: it slumps, ponds form, and its peat rots, giving off greenhouse gas.' },
        { label: 'Thawed', color: [0.56, 0.40, 0.26], help: 'Ground that was frozen and has thawed.' },
        { label: 'Never frozen', color: [0.78, 0.78, 0.76], help: 'Too warm for permafrost.' },
      ]);
      const w = this.app.world;
      let fz = 0, th = 0; if (w.permafrost) for (let i = 0; i < w.permafrost.length; i++) { if (w.permafrost[i] > 0.05) fz++; if (w.pfThawed && w.pfThawed[i] > 0.05) th++; }
      L.append(el('div', 'tb-note', !this.app.dynParams.permafrost ? 'Permafrost is switched off (Climate events).' : !w.permafrost ? 'Run the simulation to work out where the ground is frozen.' : fz || th ? `${fz.toLocaleString()} cells frozen, ${th.toLocaleString()} thawed so far. Warming (Climate change) thaws it.` : 'Nowhere on this map is cold enough for permafrost.'));
    }
    else if (mode === 'fungi') {
      items('Fungi and root rot', [
        { label: 'Few fungi', color: [0.86, 0.84, 0.78], help: 'Bare ground, fields, towns, young or burnt stands: little fungal life in the soil.' },
        { label: 'Some', color: [0.45, 0.66, 0.40], help: 'Ordinary forest and woodland.' },
        { label: 'Rich fungal life', color: [0.40, 0.22, 0.55], help: 'Old forest of many kinds of trees, above all pine, fir, spruce, oak, beech and birch, whose roots partner with many fungi. Trees grow faster, dead wood rots sooner and the soil builds faster here.' },
        { label: 'Honey mushroom (root rot)', color: [0.95, 0.62, 0.20], help: 'Armillaria in the roots: spreading underground from stand to stand, and now and then by spores far away.' },
        { label: 'Root rot killing the trees', color: [0.80, 0.18, 0.12], help: 'A heavy infection: the stand is dying off, leaving dead wood. Once its hosts are gone the rot dies out and the forest grows back.' },
      ]);
    }
    else if (mode === 'fireFollowers') {
      items('Fire followers', [
        { label: 'Fireweed', color: [0.85, 0.20, 0.62], help: 'Wind-blown seed from fireweed nearby: carpets small burns for a few years until shrubs and trees shade it out.' },
        { label: 'Fire poppies', color: [0.98, 0.58, 0.10], help: 'Seeds wait in the soil for years and sprout only after a fire: a summer or two of flowers, which refill the seed bank.' },
        { label: 'Small burn (fire-follower ground)', color: [0.62, 0.58, 0.54], help: `A burn of up to about ${this.app.ecoParams.smallBurn} cells, recently out.` },
        { label: 'Burn too big for them', color: [0.30, 0.29, 0.29], help: 'The heart of a big burn is out of reach of seed and wings for years, and its hot fire cooked the seeds in the soil.' },
        { label: 'Burning', color: [0.95, 0.35, 0.10] },
      ]);
      L.append(el('div', 'tb-note', 'Fire followers only take to the smaller burns (Wildlife: Small burn size). Fire beetles, woodpeckers and fireweed moths (+ Fire followers) live on them too.'));
    }
    else if (mode === 'pollinators') {
      ramp('Pollinators (bees and the like)', 'none', 'plenty', [[0.55, 0.55, 0.57], [1.0, 0.80, 0.15]]);
      L.append(el('div', 'tb-note', 'They live in meadows, scrub, old fields and forest edges and forage a few cells out; few in deep forest, none in towns. Pesticides kill them on the fields and around them. A field yields 70% with none reaching it and 100% with plenty. Farmland is hatched brown.'));
    }
    else if (mode === 'fuel') {
      ramp('Fuel on the forest floor', 'light (surface fires)', 'heavy (crown fires)', [[0.35, 0.65, 0.35], [0.95, 0.80, 0.25], [0.80, 0.15, 0.10]]);
      L.append(el('div', 'tb-note', 'Dead wood, litter and undergrowth build up where nothing burns. A fire through light fuel stays on the ground and the trees live; through heavy fuel it climbs into the crowns, runs fast and kills the stand. Blue hatching: where the towns fight fires (Fire suppression).'));
    }
    else if (mode === 'carbon') {
      ramp('Carbon in the trees and soil (tonnes a cell)', 'none', '6+', [[0.90, 0.88, 0.80], [0.55, 0.70, 0.35], [0.05, 0.22, 0.12]]);
      const t = this.app.world.carbonTotal;
      L.append(el('div', 'tb-note', `Old, dense forest holds the most, in its wood and the soil built up beneath it. Felling, clearing and fire release it as greenhouse gas; regrowing forest takes it back up.${t ? ` The land holds about ${Math.round(t).toLocaleString()} tonnes.` : ''}`));
    }
    else if (mode === 'groundwater') {
      ramp('Groundwater (how full the ground is)', 'dry', 'full', [[0.86, 0.76, 0.55], [0.55, 0.72, 0.80], [0.10, 0.28, 0.62]]);
      L.append(el('div', 'tb-note', 'Water stored in the ground beneath the soil. Rain refills it, it seeps towards lower ground and out into springs and streams in the valleys, and towns pump it from wells.'));
    }
    else if (mode === 'gwChange') {
      ramp('Groundwater drawn down by pumping', 'as it would be', 'pumped dry', [[0.84, 0.86, 0.88], [0.80, 0.15, 0.12]]);
      L.append(el('div', 'tb-note', 'How far the towns\' wells have drawn the water table below where the rain would keep it: a cone around each town. Dark red-brown where the ground has sunk (subsidence) from being pumped nearly dry.'));
    }
    else if (mode === 'population') {
      ramp('People per cell (where the towns\' people live)', 'a few', '60+', [[0.25, 0.10, 0.45], [0.80, 0.15, 0.25], [0.98, 0.55, 0.10], [1.0, 0.95, 0.60]]);
      const total = Math.round(this.app.world.civPop || 0);
      L.append(el('div', 'tb-note', `Each town's people spread over the land it owns: most in its streets, some in its works, a few out on its farms and plantations. Log scale, so a village shows as well as a city. ${total ? `${total.toLocaleString()} people on the map.` : 'No towns yet.'}`));
    }
    else if (mode === 'onebiome') {
      // Pick the biome to show; its share of the land below
      this.legendTitle.textContent = 'Single biome';
      L.className = 'tb-onebiome';
      const r = this.app.renderer;
      const sel = el('select', 'tb-select');
      for (const [id, b] of Object.entries(BIOMES)) {
        const o = el('option', '', b.label);
        o.value = id;
        if (id === r.singleBiome) o.selected = true;
        sel.append(o);
      }
      const info = el('div', 'tb-note', '');
      const show = async () => {
        const b = BIOMES[r.singleBiome];
        const { biomeShares } = await import('./biomeChart.js');
        const { shares, snow } = biomeShares(this.app.world, r.singleBiome !== 'snow');
        const s = r.singleBiome === 'snow' ? snow : (shares.find((x) => x.id === r.singleBiome) || { share: 0 }).share;
        info.textContent = `${b.help || ''} Covers ${s * 100 < 0.1 && s > 0 ? '<0.1' : (s * 100).toFixed(1)}% of the land now.`;
      };
      sel.addEventListener('change', () => { r.singleBiome = sel.value; this.app.world.dirty = true; r.update?.(true); show(); });
      const sw = el('div', 'tb-legend-item');
      const dot = el('span', 'tb-swatch');
      dot.style.background = rgb(BIOMES[r.singleBiome]?.color || [0.5, 0.5, 0.5]);
      sel.addEventListener('change', () => { dot.style.background = rgb(BIOMES[sel.value].color); });
      sw.append(dot, sel);
      const other = el('div', 'tb-legend-item');
      const os = el('span', 'tb-swatch');
      const greyFor = (c) => (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] > 0.55 ? [0.26, 0.27, 0.30] : [0.86, 0.86, 0.88]);
      os.style.background = rgb(greyFor(BIOMES[r.singleBiome]?.color || [0.5, 0.5, 0.5]));
      sel.addEventListener('change', () => { os.style.background = rgb(greyFor(BIOMES[sel.value].color)); });
      other.append(os, el('span', '', 'Everything else'));
      L.append(sw, other, info);
      show();
    }
    else if (mode === 'natural' || mode === 'biome') {
      items(mode === 'biome' ? 'Biomes' : 'Biomes (blended)', Object.entries(BIOMES).map(([id, b]) => ({ ...b, biome: id })));
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
    else if (mode === 'invasive') ramp('Invasive pine (share of the trees)', 'native forest', 'all pine', [[0.30, 0.62, 0.30], [0.66, 0.16, 0.38]]);
    else if (mode === 'fires') items('Historic wildfires (the last fire to burn each place)', [{ label: 'Burning now', color: [1.0, 0.35, 0.08], help: 'A fire still going.' }, { label: 'Small fire', color: [0.66, 0.58, 0.50], help: `A fire that burnt fewer than ${NAME_AT} cells: numbered, not named.` }, ...(this.app.world.fireLog || []).filter((f) => f.name).slice(-10).reverse().map((f) => ({ label: `${f.name} (#${f.id}, year ${f.year})`, color: fireColor(this.app.world, f.id, [0, 0, 0]), help: `${f.cells} cells burnt.` })), { label: 'Never burnt', color: [0.78, 0.81, 0.74], help: 'No fire on record here.' }]);
    else if (mode === 'disease') items('Tree diseases (stronger colour = heavier infection)', [{ label: 'Healthy forest', color: [0.55, 0.70, 0.52], help: 'Forest with no disease.' }, ...DISEASES, { label: 'Road carrying spores', color: [0.62, 0.58, 0.48], help: 'A road whose traffic carries a disease (tinted in its colour): the host trees beside it catch it.' }]);
    else if (mode === 'air') ramp('Air pollution (town smoke, acid rain, wildfire smoke)', 'clean', 'thick smoke', [[0.86, 0.90, 0.92], [0.35, 0.28, 0.22]]);
    else if (mode === 'landuse') items('Land use', [
      { lu: 1, label: 'Fields', color: [0.95, 0.80, 0.30], help: 'Farmland (greener where irrigated).' },
      { lu: 10, label: 'Timber plantation', color: [0.09, 0.48, 0.20], help: 'Outlined in dark green; brown-green where it has just been felled and is regrowing.' },
      { label: 'Plantation resting', color: [0.40, 0.70, 0.43], help: 'A painted plantation the town has stopped working while its worn soil recovers; it takes it up again once the soil is good.' },
      { label: 'Town centre', color: [0.55, 0.10, 0.12], help: 'Downtown: entirely paved, sprawling out from the town\'s centre as it grows.' },
      { lu: 2, label: 'Town', color: [0.86, 0.28, 0.22], help: 'Streets and houses.' },
      { lu: 4, label: 'Industry', color: [0.58, 0.36, 0.74], help: 'Mass-paved industrial areas.' },
      { lu: 3, label: 'Road', color: [0.30, 0.30, 0.34], help: 'Roads and bridges.' },
      { lu: 5, label: 'Harbour', color: [0.98, 0.55, 0.15], help: 'Harbours.' },
      { lu: 13, label: 'Dock', color: [0.55, 0.42, 0.30], help: 'Docks: paved piers built out over the water from the quays.' },
      { lu: 6, label: 'Quay / breakwater', color: [0.70, 0.70, 0.72], help: 'Sea walls and breakwaters.' },
      { lu: 7, label: 'Dam', color: [0.95, 0.95, 0.95], help: 'Dams.' },
      { lu: 8, label: 'Canal', color: [0.25, 0.80, 0.90], help: 'Irrigation canals.' },
      { lu: 11, label: 'Mine', color: [0.30, 0.27, 0.25], help: 'Open-pit mines.' },
      { lu: 12, label: 'Spoil heap', color: [0.85, 0.50, 0.20], help: 'Waste rock from the mines: poisonous ground.' },
      { label: 'Wild land', color: [0.62, 0.70, 0.56], help: 'Not used by any town (paler where bare). This view leaves out pollution, murky water, clouds and fog.' },
    ]);
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
    else if (mode === 'species') items('Dominant tree species', [...SPECIES.map((s) => ({ ...s, speciesId: s.id })), OPEN].map((s) => ({ ...s, color: s.mapColor })));
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
      group.title = g;
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

  /** Settings for the world's dynamics (sim/dynamics.js), each on its topic's tab. */
  buildDynamics() {
    const app = this.app, D = app.dynParams;
    const land = this.section('Land events');
    land.append(
      toggle('River floods', D, 'floods', 'In storms and wet spells, floods now and then come down the rivers for some days, spilling over the banks onto the low ground beside them.', this),
      slider('Flood frequency', D, 'floodRate', 0, 3, 0.1, 'How often floods come.', this),
      toggle('Town levees', D, 'levees', 'Towns of 600 or more wall their river banks with levees, which keep ordinary floods out; a big flood can overtop a levee and breach it, flooding the town behind.', this),
      toggle('Meandering rivers', D, 'meanders', 'Where a river crosses flat ground the current cuts into the outside of each bend and builds up the inside: the bends grow and walk across the valley floor, and in time loops are cut off as oxbow lakes.', this),
      toggle('Debris flows', D, 'debrisFlows', 'Heavy rain on a fresh burn scar sends mud, ash and rock pouring down the slopes and gullies, burying what\'s below and damming streams.', this),
      toggle('Starved beaches', D, 'starvedBeaches', 'Dams trap the sand their rivers would bring to the coast, and sea walls and docks cut off the shore\'s sand: the beaches near them shrink and the coast behind erodes.', this),
    );
    const clim = this.section('Climate events');
    clim.append(
      toggle('Drought cycles', app.seasonParams, 'droughtCycles', 'Dry and wet runs of years come and go over a cycle of 6–12 years (like El Niño): droughts several years running, then a run of mild, wet years. (Needs Seasons.)', this),
      toggle('Earthquakes', D, 'earthquakes', 'Now and then a fault slips: landslides on the steep slopes near it, towns damaged, the ground along the rupture lifted. An undersea quake sends a tsunami flooding the coasts nearby.', this),
      slider('Earthquake frequency', D, 'quakeRate', 0, 5, 0.1, 'How often earthquakes come.', this),
      toggle('Permafrost', D, 'permafrost', 'Ground frozen all year where it\'s cold enough. As the climate warms it thaws: the ground slumps, ponds form, and its rotting peat gives off greenhouse gas.', this),
      toggle('Bark beetle outbreaks', D, 'barkBeetles', 'Native bark beetles erupt in drought years and after mild winters, killing stands of stressed conifers, then crash after a few years or in a hard winter.', this),
    );
    const eco = this.section('Ecosystem changes');
    eco.append(
      toggle('Wetland drainage', D, 'wetlandDrainage', 'Towns ditch and drain the wetlands near them for farmland: the ground dries, its peat rots and the ground sinks, and dry peat that catches fire smoulders underground for months.', this),
      toggle('Rewet wetlands', D, 'rewetWetlands', 'Towns block the drainage ditches again: drained wetlands slowly fill back up.', this),
      toggle('Seed dispersal', D, 'seedDispersal', 'Tree species spread from where they grow: light wind-blown seeds fast, heavy ones (acorns, beech nuts) slowly, and now and then a bird carries one far. A species grows only where its seeds have reached, so forest comes back from its edges after a big fire.', this),
      toggle('Invasive animals', D, 'invasiveAnimals', 'Feral pigs escape from the farms (rooting up the soil and seedlings), feral goats are let loose by the harbours (stripping the young trees off the hills), and ship rats come ashore and eat the small animals\' eggs and young.', this),
      toggle('Crop pests', D, 'cropPests', 'Pests and blights break out in the farmland, worst in big blocks of one crop, and spread field to field; infested fields yield less. Hedgerows and wild ground among the fields help hold them back.', this),
      toggle('Crop rotation', D, 'cropRotation', 'Towns rotate their crops: pests spread less and die out sooner.', this),
    );
    const town = this.section('Town life');
    town.append(
      toggle('Trade', D, 'trade', 'Towns joined by working roads, or both with harbours, trade. Each specialises in what its land is good for, and food sold between them lets a trading town grow past what its own land feeds.', this),
      toggle('Urban heat & smog', D, 'urbanHeat', 'Towns are warmer than the country round them (up to about 2.5 °C in a big centre), and on still days their smoke builds up as smog, sickening people and plants.', this),
      toggle('Salt in irrigated fields', D, 'salinisation', 'In dry, hot country, irrigation water evaporates off the fields and leaves salt behind: yields fall, and once too salty the field is abandoned under a white crust.', this),
      toggle('Ruins', D, 'ruins', 'Abandoned towns leave ruins that crumble slowly over decades while the forest grows up through them; old roads stay visible as tracks.', this),
    );
  }

  /** The Mods tab: the installed mods (switch on or off, remove, add) and the settings they add. */
  buildMods() {
    const body = this.section('Mods');
    body.append(el('div', 'tb-note', 'Mods are JavaScript files that add to the simulation: tree species, tools, overlays, settings and rules of their own. They run with the app\'s full access, so only add mods you trust. Changes take effect when the page reloads.'));
    this.modList = el('div', 'tb-animals');
    body.append(this.modList);
    const file = button('+ Add mod file…', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.js,.mjs,text/javascript';
      input.onchange = async () => { const f = input.files[0]; if (!f) return; await addMod(f.name, await f.text()); this.renderMods(true); };
      input.click();
    }, 'tb-add-animal', 'Add a mod from a .js file on your computer.', this);
    const url = button('+ Add from URL…', async () => {
      const u = prompt('The address of the mod (.js file):');
      if (!u) return;
      try { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); await addMod(decodeURIComponent(u.split('/').pop() || 'Mod'), await r.text()); this.renderMods(true); }
      catch (err) { this.setInfo(`<b>Mods</b> — couldn't fetch that mod: ${escapeHtml(err.message)}`); }
    }, 'tb-add-animal', 'Add a mod from a web address (it must allow loading from other sites).', this);
    const guide = button('📖 Modding guide', () => window.open(`docs.html?doc=docs/MODDING.md`, '_blank'), 'tb-add-animal', 'How to write a mod: the mod API and an example.', this);
    body.append(file, url, guide);
    if (MOD.settings.length) {
      body.append(el('div', 'tb-form-title', 'Mod settings'));
      for (const s of MOD.settings) {
        const help = `${s.help || s.label} (from the mod "${s.mod}")`;
        const ctl = typeof s.obj.value === 'boolean' ? toggle(s.label, s.obj, 'value', help, this, () => s.save()) : slider(s.label, s.obj, 'value', s.min, s.max, s.step, help, this, () => s.save());
        body.append(ctl);
      }
    }
    this.renderMods(false);
  }

  async renderMods(changed) {
    const L = this.modList;
    if (!L) return;
    const list = await listMods();
    L.textContent = '';
    if (!list.length) L.append(el('div', 'tb-note', 'No mods yet.'));
    for (const m of list) {
      const row = el('div', 'tb-animal');
      const on = document.createElement('input');
      on.type = 'checkbox'; on.checked = !!m.enabled;
      on.onchange = async () => { await setModEnabled(m.id, on.checked); this.renderMods(true); };
      const loaded = MOD.loaded.some((x) => x.id === m.id);
      const name = el('span', 'tb-animal-name', m.name);
      const state = el('span', 'tb-dim', m.error ? `error: ${m.error}` : m.enabled ? (loaded ? 'on' : 'on after reload') : 'off');
      if (m.error) state.style.color = '#ff8a7a';
      const rm = button('✕', async () => { if (confirm(`Remove the mod "${m.name}"?`)) { await removeMod(m.id); this.renderMods(true); } }, 'tb-small', 'Remove this mod.', this);
      row.append(on, name, state, rm);
      L.append(row);
    }
    if (changed) {
      const r = button('Reload to apply', async () => { await app_autosave(this.app); location.reload(); }, 'tb-add-animal', 'Save and reload the page so mod changes take effect.', this);
      L.append(r);
    }
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

  setSaveStatus(text) { if (this.saveStatusEl) this.saveStatusEl.textContent = text; this.app.menubar?.setSave(text); }

  /** Sync all controls and highlight the active tool. Called after state changes from code. */
  refresh() {
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === this.app.tool);
    this.app.menubar?.refresh();
    document.querySelectorAll('[data-sync]').forEach((n) => n.sync());
    if (this.animalList) this.renderAnimals();
    // (after loading a level: rebuild the probe tabs if the probes are different)
    const pk = (this.app.world.probes || []).map((p) => p.id).join(',');
    if (pk !== this.probeKey) { this.probeKey = pk; this.renderGraphTabs(); }
    this.erosionControls.classList.toggle('tb-disabled', !this.app.world.erosionEnabled);
    this.erosionTools.classList.toggle('tb-disabled', !this.app.world.erosionEnabled);
    this.setInfo(this.defaultInfo());
  }

  setStats(html) { this.app.menubar?.setStats(html); }
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
    ctx.strokeStyle = visibleOnDark(s.color); ctx.lineWidth = s.width; ctx.setLineDash(s.dashed ? [3, 3] : []);
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
      ctx.fillStyle = visibleOnDark(s.color);
      ctx.fillRect(pad.l, y - 6, 10, k ? 1.5 : 2.5);
      const lastV = [...s.data].reverse().find((v) => v !== null);
      ctx.fillText(`${s.label}: ${lastV !== undefined ? fmt(lastV) : '—'}${k ? ' (own scale)' : ''}`, pad.l + 14, y - 2);
      y += 13;
    });
  }
}

/**
 * A colour that shows on the dark graph panels: colours darker than about 55% lightness (a
 * black-backed woodpecker, a near-black beetle) are lifted towards white just enough to be seen,
 * keeping their hue.
 */
export function visibleOnDark(css) {
  let c = null;
  const m = /rgba?\(([^)]+)\)/.exec(css || '');
  if (m) c = m[1].split(',').slice(0, 3).map((v) => parseFloat(v) / 255);
  else if (/^#[0-9a-f]{6}$/i.test(css || '')) c = [1, 3, 5].map((k) => parseInt(css.slice(k, k + 2), 16) / 255);
  if (!c) return css;
  const lum = (q) => 0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2];
  const MIN = 0.55;
  if (lum(c) >= MIN) return css;
  // (mix with white until it's light enough)
  let lo = 0, hi = 1;
  for (let k = 0; k < 12; k++) { const t = (lo + hi) / 2; lum(c.map((v) => v + (1 - v) * t)) < MIN ? (lo = t) : (hi = t); }
  const out = c.map((v) => Math.round((v + (1 - v) * hi) * 255));
  return `rgb(${out.join(',')})`;
}

function fmtPop(v) { return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 10 ? Math.round(v).toString() : v.toFixed(1); }
