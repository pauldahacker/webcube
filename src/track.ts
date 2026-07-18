import * as THREE from 'three';

export type TrackPoint = {
  x: number;
  z: number;
  elevation: number;
  width: number;
  banking: number; // degrees, tilt of the cross-section around the direction of travel
  grip: number; // surface grip multiplier, 1 = neutral
};

export type TrackSample = {
  x: number;
  y: number;
  z: number;
  tangent: THREE.Vector3; // unit, direction of travel (includes vertical component on slopes)
  right: THREE.Vector3; // unit, perpendicular to tangent, tilted by banking
  width: number;
  grip: number;
  arcLength: number; // cumulative distance from the start of the track
};

export type BuiltTrack = {
  samples: TrackSample[];
  totalLength: number;
  closedLoop: boolean;
};

// World units between resampled points - the resolution physics/rendering see.
export const SAMPLE_SPACING = 0.5;
// Substeps per control-point segment used only to measure arc length accurately
// before resampling - not the final sample resolution.
const SUBSTEPS_PER_SEGMENT = 24;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function pointAt(points: TrackPoint[], closedLoop: boolean, index: number): TrackPoint {
  const n = points.length;
  if (closedLoop) return points[((index % n) + n) % n];
  return points[Math.min(Math.max(index, 0), n - 1)];
}

type DensePoint = {
  x: number;
  y: number;
  z: number;
  width: number;
  banking: number;
  grip: number;
};

// Catmull-Rom passes exactly through p1/p2, using p0/p3 (neighbors) to shape
// the curve - so authoring a track is just placing points, no handle-dragging.
function evaluateSegment(points: TrackPoint[], closedLoop: boolean, segIndex: number, t: number): DensePoint {
  const p0 = pointAt(points, closedLoop, segIndex - 1);
  const p1 = pointAt(points, closedLoop, segIndex);
  const p2 = pointAt(points, closedLoop, segIndex + 1);
  const p3 = pointAt(points, closedLoop, segIndex + 2);
  return {
    x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
    y: catmullRom(p0.elevation, p1.elevation, p2.elevation, p3.elevation, t),
    z: catmullRom(p0.z, p1.z, p2.z, p3.z, t),
    width: catmullRom(p0.width, p1.width, p2.width, p3.width, t),
    banking: catmullRom(p0.banking, p1.banking, p2.banking, p3.banking, t),
    grip: catmullRom(p0.grip, p1.grip, p2.grip, p3.grip, t),
  };
}

// Resamples a control-point spline into evenly (arc-length) spaced samples with
// per-sample tangent/right/width/grip - shared by the game, renderer, and editor
// preview so what's authored is exactly what's driven on.
export function buildTrack(points: TrackPoint[], closedLoop: boolean): BuiltTrack {
  if (points.length < 2) {
    throw new Error('buildTrack needs at least 2 points');
  }
  const segmentCount = closedLoop ? points.length : points.length - 1;

  // Dense pass: evaluate many substeps per segment, tracking cumulative arc
  // length, so the resampling pass below can walk by true distance, not by
  // spline parameter (which isn't evenly spaced along the curve).
  const dense: (DensePoint & { arcLength: number })[] = [];
  let arcLength = 0;
  for (let seg = 0; seg < segmentCount; seg++) {
    const isLastSegment = seg === segmentCount - 1 && !closedLoop;
    const stepsThisSegment = isLastSegment ? SUBSTEPS_PER_SEGMENT + 1 : SUBSTEPS_PER_SEGMENT;
    for (let s = 0; s < stepsThisSegment; s++) {
      const t = s / SUBSTEPS_PER_SEGMENT;
      const p = evaluateSegment(points, closedLoop, seg, t);
      if (dense.length > 0) {
        const prev = dense[dense.length - 1];
        arcLength += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      }
      dense.push({ ...p, arcLength });
    }
  }
  const totalLength = arcLength;

  // Walk the dense polyline at fixed arc-length spacing, linearly interpolating
  // between the two nearest dense points (close enough together to treat as
  // straight) to land exactly SAMPLE_SPACING apart.
  const sampleCount = Math.max(2, Math.round(totalLength / SAMPLE_SPACING));
  const rawSamples: (DensePoint & { arcLength: number })[] = [];
  let denseIndex = 0;
  for (let i = 0; i <= sampleCount; i++) {
    const targetArc = Math.min((i / sampleCount) * totalLength, totalLength);
    while (denseIndex < dense.length - 2 && dense[denseIndex + 1].arcLength < targetArc) denseIndex++;
    const a = dense[denseIndex];
    const b = dense[Math.min(denseIndex + 1, dense.length - 1)];
    const span = b.arcLength - a.arcLength;
    const localT = span > 0 ? (targetArc - a.arcLength) / span : 0;
    rawSamples.push({
      x: a.x + (b.x - a.x) * localT,
      y: a.y + (b.y - a.y) * localT,
      z: a.z + (b.z - a.z) * localT,
      width: a.width + (b.width - a.width) * localT,
      banking: a.banking + (b.banking - a.banking) * localT,
      grip: a.grip + (b.grip - a.grip) * localT,
      arcLength: targetArc,
    });
  }

  // Tangent from neighboring resampled points; right is tangent x up, then
  // tilted by banking around the tangent axis for a banked cross-section.
  const up = new THREE.Vector3(0, 1, 0);
  const samples: TrackSample[] = rawSamples.map((p, i) => {
    const prev = rawSamples[Math.max(i - 1, 0)];
    const next = rawSamples[Math.min(i + 1, rawSamples.length - 1)];
    const tangent = new THREE.Vector3(next.x - prev.x, next.y - prev.y, next.z - prev.z);
    if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, -1);
    tangent.normalize();
    const right = new THREE.Vector3().crossVectors(tangent, up);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    right.applyAxisAngle(tangent, (p.banking * Math.PI) / 180);
    return { x: p.x, y: p.y, z: p.z, tangent, right, width: p.width, grip: p.grip, arcLength: p.arcLength };
  });

  return { samples, totalLength, closedLoop };
}

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

