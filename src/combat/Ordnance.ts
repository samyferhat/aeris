import * as THREE from 'three';
import { Heightfield } from '../world/Heightfield';
import { FlightModel } from '../aircraft/FlightModel';
import { CombatFx } from './Effects';
import { StoreRack } from './StoreRack';
import { GUN, STORES, StoreSpec, Loadout, PylonState, S8_MODEL } from './Armament';

/**
 * Anything a weapon can be aimed at. Ground sites and enemy aircraft both implement
 * it, so the ordnance never needs to know which it is hitting.
 */
export interface DamageTarget {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** Hit sphere, metres. */
  readonly radius: number;
  alive: boolean;
  /** Infrared signature, roughly 0..2. A jet in reheat is the brightest thing about. */
  readonly heat: number;
  /** Called on a hit. `point` is where, in world space. */
  damage(amount: number, point: THREE.Vector3): void;
  /** True while the thing is a decoy rather than a real target. */
  readonly decoy?: boolean;
  readonly name?: string;
}

type Kind = 'bullet' | 'missile' | 'rocket' | 'bomb';

interface Round {
  kind: Kind;
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  age: number;
  life: number;
  spec: StoreSpec | null;
  mesh: THREE.Object3D | null;
  fins: THREE.Object3D | null;
  /** Seconds of free fall left before the motor lights. */
  drop: number;
  /** Seconds of motor burn left. */
  burn: number;
  target: DamageTarget | null;
  /** Whoever fired it. A round must not collide with its own launcher. */
  owner: DamageTarget | null;
  smokeTimer: number;
  /** Fin deflection, for the visible control surfaces. */
  finDefl: THREE.Vector2;
  /** Width of the smoke trail, m. A pod-fired rocket is not as wide as its pod. */
  trailScale: number;
  /** Where the round was last frame, so the trail can be laid along the path. */
  prev: THREE.Vector3;
  spin: number;
  /** Tracer flag for a gun round. */
  tracer: boolean;
  damage: number;
  blast: number;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
// Scratch used inside stepGuided only. Reusing _a there silently destroyed the
// collision segment the caller had just stashed in it, and every round flew
// through the world untouched.
const _a2 = new THREE.Vector3(), _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
// Guidance gets its own set too, for the same reason.
const _g1 = new THREE.Vector3(), _g2 = new THREE.Vector3(), _g3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);

/** Air density, so a missile at altitude is less draggy — and much faster. */
const rhoAt = (y: number) => 1.225 * Math.exp(-Math.max(0, y) / 8500);

export class Ordnance extends THREE.Group {
  private rounds: Round[] = [];
  private pool: Round[] = [];
  /** Everything that can be shot at, registered by the world. */
  targets: DamageTarget[] = [];
  /**
   * The player, as a target. Registered so enemy missiles have something to chase —
   * and remembered here so the player's own rounds do not collide with the aircraft
   * they were just fired from, which is exactly what happened when it was first added
   * to the list: every burst detonated on the muzzle.
   */
  playerTarget: DamageTarget | null = null;
  /** Fired when something is hit hard enough to matter, for audio and the HUD. */
  onImpact: ((pos: THREE.Vector3, power: number, kind: 'air' | 'ground' | 'fuel') => void) | null = null;
  onFire: ((what: 'gun' | 'missile' | 'rocket' | 'bomb', pos: THREE.Vector3) => void) | null = null;

  private gunTimer = 0;
  private lastSide = 1;
  /** Recoil impulse accumulated this frame, in the aircraft's own axes. */
  readonly recoil = new THREE.Vector3();
  gunFiredThisFrame = false;

  constructor(private fx: CombatFx, private hf: Heightfield, private rack: StoreRack) {
    super();
    this.frustumCulled = false;
  }

  private take(): Round {
    const r = this.pool.pop();
    if (r) { r.alive = true; r.age = 0; return r; }
    return {
      kind: 'bullet', alive: true, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(), age: 0, life: 1, spec: null, mesh: null, fins: null,
      drop: 0, burn: 0, target: null, owner: null, smokeTimer: 0, finDefl: new THREE.Vector2(),
      trailScale: 1, prev: new THREE.Vector3(), spin: 0, tracer: false, damage: 0, blast: 0,
    };
  }

