import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import { Heightfield } from '../world/Heightfield';
import { CombatFx } from './Effects';
import { DamageTarget } from './Ordnance';

/**
 * Things on the ground worth flying at.
 *
 * Five installations, all static: the difficulty is meant to be in the flying and in
 * the aiming, not in the target doing something clever. What each one owes the player
 * is a clear silhouette from a mile out, a satisfying way to come apart, and a wreck
 * that goes on burning long enough to be worth coming back to look at.
 */

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export type SiteKind = 'convoy' | 'radar' | 'fuel' | 'port' | 'airfield';

export interface SiteInfo {
  kind: SiteKind;
  name: string;
  position: THREE.Vector3;
  /** Live props left. */
  remaining: number;
  total: number;
}

/** One destructible object. */
export class Prop implements DamageTarget {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  alive = true;
  hp: number;
  /** Seconds of fire left once destroyed. Wrecks burn for a long time on purpose. */
  burn = 0;
  private tilt = 0;
  private sunk = 0;

  constructor(
    readonly node: THREE.Object3D,
    readonly radius: number,
    hp: number,
    readonly heat: number,
    readonly fireRadius: number,
    readonly kind: 'vehicle' | 'structure' | 'fuel' | 'boat' | 'aircraft',
    readonly name: string,
    readonly site: Site,
  ) {
    this.hp = hp;
    this.maxHp = hp;
    node.getWorldPosition(this.position);
  }

  damage(amount: number, at: THREE.Vector3) {
    if (!this.alive) return;
    this.hp -= amount;
    this.site.onHit(this, at);
    if (this.hp <= 0) { this.alive = false; this.site.onKill(this, at); }
  }

  /** Settle a wreck: it drops on its springs, leans, and stops being a vehicle. */
  settle(dt: number) {
    if (this.alive) return;
    const t = 1 - Math.exp(-dt * 1.4);
    this.tilt = THREE.MathUtils.lerp(this.tilt, this.tiltTarget, t);
    this.sunk = THREE.MathUtils.lerp(this.sunk, this.sinkTarget, t);
    this.node.rotation.z = this.tilt;
    this.node.position.y = this.baseY - this.sunk;
  }

  baseY = 0;
  tiltTarget = 0;
  sinkTarget = 0;
  /** What it started with, so a hit can tell how badly it is hurt. */
  readonly maxHp: number;
}

/** One installation: a group of props that reads as a single place. */
export class Site {
  readonly props: Prop[] = [];
  readonly centre = new THREE.Vector3();
  /** Fuel tanks take their neighbours with them, after a beat. */
  private chain: { prop: Prop; at: number }[] = [];
  private t = 0;

  constructor(readonly kind: SiteKind, readonly name: string, private fx: CombatFx) {}

  onHit(p: Prop, at: THREE.Vector3) {
    if (p.kind === 'fuel' && p.hp < p.maxHp * 0.4 && Math.random() < 0.3) {
      // A leaking tank shows it before it goes.
      this.fx.impact(at, _v.set(0, 1, 0), 1.4, 'metal');
    }
  }

  onKill(p: Prop, at: THREE.Vector3) {
    const power = p.kind === 'fuel' ? 3.4 : p.kind === 'structure' ? 2.2
      : p.kind === 'boat' ? 2.4 : p.kind === 'aircraft' ? 2.0 : 1.5;
    this.fx.explosion(p.position, power, p.kind === 'fuel' ? 'fuel' : 'ground');
    p.burn = 45 + Math.random() * 40;
    p.tiltTarget = (Math.random() - 0.5) * (p.kind === 'vehicle' ? 0.30 : 0.10);
    p.sinkTarget = p.kind === 'vehicle' ? 0.28 : 0.06;
    this.blacken(p);
    this.onSiteEvent?.(this, p, at);
    if (p.kind === 'fuel') {
      // Chain reaction: everything close enough goes up a beat later, which is what
      // turns a fuel farm from five targets into one event.
      for (const q of this.props) {
        if (q === p || !q.alive || q.kind !== 'fuel') continue;
        if (q.position.distanceTo(p.position) < 34) {
          this.chain.push({ prop: q, at: this.t + 0.5 + Math.random() * 1.4 });
        }
      }
    }
  }

