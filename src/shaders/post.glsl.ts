// Small full-screen shaders of the custom pipeline (kept in one place for overview).
export const fsVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const depthUtils = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear, uFar;
uniform mat4 uInvProjection;
float linearDepth(float z) { float ndc = z * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear)); }
vec3 viewPos(vec2 uv, float z) { vec4 ndc = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); vec4 p = uInvProjection * ndc; return p.xyz / p.w; }
`;

/** Screen-space AO from depth only (normals reconstructed from depth derivatives). Half res. */
export const aoFrag = /* glsl */ `
precision highp float;
${depthUtils}
uniform vec2 uTexel;       // 1 / half-res size
uniform mat4 uProjection;
uniform float uRadius;     // world metres
uniform float uFrame;
varying vec2 vUv;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  float z = texture2D(tDepth, vUv).x;
  if (z >= 0.9999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv, z);
  vec3 Px = viewPos(vUv + vec2(uTexel.x, 0.0), texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).x);
  vec3 Py = viewPos(vUv + vec2(0.0, uTexel.y), texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).x);
  vec3 Pxm = viewPos(vUv - vec2(uTexel.x, 0.0), texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).x);
  vec3 Pym = viewPos(vUv - vec2(0.0, uTexel.y), texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).x);
  vec3 dx = abs(Px.z - P.z) < abs(Pxm.z - P.z) ? Px - P : P - Pxm;
  vec3 dy = abs(Py.z - P.z) < abs(Pym.z - P.z) ? Py - P : P - Pym;
  vec3 N = normalize(cross(dx, dy));
  float dist = -P.z;
  float radius = uRadius * (1.0 + dist * 0.02);
  float ao = 0.0;
  float rot = hash12(gl_FragCoord.xy + fract(uFrame * 0.3819) * 37.0) * 6.2831;
  const int DIRS = 4; const int STEPS = 3;
  for (int d = 0; d < DIRS; d++) {
    float a = rot + float(d) * (6.2831 / float(DIRS));
    vec2 dir = vec2(cos(a), sin(a));
    float maxH = 0.0;
    for (int s = 1; s <= STEPS; s++) {
      float r = radius * (float(s) / float(STEPS)) * (0.7 + 0.3 * hash12(vUv * 77.0 + float(s)));
      // project the offset into screen space
      vec4 clip = uProjection * vec4(P + vec3(dir * r, 0.0), 1.0);
      vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
      vec3 S = viewPos(suv, texture2D(tDepth, suv).x);
      vec3 v = S - P; float l = length(v);
      // Bias away self-occlusion on gently curved ground, which otherwise greys out
      // every open field.
      float h = dot(N, v / max(l, 1e-4)) - 0.14;
      float att = 1.0 - clamp(l / (radius * 2.5), 0.0, 1.0);
      maxH = max(maxH, h * att);
    }
    ao += clamp(maxH, 0.0, 1.0);
  }
  ao = 1.0 - ao / float(DIRS);
  ao = pow(clamp(ao, 0.0, 1.0), 1.25);
  gl_FragColor = vec4(vec3(ao), 1.0);
}`;

/** Depth-aware separable blur for the AO buffer. */
export const aoBlurFrag = /* glsl */ `
precision highp float;
uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 uDir; varying vec2 vUv;
void main(){
  float zc = texture2D(tDepth, vUv).x; float sum = 0.0, wsum = 0.0;
  for (int i = -4; i <= 4; i++) { vec2 uv = vUv + uDir * float(i); float z = texture2D(tDepth, uv).x;
    float w = exp(-float(i*i) * 0.12) * exp(-abs(z - zc) * 4000.0); sum += texture2D(tAO, uv).r * w; wsum += w; }
  gl_FragColor = vec4(vec3(sum / max(wsum, 1e-4)), 1.0); }`;

/** God-ray mask: sky visibility through clouds around the sun. Quarter res. */
export const godMaskFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDepth; uniform sampler2D tClouds; uniform vec2 uSunScreen; uniform float uSunVisible; varying vec2 vUv;
void main(){
  float z = texture2D(tDepth, vUv).x;
  float sky = z >= 0.9999 ? 1.0 : 0.0;
  float T = texture2D(tClouds, vUv).a;
  float d = distance(vUv, uSunScreen);
  float falloff = 1.0 - smoothstep(0.0, 0.55, d);
  gl_FragColor = vec4(vec3(sky * T * falloff * uSunVisible), 1.0); }`;

export const godBlurFrag = /* glsl */ `
precision highp float;
uniform sampler2D tMask; uniform vec2 uSunScreen; uniform float uDensity; uniform float uDecay; varying vec2 vUv;
void main(){
  vec2 delta = (uSunScreen - vUv) * uDensity / 24.0; vec2 uv = vUv; float w = 1.0, sum = 0.0, wsum = 0.0;
  for (int i = 0; i < 24; i++) { uv += delta; sum += texture2D(tMask, uv).r * w; wsum += w; w *= uDecay; }
  gl_FragColor = vec4(vec3(sum / wsum), 1.0); }`;

