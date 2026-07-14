import * as THREE from 'three';
import {
  ACCELERATION,
  FRICTION,
  GRIP,
  DRIFT_GRIP,
  MAX_SPEED,
  ROTATION_SPEED,
  DRIFT_ROTATION_MULTIPLIER,
  TURN_RAMP_SPEED,
  PLAYER_SIZE,
  CAMERA_SMOOTHING,
} from './constants';
import type { MapSystem } from './map';
import type { MoveInput } from './input';

export type Start = { x: number; z: number; rotation: number };

// Chase camera sits behind and above the cube, in the cube's own local
// space - same offset the camera used to have as a literal child of the
// player. It's no longer parented so its rotation can lag the cube's
// instead of snapping to it every frame (see updateCamera).
const CAMERA_OFFSET = new THREE.Vector3(0, 3, 10);
const cameraQuaternion = new THREE.Quaternion();
const cameraOffsetWorld = new THREE.Vector3();

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

  player.userData.velocity = new THREE.Vector3();
  resetPlayer(player, start);
  snapCamera(camera, player);

  return player;
}

export function resetPlayer(player: THREE.Object3D, start: Start, camera?: THREE.Camera) {
  player.position.set(start.x, 0, start.z);
  player.rotation.y = start.rotation;
  (player.userData.velocity as THREE.Vector3).set(0, 0, 0);
  if (camera) snapCamera(camera, player);
}

// Instantly place the camera at its offset with no lag - used on spawn/reset
// so it doesn't slide in from wherever it was left.
function snapCamera(camera: THREE.Camera, player: THREE.Object3D) {
  cameraQuaternion.copy(player.quaternion);
  cameraOffsetWorld.copy(CAMERA_OFFSET).applyQuaternion(cameraQuaternion);
  camera.position.copy(player.position).add(cameraOffsetWorld);
  camera.quaternion.copy(cameraQuaternion);
}

// Eases the camera's orientation and offset toward the cube's current
// heading instead of matching it every frame - keeps drifts/spins from
// snap-rotating the view the way a rigidly parented camera would.
export function updateCamera(camera: THREE.Camera, player: THREE.Object3D, delta: number) {
  const t = 1 - Math.exp(-CAMERA_SMOOTHING * delta);
  cameraQuaternion.slerp(player.quaternion, t);
  cameraOffsetWorld.copy(CAMERA_OFFSET).applyQuaternion(cameraQuaternion);
  camera.position.copy(player.position).add(cameraOffsetWorld);
  camera.quaternion.copy(cameraQuaternion);
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
  const velocity: THREE.Vector3 = player.userData.velocity;

  // Steering authority ramps up with speed and maxes out at TURN_RAMP_SPEED -
  // a stationary cube can't pivot in place. Drift boosts the rotation rate
  // on top of that, which combined with the lower grip below is what makes
  // holding Enter through a turn snap the heading into a slide.
  const turnAuthority = Math.min(velocity.length() / TURN_RAMP_SPEED, 1);
  const rotationSpeed = ROTATION_SPEED * (moveInput.drift ? DRIFT_ROTATION_MULTIPLIER : 1);
  player.rotation.y += moveInput.turn * rotationSpeed * turnAuthority * delta;

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
