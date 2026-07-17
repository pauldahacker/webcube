export const ACCELERATION = 40;
export const FRICTION = 1.0;
export const MAX_SPEED = 100;
export const ROTATION_SPEED = 0.85;
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
// Grip budget lost per degree of slip beyond the peak.
export const SLIP_FALLOFF_RATE = 0.03;
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
export const DRIFT_KICK_STRENGTH = 0.4;
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
export const PLAYER_SIZE = 1;
// Higher = the chase camera catches up to the cube's heading faster.
// Kept finite (not instant) so spinning/drifting doesn't snap the camera
// to face the cube's new heading immediately.
export const CAMERA_SMOOTHING = 6;
