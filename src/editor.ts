import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildTrack, buildRoadGeometry, buildBarrierGeometry } from './track';
import type { TrackPoint, BuiltTrack } from './track';
import type { MapData } from './map';
import { BARRIER_HEIGHT } from './constants';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 60;
const HIT_RADIUS = 10; // px, for picking a control point under the pointer

// Camera: zoom is px per world unit, viewX/viewY is the world point rendered
// at the center of the canvas. Together they let the (fixed-size) canvas act
// as a window onto an unbounded world instead of a 1:1 fixed-size buffer, so
// there's no inherent limit on how big a track can be.
let zoom = 6;
let viewX = 0;
let viewY = 0;
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;

function defaultTrack(): TrackPoint[] {
  return [
    { x: 0, z: 0, elevation: 0, width: 8, banking: 0, grip: 1 },
    { x: 0, z: -30, elevation: 0, width: 8, banking: 0, grip: 1 },
  ];
}

let points: TrackPoint[] = defaultTrack();
let closedLoop = false;
let selectedIndex: number | null = null;
let draggingIndex: number | null = null;

const canvas = document.getElementById('grid') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const closedLoopInput = document.getElementById('closed-loop') as HTMLInputElement;
const loadInput = document.getElementById('load') as HTMLInputElement;
const pointEmpty = document.getElementById('point-empty') as HTMLDivElement;
const pointFields = document.getElementById('point-fields') as HTMLDivElement;
const elevationInput = document.getElementById('pt-elevation') as HTMLInputElement;
const widthInput = document.getElementById('pt-width') as HTMLInputElement;
const bankingInput = document.getElementById('pt-banking') as HTMLInputElement;
const gripInput = document.getElementById('pt-grip') as HTMLInputElement;
const deleteButton = document.getElementById('delete-point') as HTMLButtonElement;

function worldToScreen(x: number, z: number): [number, number] {
  return [(x - viewX) * zoom + canvas.width / 2, (z - viewY) * zoom + canvas.height / 2];
}

function screenToWorld(sx: number, sy: number): [number, number] {
  return [(sx - canvas.width / 2) / zoom + viewX, (sy - canvas.height / 2) / zoom + viewY];
}

// Sets zoom while keeping the world point under (anchorX, anchorY) fixed on
// screen - so scroll-to-zoom feels like it zooms "into" the cursor, and the
// zoom buttons zoom into the canvas center.
function setZoom(newZoom: number, anchorX = canvas.width / 2, anchorY = canvas.height / 2) {
  const [wx, wz] = screenToWorld(anchorX, anchorY);
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
  viewX = wx - (anchorX - canvas.width / 2) / zoom;
  viewY = wz - (anchorY - canvas.height / 2) / zoom;
  render();
}

function fitView() {
  if (points.length === 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const pad = 15;
  const worldW = Math.max(maxX - minX, 1) + pad * 2;
  const worldH = Math.max(maxZ - minZ, 1) + pad * 2;
  viewX = (minX + maxX) / 2;
  viewY = (minZ + maxZ) / 2;
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(canvas.width / worldW, canvas.height / worldH)));
  render();
}

function resizeCanvas() {
  const wrap = canvas.parentElement!;
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  render();
}

// Grip below 1 tints the road bluer/darker - a visual cue for slick patches
// authored directly on the track, matching what the physics will apply.
function gripColor(grip: number): string {
  const t = Math.min(Math.max(1 - grip, 0), 1);
  const r = Math.round(140 - 60 * t);
  const g = Math.round(140 - 40 * t);
  const b = Math.round(150 + 70 * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// Picks a "nice" world-space grid step (1/2/5 x a power of 10) so grid lines
// land roughly targetPx apart on screen regardless of current zoom.
function niceGridStep(targetPx: number): number {
  const rawWorldStep = targetPx / zoom;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawWorldStep)));
  const residual = rawWorldStep / magnitude;
  if (residual < 2) return 2 * magnitude;
  if (residual < 5) return 5 * magnitude;
  return 10 * magnitude;
}

