How movement works, step by step
Every frame, main.ts:75 calls updatePlayer(player, mapSystem, moveInput, delta). delta is the real seconds elapsed since last frame, so everything below scales with time, not frame rate.

1. Turning (steering)

turnAuthority = min(velocity.length() / TURN_RAMP_SPEED, 1)   // 0 when still, 1 once fast enough
rotationSpeed = ROTATION_SPEED * (drift ? 1.8 : 1)
player.rotation.y += turn * rotationSpeed * turnAuthority * delta
You can't spin in place — turning authority scales up with your current speed until you hit TURN_RAMP_SPEED (8 units/s), then you get full turn rate. Holding the drift key (Enter) multiplies your turn rate by 1.8x.

2. Splitting velocity into "forward" and "sideways"

The cube's heading (forward/right vectors) just rotated in step 1, but the velocity vector from last frame is still pointing the old direction. The code projects last frame's velocity onto the new forward/right axes:

vForward = velocity · forward
vLateral = velocity · right
This is the whole trick: since the heading turned before this projection happens, some of your old velocity now shows up as "sideways" relative to your new heading — that mismatch is the slip/drift angle. The faster you turn relative to your speed, the more velocity gets reclassified as lateral.

3. Throttle only pushes forward

vForward += forwardInput * ACCELERATION * delta   // ACCELERATION = 50
No component is added to vLateral here — the engine can only push you along your current nose direction, never sideways.

4. Grip fights the sideways component

gripStep = (drift ? DRIFT_GRIP : GRIP) * delta   // 45 normal, 12 while drifting
vLateral = sign(vLateral) * max(0, |vLateral| - gripStep)
Grip tries to erase vLateral back to zero, but only at a limited rate per frame. If you generated more lateral speed this frame (via turning, step 2) than grip can cancel, the leftover carries into next frame — that's the drift sliding. Holding Enter drops grip from 45 to 12, so far more lateral speed survives each frame → a visibly longer slide.

5. Recombine, apply friction, clamp speed

velocity = forward * vForward + right * vLateral
velocity *= max(0, 1 - FRICTION * delta)   // FRICTION = 1.2, general drag
velocity.clampLength(MAX_SPEED)             // MAX_SPEED = 200
Note the comment in constants.ts:7: sustained-throttle top speed actually settles near ACCELERATION / FRICTION ≈ 42, well under the 200 cap — MAX_SPEED is a safety ceiling, not the normal top speed.

6. Move, checking collision per axis independently

nextX = position.x + velocity.x * delta
nextZ = position.z + velocity.z * delta
if (!collidesAt(nextX, position.z)) position.x = nextX; else velocity.x = 0
if (!collidesAt(position.x, nextZ)) position.z = nextZ; else velocity.z = 0
X and Z are moved and collision-checked separately (not as one diagonal step). This is why sliding along a wall works smoothly: if you're moving diagonally into a wall, the axis that's actually blocked gets zeroed while the other axis still goes through. collidesAt checks all four corners of the cube's footprint against the grid (isWall), so it's a simple AABB-vs-grid-cell check, not a physics engine.

7. Camera

Separately, player.ts:65 eases the chase camera's rotation toward the cube's heading with exponential smoothing (1 - e^(-6·delta)), rather than snapping instantly — so spins/drifts don't whip the camera around, it lags slightly behind.

The whole system has no Y-axis involvement at all right now — that's the concrete gap to close before "non-flat surfaces" is real.


TWEAKING THE CONSTANTS - MANUAL

Speed & acceleration
ACCELERATION (40) — how hard the engine pushes forward. Higher = punchier launch off the line. Doesn't directly set top speed anymore (see MAX_SPEED) but does determine how quickly you get there and how much throttle you have left over to compete with cornering demand mid-turn.

FRICTION (1.0) — general drag. Only matters while coasting/braking now (while actively powering forward, MAX_SPEED's taper is the sole speed governor — see player.ts:193). Higher = faster coast-down when you lift off, and faster lateral-slip decay too, since it also scrubs sideways speed every frame.

MAX_SPEED (100) — the real, reachable top speed ceiling under sustained straight-line throttle (engine force tapers to zero as you approach it). Raise it for a higher top speed; the approach stays gradual either way since it's taper-governed, not a hard clamp (the hard clamp still exists as a safety net but shouldn't normally be hit).

Grip & cornering
TIRE_GRIP_MAX (130) — the tire's total force budget per frame, shared between throttle, correcting slide, and holding a curve. Raise it and everything gets grippier/more forgiving across the board. Must stay comfortably above ACCELERATION (~30%+) or straight-line throttle itself becomes grip-capped and ACCELERATION stops mattering (this bit us earlier in the conversation).