/** Composite: scene + clouds (bilateral upsample) + god rays + AO + lens flare. HDR. */
export const compositeFrag = /* glsl */ `
precision highp float;
uniform sampler2D tScene; uniform sampler2D tClouds; uniform sampler2D tDepth; uniform sampler2D tGod; uniform sampler2D tAO;
uniform vec2 uCloudTexel; uniform vec2 uSunScreen; uniform float uSunVisible; uniform vec3 uSunColor; uniform float uGodStrength;
uniform float uAOStrength; uniform float uFlareStrength; uniform float uAspect; uniform float uNear; uniform float uFar;
varying vec2 vUv;
float linearDepth(float z) { float ndc = z * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear)); }
void main(){
  vec4 scene = texture2D(tScene, vUv);
  float zc = texture2D(tDepth, vUv).x; float dc = linearDepth(zc);
  // depth-aware upsample of the half-res cloud buffer
  vec2 base = (floor(vUv / uCloudTexel - 0.5) + 0.5) * uCloudTexel;
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 uv = base + vec2(float(i), float(j)) * uCloudTexel;
    float zs = texture2D(tDepth, uv).x; float ds = linearDepth(zs);
    vec2 f = abs(vUv - uv) / uCloudTexel; float wb = (1.0 - min(f.x, 1.0)) * (1.0 - min(f.y, 1.0));
    float wd = 1.0 / (1.0 + abs(ds - dc) * 0.02);
    float w = wb * wd + 1e-4;
    acc += texture2D(tClouds, uv) * w; wsum += w; }
  vec4 cl = acc / wsum;
  vec3 col = scene.rgb * cl.a + cl.rgb;
  // AO (half-res, blurred) — only darkens surfaces, not the sky
  float ao = texture2D(tAO, vUv).r;
  col *= mix(1.0, ao, uAOStrength * (zc < 0.9999 ? 1.0 : 0.0));
  // god rays
  float god = texture2D(tGod, vUv).r;
  col += uSunColor * god * uGodStrength;
  // Sober lens flare: glow + a few ghosts along the sun-centre axis, occluded by geometry/clouds
  if (uSunVisible > 0.001 && uFlareStrength > 0.0) {
    vec2 c = vec2(0.5); vec2 s = uSunScreen; vec2 toC = c - s;
    vec2 p = (vUv - s); p.x *= uAspect;
    float dsun = length(p);
    float glow = exp(-dsun * 9.0) * 0.35 + exp(-dsun * 1.6) * 0.06;
    float streak = exp(-abs(p.y) * 220.0) * exp(-abs(p.x) * 2.2) * 0.25;   // anamorphic hint
    float ghosts = 0.0;
    for (int i = 1; i <= 4; i++) { vec2 g = s + toC * (0.35 * float(i)) ; vec2 q = vUv - g; q.x *= uAspect;
      float r = 0.025 + 0.02 * float(i); ghosts += smoothstep(r, r * 0.6, length(q)) * 0.05 / float(i); }
    vec3 tint = mix(uSunColor, vec3(0.7, 0.85, 1.0), 0.4);
    col += tint * (glow + streak + ghosts) * uSunVisible * uFlareStrength;
  }
  gl_FragColor = vec4(col, 1.0); }`;

/** Camera motion blur via depth reprojection (static world only, near objects masked). */
export const motionBlurFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform mat4 uInvViewProj; uniform mat4 uPrevViewProj;
uniform float uStrength; uniform vec2 uTexel; uniform float uNear; uniform float uFar; varying vec2 vUv;
float linearDepth(float z) { float ndc = z * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear)); }
void main(){
  float z = texture2D(tDepth, vUv).x;
  vec4 clip = vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  vec4 world = uInvViewProj * clip; world /= world.w;
  vec4 prev = uPrevViewProj * world; prev /= prev.w;
  vec2 vel = (vUv - (prev.xy * 0.5 + 0.5)) * uStrength;
  float d = linearDepth(z);
  vel *= smoothstep(12.0, 45.0, d);   // the aircraft (close to the camera) stays sharp
  float len = length(vel / uTexel); float maxLen = 14.0;
  if (len > maxLen) vel *= maxLen / len;
  vec4 sum = vec4(0.0); const int N = 8;
  for (int i = 0; i < N; i++) { float t = (float(i) / float(N - 1)) - 0.5; sum += texture2D(tDiffuse, vUv + vel * t); }
  gl_FragColor = sum / float(N); }`;

/** Depth of field (cockpit): gather blur with circle of confusion from depth. */
export const dofFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uFocus; uniform float uMaxCoc; uniform float uNear; uniform float uFar; varying vec2 vUv;
float linearDepth(float z) { float ndc = z * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear)); }
float coc(float d) { return clamp(abs(1.0 / max(d, 0.05) - 1.0 / uFocus) * 1.4, 0.0, 1.0) * uMaxCoc; }
void main(){
  float d = linearDepth(texture2D(tDepth, vUv).x);
  float c = coc(d);
  if (c < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
  vec4 sum = vec4(0.0); float wsum = 0.0;
  const int N = 16; const float GA = 2.39996;
  for (int i = 0; i < N; i++) { float r = sqrt((float(i) + 0.5) / float(N)); float a = float(i) * GA;
    vec2 off = vec2(cos(a), sin(a)) * r * c * uTexel;
    float ds = linearDepth(texture2D(tDepth, vUv + off).x); float cs = coc(ds);
    float w = (cs >= c * r * 0.8 || ds > d) ? 1.0 : 0.3;
    sum += texture2D(tDiffuse, vUv + off) * w; wsum += w; }
  gl_FragColor = sum / wsum; }`;

