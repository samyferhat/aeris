// Injected into MeshStandardMaterial. Blends 4 PBR sets by slope / altitude / noise.
// Ground-facing sets use planar XZ mapping; the cliff set is triplanar so rock
// faces never stretch. Two tiling scales are mixed by distance to hide repetition.
// Packed: D = albedo*ao (sRGB), N = normal.rgb + roughness.a
uniform sampler2D tGrassD, tGrassN;
uniform sampler2D tForestD, tForestN;
uniform sampler2D tCliffD, tCliffN;
uniform sampler2D tSandD, tSandN;
uniform sampler2D tMacro;        // low-frequency noise for biome variation
uniform float uSeaLevel;
varying vec3 vTWorldPos;
varying vec3 vTWorldNormal;

struct Layer { vec3 albedo; vec3 normal; float rough; float ao; };

vec3 unpackN(vec3 n) { return n * 2.0 - 1.0; }

// Sample a set with two scales (near/far) rotated to decorrelate.
Layer samplePlanar(sampler2D D, sampler2D N, vec2 p, float scale, float farMix) {
  vec2 uv1 = p / scale;
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * p / (scale * 6.3);
  Layer l;
  vec3 d1 = texture2D(D, uv1).rgb, d2 = texture2D(D, uv2).rgb;
  vec4 n1 = texture2D(N, uv1), n2 = texture2D(N, uv2);
  l.albedo = mix(d1, d2, farMix);
  l.normal = normalize(mix(unpackN(n1.rgb), unpackN(n2.rgb), farMix));
  l.rough = mix(n1.a, n2.a, farMix);
  l.ao = 1.0;
  return l;
}

Layer sampleTriplanar(sampler2D D, sampler2D N, vec3 p, vec3 n, float scale) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec2 uvX = p.zy / scale, uvY = p.xz / scale, uvZ = p.xy / scale;
  Layer l;
  l.albedo = texture2D(D, uvX).rgb * w.x + texture2D(D, uvY).rgb * w.y + texture2D(D, uvZ).rgb * w.z;
  vec4 sX = texture2D(N, uvX), sY = texture2D(N, uvY), sZ = texture2D(N, uvZ);
  l.rough = sX.a * w.x + sY.a * w.y + sZ.a * w.z;
  l.ao = 1.0;
  // Whiteout-blend triplanar normals (Ben Golus).
  vec3 tnX = unpackN(sX.rgb), tnY = unpackN(sY.rgb), tnZ = unpackN(sZ.rgb);
  tnX = vec3(tnX.xy + n.zy, abs(tnX.z) * n.x);
  tnY = vec3(tnY.xy + n.xz, abs(tnY.z) * n.y);
  tnZ = vec3(tnZ.xy + n.xy, abs(tnZ.z) * n.z);
  l.normal = normalize(tnX.zyx * w.x + tnY.xzy * w.y + tnZ.xyz * w.z);
  return l;
}

// Returns world-space normal + fills albedo/rough/ao.
vec3 terrainSurface(out vec3 albedo, out float rough, out float ao) {
  vec3 P = vTWorldPos;
  vec3 N = normalize(vTWorldNormal);
  float dist = length(P - cameraPosition);
  float farMix = smoothstep(80.0, 700.0, dist);
  float macro = texture2D(tMacro, P.xz * 0.00035).r;
  float macro2 = texture2D(tMacro, P.xz * 0.0021 + 0.37).r;
  float slope = 1.0 - N.y;                       // 0 flat .. 1 vertical
  float h = P.y - uSeaLevel;

  // --- weights
  float wSand  = 1.0 - smoothstep(1.5, 5.0 + 3.0 * macro2, h);
  float wCliff = smoothstep(0.22 + 0.12 * macro2, 0.42, slope) + smoothstep(420.0 + 150.0 * macro, 700.0, h) * smoothstep(0.08, 0.25, slope);
  wCliff = clamp(wCliff, 0.0, 1.0);
  float wForest = smoothstep(0.35, 0.65, macro + 0.25 * macro2 - 0.15) * smoothstep(12.0, 40.0, h) * (1.0 - smoothstep(300.0, 450.0, h));
  float wGrass = 1.0;
  // Priority stack: sand < grass/forest < cliff
  vec3 wGF = vec3(wGrass * (1.0 - wForest), wForest, 0.0);
  float wG = wGF.x * (1.0 - wSand), wF = wGF.y * (1.0 - wSand), wS = wSand;
  wG *= 1.0 - wCliff; wF *= 1.0 - wCliff; wS *= 1.0 - wCliff;
  float wC = wCliff;

  albedo = vec3(0.0); rough = 0.0; ao = 0.0;
  vec3 nAccum = vec3(0.0);
  // Planar tangent frame: T = +X, B = +Z (uv = xz), N = geometric normal.
  if (wG > 0.004) { Layer l = samplePlanar(tGrassD, tGrassN, P.xz, 14.0, farMix);
    albedo += l.albedo * wG; rough += l.rough * wG; ao += l.ao * wG; nAccum += vec3(l.normal.x, l.normal.z, l.normal.y) * wG; }
  if (wF > 0.004) { Layer l = samplePlanar(tForestD, tForestN, P.xz, 9.0, farMix);
    albedo += l.albedo * wF; rough += l.rough * wF; ao += l.ao * wF; nAccum += vec3(l.normal.x, l.normal.z, l.normal.y) * wF; }
  if (wS > 0.004) { Layer l = samplePlanar(tSandD, tSandN, P.xz, 7.0, farMix);
    albedo += l.albedo * wS; rough += l.rough * wS; ao += l.ao * wS; nAccum += vec3(l.normal.x, l.normal.z, l.normal.y) * wS; }
  vec3 worldN;
  if (wC > 0.004) { Layer l = sampleTriplanar(tCliffD, tCliffN, P, N, 22.0 + 40.0 * farMix);
    albedo += l.albedo * wC; rough += l.rough * wC; ao += l.ao * wC; nAccum += l.normal * wC; }
  // Planar layers gave tangent-space perturbations; bend the geometric normal by them.
  vec3 tsn = nAccum;  // x: east, y: up-ish, z: south (for planar) — mixed with triplanar world normal
  worldN = normalize(N + vec3(tsn.x, 0.0, tsn.y) * 0.9 * (1.0 - wC) + (tsn - N) * wC);
  // Tint variation so large fields are not one flat colour.
  albedo *= 0.85 + 0.3 * macro;
  albedo = mix(albedo, albedo * vec3(0.95, 1.0, 0.85), wG * 0.5 * macro2);
  rough = clamp(rough * 1.05, 0.35, 1.0);
  return worldN;
}
