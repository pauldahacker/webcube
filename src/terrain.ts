import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { lateralOffset } from './track';
import type { BuiltTrack } from './track';

// Everything about the landscape's look in one place - change and reload.
// The style follows the classic three.js terrain example: sunlight and
// shadows are PAINTED INTO a generated texture (per pixel, from the height
// field), and the mesh uses an unlit material. That's what gives it the
// hand-shaded canyon look instead of a plasticky live-lit one.
export const TERRAIN_STYLE = {
  // --- Shape ---
  worldSize: 600, // world units per side
  gridSize: 256, // vertices per side (also the base texture resolution)
  maxHeight: 18, // tallest hills, world units
  seed: 42, // same seed = same hills every run
  octaves: 3, // noise layers; more = more detail per hill
  baseScale: 16, // first layer's feature size (bigger = broader hills)
  ridged: true, // true = sharp ridges (canyon), false = soft rolling dunes

  // --- Baked sunlight ---
  sunDirection: [1, 1, 1], // where the light comes from (x, y, z)
  reliefStrength: 5, // how strongly slopes light up / fall into shadow
  baseColor: [96, 32, 0], // shadow-side color (0-255 rgb)
  sunColor: [128, 96, 96], // added on lit slopes (0-255 rgb per channel)
  brightnessFloor: 0.5, // how dark valleys are allowed to get (0-1)
  heightContrast: 0.9, // how much brighter high ground is than low ground
  grain: 10, // per-pixel speckle strength (0 = perfectly clean)
  textureUpscale: 4, // final texture = gridSize x this, softened + grained

  // --- How the land meets the road ---
  shoulder: 3, // flat strip beside the road, world units
  falloff: 20, // distance over which the land eases back to free hills
  lip: 0.3, // shoulder sits this far below the road surface
};

export function createTerrain(scene: THREE.Scene, track: BuiltTrack) {
  const S = TERRAIN_STYLE;
  const geometry = new THREE.PlaneGeometry(S.worldSize, S.worldSize, S.gridSize - 1, S.gridSize - 1);
  geometry.rotateX(-Math.PI / 2);

  // Height field from layered noise.
  const perlin = new ImprovedNoise();
  const vertices = geometry.attributes.position.array as Float32Array;
  for (let i = 0; i < S.gridSize * S.gridSize; i++) {
    const x = i % S.gridSize;
    const y = Math.floor(i / S.gridSize);
    let height = 0;
    let scale = S.baseScale;
    let amp = 1;
    for (let o = 0; o < S.octaves; o++) {
      const n = perlin.noise(x / scale, y / scale, S.seed);
      height += (S.ridged ? Math.abs(n) : (n + 1) / 2) * amp;
      scale *= 3;
      amp *= 2;
    }
    vertices[i * 3 + 1] = height * S.maxHeight;
  }

  carveTerrainAlongTrack(geometry, track);

  // Heights back out of the carved geometry, for the texture bake - so the
  // cutting/embankment along the track is shaded like real landform too.
  const heights = new Float32Array(S.gridSize * S.gridSize);
  for (let i = 0; i < heights.length; i++) heights[i] = vertices[i * 3 + 1];

  const material = new THREE.MeshBasicMaterial({ map: bakeTerrainTexture(heights) });
  scene.add(new THREE.Mesh(geometry, material));
}

