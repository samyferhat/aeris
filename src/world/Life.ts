import * as THREE from 'three';
import { Heightfield } from './Heightfield';
import { WORLD_SIZE, LIGHTHOUSE } from './Archipelago';
import { Settlement, Street } from './Settlement';
import { mulberry32 } from '../core/Noise';

/**
 * What moves.
 *
 * An island with nothing on it but weather reads as a model of an island. A dozen boats
 * crossing between the islands, traffic on the corniche, a lighthouse turning and a
 * few chimneys going are, between them, about four hundred instances — nothing at all
 * next to the terrain — and they are most of the difference between a place and a
 * diorama.
 *
 * Every moving thing writes into a small table the ocean reads, so a hull leaves a wake
 * and an aeroplane at ten metres leaves a streak of spray behind it.
 */

export interface Wake { x: number; z: number; dx: number; dz: number; beam: number; len: number; strength: number }

interface Vessel {
  type: string;
  pos: THREE.Vector2;
  hdg: number;
  speed: number;
  route: THREE.Vector2[];
  leg: number;
  bobPhase: number;
}

interface Vehicle {
  street: number;
  arc: number;
  dir: 1 | -1;
  side: number;
  speed: number;
  type: string;
}

const MAX_WAKES = 14;

export class Life extends THREE.Group {
  private rnd = mulberry32(0xb0a7);
  private vessels: Vessel[] = [];
  private vehicles: Vehicle[] = [];
  private meshes = new Map<string, THREE.InstancedMesh>();
  private counts = new Map<string, number>();
  private streets: Street[] = [];
  private arcs: number[][] = [];
  readonly wakes: Wake[] = [];
  private beam: THREE.Mesh | null = null;
  private beamMat: THREE.MeshBasicMaterial | null = null;
  private t = 0;

  constructor(private hf: Heightfield, private settlement: Settlement) {
    super();
    this.frustumCulled = false;
  }

  // -------------------------------------------------------------------------

