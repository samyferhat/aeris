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
uniform vec3 uSunTransmit;     // sun colour after extinction down to the ground
uniform sampler2D uCsWeather;
uniform vec2 uCsWind;
uniform float uCsTime;
uniform float uCsCoverage;
uniform float uCsBase;
uniform float uCsStrength;    // 0 = off, 1 = full

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
  vec2 od = vec2(0.0);
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
  }
  transmittance = exp(-(BETA_R * od.x + betaM * 1.1 * od.y));
  // Multiple scattering, approximated. Single scattering alone extinguishes blue over a
  // long horizon path and leaves an unnaturally saturated yellow band; in reality the
  // light removed from the beam is re-scattered back into it and the horizon goes pale
  // white. The term therefore grows with what the single-scatter pass lost (1 - T) and
  // saturates instead of accumulating without bound.
  vec3 lost = vec3(1.0) - transmittance;
  vec3 msTint = mix(vec3(0.42, 0.55, 0.78), vec3(1.0), 0.62);
  vec3 ms = lost * msTint * 0.0075 * smoothstep(-0.14, 0.12, sunDir.y);
  return uSunIntensity * (sumR * BETA_R * pR + sumM * betaM * pM + ms);
}

// Position of a world-space point relative to the planet centre.
vec3 planetPos(vec3 worldPos) { return vec3(worldPos.x, worldPos.y + R_EARTH, worldPos.z); }


// ---------------------------------------------------------------------------
// Aerial perspective, analytic.
//
// Running the full raymarch above for every shaded fragment costs about a hundred
// transcendental operations per pixel, and at 2 Mpixels that alone was most of the
// frame. Over the ranges that matter here (0-20 km) the segment can instead be
// integrated in closed form: the exponential density profile has an exact integral
// along a straight line, and single scattering through a medium of constant
// coefficients is S/sigma * (1 - T). The result is within a few percent of the
// raymarch and about twenty times cheaper.
// ---------------------------------------------------------------------------
#define MS_TINT vec3(0.78, 0.83, 0.92)

vec3 aerialPerspective(vec3 color, vec3 worldPos, vec3 camPos) {
  vec3 d = worldPos - camPos;
  float len = length(d);
  if (len < 1.0) return color;
  vec3 rd = d / len;
  float h0 = max(camPos.y, 0.0), h1 = max(worldPos.y, 0.0);
  float dh = h1 - h0;
  float ir, im;
  if (abs(dh) < 1.0) {
    ir = exp(-h0 / H_RAYLEIGH);
    im = exp(-h0 / H_MIE);
  } else {
    // Mean of exp(-h/H) over the segment, exactly.
    ir = (H_RAYLEIGH / dh) * (exp(-h0 / H_RAYLEIGH) - exp(-h1 / H_RAYLEIGH));
    im = (H_MIE / dh) * (exp(-h0 / H_MIE) - exp(-h1 / H_MIE));
  }
  im *= 1.0 + 5.0 * uHazeAmount * exp(-min(h0, h1) / 500.0);
  vec3 sigmaR = BETA_R * ir;
  vec3 sigmaM = vec3(uMieCoeff) * im;
  vec3 sigmaT = sigmaR + sigmaM * 1.1;
  vec3 T = exp(-sigmaT * len);
  float mu = dot(rd, uSunDir);
  vec3 S = uSunIntensity * uSunTransmit * (sigmaR * phaseRayleigh(mu) + sigmaM * phaseMie(mu, uMieG));
  vec3 inscat = S / max(sigmaT, vec3(1e-12)) * (vec3(1.0) - T);
  // The multiple-scattering term saturates at (1 - T), so over a twenty-kilometre map
  // it reaches full strength on anything past a few kilometres. At the coefficient a
  // nine-kilometre world could carry, that is brighter than sunlit ground, and every
  // distant island turns to milk.
  inscat += (vec3(1.0) - T) * MS_TINT * uSunIntensity * 0.0075 * smoothstep(-0.14, 0.12, uSunDir.y);
  return color * T + inscat;
}


/**
 * Cloud shadows on the ground.
 *
 * Nothing else says "seen from an aeroplane" as directly as the slow dappling of cloud
 * shadow across a landscape. The full volume is far too expensive to sample per
 * fragment, but the shadow of a cumulus deck is a low-frequency pattern, so following
 * the sun ray up to the cloud base and reading the same weather map the volume uses
 * reproduces it for one texture fetch.
 */
float cloudShadow(vec3 worldPos) {
  if (uCsStrength <= 0.001 || uSunDir.y <= 0.06) return 1.0;
  float t = (uCsBase + 250.0 - worldPos.y) / uSunDir.y;
  vec3 p = worldPos + uSunDir * max(t, 0.0);
  vec2 wuv = (p.xz + uCsWind * uCsTime * 4.0) * 0.00006;
  float w = texture2D(uCsWeather, wuv).r;
  float cov = clamp((w - 0.27) / 0.44 + (uCsCoverage - 0.5) * 1.7, 0.0, 1.0);
  // Soft edges: a cumulus shadow has a penumbra hundreds of metres wide.
  return 1.0 - uCsStrength * smoothstep(0.16, 0.66, cov);
}
