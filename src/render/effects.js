// Event visuals: eruption plumes (ash clouds or lava fountains) with a glow light at the vent,
// fault traces drawn on the ground, and earthquake camera shake.

import * as THREE from 'three';

const MAX_PARTICLES = 600;

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
  }

  /** One shared particle system for wildfire smoke, fed from random burning cells. */
  makeSmoke() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3).fill(-9999), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
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
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(MAX_PARTICLES * 3).fill(-9999);
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const mat = new THREE.PointsMaterial({
      color: explosive ? 0x8a8580 : 0xffa040, size: explosive ? 5 : 1.6, sizeAttenuation: true,
      transparent: true, opacity: explosive ? 0.55 : 0.95, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    const v = ev.vents[Math.floor(ev.vents.length / 2)];
    const light = new THREE.PointLight(0xff6a20, 0, 90, 1);
    light.position.copy(this.renderer.toWorld(v.x, v.z, this.world.sampleHeight(v.x, v.z) + 4));
    this.scene.add(points, light);
    return {
      points, light, spawn: 0, life: new Float32Array(MAX_PARTICLES), vel: new Float32Array(MAX_PARTICLES * 3), next: 0,
      rate: explosive ? 160 : 120, gravity: explosive ? 1.5 : 18,
      drift: explosive ? [2.5, 0.9] : [0, 0], glow: explosive ? 6 : 10, explosive,
    };
  }

  spawn(p, ev) {
    const k = p.next; p.next = (p.next + 1) % MAX_PARTICLES;
    const v = ev.vents[(Math.random() * ev.vents.length) | 0];
    const base = this.renderer.toWorld(v.x, v.z, this.world.sampleHeight(v.x, v.z) + this.world.lava[this.world.idx(Math.round(v.x), Math.round(v.z))]);
    const pos = p.points.geometry.attributes.position;
    pos.setXYZ(k, base.x + (Math.random() - 0.5) * 2, base.y + 0.5, base.z + (Math.random() - 0.5) * 2);
    const spread = p.explosive ? 5 : 3;
    p.vel[k * 3] = (Math.random() - 0.5) * spread;
    p.vel[k * 3 + 1] = p.explosive ? 18 + Math.random() * 22 : 9 + Math.random() * 9;
    p.vel[k * 3 + 2] = (Math.random() - 0.5) * spread;
    p.life[k] = p.explosive ? 3 + Math.random() * 3 : 0.8 + Math.random() * 0.8;
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
