import './style.css';
import * as THREE from 'three';
import {
  createPlayerObject,
  createPlayerState,
  stepPlayer,
  syncPlayerObject,
  snapPlayerPrev,
  updateCamera,
  resetPlayer,
} from './player';
import { moveInput } from './input';
import { createWorld } from './world';
import { createMapSystem, loadMap } from './map';
import { createUI } from './ui';
import { PHYSICS_TIMESTEP, MAX_FRAME_DELTA } from './constants';

async function init() {
  const mapData = await loadMap('/maps/firstone.json');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xff9c3f);
  const mapSystem = createMapSystem(mapData);
  createWorld(scene, mapSystem.builtTrack);
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

  type RaceState = 'idle' | 'running' | 'finished';
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
    raceState = 'idle';
    elapsedMs = 0;
    accumulator = 0;
    paused = false;
    ui.setTime(0);
    ui.hideResult();
    ui.hidePause();
  });

  function togglePause() {
    if (raceState === 'finished') return;
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
      }

      if (raceState !== 'finished') {
        accumulator += delta;
        while (accumulator >= PHYSICS_TIMESTEP) {
          accumulator -= PHYSICS_TIMESTEP;
          stepPlayer(playerState, mapSystem, moveInput, PHYSICS_TIMESTEP);

          if (raceState === 'running') {
            // Timer advances with physics steps, not render frames, so a
            // recorded time means the same thing on every machine.
            elapsedMs += PHYSICS_TIMESTEP * 1000;
            if (playerState.lastTrackQuery && mapSystem.isFinish(playerState.lastTrackQuery)) {
              raceState = 'finished';
              // Freeze exactly on the finishing step - no partial-step lerp.
              snapPlayerPrev(playerState);
              accumulator = 0;
              const isNewBest = bestMs === null || elapsedMs < bestMs;
              if (isNewBest) {
                bestMs = elapsedMs;
                ui.setBestTime(bestMs);
              }
              ui.showResult(elapsedMs, isNewBest);
              break;
            }
          }
        }
      }

      if (raceState !== 'idle') {
        ui.setTime(elapsedMs);
      }
      ui.setSpeed(Math.hypot(playerState.vx, playerState.vz));
    }

    const alpha = raceState === 'finished' ? 1 : accumulator / PHYSICS_TIMESTEP;
    syncPlayerObject(player, playerState, mapSystem, alpha, delta);
    updateCamera(camera, player, delta);
    renderer.render(scene, camera);
  }

  requestAnimationFrame(() => {
    updateSize();
    animate();
  });
}

init();