  onSiteEvent: ((site: Site, prop: Prop, at: THREE.Vector3) => void) | null = null;

  /** A dead thing is charred: scorch the material rather than swapping the model. */
  private blacken(p: Prop) {
    p.node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = mats.map((m) => {
        const c = (m as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
        c.color.multiplyScalar(0.16);
        c.roughness = Math.min(1, (c.roughness ?? 0.6) + 0.35);
        c.metalness = (c.metalness ?? 0) * 0.4;
        applyAerialPerspective(c);
        return c;
      });
      mesh.material = out.length === 1 ? out[0] : out;
    });
  }

  update(dt: number, night: number) {
    this.t += dt;
    for (let i = this.chain.length - 1; i >= 0; i--) {
      if (this.t >= this.chain[i].at) {
        const q = this.chain[i].prop;
        this.chain.splice(i, 1);
        if (q.alive) { q.hp = 0; q.alive = false; this.onKill(q, q.position); }
      }
    }
    for (const p of this.props) {
      if (p.alive) continue;
      p.settle(dt);
      if (p.burn > 0) {
        p.burn -= dt;
        // The fire dies down over its life rather than switching off.
        const strength = Math.min(1, p.burn / 12);
        _v.copy(p.position); _v.y += p.fireRadius * 0.25;
        this.fx.fire(_v, p.fireRadius, strength, dt, night);
      }
    }
  }

  get info(): SiteInfo {
    return {
      kind: this.kind, name: this.name, position: this.centre,
      remaining: this.props.filter((p) => p.alive).length, total: this.props.length,
    };
  }
}

/**
 * Everything on the ground, and where it goes.
 *
 * Placement is the awkward part: the archipelago is generated, so there is no map to
 * put things on. Each site searches outward from a seed point for ground that is flat
 * enough and high enough to stand on, which is both robust to the terrain changing and
 * the reason the convoy always ends up somewhere plausible.
 */
export class TargetWorld extends THREE.Group {
  private static source: THREE.Object3D | null = null;
  private static parts = new Map<string, THREE.Object3D>();
  readonly sites: Site[] = [];
  readonly all: Prop[] = [];
  private spinners: { node: THREE.Object3D; rate: number }[] = [];
  private floaters: { node: THREE.Object3D; phase: number }[] = [];
  private t = 0;

