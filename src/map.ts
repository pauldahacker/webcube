import { buildTrack, findNearestSampleIndex, isOffTrack, sampleGroundHeight, sampleGrip } from './track';
import type { TrackPoint, BuiltTrack } from './track';

export type MapData = {
  track: TrackPoint[];
  closedLoop: boolean;
  start: { x: number; z: number; rotation: number };
};

export type TrackQuery = {
  index: number;
  offTrack: boolean;
  groundHeight: number;
  grip: number;
  arcLength: number;
};

export type MapSystem = {
  data: MapData;
  builtTrack: BuiltTrack;
  query(x: number, z: number): TrackQuery;
  isFinish(q: TrackQuery): boolean;
  reset(): void;
};

// Samples counted as "near an end" for point-to-point finish detection and
// closed-loop wrap (lap-complete) detection.
const NEAR_END_WINDOW = 5;

export async function loadMap(url: string): Promise<MapData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load map at ${url}: ${response.status}`);
  }
  return (await response.json()) as MapData;
}

export function createMapSystem(map: MapData): MapSystem {
  const builtTrack = buildTrack(map.track, map.closedLoop);
  const lastIndex = builtTrack.samples.length - 1;

  // Nearest-sample search hint, and closed-loop lap state - both persist
  // across frames since a player moves mostly forward along the track.
  let hintIndex = 0;
  let hasLeftStart = false;
  let prevIndex = 0;

  function query(x: number, z: number): TrackQuery {
    const index = findNearestSampleIndex(builtTrack, x, z, hintIndex);
    hintIndex = index;
    return {
      index,
      offTrack: isOffTrack(builtTrack, index, x, z),
      groundHeight: sampleGroundHeight(builtTrack, index, x, z),
      grip: sampleGrip(builtTrack, index),
      arcLength: builtTrack.samples[index].arcLength,
    };
  }

  function isFinish(q: TrackQuery): boolean {
    if (!map.closedLoop) {
      return q.index >= lastIndex - NEAR_END_WINDOW;
    }
    // Closed loop: only counts once the player has genuinely left the start
    // area (so it doesn't trigger at the starting line before a lap begins),
    // then fires the instant the nearest index wraps from the tail back to
    // the head of the sample array.
    if (!hasLeftStart) {
      if (q.index > NEAR_END_WINDOW && q.index < lastIndex - NEAR_END_WINDOW) hasLeftStart = true;
      prevIndex = q.index;
      return false;
    }
    const wrapped = prevIndex > lastIndex - NEAR_END_WINDOW && q.index < NEAR_END_WINDOW;
    prevIndex = q.index;
    return wrapped;
  }

  function reset() {
    hintIndex = 0;
    hasLeftStart = false;
    prevIndex = 0;
  }

  return { data: map, builtTrack, query, isFinish, reset };
}
