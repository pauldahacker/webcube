// Compact GhostRecording <-> base64. Frames are Float32 and downsampled by
// STRIDE to keep a lap to a few KB; decode re-expands to per-step frames so the
// replayer (ghost.ts) is unchanged. Bump FORMAT if the layout ever changes.
import type { GhostRecording, GhostFrame } from '../ghost';

const FORMAT = 1;
const STRIDE = 2; // store every Nth physics step

export function encodeGhost(rec: GhostRecording): { b64: string; frameCount: number } {
  const src = rec.frames;
  const kept: GhostFrame[] = [];
  for (let i = 0; i < src.length; i += STRIDE) kept.push(src[i]);
  const last = src[src.length - 1];
  if (last && kept[kept.length - 1] !== last) kept.push(last);

  const f = new Float32Array(3 + kept.length * 4);
  f[0] = FORMAT; f[1] = STRIDE; f[2] = src.length;
  for (let i = 0; i < kept.length; i++) {
    const p = kept[i];
    const o = 3 + i * 4;
    f[o] = p.x; f[o + 1] = p.y; f[o + 2] = p.z; f[o + 3] = p.heading;
  }
  return { b64: bytesToBase64(new Uint8Array(f.buffer)), frameCount: src.length };
}

export function decodeGhost(b64: string): GhostRecording {
  const bytes = base64ToBytes(b64);
  if (bytes.byteLength < 12) return { frames: [] };
  const f = new Float32Array(bytes.buffer, 0, bytes.byteLength >> 2);
  if (f[0] !== FORMAT) return { frames: [] };
  const stride = Math.max(1, f[1] | 0);
  const origLen = f[2] | 0;

  const kept: GhostFrame[] = [];
  for (let o = 3; o + 3 < f.length; o += 4) kept.push({ x: f[o], y: f[o + 1], z: f[o + 2], heading: f[o + 3] });
  return { frames: reexpand(kept, stride, origLen) };
}

// Linearly re-interpolate the kept samples back to origLen per-step frames.
function reexpand(kept: GhostFrame[], stride: number, origLen: number): GhostFrame[] {
  if (kept.length === 0) return [];
  if (stride <= 1 || kept.length === 1) return kept.slice(0, origLen || kept.length);
  const out: GhostFrame[] = new Array(origLen);
  for (let i = 0; i < origLen; i++) {
    const s = i / stride;
    const a = Math.min(Math.floor(s), kept.length - 1);
    const b = Math.min(a + 1, kept.length - 1);
    const t = s - a;
    const p = kept[a];
    const q = kept[b];
    out[i] = {
      x: p.x + (q.x - p.x) * t,
      y: p.y + (q.y - p.y) * t,
      z: p.z + (q.z - p.z) * t,
      heading: p.heading + (q.heading - p.heading) * t,
    };
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000; // stay under the String.fromCharCode arg cap
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