  static async preload(url = '/models/targets.glb') {
    if (TargetWorld.source) return;
    const gltf = await new GLTFLoader().loadAsync(url);
    TargetWorld.source = gltf.scene;
    const seen = new Set<THREE.Material>();
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.receiveShadow = true;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (seen.has(m)) continue;
        seen.add(m);
        applyAerialPerspective(m);
      }
    });
    for (const c of gltf.scene.children) TargetWorld.parts.set(c.name, c);
  }

  static allMaterials(): THREE.Material[] {
    const out = new Set<THREE.Material>();
    TargetWorld.source?.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const mm of Array.isArray(m) ? m : [m]) out.add(mm);
    });
    return [...out];
  }

  constructor(private hf: Heightfield, private fx: CombatFx) {
    super();
    this.frustumCulled = false;
  }

  private spawn(name: string): THREE.Object3D | null {
    const src = TargetWorld.parts.get(name);
    return src ? src.clone(true) : null;
  }

  /**
   * Find ground near (x, z) that is flat enough to build on. Spirals outward, which
   * beats hand-placing coordinates against a heightfield that is regenerated from a
   * seed and would silently drop a fuel farm into the sea if the seed ever moved.
   */
  /** Sites already placed, so the next one does not land on top of them. */
  private placed: THREE.Vector3[] = [];

  private findFlat(x: number, z: number, span: number, minH = 6, maxSlope = 0.10): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bestScore = Infinity;
    for (let ring = 0; ring < 26; ring++) {
      const r = ring * 55;
      const n = ring === 0 ? 1 : 8 + ring * 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.7;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const h = this.hf.getHeight(px, pz);
        if (h < minH || h > 260) continue;
        // Slope over the site's own footprint, not over one cell.
        let lo = Infinity, hi = -Infinity;
        for (let k = 0; k < 8; k++) {
          const b = (k / 8) * Math.PI * 2;
          const hh = this.hf.getHeight(px + Math.cos(b) * span, pz + Math.sin(b) * span);
          lo = Math.min(lo, hh); hi = Math.max(hi, hh);
        }
        const slope = (hi - lo) / (2 * span);
        if (slope > maxSlope) continue;
        // Two installations that end up in the same valley read as one confusing mess.
        let clash = false;
        for (const q of this.placed) if (q.distanceTo(_v2.set(px, h, pz)) < 900) { clash = true; break; }
        if (clash) continue;
        const score = slope * 100 + r * 0.001;
        if (score < bestScore) { bestScore = score; best = new THREE.Vector3(px, h, pz); }
      }
      if (best && ring > 4) break;
    }
    if (best) this.placed.push(best.clone());
    return best;
  }

  /**
   * Try several seeds before giving up. The terrain is generated, so any single hand
   * -picked coordinate is a guess: the airfield needs ninety metres of flat ground and
   * there is no guarantee the first guess is not halfway up a ridge or in the sea.
   */
  private findFlatAny(seeds: [number, number][], span: number, minH = 6, maxSlope = 0.10) {
    for (const [x, z] of seeds) {
      const at = this.findFlat(x, z, span, minH, maxSlope);
      if (at) return at;
    }
    for (const [x, z] of seeds) {
      const at = this.findFlat(x, z, span * 0.65, minH, maxSlope * 2.0);
      if (at) return at;
    }
    return null;
  }

  /** Find water deep enough to float a boat, near a shore. */
  private findWater(x: number, z: number): THREE.Vector3 | null {
    for (let ring = 0; ring < 30; ring++) {
      const r = ring * 60;
      const n = ring === 0 ? 1 : 10 + ring * 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.5;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (this.hf.getHeight(px, pz) > -3) continue;
        // Near a shore: some land within a couple of hundred metres.
        let shore = false;
        for (let k = 0; k < 12 && !shore; k++) {
          const b = (k / 12) * Math.PI * 2;
          if (this.hf.getHeight(px + Math.cos(b) * 190, pz + Math.sin(b) * 190) > 1) shore = true;
        }
        if (shore) return new THREE.Vector3(px, 0, pz);
      }
    }
    return null;
  }

  private addProp(site: Site, node: THREE.Object3D, pos: THREE.Vector3, yaw: number,
                  radius: number, hp: number, heat: number, fireRadius: number,
                  kind: Prop['kind'], name: string) {
    node.position.copy(pos);
    node.rotation.y = yaw;
    this.add(node);
    const p = new Prop(node, radius, hp, heat, fireRadius, kind, name, site);
    p.baseY = pos.y;
    p.position.copy(pos);
    p.position.y += radius * 0.4;
    site.props.push(p);
    this.all.push(p);
    return p;
  }

  /** Lay out every installation. Call once, after the heightfield exists. */
  build(onEvent: (site: Site, prop: Prop, at: THREE.Vector3) => void) {
    const mk = (kind: SiteKind, name: string) => {
      const s = new Site(kind, name, this.fx);
      s.onSiteEvent = onEvent;
      this.sites.push(s);
      return s;
    };

    // ---- convoy: a line of trucks and carriers along a shallow contour -------
    {
      const site = mk('convoy', 'Convoi');
      const at = this.findFlatAny([[1900, -1500], [1200, -2200], [2600, -900]], 60, 8, 0.055);
      if (at) {
        site.centre.copy(at);
        // Follow the least-sloping direction so the column looks like it is on a road.
        let bestA = 0, bestD = Infinity;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI;
          const h1 = this.hf.getHeight(at.x + Math.cos(a) * 120, at.z + Math.sin(a) * 120);
          const h2 = this.hf.getHeight(at.x - Math.cos(a) * 120, at.z - Math.sin(a) * 120);
          const d = Math.abs(h1 - h2);
          if (d < bestD) { bestD = d; bestA = a; }
        }
        const dx = Math.cos(bestA), dz = Math.sin(bestA);
        const order = ['APC', 'Truck', 'Truck', 'APC', 'Truck', 'Truck', 'APC'];
        for (let i = 0; i < order.length; i++) {
          const t = (i - (order.length - 1) / 2) * 26;
          const px = at.x + dx * t, pz = at.z + dz * t;
          const node = this.spawn(order[i]);
          if (!node) continue;
          _v.set(px, this.hf.getHeight(px, pz), pz);
          const isApc = order[i] === 'APC';
          this.addProp(site, node, _v, -bestA + Math.PI / 2, isApc ? 4.2 : 4.0,
            isApc ? 130 : 90, 0.25, isApc ? 3.4 : 3.0, 'vehicle', order[i]);
        }
      }
    }

    // ---- radar site: a cabin, a turning array, and its guard ----------------
    {
      const site = mk('radar', 'Site radar');
      const at = this.findFlatAny([[-2300, 1700], [-1500, 2500], [-3000, 900]], 45, 25, 0.08);
      if (at) {
        site.centre.copy(at);
        const cabin = this.spawn('RadarCabin');
        if (cabin) this.addProp(site, cabin, at, 0.6, 4.5, 220, 0.3, 3.6, 'structure', 'Cabine');
        const dish = this.spawn('RadarDish');
        if (dish) {
          _v.copy(at); _v.x += 11; _v.z += 4;
          _v.y = this.hf.getHeight(_v.x, _v.z) + 3.2;
          const p = this.addProp(site, dish, _v, 0, 4.0, 150, 0.35, 3.0, 'structure', 'Antenne');
          // A search radar turns at about six revolutions a minute. It is the one
          // moving thing at the site, and it is what makes it read as switched on.
          this.spinners.push({ node: dish, rate: 0.63 });
          p.position.y += 1.5;
        }
        for (let i = 0; i < 2; i++) {
          const node = this.spawn('Truck');
          if (!node) continue;
          _v.set(at.x - 16 - i * 12, 0, at.z - 14 + i * 6);
          _v.y = this.hf.getHeight(_v.x, _v.z);
          this.addProp(site, node, _v, 1.9, 4.0, 90, 0.25, 3.0, 'vehicle', 'Camion');
        }
      }
    }

    // ---- fuel farm: the one that goes up all at once ------------------------
    {
      const site = mk('fuel', 'Dépôt de carburant');
      const at = this.findFlatAny([[-1600, -2400], [-2400, -1200], [-900, -3000]], 70, 10, 0.06);
      if (at) {
        site.centre.copy(at);
        const ring = [[-26, -14], [4, -22], [30, -6], [22, 22], [-10, 24]];
        for (let i = 0; i < ring.length; i++) {
          const node = this.spawn('FuelTank');
          if (!node) continue;
          _v.set(at.x + ring[i][0], 0, at.z + ring[i][1]);
          _v.y = this.hf.getHeight(_v.x, _v.z);
          this.addProp(site, node, _v, i * 0.7, 6.2, 170, 0.2, 7.5, 'fuel', 'Cuve');
        }
        for (let i = 0; i < 4; i++) {
          const node = this.spawn('Crate');
          if (!node) continue;
          _v.set(at.x - 4 + (i % 2) * 3, 0, at.z + 2 + Math.floor(i / 2) * 3);
          _v.y = this.hf.getHeight(_v.x, _v.z);
          this.addProp(site, node, _v, i, 1.6, 40, 0.1, 1.6, 'structure', 'Caisse');
        }
      }
    }

    // ---- port: boats on the water, and something to hit ashore --------------
    {
      const site = mk('port', 'Port');
      const at = this.findWater(2600, 2300);
      if (at) this.placed.push(at.clone());
      if (at) {
        site.centre.copy(at);
        for (let i = 0; i < 3; i++) {
          const node = this.spawn('PatrolBoat');
          if (!node) continue;
          // A little above the mean surface: the sea is a wave field, and a hull pinned
          // to y = 0 spends half its time inside a crest.
          _v.set(at.x + i * 34 - 34, 0.45, at.z + (i % 2) * 16);
          this.addProp(site, node, _v, 0.4 + i * 0.15, 6.0, 200, 0.3, 5.0, 'boat', 'Patrouilleur');
          this.floaters.push({ node, phase: i * 2.1 });
        }
      }
    }

    // ---- enemy airfield ------------------------------------------------------
    {
      const site = mk('airfield', 'Terrain adverse');
      const at = this.findFlatAny([[3300, -3300], [2400, -3300], [3300, 900], [900, 3000], [-2600, -2600]], 90, 8, 0.045);
      if (at) {
        site.centre.copy(at);
        this.add(this.apron(at, 150, 95));
        const tower = this.spawn('Tower');
        if (tower) {
          _v.copy(at); _v.x += 46; _v.y = this.hf.getHeight(_v.x, _v.z);
          this.addProp(site, tower, _v, 0.3, 5.0, 280, 0.2, 4.5, 'structure', 'Tour');
        }
        for (let i = 0; i < 2; i++) {
          const h = this.spawn('Hangar');
          if (!h) continue;
          _v.set(at.x - 30 + i * 40, 0, at.z + 34);
          _v.y = this.hf.getHeight(_v.x, _v.z);
          this.addProp(site, h, _v, 0, 11.0, 340, 0.2, 9.0, 'structure', 'Hangar');
        }
      }
    }
    return this;
  }

  /**
   * A concrete apron that follows the ground rather than floating over it. The site
   * search guarantees the slope is gentle, not that it is flat, and a rigid slab on a
   * two percent grade shows daylight under one edge from a mile away.
   */
  private apron(at: THREE.Vector3, w: number, d: number): THREE.Mesh {
    const N = 40;
    const g = new THREE.PlaneGeometry(w, d, N, N);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = at.x + pos.getX(i), z = at.z + pos.getZ(i);
      // Enough clearance that the terrain's own detail does not poke through the
      // slab between grid points, which shows as grass growing out of concrete.
      pos.setY(i, this.hf.getHeight(x, z) - at.y + 0.38);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4844, roughness: 0.94, metalness: 0 });
    mat.name = 'Apron';
    applyAerialPerspective(mat);
    this.apronMaterials.push(mat);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(at);
    m.receiveShadow = true;
    return m;
  }

  readonly apronMaterials: THREE.Material[] = [];

  /** Footprints the forest has to keep out of. */
  get clearings() {
    return this.sites.map((s) => ({
      x: s.centre.x, z: s.centre.z,
      r: s.kind === 'airfield' ? 130 : s.kind === 'convoy' ? 120 : 70,
    }));
  }

  /** Room for the enemy-aircraft module to hang parked jets on the airfield. */
  addParked(node: THREE.Object3D, pos: THREE.Vector3, yaw: number) {
    const site = this.sites.find((s) => s.kind === 'airfield');
    if (!site) return null;
    return this.addProp(site, node, pos, yaw, 6.0, 150, 0.15, 5.0, 'aircraft', 'Appareil au sol');
  }

  get airfieldCentre() { return this.sites.find((s) => s.kind === 'airfield')?.centre ?? null; }

  update(dt: number, night: number) {
    this.t += dt;
    for (const s of this.spinners) s.node.rotation.y += s.rate * dt;
    // A moored boat is never still. Two out-of-phase sines are enough to say so.
    for (const f of this.floaters) {
      const p = this.t + f.phase;
      f.node.rotation.z = Math.sin(p * 0.62) * 0.045 + Math.sin(p * 1.13) * 0.018;
      f.node.rotation.x = Math.sin(p * 0.83 + 1.2) * 0.022;
      f.node.position.y = 0.45 + Math.sin(p * 0.71) * 0.22;
    }
    for (const s of this.sites) s.update(dt, night);
  }
}
