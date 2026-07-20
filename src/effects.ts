import * as THREE from 'three';
import { surfaceNormal } from './track';
import type { MapSystem } from './map';
import type { PlayerState } from './player';
import { PLAYER_SIZE } from './constants';
import { TERRAIN_STYLE } from './terrain';

// Stylized ground effects for the ice cube - flat decals floating just above
// the road, no shadow mapping, no particles. Purely visual; physics never
// sees any of this.
//
// Shadow: a soft ellipse CAST along the same sun direction the terrain
// texture is baked with (TERRAIN_STYLE.sunDirection), offset and stretched
// away from the light like the hills' own shading - not a ring sitting
// under the cube.
//
// Trail: a continuous ribbon as wide as the cube, following the cube's real
// driven path (so it sweeps sideways in a drift), fading gently to nothing
// toward the tail. Each ribbon point carries the style of the moment it was
// dropped: an icy melt streak while sliding (state.isSliding), a barely-there
// damp sheen the rest of the time - so one ribbon can carry both looks with
// a smooth handover mid-corner. Per-vertex alpha + color needs a small
// shader; standard materials only fade/tint whole objects.

const SHADOW_RADIUS = PLAYER_SIZE * 0.62;
const SHADOW_STRETCH = 1.5; // elongated away from the sun, like a cast shadow
const SHADOW_OPACITY = 0.28;
const SURFACE_LIFT = 0.04; // keeps decals from z-fighting the road

const TRAIL_WIDTH = PLAYER_SIZE;
const TRAIL_POINT_SPACING = 0.5; // world units of travel between ribbon points
const TRAIL_MAX_POINTS = 96;
const MIN_TRAIL_SPEED = 2; // no trail when dawdling

// The icy melt streak, only while a slide is in progress.
const DRIFT_TRAIL = { color: new THREE.Color(0x3E84BD), opacity: 0.25, life: 1.6 };
// Damp ground behind normal driving: a faint gray sheen that lingers a
// little longer than the drift streak, like humidity slowly evaporating.
const HUMID_TRAIL = { color: new THREE.Color(0x9BACC4), opacity: 0.12, life: 2.2 };

const TRAIL_VERTEX_SHADER = `
  attribute float alpha;
  attribute vec3 tint;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAGMENT_SHADER = `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    gl_FragColor = vec4(vTint, vAlpha);
  }
