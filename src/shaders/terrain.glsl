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
uniform sampler2D tScreeD, tScreeN;
uniform sampler2D tMacro;
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
  float wSand  = (1.0 - smoothstep(1.2, 4.5 + 3.0 * macro2, h)) * (1.0 - smoothstep(0.30, 0.5, slope));
  float wCliff = smoothstep(0.26 + 0.10 * macro2, 0.46, slope);
  float wScree = smoothstep(260.0 + 200.0 * macro, 520.0, h) * (1.0 - smoothstep(0.34, 0.52, slope));
  float wForest = smoothstep(0.40, 0.68, macro + 0.22 * macro2 - 0.12)
                * smoothstep(10.0, 45.0, h) * (1.0 - smoothstep(240.0, 430.0, h))
                * (1.0 - smoothstep(0.22, 0.40, slope));
  // Priority: cliff over everything, then sand, then scree, then forest, then grass.
  float rest = 1.0 - wCliff;
  wSand *= rest;    rest -= wSand;
  wScree *= max(rest, 0.0); rest -= wScree;
  wForest *= max(rest, 0.0); rest -= wForest;
  float wGrass = max(rest, 0.0);

  albedo = vec3(0.0); rough = 0.0;
  vec3 planarN = vec3(0.0, 0.0, 1.0) * 0.0;  // accumulated tangent-space perturbation
  vec3 cliffN = N;
  if (wGrass > 0.02) { Layer l = samplePlanar(tGrassD, tGrassN, P.xz, 23.0, shade, mixNoise);
    albedo += l.albedo * wGrass; rough += l.rough * wGrass; planarN += l.normal * wGrass; }
  if (wForest > 0.02) { Layer l = samplePlanar(tForestD, tForestN, P.xz, 17.0, shade, mixNoise);
    albedo += l.albedo * wForest; rough += l.rough * wForest; planarN += l.normal * wForest; }
  if (wSand > 0.02) { Layer l = samplePlanar(tSandD, tSandN, P.xz, 13.0, shade * 1.1, mixNoise);
    albedo += l.albedo * wSand; rough += l.rough * wSand; planarN += l.normal * wSand; }
  if (wScree > 0.02) { Layer l = samplePlanar(tScreeD, tScreeN, P.xz, 25.0, shade, mixNoise);
    albedo += l.albedo * wScree; rough += l.rough * wScree; planarN += l.normal * wScree; }
  if (wCliff > 0.02) { Layer l = sampleTriplanar(tCliffD, tCliffN, P, N, 27.0, shade, mixNoise);
    albedo += l.albedo * wCliff; rough += l.rough * wCliff; cliffN = l.normal; }

  // Normal detail fades out with distance so far hills do not shimmer.
  float nearFade = 1.0 - smoothstep(700.0, 2600.0, dist);
  float planarW = (1.0 - wCliff) * nearFade;
  vec3 worldN = normalize(N + vec3(planarN.x, 0.0, planarN.y) * 0.85 * planarW);
  worldN = normalize(mix(worldN, mix(N, cliffN, nearFade), wCliff));

  // The source photographs are shot flat and read muddy under a physical sun, so the
  // ground gets a gentle grade: lifted overall, greener where it is grassy, warmer and
  // paler on scree, with slow large-scale variation for dry and lush patches.
  albedo *= (0.90 + 0.22 * macro) * uGroundLift;
  vec3 green = albedo * vec3(0.88, 1.16, 0.72);
  albedo = mix(albedo, green, (wGrass + wForest * 0.7) * (0.35 + 0.4 * macro2));
  albedo = mix(albedo, albedo * vec3(1.08, 1.02, 0.94), wScree * 0.5);
  albedo = mix(albedo, albedo * vec3(1.06, 1.03, 0.98), wSand * 0.6);
  ao = 1.0;
  rough = clamp(rough * 1.05, 0.38, 1.0);
  return worldN;
}
