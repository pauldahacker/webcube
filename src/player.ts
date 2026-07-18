// How the cube drives, in plain terms:
//
// The cube has a heading (where it points) and a velocity (where it moves).
// They are allowed to disagree - that disagreement is called slip, and a lot
// of slip is a slide/drift. Every physics step:
//
//   1. Steering rotates the heading.
//   2. Velocity is split into "along the heading" and "sideways".
//   3. The tires get one shared grip budget. Throttle, holding the curve,
//      and pulling the sideways part back to zero all draw from it - ask
//      for too much at once and everything weakens together.
//   4. Slopes push the cube, drag slows it, walls stop it, and the cube
//      sticks to the road surface.
//
// All of it is plain scalar math over PlayerState, advanced only in fixed
// PHYSICS_TIMESTEP steps - so identical inputs always produce identical
// runs (leaderboard fairness), and a server could re-run a submitted run
// to verify it. The THREE.js object is just a puppet: syncPlayerObject
// copies the state onto it for rendering and never feeds anything back.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  ACCELERATION,
  MAX_SPEED,
  FRICTION,
  COAST_DRAG,
  ROTATION_SPEED,
  TURN_RAMP_SPEED,
  COAST_ROTATION_MULTIPLIER,
  TIRE_GRIP_MAX,
  SLIP_PEAK_DEG,
  SLIP_FALLOFF_RATE,
  SLIP_FALLOFF_FLOOR,
  CENTRIPETAL_REFERENCE_SPEED,
  DRIFT_KICK_STRENGTH,
  DRIFT_ROTATION_MULTIPLIER,
  DRIFT_SLIP_PEAK_SCALE,
  DRIFT_HOLD_MIN_SCALE,
  DRIFT_HOLD_RAMP_TIME,
  DRIFT_STRAIGHT_BRAKE,
  SLOPE_FORCE,
  WALL_IMPACT_FRICTION,
  WALL_GRIND_FRICTION,
  PLAYER_SIZE,
  CAMERA_SMOOTHING,
  BODY_TILT_SMOOTHING,
} from './constants';
import type { MapSystem, TrackQuery } from './map';
import type { MoveInput } from './input';
import { surfaceNormal, lateralOffset } from './track';

export type Start = { x: number; z: number; rotation: number };

// How far ahead (in world units) the slope under the cube is sampled.
const SLOPE_PROBE_DISTANCE = 1;

// All simulation state for the cube, in one plain struct.
export type PlayerState = {
  x: number;
  y: number;
  z: number;
  heading: number; // yaw in radians, same convention as Object3D.rotation.y
  vx: number;
  vz: number;
  // Drift bookkeeping: wasDrifting detects the key's press moment,
  // isSliding is the "a slide is in progress" state (it outlives the key),
  // driftHoldTime is how long the key has been held.
  wasDrifting: boolean;
  isSliding: boolean;
  driftHoldTime: number;
  // Wall contact from last step. The impact cost fires only on the first
  // frame of a contact, and grip is told not to push into a touched wall.
  touchingWall: boolean;
  wallNx: number;
  wallNz: number;
  lastTrackQuery: TrackQuery | null;
  // Transform as of the previous step - rendering blends between prev and
  // current so the fixed-rate sim looks smooth at any display refresh rate.
  prevX: number;
  prevY: number;
  prevZ: number;
  prevHeading: number;
};

export function createPlayerState(start: Start): PlayerState {
  const state: PlayerState = {
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: 0,
    wasDrifting: false,
    isSliding: false,
    driftHoldTime: 0,
    touchingWall: false,
    wallNx: 0,
    wallNz: 0,
    lastTrackQuery: null,
    prevX: 0,
    prevY: 0,
    prevZ: 0,
    prevHeading: 0,
  };
  resetPlayerState(state, start);
  return state;
}

export function resetPlayerState(state: PlayerState, start: Start) {
  // y stays 0 here - the first step's ground-follow puts it on the road.
  state.x = start.x;
  state.y = 0;
  state.z = start.z;
  state.heading = start.rotation;
  state.vx = 0;
  state.vz = 0;
  state.wasDrifting = false;
  state.isSliding = false;
  state.driftHoldTime = 0;
  state.touchingWall = false;
  state.wallNx = 0;
  state.wallNz = 0;
  state.lastTrackQuery = null;
  snapPlayerPrev(state);
}

