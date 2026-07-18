export const ACCELERATION = 40;
// Drag on forward speed while actively braking (throttle held against the
// direction of motion), and on lateral slip always - NOT the lift-off coast
// rate, which is the separate, much gentler COAST_DRAG below.
export const FRICTION = 1.0;
// Drag on forward speed while coasting (throttle fully released), per
// second. Deliberately much lower than FRICTION - at FRICTION's rate a
// lift-off read as hard braking (~63% of speed lost per second), which
// made lift-and-coast useless as a precision tool. An ice cube should glide.
export const COAST_DRAG = 0.25;
export const MAX_SPEED = 100;
export const ROTATION_SPEED = 0.8;
// Max combined force the tires can exert in one frame, shared between
// cancelling sideways slip and applying throttle (a friction circle) - see
// gripFraction/updatePlayer in player.ts. Must stay above ACCELERATION or
// straight-line throttle itself becomes grip-capped and ACCELERATION stops
// mattering - keep a healthy margin (~30%) so grip only becomes the binding
// constraint once cornering adds real lateral demand on top of it. Actual
// top speed under sustained straight-line throttle is ~ACCELERATION /
// FRICTION, not MAX_SPEED - tune this relative to that, not the nominal cap.
export const TIRE_GRIP_MAX = 130;
// Slip angle (degrees between heading and actual velocity) below which the
// full grip budget is available - a little slide is "free". Past this the
// budget shrinks, so carrying more slip costs both cornering and throttle.
export const SLIP_PEAK_DEG = 10;
// While the drift key (Enter) is held, the effective peak drops to this
// fraction of SLIP_PEAK_DEG - the same turn tips into a real slide almost
// immediately instead of needing a hard, committed turn to break loose.
export const DRIFT_SLIP_PEAK_SCALE = 0.3;
// Grip budget lost per degree of slip beyond the peak. Also sets where a
// slide becomes self-sustaining: past the slip angle where remaining grip
// can no longer out-pull the lateral speed that continued turning keeps
// generating, the slide holds instead of self-recovering - steeper falloff
// moves that tipping point to smaller (gentler) slides.
export const SLIP_FALLOFF_RATE = 0.05;
// Grip budget never drops below this fraction of TIRE_GRIP_MAX, even at
// extreme slip angles - keeps a slide recoverable instead of terminal.
export const SLIP_FALLOFF_FLOOR = 0.5;
// Speed (units/s) at which steering reaches full authority. Below this,
// turn rate is scaled down toward 0 at a standstill - a stationary cube
// can't pivot in place, same as a real car needs to be rolling to turn.
export const TURN_RAMP_SPEED = 8;
// Multiplies ROTATION_SPEED while drifting. Combined with the lower
// DRIFT_SLIP_PEAK_SCALE, this is what makes holding Enter through a turn
// snap the heading around into a slide instead of just carving a wider corner.
export const DRIFT_ROTATION_MULTIPLIER = 1.8;
// Instantaneous lateral kick applied the single frame the drift key is first
// pressed (not held), as a fraction of current speed - a tap at high speed
// snaps the tail out hard; the same tap at a crawl barely does anything.
// Holding the key afterward still applies DRIFT_SLIP_PEAK_SCALE so the slide
// can be sustained and steered rather than snapping straight back.
export const DRIFT_KICK_STRENGTH = 0.2;
// Extra forward-speed drag while the drift key is held without an actual
// slide in progress (slip still under the normal peak) - the handbrake
// locking the rears and scrubbing speed when yanked on a straight. Gives
// the key visible feedback going straight; deliberately not a random
// "wobble", which would break run determinism. Once a real slide is going,
// this steps aside - the slide's own losses take over.
export const DRIFT_STRAIGHT_BRAKE = 0.8;
// Once a slide starts, continuing to hold the drift key deepens it - the
// effective peak scale ramps from DRIFT_SLIP_PEAK_SCALE down to this floor
// (a fraction of it) over DRIFT_HOLD_RAMP_TIME seconds of holding. Releasing
// stops it deepening further but does not end the slide - see isSliding in
// updatePlayer, which keeps grip reduced until slip decays on its own.
export const DRIFT_HOLD_MIN_SCALE = 0.7;
export const DRIFT_HOLD_RAMP_TIME = 0.6;
// Multiplies ROTATION_SPEED while coasting or braking (throttle not held in
// the direction of current motion) - lifting off transfers grip from the
// rear to the front, letting the cube rotate into a turn more eagerly, the
// way trail-braking/lift-off oversteer works in a real car.
export const COAST_ROTATION_MULTIPLIER = 1.4;
// Holding a curve costs grip proportional to speed^2 * yawRate / this value
// (a real car's centripetal force, v^2/r), not just speed * yawRate - so
// even a fully "caught" turn with zero slip keeps taxing the grip budget
// as speed climbs, instead of going free the moment slip hits zero. This is
// a reference speed: below it cornering costs less than the old linear
// model, above it cornering gets quadratically more expensive, closing off
// holding a tight full-lock circle indefinitely at high speed. Keep this
// close to MAX_SPEED - much lower and even a plain turn (no drift) starts
// eating the whole grip budget well before top speed.
export const CENTRIPETAL_REFERENCE_SPEED = 100;
// Grip budget is multiplied by this off the track surface - driving off the
// paved line still works, but with badly reduced traction, rather than
// hitting an invisible wall. Cutting a corner is a real, costed choice.
export const OFF_TRACK_GRIP_MULTIPLIER = 0.4;
// Engine force is also multiplied by this off-track (loose surface, less
// effective power delivery) - without this, cutting straight across a
// corner at full throttle has no penalty at all, since grip only matters
// once there's cornering demand and friction is skipped while powering
// forward (see poweringForward in updatePlayer).
export const OFF_TRACK_THROTTLE_MULTIPLIER = 0.5;
// FRICTION is multiplied by this off the track surface, on top of the grip
// penalty above - rough terrain also just scrubs speed faster.
export const OFF_TRACK_FRICTION_MULTIPLIER = 3;
// How strongly a slope accelerates/decelerates the cube along its heading -
// downhill sections add forward speed, uphill sections cost it, in accel
// units per unit of grade (rise/run) sampled a small distance ahead.
export const SLOPE_FORCE = 25;
// World units ahead of the cube (along its heading) used to sample the
// slope for SLOPE_FORCE - larger smooths out noise from sharp grade changes
// but reacts to hills a bit later.
export const SLOPE_PROBE_DISTANCE = 1;
// Fixed physics step, seconds. The sim only ever advances in whole steps of
// this size (main.ts accumulates render deltas and steps N times per frame),
// so runs are identical at any display refresh rate - a leaderboard
// requirement - and can be re-simulated deterministically for replays.
export const PHYSICS_TIMESTEP = 1 / 120;
// Render deltas are clamped to this before feeding the accumulator, so
// returning from a background tab doesn't fire hundreds of catch-up steps.
export const MAX_FRAME_DELTA = 0.25;
export const PLAYER_SIZE = 1;
// Higher = the chase camera catches up to the cube's heading faster.
// Kept finite (not instant) so spinning/drifting doesn't snap the camera
// to face the cube's new heading immediately.
export const CAMERA_SMOOTHING = 6;
// Higher = the cube's visual mesh catches up to the road's slope/banking
// tilt faster. Kept finite so driving over a sharp elevation change doesn't
// snap the mesh's tilt instantly.
export const BODY_TILT_SMOOTHING = 10;
// Height of the visual guide walls along each track edge. As of the wall
// collision pass these correspond to real (physical) boundaries - see the
// wall clamp at the end of stepPlayer.
export const BARRIER_HEIGHT = 0.5;
// How much of the along-wall speed the first frame of wall contact scrubs,
// scaled by the SQUARE of how square-on the hit is (fraction of speed that
// was pointing into the wall) - quadratic so a gentle graze costs almost
// nothing while a head-on hit still costs nearly everything. Applied once
// per contact, not continuously - sliding along the wall afterwards is
// governed by WALL_GRIND_FRICTION instead.
export const WALL_IMPACT_FRICTION = 0.7;
// Continuous drag (per second, like FRICTION) while pressed against a wall.
// Low enough that sliding along a wall is a usable move that carries real
// speed, high enough that wall-riding a corner still loses to driving it.
export const WALL_GRIND_FRICTION = 0.6;
