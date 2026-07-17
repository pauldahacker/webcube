import './style.css';
import * as THREE from 'three';
import { createPlayer, updatePlayer, updateCamera, resetPlayer } from './player';
import { moveInput } from './input';
import { createWorld } from './world';
import { createMapSystem, loadMap } from './map';
import { createUI } from './ui';

async function init() {
  const mapData = await loadMap('/maps/map2.json');

  const scene = new THREE.Scene();
  createWorld(scene, mapData.layout);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  const mapSystem = createMapSystem(mapData);

  const player = createPlayer(camera, mapData.start);
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

  const ui = createUI(() => {
    resetPlayer(player, mapData.start, camera);
    raceState = 'idle';
    elapsedMs = 0;
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
    const delta = timer.getDelta();

    if (!paused) {
      if (raceState !== 'finished') {
        updatePlayer(player, mapSystem, moveInput, delta);
      }

      ui.setSpeed((player.userData.velocity as THREE.Vector3).length());

      if (raceState === 'idle' && (moveInput.forward !== 0 || moveInput.turn !== 0)) {
        raceState = 'running';
      }

      if (raceState === 'running') {
        elapsedMs += delta * 1000;
        ui.setTime(elapsedMs);

        if (mapSystem.isFinish(player.position.x, player.position.z)) {
          raceState = 'finished';
          const isNewBest = bestMs === null || elapsedMs < bestMs;
          if (isNewBest) {
            bestMs = elapsedMs;
            ui.setBestTime(bestMs);
          }
          ui.showResult(elapsedMs, isNewBest);
        }
      }
    }

    updateCamera(camera, player, delta);
    renderer.render(scene, camera);
  }

  requestAnimationFrame(() => {
    updateSize();
    animate();
  });
}

init();
