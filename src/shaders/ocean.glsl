// ---------------------------------------------------------------------------
// The sea.
//
// Seventy per cent of every frame, so it is built the way water actually works
// rather than as a blue surface with a highlight.
//
// The colour of shallow water is not painted on: the view ray is refracted at the
// surface, followed down to the sea floor, and what comes back is attenuated by
// Beer–Lambert over the distance it travelled through water. Because clear water
// absorbs red about twenty times faster than blue, sand under one metre reads as sand,
// under five metres as turquoise, and under thirty as the same deep blue as everywhere
// else — the whole depth gradient falls out of three extinction coefficients, and it
// re-tints itself for free when the sun colour changes.
//
// The surf is not a texture either. It breaks where the depth drops below about twice
// the wave height, on the phase of the same swell that displaces the surface, so the
// white lines are parallel to the crests, advance with them, and stand permanently on
// the reef edge where the bottom comes up to a metre.
// ---------------------------------------------------------------------------

uniform float uTime;
uniform sampler2D tHeight;        // terrain heightfield (R32F), the sea floor included
uniform float uWorldSize;
uniform sampler2D tDetailN;       // ripple normals
uniform sampler2D tBed;           // r coral, g weed, b caustic field, a foam breakup
uniform float uWaveScale;         // 0..1.5 overall amplitude
uniform vec2 uWind;               // unit vector the swell runs towards
uniform vec3 uWaterTint;          // scattering colour of the water body
uniform float uGlitter;           // strength of the sun's path on the water

// Wakes. Everything that moves on or just over the water writes one of these.
#define MAX_WAKES 14
uniform int uWakeCount;
uniform vec4 uWakeA[MAX_WAKES];   // xy: position   zw: heading, unit
uniform vec4 uWakeB[MAX_WAKES];   // x: beam  y: length  z: strength

/**
 * Extinction of clear tropical water, per metre, for R, G and B. Red goes twenty times
 * faster than blue, and that single fact is the whole colour of a lagoon.
 */
const vec3 SIGMA = vec3(0.46, 0.082, 0.023);

varying vec3 vOWorldPos;
varying vec3 vOWaveNormal;
varying float vOCrest;
varying float vOFade;
varying float vODepth;            // still-water depth under this vertex
varying float vOPhase;            // phase of the primary swell, for the surf lines
varying float vOShelter;          // 0 open sea .. 1 enclosed water

float terrainHeightAt(vec2 xz) {
  return texture2D(tHeight, xz / uWorldSize + 0.5).r;
}

// Swell components: bearing offset from the wind, steepness, wavelength, and how much
// of it survives in enclosed water. A strait has no fetch, so the long ocean swell dies
// there and what is left is short and steep — which is exactly how a channel looks.
//
// The first two are displaced as geometry; the last four are never displaced at all.
// The grid that carries the sea is twenty metres across a quad, and a four-metre wave
// pushed through it does not become a small wave, it becomes a chequerboard aligned
// with the mesh. Those components are evaluated per pixel as a slope instead, where
// there is no grid to beat against.
const vec4 W[6] = vec4[6](
  vec4( 0.00, 0.30, 84.0, 0.05),
  vec4( 0.40, 0.24, 49.0, 0.18),
  vec4(-0.62, 0.19, 27.0, 0.55),
  vec4( 0.92, 0.14, 15.0, 0.95),
  vec4(-1.15, 0.10,  8.0, 1.10),
  vec4( 0.28, 0.075, 4.2, 1.15));
const int GEOM_WAVES = 2;

vec2 waveDir(int i) {
  float ca = cos(W[i].x), sa = sin(W[i].x);
  return vec2(uWind.x * ca - uWind.y * sa, uWind.x * sa + uWind.y * ca);
}

/** Steepness of one component here, after shoaling and shelter. */
float waveSteep(int i, float shoal, float shelter) {
  float sh = clamp(shoal * (0.35 + 0.65 * W[i].w), 0.0, 1.0);
  return W[i].y * mix(1.0, W[i].w, shelter) * sh;
}

