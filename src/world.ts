import * as THREE from 'three';
import { buildRoadGeometry, buildBarrierGeometry } from './track';
import type { BuiltTrack } from './track';
import { BARRIER_HEIGHT } from './constants';
import { createTerrain } from './terrain';

export function createWorld(scene: THREE.Scene, track: BuiltTrack) {
  const roadGeometry = buildRoadGeometry(track);
  // Darker, purple-leaning asphalt: reads as damp, and gives the light gray
  // humid sheen and the icy drift streak something to show up against.
  // No flatShading here: the ribbon's quads are slightly twisted wherever
  // elevation or banking changes, and per-triangle normals turn that into a
  // light/dark zig-zag. Smooth normals keep the surface reading as flat.
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x55515c, side: THREE.DoubleSide });
  const road = new THREE.Mesh(roadGeometry, roadMat);
  scene.add(road);

  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xd6455c, side: THREE.DoubleSide });
  const leftBarrier = new THREE.Mesh(buildBarrierGeometry(track, -1, BARRIER_HEIGHT), barrierMat);
  const rightBarrier = new THREE.Mesh(buildBarrierGeometry(track, 1, BARRIER_HEIGHT), barrierMat);
  scene.add(leftBarrier);
  scene.add(rightBarrier);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(5, 10, 5);
  scene.add(light);

  createTerrain(scene, track);
}
