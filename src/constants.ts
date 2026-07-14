export const ACCELERATION = 50;
export const FRICTION = 1.2;
export const MAX_SPEED = 200;
export const ROTATION_SPEED = 1;
// Max lateral (sideways) acceleration the surface can apply to cancel slip.
// Drift happens when (current speed * yaw rate) exceeds this. Note actual top
// speed under sustained throttle is ~ACCELERATION / FRICTION (~42 by default),
// not MAX_SPEED - tune GRIP relative to that, not the nominal cap.
export const GRIP = 45;
// Grip while the drift key (Enter) is held. Lower than GRIP so lateral slip
// carries over more between frames, exaggerating the drift during turns.
export const DRIFT_GRIP = 12;
// Speed (units/s) at which steering reaches full authority. Below this,
// turn rate is scaled down toward 0 at a standstill - a stationary cube
// can't pivot in place, same as a real car needs to be rolling to turn.
export const TURN_RAMP_SPEED = 8;
// Multiplies ROTATION_SPEED while drifting. Combined with the lower
// DRIFT_GRIP, this is what makes holding Enter through a turn snap the
// heading around into a slide instead of just carving a wider corner.
export const DRIFT_ROTATION_MULTIPLIER = 1.8;
export const PLAYER_SIZE = 1;
// Higher = the chase camera catches up to the cube's heading faster.
// Kept finite (not instant) so spinning/drifting doesn't snap the camera
// to face the cube's new heading immediately.
export const CAMERA_SMOOTHING = 6;
