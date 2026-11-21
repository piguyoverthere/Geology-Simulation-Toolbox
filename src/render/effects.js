// Event visuals: eruption plumes (ash clouds or lava fountains) with a glow light at the vent,
// fault traces drawn on the ground, and earthquake camera shake.

import * as THREE from 'three';
import { intensityAt } from '../sim/weather.js';

const MAX_PARTICLES = 600;

let dot = null;
/** A soft round sprite (white, fading to transparent at the edge) so particles look like puffs, not squares. */
function hash(v) { const s = Math.sin(v * 12.9898) * 43758.5453; return s - Math.floor(s); }
/** A repeatable random point inside a disc of radius r. */
function disc(seed, r) {
  const a = hash(seed) * Math.PI * 2, d = Math.sqrt(hash(seed + 0.37)) * r;
  return [Math.cos(a) * d, Math.sin(a) * d];
}
function clampCell(v, N) { return Math.min(N - 1, Math.max(0, Math.round(v))); }

function softDot() {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dot = new THREE.CanvasTexture(c);
  return dot;
}

export class Effects {
  /** @param {THREE.Scene} scene  @param {import('../core/world.js').World} world  @param {object} renderer TerrainRenderer */
  constructor(scene, world, renderer) {
    this.scene = scene;
    this.world = world;
    this.renderer = renderer;
    this.plumes = new Map();     // eruption event → plume
    this.faultGroup = new THREE.Group();
    scene.add(this.faultGroup);
    this.faultCount = -1;
    this.frame = 0;
    this.shake = new THREE.Vector3();
    this.smoke = this.makeSmoke();
    this.flowCloud = this.makeFlowCloud(0x8f857a);
    this.dustCloud = this.makeFlowCloud(0x9a7f60); // landslide debris dust
    this.clouds = this.makeClouds();
    this.fog = this.makeLayer(1200, 0xe6eaee, 10, 0.22);   // valley fog: low, flat, faint
    this.cirrus = this.makeLayer(500, 0xffffff, 40, 0.12); // high, thin wisps above everything
    this.stormCloud = this.makeLayer(3000, 0x7d858f, 34, 0.3); // dark storm cloud decks
    this.rain = this.makeLayer(6000, 0xa9c0da, 0.7, 0.55);       // falling rain
    this.snowfall = this.makeLayer(6000, 0xffffff, 1.1, 0.9);    // falling snow
    this.thunderCloud = this.makeLayer(1200, 0x575d66, 28, 0.32);
    this.snowCloud = this.makeLayer(4000, 0xdde3ea, 32, 0.38); // pale, soft snowstorm clouds // towering dark thunderheads
    this.time = 0;
    // Lightning bolts: jagged line segments, plus a flash of light
    const BOLTS = 12, SEG = 14;
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLTS * SEG * 2 * 3), 3));
    bgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.bolts = new THREE.LineSegments(bgeo, new THREE.LineBasicMaterial({ color: 0xf2f4ff, transparent: true, opacity: 0.95 }));
    this.bolts.frustumCulled = false;
    this.boltCap = { BOLTS, SEG };
    scene.add(this.bolts);
    this.flash = new THREE.PointLight(0xdfe6ff, 0, 160, 1.2);
    scene.add(this.flash);
  }

  /** Lightning: a jagged bolt from the cloud base to the ground for a moment, and a flash. */
  updateLightning(dt) {
    const w = this.world, strikes = w.strikes || [];
    // Bolts flash in real time (also while paused), then are forgotten
    for (let k = strikes.length - 1; k >= 0; k--) if ((strikes[k].age += dt) > 1) strikes.splice(k, 1);
    const { BOLTS, SEG } = this.boltCap;
    const pos = this.bolts.geometry.attributes.position;
    let k = 0, flash = 0;
    for (const st of strikes) {
      if (st.age > 0.6 || k >= BOLTS) continue;
      // Flickers: on, off, on again
      if (st.age > 0.2 && st.age < 0.32) continue;
      const i = st.z * w.N + st.x;
      const ground = w.height[i], top = Math.max(st.top, ground + 6);
      let px = st.x, pz = st.z, py = top;
      for (let s = 0; s < SEG; s++) {
        const t = (s + 1) / SEG;
        const nx = s === SEG - 1 ? st.x : st.x + (hash(st.seed + s * 3.1) - 0.5) * 3 * (1 - t);
        const nz = s === SEG - 1 ? st.z : st.z + (hash(st.seed + s * 7.7) - 0.5) * 3 * (1 - t);
        const ny = top + (ground - top) * t;
        const a = this.renderer.toWorld(px, pz, py), b = this.renderer.toWorld(nx, nz, ny);
        const o = (k * SEG + s) * 6;
        pos.array[o] = a.x; pos.array[o + 1] = a.y; pos.array[o + 2] = a.z;
        pos.array[o + 3] = b.x; pos.array[o + 4] = b.y; pos.array[o + 5] = b.z;
        px = nx; pz = nz; py = ny;
      }
      if (flash === 0) {
        const c = this.renderer.toWorld(st.x, st.z, (top + ground) / 2);
        this.flash.position.copy(c);
      }
      flash = Math.max(flash, 1 - st.age / 0.6);
      k++;
    }
    for (let j = k * SEG * 6; j < pos.array.length; j++) pos.array[j] = 0;
    pos.needsUpdate = true;
    this.bolts.visible = k > 0;
    this.flash.intensity = flash * 2500;
  }

  /** Storms (sim/weather.js): a dark cloud deck over each, with rain or snow falling beneath it. */
  updateStorms(dt) {
    const w = this.world, show = this.renderer.showClouds;
    this.time += dt;
    this.updateLightning(dt);
    const layers = [this.stormCloud, this.thunderCloud, this.snowCloud, this.rain, this.snowfall];
    for (const l of layers) l.points.visible = show;
    const storms = w.storms || [];
    if (!show) return;
    const N = w.N, t = this.time;
    const cp = this.stormCloud.points.geometry.attributes.position;
    const tp = this.thunderCloud.points.geometry.attributes.position;
    const sp2 = this.snowCloud.points.geometry.attributes.position;
    let kt = 0, ks2 = 0;
    const rp = this.rain.points.geometry.attributes.position;
    const sp = this.snowfall.points.geometry.attributes.position;
    let kc = 0, kr = 0, ks = 0;
    // Share the particles out so a dozen storms all get clouds and rain
    const share = Math.max(1, storms.length);
    const per = Math.floor(Math.min(this.stormCloud.M / 4, 3600 / share)), drops = Math.floor(Math.min(this.rain.M / 4, 5400 / share));
    for (const st of storms) {
      const amount = Math.min(1, st.strength / 0.8);
      const ci = clampCell(st.x, N) + clampCell(st.z, N) * N;
      const base = w.cloudBase ? Math.max(w.cloudBase[ci], w.height[ci] + 4) + 3 : w.height[ci] + 10;
      const nPuff = Math.floor(per * amount);
      for (let j = 0; j < nPuff; j++) {
        // Puffs sit over the storm's rain cells, so the cloud is as ragged as the rain
        const l = st.lobes[j % st.lobes.length];
        const [ox, oz] = disc(st.seed + j * 7.13, l.r * 0.9);
        const tall = st.thunder ? hash(st.seed + j * 2.3) * 12 : hash(st.seed + j * 3.7) * 3;
        const p = this.renderer.toWorld(st.x + l.ox + ox, st.z + l.oz + oz, base + tall);
        // Dark thunderheads, pale snowstorms, grey rain clouds
        if (st.thunder) { if (kt < this.thunderCloud.M) tp.setXYZ(kt++, p.x, p.y, p.z); }
        else if (st.snow > 0.5) { if (ks2 < this.snowCloud.M) sp2.setXYZ(ks2++, p.x, p.y, p.z); }
        else if (kc < this.stormCloud.M) cp.setXYZ(kc++, p.x, p.y, p.z);
      }
      const nDrop = Math.floor(drops * amount);
      for (let j = 0; j < nDrop; j++) {
        const [ox, oz] = disc(st.seed + 500 + j * 5.31, st.r * 1.2);
        const x = st.x + ox, z = st.z + oz;
        if (x < 0 || z < 0 || x > N - 1 || z > N - 1) continue;
        if (hash(st.seed + j * 4.3) > intensityAt(st, x, z)) continue; // only where it's raining
        const i = clampCell(x, N) + clampCell(z, N) * N;
        const ground = w.height[i] + w.water[i];
        const top = Math.max(base, ground + 2);
        // Virga: a dry storm's rain evaporates partway down and never reaches the ground
        const range = (top - ground) * (st.dry ? 0.45 : 1);
        const isSnow = hash(st.seed + j * 1.91) < st.snow;
        const fall = isSnow ? 3 : 22;
        const y = top - ((t * fall + hash(st.seed + j * 9.7) * range) % range);
        // Snow drifts sideways as it falls
        const sway = isSnow ? Math.sin(t * 1.3 + j) * 0.6 : 0;
        const p = this.renderer.toWorld(x + sway, z, y);
        if (isSnow) { if (ks < this.snowfall.M) sp.setXYZ(ks++, p.x, p.y, p.z); }
        else if (kr < this.rain.M) rp.setXYZ(kr++, p.x, p.y, p.z);
      }
    }
    for (let j = kc; j < this.stormCloud.M; j++) cp.setXYZ(j, 0, -9999, 0);
    for (let j = kt; j < this.thunderCloud.M; j++) tp.setXYZ(j, 0, -9999, 0);
    for (let j = ks2; j < this.snowCloud.M; j++) sp2.setXYZ(j, 0, -9999, 0);
    tp.needsUpdate = true; sp2.needsUpdate = true;
    for (let j = kr; j < this.rain.M; j++) rp.setXYZ(j, 0, -9999, 0);
    for (let j = ks; j < this.snowfall.M; j++) sp.setXYZ(j, 0, -9999, 0);
    cp.needsUpdate = rp.needsUpdate = sp.needsUpdate = true;
  }

  /** Weather clouds: soft puffs over places where moist air is being lifted and dropping its water. */
  makeClouds() {
    const M = 1400;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3).fill(-9999), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: softDot(), alphaTest: 0.01,
      color: 0xf4f6fa, size: 24, sizeAttenuation: true, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    this.scene.add(points);
    return { points, M, anchor: new Float32Array(M * 3), drift: 0, refresh: 0 };
  }

  updateClouds(dt) {
    const c = this.clouds, w = this.world;
    c.points.visible = this.renderer.showClouds;
    if (!c.points.visible || !w.cloud) return;
    const pos = c.points.geometry.attributes.position;
    // Re-seed the puffs every couple of seconds from where clouds are forming now
    c.refresh -= dt;
    if (c.refresh <= 0) {
      c.refresh = 2;
      const N = w.N;
      let k = 0;
      for (let tries = 0; tries < c.M * 6 && k < c.M; tries++) {
        const i = (Math.random() * N * N) | 0;
        if (Math.random() > w.cloud[i] * 1.4) continue;
        const x = i % N, z = (i / N) | 0;
        // At the cloud base (low in humid air, higher in drier air), billowing a little above it
        const base = w.cloudBase ? w.cloudBase[i] : w.height[i] + 6;
        const p = this.renderer.toWorld(x + Math.random() - 0.5, z + Math.random() - 0.5, base + Math.random() * 4);
        c.anchor[k * 3] = p.x; c.anchor[k * 3 + 1] = p.y; c.anchor[k * 3 + 2] = p.z;
        k++;
      }
      for (let j = k; j < c.M; j++) c.anchor[j * 3 + 1] = -9999;
      c.drift = 0;
    }
    // Drift gently downwind
    c.drift += dt;
    const { climateParams } = this;
    const a = ((climateParams ? climateParams.windAngle : 20) * Math.PI) / 180;
    const dx = Math.cos(a) * c.drift * 1.5, dz = Math.sin(a) * c.drift * 1.5;
    for (let j = 0; j < c.M; j++) pos.setXYZ(j, c.anchor[j * 3] + dx, c.anchor[j * 3 + 1], c.anchor[j * 3 + 2] + dz);
    pos.needsUpdate = true;
  }

  /** A plain sprite layer (used for fog and high cloud). */
  makeLayer(M, color, size, opacity) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3).fill(-9999), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: softDot(), alphaTest: 0.01, color, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false,
    }));
    this.scene.add(points);
    return { points, M, anchor: new Float32Array(M * 3), drift: 0, refresh: 0 };
  }

  /** Fog pooled in damp, cool valley bottoms, hugging the ground. */
  updateFog(dt) {
    const f = this.fog, w = this.world;
    f.points.visible = this.renderer.showClouds;
    if (!f.points.visible || !w.fog) return;
    const pos = f.points.geometry.attributes.position;
    f.refresh -= dt;
    if (f.refresh <= 0) {
      f.refresh = 3;
      const N = w.N;
      let k = 0;
      for (let tries = 0; tries < f.M * 6 && k < f.M; tries++) {
        const i = (Math.random() * N * N) | 0;
        if (Math.random() > w.fog[i]) continue;
        const x = i % N, z = (i / N) | 0;
        const p = this.renderer.toWorld(x + Math.random() - 0.5, z + Math.random() - 0.5, w.height[i] + w.water[i] + 0.8 + Math.random() * 1.5);
        f.anchor[k * 3] = p.x; f.anchor[k * 3 + 1] = p.y; f.anchor[k * 3 + 2] = p.z;
        k++;
      }
      for (let j = k; j < f.M; j++) f.anchor[j * 3 + 1] = -9999;
    }
    for (let j = 0; j < f.M; j++) pos.setXYZ(j, f.anchor[j * 3], f.anchor[j * 3 + 1], f.anchor[j * 3 + 2]);
    pos.needsUpdate = true;
  }

  /** High, thin cloud far above the terrain, drifting faster than the low cloud. */
  updateCirrus(dt) {
    const c = this.cirrus, w = this.world;
    c.points.visible = this.renderer.showClouds;
    if (!c.points.visible) return;
    const pos = c.points.geometry.attributes.position;
    const N = w.N, half = N / 2;
    if (c.top === undefined || (c.refresh -= dt) <= 0) {
      c.refresh = 10;
      let top = 0;
      for (let i = 0; i < N * N; i += 7) if (w.height[i] > top) top = w.height[i];
      c.top = top + 25;
      // Streaks: a few long bands of puffs
      let k = 0;
      while (k < c.M) {
        const sx = (Math.random() - 0.5) * N * 1.2, sz = (Math.random() - 0.5) * N * 1.2;
        const len = 20 + Math.random() * 40, ang = Math.random() * 0.5;
        for (let s = 0; s < 25 && k < c.M; s++, k++) {
          const t = s / 25;
          c.anchor[k * 3] = sx + Math.cos(ang) * len * t + (Math.random() - 0.5) * 4;
          c.anchor[k * 3 + 1] = c.top + Math.random() * 3;
          c.anchor[k * 3 + 2] = sz + Math.sin(ang) * len * t + (Math.random() - 0.5) * 4;
        }
      }
    }
    c.drift += dt;
    const a = ((this.climateParams ? this.climateParams.windAngle : 20) * Math.PI) / 180;
    for (let j = 0; j < c.M; j++) {
      // Wrap around so the layer keeps covering the map as it drifts
      let x = c.anchor[j * 3] + Math.cos(a) * c.drift * 4, z = c.anchor[j * 3 + 2] + Math.sin(a) * c.drift * 4;
      x = ((x + half * 1.2) % (N * 1.2) + N * 1.2) % (N * 1.2) - half * 1.2;
      z = ((z + half * 1.2) % (N * 1.2) + N * 1.2) % (N * 1.2) - half * 1.2;
      pos.setXYZ(j, x, c.anchor[j * 3 + 1], z);
    }
    pos.needsUpdate = true;
  }

  /** Billowing grey-brown clouds riding on each pyroclastic flow, hugging the ground. */
  makeFlowCloud(color) {
    const M = 2000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3).fill(-9999), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: softDot(), alphaTest: 0.01,
      color, size: 7, sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false,
    }));
    this.scene.add(points);
    return { points, M, life: new Float32Array(M), vel: new Float32Array(M * 3), next: 0 };
  }

  /** Advance a ground-hugging cloud fed by a list of moving parcels (pyroclastic flows or debris). */
  updateFlowCloud(c, parcels, dt) {
    const w = this.world;
    const pos = c.points.geometry.attributes.position;
    for (const f of parcels) {
      const n = Math.ceil(2 + f.mass * 3);
      for (let s = 0; s < n; s++) {
        const k = c.next; c.next = (c.next + 1) % c.M;
        const x = f.x + (Math.random() - 0.5) * 3, z = f.z + (Math.random() - 0.5) * 3;
        const p = this.renderer.toWorld(x, z, w.sampleHeight(x, z) + 0.5 + Math.random() * 2);
        pos.setXYZ(k, p.x, p.y, p.z);
        // The cloud lags the dense current and boils upward
        c.vel[k * 3] = f.vx * 0.35 + (Math.random() - 0.5) * 2;
        c.vel[k * 3 + 1] = 1.5 + Math.random() * 4;
        c.vel[k * 3 + 2] = f.vz * 0.35 + (Math.random() - 0.5) * 2;
        c.life[k] = 1 + Math.random() * 1.5;
      }
    }
    for (let k = 0; k < c.M; k++) {
      if (c.life[k] <= 0) continue;
      c.life[k] -= dt;
      if (c.life[k] <= 0) { pos.setY(k, -9999); continue; }
      c.vel[k * 3] *= 1 - dt; c.vel[k * 3 + 2] *= 1 - dt;
      pos.setXYZ(k, pos.getX(k) + c.vel[k * 3] * dt, pos.getY(k) + c.vel[k * 3 + 1] * dt, pos.getZ(k) + c.vel[k * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
  }

  /** One shared particle system for wildfire smoke, fed from random burning cells. */
  makeSmoke() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3).fill(-9999), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: softDot(), alphaTest: 0.01,
      color: 0x3a3632, size: 4.5, sizeAttenuation: true, transparent: true, opacity: 0.4, depthWrite: false,
    }));
    this.scene.add(points);
    return { points, life: new Float32Array(MAX_PARTICLES), vel: new Float32Array(MAX_PARTICLES * 3), next: 0, spawn: 0 };
  }

  updateSmoke(dt) {
    const s = this.smoke, w = this.world, cells = w.fireCells;
    const pos = s.points.geometry.attributes.position;
    if (cells.length) {
      s.spawn += dt * Math.min(220, 20 + cells.length * 1.5);
      while (s.spawn >= 1) {
        s.spawn--;
        const i = cells[(Math.random() * cells.length) | 0];
        const x = i % w.N, z = (i / w.N) | 0;
        const p = this.renderer.toWorld(x + Math.random() - 0.5, z + Math.random() - 0.5, w.height[i] + 1.5);
        const k = s.next; s.next = (s.next + 1) % MAX_PARTICLES;
        pos.setXYZ(k, p.x, p.y, p.z);
        s.vel[k * 3] = (Math.random() - 0.5) * 1.5; s.vel[k * 3 + 1] = 4 + Math.random() * 5; s.vel[k * 3 + 2] = (Math.random() - 0.5) * 1.5;
        s.life[k] = 2.5 + Math.random() * 2;
      }
    }
    for (let k = 0; k < MAX_PARTICLES; k++) {
      if (s.life[k] <= 0) continue;
      s.life[k] -= dt;
      if (s.life[k] <= 0) { pos.setY(k, -9999); continue; }
      // Smoke drifts downwind as it rises
      s.vel[k * 3] += 1.8 * dt; s.vel[k * 3 + 2] += 0.6 * dt;
      pos.setXYZ(k, pos.getX(k) + s.vel[k * 3] * dt, pos.getY(k) + s.vel[k * 3 + 1] * dt, pos.getZ(k) + s.vel[k * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
  }

  update(dt) {
    this.frame++;
    this.updatePlumes(dt);
    this.updateSmoke(dt);
    this.updateFlowCloud(this.flowCloud, this.world.flows, dt);
    this.updateFlowCloud(this.dustCloud, this.world.debris, dt);
    this.updateClouds(dt);
    this.updateFog(dt);
    this.updateCirrus(dt);
    this.updateStorms(dt);
    this.updateFaults();
  }

  updatePlumes(dt) {
    const w = this.world;
    for (const ev of w.events) {
      if (ev.kind === 'eruption' && !this.plumes.has(ev)) this.plumes.set(ev, this.makePlume(ev));
    }
    for (const [ev, p] of this.plumes) {
      const erupting = w.events.includes(ev);
      let alive = 0;
      const pos = p.points.geometry.attributes.position;
      // Spawn new particles while the eruption runs, more early on
      if (erupting) {
        p.spawn += dt * p.rate * (1 - 0.6 * ev.t / ev.duration);
        while (p.spawn >= 1) { p.spawn--; this.spawn(p, ev); }
      }
      for (let k = 0; k < MAX_PARTICLES; k++) {
        if (p.life[k] <= 0) continue;
        p.life[k] -= dt;
        if (p.life[k] <= 0) { pos.setY(k, -9999); continue; }
        alive++;
        p.vel[k * 3 + 1] -= p.gravity * dt;
        // Ash spreads out and drifts downwind as it rises
        p.vel[k * 3] += p.drift[0] * dt; p.vel[k * 3 + 2] += p.drift[1] * dt;
        pos.setXYZ(k, pos.getX(k) + p.vel[k * 3] * dt, pos.getY(k) + p.vel[k * 3 + 1] * dt, pos.getZ(k) + p.vel[k * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      p.light.intensity = erupting ? p.glow * (0.85 + 0.3 * Math.random()) : Math.max(0, p.light.intensity - dt * p.glow);
      if (!erupting && alive === 0) {
        this.scene.remove(p.points, p.light);
        p.points.geometry.dispose();
        this.plumes.delete(ev);
      }
    }
  }

  makePlume(ev) {
    const explosive = ev.type.ash > 0;
    const column = ev.type.column || 1; // how tall and dense the eruption column is
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(MAX_PARTICLES * 3).fill(-9999);
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const mat = new THREE.PointsMaterial({ map: softDot(), alphaTest: 0.01,
      color: explosive ? 0x8a8580 : 0xffa040, size: explosive ? 4 + 2 * column : 1.6, sizeAttenuation: true,
      transparent: true, opacity: explosive ? 0.55 : 0.95, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    const v = ev.vents[Math.floor(ev.vents.length / 2)];
    const light = new THREE.PointLight(0xff6a20, 0, 90, 1);
    light.position.copy(this.renderer.toWorld(v.x, v.z, this.world.sampleHeight(v.x, v.z) + 4));
    this.scene.add(points, light);
    return {
      points, light, spawn: 0, life: new Float32Array(MAX_PARTICLES), vel: new Float32Array(MAX_PARTICLES * 3), next: 0,
      rate: explosive ? 160 * column : 120, gravity: explosive ? 1.5 : 18,
      drift: explosive ? [2.5, 0.9] : [0, 0], glow: explosive ? 6 * column : 10, explosive, column,
    };
  }

  spawn(p, ev) {
    const k = p.next; p.next = (p.next + 1) % MAX_PARTICLES;
    const v = ev.vents[(Math.random() * ev.vents.length) | 0];
    const base = this.renderer.toWorld(v.x, v.z, this.world.sampleHeight(v.x, v.z) + this.world.lava[this.world.idx(Math.round(v.x), Math.round(v.z))]);
    const pos = p.points.geometry.attributes.position;
    pos.setXYZ(k, base.x + (Math.random() - 0.5) * 2, base.y + 0.5, base.z + (Math.random() - 0.5) * 2);
    const spread = p.explosive ? 5 * p.column : 3;
    p.vel[k * 3] = (Math.random() - 0.5) * spread;
    p.vel[k * 3 + 1] = p.explosive ? (18 + Math.random() * 22) * p.column : 9 + Math.random() * 9;
    p.vel[k * 3 + 2] = (Math.random() - 0.5) * spread;
    p.life[k] = p.explosive ? (3 + Math.random() * 3) * Math.sqrt(p.column) : 0.8 + Math.random() * 0.8;
  }

  /** Draw each fault trace as a line following the ground. */
  updateFaults() {
    const w = this.world;
    if (this.faultCount !== w.faults.length) {
      this.faultGroup.clear();
      for (const f of w.faults) {
        const geo = new THREE.BufferGeometry().setFromPoints(new Array(40).fill(0).map(() => new THREE.Vector3()));
        const color = f.type === 'normal' ? 0xff5a4a : f.type === 'reverse' ? 0x4ab0ff : 0xffd24a;
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 2, gapSize: 1.2, depthTest: false, transparent: true, opacity: 0.9 }));
        line.renderOrder = 9;
        line.userData.fault = f;
        this.faultGroup.add(line);
      }
      this.faultCount = w.faults.length;
      this.frame = 0;
    }
    if (this.frame % 15 !== 0) return;
    for (const line of this.faultGroup.children) {
      const f = line.userData.fault;
      const pos = line.geometry.attributes.position;
      for (let k = 0; k < 40; k++) {
        const t = k / 39;
        const x = f.ax + (f.bx - f.ax) * t, z = f.az + (f.bz - f.az) * t;
        const p = this.renderer.toWorld(x, z, w.sampleHeight(x, z) + 0.6);
        pos.setXYZ(k, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
      line.computeLineDistances();
      line.geometry.computeBoundingSphere();
    }
  }

  /** Offset the camera for earthquake shaking; call before rendering and undo after. */
  applyShake(camera, dt) {
    const w = this.world;
    w.quake *= Math.exp(-dt * 2.2);
    if (w.quake < 0.02) { w.quake = 0; this.shake.set(0, 0, 0); return; }
    const a = w.quake * 1.4;
    this.shake.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.6, (Math.random() - 0.5) * a);
    camera.position.add(this.shake);
  }

  removeShake(camera) { camera.position.sub(this.shake); this.shake.set(0, 0, 0); }
}