// Collapses the render-interpolation window so the cube draws exactly at
// the current state - used on reset and at the finish line.
export function snapPlayerPrev(state: PlayerState) {
  state.prevX = state.x;
  state.prevY = state.y;
  state.prevZ = state.z;
  state.prevHeading = state.heading;
}

// Grip available at a given slip angle, as a fraction of the full budget:
// full up to the peak, then falling off, never below the floor.
function gripFraction(slipDeg: number, slipPeakDeg: number): number {
  if (slipDeg <= slipPeakDeg) return 1;
  const over = slipDeg - slipPeakDeg;
  return Math.max(SLIP_FALLOFF_FLOOR, 1 - over * SLIP_FALLOFF_RATE);
}

// Advances the simulation by exactly dt seconds (always PHYSICS_TIMESTEP).
export function stepPlayer(state: PlayerState, mapSystem: MapSystem, moveInput: MoveInput, dt: number) {
  snapPlayerPrev(state);

  const speed = Math.hypot(state.vx, state.vz);

  // --- 1. Steering rotates the heading -----------------------------------
  // Authority fades to zero at a standstill (can't pivot in place), drift
  // steers harder, and being off the throttle steers harder too (lift-off
  // oversteer).
  const turnAuthority = Math.min(speed / TURN_RAMP_SPEED, 1);
  const rotationSpeed =
    ROTATION_SPEED *
    (moveInput.drift ? DRIFT_ROTATION_MULTIPLIER : 1) *
    (moveInput.forward <= 0 ? COAST_ROTATION_MULTIPLIER : 1);
  state.heading += moveInput.turn * rotationSpeed * turnAuthority * dt;

  // Heading basis vectors in the xz plane (matching Object3D.rotation.y):
  // forward = (-sin h, -cos h), right = (cos h, -sin h).
  const fx = -Math.sin(state.heading);
  const fz = -Math.cos(state.heading);
  const rx = Math.cos(state.heading);
  const rz = -Math.sin(state.heading);

  // --- 2. Read the road ---------------------------------------------------
  // Surface grip under the cube, and the slope a short distance ahead
  // (downhill pushes, uphill holds back - applied in stage 5).
  const surfaceQuery = mapSystem.query(state.x, state.z);
  const aheadQuery = mapSystem.query(state.x + fx * SLOPE_PROBE_DISTANCE, state.z + fz * SLOPE_PROBE_DISTANCE);
  const slopeGrade = (aheadQuery.groundHeight - surfaceQuery.groundHeight) / SLOPE_PROBE_DISTANCE;
  const slopeAccel = -slopeGrade * SLOPE_FORCE;

  // --- 3. Split velocity, work out the slip -------------------------------
  // The heading just rotated but velocity still points where it was going -
  // whatever ends up "sideways" relative to the new heading is the slip.
  const vForwardPrev = state.vx * fx + state.vz * fz;
  const vLateralBase = state.vx * rx + state.vz * rz;

  // Tapping the drift key kicks the tail out by a fraction of current
  // speed, in the direction the cube is already sliding or steering.
  const driftJustPressed = moveInput.drift && !state.wasDrifting;
  state.wasDrifting = moveInput.drift;
  const kickDir = vLateralBase !== 0 ? Math.sign(vLateralBase) : Math.sign(moveInput.turn);
  const vLateralPrev = driftJustPressed ? vLateralBase + kickDir * speed * DRIFT_KICK_STRENGTH : vLateralBase;

  const slipDeg = Math.atan2(Math.abs(vLateralPrev), Math.abs(vForwardPrev)) * (180 / Math.PI);

  // A slide is a state, not a button: once started (by the kick, above) it
  // keeps the grip peak lowered - and so keeps sliding - until slip decays
  // below the lowered threshold on its own, even if the key was released
  // immediately. Holding the key deepens the slide over DRIFT_HOLD_RAMP_TIME.
  state.isSliding =
    driftJustPressed || (state.isSliding && slipDeg > SLIP_PEAK_DEG * DRIFT_SLIP_PEAK_SCALE);
  state.driftHoldTime = moveInput.drift ? state.driftHoldTime + dt : 0;
  const holdRamp = Math.min(state.driftHoldTime / DRIFT_HOLD_RAMP_TIME, 1);
  const slideScale = DRIFT_SLIP_PEAK_SCALE * (1 - holdRamp * (1 - DRIFT_HOLD_MIN_SCALE));
  const slipPeakDeg = state.isSliding ? SLIP_PEAK_DEG * slideScale : SLIP_PEAK_DEG;

  // --- 4. The shared grip budget ------------------------------------------
  // Holding a curve costs grip like real cornering force (speed² × turn
  // rate), even with zero slip - so no turn is ever "free" at speed. What
  // remains is what throttle and slide-straightening get to share.
  const yawRate = Math.abs(moveInput.turn) * rotationSpeed * turnAuthority;
  const curvatureLoad = (speed * speed * yawRate) / CENTRIPETAL_REFERENCE_SPEED;
  const gripBudget = Math.max(
    0,
    TIRE_GRIP_MAX * gripFraction(slipDeg, slipPeakDeg) * surfaceQuery.grip - curvatureLoad
  );

  // Engine force fades to zero as forward speed approaches MAX_SPEED.
  // Braking (pushing against current motion) is never faded.
  const poweringForward =
    moveInput.forward !== 0 && (vForwardPrev === 0 || Math.sign(moveInput.forward) === Math.sign(vForwardPrev));
  const throttleCurve = poweringForward ? Math.max(0, 1 - Math.abs(vForwardPrev) / MAX_SPEED) : 1;

  // Throttle and the pull that straightens slides both request force from
  // the budget; if together they exceed it, both are scaled down equally.
  // (Summed rather than combined as a true force circle so that a large
  // cornering demand visibly eats into throttle - see git history.)
  const throttleRequest = moveInput.forward * ACCELERATION * throttleCurve;
  let lateralRequest =
    -Math.sign(vLateralPrev) * Math.min(Math.abs(vLateralPrev) / Math.max(dt, 1e-6), TIRE_GRIP_MAX);

  // Pressed against a wall, grip must not "straighten" the cube by pushing
  // velocity into the wall - the wall would just delete it, silently
  // bleeding speed. Suppress the into-wall part of the correction.
  if (state.touchingWall && lateralRequest !== 0) {
    const correctionSign = Math.sign(lateralRequest);
    const intoWall = correctionSign * rx * state.wallNx + correctionSign * rz * state.wallNz;
    if (intoWall > 0) {
      lateralRequest *= Math.max(0, 1 - intoWall);
    }
  }
  const requestMag = Math.abs(throttleRequest) + Math.abs(lateralRequest);
  const budgetScale = requestMag > gripBudget ? gripBudget / requestMag : 1;

  let vForward = vForwardPrev + throttleRequest * budgetScale * dt;
  let vLateral = vLateralPrev + lateralRequest * budgetScale * dt;

  // --- 5. Slopes and drag -------------------------------------------------
  // Slope push is gravity, not tire force - it ignores the grip budget.
  vForward += slopeAccel * dt;

  // Sideways speed always decays. Forward speed is untouched while
  // powering (the MAX_SPEED fade governs it), brakes hard at FRICTION,
  // and merely glides at COAST_DRAG when the throttle is just released.
  const frictionFactor = Math.max(0, 1 - FRICTION * dt);
  vLateral *= frictionFactor;
  if (!poweringForward) {
    const forwardDragRate = moveInput.forward !== 0 ? FRICTION : COAST_DRAG;
    vForward *= Math.max(0, 1 - forwardDragRate * dt);
  }

  // Handbrake with no slide to feed: holding drift while driving straight
  // scrubs speed instead of doing nothing.
  if (moveInput.drift && slipDeg <= SLIP_PEAK_DEG) {
    vForward *= Math.max(0, 1 - DRIFT_STRAIGHT_BRAKE * dt);
  }

  // Recombine into world velocity and cap at the hard ceiling.
  state.vx = fx * vForward + rx * vLateral;
  state.vz = fz * vForward + rz * vLateral;
  const newSpeed = Math.hypot(state.vx, state.vz);
  if (newSpeed > MAX_SPEED) {
    const clampScale = MAX_SPEED / newSpeed;
    state.vx *= clampScale;
    state.vz *= clampScale;
  }

  // --- 6. Move, hit walls, stick to the road ------------------------------
  state.x += state.vx * dt;
  state.z += state.vz * dt;

  let groundQuery = mapSystem.query(state.x, state.z);

  // The track edges are physical. Ending a step past the edge clamps the
  // cube back on, deletes the into-wall part of its velocity (the along-
  // wall part survives - wall-sliding is a real move), charges a one-off
  // impact cost scaled by how square-on the hit was, and applies a light
  // grind drag while touching.
  const sample = mapSystem.builtTrack.samples[groundQuery.index];
  const offset = lateralOffset(mapSystem.builtTrack, groundQuery.index, state.x, state.z);
  const limit = sample.width / 2 - PLAYER_SIZE / 2;
  // An edge marked "open" has no wall there (that part of the boundary sits
  // on more road, e.g. inside a hairpin) - the cube drives straight through.
  const edgeOpen = offset >= 0 ? sample.rightWallOpen : sample.leftWallOpen;
  if (!edgeOpen && Math.abs(offset) > limit) {
    const side = Math.sign(offset);
    // Outward wall normal in the xz plane. On banked sections the right
    // vector leans out of the plane, so its xz part is renormalized, and
    // excess offset is converted back to a distance with the same factor.
    const rightXZLen = Math.max(Math.hypot(sample.right.x, sample.right.z), 1e-6);
    const nx = (sample.right.x / rightXZLen) * side;
    const nz = (sample.right.z / rightXZLen) * side;
    const excess = Math.abs(offset) - limit;
    state.x -= nx * (excess / rightXZLen);
    state.z -= nz * (excess / rightXZLen);

    const vInto = state.vx * nx + state.vz * nz;
    if (vInto > 0) {
      const speedBefore = Math.hypot(state.vx, state.vz);
      state.vx -= nx * vInto;
      state.vz -= nz * vInto;
      if (!state.touchingWall) {
        const intoFrac = vInto / Math.max(speedBefore, 1e-6);
        const scrape = Math.max(0, 1 - WALL_IMPACT_FRICTION * intoFrac * intoFrac);
        state.vx *= scrape;
        state.vz *= scrape;
      }
    }

    const grind = Math.max(0, 1 - WALL_GRIND_FRICTION * dt);
    state.vx *= grind;
    state.vz *= grind;
    state.touchingWall = true;
    state.wallNx = nx;
    state.wallNz = nz;

    groundQuery = mapSystem.query(state.x, state.z);
  } else {
    state.touchingWall = false;
    state.wallNx = 0;
    state.wallNz = 0;
  }

  // Ground-follow: the cube always sits on the road surface.
  state.y = groundQuery.groundHeight + PLAYER_SIZE / 2;
  state.lastTrackQuery = groundQuery;
}

