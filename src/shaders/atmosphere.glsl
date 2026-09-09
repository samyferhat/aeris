// ---------------------------------------------------------------------------
// Single-scattering atmosphere (Rayleigh + Mie), analytic-density raymarch.
// Shared by the sky dome, the aerial-perspective fog of every material and
// the volumetric clouds. Units: metres. Planet centre is at (0, -R_EARTH, 0).
// ---------------------------------------------------------------------------
#define R_EARTH 6371000.0
#define R_ATMO  6471000.0
#define H_RAYLEIGH 8000.0
#define H_MIE 1200.0
#define BETA_R vec3(5.8e-6, 13.5e-6, 33.1e-6)
#ifndef PI
#define PI 3.14159265359
#endif

uniform vec3 uSunDir;
uniform float uSunIntensity;   // ~20 – 30 (radiance scale)
uniform float uMieCoeff;       // ~2e-6 clear .. 3e-5 hazy
uniform float uMieG;           // 0.76
uniform float uHazeAmount;     // extra low-altitude haze 0..1

vec2 raySphere(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

// Optical depth toward the sun from point p (used for the light-path term).
vec2 opticalDepthToSun(vec3 p, vec3 sunDir, int steps) {
  vec2 hit = raySphere(p, sunDir, R_ATMO);
  float len = hit.y;
  float ds = len / float(steps);
  vec2 od = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= steps) break;
    vec3 q = p + sunDir * ((float(i) + 0.5) * ds);
    float h = max(length(q) - R_EARTH, 0.0);
    od += vec2(exp(-h / H_RAYLEIGH), exp(-h / H_MIE)) * ds;
  }
  return od;
}

float phaseRayleigh(float mu) { return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
float phaseMie(float mu, float g) {
  float gg = g * g;
  return 3.0 / (8.0 * PI) * ((1.0 - gg) * (1.0 + mu * mu)) / ((2.0 + gg) * pow(1.0 + gg - 2.0 * g * mu, 1.5));
}

// Integrates in-scattered light along [ro, ro + rd * maxLen] and returns the
// transmittance of that segment in `transmittance`.
vec3 scatter(vec3 ro, vec3 rd, float maxLen, vec3 sunDir, int steps, int lightSteps, out vec3 transmittance) {
  vec3 betaM = vec3(uMieCoeff);
  vec2 hit = raySphere(ro, rd, R_ATMO);
  float len = min(hit.y, maxLen);
  vec2 ground = raySphere(ro, rd, R_EARTH - 50.0);
  if (ground.x > 0.0) len = min(len, ground.x);
  float ds = len / float(steps);
  float mu = dot(rd, sunDir);
  float pR = phaseRayleigh(mu), pM = phaseMie(mu, uMieG);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float sumAmb = 0.0;
  vec2 od = vec2(0.0);
  // Average sunlight reaching the path (for the isotropic multiple-scattering term)
  vec2 odSun0 = opticalDepthToSun(ro, sunDir, 4);
  vec3 sunT = exp(-(BETA_R * odSun0.x + betaM * 1.1 * odSun0.y));
  for (int i = 0; i < 16; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * ((float(i) + 0.5) * ds);
    float h = max(length(p) - R_EARTH, 0.0);
    float haze = uHazeAmount * exp(-h / 400.0);          // low ground haze
    vec2 dens = vec2(exp(-h / H_RAYLEIGH), exp(-h / H_MIE) * (1.0 + 6.0 * haze)) * ds;
    od += dens;
    vec2 odSun = opticalDepthToSun(p, sunDir, lightSteps);
    vec3 tau = BETA_R * (od.x + odSun.x) + betaM * 1.1 * (od.y + odSun.y);
    vec3 att = exp(-tau);
    sumR += att * dens.x;
    sumM += att * dens.y;
    sumAmb += exp(-(dot(BETA_R, vec3(0.333)) * od.x + uMieCoeff * 1.1 * od.y)) * dens.x;
  }
  transmittance = exp(-(BETA_R * od.x + betaM * 1.1 * od.y));
  // Isotropic multiple scattering approximation: keeps the horizon white-blue instead of
  // yellow, and lifts shadows in hazy air.
  vec3 ms = sumAmb * mix(BETA_R, vec3(dot(BETA_R, vec3(0.333))), 0.5) * 0.022 * (0.6 + 0.4 * sunT) * smoothstep(-0.12, 0.15, sunDir.y);
  return uSunIntensity * (sumR * BETA_R * pR + sumM * betaM * pM + ms);
}

// Position of a world-space point relative to the planet centre.
vec3 planetPos(vec3 worldPos) { return vec3(worldPos.x, worldPos.y + R_EARTH, worldPos.z); }
