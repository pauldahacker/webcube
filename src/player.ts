import * as THREE from 'three';
import {
  ACCELERATION,
  FRICTION,
  GRIP,
  DRIFT_GRIP,
  MAX_SPEED,
  ROTATION_SPEED,
  PLAYER_SIZE,
} from './constants';
import type { MapSystem } from './map';
import type { MoveInput } from './input';

export type Start = { x: number; z: number; rotation: number };

export function createPlayer(camera: THREE.Camera, start: Start) {
  const player = new THREE.Object3D();
  const geometry = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
  const material = new THREE.MeshPhongMaterial({
    color: 0x7833aa,
    specular: 0x009900,
    shininess: 20,
  });

  const body = new THREE.Mesh(geometry, material);
  player.add(body);
  player.add(camera);

  camera.position.set(0, 3, 10); // eye height

  player.userData.velocity = new THREE.Vector3();
  resetPlayer(player, start);

  return player;
}

export function resetPlayer(player: THREE.Object3D, start: Start) {
  player.position.set(start.x, 0, start.z);
  player.rotation.y = start.rotation;
  (player.userData.velocity as THREE.Vector3).set(0, 0, 0);
}

const HALF = PLAYER_SIZE / 2;
const forward = new THREE.Vector3();
const right = new THREE.Vector3();

function collidesAt(mapSystem: MapSystem, x: number, z: number): boolean {
  return (
    mapSystem.isWall(x - HALF, z - HALF) ||
    mapSystem.isWall(x + HALF, z - HALF) ||
    mapSystem.isWall(x - HALF, z + HALF) ||
    mapSystem.isWall(x + HALF, z + HALF)
  );
}

export function updatePlayer(
  player: THREE.Object3D,
  mapSystem: MapSystem,
  moveInput: MoveInput,
  delta: number
) {
  // Heading: steering swings the direction the cube FACES. It does not, by
  // itself, move the cube's momentum - that's the whole point of the model below.
  player.rotation.y += moveInput.turn * ROTATION_SPEED * delta;

  const velocity: THREE.Vector3 = player.userData.velocity;

  forward.set(0, 0, -1).applyQuaternion(player.quaternion);
  right.set(1, 0, 0).applyQuaternion(player.quaternion);

  // Split last frame's momentum into "along the new heading" and "sideways
  // from it". Because heading just rotated but velocity is still pointing
  // wherever it was a moment ago, this split is where slip angle comes from:
  // the more heading outran velocity this frame, the bigger vLateral gets.
  let vForward = velocity.dot(forward);
  let vLateral = velocity.dot(right);

  // Engine: throttle/brake only ever pushes along the heading, never sideways.
  if (moveInput.forward !== 0) {
    vForward += moveInput.forward * ACCELERATION * delta;
  }

  // Grip: the surface fights to cancel sideways motion, but only at a
  // limited rate. If lateral speed built up faster than grip can kill it
  // this frame, the remainder carries into next frame - that carry-over is
  // the drift.
  const gripStep = (moveInput.drift ? DRIFT_GRIP : GRIP) * delta;
  vLateral = Math.sign(vLateral) * Math.max(0, Math.abs(vLateral) - gripStep);

  velocity.copy(forward).multiplyScalar(vForward).addScaledVector(right, vLateral);

  const frictionFactor = Math.max(0, 1 - FRICTION * delta);
  velocity.multiplyScalar(frictionFactor);

  if (velocity.length() > MAX_SPEED) {
    velocity.setLength(MAX_SPEED);
  }

  const nextX = player.position.x + velocity.x * delta;
  const nextZ = player.position.z + velocity.z * delta;

  if (!collidesAt(mapSystem, nextX, player.position.z)) {
    player.position.x = nextX;
  } else {
    velocity.x = 0;
  }

  if (!collidesAt(mapSystem, player.position.x, nextZ)) {
    player.position.z = nextZ;
  } else {
    velocity.z = 0;
  }
}
