// Volumetric cloud layer, raymarched at half resolution against the scene depth.
// Output: rgb = in-scattered light (premultiplied), a = transmittance.
precision highp float;
precision highp sampler3D;
#include <atmosphere>
uniform sampler2D tDepth;
uniform sampler3D tShape;
uniform sampler3D tDetail;
uniform sampler2D tWeather;
uniform mat4 uInvProjection;
uniform mat4 uInvView;
uniform vec3 uCamPos;
uniform float uNear, uFar;
uniform float uTime;
uniform float uCoverage;      // 0..1
uniform float uDensityBias;   // threshold at zero local coverage
uniform float uDensitySlope;  // how fast coverage lowers that threshold
uniform float uDensityScale;  // final density multiplier
uniform float uCloudBase;     // m
uniform float uCloudTop;      // m
uniform vec3 uAmbientTop;     // sky colour above (zenith-ish)
uniform vec3 uAmbientBottom;  // light bouncing from ground/horizon
uniform vec3 uSunColor;       // transmitted sun colour at cloud altitude
uniform vec2 uWind;
uniform vec2 uResolution;
uniform float uFrame;
varying vec2 vUv;

#define STEPS 40
#define LIGHT_STEPS 4

float linearDepth(float z) {
  float ndc = z * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}
float remap(float v, float lo, float hi, float nlo, float nhi) { return nlo + (clamp((v - lo) / (hi - lo), 0.0, 1.0)) * (nhi - nlo); }
float hg(float mu, float g) { float gg = g * g; return (1.0 - gg) / (4.0 * PI * pow(1.0 + gg - 2.0 * g * mu, 1.5)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// Height fraction inside the layer 0..1
float heightFrac(vec3 p) { return clamp((p.y - uCloudBase) / (uCloudTop - uCloudBase), 0.0, 1.0); }

float densityAt(vec3 p, float hf, bool detail) {
  vec2 wuv = (p.xz + uWind * uTime * 4.0) * 0.00006;
  vec3 weather = texture2D(tWeather, wuv).rgb;
  // The generated weather map spans roughly [0.27, 0.71]; normalise it, then bias
  // by the global coverage slider so 0 = clear sky and 1 = overcast.
  float covLocal = clamp((weather.r - 0.27) / 0.44 + (uCoverage - 0.5) * 1.7, 0.0, 1.0);
  if (covLocal <= 0.02) return 0.0;
  // Vertical profile: flat base, cauliflower top. `type` fattens the cloud.
  float type = weather.g;
  float bottom = smoothstep(0.0, 0.10 + 0.06 * type, hf);
  float top = 1.0 - smoothstep(0.30 + 0.45 * type, 1.0, hf);
  float profile = bottom * top;
  if (profile <= 0.01) return 0.0;
  vec3 sp = (p + vec3(uWind.x, 0.0, uWind.y) * uTime * 3.0) * 0.00042;
  vec4 shape = texture(tShape, sp);
  // Measured ranges: perlin-worley ~[0.38, 0.96], worley channels ~[0, 1].
  float shapeN = clamp((shape.r - 0.38) / 0.58, 0.0, 1.0);
  float erosion = shape.g * 0.625 + shape.b * 0.25 + shape.a * 0.125;
  float base = clamp(shapeN * 0.72 + erosion * 0.28, 0.0, 1.0);
  float thresh = uDensityBias - covLocal * uDensitySlope;
  float d = smoothstep(thresh, thresh + 0.22, base * profile);
  if (detail && d > 0.001) {
    vec3 dp = (p + vec3(uWind.x, 0.0, uWind.y) * uTime * 8.0) * 0.0032;
    vec4 det = texture(tDetail, dp);
    float hfDetail = det.r * 0.625 + det.g * 0.25 + det.b * 0.125;
    // Wispy at the base, billowy on top.
    hfDetail = mix(hfDetail, 1.0 - hfDetail, clamp(hf * 3.0, 0.0, 1.0));
    d = clamp(remap(d, hfDetail * 0.42, 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  return d * uDensityScale;
}

float lightMarch(vec3 p, float sigma) {
  float len = 220.0;
  float step = len / float(LIGHT_STEPS);
  float od = 0.0;
  for (int i = 0; i < LIGHT_STEPS; i++) {
    p += uSunDir * step * (1.0 + float(i) * 0.6);
    float hf = heightFrac(p);
    if (hf <= 0.0 || hf >= 1.0) break;
    od += densityAt(p, hf, i < 2) * step * (1.0 + float(i) * 0.6);
  }
  float beer = exp(-od * sigma);
  float beerPowder = beer * (1.0 - exp(-od * sigma * 2.0)) * 2.0;
  return mix(beer, beerPowder, 0.5) ;
}

void main() {
  // Reconstruct the view ray
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 vp = uInvProjection * ndc; vp /= vp.w;
  vec3 rd = normalize((uInvView * vec4(vp.xyz, 0.0)).xyz);
  vec3 ro = uCamPos;
  float depthRaw = texture2D(tDepth, vUv).x;
  float sceneDist = depthRaw >= 0.9999 ? 1e9 : linearDepth(depthRaw) / max(0.001, dot(rd, normalize((uInvView * vec4(0.0, 0.0, -1.0, 0.0)).xyz)));

  // Slab intersection (flat layer; the curvature of the earth is ignored at these ranges)
  float tBase = (uCloudBase - ro.y) / rd.y;
  float tTop = (uCloudTop - ro.y) / rd.y;
  float t0, t1;
  if (ro.y < uCloudBase) { if (rd.y <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } t0 = tBase; t1 = tTop; }
  else if (ro.y > uCloudTop) { if (rd.y >= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } t0 = tTop; t1 = tBase; }
  else { t0 = 0.0; t1 = rd.y > 0.0 ? tTop : (rd.y < 0.0 ? tBase : 1e5); }
  t1 = min(t1, sceneDist);
  t1 = min(t1, 24000.0);
  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  float segLen = t1 - t0;
  float stepLen = max(segLen / float(STEPS), 12.0);
  int steps = int(min(float(STEPS), segLen / stepLen) + 1.0);
  float jitter = hash12(gl_FragCoord.xy + fract(uFrame * 0.618) * 100.0);
  float t = t0 + stepLen * jitter;

  float mu = dot(rd, uSunDir);
  float phase = mix(hg(mu, 0.75), hg(mu, -0.25), 0.3) * 1.35;
  float sigma = 0.045;             // extinction per metre * density
  vec3 scattered = vec3(0.0);
  float T = 1.0;
  vec3 sunL = uSunColor * uSunIntensity * 0.85;
  for (int i = 0; i < STEPS; i++) {
    if (i >= steps || T < 0.03 || t > t1) break;
    vec3 p = ro + rd * t;
    float hf = heightFrac(p);
    float d = densityAt(p, hf, true);
    if (d > 0.001) {
      float ext = d * sigma * stepLen;
      float lt = lightMarch(p, sigma);
      // ambient: darker at the base, brighter towards the top
      vec3 amb = mix(uAmbientBottom, uAmbientTop, hf) * (0.55 + 0.45 * hf);
      vec3 S = (sunL * lt * phase + amb * 0.28) * d * sigma;
      // energy-conserving integration (Frostbite)
      vec3 Sint = (S - S * exp(-ext)) / (d * sigma);
      scattered += T * Sint;
      T *= exp(-ext);
    }
    t += stepLen * (d > 0.001 ? 1.0 : 1.6);
  }
  // Aerial perspective on the cloud itself, so distant cloud banks wash out.
  if (T < 0.999) {
    vec3 mid = ro + rd * (t0 + segLen * 0.35);
    vec3 washed = aerialPerspective(scattered, mid, ro);
    scattered = mix(scattered, washed, 1.0 - T);
  }
  gl_FragColor = vec4(scattered, T);
}