function drawGrid() {
  const step = niceGridStep(70);
  const [minWX, minWZ] = screenToWorld(0, 0);
  const [maxWX, maxWZ] = screenToWorld(canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  const startX = Math.floor(minWX / step) * step;
  for (let wx = startX; wx <= maxWX; wx += step) {
    const [sx] = worldToScreen(wx, 0);
    ctx.beginPath();
    ctx.moveTo(sx + 0.5, 0);
    ctx.lineTo(sx + 0.5, canvas.height);
    ctx.stroke();
  }
  const startZ = Math.floor(minWZ / step) * step;
  for (let wz = startZ; wz <= maxWZ; wz += step) {
    const [, sy] = worldToScreen(0, wz);
    ctx.beginPath();
    ctx.moveTo(0, sy + 0.5);
    ctx.lineTo(canvas.width, sy + 0.5);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  const [axisX] = worldToScreen(0, 0);
  const [, axisY] = worldToScreen(0, 0);
  ctx.beginPath();
  ctx.moveTo(axisX + 0.5, 0);
  ctx.lineTo(axisX + 0.5, canvas.height);
  ctx.moveTo(0, axisY + 0.5);
  ctx.lineTo(canvas.width, axisY + 0.5);
  ctx.stroke();
}

function drawRibbon(track: BuiltTrack) {
  const { samples, closedLoop: loop } = track;
  const segmentCount = loop ? samples.length : samples.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    const [alx, alz] = worldToScreen(a.x - a.right.x * (a.width / 2), a.z - a.right.z * (a.width / 2));
    const [arx, arz] = worldToScreen(a.x + a.right.x * (a.width / 2), a.z + a.right.z * (a.width / 2));
    const [blx, blz] = worldToScreen(b.x - b.right.x * (b.width / 2), b.z - b.right.z * (b.width / 2));
    const [brx, brz] = worldToScreen(b.x + b.right.x * (b.width / 2), b.z + b.right.z * (b.width / 2));
    ctx.fillStyle = gripColor(a.grip);
    ctx.beginPath();
    ctx.moveTo(alx, alz);
    ctx.lineTo(arx, arz);
    ctx.lineTo(brx, brz);
    ctx.lineTo(blx, blz);
    ctx.closePath();
    ctx.fill();
  }
}

function drawStartMarker(track: BuiltTrack) {
  const s = track.samples[0];
  const [sx, sy] = worldToScreen(s.x, s.z);
  const [ex, ey] = worldToScreen(s.x + s.tangent.x * 5, s.z + s.tangent.z * 5);
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
}

function drawControlPoints() {
  points.forEach((p, i) => {
    const [sx, sy] = worldToScreen(p.x, p.z);
    ctx.fillStyle = i === selectedIndex ? '#facc15' : i === 0 ? '#4ade80' : '#7833aa';
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111318';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (p.elevation !== 0) {
      ctx.fillStyle = '#c4c6cc';
      ctx.font = '11px system-ui';
      ctx.fillText(`${p.elevation}`, sx + 10, sy - 8);
    }
  });
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  if (points.length >= 2) {
    const track = buildTrack(points, closedLoop);
    drawRibbon(track);
    drawStartMarker(track);
  }

  drawControlPoints();
}

function findPointNear(sx: number, sy: number): number | null {
  for (let i = 0; i < points.length; i++) {
    const [px, py] = worldToScreen(points[i].x, points[i].z);
    if (Math.hypot(px - sx, py - sy) <= HIT_RADIUS) return i;
  }
  return null;
}

function updatePointPanel() {
  if (selectedIndex === null) {
    pointEmpty.style.display = '';
    pointFields.style.display = 'none';
    return;
  }
  const p = points[selectedIndex];
  pointEmpty.style.display = 'none';
  pointFields.style.display = 'flex';
  elevationInput.value = String(p.elevation);
  widthInput.value = String(p.width);
  bankingInput.value = String(p.banking);
  gripInput.value = String(p.grip);
}

function selectPoint(index: number | null) {
  selectedIndex = index;
  updatePointPanel();
  render();
}

function deleteSelected() {
  if (selectedIndex === null || points.length <= 2) return;
  beginChange();
  points.splice(selectedIndex, 1);
  selectPoint(null);
}

// --- undo / redo ---
// Snapshot-based history: beginChange() pushes the current state right
// before a mutation, so cmd/ctrl+Z restores to it. Restoring skips over
// no-op entries (e.g. clicking a point without actually dragging it).

