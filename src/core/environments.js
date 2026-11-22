// Environment presets: ready-made settings for different climates, applied to the current map
// without regenerating it (the terrain presets build a landscape; these change its climate).
// Each sets the climate, seasons, weather, ocean and wetness in one go; any slider can still be
// adjusted afterwards.

export const ENVIRONMENTS = {
  pnw: {
    label: 'Pacific Northwest coast',
    help: 'Seattle and the Puget Sound: mild and maritime, cool wet winters with endless storms and mountain snow, dry summers with marine fog, big tides.',
    climate: { seaTemp: 11, lapse: 0.4, windAngle: 0, summerDry: 0.8, storms: 1.2, snowstorms: 1.2, oceanFog: 1 },
    seasons: { enabled: true, swing: 11 },
    weather: { lightning: 0.3 }, coast: { tideRange: 3.5 }, wetness: 1.2, evaporate: 0.02,
  },
  pugetsound: {
    label: 'Puget Sound',
    help: 'The Sound itself: an inland sea with big tides (3–4 m), cool water (~11 °C) that keeps the shores mild, summer marine fog, long grey drizzly winters, snow in the lowlands only a time or two a year, almost no lightning. Turns the sea on (flooding the lowest ground if it was off).',
    climate: { seaTemp: 11, lapse: 0.4, windAngle: 0, summerDry: 0.8, storms: 1.2, snowstorms: 0.8, oceanFog: 1 },
    seasons: { enabled: true, swing: 10 },
    weather: { lightning: 0.15 }, coast: { tideRange: 3.5, waveErosion: 0.005, coral: 0 }, wetness: 1.2, evaporate: 0.02,
    sea: true,
  },
  inland: {
    label: 'Inland Northwest',
    help: 'Eastern Washington: the Cascades\' rain shadow. Continental, with cold snowy winters, hot dry summers, thunderstorms and wildfire.',
    climate: { seaTemp: 10, lapse: 0.4, windAngle: 0, summerDry: 0.7, storms: 0.5, snowstorms: 0.6, oceanFog: 0 },
    seasons: { enabled: true, swing: 15 },
    weather: { lightning: 1.5 }, coast: { tideRange: 1 }, wetness: 0.45, evaporate: 0.04,
  },
  alpine: {
    label: 'Alpine',
    help: 'High mountains like the Cascade crest or the Alps: cold, very snowy, glaciers on the peaks, a short summer.',
    climate: { seaTemp: 6, lapse: 0.5, windAngle: 0, summerDry: 0.3, storms: 1.2, snowstorms: 1.8, oceanFog: 0.2 },
    seasons: { enabled: true, swing: 11 },
    weather: { lightning: 0.6 }, coast: { tideRange: 1.5 }, wetness: 1.2, evaporate: 0.02,
  },
  mediterranean: {
    label: 'Mediterranean',
    help: 'California or the Mediterranean: warm, with rainy winters and long, dry, fire-prone summers; coastal fog.',
    climate: { seaTemp: 17, lapse: 0.4, windAngle: 0, summerDry: 1, storms: 0.7, snowstorms: 0.4, oceanFog: 0.8 },
    seasons: { enabled: true, swing: 8 },
    weather: { lightning: 0.8 }, coast: { tideRange: 1.5 }, wetness: 0.7, evaporate: 0.04,
  },
  tropical: {
    label: 'Tropical rainforest',
    help: 'Hot and wet all year: almost no seasons, daily thunderstorms, jungle, and coral reefs off the coast.',
    climate: { seaTemp: 27, lapse: 0.4, windAngle: 20, summerDry: 0, storms: 2, snowstorms: 0, oceanFog: 0.1 },
    seasons: { enabled: true, swing: 2 },
    weather: { lightning: 2.5 }, coast: { tideRange: 1.2, coral: 2 }, wetness: 1.5, evaporate: 0.05,
  },
  desert: {
    label: 'Desert',
    help: 'Hot and dry: rare storms, fierce evaporation, bare rock and sand, flash floods when it does rain.',
    climate: { seaTemp: 24, lapse: 0.4, windAngle: 20, summerDry: 0.2, storms: 0.3, snowstorms: 0.1, oceanFog: 0.2 },
    seasons: { enabled: true, swing: 12 },
    weather: { lightning: 1 }, coast: { tideRange: 1 }, wetness: 0.15, evaporate: 0.08,
  },
  boreal: {
    label: 'Boreal / subarctic',
    help: 'Interior Alaska or Siberia: long, deep-freeze winters, short warm summers, spruce and larch taiga, summer lightning fires.',
    climate: { seaTemp: 1, lapse: 0.4, windAngle: 20, summerDry: 0.2, storms: 0.8, snowstorms: 1, oceanFog: 0.3 },
    seasons: { enabled: true, swing: 18 },
    weather: { lightning: 0.8 }, coast: { tideRange: 1 }, wetness: 0.8, evaporate: 0.015,
  },
  arctic: {
    label: 'Arctic',
    help: 'Polar: frozen most of the year, tundra and rock, sea ice, glaciers down to the sea.',
    climate: { seaTemp: -10, lapse: 0.4, windAngle: 20, summerDry: 0, storms: 0.6, snowstorms: 1, oceanFog: 0.4 },
    seasons: { enabled: true, swing: 14 },
    weather: { lightning: 0 }, coast: { tideRange: 1 }, wetness: 0.5, evaporate: 0.01,
  },
};

/** Apply an environment's settings to the running app (doesn't touch the terrain). */
export function applyEnvironment(app, id) {
  const e = ENVIRONMENTS[id];
  if (!e) return;
  Object.assign(app.climateParams, e.climate || {});
  Object.assign(app.seasonParams, e.seasons || {});
  Object.assign(app.weatherParams, e.weather || {});
  Object.assign(app.coastParams, e.coast || {});
  if (e.wetness !== undefined) app.vegetationParams.climate = e.wetness;
  if (e.evaporate !== undefined) app.waterParams.evaporate = e.evaporate;
  if (e.sea && !app.sim.seaEnabled) {
    // Turn the sea on: at the Puget Sound terrain's sea level, or flooding the lowest quarter of the map
    const H = app.world.height, sample = [];
    for (let k = 0; k < 4096; k++) sample.push(H[(k * 2654435761) % H.length >>> 0]);
    sample.sort((a, b) => a - b);
    app.sim.seaEnabled = true;
    app.sim.seaLevel = Math.round(Math.max(3, sample[Math.floor(sample.length * 0.25)]) * 2) / 2;
    app.applySea();
  }
  app.climateChanged();
  app.toolbox.refresh();
}
