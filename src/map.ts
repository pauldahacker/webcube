export type FinishPoint = { x: number; z: number };

export type MapData = {
  layout: string[];
  start: { x: number; z: number; rotation: number };
  finish: FinishPoint[];
};

export type MapSystem = {
  data: MapData;
  isWall(x: number, z: number): boolean;
  isFinish(x: number, z: number): boolean;
};

const FINISH_RADIUS = 0.75;

export async function loadMap(url: string): Promise<MapData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load map at ${url}: ${response.status}`);
  }
  return (await response.json()) as MapData;
}

// Older map files store `finish` as a single `{x, z}` point rather than an array.
function normalizeFinishPoints(raw: unknown): FinishPoint[] {
  if (Array.isArray(raw)) return raw as FinishPoint[];
  return raw ? [raw as FinishPoint] : [];
}

function distanceToSegmentSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const abLenSq = abx * abx + abz * abz;
  const t = abLenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / abLenSq)) : 0;
  const dx = px - (ax + abx * t);
  const dz = pz - (az + abz * t);
  return dx * dx + dz * dz;
}

export function createMapSystem(map: MapData): MapSystem {
  const finishPoints = normalizeFinishPoints(map.finish);
  return {
    data: map,
    isWall(x: number, z: number): boolean {
      const row = map.layout[Math.floor(z)];
      if (!row) return true;
      return row[Math.floor(x)] === "1";
    },
    isFinish(x: number, z: number): boolean {
      const radiusSq = FINISH_RADIUS * FINISH_RADIUS;
      if (finishPoints.length === 1) {
        const dx = x - finishPoints[0].x;
        const dz = z - finishPoints[0].z;
        return dx * dx + dz * dz < radiusSq;
      }
      for (let i = 0; i < finishPoints.length - 1; i++) {
        const a = finishPoints[i];
        const b = finishPoints[i + 1];
        if (distanceToSegmentSq(x, z, a.x, a.z, b.x, b.z) < radiusSq) return true;
      }
      return false;
    },
  };
}