const undoStack: string[] = [];
const redoStack: string[] = [];

function historySnapshot(): string {
  return JSON.stringify({ points, closedLoop });
}

function beginChange() {
  undoStack.push(historySnapshot());
  redoStack.length = 0;
}

function restoreSnapshot(state: string) {
  const parsed = JSON.parse(state) as { points: TrackPoint[]; closedLoop: boolean };
  points = parsed.points;
  closedLoop = parsed.closedLoop;
  closedLoopInput.checked = closedLoop;
  if (selectedIndex !== null && selectedIndex >= points.length) selectedIndex = null;
  updatePointPanel();
  render();
}

function undo() {
  while (undoStack.length > 0) {
    const state = undoStack.pop()!;
    if (state !== historySnapshot()) {
      redoStack.push(historySnapshot());
      restoreSnapshot(state);
      return;
    }
  }
}

function redo() {
  while (redoStack.length > 0) {
    const state = redoStack.pop()!;
    if (state !== historySnapshot()) {
      undoStack.push(historySnapshot());
      restoreSnapshot(state);
      return;
    }
  }
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  // Middle or right button: pan, regardless of what's under the cursor.
  // Pointer capture keeps the pan/drag alive even when the cursor leaves the
  // canvas mid-gesture - without it the drag freezes at the canvas edge.
  // preventDefault stops the browser's middle-click autoscroll mode.
  if (e.button === 1 || e.button === 2) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isPanning = true;
    lastPanX = sx;
    lastPanY = sy;
    return;
  }
  if (e.button !== 0) return;

  const hit = findPointNear(sx, sy);
  if (hit !== null) {
    beginChange();
    canvas.setPointerCapture(e.pointerId);
    draggingIndex = hit;
    selectPoint(hit);
    return;
  }
  // Empty space: append a new point at the end of the track, inheriting the
  // last point's attributes so a fresh point doesn't reset width/grip/etc.
  beginChange();
  const [wx, wz] = screenToWorld(sx, sy);
  const last = points[points.length - 1];
  points.push({
    x: wx,
    z: wz,
    elevation: last?.elevation ?? 0,
    width: last?.width ?? 8,
    banking: 0,
    grip: last?.grip ?? 1,
  });
  selectPoint(points.length - 1);
});

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (isPanning) {
    viewX -= (sx - lastPanX) / zoom;
    viewY -= (sy - lastPanY) / zoom;
    lastPanX = sx;
    lastPanY = sy;
    render();
    return;
  }

  if (draggingIndex === null) return;
  const [wx, wz] = screenToWorld(sx, sy);
  points[draggingIndex].x = wx;
  points[draggingIndex].z = wz;
  render();
});

// Trackpad two-finger scroll pans; pinch (which browsers report as a wheel
// event with ctrlKey set) or explicit ctrl/cmd+scroll zooms toward the
// cursor. The previous zoom-on-any-scroll made trackpad panning impossible.
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Clamp per-event delta so a single mouse-wheel notch (delta ~100)
      // doesn't jump the zoom, while rapid small pinch deltas stay smooth.
      const clamped = Math.max(-40, Math.min(40, e.deltaY));
      setZoom(zoom * Math.exp(-clamped * 0.005), sx, sy);
    } else {
      viewX += e.deltaX / zoom;
      viewY += e.deltaY / zoom;
      render();
    }
  },
  { passive: false }
);

globalThis.addEventListener('pointerup', () => {
  draggingIndex = null;
  isPanning = false;
});

window.addEventListener('resize', resizeCanvas);

document.getElementById('zoom-in')!.addEventListener('click', () => setZoom(zoom * 1.3));
document.getElementById('zoom-out')!.addEventListener('click', () => setZoom(zoom / 1.3));
document.getElementById('fit-view')!.addEventListener('click', fitView);

globalThis.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      redo();
    } else {
      undo();
    }
    return;
  }
  if (document.activeElement instanceof HTMLInputElement) return;
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
});

function onFieldInput() {
  if (selectedIndex === null) return;
  const p = points[selectedIndex];
  p.elevation = Number(elevationInput.value) || 0;
  p.width = Math.max(1, Number(widthInput.value) || 1);
  p.banking = Number(bankingInput.value) || 0;
  p.grip = Math.max(0.05, Number(gripInput.value) || 1);
  render();
}
[elevationInput, widthInput, bankingInput, gripInput].forEach((el) => {
  // One history entry per edit session (entering the field), not per
  // keystroke - so one cmd+Z reverts the whole field edit at once.
  el.addEventListener('focus', beginChange);
  el.addEventListener('input', onFieldInput);
});

