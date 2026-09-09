import * as THREE from 'three';
import { RUNWAY } from './Heightfield';
import { applyAerialPerspective } from '../sky/AerialPerspective';

/** Asphalt runway with painted markings (threshold bars, numbers, centreline), taxiway/apron and edge lights. */
export class Runway extends THREE.Group {
  readonly lights: THREE.InstancedMesh;
  private lightMat: THREE.MeshStandardMaterial;

  constructor(loader: THREE.TextureLoader, maxTextureSize = 8192) {
    super();
    const tex = (p: string, srgb = false) => { const t = loader.load(p); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 16; return t; };
    const diff = tex('/textures/runway/diff.jpg', true), nor = tex('/textures/runway/nor.jpg'), rough = tex('/textures/runway/rough.jpg'), ao = tex('/textures/runway/ao.jpg');
    const marks = Runway.markingsTexture(maxTextureSize);
    const L = RUNWAY.length, W = RUNWAY.width;
    const mat = new THREE.MeshStandardMaterial({ map: diff, normalMap: nor, roughnessMap: rough, aoMap: ao, roughness: 1.0, metalness: 0, color: 0xb8b8b8 });
    mat.normalScale.set(0.6, 0.6);
    (mat as any)._apKey = 'runway';
    applyAerialPerspective(mat, (s) => {
      s.uniforms.tMarks = { value: marks };
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tMarks; varying vec2 vMarkUv;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 mk = texture2D(tMarks, vMarkUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, mk.rgb * (0.6 + 0.4 * diffuseColor.r * 2.0), mk.a * 0.85);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, texture2D(tMarks, vMarkUv).a * 0.6);');
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMarkUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMarkUv = uv;');
    });
    const geo = new THREE.PlaneGeometry(L, W, 1, 1);
    geo.rotateX(-Math.PI / 2);
    // Tile the asphalt textures: uv repeat handled by scaling the uv attribute through a second set
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv.array.slice(), 2));
    diff.repeat.set(L / 12, W / 12); nor.repeat.copy(diff.repeat); rough.repeat.copy(diff.repeat); ao.repeat.copy(diff.repeat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(RUNWAY.x, RUNWAY.y + 0.06, RUNWAY.z);
    mesh.receiveShadow = true;
    this.add(mesh);

    // Apron (parking) south of the runway centre
    const apronMat = mat.clone();
    (apronMat as any)._apKey = 'runway';
    apronMat.onBeforeCompile = mat.onBeforeCompile;
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(140, 70).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: diff, normalMap: nor, roughnessMap: rough, aoMap: ao, roughness: 1, color: 0xa8a8a8 }));
    applyAerialPerspective(apron.material);
    apron.position.set(RUNWAY.x - 300, RUNWAY.y + 0.05, RUNWAY.z + 60);
    apron.receiveShadow = true;
    this.add(apron);
    const taxi = new THREE.Mesh(new THREE.PlaneGeometry(18, 50).rotateX(-Math.PI / 2), apron.material);
    taxi.position.set(RUNWAY.x - 300, RUNWAY.y + 0.05, RUNWAY.z + 32);
    this.add(taxi);

    // Edge lights (white) + threshold (green/red) — instanced small emissive spheres.
    const count = (Math.floor(L / 60) + 1) * 2 + 16;
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
    this.lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), this.lightMat, count);
    const m = new THREE.Matrix4(); let k = 0;
    const colors: THREE.Color[] = [];
    for (let x = -L / 2; x <= L / 2; x += 60) for (const side of [-1, 1]) {
      m.setPosition(RUNWAY.x + x, RUNWAY.y + 0.35, RUNWAY.z + side * (W / 2 + 1.5)); this.lights.setMatrixAt(k++, m); colors.push(new THREE.Color(0xfff2d0));
    }
    for (let i = 0; i < 8; i++) for (const end of [-1, 1]) {
      m.setPosition(RUNWAY.x + end * (L / 2 + 2), RUNWAY.y + 0.35, RUNWAY.z - W / 2 + 2 + i * (W - 4) / 7); this.lights.setMatrixAt(k++, m); colors.push(new THREE.Color(0x30ff60));
    }
    this.lights.count = k;
    this.lights.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(k * 3), 3);
    colors.forEach((c, i) => this.lights.setColorAt(i, c));
    this.lights.castShadow = false;
    this.add(this.lights);
  }

  setNight(night: number) { this.lightMat.emissiveIntensity = 4 * night + 0.02; }

  /**
   * Painted markings, drawn once onto a canvas stretched over the strip.
   *
   * Resolution matters more than it looks: the aircraft starts a few metres from the
   * threshold, so the runway designator is magnified enormously and a coarse texture
   * turns it into two grey smudges. 8192 x 512 gives about seven pixels per metre along
   * the strip and seventeen across, which holds up from the cockpit.
   */
  static markingsTexture(maxSize = 8192): THREE.CanvasTexture {
    const W = Math.min(8192, maxSize), H = Math.min(512, maxSize >> 4); // along runway, across
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const px = W / RUNWAY.length; // px per metre along
    const py = H / RUNWAY.width;
    g.fillStyle = 'rgba(240,240,235,0.9)';
    // threshold bars
    for (const end of [0, 1]) {
      const x0 = end === 0 ? 8 * px : W - 38 * px;
      for (let i = 0; i < 8; i++) { const y = (2.2 + i * 3.45) * py; g.fillRect(x0, y, 30 * px, 1.7 * py); }
      // numbers
      g.save(); g.font = `bold ${Math.floor(15 * py)}px Inter, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.translate(end === 0 ? 58 * px : W - 58 * px, H / 2); g.rotate(end === 0 ? Math.PI / 2 : -Math.PI / 2);
      g.fillText(end === 0 ? '09' : '27', 0, 0); g.restore();
    }
    // centreline dashes 30 m long, 20 m gap
    for (let x = 80; x < RUNWAY.length - 80; x += 50) g.fillRect(x * px, H / 2 - 0.45 * py, 30 * px, 0.9 * py);
    // side stripes
    g.fillRect(45 * px, 1.0 * py, W - 90 * px, 0.9 * py); g.fillRect(45 * px, H - 1.9 * py, W - 90 * px, 0.9 * py);
    // touchdown zone bars
    for (const end of [0, 1]) for (let i = 0; i < 3; i++) {
      const x = end === 0 ? (150 + i * 150) * px : W - (150 + i * 150 + 22) * px;
      for (const s of [-1, 1]) g.fillRect(x, H / 2 + s * 6 * py - (s > 0 ? 0 : 1.5 * py), 22 * px, 1.5 * py);
    }
    // weathering: fade the paint randomly
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) d[i + 3] *= 0.55 + 0.45 * Math.random();
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
}