  build(geos: Map<string, THREE.BufferGeometry>) {
    this.planVessels();
    this.planTraffic();
    const need: Record<string, number> = {};
    for (const v of this.vessels) need[v.type] = (need[v.type] ?? 0) + 1;
    for (const v of this.vehicles) need[v.type] = (need[v.type] ?? 0) + 1;
    for (const [type, n] of Object.entries(need)) {
      const geo = geos.get(type);
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo.clone(), this.settlement.buildingMaterial, n);
      // Same shader as the buildings, so these need the same per-instance attributes.
      const tints = new Float32Array(n * 3), seeds = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const c = new THREE.Color().setHSL(this.rnd(), 0.35 + this.rnd() * 0.4, 0.42 + this.rnd() * 0.3);
        tints[i * 3] = c.r; tints[i * 3 + 1] = c.g; tints[i * 3 + 2] = c.b;
        seeds[i] = this.rnd();
      }
      mesh.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
      mesh.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = n;
      this.meshes.set(type, mesh);
      this.counts.set(type, 0);
      this.add(mesh);
    }
    this.buildLighthouse();
  }

  // ---- routes --------------------------------------------------------------

  /** Deep enough to float a coaster and far enough from the rocks to steer in. */
  private navigable(x: number, z: number): boolean {
    if (this.hf.getHeight(x, z) > -9) return false;
    for (let a = 0; a < 6; a++) {
      const ang = a * Math.PI / 3;
      if (this.hf.getHeight(x + Math.cos(ang) * 160, z + Math.sin(ang) * 160) > -4) return false;
    }
    return true;
  }

  /**
   * A waypoint in navigable water that is also worth sailing to: within sight of an
   * island. A coaster crossing the empty corner of the map is a coaster nobody sees.
   */
  private seaPoint(near?: THREE.Vector2): THREE.Vector2 | null {
    const half = WORLD_SIZE / 2 * 0.55;
    for (let k = 0; k < 400; k++) {
      const x = near ? near.x + (this.rnd() * 2 - 1) * 5200 : (this.rnd() * 2 - 1) * half;
      const z = near ? near.y + (this.rnd() * 2 - 1) * 5200 : (this.rnd() * 2 - 1) * half;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      if (!this.navigable(x, z)) continue;
      let sees = false;
      for (let a = 0; a < 8 && !sees; a++) {
        const ang = a * Math.PI / 4;
        for (const r of [1200, 2600, 4000]) {
          if (this.hf.getHeight(x + Math.cos(ang) * r, z + Math.sin(ang) * r) > 3) { sees = true; break; }
        }
      }
      if (sees) return new THREE.Vector2(x, z);
    }
    return null;
  }

  private planVessels() {
    // Moored: fishing boats and skiffs along the quays, which is where a harbour's
    // character actually lives.
    for (const m of this.settlement.moorings) {
      for (let k = 0; k < 2; k++) {
        const off = (k - 0.5) * 26;
        const x = m.x + Math.cos(m.rot) * off, z = m.z - Math.sin(m.rot) * off;
        if (this.hf.getHeight(x, z) > -1.6) continue;
        this.vessels.push({
          type: this.rnd() < 0.65 ? 'BoatFishing' : 'Skiff',
          pos: new THREE.Vector2(x, z), hdg: m.rot + Math.PI / 2, speed: 0,
          route: [], leg: 0, bobPhase: this.rnd() * 10,
        });
      }
    }
    // Under way: a handful of boats crossing between the islands.
    for (let i = 0; i < 11; i++) {
      const route: THREE.Vector2[] = [];
      const first = this.seaPoint();
      if (!first) continue;
      route.push(first);
      for (let k = 0; k < 3; k++) {
        const p = this.seaPoint(route[route.length - 1]);
        if (p) route.push(p);
      }
      if (route.length < 3) continue;
      const type = i < 3 ? 'CargoShip' : i < 7 ? 'BoatFishing' : 'Skiff';
      this.vessels.push({
        type,
        pos: route[0].clone(),
        hdg: Math.atan2(route[1].y - route[0].y, route[1].x - route[0].x),
        speed: type === 'CargoShip' ? 5.4 + this.rnd() * 1.6 : type === 'BoatFishing' ? 4.0 + this.rnd() * 2.4 : 6.5 + this.rnd() * 3,
        route, leg: 1, bobPhase: this.rnd() * 10,
      });
    }
  }

  private planTraffic() {
    this.streets = this.settlement.streets.filter((s) => s.kind !== 'lane' && s.pts.length > 8);
    this.arcs = this.streets.map((s) => {
      const a = [0];
      for (let i = 1; i < s.pts.length; i++) a.push(a[i - 1] + s.pts[i].distanceTo(s.pts[i - 1]));
      return a;
    });
    if (!this.streets.length) return;
    for (let i = 0; i < 46; i++) {
      const si = Math.floor(this.rnd() * this.streets.length);
      const total = this.arcs[si][this.arcs[si].length - 1];
      if (total < 120) continue;
      this.vehicles.push({
        street: si,
        arc: this.rnd() * total,
        dir: this.rnd() < 0.5 ? 1 : -1,
        side: 1,
        speed: 9 + this.rnd() * 9,
        type: this.rnd() < 0.78 ? 'Car' : 'Van',
      });
    }
  }

  // ---- the lighthouse ------------------------------------------------------

  /**
   * The beam. A long, very flat cone with an additive material: what the eye reads at
   * night is not the lamp but the shaft of it sweeping across the haze, and a cone with
   * a soft edge is a convincing shaft for eight triangles.
   */
  private buildLighthouse() {
    const len = 2600, r = 46;
    const geo = new THREE.ConeGeometry(r, len, 14, 1, true);
    geo.translate(0, -len / 2, 0);
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(Math.PI / 2);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xfff0cf, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.position.set(LIGHTHOUSE.x, this.hf.getHeight(LIGHTHOUSE.x, LIGHTHOUSE.z) + 23.2, LIGHTHOUSE.z);
    this.beam.frustumCulled = false;
    this.add(this.beam);
  }

  // ---- per frame -----------------------------------------------------------

  update(dt: number, night: number, playerPos: THREE.Vector3, playerVel: THREE.Vector3) {
    this.t += dt;
    for (const k of this.counts.keys()) this.counts.set(k, 0);
    this.wakes.length = 0;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

    // ---- vessels ----------------------------------------------------------
    for (const v of this.vessels) {
      if (v.route.length) {
        const tgt = v.route[v.leg];
        const dx = tgt.x - v.pos.x, dz = tgt.y - v.pos.y;
        const d = Math.hypot(dx, dz);
        if (d < 120) v.leg = (v.leg + 1) % v.route.length;
        const want = Math.atan2(dz, dx);
        let da = want - v.hdg;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        // A ship turns slowly, and that is most of why a ship reads as a ship.
        v.hdg += THREE.MathUtils.clamp(da, -0.10 * dt, 0.10 * dt);
        v.pos.x += Math.cos(v.hdg) * v.speed * dt;
        v.pos.y += Math.sin(v.hdg) * v.speed * dt;
      }
      const mesh = this.meshes.get(v.type);
      if (!mesh) continue;
      const i = this.counts.get(v.type)!;
      if (i >= mesh.instanceMatrix.count) continue;
      // Ride the swell: a slow heave and a matching pitch, so the hull is never a
      // cardboard cut-out sitting on a flat plane.
      const ph = this.t * 0.55 + v.bobPhase + (v.pos.x + v.pos.y) * 0.012;
      const heave = Math.sin(ph) * 0.42 + Math.sin(ph * 1.7 + 1.1) * 0.22;
      const pitch = Math.cos(ph) * 0.035;
      const roll = Math.sin(ph * 0.83 + 2.0) * 0.045;
      q.setFromAxisAngle(up, -v.hdg + Math.PI / 2);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, roll)));
      p.set(v.pos.x, heave, v.pos.y);
      mesh.setMatrixAt(i, m.compose(p, q, sc));
      this.counts.set(v.type, i + 1);
      if (v.speed > 0.5 && this.wakes.length < MAX_WAKES) {
        const beam = v.type === 'CargoShip' ? 13 : v.type === 'BoatFishing' ? 3.8 : 2.1;
        this.wakes.push({
          x: v.pos.x, z: v.pos.y, dx: Math.cos(v.hdg), dz: Math.sin(v.hdg),
          beam, len: beam * 34 + v.speed * 42, strength: Math.min(1, v.speed / 7),
        });
      }
    }

    // ---- traffic ----------------------------------------------------------
    for (const c of this.vehicles) {
      const st = this.streets[c.street], arcs = this.arcs[c.street];
      const total = arcs[arcs.length - 1];
      c.arc += c.speed * c.dir * dt;
      if (c.arc > total) { c.arc = total - 1; c.dir = -1; }
      if (c.arc < 0) { c.arc = 1; c.dir = 1; }
      let k = 1;
      while (k < arcs.length - 1 && arcs[k] < c.arc) k++;
      const t = (c.arc - arcs[k - 1]) / Math.max(1e-3, arcs[k] - arcs[k - 1]);
      const a = st.pts[k - 1], b = st.pts[k];
      const dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz) || 1;
      const ux = dx / L, uz = dz / L;
      const off = (st.width * 0.25) * c.dir;
      const x = a.x + dx * t - uz * off, z = a.y + dz * t + ux * off;
      const mesh = this.meshes.get(c.type);
      if (!mesh) continue;
      const i = this.counts.get(c.type)!;
      if (i >= mesh.instanceMatrix.count) continue;
      q.setFromAxisAngle(up, Math.atan2(uz * c.dir, ux * c.dir) * -1 + Math.PI / 2);
      p.set(x, this.hf.getHeight(x, z) + 0.22, z);
      mesh.setMatrixAt(i, m.compose(p, q, sc));
      this.counts.set(c.type, i + 1);
    }

    // The player's own wake, when low enough over the water to raise one.
    const agl = playerPos.y - Math.max(0, this.hf.getHeight(playerPos.x, playerPos.z));
    if (this.hf.getHeight(playerPos.x, playerPos.z) < -0.5 && playerPos.y < 26 && this.wakes.length < MAX_WAKES) {
      const sp = Math.hypot(playerVel.x, playerVel.z);
      if (sp > 8) {
        this.wakes.push({
          x: playerPos.x, z: playerPos.z, dx: playerVel.x / sp, dz: playerVel.z / sp,
          beam: 4.5, len: 240 + sp * 4, strength: (1 - playerPos.y / 26) * Math.min(1, sp / 60) * 1.4,
        });
      }
    }
    void agl;

    for (const [type, mesh] of this.meshes) {
      mesh.count = this.counts.get(type) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }

    // ---- the light --------------------------------------------------------
    if (this.beam && this.beamMat) {
      this.beam.rotation.y = -this.t * 0.42;
      this.beamMat.opacity = 0.16 * night;
      this.beam.visible = night > 0.02;
    }
  }
}