/** The long swell, as geometry. Displacement and analytic normal. */
void gerstner(vec3 p, float amp, float shoal, float shelter, out vec3 disp, out vec3 normal, out float crest, out float phase) {
  disp = vec3(0.0);
  vec3 tangent = vec3(1.0, 0.0, 0.0), binormal = vec3(0.0, 0.0, 1.0);
  crest = 0.0;
  float norm = 0.0;
  phase = 0.0;
  for (int i = 0; i < GEOM_WAVES; i++) {
    vec2 d = waveDir(i);
    float k = 2.0 * PI / W[i].z;
    float c = sqrt(9.81 / k);
    float steep = waveSteep(i, shoal, shelter);
    float a = steep / k * amp;
    float f = k * (dot(d, p.xz) - c * uTime);
    if (i == 0) phase = f;
    float s = sin(f), co = cos(f);
    disp += vec3(d.x * a * co, a * s, d.y * a * co);
    tangent  += vec3(-d.x * d.x * steep * amp * s, d.x * steep * amp * co, -d.x * d.y * steep * amp * s);
    binormal += vec3(-d.x * d.y * steep * amp * s, d.y * steep * amp * co, -d.y * d.y * steep * amp * s);
    crest += (s * 0.5 + 0.5) * steep;
    norm += steep;
  }
  normal = normalize(cross(binormal, tangent));
  crest /= max(norm, 1e-3);
}

/**
 * The chop, as a slope. Same waves, same phases, evaluated per pixel and never moved:
 * only the normal of a four-metre wave survives a kilometre of distance anyway.
 * `fade` takes the shortest ones out as the pixel footprint grows, which is what keeps
 * the specular from boiling.
 */
vec2 chopSlope(vec2 xz, float amp, float shoal, float shelter, float fade) {
  // Four sinusoids on their own make a woven crosshatch — perfectly periodic, and the
  // eye finds it in a second. Two slow fields fix that: one bends the phase, so the
  // crests wander instead of running dead straight, and one raises and lowers the
  // amplitude in patches, which is what wave groups actually look like from the air.
  vec4 w = texture2D(tBed, xz * 0.0017 + vec2(uTime * 0.0006, -uTime * 0.0004));
  float bend = (w.b - 0.5) * 13.0;
  float group = 0.45 + 1.15 * w.r;
  vec2 g = vec2(0.0);
  for (int i = GEOM_WAVES; i < 6; i++) {
    vec2 d = waveDir(i);
    float k = 2.0 * PI / W[i].z;
    float c = sqrt(9.81 / k);
    // The shorter the wave, the sooner it is dropped with distance.
    float keep = mix(1.0, fade, clamp(W[i].w, 0.0, 1.0));
    float a = waveSteep(i, shoal, shelter) / k * amp * keep * mix(1.0, group, 0.55);
    float co = cos(k * (dot(d, xz) - c * uTime) + bend * (0.6 + float(i) * 0.35));
    g += d * (a * k * co);
  }
  return g;
}

/**
 * How enclosed this piece of water is: 1 where land stands close on several sides.
 * Four taps at half a kilometre, which is the scale at which a channel stops behaving
 * like open sea.
 */
float shelterAt(vec2 xz) {
  vec2 a = uWind * 520.0, b = vec2(-uWind.y, uWind.x) * 520.0;
  float s = 0.0;
  s += smoothstep(-24.0, 4.0, terrainHeightAt(xz + a));
  s += smoothstep(-24.0, 4.0, terrainHeightAt(xz - a));
  s += smoothstep(-24.0, 4.0, terrainHeightAt(xz + b));
  s += smoothstep(-24.0, 4.0, terrainHeightAt(xz - b));
  return clamp(s * 0.42, 0.0, 1.0);
}

// ---------------------------------------------------------------------------
// The bottom
// ---------------------------------------------------------------------------

