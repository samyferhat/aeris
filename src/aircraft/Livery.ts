import * as THREE from 'three';

/**
 * Procedural paint for the airframe.
 *
 * The baked atlas that came out of Blender is unusable (the maps exported black), and
 * painting a livery into an automatic UV atlas is guesswork anyway. Instead the paint
 * is evaluated in the aircraft's own coordinate frame: no seams, no texture budget, and
 * crisp at any distance — which matters a lot in the cockpit view, where the cowling
 * fills a third of the screen.
 *
 * Model frame: +Z nose, +Y up, +X left wing. Nose z = +2.5, tail z = -5.96,
 * wings at y ~ 1.0 spanning x = +-5.5, wheels touch at y = -0.9.
 */

/** Shared per-frame uniform: world -> aircraft-root space. */
export const rootInverse = { value: new THREE.Matrix4() };

const LIVERY_GLSL = /* glsl */ `
varying vec3 vRootPos;
varying vec3 vRootNormal;

// Distance to the nearest line of a periodic set, as a 0..1 mask.
float seamMask(float x, float period, float width) {
  float d = abs(x / period - floor(x / period + 0.5)) * period;
  return 1.0 - smoothstep(0.0, width, d);
}
// Regularly spaced dots along an axis.
float dotMask(float x, float period, float radius) {
  float d = abs(x / period - floor(x / period + 0.5)) * period;
  return 1.0 - smoothstep(0.0, radius, d);
}
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}
float fbm3(vec3 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.1) * 0.28 + vnoise(p * 4.3) * 0.17;
}
`;

