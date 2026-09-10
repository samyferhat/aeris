import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import { Heightfield } from '../world/Heightfield';
import { CombatFx } from './Effects';
import { DamageTarget } from './Ordnance';

/**
 * The other side.
 *
 * The airframe is the same MiG, loaded a second time and repainted: bare light grey,
 * no stars, no bort number. Reusing the model is not a shortcut so much as the point —
 * the aircraft you are chasing has to be as convincing as the one you are flying, and
 * a second detailed fighter would cost a day of modelling to be seen from behind.
 *
 * The flying is deliberately simple and deliberately legible. Four states, each with a
 * shape the player can read at a glance: run, turn, climb away, and break with flares.
 * A subtle dogfight AI is worth nothing here; an opponent whose next move you can guess
 * one second ahead is worth everything, because that is what makes chasing it fun.
 */

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** A burning flare: the thing an infrared seeker prefers to the aircraft. */
class Decoy implements DamageTarget {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly radius = 26;
  readonly decoy = true;
  alive = true;
  life = 4.2;
  heat = 2.6;
  damage() { /* a flare is not a target */ }
}

type State = 'cruise' | 'turn' | 'climb' | 'break';

export class Enemy implements DamageTarget {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly radius = 7.0;
  alive = true;
  hp = 260;
  /** Reheat makes it the brightest thing in the sky, which is how a seeker finds it. */
  heat = 1.0;
  name = 'Chasseur';

  state: State = 'cruise';
  private stateTime = 0;
  private bankTarget = 0;
  private bank = 0;
  private pitchTarget = 0;
  private pitch = 0;
  private throttle = 0.85;
  private flareTimer = 0;
  private smokeTimer = 0;
  /** 0 = healthy, 1 = about to come apart. */
  private hurt = 0;
  private spiral = 0;
  /** Seconds until it can shoot again. Long, on purpose: this is not a duel. */
  private shotCooldown = 8 + Math.random() * 10;
  /** Set by the world when this one has taken a shot, so the HUD can warn. */
  onLaunch: ((from: THREE.Vector3) => void) | null = null;

  constructor(readonly node: THREE.Object3D, private hf: Heightfield, private fx: CombatFx) {}

  damage(amount: number, at: THREE.Vector3) {
    if (!this.alive) return;
    this.hp -= amount;
    this.fx.impact(at, _v.copy(at).sub(this.position).normalize(), 1.0, 'metal');
    this.hurt = THREE.MathUtils.clamp(1 - this.hp / 260, 0, 1);
    if (this.hp <= 0 && this.spiral <= 0) {
      // Not destroyed outright: a hit fighter loses its engine, trails fire, and goes
      // down in a spiral. Watching that happen is the reward, not a puff of smoke.
      this.spiral = 1;
      this.fx.explosion(this.position, 1.3, 'air');
    }
  }

  /** True once it has gone in. */
  private crash() {
    this.alive = false;
    this.fx.explosion(this.position, 2.6, 'ground');
    this.node.visible = false;
  }

  /** Somebody is shooting at it: break hard and put out flares. */
  threaten() {
    if (this.state !== 'break') { this.state = 'break'; this.stateTime = 0; }
  }

  update(dt: number, player: THREE.Vector3, threat: boolean, night: number) {
    if (!this.alive) return;
    this.stateTime += dt;

    if (this.spiral > 0) {
      // --- going down -------------------------------------------------------
      this.bank = THREE.MathUtils.lerp(this.bank, 1.5, 1 - Math.exp(-0.8 * dt));
      this.pitch = THREE.MathUtils.lerp(this.pitch, -0.55, 1 - Math.exp(-0.5 * dt));
      this.velocity.y -= 9.0 * dt;
      this.velocity.multiplyScalar(Math.exp(-0.06 * dt));
      this.position.addScaledVector(this.velocity, dt);
      this.orient(dt, 3.0);
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.03;
        _v.copy(this.velocity).multiplyScalar(-0.12);
        this.fx.damageTrail(this.position, _v, 1.0);
      }
      if (this.position.y <= Math.max(0, this.hf.getHeight(this.position.x, this.position.z)) + 4) this.crash();
      this.node.position.copy(this.position);
      this.node.quaternion.copy(this.quaternion);
      return;
    }

    // --- decide -------------------------------------------------------------
    const toPlayer = _v.copy(player).sub(this.position);
    const range = toPlayer.length();