  private release(r: Round) {
    r.alive = false;
    if (r.mesh) { this.remove(r.mesh); r.mesh = null; r.fins = null; }
    r.target = null; r.spec = null; r.owner = null;
    this.pool.push(r);
  }

  // ------------------------------------------------------------------ gun ----

  /**
   * The GSh-30-1. One round every forty milliseconds, each one a real projectile with
   * its own dispersion and drop, one in five drawn as a tracer. The recoil is handed
   * back to the caller so the airframe shakes: at three hundred and fifty newtons
   * average it is not imaginary, and it is most of why a burst feels like something.
   */
  fireGun(dt: number, fm: FlightModel, muzzle: THREE.Vector3, eject: THREE.Vector3,
          loadout: Loadout, trigger: boolean, night: number) {
    this.gunFiredThisFrame = false;
    const interval = 60 / GUN.rpm;
    if (!trigger || loadout.gunRounds <= 0) {
      this.gunTimer = Math.min(this.gunTimer, interval);
      return;
    }
    this.gunTimer += dt;
    let fired = 0;
    while (this.gunTimer >= interval && loadout.gunRounds > 0) {
      this.gunTimer -= interval;
      loadout.gunRounds--;
      fired++;
      // Muzzle position in world space, plus the aircraft's own velocity: a round
      // fired forward from a jet at Mach 0.9 leaves at eleven hundred metres a second.
      _a.copy(muzzle).applyQuaternion(fm.quaternion).add(fm.position);
      _b.copy(FWD).applyQuaternion(fm.quaternion);
      // Dispersion: a small random cone about the bore.
      _c.set(0, 0, 0);
      const s1 = (Math.random() + Math.random() + Math.random() - 1.5) * GUN.dispersion;
      const s2 = (Math.random() + Math.random() + Math.random() - 1.5) * GUN.dispersion;
      _d.set(1, 0, 0).applyQuaternion(fm.quaternion);
      _e.set(0, 1, 0).applyQuaternion(fm.quaternion);
      _c.copy(_b).addScaledVector(_d, s1).addScaledVector(_e, s2).normalize();

      const r = this.take();
      r.kind = 'bullet';
      r.pos.copy(_a);
      r.vel.copy(_c).multiplyScalar(GUN.muzzleVelocity).add(fm.velocity);
      r.life = GUN.range / GUN.muzzleVelocity;
      r.spec = null;
      r.damage = GUN.damage; r.blast = GUN.blast;
      r.tracer = (loadout.gunRounds % GUN.tracerEvery) === 0;
      r.owner = this.playerTarget;
      this.rounds.push(r);

      this.fx.muzzleFlash(_a, _c, fm.velocity, night);
      // Cases go out and down, tumbling, and are left behind at once.
      _d.copy(eject).applyQuaternion(fm.quaternion).add(fm.position);
      _e.set(0.6 + Math.random() * 0.5, -0.35, -0.4).applyQuaternion(fm.quaternion)
        .multiplyScalar(9).add(fm.velocity);
      this.fx.casing(_d, _e);
    }
    if (fired) {
      this.gunFiredThisFrame = true;
      // Impulse = rounds × (mass × muzzle velocity), pushed straight back along the bore.
      const impulse = fired * GUN.roundMass * GUN.muzzleVelocity;
      this.recoil.z -= impulse;
      this.onFire?.('gun', _a);
    }
  }

  // ------------------------------------------------------------- launching ----