// ---------------------------------------------------------------------------
// Rendering: everything below draws the state and never affects physics.
// ---------------------------------------------------------------------------

export function createPlayerObject(): THREE.Object3D {
  const player = new THREE.Object3D();
  // Stylized ice: same flat-shaded language as the terrain. Few segments on
  // the rounded box = visible facets, like a hand-carved chunk of ice.
  const geometry = new RoundedBoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE, 2, PLAYER_SIZE * 0.15);
  const outerMaterial = new THREE.MeshStandardMaterial({
    color: 0xc4c9f4, // ice pulled toward the purple sky so the palette ties together
    roughness: 0.25,
    flatShading: true,
    transparent: true,
    opacity: 0.75, // simple see-through, no refraction
  });

  const outerCube = new THREE.Mesh(geometry, outerMaterial);
  player.add(outerCube);

  // Cartoon edge highlight - the white rim is what sells "ice cube" once the
  // realistic refraction is gone.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 30),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
  );
  outerCube.add(edges);

  // Cloudy core: a faint sharp-edged haze inside the faceted shell - the
  // contrast is what reads as freezer ice.
  const innerMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    transparent: true,
    opacity: 0.4,
    depthWrite: false, // don't fight the transparent shell for pixel ordering
  });
  const innerCube = new THREE.Mesh(
    new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE),
    innerMaterial
  );
  innerCube.scale.setScalar(0.8);

  const bubbles = new THREE.Group();
  const bubbleMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  for (let i = 0; i < 20; i++) {
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.01 + Math.random() * 0.02),
      bubbleMaterial
    );
    bubble.position.set(
      (Math.random() - 0.5) * PLAYER_SIZE * 0.7,
      (Math.random() - 0.5) * PLAYER_SIZE * 0.7,
      (Math.random() - 0.5) * PLAYER_SIZE * 0.7
    );
    bubbles.add(bubble);
  }

  player.userData.body = outerCube;
  outerCube.add(innerCube);
  outerCube.add(bubbles);

  return player;
}

