// Event visuals: eruption plumes (ash clouds or lava fountains) with a glow light at the vent,
// fault traces drawn on the ground, and earthquake camera shake.

import * as THREE from 'three';

const MAX_PARTICLES = 600;

let dot = null;
/** A soft round sprite (white, fading to transparent at the edge) so particles look like puffs, not squares. */
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
        const p = this.renderer.toWorld(x + Math.random() - 0.5, z + Math.random() - 0.5, w.height[i] + 6 + Math.random() * 4);
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
