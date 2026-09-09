#include <atmosphere>
uniform sampler2D uStars;      // equirect HDRI (night sky)
uniform float uNight;          // 0 day .. 1 night
uniform float uStarsRotation;
uniform float uSunDiscScale;
varying vec3 vWorldDir;

vec2 equirect(vec3 d) {
  return vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
}

void main() {
  vec3 rd = normalize(vWorldDir);
  vec3 ro = planetPos(cameraPosition);
  vec3 T;
  vec3 col = scatter(ro, rd, 1e9, uSunDir, 16, 6, T);

  // Sun disc with limb darkening, attenuated by the atmosphere.
  float mu = dot(rd, uSunDir);
  float sunCos = cos(0.00466 * uSunDiscScale);
  float disc = smoothstep(sunCos - 0.00002, sunCos + 0.00004, mu);
  float limb = sqrt(max(0.0, 1.0 - pow(acos(min(mu, 1.0)) / (0.00466 * uSunDiscScale), 2.0)));
  col += disc * T * uSunIntensity * 300.0 * (0.4 + 0.6 * limb);

  // Night: stars/milky way + moon from a real HDRI, fading in as the sun sets.
  float c = cos(uStarsRotation), s = sin(uStarsRotation);
  vec3 sd = vec3(c * rd.x - s * rd.z, rd.y, s * rd.x + c * rd.z);
  vec3 stars = texture2D(uStars, equirect(sd)).rgb;
  float horizonFade = smoothstep(-0.05, 0.15, rd.y);
  col += stars * uNight * 0.35 * horizonFade;

  gl_FragColor = vec4(col, 1.0);
}
