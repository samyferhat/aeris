// ---------------------------------------------------------------------------
// Terrain surface, injected into MeshStandardMaterial.
//
// Five PBR sets blended by altitude, slope and a macro-variation field:
//   sand (beaches) · grass (lowland) · forest (vegetated slopes)
//   scree (high, moderate slope) · rockface (cliffs, triplanar)
//
// Textures are packed two-per-set to stay inside the 16 sampler limit:
//   *D = albedo × AO (sRGB) ; *N = normal.rgb + roughness.a
//
// Every set is sampled at two decorrelated scales and mixed by a slow noise, which
// breaks the visible tiling grid without the cost of stochastic hex tiling.
// ---------------------------------------------------------------------------
uniform sampler2D tGrassD, tGrassN;
uniform sampler2D tForestD, tForestN;
uniform sampler2D tCliffD, tCliffN;
uniform sampler2D tSandD, tSandN;
uniform sampler2D tMacro;   // r: macro variation  g: canopy relief  b: spare field
uniform sampler2D tTown;    // r: buildings  g: roads and hard standing  b: roof mass
uniform float uWorldSize;
uniform float uSeaLevel;
uniform float uGroundLift;
varying vec3 vTWorldPos;
varying vec3 vTWorldNormal;

struct Layer { vec3 albedo; vec3 normal; float rough; };

vec3 unpackN(vec3 n) { return n * 2.0 - 1.0; }

// ---------------------------------------------------------------------------
// De-tiling.
//
// A single scaled sample of a photographic texture repeats on a visible grid, and the
// eye locks onto it within a second. Two fixes are combined here:
//   * each layer is sampled twice, with different rotations and offsets, and the two
//     are cross-faded by a slow non-periodic noise — the product has no period;
//   * the base scale is large enough that a single tile spans tens of metres.
// Cost stays at two taps per layer, the same as a plain two-octave blend.
// ---------------------------------------------------------------------------
const mat2 ROT_A = mat2(0.9363, -0.3511, 0.3511, 0.9363);   // ~20.6 degrees
const mat2 ROT_B = mat2(0.1045, 0.9945, -0.9945, 0.1045);   // ~84 degrees

Layer samplePlanar(sampler2D D, sampler2D N, vec2 p, float scale, float shade, float mixNoise) {
  vec2 uvA = ROT_A * p / scale + vec2(0.31, 0.77);
  vec2 uvB = ROT_B * p / (scale * 1.37) + vec2(0.63, 0.18);
  float m = smoothstep(0.34, 0.66, mixNoise);
  vec4 nA = texture2D(N, uvA), nB = texture2D(N, uvB);
  Layer l;
  l.albedo = clamp(mix(texture2D(D, uvA).rgb, texture2D(D, uvB).rgb, m) * shade, 0.0, 1.4);
  l.normal = normalize(mix(unpackN(nA.rgb), unpackN(nB.rgb), m));
  l.rough = mix(nA.a, nB.a, m);
  return l;
}

Layer sampleTriplanar(sampler2D D, sampler2D N, vec3 p, vec3 n, float scale, float shade, float mixNoise) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  // The dominant axis is sampled twice (rotated) and the two minor axes once each:
  // grazing projections contribute little, so they do not need the same treatment.
  float m = smoothstep(0.34, 0.66, mixNoise);
  vec2 uvX = p.zy / scale, uvY = p.xz / scale, uvZ = p.xy / scale;
  vec2 uvX2 = ROT_A * p.zy / (scale * 1.41), uvY2 = ROT_A * p.xz / (scale * 1.41), uvZ2 = ROT_A * p.xy / (scale * 1.41);
  vec4 sX = mix(texture2D(N, uvX), texture2D(N, uvX2), m);
  vec4 sY = mix(texture2D(N, uvY), texture2D(N, uvY2), m);
  vec4 sZ = mix(texture2D(N, uvZ), texture2D(N, uvZ2), m);
  vec3 cX = mix(texture2D(D, uvX).rgb, texture2D(D, uvX2).rgb, m);
  vec3 cY = mix(texture2D(D, uvY).rgb, texture2D(D, uvY2).rgb, m);
  vec3 cZ = mix(texture2D(D, uvZ).rgb, texture2D(D, uvZ2).rgb, m);
  Layer l;
  l.albedo = clamp((cX * w.x + cY * w.y + cZ * w.z) * shade, 0.0, 1.4);
  l.rough = sX.a * w.x + sY.a * w.y + sZ.a * w.z;
  // Whiteout blend of the three tangent-space normals into world space (Ben Golus).
  vec3 tnX = unpackN(sX.rgb), tnY = unpackN(sY.rgb), tnZ = unpackN(sZ.rgb);
  tnX = vec3(tnX.xy + n.zy, abs(tnX.z) * n.x);
  tnY = vec3(tnY.xy + n.xz, abs(tnY.z) * n.y);
  tnZ = vec3(tnZ.xy + n.xy, abs(tnZ.z) * n.z);
  l.normal = normalize(tnX.zyx * w.x + tnY.xzy * w.y + tnZ.xyz * w.z);
  return l;
}

