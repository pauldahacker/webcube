import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PLAYER_SIZE, PHYSICS_TIMESTEP, BODY_TILT_SMOOTHING } from './constants';
import { orientBodyToSurface } from './player';
import type { PlayerState } from './player';
import { surfaceNormal, findNearestSampleIndex } from './track';
import { createCubeEffects } from './effects';
import type { Mover } from './effects';
import type { MapSystem } from './map';

// Ghost of the best lap. One frame is captured per physics step, so a
// recording is exactly as deterministic as the sim itself: replaying frame
// [lapStep] always shows where the best run was at the same point on the
// clock, on any machine and at any render rate (the same interpolation
// alpha the player rendering uses smooths between steps).
//
// Recordings are session-only for now - nothing is persisted or uploaded.
// A lap at 120 steps/second is ~4 numbers per step, so even minutes-long
// laps stay tiny in memory.

export type GhostFrame = { x: number; y: number; z: number; heading: number };
export type GhostRecording = { frames: GhostFrame[] };

export type GhostRecorder = {
  reset(): void;
  capture(state: PlayerState): void;
  takeRecording(): GhostRecording;
};

export function createGhostRecorder(): GhostRecorder {
  let frames: GhostFrame[] = [];
  return {
    reset() {
      frames = [];
    },
    capture(state: PlayerState) {
      frames.push({ x: state.x, y: state.y, z: state.z, heading: state.heading });
    },
    takeRecording(): GhostRecording {
      return { frames: frames.slice() };
    },
  };
}

export type Ghost = {
  // Start replaying this recording (called at the start of each lap).
  show(recording: GhostRecording): void;
  hide(): void;
  // Move the ghost to the current lap position; alpha is the render
  // interpolation factor between physics steps, same as the player's.
  sync(mapSystem: MapSystem, lapStep: number, alpha: number, delta: number): void;
};

export function createGhost(scene: THREE.Scene): Ghost {
  // Same rounded silhouette as the player, but a clean translucent yellow
  // apparition - no frost/core/bubbles, which only muddy a see-through object.
  // A wrapper carries the yaw; the body child tilts onto the surface, exactly
  // like the player, so the ghost banks and climbs accurately.
  const wrapper = new THREE.Object3D();
  const geometry = new RoundedBoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE, 2, PLAYER_SIZE * 0.15);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffd64a, // warm yellow, clearly not the player's ice blue
    transparent: true,
    opacity: 0.45,
    depthWrite: false, // never occludes the world or the player
    flatShading: true,
  });
  const body = new THREE.Mesh(geometry, material);
  wrapper.add(body);
  wrapper.visible = false;
  scene.add(wrapper);

  // Yellow melt trail, no shadow (a solid shadow under a translucent ghost
  // reads oddly). Its velocity is synthesized from the recorded frames.
  const trail = createCubeEffects(scene, {
    shadow: false,
    trailColor: new THREE.Color(0xffe27a),
    trailOpacity: 0.05, // fainter than the player's trail
    trailLife: 0.6, // and shorter (points fade sooner)
  });
  const ghostNormal = new THREE.Vector3();
  const mover: Mover = { vx: 0, vz: 0, isSliding: false };
  let ghostHint = 0;
  let recording: GhostRecording | null = null;

  return {
    show(rec: GhostRecording) {
      recording = rec;
      wrapper.visible = rec.frames.length > 0;
      ghostHint = 0;
      trail.reset();
    },
    hide() {
      recording = null;
      wrapper.visible = false;
      trail.reset();
    },
    sync(mapSystem: MapSystem, lapStep: number, alpha: number, delta: number) {
      if (!recording || !wrapper.visible) return;
      const frames = recording.frames;
      // Past the end of the recording the ghost waits at its finish position.
      const i = Math.min(lapStep, frames.length - 1);
      const j = Math.min(i + 1, frames.length - 1);
      const a = frames[i];
      const b = frames[j];
      const t = i === j ? 0 : Math.min(Math.max(alpha, 0), 1);
      wrapper.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      wrapper.rotation.set(0, a.heading + (b.heading - a.heading) * t, 0);

      // Tilt onto the surface, using a local hint so it never disturbs the
      // physics query.
      const track = mapSystem.builtTrack;
      ghostHint = findNearestSampleIndex(track, wrapper.position.x, wrapper.position.z, ghostHint);
      ghostNormal.copy(surfaceNormal(track, ghostHint, wrapper.position.x, wrapper.position.z));
      orientBodyToSurface(body, wrapper.rotation.y, ghostNormal, 1 - Math.exp(-BODY_TILT_SMOOTHING * delta));

      // Trail: velocity from the two frames being interpolated (zero at the
      // end, where i === j, so the trail stops).
      mover.vx = (b.x - a.x) / PHYSICS_TIMESTEP;
      mover.vz = (b.z - a.z) / PHYSICS_TIMESTEP;
      trail.update(wrapper, mover, mapSystem, delta);
    },
  };
}
