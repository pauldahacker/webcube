export const ACCELERATION = 50;
export const FRICTION = 1.2;
export const MAX_SPEED = 200;
export const ROTATION_SPEED = 2;
// Max lateral (sideways) acceleration the surface can apply to cancel slip.
// Drift happens when (current speed * yaw rate) exceeds this. Note actual top
// speed under sustained throttle is ~ACCELERATION / FRICTION (~42 by default),
// not MAX_SPEED - tune GRIP relative to that, not the nominal cap.
export const GRIP = 45;
export const PLAYER_SIZE = 1;
