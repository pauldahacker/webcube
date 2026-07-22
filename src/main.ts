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
import { createAurora } from './aurora';
import { createCubeEffects } from './effects';
import { createGhost, createGhostRecorder } from './ghost';
import type { GhostRecording } from './ghost';
import { createMapSystem, loadMap } from './map';
import { loadRecord, saveRecord } from './records';
import { createUI } from './ui';
import { createMusicPlayer } from './music';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PHYSICS_TIMESTEP, MAX_FRAME_DELTA, PLAYER_SIZE } from './constants';

const MAP_URL = '/maps/track2.json';

async function init() {
  const mapData = await loadMap(MAP_URL);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08114C);
  // Fog matches the background so the terrain's square edge fades into the
  // sky instead of ending in a visible hard line.
  scene.fog = new THREE.Fog(0x2A0B4D, 100, 400);
  const mapSystem = createMapSystem(mapData);
  const world = createWorld(scene, mapSystem.builtTrack);
  createAurora(scene);
  createMusicPlayer();
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

  // Sits the cube on the road without running physics - used while idle so
  // slopes can't pull it before the run starts.
  function settleCube() {
    const q = mapSystem.query(playerState.x, playerState.z);
    playerState.y = q.groundHeight + PLAYER_SIZE / 2;
    playerState.lastTrackQuery = q;
    snapPlayerPrev(playerState);
    player.position.set(playerState.x, playerState.y, playerState.z);
  }

  resetPlayer(player, playerState, mapData.start, camera);
  settleCube();
  scene.add(player);
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer();
  document.body.appendChild(renderer.domElement);

  // Silver walls need something to reflect: bake the aurora sky and world into
  // an environment map once. `far` must reach past the sky dome (radius 500).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(scene, 0, 0.1, 1000).texture;
  pmrem.dispose();

  // Selective glow: bloom lights up only pixels above `threshold` (the ice
  // rails and bright frost), leaving the matte terrain and road crisp.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.7, // strength
    0.5, // radius
    0.7 // threshold
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function updateSize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
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
    settleCube();
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

  // Restore this map's saved personal record so the best time shows and its
  // ghost is ready to race on the first lap.
  const savedRecord = loadRecord(MAP_URL);
  if (savedRecord) {
    bestMs = savedRecord.timeMs;
    bestRecording = savedRecord.ghost;
    ui.setBestTime(bestMs);
  }

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
    // Debug: press L to log where the cube is, in both world and track terms.
    if (e.code === 'KeyL' && !e.repeat) {
      const q = playerState.lastTrackQuery;
      const s = q ? mapSystem.builtTrack.samples[q.index] : null;
      console.log('[cube position]', {
        x: Number(playerState.x.toFixed(2)),
        y: Number(playerState.y.toFixed(2)),
        z: Number(playerState.z.toFixed(2)),
        heading: Number(playerState.heading.toFixed(3)),
        sampleIndex: q?.index ?? null,
        arcLength: s ? Number(s.arcLength.toFixed(1)) : null,
        groundHeight: q ? Number(q.groundHeight.toFixed(3)) : null,
      });
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

      // Physics only runs during a lap - while idle the cube stays exactly
      // where settleCube put it, so slopes can't pull it before the start.
      if (raceState === 'running') {
        accumulator += delta;
        while (accumulator >= PHYSICS_TIMESTEP) {
          accumulator -= PHYSICS_TIMESTEP;
          stepPlayer(playerState, mapSystem, moveInput, PHYSICS_TIMESTEP);

          // Timer advances with physics steps, not render frames, so a
          // recorded time means the same thing on every machine.
          elapsedMs += PHYSICS_TIMESTEP * 1000;
          // One ghost frame per physics step, including the finishing one -
          // playback indexed by lapStep stays locked to the lap clock.
          ghostRecorder.capture(playerState);
          lapStep++;
          if (playerState.lastTrackQuery && mapSystem.isFinish(playerState.lastTrackQuery)) {
            world.flashStartLine();
            const lapMs = elapsedMs;
            const isNewBest = bestMs === null || lapMs < bestMs;
            if (isNewBest) {
              bestMs = lapMs;
              ui.setBestTime(bestMs);
              bestRecording = ghostRecorder.takeRecording();
              saveRecord(MAP_URL, { timeMs: bestMs, ghost: bestRecording });
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
        ui.setTime(elapsedMs);
      }
      ui.setSpeed(Math.hypot(playerState.vx, playerState.vz));
    }

    const alpha = accumulator / PHYSICS_TIMESTEP;
    syncPlayerObject(player, playerState, mapSystem, alpha, delta);
    // Pause freezes puddle aging/dropping (delta 0) but keeps the shadow glued.
    effects.update(player, playerState, mapSystem, paused ? 0 : delta);
    ghost.sync(mapSystem, lapStep, alpha, delta);
    updateCamera(camera, player, delta);
    composer.render();
  }

  requestAnimationFrame(() => {
    updateSize();
    animate();
  });
}

init();
