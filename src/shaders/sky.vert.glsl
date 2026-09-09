varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(wp.xyz - cameraPosition);
  vec4 cp = projectionMatrix * viewMatrix * wp;
  gl_Position = cp.xyww; // push to far plane
}