/**
 * Re-tinting.
 *
 * The photographic sets this world is textured from were shot in a dry climate: the
 * grass averages khaki and the forest averages brown. What they are good for is
 * structure — the grain, the clumping, the relative light and shade — and none of that
 * is in the hue. So each layer keeps its luminance, normalised around its own mean and
 * put through a contrast curve, and is painted with the colour the place should be.
 * `mean` is the linear luminance of the source set; `tint` is where it should land.
 */
vec3 retint(vec3 albedo, vec3 tint, float mean, float contrast) {
  float l = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  float v = pow(max(l / mean, 0.0), contrast);
  // A little of the original chroma survives, which keeps the patchiness from reading
  // as one flat colour with a noise field over it.
  vec3 chroma = albedo / max(l, 1e-3);
  return tint * v * mix(vec3(1.0), chroma, 0.22);
}

// Tropical volcanic island: wet forest on the flanks, coarse meadow in the clearings
// and on the valley floors, dark basalt where the rock is bare, coral sand on the beach.
const vec3 TINT_GRASS  = vec3(0.150, 0.205, 0.062);
const vec3 TINT_FOREST = vec3(0.052, 0.093, 0.036);
const vec3 TINT_CLIFF  = vec3(0.104, 0.096, 0.086);
const vec3 TINT_SAND   = vec3(0.640, 0.570, 0.450);
const vec3 TINT_SCREE  = vec3(0.150, 0.136, 0.120);