  /** Release whatever is on the given station. Returns false if nothing came off. */
  launch(loadout: Loadout, storeId: string, fm: FlightModel, target: DamageTarget | null, night: number): boolean {
    const spec = STORES[storeId];
    if (!spec) return false;
    const py = loadout.nextStation(storeId, this.lastSide);
    if (!py) return false;
    this.lastSide = py.id[0] === 'L' ? -1 : 1;

    if (spec.kind === 'rocketpod') return this.fireSalvo(loadout, py, spec, fm, night);

    if (!this.rack.launchPoint(py, _a, _q1)) { _a.copy(fm.position); _q1.copy(fm.quaternion); }
    py.remaining--;
    this.rack.detach(py.id);
    loadout.onChange?.();

    const r = this.take();
    r.spec = spec;
    r.pos.copy(_a);
    r.quat.copy(_q1);
    r.vel.copy(fm.velocity);
    // Everything is ejected downwards first. On a missile that half second of free
    // fall before the motor lights is the whole readability of a launch.
    r.vel.addScaledVector(_b.set(0, -1, 0).applyQuaternion(fm.quaternion), spec.kind === 'bomb' ? 1.2 : 4.0);
    r.drop = spec.dropTime;
    r.burn = spec.burnTime;
    r.life = spec.life;
    r.target = target;
    r.damage = spec.damage; r.blast = spec.blast;
    r.smokeTimer = 0;
    r.owner = this.playerTarget;
    r.spin = spec.kind === 'bomb' ? 0.55 : 0;
    r.trailScale = Math.max(0.6, spec.diameter * 3.0);
    r.prev.copy(r.pos);
    r.kind = spec.kind === 'bomb' || spec.kind === 'dispenser' ? 'bomb'
      : spec.kind === 'aam' ? 'missile' : 'rocket';
    const mesh = StoreRack.spawnMesh(spec.model);
    if (mesh) {
      mesh.position.copy(r.pos);
      mesh.quaternion.copy(r.quat);
      r.mesh = mesh;
      r.fins = mesh.getObjectByName(spec.model + '_Fins') ?? null;
      this.add(mesh);
    }
    this.rounds.push(r);
    this.onFire?.(r.kind === 'bomb' ? 'bomb' : r.kind === 'missile' ? 'missile' : 'rocket', r.pos);
    return true;
  }

  /**
   * A missile fired by something that has no pylons to speak of — an enemy fighter.
   * Same round, same guidance, same smoke: the shot coming at the player has to be
   * exactly as readable as the one leaving his own wing, or the warning means nothing.
   */
  launchFree(storeId: string, from: THREE.Vector3, quat: THREE.Quaternion,
             carrierVel: THREE.Vector3, target: DamageTarget | null, night: number,
             owner: DamageTarget | null = null) {
    const spec = STORES[storeId];
    if (!spec) return false;
    const r = this.take();
    r.spec = spec;
    r.kind = 'missile';
    r.pos.copy(from);
    r.quat.copy(quat);
    r.vel.copy(carrierVel).addScaledVector(_b.set(0, -1, 0).applyQuaternion(quat), 3.0);
    r.drop = spec.dropTime;
    r.burn = spec.burnTime;
    r.life = spec.life;
    r.target = target;
    r.damage = spec.damage; r.blast = spec.blast;
    r.smokeTimer = 0; r.spin = 0; r.owner = owner;
    r.trailScale = Math.max(0.6, spec.diameter * 3.0);
    r.prev.copy(r.pos);
    const mesh = StoreRack.spawnMesh(spec.model);
    if (mesh) { mesh.position.copy(r.pos); mesh.quaternion.copy(r.quat); r.mesh = mesh; this.add(mesh); }
    this.rounds.push(r);
    this.onFire?.('missile', r.pos);
    return true;
  }

  /**
   * A pod emptying itself. Real salvos are rippled a few milliseconds apart, which is
   * exactly what makes them look like a salvo and not a shotgun: the rockets fan out
   * in sequence and the smoke builds up over the whole burst.
   */
  private pendingSalvo: { py: PylonState; spec: StoreSpec; left: number; timer: number; loadout: Loadout }[] = [];