export function resetPlayer(
  player: THREE.Object3D,
  state: PlayerState,
  start: Start,
  camera?: THREE.Camera
) {
  resetPlayerState(state, start);
  player.position.set(state.x, state.y, state.z);
  player.rotation.set(0, state.heading, 0);
  (player.userData.body as THREE.Mesh | undefined)?.quaternion.identity();
  if (camera) snapCamera(camera, player);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const normalVec = new THREE.Vector3();
const flatForward = new THREE.Vector3();
const surfaceForward = new THREE.Vector3();
const negSurfaceForward = new THREE.Vector3();
const surfaceRight = new THREE.Vector3();
const tiltMatrix = new THREE.Matrix4();
const targetBodyQuat = new THREE.Quaternion();
const inversePlayerQuat = new THREE.Quaternion();

// Copies the sim state onto the render object, blended between the previous
// and current physics step by alpha (how far we are into the next step).
// Also tilts the visible mesh to sit flush on slopes and banking - a purely
// cosmetic rotation on the child mesh; the physics heading is untouched.
export function syncPlayerObject(
  player: THREE.Object3D,
  state: PlayerState,
  mapSystem: MapSystem,
  alpha: number,
  renderDelta: number
) {
  const t = Math.min(Math.max(alpha, 0), 1);
  player.position.set(
    lerp(state.prevX, state.x, t),
    lerp(state.prevY, state.y, t),
    lerp(state.prevZ, state.z, t)
  );
  player.rotation.set(0, lerp(state.prevHeading, state.heading, t), 0);

  const body = player.userData.body as THREE.Mesh | undefined;
  if (!body || !state.lastTrackQuery) return;
  normalVec.copy(
    surfaceNormal(mapSystem.builtTrack, state.lastTrackQuery.index, player.position.x, player.position.z)
  );
  flatForward.set(-Math.sin(player.rotation.y), 0, -Math.cos(player.rotation.y));
  surfaceForward
    .copy(flatForward)
    .addScaledVector(normalVec, -flatForward.dot(normalVec))
    .normalize();
  surfaceRight.crossVectors(surfaceForward, normalVec).normalize();
  negSurfaceForward.copy(surfaceForward).negate();
  tiltMatrix.makeBasis(surfaceRight, normalVec, negSurfaceForward);
  targetBodyQuat.setFromRotationMatrix(tiltMatrix);
  inversePlayerQuat.copy(player.quaternion).invert();
  targetBodyQuat.premultiply(inversePlayerQuat);
  const tiltT = 1 - Math.exp(-BODY_TILT_SMOOTHING * renderDelta);
  body.quaternion.slerp(targetBodyQuat, tiltT);
}

// Chase camera: follows from behind and above, easing toward the cube's
// heading instead of matching it instantly, so drifts don't whip the view.
const CAMERA_OFFSET = new THREE.Vector3(0, 3, 10);
const cameraQuaternion = new THREE.Quaternion();
const cameraOffsetWorld = new THREE.Vector3();

// Place the camera instantly (no easing) - used on spawn and reset.
function snapCamera(camera: THREE.Camera, player: THREE.Object3D) {
  cameraQuaternion.copy(player.quaternion);
  cameraOffsetWorld.copy(CAMERA_OFFSET).applyQuaternion(cameraQuaternion);
  camera.position.copy(player.position).add(cameraOffsetWorld);
  camera.quaternion.copy(cameraQuaternion);
}

export function updateCamera(camera: THREE.Camera, player: THREE.Object3D, delta: number) {
  const t = 1 - Math.exp(-CAMERA_SMOOTHING * delta);
  cameraQuaternion.slerp(player.quaternion, t);
  cameraOffsetWorld.copy(CAMERA_OFFSET).applyQuaternion(cameraQuaternion);
  camera.position.copy(player.position).add(cameraOffsetWorld);
  camera.quaternion.copy(cameraQuaternion);
}