deleteButton.addEventListener('click', deleteSelected);

closedLoopInput.addEventListener('change', () => {
  beginChange();
  closedLoop = closedLoopInput.checked;
  render();
});

document.getElementById('new-track')!.addEventListener('click', () => {
  beginChange();
  points = defaultTrack();
  closedLoop = false;
  closedLoopInput.checked = false;
  selectedIndex = null;
  updatePointPanel();
  fitView();
});

// Inverse of the game's forward vector for rotation.y (-sin θ, 0, -cos θ) -
// derives the start rotation from the first sample's actual tangent, so the
// spawn heading always matches the track's real starting direction.
function rotationFromTangent(tangent: THREE.Vector3): number {
  return Math.atan2(-tangent.x, -tangent.z);
}

document.getElementById('export')!.addEventListener('click', () => {
  if (points.length < 2) return;
  const track = buildTrack(points, closedLoop);
  const mapData: MapData = {
    track: points,
    closedLoop,
    start: { x: points[0].x, z: points[0].z, rotation: rotationFromTangent(track.samples[0].tangent) },
  };
  const blob = new Blob([JSON.stringify(mapData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'track.json';
  a.click();
  URL.revokeObjectURL(url);
});

loadInput.addEventListener('change', async () => {
  const file = loadInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  const mapData = JSON.parse(text) as MapData;
  beginChange();
  points = mapData.track;
  closedLoop = mapData.closedLoop;
  closedLoopInput.checked = closedLoop;
  selectedIndex = null;
  updatePointPanel();
  fitView();
  loadInput.value = '';
});

// --- 3D preview ---

const previewOverlay = document.getElementById('preview-overlay') as HTMLDivElement;
const previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
const closePreviewButton = document.getElementById('close-preview') as HTMLButtonElement;
let previewRenderer: THREE.WebGLRenderer | null = null;
let previewAnimId: number | null = null;
let previewResizeHandler: (() => void) | null = null;

function openPreview() {
  if (points.length < 2) return;
  previewOverlay.style.display = 'flex';

  const track = buildTrack(points, closedLoop);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1c2230);
  const roadGeo = buildRoadGeometry(track);
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xc9d3d8, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(roadGeo, roadMat));
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xd6455c, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(buildBarrierGeometry(track, -1, BARRIER_HEIGHT), barrierMat));
  scene.add(new THREE.Mesh(buildBarrierGeometry(track, 1, BARRIER_HEIGHT), barrierMat));
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(20, 40, 20);
  scene.add(light);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  const mid = track.samples[Math.floor(track.samples.length / 2)];
  camera.position.set(mid.x, mid.y + 60, mid.z + 60);

  previewRenderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true });

  const resize = () => {
    const w = previewCanvas.clientWidth;
    const h = previewCanvas.clientHeight;
    previewRenderer!.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  previewResizeHandler = resize;
  resize();
  window.addEventListener('resize', resize);

  const controls = new OrbitControls(camera, previewCanvas);
  controls.target.set(mid.x, mid.y, mid.z);
  controls.update();

  const animate = () => {
    previewAnimId = requestAnimationFrame(animate);
    controls.update();
    previewRenderer!.render(scene, camera);
  };
  animate();
}

function closePreview() {
  if (previewAnimId !== null) cancelAnimationFrame(previewAnimId);
  if (previewResizeHandler) window.removeEventListener('resize', previewResizeHandler);
  previewRenderer?.dispose();
  previewRenderer = null;
  previewOverlay.style.display = 'none';
}

document.getElementById('preview-3d')!.addEventListener('click', openPreview);
closePreviewButton.addEventListener('click', closePreview);

updatePointPanel();
resizeCanvas();
// Deferred a frame - on first load the canvas's flex-computed layout size
// isn't reliably settled yet when this module script runs, so fitting
// immediately can compute zoom against a stale (often zero) canvas size.
requestAnimationFrame(() => {
  resizeCanvas();
  fitView();
});
