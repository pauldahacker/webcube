import type { BuiltTrack } from './track';

// A top-down (x/z) 2D fit of a track, shared by the menu preview and the in-game
// minimap so both draw the same shape. `to()` maps any world x/z into the same
// space, for live dots (player, ghosts).
export type TrackProjection = {
  w: number;
  h: number;
  pathD: string; // centerline
  ribbonD: string; // filled road, at true width
  to(x: number, z: number): { x: number; y: number };
};

export function projectTrack(track: BuiltTrack, maxW: number, maxH: number, pad = 8): TrackProjection {
  const s = track.samples;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of s) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const spanX = Math.max(maxX - minX, 1e-3);
  const spanZ = Math.max(maxZ - minZ, 1e-3);
  const scale = Math.min((maxW - 2 * pad) / spanX, (maxH - 2 * pad) / spanZ);
  const w = spanX * scale + 2 * pad;
  const h = spanZ * scale + 2 * pad;
  const to = (x: number, z: number) => ({ x: pad + (x - minX) * scale, y: pad + (z - minZ) * scale });

  let pathD = '';
  for (let i = 0; i < s.length; i++) {
    const p = to(s[i].x, s[i].z);
    pathD += (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
  }
  if (track.closedLoop) pathD += 'Z';

  // Road ribbon: one filled quad per segment between the two edges (center +/-
  // right * width/2, using right's xz so a banked road reads its true top-down
  // footprint). Separate quads paint over each other on overlaps/hairpins, so
  // there are no fill-rule holes, and a point within width/2 of the centerline
  // (i.e. the on-road player) always lands inside it.
  const segEnd = track.closedLoop ? s.length : s.length - 1;
  let ribbonD = '';
  for (let i = 0; i < segEnd; i++) {
    const a = s[i];
    const b = s[(i + 1) % s.length];
    const aL = to(a.x - a.right.x * a.width / 2, a.z - a.right.z * a.width / 2);
    const aR = to(a.x + a.right.x * a.width / 2, a.z + a.right.z * a.width / 2);
    const bL = to(b.x - b.right.x * b.width / 2, b.z - b.right.z * b.width / 2);
    const bR = to(b.x + b.right.x * b.width / 2, b.z + b.right.z * b.width / 2);
    ribbonD +=
      `M${aL.x.toFixed(1)} ${aL.y.toFixed(1)}L${aR.x.toFixed(1)} ${aR.y.toFixed(1)}` +
      `L${bR.x.toFixed(1)} ${bR.y.toFixed(1)}L${bL.x.toFixed(1)} ${bL.y.toFixed(1)}Z`;
  }

  return { w, h, pathD, ribbonD, to };
}
