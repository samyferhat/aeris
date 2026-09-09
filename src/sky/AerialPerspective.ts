import * as THREE from 'three';
import { atmoUniforms } from './Atmosphere';

/**
 * Replaces Three's fog with physically-based aerial perspective on any material:
 * the fragment colour is attenuated by the transmittance of the air between the
 * camera and the surface, and the in-scattered sunlight along that path is added.
 * Distant hills therefore turn blue-grey by day and salmon at sunset, for free.
 */
const parsChunk = /* glsl */ `
#include <atmosphere>
varying vec3 vAPWorldPos;
`;
const fragChunk = /* glsl */ `
{
  vec3 apRo = planetPos(cameraPosition);
  vec3 apDelta = vAPWorldPos - cameraPosition;
  float apLen = length(apDelta);
  vec3 apRd = apDelta / max(apLen, 1e-3);
  vec3 apT;
  vec3 apIn = scatter(apRo, apRd, apLen, uSunDir, 6, 3, apT);
  gl_FragColor.rgb = gl_FragColor.rgb * apT + apIn;
}
`;
const vertPars = /* glsl */ `varying vec3 vAPWorldPos;`;
const vertMain = /* glsl */ `vAPWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#ifdef USE_INSTANCING
vAPWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

export function applyAerialPerspective(material: THREE.Material, extraOnBeforeCompile?: (s: THREE.WebGLProgramParametersWithUniforms) => void) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, atmoUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertPars}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${vertMain}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${parsChunk}`)
      .replace('#include <fog_fragment>', fragChunk);
    extraOnBeforeCompile?.(shader);
  };
  (material as any).customProgramCacheKey = () => 'aerial' + ((material as any)._apKey ?? '');
  return material;
}
