Next: Use CatmullRomCurve3.

new THREE.CatmullRomCurve3(points)

creates a continuous smooth path going through your points.

Not storing positions anymore.
Storing a route.

1. points
[
  (0, 0, 0),
  (10, 0, 10),
  (20, 0, 0)
]

These are:

“checkpoints the curve must pass through”

The curve interpolates smoothly between them.

2. closed (VERY important for racing)
new THREE.CatmullRomCurve3(points, true)
If closed = false:
start → end
open road
If closed = true:
last point connects back to first
loop

✔ For racing:

Yes — usually true for laps

But:

time trials can be false (A → B)
circuits are true

3. curveType (how smoothing behaves)

Default.

4. tension (how “tight” the curve is)

Default.

5. getPoint(t)

This is the most important concept.

What is t (0 → 1)?

t is how far along the curve you are

Think of it like this:
t = 0     → start of track
t = 0.25  → 25% through track
t = 0.5   → halfway
t = 1     → end of track

So:

curve.getPoint(0.5)

means:

“Give me the position exactly halfway along the entire track”

⚠️ Important detail 

t is NOT linear distance

Meaning:

Even if:

point A → B is short
point B → C is long

t = 0.5 does NOT mean:

“middle distance in meters”

It means:

“middle of the curve parameter space”

Why this matters for racing games

If you do:

t += speed * delta;

you are saying:

“player progresses along track over time”

This is EXACTLY why splines are used in racing systems.



Instead of:
player.x += dx
player.z += dz

Do:

player.t += speed
player.position = curve.getPointAt(player.t)

How games actually use this
Position:
curve.getPointAt(t)
Direction (forward):
curve.getTangentAt(t)
Camera:
offset behind tangent direction
Ghost:
just another stored t over time
