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
  DRIFT_STRAIGHT_BRAKE,
  COAST_DRAG,
  DRIFT_HOLD_MIN_SCALE,
  DRIFT_HOLD_RAMP_TIME,
  COAST_ROTATION_MULTIPLIER,
  CENTRIPETAL_REFERENCE_SPEED,
  OFF_TRACK_GRIP_MULTIPLIER,
  OFF_TRACK_FRICTION_MULTIPLIER,
  OFF_TRACK_THROTTLE_MULTIPLIER,
  SLOPE_FORCE,
  SLOPE_PROBE_DISTANCE,
  TURN_RAMP_SPEED,
  PLAYER_SIZE,
  CAMERA_SMOOTHING,
  BODY_TILT_SMOOTHING,
  WALL_IMPACT_FRICTION,
  WALL_GRIND_FRICTION,
} from './constants';
import type { MapSystem, TrackQuery } from './map';
import type { MoveInput } from './input';
import { surfaceNormal, lateralOffset } from './track';

export type Start = { x: number; z: number; rotation: number };

// All mutable simulation state for the cube in one plain struct - nothing
// physics-related lives on the THREE object. The sim advances only through
// stepPlayer at a fixed timestep, so identical inputs always produce
// identical runs regardless of display refresh rate, and the whole state is
// trivially serializable for replays later.
export type PlayerState = {
  x: number;
  y: number;
  z: number;
  heading: number; // yaw, radians - same convention as Object3D.rotation.y
  vx: number;
  vz: number;
  wasDrifting: boolean;
  isSliding: boolean;
  driftHoldTime: number;
  // Whether the cube ended last step pressed against a wall - the one-off
  // impact scrub only fires on the first frame of a contact, so sustained
  // sliding along a wall isn't re-charged the impact cost every step.
  touchingWall: boolean;
  // Outward xz wall normal from that contact (zero when not touching) -
  // used next step to stop grip from redirecting velocity into the wall,
  // where it would just be deleted (see lateralRequest in stepPlayer).
  wallNx: number;
  wallNz: number;
  lastTrackQuery: TrackQuery | null;
  // Transform as of the previous physics step - rendering lerps between prev
  // and current by the accumulator remainder (see syncPlayerObject), so the
  // fixed-rate sim still looks smooth at any display refresh rate.
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

// Collapses the interpolation window so rendering shows exactly the current
// state - used on reset and at the finish line so the cube doesn't lerp.
export function snapPlayerPrev(state: PlayerState) {
  state.prevX = state.x;
  state.prevY = state.y;
  state.prevZ = state.z;
  state.prevHeading = state.heading;
}

export function resetPlayerState(state: PlayerState, start: Start) {
  // y is left at 0 - the first physics step's ground-follow corrects it.
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

export function createPlayerObject(): THREE.Object3D {
  const player = new THREE.Object3D();
  const geometry = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
  const material = new THREE.MeshPhongMaterial({
    color: 0x7833aa,
    specular: 0x009900,
    shininess: 20,
  });

  const body = new THREE.Mesh(geometry, material);
  player.add(body);
  player.userData.body = body;

  return player;
}

// Chase camera sits behind and above the cube, in the cube's own local
// space. It isn't parented so its rotation can lag the cube's instead of
// snapping to it every frame (see updateCamera).
const CAMERA_OFFSET = new THREE.Vector3(0, 3, 10);
const cameraQuaternion = new THREE.Quaternion();
const cameraOffsetWorld = new THREE.Vector3();

// Instantly place the camera at its offset with no lag - used on spawn/reset
// so it doesn't slide in from wherever it was left.
export function snapCamera(camera: THREE.Camera, player: THREE.Object3D) {
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

// Grip budget available this step as a fraction of TIRE_GRIP_MAX, based on
// how far velocity has already slipped from the heading. Flat at full grip
// up to slipPeakDeg, then decays toward SLIP_FALLOFF_FLOOR - a slide can be
// provoked but never becomes unrecoverable.
function gripFraction(slipDeg: number, slipPeakDeg: number): number {
  if (slipDeg <= slipPeakDeg) return 1;
  const over = slipDeg - slipPeakDeg;
  return Math.max(SLIP_FALLOFF_FLOOR, 1 - over * SLIP_FALLOFF_RATE);
}

// Advances the simulation by exactly dt seconds. Must only ever be called
// with the fixed PHYSICS_TIMESTEP - pure scalar math over PlayerState, no
// THREE objects, so a server can re-run it to verify submitted runs.
export function stepPlayer(state: PlayerState, mapSystem: MapSystem, moveInput: MoveInput, dt: number) {
  snapPlayerPrev(state);

  const speed = Math.hypot(state.vx, state.vz);

  // Steering authority ramps up with speed and maxes out at TURN_RAMP_SPEED -
  // a stationary cube can't pivot in place. Drift boosts the rotation rate,
  // and coasting/braking boosts it too - lifting off transfers grip to the
  // front and the cube rotates into the turn more eagerly.
  const turnAuthority = Math.min(speed / TURN_RAMP_SPEED, 1);
  const rotationSpeed =
    ROTATION_SPEED *
    (moveInput.drift ? DRIFT_ROTATION_MULTIPLIER : 1) *
    (moveInput.forward <= 0 ? COAST_ROTATION_MULTIPLIER : 1);
  state.heading += moveInput.turn * rotationSpeed * turnAuthority * dt;

  // Heading basis vectors, matching Object3D.rotation.y conventions:
  // forward = (-sin h, -cos h), right = (cos h, -sin h) in the xz plane.
  const fx = -Math.sin(state.heading);
  const fz = -Math.cos(state.heading);
  const rx = Math.cos(state.heading);
  const rz = -Math.sin(state.heading);

  // Surface at the cube's current position - grip and off-track state used
  // for this step's forces. Off-track isn't a wall: it's just bad traction,
  // so cutting a corner is a real, costed choice rather than a hard block.
  const surfaceQuery = mapSystem.query(state.x, state.z);
  const surfaceGripMultiplier = surfaceQuery.grip * (surfaceQuery.offTrack ? OFF_TRACK_GRIP_MULTIPLIER : 1);
  const surfaceFrictionMultiplier = surfaceQuery.offTrack ? OFF_TRACK_FRICTION_MULTIPLIER : 1;

  // Slope along the heading, sampled a short distance ahead - downhill grade
  // adds forward speed, uphill costs it. Gravity, not tire force, so it's
  // applied directly below rather than competing for the grip budget.
  const aheadQuery = mapSystem.query(state.x + fx * SLOPE_PROBE_DISTANCE, state.z + fz * SLOPE_PROBE_DISTANCE);
  const slopeGrade = (aheadQuery.groundHeight - surfaceQuery.groundHeight) / SLOPE_PROBE_DISTANCE;
  const slopeAccel = -slopeGrade * SLOPE_FORCE;

  // Split last step's momentum into "along the new heading" and "sideways
  // from it". Because heading just rotated but velocity is still pointing
  // wherever it was a moment ago, this split is where slip angle comes from:
  // the more heading outran velocity this step, the bigger vLateral gets.
  const vForwardPrev = state.vx * fx + state.vz * fz;
  const vLateralBase = state.vx * rx + state.vz * rz;

  // A tap of the drift key (not held-over-steps) snaps the tail out by a
  // fraction of current speed, on top of whatever slip is already there.
  // Reusing the sign of the slip that's already forming (or the turn input,
  // if there's no slip yet) means the kick always reinforces the direction
  // the cube is already sliding rather than fighting it.
  const driftJustPressed = moveInput.drift && !state.wasDrifting;
  state.wasDrifting = moveInput.drift;
  const kickDir = vLateralBase !== 0 ? Math.sign(vLateralBase) : Math.sign(moveInput.turn);
  const vLateralPrev = driftJustPressed ? vLateralBase + kickDir * speed * DRIFT_KICK_STRENGTH : vLateralBase;

  // How far velocity has already diverged from the heading, in degrees.
  const slipDeg = Math.atan2(Math.abs(vLateralPrev), Math.abs(vForwardPrev)) * (180 / Math.PI);

  // Sliding is a state, not a button read: once a slide starts (tap-kicked,
  // or already carrying enough slip) it keeps the peak lowered - and so
  // keeps sliding - even if the key was released the instant it was pressed.
  // The slide only ends once slip decays under the lowered (drift-scaled)
  // peak, not the full one - that hysteresis is what makes a tap produce a
  // real, lingering slide rather than one that self-cancels in a few steps.
  // Continuing to hold the key doesn't start a slide by itself; it deepens
  // an existing one further, down to a floor, the longer it's held.
  state.isSliding =
    driftJustPressed || (state.isSliding && slipDeg > SLIP_PEAK_DEG * DRIFT_SLIP_PEAK_SCALE);

  state.driftHoldTime = moveInput.drift ? state.driftHoldTime + dt : 0;
  const holdRamp = Math.min(state.driftHoldTime / DRIFT_HOLD_RAMP_TIME, 1);
  const slideScale = DRIFT_SLIP_PEAK_SCALE * (1 - holdRamp * (1 - DRIFT_HOLD_MIN_SCALE));
  const slipPeakDeg = state.isSliding ? SLIP_PEAK_DEG * slideScale : SLIP_PEAK_DEG;

  // Holding any curve at all costs grip continuously (a real car's v^2/r
  // centripetal force), not just while there's residual slip to actively
  // correct. Subtracted from the budget itself so a fully "caught",
  // zero-slip turn still keeps taxing what's available as speed climbs.
  // Grows with speed^2, so no fixed-radius turn can be held forever.
  const yawRate = Math.abs(moveInput.turn) * rotationSpeed * turnAuthority;
  const curvatureLoad = (speed * speed * yawRate) / CENTRIPETAL_REFERENCE_SPEED;
  const gripBudget = Math.max(
    0,
    TIRE_GRIP_MAX * gripFraction(slipDeg, slipPeakDeg) * surfaceGripMultiplier - curvatureLoad
  );

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
  // small throttle request, so cornering stopped meaningfully competing
  // with throttle. Additive means any real lateral demand directly eats
  // into throttle's share too.
  const throttleMultiplier = surfaceQuery.offTrack ? OFF_TRACK_THROTTLE_MULTIPLIER : 1;
  const throttleRequest = moveInput.forward * ACCELERATION * throttleCurve * throttleMultiplier;
  let lateralRequest =
    -Math.sign(vLateralPrev) * Math.min(Math.abs(vLateralPrev) / Math.max(dt, 1e-6), TIRE_GRIP_MAX);

  // Pressed against a wall with the heading angled into it, grip "correcting"
  // slip means rotating velocity into the wall - where the wall clamp below
  // just deletes it, silently bleeding speed at up to full tire force every
  // step. Suppress the portion of the correction that points into the wall,
  // so sliding along a wall with a bit of steer-in holds its speed instead
  // of collapsing.
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

  // Gravity along the slope - not budget-limited, applies regardless of
  // throttle state, same as it would to a car coasting down a hill.
  vForward += slopeAccel * dt;

  // General drag always scrubs sideways slip. Forward speed is untouched
  // while actively powering (the throttle taper governs top speed), drags
  // at the full FRICTION rate while actively braking, and only gently at
  // COAST_DRAG while the throttle is simply released - lifting off should
  // glide, not read as braking. Off-track terrain drags everything harder.
  const frictionFactor = Math.max(0, 1 - FRICTION * surfaceFrictionMultiplier * dt);
  vLateral *= frictionFactor;
  if (!poweringForward) {
    const forwardDragRate = moveInput.forward !== 0 ? FRICTION : COAST_DRAG;
    vForward *= Math.max(0, 1 - forwardDragRate * surfaceFrictionMultiplier * dt);
  }

  // Handbrake with no slide to feed (going straight, or slip still under
  // the normal peak): the locked rears scrub forward speed - even against
  // full throttle - so holding drift on a straight visibly brakes instead
  // of doing nothing. Once a real slide is in progress the slide's own
  // losses take over and this stays out of the way.
  if (moveInput.drift && slipDeg <= SLIP_PEAK_DEG) {
    vForward *= Math.max(0, 1 - DRIFT_STRAIGHT_BRAKE * dt);
  }

  state.vx = fx * vForward + rx * vLateral;
  state.vz = fz * vForward + rz * vLateral;

  const newSpeed = Math.hypot(state.vx, state.vz);
  if (newSpeed > MAX_SPEED) {
    const clampScale = MAX_SPEED / newSpeed;
    state.vx *= clampScale;
    state.vz *= clampScale;
  }

  state.x += state.vx * dt;
  state.z += state.vz * dt;

  // Ground-follow: snap to the track surface at the new position. Queried
  // last so the hint this leaves behind tracks the cube's actual position
  // into the next step, and stashed for the caller's isFinish check so it
  // doesn't need a second nearest-sample search of its own.
  let groundQuery = mapSystem.query(state.x, state.z);

  // Wall collision: the track edges (the visual barriers) are physical. If
  // the step ended past the edge, clamp the cube back onto it and kill the
  // into-wall velocity component - the along-wall component survives, so
  // sliding along a wall is a real, usable move. The impact scrub fires
  // only on the FIRST frame of a contact (not re-charged every step while
  // pressed against the wall) and scales with the square of how square-on
  // the hit was, so a gentle graze costs almost nothing while a head-on
  // hit still ends the run. A light continuous grind drag while touching
  // keeps wall-riding a corner from beating actually driving it.
  const sample = mapSystem.builtTrack.samples[groundQuery.index];
  const offset = lateralOffset(mapSystem.builtTrack, groundQuery.index, state.x, state.z);
  const limit = sample.width / 2 - PLAYER_SIZE / 2;
  if (Math.abs(offset) > limit) {
    const side = Math.sign(offset);
    // Outward wall normal in the xz plane. right can have a y component on
    // banked sections, so its xz projection is renormalized; offset is
    // measured against the unnormalized projection (same metric as
    // isOffTrack), hence the /rightXZLen when converting excess offset into
    // a positional pushback distance.
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

  state.y = groundQuery.groundHeight + PLAYER_SIZE / 2;
  state.lastTrackQuery = groundQuery;
}

const normalVec = new THREE.Vector3();
const flatForward = new THREE.Vector3();
const surfaceForward = new THREE.Vector3();
const negSurfaceForward = new THREE.Vector3();
const surfaceRight = new THREE.Vector3();
const tiltMatrix = new THREE.Matrix4();
const targetBodyQuat = new THREE.Quaternion();
const inversePlayerQuat = new THREE.Quaternion();

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Writes the sim state to the render object, interpolated between the
// previous and current physics step by alpha (the accumulator remainder as
// a fraction of the fixed timestep) - purely visual, never read by physics.
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

  // Tilt the visual mesh (not the physics heading) to sit flush on the
  // road's slope/banking - otherwise a flat cube on a tilted surface pokes
  // a corner through it. Applied as a local rotation on the body mesh so
  // the physics basis vectors are unaffected.
  const body = player.userData.body as THREE.Mesh | undefined;
  if (!body || !state.lastTrackQuery) return;
  normalVec.copy(surfaceNormal(mapSystem.builtTrack, state.lastTrackQuery.index));
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
