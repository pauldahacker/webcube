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
  // True where this sample's edge lies ON the road surface (e.g. the inside
  // of a hairpin, where the road overlaps itself) - no wall is drawn there
  // and the physics lets the cube drive through. Walls only exist on real
  // outer boundaries.
  leftWallOpen: boolean;
  rightWallOpen: boolean;
};

export type BuiltTrack = {
  samples: TrackSample[];
  totalLength: number;
  closedLoop: boolean;
};

// World units between resampled points - the resolution physics/rendering see.
const SAMPLE_SPACING = 0.5;
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
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      tangent,
      right,
      width: p.width,
      grip: p.grip,
      arcLength: p.arcLength,
      leftWallOpen: false,
      rightWallOpen: false,
    };
  });

  markEdgesOnRoad(samples);

  return { samples, totalLength, closedLoop };
}

// Marks every edge point that lies ON the road surface - inside some other
// cross-section of the track, as happens on the inside of a hairpin or
// wherever the road overlaps itself. Walls are skipped there (visually and
// physically): a wall should only ever stand on a real outer boundary.
// One-time O(n²) scan at load, with a cheap distance prefilter.
function markEdgesOnRoad(samples: TrackSample[]) {
  const n = samples.length;
  // Grazing tolerance: a point exactly ON an edge (its own cross-section,
  // or a parallel neighbor's) does not count as covered.
  const MARGIN = 0.1;
  let maxHalfWidth = 0;
  for (const s of samples) maxHalfWidth = Math.max(maxHalfWidth, s.width / 2);
  const reachSq = (maxHalfWidth + SAMPLE_SPACING) ** 2;

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    for (const side of [-1, 1] as const) {
      const px = s.x + side * s.right.x * (s.width / 2);
      const pz = s.z + side * s.right.z * (s.width / 2);
      let covered = false;
      for (let j = 0; j < n && !covered; j++) {
        const o = samples[j];
        const dx = px - o.x;
        const dz = pz - o.z;
        if (dx * dx + dz * dz > reachSq) continue;
        // Ignore sections at a very different height (a bridge crossing
        // over a road below must keep its walls).
        if (Math.abs(o.y - s.y) > 2.5) continue;
        // Strictly inside o's cross-section, and longitudinally beside it?
        // Positions are compared in the xz plane, where banked right vectors
        // and sloped tangents project shorter than unit length - so recover
        // the true cross-section coordinate by dividing by the projected
        // length squared (otherwise banked edges falsely cover themselves).
        const rightXZSq = o.right.x * o.right.x + o.right.z * o.right.z;
        const tangentXZSq = o.tangent.x * o.tangent.x + o.tangent.z * o.tangent.z;
        if (rightXZSq < 1e-6 || tangentXZSq < 1e-6) continue;
        const lat = (dx * o.right.x + dz * o.right.z) / rightXZSq;
        if (Math.abs(lat) >= o.width / 2 - MARGIN) continue;
        const along = (dx * o.tangent.x + dz * o.tangent.z) / tangentXZSq;
        if (Math.abs(along) > SAMPLE_SPACING * 0.75) continue;
        covered = true;
      }
      if (side < 0) s.leftWallOpen = covered;
      else s.rightWallOpen = covered;
    }
  }
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

// Height of one cross-section's surface plane at (x, z) - on a banked
// section the surface tilts across its width, so a point offset from center
// sits higher or lower than the sample's own y.
function crossSectionHeight(s: TrackSample, x: number, z: number): number {
  const lat = (x - s.x) * s.right.x + (z - s.z) * s.right.z;
  return s.y + lat * s.right.y;
}

// Which neighboring cross-section (x, z) is heading toward, and how far
// along toward it (0..1) - measured in the tangent's own xz-parameter space
// (sloped tangents project shorter than unit length). Shared by the blended
// height and normal lookups so they can never disagree.
function neighborBlend(
  track: BuiltTrack,
  index: number,
  x: number,
  z: number
): { neighborIndex: number; t: number } {
  const { samples, closedLoop } = track;
  const n = samples.length;
  const s = samples[index];
  const tangentXZSq = s.tangent.x * s.tangent.x + s.tangent.z * s.tangent.z;
  if (tangentXZSq < 1e-6) return { neighborIndex: index, t: 0 };
  const along = ((x - s.x) * s.tangent.x + (z - s.z) * s.tangent.z) / tangentXZSq;
  const neighborIndex =
    along >= 0
      ? closedLoop
        ? wrapIndex(index + 1, n)
        : Math.min(index + 1, n - 1)
      : closedLoop
        ? wrapIndex(index - 1, n)
        : Math.max(index - 1, 0);
  const t = Math.min(Math.abs(along) / SAMPLE_SPACING, 1);
  return { neighborIndex, t };
}

