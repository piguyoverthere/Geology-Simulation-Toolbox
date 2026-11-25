// An example mod for the Geology Simulation Toolbox: add it from the Mods tab (🧩) with
// "+ Add mod file…", then reload. See docs/MODDING.md for the whole mod API.
//
// It adds a tree species (the baobab), a tool (seed bombs), an overlay (altitude bands), a setting
// with a rule of its own (dry lightning that starts fires), and a starter animal (elephants).

export default function (api) {
  // --- A tree species: the baobab of hot, dry savanna ---
  api.addSpecies({
    id: 'baobab', label: 'Baobab', height: 25,
    color: [0.48, 0.47, 0.28], mapColor: [0.95, 0.75, 0.30],
    temp: [20, 40], moist: [0.1, 0.5], age: 0.8, ageW: 0.6,
    soil: 'any', flam: 0.4, fireproof: 0.6, autumn: [0.70, 0.62, 0.30],
    help: 'Squat, enormous-trunked tree of hot, dry savanna: it stores water in its trunk through the dry season, and its thick bark survives grass fires.',
  });

  // --- A tool: seed bombs, which green up bare ground where you paint ---
  api.addTool('seedBomb', {
    label: 'Seed bomb', icon: '🌱', group: 'Mods',
    help: 'Throw seed bombs: bare ground under the brush greens up with grass and shrubs (where anything can grow). Hold Shift to scorch it bare instead.',
    apply({ world, x, z, radius, strength, dt, invert }) {
      const N = world.N, V = world.vegetation, k = Math.min(1, strength * 2 * dt);
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const cx = Math.round(x + dx), cz = Math.round(z + dz);
        if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
        const i = cz * N + cx;
        if (world.height[i] < world.meanSea) continue;
        V[i] = invert ? Math.max(0, V[i] - k) : Math.min(0.6, V[i] + k * 0.5);
      }
      world.dirty = true;
    },
  });

  // --- An overlay: the land coloured in bands of height above the sea ---
  const bands = [[0.20, 0.55, 0.30], [0.55, 0.70, 0.35], [0.85, 0.75, 0.40], [0.70, 0.50, 0.35], [0.95, 0.95, 0.95]];
  api.addOverlay('altitude', 'Altitude bands', (world, i) => {
    const h = world.height[i] - (world.meanSea > -999 ? world.meanSea : 0);
    if (h < 0) return [0.20, 0.35, 0.60];
    return bands[Math.min(bands.length - 1, Math.floor(h / 15))];
  }, [
    { label: 'Sea', color: [0.20, 0.35, 0.60] },
    { label: '0–15 above the sea', color: bands[0] },
    { label: '15–30', color: bands[1] },
    { label: '30–45', color: bands[2] },
    { label: '45–60', color: bands[3] },
    { label: 'Over 60', color: bands[4] },
  ]);

  // --- A setting and a rule: dry lightning that starts fires in dry, wooded country ---
  const lightning = api.addSetting({ key: 'dryLightning', label: 'Dry lightning', min: 0, max: 1, step: 0.05, value: 0, help: 'How often dry thunderstorms (lightning with no rain) start fires in dry woodland and forest.' });
  api.onStep((world) => {
    if (lightning.value <= 0 || Math.random() > lightning.value * 0.2) return;
    const N = world.N, i = Math.floor(Math.random() * N * N);
    const dry = world.soil ? world.soil[i] < 0.4 : true;
    if (world.vegetation[i] > 0.5 && dry && world.fire[i] <= 0 && world.water[i] < 0.05) {
      world.fire[i] = 0.6;
      world.fireCells.push(i);
    }
  }, 30);

  // --- Starter animals: elephants that browse young trees and keep savanna open ---
  api.addStarterAnimals('+ Elephants', (world) => {
    api.ensureEcology(world);
    const e = api.newAnimal({ name: 'Elephant', color: [0.55, 0.53, 0.50], habitat: 'land', eats: { grass: true, young: true }, breed: 0.5, roam: 8, tempMin: 12, tempMax: 40 });
    world.animals.push(e);
    const P = api.animalField(world, e);
    for (let i = 0; i < world.N * world.N; i++) if (api.canLive(world, e, i) && world.vegetation[i] > 0.2) P[i] = 0.15;
  }, 'Elephants: big browsers of warm country that knock over young trees and hold savanna open');

  api.log('loaded');
}