`;

export type CubeEffects = {
  update(player: THREE.Object3D, state: PlayerState, mapSystem: MapSystem, delta: number): void;
  reset(): void;
};

type TrailPoint = {
  x: number;
  y: number;
  z: number;
  // Half-width offset direction at this point (in the surface plane,
  // perpendicular to travel) - the ribbon's two edges are p +/- r*halfWidth.
  rx: number;
  ry: number;
  rz: number;
  age: number;
  // Style captured when the point was dropped (drift streak or damp sheen).
  r: number;
  g: number;
  b: number;
  opacity: number;
  life: number;
};

export function createCubeEffects(scene: THREE.Scene): CubeEffects {
  // CircleGeometry faces +Z; decals are rotated from +Z onto the road normal.
  const faceZ = new THREE.Vector3(0, 0, 1);
  const normal = new THREE.Vector3();

  // --- Shadow -------------------------------------------------------------
  // Where the cube's center lands when projected along the sunlight: the
  // same sun the terrain texture bake uses, so bright/dark sides agree.
  const sun = new THREE.Vector3(
    TERRAIN_STYLE.sunDirection[0],
    TERRAIN_STYLE.sunDirection[1],
    TERRAIN_STYLE.sunDirection[2]
  ).normalize();
  const shadowOffsetX = -(sun.x / sun.y) * (PLAYER_SIZE / 2);
  const shadowOffsetZ = -(sun.z / sun.y) * (PLAYER_SIZE / 2);
  // Rotation (in the decal plane) pointing the ellipse's long axis along the
  // cast direction. After the faceZ->normal alignment, local (cos t, sin t)
  // lands at world (cos t, 0, -sin t), hence the sign on z.
  const castLen = Math.hypot(shadowOffsetX, shadowOffsetZ);
  const castAngle = castLen > 1e-6 ? Math.atan2(-shadowOffsetZ / castLen, shadowOffsetX / castLen) : 0;
  const stretchRotation = new THREE.Quaternion().setFromAxisAngle(faceZ, castAngle);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(SHADOW_RADIUS, 20),
    new THREE.MeshBasicMaterial({
      color: 0x1a0833, // deep sky-purple, not black, to sit in the palette
      transparent: true,
      opacity: SHADOW_OPACITY,
      depthWrite: false,
    })
  );
  shadow.scale.set(SHADOW_STRETCH, 1, 1);
  scene.add(shadow);

  // --- Trail --------------------------------------------------------------
  const points: TrailPoint[] = [];
  const trailPositions = new Float32Array(TRAIL_MAX_POINTS * 2 * 3);
  const trailAlphas = new Float32Array(TRAIL_MAX_POINTS * 2);
  const trailTints = new Float32Array(TRAIL_MAX_POINTS * 2 * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute('alpha', new THREE.BufferAttribute(trailAlphas, 1));
  trailGeometry.setAttribute('tint', new THREE.BufferAttribute(trailTints, 3));
  const trailIndices: number[] = [];
  for (let i = 0; i < TRAIL_MAX_POINTS - 1; i++) {
    const a = i * 2;
    trailIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  trailGeometry.setIndex(trailIndices);
  trailGeometry.setDrawRange(0, 0);

  const trailMaterial = new THREE.ShaderMaterial({
    vertexShader: TRAIL_VERTEX_SHADER,
    fragmentShader: TRAIL_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const trail = new THREE.Mesh(trailGeometry, trailMaterial);
  // Geometry rewrites every frame; a stale bounding sphere would cull it.
  trail.frustumCulled = false;
  scene.add(trail);

  let distanceSinceDrop = 0;
  const travelDir = new THREE.Vector3();
  const rightVec = new THREE.Vector3();

  function rebuildTrail() {
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const half = TRAIL_WIDTH / 2;
      trailPositions[i * 6] = p.x - p.rx * half;
      trailPositions[i * 6 + 1] = p.y - p.ry * half;
      trailPositions[i * 6 + 2] = p.z - p.rz * half;
      trailPositions[i * 6 + 3] = p.x + p.rx * half;
      trailPositions[i * 6 + 4] = p.y + p.ry * half;
      trailPositions[i * 6 + 5] = p.z + p.rz * half;
      // Lives differ per style, so an interior point can dry up before the
      // tail does - clamp instead of going negative.
      const a = Math.max(0, p.opacity * (1 - p.age / p.life));
      trailAlphas[i * 2] = a;
      trailAlphas[i * 2 + 1] = a;
      trailTints[i * 6] = p.r;
      trailTints[i * 6 + 1] = p.g;
      trailTints[i * 6 + 2] = p.b;
      trailTints[i * 6 + 3] = p.r;
      trailTints[i * 6 + 4] = p.g;
      trailTints[i * 6 + 5] = p.b;
    }
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.alpha.needsUpdate = true;
    trailGeometry.attributes.tint.needsUpdate = true;
    trailGeometry.setDrawRange(0, points.length >= 2 ? (points.length - 1) * 6 : 0);
  }

  function update(player: THREE.Object3D, state: PlayerState, mapSystem: MapSystem, delta: number) {
    const track = mapSystem.builtTrack;

    // Shadow: cast onto the road away from the sun, tilted with the surface.
    const sx = player.position.x + shadowOffsetX;
    const sz = player.position.z + shadowOffsetZ;
    const sq = mapSystem.query(sx, sz);
    normal.copy(surfaceNormal(track, sq.index, sx, sz));
    shadow.position.set(sx, sq.groundHeight + SURFACE_LIFT, sz);
    shadow.quaternion.setFromUnitVectors(faceZ, normal).multiply(stretchRotation);

    // Trail points dry up; expired ones fall off the tail.
    for (const p of points) p.age += delta;
    while (points.length > 0 && points[0].age >= points[0].life) points.shift();

    // Extend the ribbon while moving.
    const speed = Math.hypot(state.vx, state.vz);
    if (speed >= MIN_TRAIL_SPEED) {
      distanceSinceDrop += speed * delta;
      if (distanceSinceDrop >= TRAIL_POINT_SPACING) {
        distanceSinceDrop = 0;
        const px = player.position.x;
        const pz = player.position.z;
        const last = points[points.length - 1];
        if (last) {
          travelDir.set(px - last.x, 0, pz - last.z);
        } else {
          travelDir.set(state.vx, 0, state.vz);
        }
        if (travelDir.lengthSq() < 1e-8) travelDir.set(0, 0, -1);
        travelDir.normalize();

        const pq = mapSystem.query(px, pz);
        normal.copy(surfaceNormal(track, pq.index, px, pz));
        // Perpendicular to travel, lying in the road surface - so the ribbon
        // lies flush across banking.
        rightVec.crossVectors(normal, travelDir).normalize();

        if (points.length >= TRAIL_MAX_POINTS) points.shift();
        const style = state.isSliding ? DRIFT_TRAIL : HUMID_TRAIL;
        points.push({
          x: px,
          // Below the shadow's lift so the shadow always draws over the trail.
          y: pq.groundHeight + SURFACE_LIFT / 2,
          z: pz,
          rx: rightVec.x,
          ry: rightVec.y,
          rz: rightVec.z,
          age: 0,
          r: style.color.r,
          g: style.color.g,
          b: style.color.b,
          opacity: style.opacity,
          life: style.life,
        });
      }
    }

    rebuildTrail();
  }

  function reset() {
    points.length = 0;
    distanceSinceDrop = 0;
    trailGeometry.setDrawRange(0, 0);
  }

  return { update, reset };
}