// Small seeded random generator so the grain speckle looks the same on
// every load (purely visual, but stable is nicer than shimmering).
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Paints the landscape texture: for every height-field cell, take the local
// slope, light it against the sun direction, tint by altitude, then upscale
// with a soft blur and per-pixel grain - the three.js terrain example's
// recipe, with the numbers exposed in TERRAIN_STYLE.
function bakeTerrainTexture(heights: Float32Array): THREE.CanvasTexture {
  const S = TERRAIN_STYLE;
  const size = S.gridSize;

  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    minH = Math.min(minH, heights[i]);
    maxH = Math.max(maxH, heights[i]);
  }
  const heightRange = Math.max(maxH - minH, 1e-6);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const data = image.data;

  const sun = new THREE.Vector3(S.sunDirection[0], S.sunDirection[1], S.sunDirection[2]).normalize();
  const slope = new THREE.Vector3();
  const clampIndex = (v: number) => Math.min(Math.max(v, 0), heights.length - 1);

  for (let j = 0; j < heights.length; j++) {
    // Local slope from neighboring cells, two apart, like the example.
    slope.x = (heights[clampIndex(j - 2)] - heights[clampIndex(j + 2)]) * S.reliefStrength;
    slope.y = 2;
    slope.z = (heights[clampIndex(j - size * 2)] - heights[clampIndex(j + size * 2)]) * S.reliefStrength;
    slope.normalize();
    const light = Math.max(slope.dot(sun), 0);

    const altitude = (heights[j] - minH) / heightRange;
    const brightness = S.brightnessFloor + altitude * S.heightContrast;

    const i = j * 4;
    data[i] = (S.baseColor[0] + light * S.sunColor[0]) * brightness;
    data[i + 1] = (S.baseColor[1] + light * S.sunColor[1]) * brightness;
    data[i + 2] = (S.baseColor[2] + light * S.sunColor[2]) * brightness;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  // Upscale (softens the cell edges) and sprinkle grain over every pixel.
  const scaled = document.createElement('canvas');
  scaled.width = size * S.textureUpscale;
  scaled.height = size * S.textureUpscale;
  const scaledCtx = scaled.getContext('2d')!;
  scaledCtx.scale(S.textureUpscale, S.textureUpscale);
  scaledCtx.drawImage(canvas, 0, 0);

  if (S.grain > 0) {
    const grainImage = scaledCtx.getImageData(0, 0, scaled.width, scaled.height);
    const grainData = grainImage.data;
    const rand = mulberry32(S.seed);
    for (let i = 0; i < grainData.length; i += 4) {
      const speckle = (rand() - 0.5) * S.grain;
      grainData[i] += speckle;
      grainData[i + 1] += speckle;
      grainData[i + 2] += speckle;
    }
    scaledCtx.putImageData(grainImage, 0, 0);
  }

  const texture = new THREE.CanvasTexture(scaled);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// Flattens the land onto the road (plus a shoulder), easing back into free
// hills over the falloff distance - digs cuttings through high ground and
// raises embankments over low ground. Where the track passes over itself
// (an overpass), every distinct pass near a vertex is carved against and
// the LOWEST result wins: the ground drops to the lower road and the upper
// road crosses the gap as a bridge, instead of the hills swallowing the
// underpass. Runs once at load.
const COARSE_STEP = 8;
// Candidates further apart than this along the track (in samples; 0.5 world
// units each) are treated as separate passes over the same ground, even
// though they are close together in space.
const PASS_GAP = 64;

function carveTerrainAlongTrack(geometry: THREE.BufferGeometry, track: BuiltTrack) {
  const S = TERRAIN_STYLE;
  const vertices = geometry.attributes.position.array as Float32Array;
  const samples = track.samples;
  const n = samples.length;

  // Generous coarse-filter radius: per-pass carving below uses each
  // sample's actual width.
  let maxHalfWidth = 0;
  for (const s of samples) maxHalfWidth = Math.max(maxHalfWidth, s.width / 2);
  const outerRadius = maxHalfWidth + S.shoulder + S.falloff;
  const outerRadiusSq = outerRadius * outerRadius;

  for (let v = 0; v < vertices.length / 3; v++) {
    const vx = vertices[v * 3];
    const vz = vertices[v * 3 + 2];
    const noiseH = vertices[v * 3 + 1];

    // Coarse scan: the nearest candidate of every distinct pass near this
    // vertex. Samples are 0.5 apart, so distance-to-nearest-sample is a
    // good stand-in for distance-to-centerline.
    const passBest: number[] = [];
    const passBestDistSq: number[] = [];
    let prevCandidate = -Infinity;
    for (let i = 0; i < n; i += COARSE_STEP) {
      const dx = samples[i].x - vx;
      const dz = samples[i].z - vz;
      const dsq = dx * dx + dz * dz;
      if (dsq >= outerRadiusSq) continue;
      if (i - prevCandidate > PASS_GAP) {
        passBest.push(i);
        passBestDistSq.push(dsq);
      } else if (dsq < passBestDistSq[passBestDistSq.length - 1]) {
        passBest[passBest.length - 1] = i;
        passBestDistSq[passBestDistSq.length - 1] = dsq;
      }
      prevCandidate = i;
    }
    if (passBest.length === 0) continue;

    // Carve against every pass; keep the lowest height so underpasses stay
    // open. (A closed loop's seam can split one pass into two clusters -
    // harmless, both refine to the same nearest sample.)
    let carved = Infinity;
    for (let c = 0; c < passBest.length; c++) {
      const base = passBest[c];
      let bestI = base;
      let bestDistSq = passBestDistSq[c];
      for (let o = -COARSE_STEP; o <= COARSE_STEP; o++) {
        const i = track.closedLoop
          ? (((base + o) % n) + n) % n
          : Math.min(Math.max(base + o, 0), n - 1);
        const dx = samples[i].x - vx;
        const dz = samples[i].z - vz;
        const dsq = dx * dx + dz * dz;
        if (dsq < bestDistSq) {
          bestDistSq = dsq;
          bestI = i;
        }
      }

      const s = samples[bestI];
      const inner = s.width / 2 + S.shoulder;
      const d = Math.sqrt(bestDistSq);
      if (d >= inner + S.falloff) continue; // this pass is out of range

      // Road height at this point, with the banking plane clamped to the
      // shoulder edge so the bank's tilt doesn't extend into the landscape.
      const offset = lateralOffset(track, bestI, vx, vz);
      const clamped = Math.max(-inner, Math.min(inner, offset));
      const roadH = s.y + clamped * s.right.y - S.lip;

      let h: number;
      if (d <= inner) {
        h = roadH;
      } else {
        const t = (d - inner) / S.falloff;
        const ease = t * t * (3 - 2 * t); // smoothstep
        h = roadH * (1 - ease) + noiseH * ease;
      }
      carved = Math.min(carved, h);
    }
    if (carved !== Infinity) vertices[v * 3 + 1] = carved;
  }
}