vec3 terrainSurface(out vec3 albedo, out float rough, out float ao) {
  vec3 P = vTWorldPos;
  vec3 N = normalize(vTWorldNormal);
  float dist = length(P - cameraPosition);
  float macro = texture2D(tMacro, P.xz * 0.00035).r;
  float macro2 = texture2D(tMacro, P.xz * 0.0021 + 0.37).r;
  float macro3 = texture2D(tMacro, P.xz * 0.0008 - 0.61).r;
  // Slow brightness variation that breaks the albedo repeat without introducing a
  // pattern of its own. Two frequencies, mean-preserving.
  float shade = (0.62 + 0.78 * macro3) * (0.80 + 0.42 * macro2);
  // Non-periodic selector between the two rotated instances of every texture.
  float mixNoise = texture2D(tMacro, P.xz * 0.0043 + 0.19).r * 0.65
                 + texture2D(tMacro, P.xz * 0.0011 - 0.44).r * 0.35;
  float slope = 1.0 - N.y;
  float h = P.y - uSeaLevel;

  // --- layer weights -------------------------------------------------------
  // A wet volcanic island in the tropics. Forest is the default cover, not the
  // exception: it climbs from just above the beach to the tree line and stops only
  // where the ground is too steep to hold it or the macro field opens a clearing.
  float wCliff = smoothstep(0.23 + 0.09 * macro2, 0.45, slope);
  float wSand  = (1.0 - smoothstep(1.0, 3.6 + 3.4 * macro2, h)) * (1.0 - smoothstep(0.15, 0.33, slope));
  float wScree = smoothstep(540.0 + 260.0 * macro, 880.0, h);
  float urbanMask = clamp(texture2D(tTown, P.xz / uWorldSize + 0.5).r * 2.2, 0.0, 1.0);
  float wForest = smoothstep(5.0, 26.0, h) * (1.0 - smoothstep(580.0, 840.0, h))
                * smoothstep(0.16, 0.44, macro * 0.60 + macro2 * 0.40)
                * (1.0 - smoothstep(0.28, 0.48, slope)) * (1.0 - urbanMask);
  // Priority: cliff over everything, then sand, then scree, then forest, then meadow.
  float rest = 1.0 - wCliff;
  wSand *= rest;    rest -= wSand;
  wScree *= max(rest, 0.0); rest -= wScree;
  wForest *= max(rest, 0.0); rest -= wForest;
  float wGrass = max(rest, 0.0);

  albedo = vec3(0.0); rough = 0.0;
  vec3 planarN = vec3(0.0, 0.0, 1.0) * 0.0;  // accumulated tangent-space perturbation
  vec3 cliffN = N;
  if (wGrass > 0.02) { Layer l = samplePlanar(tGrassD, tGrassN, P.xz, 23.0, shade, mixNoise);
    albedo += retint(l.albedo, TINT_GRASS, 0.0548, 0.80) * wGrass; rough += l.rough * wGrass; planarN += l.normal * wGrass; }
  if (wForest > 0.02) { Layer l = samplePlanar(tForestD, tForestN, P.xz, 15.0, shade, mixNoise);
    albedo += retint(l.albedo, TINT_FOREST, 0.0876, 0.95) * wForest; rough += l.rough * wForest; planarN += l.normal * wForest; }
  if (wSand > 0.02) { Layer l = samplePlanar(tSandD, tSandN, P.xz, 13.0, shade, mixNoise);
    // Wet sand is about half as bright as dry sand, and the band where it is wet is
    // the first metre and a half above the water.
    vec3 c = retint(l.albedo, TINT_SAND, 0.1560, 0.70) * mix(0.48, 1.0, smoothstep(0.1, 1.8, h));
    albedo += c * wSand; rough += mix(0.35, l.rough, smoothstep(0.1, 1.8, h)) * wSand; planarN += l.normal * wSand; }
  if (wScree > 0.02) { Layer l = samplePlanar(tCliffD, tCliffN, P.xz, 19.0, shade, mixNoise);
    albedo += retint(l.albedo, TINT_SCREE, 0.1372, 0.85) * wScree; rough += l.rough * wScree; planarN += l.normal * wScree; }
  if (wCliff > 0.02) { Layer l = sampleTriplanar(tCliffD, tCliffN, P, N, 24.0, shade, mixNoise);
    albedo += retint(l.albedo, TINT_CLIFF, 0.1372, 0.95) * wCliff; rough += l.rough * wCliff; cliffN = l.normal; }

  // Normal detail fades out with distance so far hills do not shimmer.
  float nearFade = 1.0 - smoothstep(700.0, 2600.0, dist);
  float planarW = (1.0 - wCliff) * nearFade;
  vec3 worldN = normalize(N + vec3(planarN.x, 0.0, planarN.y) * 0.85 * planarW);
  worldN = normalize(mix(worldN, mix(N, cliffN, nearFade), wCliff));

  // Canopy relief.
  //
  // Individual trees are only instanced for the first couple of kilometres; past that
  // the forest has to be in the ground itself. What makes a canopy read from the air is
  // not its colour, it is its lumpiness — crowns catching the sun on one side and
  // shading the neighbour on the other — so a field at roughly the scale of a crown is
  // turned into a slope and into its own ambient occlusion. It survives to the horizon,
  // where the photographic normal maps have long been faded out.
  if (wForest > 0.03) {
    float e = 4.5;
    float c0 = texture2D(tMacro, P.xz * 0.0090).g;
    float cx = texture2D(tMacro, (P.xz + vec2(e, 0.0)) * 0.0090).g;
    float cz = texture2D(tMacro, (P.xz + vec2(0.0, e)) * 0.0090).g;
    float canopyFade = 1.0 - smoothstep(2600.0, 7000.0, dist);
    float w = wForest * canopyFade;
    worldN = normalize(worldN - vec3(cx - c0, 0.0, cz - c0) * (4.0 * w));
    albedo *= mix(1.0, 0.78 + 0.42 * c0, w);
  }

  // ---- what has been built on it ------------------------------------------
  //
  // The town is in the ground as well as on it. Instanced buildings stop at three
  // kilometres, but the streets, the yards, the roofs and the hard standing are a
  // coverage map painted into the terrain, so a town seen from ten kilometres is still
  // a town — grey, hard-edged and gridded — rather than a green hillside with a smudge
  // of houses that appears when you get close.
  vec4 town = texture2D(tTown, P.xz / uWorldSize + 0.5);
  float built = clamp(town.r * 1.15, 0.0, 1.0);
  float road = clamp(town.g * 1.25, 0.0, 1.0);
  float urban = max(built, road);
  if (urban > 0.004) {
    vec3 yards = mix(vec3(0.085, 0.082, 0.074), vec3(0.150, 0.062, 0.038), 0.45 + 0.35 * macro2);
    albedo = mix(albedo, yards, built * 0.80);
    albedo = mix(albedo, vec3(0.058, 0.056, 0.056) * (0.8 + 0.5 * macro2), road * 0.86);
    rough = mix(rough, 0.74, urban * 0.8);
  }

  // Where the island is wetter it is greener, and it is wetter in the valleys and on
  // the windward flanks; a slow field stands in for both.
  float lush = 0.35 + 0.65 * macro3;
  albedo = mix(albedo, albedo * vec3(0.82, 1.10, 0.78), (wForest + wGrass * 0.7) * lush * 0.45 * (1.0 - urban));
  albedo *= uGroundLift;
  ao = 1.0;
  rough = clamp(rough * 1.05, 0.38, 1.0);
  return worldN;
}
