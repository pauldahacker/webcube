import type { MapData } from './map';

type Tool = 'wall' | 'floor' | 'start' | 'finish';

const CELL_SIZE = 20;
const DEFAULT_MAP_URL = '/maps/default.json';

let width = 20;
let height = 20;
let grid: string[][] = makeBorderedGrid(width, height);
let start = { x: 1.5, z: 1.5 };
let rotationDeg = 0;
let finish = { x: width - 1.5, z: height - 1.5 };
let currentTool: Tool = 'wall';
let isPainting = false;
let paintValue: '0' | '1' = '1';

const canvas = document.getElementById('grid') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const widthInput = document.getElementById('width') as HTMLInputElement;
const heightInput = document.getElementById('height') as HTMLInputElement;
const rotationInput = document.getElementById('rotation') as HTMLInputElement;
const loadInput = document.getElementById('load') as HTMLInputElement;

function makeBorderedGrid(w: number, h: number): string[][] {
  const rows: string[][] = [];
  for (let z = 0; z < h; z++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      row.push(z === 0 || z === h - 1 || x === 0 || x === w - 1 ? '1' : '0');
    }
    rows.push(row);
  }
  return rows;
}

function render() {
  canvas.width = width * CELL_SIZE;
  canvas.height = height * CELL_SIZE;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = grid[z][x] === '1' ? '#8a8a8a' : '#1c1c22';
      ctx.fillRect(x * CELL_SIZE, z * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL_SIZE + 0.5, 0);
    ctx.lineTo(x * CELL_SIZE + 0.5, height * CELL_SIZE);
    ctx.stroke();
  }
  for (let z = 0; z <= height; z++) {
    ctx.beginPath();
    ctx.moveTo(0, z * CELL_SIZE + 0.5);
    ctx.lineTo(width * CELL_SIZE, z * CELL_SIZE + 0.5);
    ctx.stroke();
  }

  drawMarker(finish.x, finish.z, '#facc15');
  drawStartMarker();
}

function drawMarker(x: number, z: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x * CELL_SIZE, z * CELL_SIZE, CELL_SIZE * 0.32, 0, Math.PI * 2);
  ctx.fill();
}

function drawStartMarker() {
  const px = start.x * CELL_SIZE;
  const pz = start.z * CELL_SIZE;
  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.arc(px, pz, CELL_SIZE * 0.32, 0, Math.PI * 2);
  ctx.fill();

  // Matches the three.js forward vector for rotation.y: (-sin θ, 0, -cos θ)
  const rotation = (rotationDeg * Math.PI) / 180;
  const dx = -Math.sin(rotation) * CELL_SIZE * 0.7;
  const dz = -Math.cos(rotation) * CELL_SIZE * 0.7;
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, pz);
  ctx.lineTo(px + dx, pz + dz);
  ctx.stroke();
}

function cellFromEvent(e: PointerEvent): { x: number; z: number } {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
  const z = Math.floor((e.clientY - rect.top) / CELL_SIZE);
  return {
    x: Math.min(Math.max(x, 0), width - 1),
    z: Math.min(Math.max(z, 0), height - 1),
  };
}

function applyTool(cellX: number, cellZ: number) {
  if (currentTool === 'start') {
    start = { x: cellX + 0.5, z: cellZ + 0.5 };
  } else if (currentTool === 'finish') {
    finish = { x: cellX + 0.5, z: cellZ + 0.5 };
  } else {
    grid[cellZ][cellX] = paintValue;
  }
  render();
}

canvas.addEventListener('pointerdown', (e) => {
  const { x, z } = cellFromEvent(e);
  if (currentTool === 'wall' || currentTool === 'floor') {
    isPainting = true;
    paintValue = currentTool === 'wall' ? '1' : '0';
  }
  applyTool(x, z);
});

canvas.addEventListener('pointermove', (e) => {
  if (!isPainting) return;
  const { x, z } = cellFromEvent(e);
  grid[z][x] = paintValue;
  render();
});

globalThis.addEventListener('pointerup', () => {
  isPainting = false;
});

document.querySelectorAll<HTMLButtonElement>('.tool').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool as Tool;
  });
});

rotationInput.addEventListener('input', () => {
  rotationDeg = Number(rotationInput.value) || 0;
  render();
});

document.getElementById('resize')!.addEventListener('click', () => {
  const newWidth = Math.max(3, Number(widthInput.value) || width);
  const newHeight = Math.max(3, Number(heightInput.value) || height);
  const newGrid: string[][] = [];
  for (let z = 0; z < newHeight; z++) {
    const row: string[] = [];
    for (let x = 0; x < newWidth; x++) {
      row.push(grid[z]?.[x] ?? '0');
    }
    newGrid.push(row);
  }
  grid = newGrid;
  width = newWidth;
  height = newHeight;
  render();
});

document.getElementById('new-map')!.addEventListener('click', () => {
  const newWidth = Math.max(3, Number(widthInput.value) || width);
  const newHeight = Math.max(3, Number(heightInput.value) || height);
  width = newWidth;
  height = newHeight;
  grid = makeBorderedGrid(width, height);
  start = { x: 1.5, z: 1.5 };
  rotationDeg = 0;
  rotationInput.value = '0';
  finish = { x: width - 1.5, z: height - 1.5 };
  render();
});

document.getElementById('export')!.addEventListener('click', () => {
  const mapData: MapData = {
    layout: grid.map((row) => row.join('')),
    start: { x: start.x, z: start.z, rotation: (rotationDeg * Math.PI) / 180 },
    finish: { x: finish.x, z: finish.z },
  };
  const blob = new Blob([JSON.stringify(mapData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'map.json';
  a.click();
  URL.revokeObjectURL(url);
});

loadInput.addEventListener('change', async () => {
  const file = loadInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  loadMapData(JSON.parse(text) as MapData);
  loadInput.value = '';
});

function loadMapData(mapData: MapData) {
  height = mapData.layout.length;
  width = mapData.layout[0]?.length ?? 0;
  grid = mapData.layout.map((row) => row.split(''));
  start = { x: mapData.start.x, z: mapData.start.z };
  rotationDeg = Math.round((mapData.start.rotation * 180) / Math.PI);
  finish = { x: mapData.finish.x, z: mapData.finish.z };
  widthInput.value = String(width);
  heightInput.value = String(height);
  rotationInput.value = String(rotationDeg);
  render();
}

async function init() {
  try {
    const response = await fetch(DEFAULT_MAP_URL);
    if (response.ok) {
      loadMapData((await response.json()) as MapData);
      return;
    }
  } catch {
    // No default map available yet — start from the blank bordered grid.
  }
  render();
}

init();