const LIVERY_BODY = /* glsl */ `
{
  vec3 P = vRootPos;
  vec3 N = normalize(vRootNormal);
  float sideSign = P.x >= 0.0 ? 1.0 : -1.0;
  float ax = abs(P.x);

  // ---- base paint ---------------------------------------------------------
  vec3 white = vec3(0.855, 0.865, 0.870);
  vec3 navy  = vec3(0.018, 0.043, 0.115);
  vec3 red   = vec3(0.330, 0.028, 0.030);
  vec3 col = white;

  // Fuselage cheat line: rises gently toward the tail, like a real 172 sweep.
  float fuse = 1.0 - smoothstep(0.62, 0.92, ax);
  float lineY = -0.02 - P.z * 0.055 + 0.035 * sin(P.z * 0.55);
  float halfW = 0.115 + 0.055 * smoothstep(1.5, -4.0, P.z);
  float band = fuse * (1.0 - smoothstep(halfW, halfW + 0.035, abs(P.y - lineY)));
  float pin  = fuse * (1.0 - smoothstep(0.020, 0.032, abs(P.y - (lineY + halfW + 0.075))));
  col = mix(col, navy, band);
  col = mix(col, red, pin);

  // Fin: navy below a swept line, white above; matching red flash.
  float finZone = smoothstep(-4.55, -4.9, P.z) * smoothstep(0.55, 0.75, P.y);
  float finCut = 1.55 + (P.z + 5.4) * 0.95;
  col = mix(col, navy, finZone * (1.0 - smoothstep(finCut, finCut + 0.06, P.y)));
  col = mix(col, red, finZone * (1.0 - smoothstep(0.045, 0.06, abs(P.y - (finCut + 0.10)))));

  // Wing and stabiliser tips.
  float tip = smoothstep(4.85, 5.25, ax) * step(0.6, P.y);
  col = mix(col, navy, tip);
  float stabTip = smoothstep(1.30, 1.55, ax) * smoothstep(-5.1, -5.4, P.z);
  col = mix(col, navy, stabTip);

  // Anti-glare panel ahead of the windscreen.
  float glare = smoothstep(0.95, 1.15, P.z) * (1.0 - smoothstep(1.95, 2.15, P.z)) * smoothstep(0.42, 0.55, P.y) * fuse;
  col = mix(col, vec3(0.012), glare);

  // ---- registration -------------------------------------------------------
  // Planar projection on both flanks, flipped so it reads correctly from each side.
  float regU = (sideSign > 0.0 ? -P.z : P.z);
  vec2 regUv = vec2((regU + 3.55) / 2.10, (P.y - 0.06) / 0.46);
  float onFlank = step(0.55, ax * 0.0 + abs(N.x)) * fuse;
  if (regUv.x > 0.0 && regUv.x < 1.0 && regUv.y > 0.0 && regUv.y < 1.0 && onFlank > 0.5) {
    float ink = texture2D(uRegMap, vec2(regUv.x, 1.0 - regUv.y)).a;
    col = mix(col, navy * 0.55, ink * 0.94);
  }

  // ---- construction detail ------------------------------------------------
  // Fuselage frames (across) and stringers (along), wing ribs and spar lines.
  float onWing = smoothstep(0.62, 0.85, ax) * smoothstep(0.80, 0.95, P.y) * (1.0 - smoothstep(1.35, 1.5, P.y));
  float frames = seamMask(P.z + 0.11, 0.62, 0.006) * fuse;
  float stringers = seamMask(P.y + 0.07, 0.46, 0.005) * fuse;
  float ribs = seamMask(P.x, 0.58, 0.006) * onWing;
  float spar = seamMask(P.z + 0.34, 0.72, 0.006) * onWing;
  float panelLine = clamp(frames + stringers + ribs + spar, 0.0, 1.0);

  // Rivet rows sit on the panel lines.
  float rivets = clamp(
      frames * dotMask(P.y + 0.03, 0.075, 0.010)
    + stringers * dotMask(P.z, 0.075, 0.010)
    + ribs * dotMask(P.z, 0.075, 0.010)
    + spar * dotMask(P.x, 0.075, 0.010), 0.0, 1.0);

  // ---- wear ---------------------------------------------------------------
  float grime = fbm3(P * 3.1);
  // Exhaust soot: a plume from the stack at (-0.21, -0.41, 1.40) streaming aft.
  vec3 ex = P - vec3(-0.21, -0.41, 1.40);
  float behind = smoothstep(0.0, -0.35, ex.z);
  float plumeR = 0.10 + (-ex.z) * 0.085;
  float soot = behind * (1.0 - smoothstep(plumeR * 0.5, plumeR, length(vec2(ex.x, ex.y + 0.06))))
             * (1.0 - smoothstep(2.6, 4.2, -ex.z)) * (0.55 + 0.65 * grime);
  soot = clamp(soot, 0.0, 1.0) * step(0.0, -P.x);

  // Belly dirt, thrown up by the wheels and the slipstream.
  float belly = (1.0 - smoothstep(-0.42, 0.02, P.y)) * (0.35 + 0.75 * grime) * fuse;
  // Leading-edge scuffing: bug strikes and stone chips.
  float leadEdge = onWing * smoothstep(0.24, 0.40, P.z) * (0.4 + 0.9 * fbm3(P * 9.0));
  float wearMask = clamp(soot * 0.85 + belly * 0.35 + leadEdge * 0.22, 0.0, 1.0);

  col = mix(col, vec3(0.055, 0.050, 0.046), soot * 0.72);
  col = mix(col, col * vec3(0.62, 0.60, 0.55), belly * 0.5);
  col *= 0.94 + 0.12 * grime;                              // uneven fade
  col -= panelLine * 0.035;                                // paint sinks into the seams
  col += rivets * 0.02;

  diffuseColor.rgb = col;

  // ---- surface response ---------------------------------------------------
  vLiveryRough = clamp(0.30 + 0.30 * wearMask + 0.10 * grime + panelLine * 0.12, 0.05, 1.0);
  vLiveryMetal = clamp(leadEdge * 0.30, 0.0, 1.0);
  // Relief height in metres: seams are grooves, rivets are domes, plus a faint
  // orange-peel from the spray gun. Turned into a normal further down.
  // Heights in metres, so the surface-gradient perturbation below needs no fudge factor.
  float peel = (fbm3(P * 62.0) - 0.5) * 0.00022;
  vLiveryHeight = peel - panelLine * 0.0018 + rivets * 0.0009;
}
`;

