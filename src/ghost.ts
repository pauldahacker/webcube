import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PLAYER_SIZE } from './constants';
import type { PlayerState } from './player';

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
  sync(lapStep: number, alpha: number): void;
};

export function createGhost(scene: THREE.Scene): Ghost {
  // Same silhouette as the player cube, but a see-through apparition: no
  // core, no bubbles, no edge lines, no shadow, no trail.
  const geometry = new RoundedBoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE, 2, PLAYER_SIZE * 0.15);
  const material = new THREE.MeshStandardMaterial({
    color: 0xe8d9ff, // pale violet, clearly not the player's ice blue
    transparent: true,
    opacity: 0.3,
    depthWrite: false, // never occludes the world or the player
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  scene.add(mesh);

  let recording: GhostRecording | null = null;

  return {
    show(rec: GhostRecording) {
      recording = rec;
      mesh.visible = rec.frames.length > 0;
    },
    hide() {
      recording = null;
      mesh.visible = false;
    },
    sync(lapStep: number, alpha: number) {
      if (!recording || !mesh.visible) return;
      const frames = recording.frames;
      // Past the end of the recording the ghost waits at its finish position.
      const i = Math.min(lapStep, frames.length - 1);
      const j = Math.min(i + 1, frames.length - 1);
      const a = frames[i];
      const b = frames[j];
      const t = i === j ? 0 : Math.min(Math.max(alpha, 0), 1);
      mesh.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      mesh.rotation.y = a.heading + (b.heading - a.heading) * t;
    },
  };
}