  private fireSalvo(loadout: Loadout, py: PylonState, spec: StoreSpec, _fm: FlightModel, _night: number) {
    if (py.remaining <= 0) return false;
    const already = this.pendingSalvo.find((s) => s.py === py);
    if (already) return false;
    // A pod goes off in a burst of ten, or whatever is left.
    this.pendingSalvo.push({ py, spec, left: Math.min(10, py.remaining), timer: 0, loadout });
    return true;
  }

  private stepSalvo(dt: number, fm: FlightModel, night: number) {
    for (let i = this.pendingSalvo.length - 1; i >= 0; i--) {
      const s = this.pendingSalvo[i];
      s.timer -= dt;
      while (s.timer <= 0 && s.left > 0 && s.py.remaining > 0) {
        s.timer += 0.055;
        s.left--; s.py.remaining--;
        if (!this.rack.launchPoint(s.py, _a, _q1)) { _a.copy(fm.position); _q1.copy(fm.quaternion); }
        // Spread the tubes across the pod's face so the salvo leaves as a cone.
        const ang = Math.random() * Math.PI * 2, rad = 0.10 + Math.random() * 0.13;
        _b.set(Math.cos(ang) * rad, Math.sin(ang) * rad, 0).applyQuaternion(_q1);
        const r = this.take();
        r.kind = 'rocket';
        r.spec = s.spec;
        r.pos.copy(_a).add(_b);
        r.quat.copy(_q1);
        _c.copy(FWD).applyQuaternion(_q1);
        // A touch of scatter on the launch direction: this is a rocket, not a missile.
        _c.addScaledVector(_b, 0.55).normalize();
        r.vel.copy(fm.velocity).addScaledVector(_c, 22);
        r.drop = 0; r.burn = s.spec.burnTime; r.life = s.spec.life;
        // The thing in the air is an eighty-millimetre rocket, not the half-metre pod
        // it came out of: taking the trail width from the pod gave a smoke column four
        // times too wide, which is most of why a salvo read as a row of clouds.
        r.trailScale = 1.7;
        r.prev.copy(r.pos);
        r.damage = s.spec.damage; r.blast = s.spec.blast;
        r.target = null; r.owner = this.playerTarget; r.smokeTimer = 0; r.spin = 0;
        const mesh = StoreRack.spawnMesh(S8_MODEL);
        if (mesh) { mesh.position.copy(r.pos); mesh.quaternion.copy(r.quat); r.mesh = mesh; this.add(mesh); }
        this.rounds.push(r);
        this.fx.motorIgnite(r.pos, _c.clone().negate(), night, 0.42);
        this.onFire?.('rocket', r.pos);
      }
      if (s.left <= 0 || s.py.remaining <= 0) {
        this.pendingSalvo.splice(i, 1);
        s.loadout.onChange?.();
      }
    }
  }

  // ---------------------------------------------------------------- update ----

  update(dt: number, fm: FlightModel, night: number) {
    this.recoil.set(0, 0, 0);
    this.stepSalvo(dt, fm, night);

    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i];
      r.age += dt;
      if (r.age >= r.life) {
        if (r.kind === 'missile' || r.kind === 'rocket') this.detonate(r, r.pos, 'air');
        this.rounds.splice(i, 1); this.release(r); continue;
      }

      _a.copy(r.pos);   // segment start, for the swept collision test

      if (r.kind === 'bullet') {
        r.vel.y -= 9.81 * dt;
        // Bullets slow down; at thirty millimetres it is slight but it is there.
        r.vel.multiplyScalar(Math.exp(-0.055 * dt));
        r.pos.addScaledVector(r.vel, dt);
        if (r.tracer) this.fx.tracer(r.pos, r.vel, 0.05, 14, 0.34);
      } else {
        this.stepGuided(dt, r, night);
      }

