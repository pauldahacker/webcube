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
import { createMinimap } from './minimap';
import { loadRecord, saveRecord } from './records';
import { submitRun, fetchRival, fetchLeaderboardAround, fetchMyBest } from './net/leaderboard';
import { playerName } from './net/identity';
import { createUI } from './ui';
import { createMusicPlayer } from './music';
import { renderHome, createMenuButton } from './menu';
import { TRACKS, selectedTrack } from './tracks';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PHYSICS_TIMESTEP, MAX_FRAME_DELTA, PLAYER_SIZE } from './constants';

async function init() {
  // No track chosen yet: show the home/landing page (track select) and stop -
  // the 3D game is only built once a track is picked (?track=<url>).
  const track = selectedTrack();
  if (!track) {
    renderHome(TRACKS);
    return;
  }
  const MAP_URL = track.url;
  const TRACK_VERSION = track.version ?? 1;
  const mapData = await loadMap(MAP_URL);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08114C);
  // Fog matches the background so the terrain's square edge fades into the
  // sky instead of ending in a visible hard line.
  scene.fog = new THREE.Fog(0x2A0B4D, 100, 400);
  const mapSystem = createMapSystem(mapData);
  const world = createWorld(scene, mapSystem.builtTrack);
  createAurora(scene);
  const music = createMusicPlayer();
  createMenuButton();
  const effects = createCubeEffects(scene);
  const minimap = createMinimap(mapSystem.builtTrack);
  const ghost = createGhost(scene); // yellow: the player's own best
  // Pink: the leaderboard rival ranked one place above the player's best.
  const rivalGhost = createGhost(scene, { bodyColor: 0xff5fb0, trailColor: 0xff9ecb });
  const ghostRecorder = createGhostRecorder();
  // Best-lap recording, session-only for now (like bestMs itself).
  let bestRecording: GhostRecording | null = null;
  // The rival ranked one place above the player's best: their downloaded ghost
  // is what we actually race when the leaderboard has someone to chase, falling
  // back to the player's own best run when it doesn't.
  let rivalRecording: GhostRecording | null = null;
  // Rival's display name for the pink ghost's floating tag.
  let rivalName: string | null = null;
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
    rivalGhost.hide();
    lapStep = 0;
    raceState = 'idle';
    elapsedMs = 0;
    accumulator = 0;
    paused = false;
    ui.setTime(0);
    ui.hideResult();
    ui.hidePause();
    ui.showControls();
  });

  // Reveal both ghosts for the next lap: yellow is the player's own best, pink
  // is the rival above (hidden when there's no rival to chase).
  function showGhosts() {
    if (bestRecording) ghost.show(bestRecording);
    if (rivalRecording) rivalGhost.show(rivalRecording);
    else rivalGhost.hide();
  }

  // Pull the rival ranked just above `timeMs` and race their ghost from the next
  // lap. No-ops offline or when you're already on top - then the own-best ghost
  // stands in.
  function refreshRival(timeMs: number | null) {
    void fetchRival(MAP_URL, TRACK_VERSION, timeMs).then((r) => {
      rivalRecording = r?.ghost ?? null;
      rivalName = r?.entry.name ?? null;
      // Pop the rival in mid-lap the moment it arrives (a small delay is fine),
      // rather than making the player wait for the next lap to see them.
      if (raceState === 'running') {
        if (rivalRecording) rivalGhost.show(rivalRecording);
        else rivalGhost.hide();
      }
    });
  }

  // Redraw the standings window (9 above + you); before any lap, the global
  // top 10. Runs on load and after each new best.
  function refreshLeaderboard() {
    void fetchLeaderboardAround(MAP_URL, TRACK_VERSION, bestMs, playerName()).then((rows) => {
      ui.setLeaderboard(rows);
    });
  }

  // Reconcile the local record with the server: adopt the server's best when it
  // beats (or is our only) record, or push a better local one up. Stops a
  // cleared/new-device localStorage from letting a slower lap count as a PB.
  async function reconcileBest() {
    const serverBest = await fetchMyBest(MAP_URL, TRACK_VERSION);
    if (!serverBest) {
      if (bestMs !== null && bestRecording) void submitRun(MAP_URL, TRACK_VERSION, bestMs, bestRecording);
      return;
    }
    if (bestMs === null || serverBest.timeMs < bestMs) {
      bestMs = serverBest.timeMs;
      bestRecording = serverBest.ghost;
      saveRecord(MAP_URL, { timeMs: bestMs, ghost: bestRecording });
      refreshRival(bestMs);
      refreshLeaderboard();
    } else if (bestMs < serverBest.timeMs && bestRecording) {
      void submitRun(MAP_URL, TRACK_VERSION, bestMs, bestRecording);
    }
  }

  // Restore this map's saved personal record so the best time shows and its
  // ghost is ready to race on the first lap.
  const savedRecord = loadRecord(MAP_URL);
  if (savedRecord) {
    bestMs = savedRecord.timeMs;
    bestRecording = savedRecord.ghost;
  }
  // Load the rival to chase: the player just above our best, or - with no time
  // yet - the slowest player on the board, so the first lap has a target too.
  refreshRival(bestMs);
  // Show standings from the start (top 10 until the player has a time).
  refreshLeaderboard();
  // Then reconcile our best with the server (fixes local/server drift).
  void reconcileBest();

  function togglePause() {
    paused = !paused;
    music.setPaused(paused);
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
    // Dev-only - tree-shaken out of the production build we ship to CrazyGames.
    if (import.meta.env.DEV && e.code === 'KeyL' && !e.repeat) {
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
        music.setPaused(false);
        lapStep = 0;
        ghostRecorder.reset();
        ui.hideControls();
        showGhosts();
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
            const lapMs = elapsedMs;
            const prevBest = bestMs;
            const isNewBest = prevBest === null || lapMs < prevBest;
            // Gate + banner: green on a new PB (or first lap), red when slower;
            // the banner shows the gap to the previous PB.
            world.flashStartLine(isNewBest);
            ui.flashLapDelta(prevBest === null ? null : lapMs - prevBest);
            if (isNewBest) {
              bestMs = lapMs;
              bestRecording = ghostRecorder.takeRecording();
              saveRecord(MAP_URL, { timeMs: bestMs, ghost: bestRecording });
              // Publish the run, then re-target the (now harder) rival above
              // and redraw the standings with the improved rank.
              void submitRun(MAP_URL, TRACK_VERSION, bestMs, bestRecording);
              refreshRival(bestMs);
              refreshLeaderboard();
            }
            elapsedMs = 0;
            // Next lap starts immediately: restart recording and replay the
            // (possibly just-updated) best run from its first frame.
            lapStep = 0;
            ghostRecorder.reset();
            showGhosts();
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
    rivalGhost.sync(mapSystem, lapStep, alpha, delta);
    updateGhostTag('player', ghost, playerName());
    updateGhostTag('rival', rivalGhost, rivalName);
    const ownA = ghost.anchor();
    const rivalA = rivalGhost.anchor();
    minimap.update(
      player.position.x,
      player.position.z,
      ownA ? { x: ownA.x, z: ownA.z } : null,
      rivalA ? { x: rivalA.x, z: rivalA.z } : null
    );
    updateCamera(camera, player, delta);
    composer.render();
  }

  // Project a ghost's world anchor to screen space and place its name tag, or
  // hide the tag when the ghost is off-screen, behind the camera, or unnamed.
  const tagNdc = new THREE.Vector3();
  function updateGhostTag(which: 'player' | 'rival', gh: typeof ghost, name: string | null) {
    const anchor = name ? gh.anchor() : null;
    if (!anchor) {
      ui.hideGhostTag(which);
      return;
    }
    tagNdc.copy(anchor).project(camera);
    if (tagNdc.z > 1) {
      ui.hideGhostTag(which);
      return;
    }
    const x = (tagNdc.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-tagNdc.y * 0.5 + 0.5) * window.innerHeight;
    ui.setGhostTag(which, x, y, name!);
  }

  requestAnimationFrame(() => {
    updateSize();
    animate();
  });
}

init();
