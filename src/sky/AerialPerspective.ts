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
gl_FragColor.rgb *= cloudShadow(vAPWorldPos);
gl_FragColor.rgb = aerialPerspective(gl_FragColor.rgb, vAPWorldPos, cameraPosition);
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
