import * as THREE from 'three';
import {
  ACCELERATION,
  FRICTION,
  TIRE_GRIP_MAX,
  SLIP_PEAK_DEG,
  DRIFT_SLIP_PEAK_SCALE,
  SLIP_FALLOFF_RATE,
  SLIP_FALLOFF_FLOOR,
  MAX_SPEED,
  ROTATION_SPEED,
  DRIFT_ROTATION_MULTIPLIER,
  DRIFT_KICK_STRENGTH,
  DRIFT_HOLD_MIN_SCALE,
  DRIFT_HOLD_RAMP_TIME,
  COAST_ROTATION_MULTIPLIER,
  CENTRIPETAL_REFERENCE_SPEED,
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
  player.userData.wasDrifting = false;
  player.userData.isSliding = false;
  player.userData.driftHoldTime = 0;
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

// Grip budget available this frame as a fraction of TIRE_GRIP_MAX, based on
// how far velocity has already slipped from the heading. Flat at full grip
// up to slipPeakDeg, then decays toward SLIP_FALLOFF_FLOOR - a slide can be
// provoked but never becomes unrecoverable.
function gripFraction(slipDeg: number, slipPeakDeg: number): number {
  if (slipDeg <= slipPeakDeg) return 1;
  const over = slipDeg - slipPeakDeg;
  return Math.max(SLIP_FALLOFF_FLOOR, 1 - over * SLIP_FALLOFF_RATE);
}

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
  // holding Enter through a turn snap the heading into a slide. Coasting or
  // braking (not powering forward) also boosts it - lifting off transfers
  // grip to the front and the cube rotates into the turn more eagerly.
  const turnAuthority = Math.min(velocity.length() / TURN_RAMP_SPEED, 1);
  const rotationSpeed =
    ROTATION_SPEED *
    (moveInput.drift ? DRIFT_ROTATION_MULTIPLIER : 1) *
    (moveInput.forward <= 0 ? COAST_ROTATION_MULTIPLIER : 1);
  player.rotation.y += moveInput.turn * rotationSpeed * turnAuthority * delta;

  forward.set(0, 0, -1).applyQuaternion(player.quaternion);
  right.set(1, 0, 0).applyQuaternion(player.quaternion);

  // Split last frame's momentum into "along the new heading" and "sideways
  // from it". Because heading just rotated but velocity is still pointing
  // wherever it was a moment ago, this split is where slip angle comes from:
  // the more heading outran velocity this frame, the bigger vLateral gets.
  const vForwardPrev = velocity.dot(forward);
  const vLateralBase = velocity.dot(right);

  // A tap of the drift key (not held-over-frames) snaps the tail out by a
  // fraction of current speed, on top of whatever slip is already there.
  // Reusing the sign of the slip that's already forming (or the turn input,
  // if there's no slip yet) means the kick always reinforces the direction
  // the cube is already sliding rather than fighting it.
  const wasDrifting = (player.userData.wasDrifting as boolean | undefined) ?? false;
  const driftJustPressed = moveInput.drift && !wasDrifting;
  player.userData.wasDrifting = moveInput.drift;
  const kickDir = vLateralBase !== 0 ? Math.sign(vLateralBase) : Math.sign(moveInput.turn);
  const vLateralPrev = driftJustPressed
    ? vLateralBase + kickDir * velocity.length() * DRIFT_KICK_STRENGTH
    : vLateralBase;

  // How far velocity has already diverged from the heading, in degrees.
  const slipDeg = Math.atan2(Math.abs(vLateralPrev), Math.abs(vForwardPrev)) * (180 / Math.PI);

  // Sliding is a state, not a button read: once a slide starts (tap-kicked,
  // or already carrying enough slip) it keeps the peak lowered - and so
  // keeps sliding - until slip decays back under the normal peak on its own,
  // even if the key was released the instant it was pressed. Continuing to
  // hold the key doesn't start a slide by itself; it deepens an existing one
  // further, down to a floor, the longer it's held.
  const wasSliding = (player.userData.isSliding as boolean | undefined) ?? false;
  const isSliding = driftJustPressed || (wasSliding && slipDeg > SLIP_PEAK_DEG);
  player.userData.isSliding = isSliding;

  const driftHoldTime = moveInput.drift ? ((player.userData.driftHoldTime as number | undefined) ?? 0) + delta : 0;
  player.userData.driftHoldTime = driftHoldTime;
  const holdRamp = Math.min(driftHoldTime / DRIFT_HOLD_RAMP_TIME, 1);
  const slideScale = DRIFT_SLIP_PEAK_SCALE * (1 - holdRamp * (1 - DRIFT_HOLD_MIN_SCALE));
  const slipPeakDeg = isSliding ? SLIP_PEAK_DEG * slideScale : SLIP_PEAK_DEG;

  // Holding any curve at all costs grip continuously (a real car's v^2/r
  // centripetal force), not just while there's residual slip to actively
  // correct. Subtracted from the budget itself - rather than added to the
  // correction demand, which just gets clipped at TIRE_GRIP_MAX either way
  // and so never actually squeezed throttle - so a fully "caught", zero-slip
  // turn still keeps taxing what's available as speed climbs, instead of
  // going free the instant grip catches up and reopening unlimited cornering
  // speed. Grows with speed^2, so no fixed-radius turn can be held forever.
  const speed = velocity.length();
  const yawRate = Math.abs(moveInput.turn) * rotationSpeed * turnAuthority;
  const curvatureLoad = (speed * speed * yawRate) / CENTRIPETAL_REFERENCE_SPEED;
  const gripBudget = Math.max(0, TIRE_GRIP_MAX * gripFraction(slipDeg, slipPeakDeg) - curvatureLoad);

  // Engine force tapers off as forward speed (in the current heading
  // direction) climbs toward MAX_SPEED, hitting zero right at it. Braking or
  // reversing - pushing opposite to current motion - isn't tapered, so the
  // brakes don't get weaker as you approach top speed, only the throttle does.
  const poweringForward =
    moveInput.forward !== 0 && (vForwardPrev === 0 || Math.sign(moveInput.forward) === Math.sign(vForwardPrev));
  const throttleCurve = poweringForward ? Math.max(0, 1 - Math.abs(vForwardPrev) / MAX_SPEED) : 1;

  // Throttle (along heading) and grip correction (cancelling sideways slip)
  // are both requests against the same tire budget. Combined additively
  // rather than as a true circle (hypot) - with TIRE_GRIP_MAX kept well
  // above ACCELERATION so straight-line throttle isn't grip-capped, a
  // Euclidean combination lets a maxed-out lateral demand barely dent a
  // small throttle request (sqrt(a^2+b^2) is close to b when b dominates),
  // so cornering stopped meaningfully competing with throttle. Additive
  // means any real lateral demand directly eats into throttle's share too.
  const throttleRequest = moveInput.forward * ACCELERATION * throttleCurve;
  const lateralRequest =
    -Math.sign(vLateralPrev) * Math.min(Math.abs(vLateralPrev) / Math.max(delta, 1e-6), TIRE_GRIP_MAX);
  const requestMag = Math.abs(throttleRequest) + Math.abs(lateralRequest);
  const budgetScale = requestMag > gripBudget ? gripBudget / requestMag : 1;

  let vForward = vForwardPrev + throttleRequest * budgetScale * delta;
  let vLateral = vLateralPrev + lateralRequest * budgetScale * delta;

  // General drag always scrubs sideways slip, but only scrubs forward speed
  // while coasting/braking - while actively powering forward, the taper
  // above is the sole governor of top speed, so it isn't fighting friction
  // for the whole climb the way it used to.
  const frictionFactor = Math.max(0, 1 - FRICTION * delta);
  vLateral *= frictionFactor;
  if (!poweringForward) {
    vForward *= frictionFactor;
  }

  velocity.copy(forward).multiplyScalar(vForward).addScaledVector(right, vLateral);

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