/**
 * What the sea floor is made of, from its depth and its slope. Sand on the beach face
 * and out on the sand flats, coral heads on the reef, dark seagrass in the deeper part
 * of the lagoon, bare rock wherever the bottom stands up steeply.
 */
vec3 seaFloorAlbedo(vec2 xz, float depth, float slope) {
  vec4 n = texture2D(tBed, xz * 0.00085);
  vec4 m = texture2D(tBed, xz * 0.0053 + 0.31);

  // Wet sand under water is nothing like a beach in the sun: about half the albedo,
  // and it is bright shallow sand that blows a lagoon out into a white field.
  vec3 sand = vec3(0.54, 0.49, 0.39) * (0.82 + 0.30 * m.a);
  vec3 coral = mix(vec3(0.40, 0.33, 0.28), vec3(0.26, 0.33, 0.27), m.r);
  vec3 weed = vec3(0.085, 0.12, 0.085) * (0.7 + 0.6 * m.g);
  vec3 rock = vec3(0.19, 0.18, 0.17) * (0.7 + 0.5 * m.a);

  // Coral grows on the reef flat and along its outer edge, patchily.
  float onReef = smoothstep(0.6, 2.2, depth) * (1.0 - smoothstep(7.0, 16.0, depth));
  float coralM = onReef * smoothstep(0.42, 0.72, n.r * 0.7 + m.r * 0.3);
  // Seagrass takes the still, deeper floor of the lagoon.
  float weedM = smoothstep(3.0, 8.0, depth) * (1.0 - smoothstep(16.0, 30.0, depth))
              * smoothstep(0.45, 0.80, n.g);
  float rockM = smoothstep(0.22, 0.55, slope);

  vec3 c = sand;
  c = mix(c, coral, coralM * (1.0 - rockM));
  c = mix(c, weed, weedM * (1.0 - rockM) * (1.0 - coralM * 0.7));
  c = mix(c, rock, rockM);
  return c;
}

/**
 * Caustics: the net of light the surface focuses onto the bottom. Two slowly drifting
 * fields differenced — the ridges where they cross are the bright lines.
 */
float caustics(vec2 xz, float depth) {
  vec2 p = xz * 0.055;
  float a = texture2D(tBed, p + vec2(uTime * 0.011, uTime * 0.008)).b;
  float b = texture2D(tBed, p * 1.31 + vec2(-uTime * 0.009, uTime * 0.013)).b;
  float c = 1.0 - abs(a - b) * 3.4;
  float net = pow(max(c, 0.0), 5.0);
  // They defocus with depth, and they need some water to form in at all: a caustic net
  // in twenty centimetres of water is a bright patch where there should be a beach.
  return 1.0 + net * 1.35 * smoothstep(0.3, 1.6, depth) * (1.0 - smoothstep(1.0, 20.0, depth));
}


/**
 * Foam left behind by a hull.
 *
 * Two things make a wake read: the churned water directly astern, which spreads slowly
 * and dies out, and the two feathered arms standing at nineteen and a half degrees from
 * the track — the Kelvin angle, which is the same for a rowing boat and a supertanker
 * and is what the eye recognises from the air.
 */
float wakeFoam(vec2 P) {
  float f = 0.0;
  for (int i = 0; i < MAX_WAKES; i++) {
    if (i >= uWakeCount) break;
    vec4 A = uWakeA[i], B = uWakeB[i];
    vec2 d = P - A.xy;
    float t = -dot(d, A.zw);                       // metres astern
    if (t < -B.x * 1.5 || t > B.y) continue;
    float w = abs(dot(d, vec2(-A.w, A.z)));        // metres off the track
    float ct = max(t, 0.0);
    float fade = pow(1.0 - smoothstep(0.0, B.y, ct), 1.6) * B.z;
    float trail = exp(-pow(w / (B.x * 0.55 + ct * 0.035), 2.0));
    float arm = exp(-pow((w - 0.354 * ct) / (1.3 + ct * 0.028), 2.0));
    f += (trail * 0.75 + arm * 0.62) * fade;
  }
  return clamp(f, 0.0, 1.0);
}