/** Small canvas texture holding the registration, projected on both flanks. */
function makeRegistrationTexture(text = 'F-AERI'): THREE.CanvasTexture {
  const w = 512, h = 112;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#000';
  g.font = `600 ${Math.floor(h * 0.78)}px Inter, "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.letterSpacing = '6px';
  g.fillText(text, w / 2, h * 0.54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

let regTexture: THREE.CanvasTexture | null = null;

/**
 * Replaces the black baked maps on the airframe paint with the procedural livery and
 * gives it a clearcoat, which is what makes painted metal read as painted metal.
 */
export function applyLivery(material: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  regTexture ??= makeRegistrationTexture();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.35, metalness: 0.0,
    clearcoat: 0.55, clearcoatRoughness: 0.14,
    envMapIntensity: 1.0,
  });
  mat.name = material.name;
  (mat as any)._apKey = 'livery';
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uRootInverse = rootInverse;
    shader.uniforms.uRegMap = { value: regTexture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform mat4 uRootInverse;\n${LIVERY_GLSL}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          vRootPos = (uRootInverse * wp).xyz;
          vRootNormal = normalize(mat3(uRootInverse) * (mat3(modelMatrix) * objectNormal));
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uRegMap;
        ${LIVERY_GLSL}
        float vLiveryRough; float vLiveryMetal; float vLiveryHeight;

        // Normal perturbation from a height field without tangents or UVs
        // (Morten Mikkelsen's surface-gradient form), so it works on any mesh.
        vec3 perturbFromHeight(vec3 n, vec3 viewPos, float h, float strength) {
          vec3 dpx = dFdx(viewPos), dpy = dFdy(viewPos);
          float dhx = dFdx(h), dhy = dFdy(h);
          vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          return normalize(abs(det) * n - strength * grad);
        }`)
      .replace('#include <map_fragment>', LIVERY_BODY)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vLiveryRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = max(metalness, vLiveryMetal);')
      .replace('#include <normal_fragment_maps>', 'normal = perturbFromHeight(normal, -vViewPosition, vLiveryHeight, 1.0);');
  };
  material.dispose();
  return mat;
}

/** Dark scratched cockpit metal: the baked map was black, so it is procedural too. */
export function applyCockpitMetal(material: THREE.MeshStandardMaterial) {
  material.map = null;
  material.color.setHex(0x3a3c3e);
  material.metalness = 0.75;
  material.roughness = 0.45;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uRootInverse = rootInverse;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform mat4 uRootInverse;\n${LIVERY_GLSL}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vRootPos = (uRootInverse * (modelMatrix * vec4(transformed, 1.0))).xyz;
        vRootNormal = normalize(mat3(uRootInverse) * (mat3(modelMatrix) * objectNormal));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LIVERY_GLSL}\nfloat vCkRough; float vCkMetal;`)
      .replace('#include <map_fragment>', `
        {
          // Paint worn through to bare aluminium where hands and feet land.
          float wear = smoothstep(0.45, 0.85, fbm3(vRootPos * 26.0));
          float scratch = smoothstep(0.72, 0.95, fbm3(vRootPos * vec3(90.0, 12.0, 90.0)));
          vec3 paint = vec3(0.045, 0.047, 0.050);
          vec3 bare = vec3(0.55, 0.56, 0.58);
          diffuseColor.rgb = mix(paint, bare, clamp(wear * 0.7 + scratch * 0.55, 0.0, 1.0));
          vCkMetal = mix(0.15, 0.95, clamp(wear + scratch * 0.8, 0.0, 1.0));
          vCkRough = mix(0.62, 0.28, clamp(wear * 0.8 + scratch, 0.0, 1.0));
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vCkRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vCkMetal;');
  };
}

/** Tyre tread: the baked normal was black, so the grooves are generated in the shader. */
export function applyTyre(material: THREE.MeshStandardMaterial) {
  material.normalMap = null;
  material.color.setHex(0x0d0d0e);
  material.roughness = 0.92;
  material.metalness = 0.0;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTyrePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTyrePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTyrePos;\n${LIVERY_GLSL}\nfloat vTyreRough;`)
      .replace('#include <map_fragment>', `
        {
          // Circumferential ribs on the crown, smooth sidewalls, moulding flash.
          float ang = atan(vTyrePos.z, vTyrePos.y);
          float crown = 1.0 - smoothstep(0.045, 0.075, abs(vTyrePos.x));
          float rib = seamMask(vTyrePos.x, 0.030, 0.008) * crown;
          float block = seamMask(ang * 0.20, 0.030, 0.010) * crown;
          float side = (1.0 - crown) * seamMask(length(vTyrePos.yz), 0.02, 0.004);
          diffuseColor.rgb = vec3(0.012) * (1.0 - 0.35 * rib) + vec3(0.02) * side;
          vTyreRough = 0.95 - 0.15 * rib - 0.1 * block;
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vTyreRough;');
  };
}
