import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import { STORES, PylonId, Loadout, PylonState } from './Armament';

/**
 * The stores hanging under the wings.
 *
 * One glTF holds every weapon as a separate object at the origin, nose along +Z, and
 * the rack clones the one each pylon is carrying and sits it under the pylon by half
 * its own diameter. Rebuilding the whole rack whenever the loadout changes is cheap
 * (six clones of a few hundred triangles) and removes every chance of the picture and
 * the armament state drifting apart — which is the bug that matters here, because the
 * player checks what is left by looking at the wing.
 */
export class StoreRack {
  private static source: THREE.Object3D | null = null;
  private static prepared = new Map<string, THREE.Object3D>();
  /** The live node per pylon, so a launch can detach exactly the right one. */
  private nodes = new Map<PylonId, THREE.Object3D>();
  private host: THREE.Object3D | null = null;
  private locators: Record<string, THREE.Vector3> = {};
  materials: THREE.Material[] = [];

  static async preload(url = '/models/stores.glb') {
    if (StoreRack.source) return;
    const gltf = await new GLTFLoader().loadAsync(url);
    StoreRack.source = gltf.scene;
    const patched = new Map<THREE.Material, THREE.Material>();
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (patched.has(m)) continue;
        patched.set(m, m);
        // Stores are metal and paint hanging in the same air as the airframe, so they
        // need the same distance wash or they float in front of the haze.
        applyAerialPerspective(m);
      }
    });
    // The exporter splits an object into one mesh per material under a group named
    // after the object, so the thing worth cloning is the direct child of the scene,
    // not the meshes inside it.
    for (const child of gltf.scene.children) StoreRack.prepared.set(child.name, child);
  }

  /** Every material the rack can show, so the engine can wire them into the shadows. */
  static allMaterials(): THREE.Material[] {
    const out = new Set<THREE.Material>();
    StoreRack.source?.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) out.add(mm);
    });
    return [...out];
  }

  /** Point the rack at an aircraft. Pass the aircraft's locator table. */
  bind(host: THREE.Object3D, locators: Record<string, THREE.Vector3>) {
    this.clear();
    this.host = host;
    this.locators = locators;
  }

  clear() {
    for (const n of this.nodes.values()) n.parent?.remove(n);
    this.nodes.clear();
  }

  /** Where a pylon's store sits, in the host's local frame. */
  private seat(py: PylonState): THREE.Vector3 | null {
    const anchor = this.locators['Store_' + py.id];
    if (!anchor || !py.store) return null;
    const sp = STORES[py.store];
    return new THREE.Vector3(anchor.x, anchor.y - sp.diameter * 0.5 - 0.02,
      anchor.z + (sp.mountOffset ?? 0));
  }

  /** Rebuild every station from the loadout. */
  rebuild(loadout: Loadout) {
    this.clear();
    if (!this.host || !StoreRack.source) return;
    for (const py of loadout.pylons) {
      if (!py.store) continue;
      const sp = STORES[py.store];
      // A missile that has been fired leaves nothing behind; a pod stays, empty.
      const visible = sp.kind === 'rocketpod' || sp.kind === 'dispenser' || py.remaining > 0;
      if (!visible) continue;
      const src = StoreRack.prepared.get(sp.model);
      if (!src) continue;
      const node = src.clone(true);
      const seat = this.seat(py);
      if (!seat) continue;
      node.position.copy(seat);
      node.name = 'Store_' + py.id;
      this.host.add(node);
      this.nodes.set(py.id, node);
    }
  }

  /**
   * World transform of the store on a pylon, for the moment it is released. Falls
   * back to the seat position when the store is already gone (a pod firing its last
   * rocket still has a muzzle).
   */
  launchPoint(py: PylonState, outPos: THREE.Vector3, outQuat: THREE.Quaternion): boolean {
    if (!this.host) return false;
    const node = this.nodes.get(py.id);
    this.host.updateMatrixWorld(true);
    if (node) {
      node.getWorldPosition(outPos);
      node.getWorldQuaternion(outQuat);
      return true;
    }
    const seat = this.seat(py);
    if (!seat) return false;
    outPos.copy(seat).applyMatrix4(this.host.matrixWorld);
    this.host.getWorldQuaternion(outQuat);
    return true;
  }

  /** Take the visible store off a station without rebuilding the whole rack. */
  detach(id: PylonId) {
    const n = this.nodes.get(id);
    if (n) { n.parent?.remove(n); this.nodes.delete(id); }
  }

  /** A detached copy of a store's mesh, for the object that now flies on its own. */
  static spawnMesh(modelName: string): THREE.Object3D | null {
    const src = StoreRack.prepared.get(modelName);
    return src ? src.clone(true) : null;
  }
}
