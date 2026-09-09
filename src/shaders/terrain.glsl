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
varying vec3 vTWorldPos;
varying vec3 vTWorldNormal;

struct Layer { vec3 albedo; vec3 normal; float rough; };

vec3 unpackN(vec3 n) { return n * 2.0 - 1.0; }

// Two octaves of the same texture: the fine one carries the detail, the coarse one
// (5.7x larger and rotated) modulates its brightness and normal. Multiplying rather
// than cross-fading is what actually hides the tiling grid — the eye locks onto the
// low-frequency repeat, and after modulation that repeat is 5.7x further away.
Layer samplePlanar(sampler2D D, sampler2D N, vec2 p, float scale, float blend) {
  vec2 uv1 = p / scale;
  vec2 uv2 = mat2(0.81, -0.59, 0.59, 0.81) * p / (scale * 5.7);
  Layer l;
  vec4 n1 = texture2D(N, uv1), n2 = texture2D(N, uv2);
  vec3 c1 = texture2D(D, uv1).rgb, c2 = texture2D(D, uv2).rgb;
  float lum2 = dot(c2, vec3(0.299, 0.587, 0.114));
  l.albedo = clamp(c1 * (0.62 + 1.25 * lum2) * (0.92 + 0.16 * blend), 0.0, 1.4);
  l.normal = normalize(unpackN(n1.rgb) + unpackN(n2.rgb) * vec3(0.75, 0.75, 0.0));
  l.rough = clamp(n1.a * 0.7 + n2.a * 0.3, 0.0, 1.0);
  return l;
}

Layer sampleTriplanar(sampler2D D, sampler2D N, vec3 p, vec3 n, float scale) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec2 uvX = p.zy / scale, uvY = p.xz / scale, uvZ = p.xy / scale;
  Layer l;
  vec4 sX = texture2D(N, uvX), sY = texture2D(N, uvY), sZ = texture2D(N, uvZ);
  l.albedo = texture2D(D, uvX).rgb * w.x + texture2D(D, uvY).rgb * w.y + texture2D(D, uvZ).rgb * w.z;
  // Same de-tiling trick on the dominant axis, at a much larger scale.
  vec2 uvC = (abs(n.y) > 0.5 ? p.xz : (abs(n.x) > abs(n.z) ? p.zy : p.xy)) / (scale * 6.1);
  float lumC = dot(texture2D(D, uvC).rgb, vec3(0.299, 0.587, 0.114));
  l.albedo = clamp(l.albedo * (0.66 + 1.15 * lumC), 0.0, 1.4);
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
  // Scale-mix driven by noise, not by distance: no moving band as the camera flies.
  float blend = clamp(macro3 * 1.4 - 0.2, 0.0, 1.0);
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
  if (wGrass > 0.004) { Layer l = samplePlanar(tGrassD, tGrassN, P.xz, 13.0, blend);
    albedo += l.albedo * wGrass; rough += l.rough * wGrass; planarN += l.normal * wGrass; }
  if (wForest > 0.004) { Layer l = samplePlanar(tForestD, tForestN, P.xz, 8.5, blend);
    albedo += l.albedo * wForest; rough += l.rough * wForest; planarN += l.normal * wForest; }
  if (wSand > 0.004) { Layer l = samplePlanar(tSandD, tSandN, P.xz, 6.0, blend);
    albedo += l.albedo * wSand; rough += l.rough * wSand; planarN += l.normal * wSand; }
  if (wScree > 0.004) { Layer l = samplePlanar(tScreeD, tScreeN, P.xz, 11.0, blend);
    albedo += l.albedo * wScree; rough += l.rough * wScree; planarN += l.normal * wScree; }
  if (wCliff > 0.004) { Layer l = sampleTriplanar(tCliffD, tCliffN, P, N, 16.0);
    albedo += l.albedo * wCliff; rough += l.rough * wCliff; cliffN = l.normal; }

  // Normal detail fades out with distance so far hills do not shimmer.
  float nearFade = 1.0 - smoothstep(700.0, 2600.0, dist);
  float planarW = (1.0 - wCliff) * nearFade;
  vec3 worldN = normalize(N + vec3(planarN.x, 0.0, planarN.y) * 0.85 * planarW);
  worldN = normalize(mix(worldN, mix(N, cliffN, nearFade), wCliff));

  // Large-scale colour variation: dry patches, greener hollows, altitude bleaching.
  albedo *= 0.86 + 0.30 * macro;
  albedo = mix(albedo, albedo * vec3(0.94, 1.04, 0.80), wGrass * 0.55 * macro2);
  albedo = mix(albedo, albedo * vec3(1.05, 1.00, 0.94), wScree * 0.5);
  ao = 1.0;
  rough = clamp(rough * 1.05, 0.38, 1.0);
  return worldN;
}
