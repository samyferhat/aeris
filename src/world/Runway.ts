import * as THREE from 'three';
import { AIRFIELDS, AirfieldSpec } from './Archipelago';
import { applyAerialPerspective } from '../sky/AerialPerspective';

/**
 * The three airfields: asphalt, painted markings, apron and edge lights.
 *
 * Each strip is built in its own frame — along local +X, centred on the origin — and
 * the group is placed and turned to the compass heading it was given. The main field
 * runs 09/27 and so needs no rotation at all, which is why it looked for a long time
 * as though the class only ever handled one.
 */
export class Runway extends THREE.Group {
  private lightMats: THREE.MeshStandardMaterial[] = [];

  constructor(loader: THREE.TextureLoader, maxTextureSize = 8192) {
    super();
    const tex = (p: string, srgb = false) => {
      const t = loader.load(p);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 16;
      return t;
    };
    const shared = {
      diff: tex('/textures/runway/diff.jpg', true), nor: tex('/textures/runway/nor.jpg'),
      rough: tex('/textures/runway/rough.jpg'), ao: tex('/textures/runway/ao.jpg'),
    };
    for (const af of AIRFIELDS) this.add(this.buildField(af, shared, maxTextureSize));
  }

  private buildField(af: AirfieldSpec, t: { diff: THREE.Texture; nor: THREE.Texture; rough: THREE.Texture; ao: THREE.Texture }, maxTextureSize: number) {
    const g = new THREE.Group();
    g.position.set(af.x, 0, af.z);
    g.rotation.y = -(af.heading - 90) * Math.PI / 180;
    const L = af.length, W = af.width;

    const marks = Runway.markingsTexture(af, maxTextureSize);
    // The asphalt maps are shared between fields, so the repeat has to be baked into the
    // uv attribute rather than set on the texture — one texture, three tiling rates.
    const mat = new THREE.MeshStandardMaterial({
      map: t.diff, normalMap: t.nor, roughnessMap: t.rough, aoMap: t.ao,
      roughness: 1.0, metalness: 0, color: 0xb8b8b8,
    });
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
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const tiled = new Float32Array(uv.array.length);
    for (let i = 0; i < uv.count; i++) { tiled[i * 2] = uv.getX(i) * L / 12; tiled[i * 2 + 1] = uv.getY(i) * W / 12; }
    geo.setAttribute('uv1', new THREE.BufferAttribute(tiled, 2));
    const strip = new THREE.Mesh(geo, mat);
    strip.position.y = af.y + 0.06;
    strip.receiveShadow = true;
    g.add(strip);

    if (af.apron) {
      const a = af.apron;
      const apronMat = new THREE.MeshStandardMaterial({ map: t.diff, normalMap: t.nor, roughnessMap: t.rough, aoMap: t.ao, roughness: 1, color: 0xa8a8a8 });
      applyAerialPerspective(apronMat);
      const ageo = new THREE.PlaneGeometry(a.w, a.d).rotateX(-Math.PI / 2);
      const auv = ageo.attributes.uv as THREE.BufferAttribute;
      const at = new Float32Array(auv.array.length);
      for (let i = 0; i < auv.count; i++) { at[i * 2] = auv.getX(i) * a.w / 12; at[i * 2 + 1] = auv.getY(i) * a.d / 12; }
      ageo.setAttribute('uv1', new THREE.BufferAttribute(at, 2));
      const apron = new THREE.Mesh(ageo, apronMat);
      apron.position.set(a.dx, af.y + 0.05, a.dz);
      apron.receiveShadow = true;
      g.add(apron);
      const taxiD = Math.abs(a.dz) - a.d / 2;
      if (taxiD > 4) {
        const taxi = new THREE.Mesh(new THREE.PlaneGeometry(16, taxiD + 6).rotateX(-Math.PI / 2), apronMat);
        taxi.position.set(a.dx, af.y + 0.05, Math.sign(a.dz) * (Math.abs(a.dz) - a.d / 2 - taxiD / 2 + 3));
        g.add(taxi);
      }
    }

    // Edge lights (white) + threshold (green) — instanced small emissive spheres.
    const spacing = L > 900 ? 60 : 40;
    const count = (Math.floor(L / spacing) + 1) * 2 + 16;
    const lightMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
    this.lightMats.push(lightMat);
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), lightMat, count);
    const m = new THREE.Matrix4(); let k = 0;
    const colors: THREE.Color[] = [];
    for (let x = -L / 2; x <= L / 2; x += spacing) for (const side of [-1, 1]) {
      m.setPosition(x, af.y + 0.35, side * (W / 2 + 1.5)); lights.setMatrixAt(k++, m); colors.push(new THREE.Color(0xfff2d0));
    }
    for (let i = 0; i < 8; i++) for (const end of [-1, 1]) {
      m.setPosition(end * (L / 2 + 2), af.y + 0.35, -W / 2 + 2 + i * (W - 4) / 7); lights.setMatrixAt(k++, m); colors.push(new THREE.Color(0x30ff60));
    }
    lights.count = k;
    lights.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(k * 3), 3);
    colors.forEach((c, i) => lights.setColorAt(i, c));
    lights.castShadow = false;
    g.add(lights);
    return g;
  }

  setNight(night: number) { for (const m of this.lightMats) m.emissiveIntensity = 4 * night + 0.02; }

  /**
   * Painted markings, drawn once onto a canvas stretched over the strip.
   *
   * Resolution matters more than it looks: the aircraft starts a few metres from the
   * threshold, so the runway designator is magnified enormously and a coarse texture
   * turns it into two grey smudges. About seven pixels per metre along the strip and
   * seventeen across holds up from the cockpit.
   */
  static markingsTexture(af: AirfieldSpec, maxSize = 8192): THREE.CanvasTexture {
    const W = Math.min(8192, maxSize), H = Math.min(512, maxSize >> 4); // along runway, across
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const px = W / af.length;
    const py = H / af.width;
    // Designators are the heading in tens of degrees, and the reciprocal at the far end.
    const num = (deg: number) => String(Math.round(((deg % 360) + 360) % 360 / 10) || 36).padStart(2, '0');
    const near = num(af.heading), far = num(af.heading + 180);
    g.fillStyle = 'rgba(240,240,235,0.9)';
    for (const end of [0, 1]) {
      const x0 = end === 0 ? 8 * px : W - 38 * px;
      for (let i = 0; i < 8; i++) { const y = (2.2 + i * (af.width - 4.4) / 7.6) * py; g.fillRect(x0, y, 30 * px, 1.7 * py); }
      g.save(); g.font = `bold ${Math.floor(af.width * 0.44 * py)}px Inter, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.translate(end === 0 ? 58 * px : W - 58 * px, H / 2); g.rotate(end === 0 ? Math.PI / 2 : -Math.PI / 2);
      g.fillText(end === 0 ? near : far, 0, 0); g.restore();
    }
    for (let x = 80; x < af.length - 80; x += 50) g.fillRect(x * px, H / 2 - 0.45 * py, 30 * px, 0.9 * py);
    g.fillRect(45 * px, 1.0 * py, W - 90 * px, 0.9 * py); g.fillRect(45 * px, H - 1.9 * py, W - 90 * px, 0.9 * py);
    for (const end of [0, 1]) for (let i = 0; i < 3; i++) {
      const x = end === 0 ? (150 + i * 150) * px : W - (150 + i * 150 + 22) * px;
      if (x < 0 || x > W) continue;
      for (const s of [-1, 1]) g.fillRect(x, H / 2 + s * af.width * 0.18 * py - (s > 0 ? 0 : 1.5 * py), 22 * px, 1.5 * py);
    }
    // Weathering: fade the paint randomly.
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) d[i + 3] *= 0.55 + 0.45 * Math.random();
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
}