      const hit = this.collide(_a, r.pos, r);
      if (hit) { this.rounds.splice(i, 1); this.release(r); }
    }
  }

  /** One integration step for anything with a body: missile, rocket or bomb. */
  private stepGuided(dt: number, r: Round, night: number) {
    const spec = r.spec!;
    const speed = r.vel.length();
    const rho = rhoAt(r.pos.y);

    // --- motor -------------------------------------------------------------
    if (r.drop > 0) {
      r.drop -= dt;
      if (r.drop <= 0 && spec.thrust > 0) {
        _b.copy(FWD).applyQuaternion(r.quat).negate();
        this.fx.motorIgnite(r.pos, _b, night);
      }
    } else if (r.burn > 0) {
      r.burn -= dt;
      _b.copy(FWD).applyQuaternion(r.quat);
      // The motor pushes along the body, not along the velocity: that difference is
      // what lets a missile point where it is going and still slide sideways.
      r.vel.addScaledVector(_b, (spec.thrust / Math.max(40, spec.mass)) * dt);
      // Lay the trail along the path travelled, not once a frame: at three hundred
      // metres a second one puff per frame is five metres apart and reads as a string
      // of beads. Spacing it by distance keeps the column continuous at any speed.
      const stepLen = _s1.copy(r.pos).sub(r.prev).length();
      r.smokeTimer += stepLen;
      let guard = 0;
      while (r.smokeTimer >= 1.0 && guard++ < 14) {
        r.smokeTimer -= 1.0;
        _s1.copy(r.prev).lerp(r.pos, stepLen > 1e-4 ? 1 - r.smokeTimer / stepLen : 1);
        _s2.copy(_b).multiplyScalar(-14).add(
          _e.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2.2));
        this.fx.motorTrail(_s1, _s2, r.trailScale);
      }
    }

    // --- guidance ----------------------------------------------------------
    if (r.kind === 'missile' && r.target && r.target.alive && r.drop <= 0) {
      this.guide(dt, r, speed);
    } else if (r.kind === 'bomb') {
      // A bomb tumbles slowly nose-down as the tail drags: the only thing it does.
      r.spin *= Math.exp(-0.3 * dt);
    }

    // --- drag and gravity --------------------------------------------------
    const q = 0.5 * rho * speed * speed;
    if (speed > 0.1) r.vel.addScaledVector(_b.copy(r.vel).divideScalar(speed), -(q * spec.cda / Math.max(40, spec.mass)) * dt);
    r.vel.y -= 9.81 * dt;
    r.pos.addScaledVector(r.vel, dt);

    // --- attitude ----------------------------------------------------------
    if (speed > 1) {
      // Weathercock on to the velocity vector, but lag it: the body angle relative to
      // the track is the angle of attack, and seeing it is how a manoeuvre reads.
      _b.copy(r.vel).normalize();
      _q1.setFromUnitVectors(FWD, _b);
      const rate = r.kind === 'bomb' ? 1.2 : 7.0;
      r.quat.slerp(_q1, 1 - Math.exp(-rate * dt));
    }
    r.prev.copy(r.pos);
    if (r.mesh) {
      r.mesh.position.copy(r.pos);
      r.mesh.quaternion.copy(r.quat);
      if (r.fins) {
        // Control surfaces follow the commanded turn. They are small on screen, but
        // a missile whose fins are frozen looks like a thrown pipe.
        r.fins.rotation.x = r.finDefl.y;
        r.fins.rotation.y = r.finDefl.x;
      }
    }
  }

  /**
   * Proportional navigation: steer to hold the line of sight steady rather than to
   * chase the target's current position. It is what real seekers do, it produces the
   * lead-pursuit curve that reads as intelligence, and it is four lines of maths.
   */
  private guide(dt: number, r: Round, speed: number) {
    const t = r.target!;
    _g1.copy(t.position).sub(r.pos);             // range vector
    const range = _g1.length();
    if (range < 1e-3) return;
    _g2.copy(t.velocity).sub(r.vel);             // closing velocity
    const closing = -_g2.dot(_g1) / range;
    // LOS rotation rate vector: r × v / |r|²
    _g3.crossVectors(_g1, _g2).divideScalar(range * range);
    const N = 3.6;
    // a = N · Vc · (Ω × û)
    _s1.copy(_g1).divideScalar(range);
    _s2.crossVectors(_g3, _s1).multiplyScalar(N * Math.max(closing, speed * 0.35));
    const gLimit = r.spec!.maxG * 9.81;
    if (_s2.lengthSq() > gLimit * gLimit) _s2.setLength(gLimit);
    r.vel.addScaledVector(_s2, dt);
    // Feed the same command to the fins, scaled to something visible.
    _g2.copy(_s2).applyQuaternion(_q2.copy(r.quat).invert()).divideScalar(gLimit);
    r.finDefl.set(THREE.MathUtils.clamp(_g2.x, -1, 1) * 0.38, THREE.MathUtils.clamp(_g2.y, -1, 1) * 0.38);
    // Lose the lock if the target slips outside the seeker's field of view.
    _g1.normalize();
    _g3.copy(FWD).applyQuaternion(r.quat);
    if (_g1.dot(_g3) < Math.cos(r.spec!.seekerFov)) r.target = null;
  }

  // ------------------------------------------------------------- collision ----

  /** Sweep from a to b. Returns true if the round is spent. */
  private collide(a: THREE.Vector3, b: THREE.Vector3, r: Round): boolean {
    // --- targets: closest approach of the segment to each hit sphere
    _c.copy(b).sub(a);
    const segLen2 = _c.lengthSq();
    let best: DamageTarget | null = null, bestT = 2, bestD2 = 0;
    // Nothing is live for the first instant: a warhead is armed after it has cleared
    // the aircraft, and a round leaving a muzzle two metres from its own wing needs
    // that to be true here as well.
    const armed = r.age > 0.06;
    for (const t of this.targets) {
      if (!t.alive || t === r.owner || !armed) continue;
      _d.copy(t.position).sub(a);
      const u = segLen2 > 1e-9 ? THREE.MathUtils.clamp(_d.dot(_c) / segLen2, 0, 1) : 0;
      _e.copy(a).addScaledVector(_c, u);
      const d2 = _e.distanceToSquared(t.position);
      const rad = t.radius + (r.kind === 'bullet' ? 0.2 : r.spec!.diameter);
      if (d2 <= rad * rad && u < bestT) { best = t; bestT = u; bestD2 = d2; }
    }
    if (best) {
      _e.copy(a).addScaledVector(_c, bestT);
      if (best.decoy) {
        // A flare works by being the thing the seeker likes best, not by magic.
        r.target = null;
        return false;
      }
      this.hitTarget(r, best, _e);
      return true;
    }

    // --- ground and sea
    const g = this.hf.getHeight(b.x, b.z);
    const sea = 0;
    if (b.y <= Math.max(g, sea)) {
      const water = g < sea - 0.2;
      // Where along the segment did it cross? Good enough linearly, and it stops
      // impacts appearing a few metres under the surface at rifle speeds.
      const ha = a.y - Math.max(this.hf.getHeight(a.x, a.z), sea);
      const hb = b.y - Math.max(g, sea);
      const u = ha > hb ? THREE.MathUtils.clamp(ha / (ha - hb), 0, 1) : 1;
      _e.copy(a).lerp(b, u);
      _e.y = Math.max(this.hf.getHeight(_e.x, _e.z), sea);
      this.hitGround(r, _e, water);
      return true;
    }
    return false;
  }

  private hitTarget(r: Round, t: DamageTarget, at: THREE.Vector3) {
    t.damage(r.damage, at);
    if (r.kind === 'bullet') {
      _d.copy(r.vel).normalize().negate();
      this.fx.impact(at, _d, 1.0, 'metal');
    } else {
      this.detonate(r, at, 'air');
    }
  }

  private hitGround(r: Round, at: THREE.Vector3, water: boolean) {
    if (r.kind === 'bullet') {
      this.hf.getNormal(at.x, at.z, _d);
      this.fx.impact(at, water ? UP : _d, water ? 1.4 : 1.0, water ? 'water' : 'dirt');
      // A round striking near something still hurts it.
      this.splash(at, r.blast, r.damage * 0.35);
      return;
    }
    this.detonate(r, at, water ? 'air' : 'ground');
  }

  private detonate(r: Round, at: THREE.Vector3, kind: 'air' | 'ground' | 'fuel') {
    const spec = r.spec;
    const power = spec ? THREE.MathUtils.clamp(spec.blast / 14, 0.6, 3.4) : 1;
    this.fx.explosion(at, power, kind, 0);
    this.splash(at, r.blast, r.damage);
    this.onImpact?.(at, power, kind);
  }

  /** Blast damage falling off with distance. */
  private splash(at: THREE.Vector3, radius: number, damage: number) {
    if (radius <= 0) return;
    for (const t of this.targets) {
      if (!t.alive || t.decoy) continue;
      const d = t.position.distanceTo(at) - t.radius;
      if (d > radius) continue;
      const f = 1 - THREE.MathUtils.clamp(d / radius, 0, 1);
      t.damage(damage * f * f, at);
    }
  }

  /**
   * Where a round fired now would end up, and how long it would take.
   *
   * This is the pipper, so it has to agree with the rounds themselves. Sampling the
   * trajectory at points and asking whether any point is near a target does not: at a
   * thousand metres a second even a thirtieth of a second is thirty-four metres, and
   * the prediction steps clean over a lorry. It uses the same swept segment test the
   * live rounds do, over shorter steps, which is why the pipper can be trusted.
   */
  predictGunImpact(fm: FlightModel, out: THREE.Vector3, maxTime = 2.0): number {
    _a.copy(FWD).applyQuaternion(fm.quaternion).multiplyScalar(GUN.muzzleVelocity).add(fm.velocity);
    _b.copy(fm.position);
    const h = 1 / 120;
    for (let t = 0; t < maxTime; t += h) {
      _s1.copy(_b);
      _a.y -= 9.81 * h;
      _a.multiplyScalar(Math.exp(-0.055 * h));
      _b.addScaledVector(_a, h);
      _s2.copy(_b).sub(_s1);
      const segLen2 = _s2.lengthSq();
      for (const tg of this.targets) {
        // The firing aircraft is in the target list so enemy missiles can chase it;
        // skipping it here is what stops the pipper snapping to the player's own nose.
        if (!tg.alive || tg.decoy || tg === this.playerTarget) continue;
        _c.copy(tg.position).sub(_s1);
        // Reject anything the segment cannot possibly reach before doing the maths.
        if (_c.lengthSq() > (segLen2 + tg.radius * tg.radius) * 4 + 400) continue;
        const u = segLen2 > 1e-9 ? THREE.MathUtils.clamp(_c.dot(_s2) / segLen2, 0, 1) : 0;
        _d.copy(_s1).addScaledVector(_s2, u);
        if (_d.distanceToSquared(tg.position) <= tg.radius * tg.radius) { out.copy(_d); return t; }
      }
      const g = Math.max(this.hf.getHeight(_b.x, _b.z), 0);
      if (_b.y <= g) {
        const ha = _s1.y - Math.max(this.hf.getHeight(_s1.x, _s1.z), 0);
        const u = ha > 0 ? THREE.MathUtils.clamp(ha / (ha - (_b.y - g)), 0, 1) : 0;
        out.copy(_s1).lerp(_b, u);
        out.y = Math.max(this.hf.getHeight(out.x, out.z), 0);
        return t;
      }
    }
    out.copy(_b);
    return maxTime;
  }

  get liveCount() { return this.rounds.length; }

  /** True while a guided round is in the air, whoever it is chasing. */
  get missileInbound() {
    for (const r of this.rounds) if (r.kind === 'missile' && r.drop <= 0) return true;
    return false;
  }

  /**
   * Is anything currently chasing this particular target? Asking per target rather
   * than globally matters: with one flag, launching at one fighter sent the whole
   * formation into a break and dumping flares, which reads as clairvoyance.
   */
  chasedBy(t: DamageTarget) {
    for (const r of this.rounds) if (r.kind === 'missile' && r.drop <= 0 && r.target === t) return true;
    return false;
  }
}