    // --- shoot back ---------------------------------------------------------
    // Only from a sensible position and rarely. The point of an enemy shot is the
    // warning and the two seconds of deciding what to do about it, not attrition.
    this.shotCooldown -= dt;
    _v2.copy(FWD).applyQuaternion(this.quaternion);
    const aspect = range > 1 ? toPlayer.clone().divideScalar(range).dot(_v2) : 0;
    if (this.shotCooldown <= 0 && range > 1200 && range < 6500 && aspect > 0.86) {
      this.shotCooldown = 16 + Math.random() * 14;
      this.onLaunch?.(this.position);
    }
    const agl = this.position.y - Math.max(0, this.hf.getHeight(this.position.x, this.position.z));

    if (threat && this.state !== 'break') { this.state = 'break'; this.stateTime = 0; }
    if (this.state === 'break' && this.stateTime > 5.0) { this.state = 'turn'; this.stateTime = 0; }
    if (this.state === 'cruise' && this.stateTime > 4 + Math.random() * 4) {
      this.state = range < 2500 ? 'turn' : 'climb';
      this.stateTime = 0;
      this.bankTarget = (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.5);
    }
    if ((this.state === 'turn' || this.state === 'climb') && this.stateTime > 5 + Math.random() * 4) {
      this.state = 'cruise'; this.stateTime = 0;
    }
    // Never fly into the sea or a hill, whatever else it was doing.
    const floor = agl < 260;

    switch (this.state) {
      case 'cruise':
        this.bankTarget = Math.sin(this.stateTime * 0.35) * 0.20;
        this.pitchTarget = 0;
        this.throttle = 0.82;
        break;
      case 'turn':
        this.pitchTarget = 0.16;
        this.throttle = 0.95;
        break;
      case 'climb':
        this.bankTarget = Math.sin(this.stateTime * 0.5) * 0.35;
        this.pitchTarget = 0.34;
        this.throttle = 1.0;
        break;
      case 'break':
        // A hard defensive turn, always away from whoever is behind.
        _v2.copy(FWD).applyQuaternion(this.quaternion);
        this.bankTarget = (toPlayer.dot(_v3.crossVectors(UP, _v2)) > 0 ? -1 : 1) * 1.35;
        this.pitchTarget = 0.30;
        this.throttle = 1.0;
        this.flareTimer -= dt;
        if (this.flareTimer <= 0) {
          this.flareTimer = 0.35;
          this.dropFlare(night);
        }
        break;
    }
    if (floor) { this.pitchTarget = Math.max(this.pitchTarget, 0.30); this.bankTarget *= 0.25; }
    if (this.position.y > 5200) this.pitchTarget = Math.min(this.pitchTarget, -0.05);

    this.bank += (this.bankTarget - this.bank) * (1 - Math.exp(-2.2 * dt));
    this.pitch += (this.pitchTarget - this.pitch) * (1 - Math.exp(-1.8 * dt));

    // --- fly ----------------------------------------------------------------
    const speed = THREE.MathUtils.lerp(190, 330, this.throttle);
    _v2.copy(FWD).applyQuaternion(this.quaternion);
    // Bank produces turn rate: g = tan(bank), turn rate = g·sin(bank)/V, near enough.
    const turnRate = (9.81 * Math.tan(THREE.MathUtils.clamp(this.bank, -1.45, 1.45))) / Math.max(60, speed);
    _q.setFromAxisAngle(UP, -turnRate * dt);
    _v2.applyQuaternion(_q);
    _v2.y += this.pitch * dt * 1.4;
    _v2.normalize();
    this.velocity.copy(_v2).multiplyScalar(speed);
    this.position.addScaledVector(this.velocity, dt);
    // Reheat when it is working, which is also when a seeker can see it best.
    this.heat = 0.7 + 1.1 * Math.max(0, this.throttle - 0.9) * 10 * 0.1 + (this.state === 'break' ? 0.6 : 0);

