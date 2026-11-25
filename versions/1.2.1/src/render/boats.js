// Boats on the water: each harbour's fishing fleet, small white hulls sailing about the fishing
// grounds around it (each one picks a spot on the water within the fleet's range, sails there,
// then picks another).

import * as THREE from 'three';

const MAX = 240;

export class Boats {
  constructor(scene, app) {
    this.app = app;
    const hull = new THREE.ConeGeometry(0.9, 3.4, 4);
    hull.rotateX(Math.PI / 2); // (points along +z)
    hull.scale(1, 0.45, 1);
    this.mesh = new THREE.InstancedMesh(hull, new THREE.MeshStandardMaterial({ color: 0xf4f1e8, emissive: 0x202020 }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.boats = []; // { town, x, z, tx, tz }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(1, 1, 1);
  }

  pickTarget(b, w) {
    const N = w.N, t = b.town, hx = t.harbor % N, hz = (t.harbor / N) | 0, R = t.fishRange || 10, sea = w.meanSea;
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R;
      const x = hx + Math.cos(a) * d, z = hz + Math.sin(a) * d;
      if (x < 1 || z < 1 || x > N - 2 || z > N - 2) continue;
      if (w.height[Math.round(z) * N + Math.round(x)] < sea - 0.5) { b.tx = x; b.tz = z; return; }
    }
    b.tx = hx; b.tz = hz;
  }

  update(dt) {
    const w = this.app.world, towns = (w.towns || []).filter((t) => t.harbor !== undefined && t.boats > 0);
    // Match the boats to the fleets (launch new ones from the harbour, retire extras)
    const keep = [];
    const byTown = new Map();
    for (const b of this.boats) { if (!byTown.has(b.town)) byTown.set(b.town, []); byTown.get(b.town).push(b); }
    for (const t of towns) {
      const have = byTown.get(t) || [];
      for (let k = 0; k < Math.min(t.boats, MAX); k++) {
        if (have[k]) keep.push(have[k]);
        else {
          const N = w.N, b = { town: t, x: t.harbor % N, z: (t.harbor / N) | 0 };
          this.pickTarget(b, w); keep.push(b);
        }
      }
    }
    this.boats = keep.slice(0, MAX);
    const sea = w.seaLevel > -999 ? w.seaLevel : 0, step = 3 * Math.min(0.1, dt); // (about 3 cells a second)
    let c = 0;
    for (const b of this.boats) {
      const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);
      if (d < 0.5) this.pickTarget(b, w);
      else { b.x += (dx / d) * step; b.z += (dz / d) * step; b.heading = Math.atan2(dx, dz); }
      const p = this.app.renderer.toWorld(b.x, b.z, sea + 0.25);
      this.e.set(0, b.heading || 0, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(p, this.q, this.s);
      this.mesh.setMatrixAt(c++, this.m);
    }
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