SLIP_PEAK_DEG (10) — how many degrees of slip angle are "free" (full grip available) before grip starts falling off. Raise it and normal cornering tolerates more slide before punishing you; lower it and the car gets twitchy, losing grip on smaller slip angles.

SLIP_FALLOFF_RATE (0.03) — how fast grip drops per degree of slip beyond the peak. Higher = grip collapses more abruptly once you exceed SLIP_PEAK_DEG; lower = a gentler, more progressive loss of grip as a slide develops.

SLIP_FALLOFF_FLOOR (0.45) — the minimum grip fraction you always keep, even mid-slide. This is your "how recoverable is a drift" knob — raise it and slides stay controllable/steerable even when deep; lower it and a committed slide becomes closer to unrecoverable until it naturally decays. We raised this from 0.3 to fix drift feeling uncontrollable.

CENTRIPETAL_REFERENCE_SPEED (100) — the speed at which holding a curve costs the same as the old (pre-fix) linear model; above it, cornering cost grows with speed², below it cornering is cheaper. This is what stops you from holding a tight full-speed circle forever, and it's also what governs how hard cornering gets as you approach top speed. Keep it close to MAX_SPEED — much lower and even a plain turn (no drift) starts eating your whole grip budget well before top speed (this is exactly the bug we just fixed).

Steering & rotation
ROTATION_SPEED (0.8) — base yaw rate (rad/s) at full turn input and full speed. Higher = the cube spins faster for the same steering input, tightening every turn radius (and, since curvature cost scales with yaw rate too, also making cornering cost more grip at a given speed).

TURN_RAMP_SPEED (8) — speed below which turning authority is scaled down toward zero. Higher = the cube needs to be going faster before it can pivot at all (more "can't turn from a standstill" feel); lower = near-instant steering response even at a crawl.

COAST_ROTATION_MULTIPLIER (1.4) — rotation speed boost while off-throttle/braking (lift-off oversteer). Higher = releasing the gas mid-corner rotates you into the turn much more eagerly; set to 1 to remove the effect entirely.

Drift
DRIFT_ROTATION_MULTIPLIER (1.8) — rotation speed boost while the drift key is held. Higher = holding drift spins the heading dramatically faster than velocity can follow, snapping into a slide harder.

DRIFT_SLIP_PEAK_SCALE (0.3) — how much SLIP_PEAK_DEG shrinks the moment a slide starts. Lower = it takes almost no slip at all to tip into reduced-grip sliding once triggered; closer to 1 = drifting barely changes the grip curve at all.

DRIFT_KICK_STRENGTH (0.4) — the instant lateral kick (as a fraction of current speed) applied the single frame you press drift. Higher = a tap snaps the tail out more violently, especially at speed; lower = drift initiation is gentler and needs more turn input to really break loose.

DRIFT_HOLD_MIN_SCALE (0.7) — the floor DRIFT_SLIP_PEAK_SCALE ramps down to the longer you hold the key (as a fraction of DRIFT_SLIP_PEAK_SCALE itself). Lower = holding drift longer deepens the slide much further; closer to 1 = holding longer barely deepens it beyond the initial trigger. We raised this from 0.5 to keep held drifts from collapsing into an uncontrollable slide.

DRIFT_HOLD_RAMP_TIME (0.6) — seconds of continuous holding to reach that floor. Shorter = the slide deepens to max almost instantly once you commit; longer = a slower build, more time to feel it deepening under you.

Cosmetic / non-feel
PLAYER_SIZE (1) — cube's collision size. Affects wall clearance in tight corridors, not the physics feel itself.

CAMERA_SMOOTHING (6) — how fast the chase camera catches up to the cube's heading. Higher = camera snaps to face your direction almost immediately; lower = it lags more, which reads as more dramatic during spins/drifts but can feel disorienting if too low.

The interactions worth remembering
TIRE_GRIP_MAX > ACCELERATION (with margin), or straight-line acceleration gets silently grip-capped.
CENTRIPETAL_REFERENCE_SPEED ≈ MAX_SPEED, or cornering starts costing too much well before top speed.
DRIFT_SLIP_PEAK_SCALE × DRIFT_HOLD_MIN_SCALE × SLIP_FALLOFF_FLOOR together determine how "collapse-y" a held drift feels — if drift ever feels too extreme or too tame again, these three are where to look first, in that order.