export const grainFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmount; uniform float uVignette; varying vec2 vUv;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  float g = hash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5;
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb += g * uAmount * (1.0 - lum * 0.6);
  vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * uVignette * 2.2;
  c.rgb *= smoothstep(0.0, 1.0, v);
  gl_FragColor = c; }`;


/** Log-luminance downsample: first step of the auto-exposure chain. */
export const lumFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb
         + texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb
         + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb
         + texture2D(tDiffuse, vUv + uTexel).rgb;
  float lum = dot(c * 0.25, vec3(0.2126, 0.7152, 0.0722));
  // Centre-weighted metering. A flight sim frame is half sky, and a bright sky metered
  // flat drags the exposure down until the ground goes to mud — the same reason a
  // photographer meters off the subject and lets the sky blow a little.
  float w = mix(1.0, 0.22, smoothstep(0.48, 0.95, vUv.y));
  w *= mix(0.55, 1.0, 1.0 - smoothstep(0.25, 0.75, abs(vUv.x - 0.5) * 2.0));
  float L = log(clamp(lum, 1e-5, 6.0));
  // Blend toward a neutral reference by the pixel's weight, so low-weight regions
  // nudge rather than dominate the average.
  gl_FragColor = vec4(mix(log(0.20), L, w), 0.0, 0.0, 1.0);
}`;

export const downsampleFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uSteps; varying vec2 vUv;
void main(){
  float sum = 0.0; float n = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    sum += texture2D(tDiffuse, vUv + vec2(float(i) - 1.5, float(j) - 1.5) * uTexel).r; n += 1.0;
  }
  gl_FragColor = vec4(sum / n, 0.0, 0.0, 1.0);
}`;

/** Temporal eye adaptation: one texel of state, lerped toward the new average. */
export const adaptFrag = /* glsl */ `
precision highp float;
uniform sampler2D tCurrent; uniform sampler2D tPrevious; uniform float uRate; varying vec2 vUv;
void main(){
  float cur = texture2D(tCurrent, vec2(0.5)).r;
  float prev = texture2D(tPrevious, vec2(0.5)).r;
  // The eye darkens faster than it brightens, as ours does.
  float rate = cur > prev ? uRate * 1.7 : uRate;
  gl_FragColor = vec4(mix(prev, cur, clamp(rate, 0.0, 1.0)), 0.0, 0.0, 1.0);
}`;

/**
 * Tone mapping with automatic exposure. Replaces three's OutputPass so the exposure can
 * come from a texture (the adaptation state) instead of a uniform set on the CPU, which
 * would need a GPU readback and a stall.
 */
export const toneFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse; uniform sampler2D tLum;
uniform float uKey; uniform float uMinExposure; uniform float uMaxExposure; uniform float uManual;
varying vec2 vUv;
// ACES filmic, Stephen Hill's fit.
const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 rrt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){ c = ACES_IN * c; c = rrt(c); c = ACES_OUT * c; return clamp(c, 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float avg = exp(texture2D(tLum, vec2(0.5)).r);
  float exposure = clamp(uKey / max(avg, 1e-4), uMinExposure, uMaxExposure) * uManual;
  gl_FragColor = vec4(toSRGB(aces(c * exposure)), 1.0);
}`;


/** Small tent blur used to take the dither pattern off the cloud buffer. */
export const blurFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv) * 4.0;
  c += (texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)) + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0))
      + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)) + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y))) * 2.0;
  c += texture2D(tDiffuse, vUv + uTexel) + texture2D(tDiffuse, vUv - uTexel)
     + texture2D(tDiffuse, vUv + vec2(uTexel.x, -uTexel.y)) + texture2D(tDiffuse, vUv + vec2(-uTexel.x, uTexel.y));
  gl_FragColor = c / 16.0;
}`;
