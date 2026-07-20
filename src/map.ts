import { buildTrack, findNearestSampleIndex, sampleGroundHeight, sampleGrip } from './track';
import type { TrackPoint, BuiltTrack } from './track';

export type MapData = {
  track: TrackPoint[];
  closedLoop: boolean;
  start: { x: number; z: number; rotation: number };
};

// What the physics learns about the road at a position: which track sample
// is nearest, how high the surface is there, and how grippy it is.
export type TrackQuery = {
  index: number;
  groundHeight: number;
  grip: number;
};

export type MapSystem = {
  data: MapData;
  builtTrack: BuiltTrack;
  query(x: number, z: number): TrackQuery;
  isFinish(q: TrackQuery): boolean;
  reset(): void;
};

// Samples counted as "near an end" for point-to-point finish detection.
const NEAR_END_WINDOW = 5;
// Closed loops are split into this many ordered sectors for lap validation:
// the player must enter each in forward order, so reverse/partial laps don't
// count. More sectors = stricter.
const LAP_SECTORS = 4;

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
  // Ordered-checkpoint lap state: the next sector the player must enter, and
  // the sector they were in last frame (to check the finish crossing is
  // forward). Both reset per lap.
  let nextCheckpoint = 1;
  let prevSector = 0;

  function query(x: number, z: number): TrackQuery {
    const index = findNearestSampleIndex(builtTrack, x, z, hintIndex);
    hintIndex = index;
    return {
      index,
      groundHeight: sampleGroundHeight(builtTrack, index, x, z),
      grip: sampleGrip(builtTrack, index),
    };
  }

  function isFinish(q: TrackQuery): boolean {
    if (!map.closedLoop) {
      return q.index >= lastIndex - NEAR_END_WINDOW;
    }
    // Closed loop: split into ordered sectors. Advance a checkpoint only when
    // the player enters exactly the next sector (forward order), and complete
    // the lap only when every sector was passed AND the start/finish seam is
    // crossed forward (from the last sector into sector 0). A reverse lap hits
    // the sectors out of order and crosses the seam backward, so it never counts.
    const sector = Math.floor((q.index / builtTrack.samples.length) * LAP_SECTORS);
    if (sector === nextCheckpoint) nextCheckpoint++;
    const finished = nextCheckpoint >= LAP_SECTORS && prevSector === LAP_SECTORS - 1 && sector === 0;
    prevSector = sector;
    if (finished) {
      nextCheckpoint = 1; // re-arm for the next lap
      return true;
    }
    return false;
  }

  function reset() {
    hintIndex = 0;
    nextCheckpoint = 1;
    prevSector = 0;
  }

  return { data: map, builtTrack, query, isFinish, reset };
}
