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

  createTerrain(scene, track);
}