// Searches only a small window around hintIndex rather than the whole track -
// callers should keep the returned index and pass it back in next frame,
// since a player moves mostly forward along the track from frame to frame.
export function findNearestSampleIndex(
  track: BuiltTrack,
  x: number,
  z: number,
  hintIndex: number,
  searchWindow = 15
): number {
  const { samples, closedLoop } = track;
  const n = samples.length;
  let best = hintIndex;
  let bestDistSq = Infinity;
  for (let offset = -searchWindow; offset <= searchWindow; offset++) {
    const i = closedLoop ? wrapIndex(hintIndex + offset, n) : Math.min(Math.max(hintIndex + offset, 0), n - 1);
    const s = samples[i];
    const dx = s.x - x;
    const dz = s.z - z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = i;
    }
  }
  return best;
}

// Signed distance from the centerline along the track's right vector at this
// sample - positive is to the right of the direction of travel. Approximates
// using only right's x/z components, so heavily banked sections slightly
// underestimate true lateral distance (right also points partly vertical).
export function lateralOffset(track: BuiltTrack, index: number, x: number, z: number): number {
  const s = track.samples[index];
  const dx = x - s.x;
  const dz = z - s.z;
  return dx * s.right.x + dz * s.right.z;
}

export function isOffTrack(track: BuiltTrack, index: number, x: number, z: number, margin = 0): boolean {
  const s = track.samples[index];
  return Math.abs(lateralOffset(track, index, x, z)) > s.width / 2 + margin;
}

// Height at the actual (x, z), not just the centerline - on a banked section
// the surface tilts across its width, so a point offset from center sits
// higher or lower than the sample's own y by however far right's own slight
// vertical component (from the bank tilt) carries over that offset.
export function sampleGroundHeight(track: BuiltTrack, index: number, x: number, z: number): number {
  const s = track.samples[index];
  const offset = lateralOffset(track, index, x, z);
  return s.y + offset * s.right.y;
}

// World-space normal of the road surface at this sample (perpendicular to
// both the direction of travel and the banked cross-section) - used to
// orient anything that should sit flush on a sloped/banked surface.
export function surfaceNormal(track: BuiltTrack, index: number): THREE.Vector3 {
  const s = track.samples[index];
  return new THREE.Vector3().crossVectors(s.right, s.tangent).normalize();
}

export function sampleGrip(track: BuiltTrack, index: number): number {
  return track.samples[index].grip;
}

// Extrudes the road surface as a triangle-strip ribbon: two vertices per
// sample (left/right edge, offset by width/2 along right), stitched to the
// next sample's pair. Shared by world.ts rendering and the editor's 3D
// preview so what's authored is exactly what's driven on.
export function buildRoadGeometry(track: BuiltTrack): THREE.BufferGeometry {
  const { samples, closedLoop } = track;
  const n = samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const edge = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const halfWidth = s.width / 2;

    edge.set(s.x, s.y, s.z).addScaledVector(s.right, -halfWidth);
    positions.set([edge.x, edge.y, edge.z], i * 6);
    edge.set(s.x, s.y, s.z).addScaledVector(s.right, halfWidth);
    positions.set([edge.x, edge.y, edge.z], i * 6 + 3);

    uvs.set([0, s.arcLength, 1, s.arcLength], i * 4);
  }

  const segmentCount = closedLoop ? n : n - 1;
  const indices: number[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const a = i * 2;
    const b = (((i + 1) % n) * 2) % (n * 2);
    indices.push(a, a + 1, b);
    indices.push(a + 1, b + 1, b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Visual-only guide wall standing up from one edge of the track, perpendicular
// to the (possibly banked) surface. Purely a spatial reference for where the
// track ends - off-track driving is a grip/throttle penalty (see player.ts),
// not a collision, so this never blocks movement.
export function buildBarrierGeometry(track: BuiltTrack, side: -1 | 1, height: number): THREE.BufferGeometry {
  const { samples, closedLoop } = track;
  const n = samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const bottom = new THREE.Vector3();
  const top = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    normal.crossVectors(s.right, s.tangent).normalize();
    bottom.set(s.x, s.y, s.z).addScaledVector(s.right, side * (s.width / 2));
    top.copy(bottom).addScaledVector(normal, height);
    positions.set([bottom.x, bottom.y, bottom.z], i * 6);
    positions.set([top.x, top.y, top.z], i * 6 + 3);
  }

  const segmentCount = closedLoop ? n : n - 1;
  const indices: number[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const a = i * 2;
    const b = (((i + 1) % n) * 2) % (n * 2);
    indices.push(a, a + 1, b);
    indices.push(a + 1, b + 1, b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
