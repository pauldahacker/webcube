// Every gameplay number in one place. Each constant says what happens when
// you raise it. Values are in world units (the cube is 1 unit wide) and
// seconds unless noted.

// --- Speed ---------------------------------------------------------------

// How hard the engine pushes. Higher = faster launch off the line.
export const ACCELERATION = 30;
// Top speed. The engine's push fades out as you approach it, so the last
// stretch is always gradual.
export const MAX_SPEED = 70;
// Slowdown per second while braking, and how quickly sideways sliding dies
// out. Higher = stronger brakes and shorter slides.
export const FRICTION = 1.0;
// Slowdown per second while coasting (throttle released). Much lower than
// FRICTION on purpose: letting go of the gas should glide, not brake.
export const COAST_DRAG = 0.25;

// --- Steering ------------------------------------------------------------

// Base turning rate, radians per second at full steering input. With
// TURN_RAMP_SPEED it sets the tightest non-drift carve radius:
// TURN_RAMP_SPEED / ROTATION_SPEED (~5.6 units). Turns wider than that are
// makeable by slowing and steering; only tighter ones require drift.
export const ROTATION_SPEED = 1;
// Below this speed, steering fades toward zero - the cube can't spin in
// place, like a car that has to be rolling to turn. Lower = full steering
// authority sooner, so slowing down actually tightens the turn (and drops
// the non-drift carve radius floor above) instead of hitting a fixed limit.
export const TURN_RAMP_SPEED = 5;
// Steering is this much stronger while off the throttle. Lifting off mid-
// corner turns the nose in more eagerly (like a real car's lift-off
// oversteer). 1 = no effect.
export const COAST_ROTATION_MULTIPLIER = 1.4;

// --- Grip ----------------------------------------------------------------
// The tires have one shared "grip budget" per moment. Throttle, holding a
// curve, and straightening out a slide all draw from it - ask for more than
// the budget and everything gets weaker at once. That trade-off is the
// whole driving model.

// Size of the grip budget. Higher = grippier everything. Must stay well
// above ACCELERATION, or plain straight-line throttle eats the entire
// budget and ACCELERATION stops mattering.
export const TIRE_GRIP_MAX = 130;
// "Slip" is the angle between where the cube points and where it actually
// moves. Up to this many degrees of slip, grip is at full strength.
export const SLIP_PEAK_DEG = 10;
// Grip lost per degree of slip beyond the peak. Higher = a provoked slide
// keeps sliding longer instead of straightening itself out.
export const SLIP_FALLOFF_RATE = 0.05;
// Grip never drops below this fraction of the budget, no matter how deep
// the slide - keeps every slide recoverable.
export const SLIP_FALLOFF_FLOOR = 0.5;
// Holding a curve costs grip like a real car's cornering force (it grows
// with speed squared). This is the speed where that cost starts to bite -
// keep it near MAX_SPEED, or even gentle turns get expensive too early.
export const CENTRIPETAL_REFERENCE_SPEED = 100;

// --- The drift button ----------------------------------------------------

// Tapping drift kicks the tail out by this fraction of current speed -
// a tap at high speed snaps hard, at a crawl does almost nothing.
export const DRIFT_KICK_STRENGTH = 0.2;
// Steering is this much stronger while drift is held.
export const DRIFT_ROTATION_MULTIPLIER = 2.1;
// While sliding, the full-grip slip range (SLIP_PEAK_DEG) shrinks to this
// fraction, so the slide keeps sliding. Smaller = slides tip in sooner and
// hold longer.
export const DRIFT_SLIP_PEAK_SCALE = 0.3;
// Keep holding drift and the slide deepens: over DRIFT_HOLD_RAMP_TIME
// seconds the slip range shrinks further, down to this fraction of its
// already-lowered value. Releasing stops the deepening but not the slide -
// it runs on until the cube straightens out on its own.
export const DRIFT_HOLD_MIN_SCALE = 0.7;
export const DRIFT_HOLD_RAMP_TIME = 0.6;
// Holding drift with no slide going (driving straight) drags speed down at
// this rate instead - the handbrake locking the wheels.
export const DRIFT_STRAIGHT_BRAKE = 0.8;

// --- Hills and walls -----------------------------------------------------

// How strongly slopes push the cube - downhill adds speed, uphill costs it.
export const SLOPE_FORCE = 25;
// Speed lost on first touching a wall, scaled by how square-on the hit is:
// a gentle graze loses almost nothing, head-on loses nearly everything.
export const WALL_IMPACT_FRICTION = 0.7;
// Drag per second while scraping along a wall. Low enough that wall-sliding
// is usable, high enough that it never beats driving the corner properly.
export const WALL_GRIND_FRICTION = 0.6;

// --- Looks (no effect on the racing itself) ------------------------------

export const PLAYER_SIZE = 1;
// How high the wall ribbons are drawn along the track edges.
export const BARRIER_HEIGHT = 0.5;
// How quickly the chase camera catches up to the cube's heading. Higher =
// snappier camera, lower = more lag during spins.
export const CAMERA_SMOOTHING = 6;
// How quickly the cube visually tilts to match slopes and banking.
export const BODY_TILT_SMOOTHING = 10;

// --- Engine internals (leave these alone) --------------------------------

// The simulation always advances in fixed steps of this size, no matter the
// display's frame rate - that's what makes every run exactly reproducible
// and leaderboard times comparable across machines.
export const PHYSICS_TIMESTEP = 1 / 120;
// Longest render gap the simulation will try to catch up on (e.g. after
// the tab was in the background) before just skipping ahead.
export const MAX_FRAME_DELTA = 0.25;
