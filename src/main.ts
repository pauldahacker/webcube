import './style.css';
import * as THREE from 'three';
import {
  createPlayerObject,
  createPlayerState,
  stepPlayer,
  syncPlayerObject,
  updateCamera,
  resetPlayer,
} from './player';
import { moveInput } from './input';
import { createWorld } from './world';
import { createCubeEffects } from './effects';
import { createGhost, createGhostRecorder } from './ghost';
import type { GhostRecording } from './ghost';
import { createMapSystem, loadMap } from './map';
import { createUI } from './ui';
import { PHYSICS_TIMESTEP, MAX_FRAME_DELTA } from './constants';

async function init() {
  const mapData = await loadMap('/maps/firstreal.json');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2A0B4D);
  // Fog matches the background so the terrain's square edge fades into the
  // sky instead of ending in a visible hard line.
  scene.fog = new THREE.Fog(0x2A0B4D, 100, 400);
  const mapSystem = createMapSystem(mapData);
  createWorld(scene, mapSystem.builtTrack);
  const effects = createCubeEffects(scene);
  const ghost = createGhost(scene);
  const ghostRecorder = createGhostRecorder();
  // Best-lap recording, session-only for now (like bestMs itself).
  let bestRecording: GhostRecording | null = null;
  // Physics steps since the current lap started - the ghost's playback head.
  let lapStep = 0;
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

  const player = createPlayerObject();
  const playerState = createPlayerState(mapData.start);
  resetPlayer(player, playerState, mapData.start, camera);
  scene.add(player);
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer();
  document.body.appendChild(renderer.domElement);

  function updateSize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', updateSize);

  const timer = new THREE.Timer();
  timer.connect(document);

  type RaceState = 'idle' | 'running';
  let raceState: RaceState = 'idle';
  let elapsedMs = 0;
  let paused = false;
  let bestMs: number | null = null;
  // Fixed-timestep accumulator: render deltas pour in, physics drains in
  // whole PHYSICS_TIMESTEP steps, and the remainder becomes the render
  // interpolation factor - so the sim is identical at any refresh rate.
  let accumulator = 0;

  const ui = createUI(() => {
    resetPlayer(player, playerState, mapData.start, camera);
    mapSystem.reset();
    effects.reset();
    // Best recording survives reset (like bestMs); the ghost just hides
    // until the next lap actually starts.
    ghostRecorder.reset();
    ghost.hide();
    lapStep = 0;
    raceState = 'idle';
    elapsedMs = 0;
    accumulator = 0;
    paused = false;
    ui.setTime(0);
    ui.hideResult();
    ui.hidePause();
  });

  function togglePause() {
    paused = !paused;
    if (paused) {
      ui.showPause();
    } else {
      ui.hidePause();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      togglePause();
    }
  });

  function animate(timestamp?: number) {
    requestAnimationFrame(animate);

    timer.update(timestamp);
    const delta = Math.min(timer.getDelta(), MAX_FRAME_DELTA);

    if (!paused) {
      if (raceState === 'idle' && (moveInput.forward !== 0 || moveInput.turn !== 0)) {
        raceState = 'running';
        lapStep = 0;
        ghostRecorder.reset();
        if (bestRecording) ghost.show(bestRecording);
      }

      accumulator += delta;
      while (accumulator >= PHYSICS_TIMESTEP) {
        accumulator -= PHYSICS_TIMESTEP;
        stepPlayer(playerState, mapSystem, moveInput, PHYSICS_TIMESTEP);

        if (raceState === 'running') {
          // Timer advances with physics steps, not render frames, so a
          // recorded time means the same thing on every machine.
          elapsedMs += PHYSICS_TIMESTEP * 1000;
          // One ghost frame per physics step, including the finishing one -
          // playback indexed by lapStep stays locked to the lap clock.
          ghostRecorder.capture(playerState);
          lapStep++;
          if (playerState.lastTrackQuery && mapSystem.isFinish(playerState.lastTrackQuery)) {
            const lapMs = elapsedMs;
            const isNewBest = bestMs === null || lapMs < bestMs;
            if (isNewBest) {
              bestMs = lapMs;
              ui.setBestTime(bestMs);
              bestRecording = ghostRecorder.takeRecording();
            }
            elapsedMs = 0;
            // Next lap starts immediately: restart recording and replay the
            // (possibly just-updated) best run from its first frame.
            lapStep = 0;
            ghostRecorder.reset();
            if (bestRecording) ghost.show(bestRecording);
            ui.hideResult();
          }
        }
      }

      if (raceState !== 'idle') {
        ui.setTime(elapsedMs);
      }
      ui.setSpeed(Math.hypot(playerState.vx, playerState.vz));
    }

    const alpha = accumulator / PHYSICS_TIMESTEP;
    syncPlayerObject(player, playerState, mapSystem, alpha, delta);
    // Pause freezes puddle aging/dropping (delta 0) but keeps the shadow glued.
    effects.update(player, playerState, mapSystem, paused ? 0 : delta);
    ghost.sync(lapStep, alpha);
    updateCamera(camera, player, delta);
    renderer.render(scene, camera);
  }

  requestAnimationFrame(() => {
    updateSize();
    animate();
  });
}

init();