// Height of the road under (x, z). Blends between the two nearest
// cross-sections along the direction of travel - using only the single
// nearest one made the surface a staircase (one flat step per sample),
// which showed up as vertical jitter driving over crests and dips.
export function sampleGroundHeight(track: BuiltTrack, index: number, x: number, z: number): number {
  const here = crossSectionHeight(track.samples[index], x, z);
  const { neighborIndex, t } = neighborBlend(track, index, x, z);
  if (neighborIndex === index || t === 0) return here;
  const there = crossSectionHeight(track.samples[neighborIndex], x, z);
  return here + (there - here) * t;
}

// World-space normal of the road surface at (x, z) (perpendicular to both
// the direction of travel and the banked cross-section), blended between the
// two nearest cross-sections exactly like the height - a single sample's
// normal made the cube's tilt and the ground decals snap at every sample
// wherever banking or slope changes. Used to orient anything that should
// sit flush on the surface.
export function surfaceNormal(track: BuiltTrack, index: number, x: number, z: number): THREE.Vector3 {
  const s = track.samples[index];
  const here = new THREE.Vector3().crossVectors(s.right, s.tangent).normalize();
  const { neighborIndex, t } = neighborBlend(track, index, x, z);
  if (neighborIndex === index || t === 0) return here;
  const o = track.samples[neighborIndex];
  const there = new THREE.Vector3().crossVectors(o.right, o.tangent).normalize();
  return here.lerp(there, t).normalize();
}

export function sampleGrip(track: BuiltTrack, index: number): number {
  return track.samples[index].grip;
}

// The edge polyline the road ribbon and barriers are built from, one side at
// a time. A plain per-sample offset (center + right * width/2) folds back on
// itself on the inside of any turn tighter than the half-width - the offset
// points travel BACKWARD along the track there, which renders as a zig-zag
// staircase on the road edge and on the wall standing on it. After
// offsetting, folded points are relaxed to the midpoint of their neighbors
// until the whole edge advances forward along the track again (the inside
// edge of a hairpin naturally pinches instead of folding).
function computeEdgeLine(track: BuiltTrack, side: -1 | 1): THREE.Vector3[] {
  const { samples, closedLoop } = track;
  const n = samples.length;
  const edges: THREE.Vector3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    edges[i] = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(s.right, side * (s.width / 2));
  }

  const MAX_PASSES = 24;
  const seg = new THREE.Vector3();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let foundFold = false;
    for (let i = 0; i < n; i++) {
      if (!closedLoop && (i === 0 || i === n - 1)) continue;
      const prev = edges[wrapIndex(i - 1, n)];
      const next = edges[wrapIndex(i + 1, n)];
      // Folded when the edge line does not advance along the direction of
      // travel through this point.
      seg.subVectors(next, prev);
      if (seg.dot(samples[i].tangent) <= 1e-6) {
        edges[i].copy(prev).add(next).multiplyScalar(0.5);
        foundFold = true;
      }
    }
    if (!foundFold) break;
  }
  return edges;
}

// Extrudes the road surface as a triangle-strip ribbon: two vertices per
// sample (left/right edge, offset by width/2 along right, fold-repaired by
// computeEdgeLine), stitched to the next sample's pair. Shared by world.ts
// rendering and the editor's 3D preview so what's authored is exactly what's
// driven on.
export function buildRoadGeometry(track: BuiltTrack): THREE.BufferGeometry {
  const { samples, closedLoop } = track;
  const n = samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const leftEdge = computeEdgeLine(track, -1);
  const rightEdge = computeEdgeLine(track, 1);

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    positions.set([leftEdge[i].x, leftEdge[i].y, leftEdge[i].z], i * 6);
    positions.set([rightEdge[i].x, rightEdge[i].y, rightEdge[i].z], i * 6 + 3);
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
  const top = new THREE.Vector3();
  const normal = new THREE.Vector3();
  // Same fold-repaired edge the road ribbon uses, so the wall stands exactly
  // on the rendered road edge - never on the raw (possibly folded) offsets.
  const edge = computeEdgeLine(track, side);

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    normal.crossVectors(s.right, s.tangent).normalize();
    const bottom = edge[i];
    top.copy(bottom).addScaledVector(normal, height);
    positions.set([bottom.x, bottom.y, bottom.z], i * 6);
    positions.set([top.x, top.y, top.z], i * 6 + 3);
  }

  // Skip any wall segment with an endpoint sitting on the road surface
  // (see markEdgesOnRoad) - walls only stand on real outer boundaries.
  const isOpen = (s: TrackSample) => (side < 0 ? s.leftWallOpen : s.rightWallOpen);
  const segmentCount = closedLoop ? n : n - 1;
  const indices: number[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const next = (i + 1) % n;
    if (isOpen(samples[i]) || isOpen(samples[next])) continue;
    const a = i * 2;
    const b = next * 2;
    indices.push(a, a + 1, b);
    indices.push(a + 1, b + 1, b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
