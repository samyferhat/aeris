// Ocean surface injected into MeshStandardMaterial.
// Vertex: 6 Gerstner waves (world-space, camera-following grid) with analytic normals.
// Fragment: detail normals (two scrolling layers), depth-based colour (sand seen through
// shallow water = cheap refraction), shoreline + crest foam, sub-surface light in crests.
uniform float uTime;
uniform sampler2D tHeight;        // terrain heightfield (R32F)
uniform float uWorldSize;
uniform sampler2D tDetailN;
uniform sampler2D tFoam;
uniform float uWaveScale;         // 0..1.5 overall amplitude
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uSandColor;
varying vec3 vOWorldPos;
varying vec3 vOWaveNormal;
varying float vOCrest;
varying float vOFade;

// direction (x,z), steepness, wavelength
const vec4 W[6] = vec4[6](
  vec4( 1.00,  0.00, 0.28, 60.0),
  vec4( 0.70,  0.71, 0.22, 31.0),
  vec4(-0.53,  0.85, 0.18, 17.0),
  vec4( 0.94, -0.34, 0.16, 9.5),
  vec4(-0.21, -0.98, 0.14, 5.2),
  vec4( 0.45,  0.89, 0.10, 2.8));

void gerstner(vec3 p, float amp, out vec3 disp, out vec3 normal, out float crest) {
  disp = vec3(0.0); vec3 tangent = vec3(1.0, 0.0, 0.0), binormal = vec3(0.0, 0.0, 1.0);
  crest = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 d = normalize(W[i].xy);
    float k = 2.0 * PI / W[i].w;
    float c = sqrt(9.81 / k);
    float a = W[i].z / k * amp;
    float f = k * (dot(d, p.xz) - c * uTime);
    float s = sin(f), co = cos(f);
    disp += vec3(d.x * a * co, a * s, d.y * a * co);
    tangent  += vec3(-d.x * d.x * W[i].z * amp * s, d.x * W[i].z * amp * co, -d.x * d.y * W[i].z * amp * s);
    binormal += vec3(-d.x * d.y * W[i].z * amp * s, d.y * W[i].z * amp * co, -d.y * d.y * W[i].z * amp * s);
    crest += (s * 0.5 + 0.5) * W[i].z;
  }
  normal = normalize(cross(binormal, tangent));
  crest /= 1.08;
}

float terrainHeightAt(vec2 xz) {
  vec2 uv = xz / uWorldSize + 0.5;
  return texture2D(tHeight, uv).r;
}
