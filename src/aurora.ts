import * as THREE from 'three';

// Procedural night sky: a dark gradient dome lit by animated aurora curtains.
// No textures or assets - just a shader on a sphere. Self-contained:
// createAurora(scene) is the only wiring; the dome re-centers on the camera
// (so the sky feels infinitely far) and advances its own clock in
// onBeforeRender, so main.ts needs no per-frame call.

const VERTEX_SHADER = `
  varying vec3 vDir;
  void main() {
    vDir = position; // dome is centered on the camera, so local dir = world dir
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;

    // Dark base sky: deepest at the zenith, lifting toward the horizon.
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.6));

    // Aurora above the horizon. A (cos,sin) azimuth loop keeps the curtains
    // seamless all the way around; height drives the vertical streaking.
    float azimuth = atan(dir.z, dir.x);
    vec2 loop = vec2(cos(azimuth), sin(azimuth)) * 2.0;
    float c1 = fbm(loop + vec2(uTime * 0.04, h * 2.5 - uTime * 0.06));
    float c2 = fbm(loop * 1.7 + vec2(-uTime * 0.03, h * 3.5 + uTime * 0.05));
    float curtain = pow(c1, 2.2) * 0.7 + pow(c2, 3.0) * 0.5;
    curtain *= smoothstep(-0.02, 0.5, h) * smoothstep(1.0, 0.3, h);

    // Dream-like gradient: green low, cyan mid, violet high, nudged by noise.
    float hue = clamp(h * 1.5 + c2 * 0.5, 0.0, 1.0);
    vec3 aurora = mix(vec3(0.15, 1.0, 0.5), vec3(0.2, 0.8, 1.0), smoothstep(0.0, 0.5, hue));
    aurora = mix(aurora, vec3(0.7, 0.3, 1.0), smoothstep(0.5, 1.0, hue));

    gl_FragColor = vec4(sky + aurora * curtain * 1.5, 1.0);
  }
`;

// Horizon color matches the scene fog so the terrain's far edge dissolves
// into the sky with no seam.
export function createAurora(scene: THREE.Scene, horizon = 0x2a0b4d, zenith = 0x05060f) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHorizon: { value: new THREE.Color(horizon) },
      uZenith: { value: new THREE.Color(zenith) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false, // never occludes the world; drawn first as a backdrop
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), material);
  dome.renderOrder = -1;
  dome.frustumCulled = false;

  const start = performance.now();
  dome.onBeforeRender = (_renderer, _scene, camera) => {
    dome.position.copy(camera.position);
    dome.updateMatrixWorld(true);
    material.uniforms.uTime.value = (performance.now() - start) / 1000;
  };
  scene.add(dome);
}
