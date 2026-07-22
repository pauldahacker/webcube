import * as THREE from 'three';
import { buildRoadGeometry, buildBarrierGeometry } from './track';
import type { BuiltTrack } from './track';
import { createTerrain } from './terrain';

// Half-cylinder ice-wall dimensions (world units).
const WALL_HALF_WIDTH = 0.28; // half the rounded base's width
const WALL_HEIGHT = 0.6; // how tall the rounded rail stands

export function createWorld(scene: THREE.Scene, track: BuiltTrack) {
  const roadGeometry = buildRoadGeometry(track);
  // Deep frozen-slate blue: dark enough that the pale drift streak still pops,
  // cold enough to read as a frozen lake. Smooth normals (no flatShading) keep
  // the twisted ribbon quads from shading into a zig-zag on banked sections.
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x263445, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(roadGeometry, roadMat));

  // Continuous rounded ice rails down both edges - same frosted-crystal recipe
  // as the player cube: flat-shaded facets and a baked deep-blue-to-frosted
  // gradient (vertexColors, from buildBarrierGeometry). Opaque and glossy - low
  // roughness gives the sharp shine off the light and sky (scene.environment).
  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, // hue comes from the baked vertex colors
    vertexColors: true,
    metalness: 0,
    roughness: 0.3,
    flatShading: true,
    envMapIntensity: 2,
    side: THREE.DoubleSide,
  });
  for (const side of [-1, 1] as const) {
    scene.add(new THREE.Mesh(buildBarrierGeometry(track, side, WALL_HALF_WIDTH, WALL_HEIGHT), barrierMat));
  }

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(5, 10, 5);
  scene.add(light);

  const startLine = createStartLine(scene, track);
  createTerrain(scene, track);
  return { flashStartLine: startLine.flash };
}

// Start/finish: a vertical glowing net you drive through - a grid of bright
// icy lines (blooms via the bloom pass), gently breathing. Placed at sample 0,
// the start and the finish seam on a loop. Local frame: X across the road
// (right), Y up (surface normal), so the net stands upright across the track.
const GATE_HEIGHT = 2;
const GATE_COL_STEP = 2; // spacing of vertical lines
const GATE_ROW_STEP = 1.0; // spacing of horizontal lines

function createStartLine(scene: THREE.Scene, track: BuiltTrack): { flash: () => void } {
  const s = track.samples[0];
  const right = s.right.clone().normalize();
  const tangent = s.tangent.clone().normalize();
  const normal = new THREE.Vector3().crossVectors(right, tangent).normalize();
  const forward = new THREE.Vector3().crossVectors(right, normal); // proper basis
  const center = new THREE.Vector3(s.x, s.y, s.z);
  const w = s.width;

  const pts: number[] = [];
  const cols = Math.max(2, Math.round(w / GATE_COL_STEP));
  for (let i = 0; i <= cols; i++) {
    const x = -w / 2 + (w * i) / cols;
    pts.push(x, 0, 0, x, GATE_HEIGHT, 0);
  }
  const rows = Math.max(1, Math.round(GATE_HEIGHT / GATE_ROW_STEP));
  for (let i = 0; i <= rows; i++) {
    const y = (GATE_HEIGHT * i) / rows;
    pts.push(-w / 2, y, 0, w / 2, y, 0);
  }

  const orient = new THREE.Matrix4().makeBasis(right, normal, forward);
  // Lift off the surface so the base line doesn't z-fight the road into dashes.
  const base = center.clone().addScaledVector(normal, 0.03);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  // Bright + additive so the lines add light over the dark sky and clear the
  // bloom threshold hard - a constant glow.
  const baseColor = new THREE.Color(0xc9faff);
  const flashColor = new THREE.Color(0x8affc8);
  const material = new THREE.LineBasicMaterial({
    color: baseColor.clone(),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const net = new THREE.LineSegments(geometry, material);
  net.quaternion.setFromRotationMatrix(orient);
  net.position.copy(base);
  scene.add(net);

  // Black posts at each road edge that the net spans between - a bit taller
  // than the net. Cylinder axis is local Y, which orient maps to the surface
  // normal, so they stand upright even on a banked start.
  const poleHeight = GATE_HEIGHT + 0.3;
  const poleGeo = new THREE.CylinderGeometry(0.18, 0.18, poleHeight, 12);
  // Polished silver: metalness below 1 lets the light silver base color show
  // under the scene lights (pure metal would only mirror the dark night and
  // read black), while low roughness + the aurora envMap keep it shiny.
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0xcbd0d8,
    metalness: 0.75,
    roughness: 0.22,
    envMapIntensity: 2,
  });
  for (const sideX of [-1, 1] as const) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.quaternion.setFromRotationMatrix(orient);
    pole.position
      .copy(center)
      .addScaledVector(right, (sideX * w) / 2)
      .addScaledVector(normal, poleHeight / 2);
    scene.add(pole);
  }

  // flash() pops the net to flashColor on a lap finish, then eases back.
  let flashStart = -Infinity;
  net.onBeforeRender = () => {
    const t = (performance.now() - flashStart) / 800;
    if (t >= 0 && t < 1) material.color.copy(baseColor).lerp(flashColor, 1 - t);
    else material.color.copy(baseColor);
  };
  return {
    flash: () => {
      flashStart = performance.now();
    },
  };
}