    this.orient(dt, 4.0);
    if (this.hurt > 0.45) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.08;
        _v.copy(this.velocity).multiplyScalar(-0.1);
        this.fx.damageTrail(this.position, _v, this.hurt);
      }
    }
    this.node.position.copy(this.position);
    this.node.quaternion.copy(this.quaternion);
  }

  private orient(dt: number, rate: number) {
    if (this.velocity.lengthSq() < 1) return;
    _v3.copy(this.velocity).normalize();
    _q2.setFromUnitVectors(FWD, _v3);
    // Roll about the track by the bank angle, so a turn looks like a turn.
    _q.setFromAxisAngle(FWD, -this.bank);
    _q2.multiply(_q);
    this.quaternion.slerp(_q2, 1 - Math.exp(-rate * dt));
  }

  readonly decoys: Decoy[] = [];

  private dropFlare(night: number) {
    _v.copy(this.position).addScaledVector(_v2.copy(FWD).applyQuaternion(this.quaternion), -6);
    const d = new Decoy();
    d.position.copy(_v);
    d.velocity.copy(this.velocity).multiplyScalar(0.55);
    d.velocity.y -= 8;
    d.velocity.x += (Math.random() - 0.5) * 20;
    d.velocity.z += (Math.random() - 0.5) * 20;
    this.decoys.push(d);
    this.fx.flare(_v, d.velocity, night);
  }

  stepDecoys(dt: number, night: number) {
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      d.life -= dt;
      if (d.life <= 0) { d.alive = false; this.decoys.splice(i, 1); continue; }
      d.velocity.y -= 6.5 * dt;
      d.velocity.multiplyScalar(Math.exp(-0.9 * dt));
      d.position.addScaledVector(d.velocity, dt);
      this.fx.flare(d.position, d.velocity, night);
    }
  }
}

/** Loads the grey airframe once and hands out copies. */
export class EnemyFleet extends THREE.Group {
  private static source: THREE.Object3D | null = null;
  private static mats: THREE.Material[] = [];
  readonly fighters: Enemy[] = [];

  static async preload(url = '/models/mig29.glb') {
    if (EnemyFleet.source) return;
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    // Strip everything that only exists for the player's own cockpit. From outside it
    // is never seen, and it is a third of the model's triangles.
    const drop = ['Panel', 'Console_L', 'Console_R', 'Stick', 'Throttles', 'Seat',
      'Rudder_Pedals', 'Cockpit_Tub', 'HUD_Glass'];
    for (const n of drop) {
      const o = root.getObjectByName(n);
      o?.parent?.remove(o);
    }
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = mats.map((m) => {
        const name = m.name;
        // Plain unmarked grey: no stars, no bort number, no camouflage. Adversary
        // aircraft in an exercise are painted exactly like this.
        const std = new THREE.MeshStandardMaterial({
          color: name === 'Canopy' ? 0x2a3038 : name === 'Metal_Nozzle' ? 0x3a3634
            : name === 'Rubber_Tire' ? 0x141414 : 0x84888c,
          roughness: name === 'Canopy' ? 0.08 : 0.62,
          metalness: name === 'Metal_Nozzle' ? 0.85 : 0.0,
          transparent: name === 'Canopy',
          opacity: name === 'Canopy' ? 0.45 : 1,
        });
        std.name = 'Enemy_' + name;
        if (!seen.has(std)) { seen.add(std); applyAerialPerspective(std); EnemyFleet.mats.push(std); }
        return std;
      });
      mesh.material = out.length === 1 ? out[0] : out;
    });
    EnemyFleet.source = root;
  }

  static allMaterials() { return EnemyFleet.mats; }

  static body(): THREE.Object3D | null {
    return EnemyFleet.source ? EnemyFleet.source.clone(true) : null;
  }

  constructor(private hf: Heightfield, private fx: CombatFx) {
    super();
    this.frustumCulled = false;
  }

  /** An airborne opponent. */
  spawn(at: THREE.Vector3, heading: number, speed = 250): Enemy | null {
    const body = EnemyFleet.body();
    if (!body) return null;
    this.add(body);
    const e = new Enemy(body, this.hf, this.fx);
    e.position.copy(at);
    e.quaternion.setFromAxisAngle(UP, heading);
    e.velocity.copy(FWD).applyQuaternion(e.quaternion).multiplyScalar(speed);
    body.position.copy(at);
    body.quaternion.copy(e.quaternion);
    this.fighters.push(e);
    return e;
  }

  /** A jet sitting on the enemy apron, gear down, going nowhere. */
  static parked(): THREE.Object3D | null {
    const b = EnemyFleet.body();
    if (!b) return null;
    b.scale.setScalar(1);
    return b;
  }

  /** Everything the ordnance can hit, decoys included. */
  collectTargets(out: DamageTarget[]) {
    for (const f of this.fighters) {
      if (f.alive) out.push(f);
      for (const d of f.decoys) if (d.alive) out.push(d);
    }
  }

  update(dt: number, player: THREE.Vector3, threatened: (e: Enemy) => boolean, night: number) {
    for (const f of this.fighters) {
      f.update(dt, player, threatened(f), night);
      f.stepDecoys(dt, night);
    }
  }
}
