export type MapData = {
  layout: string[];
  start: { x: number; z: number; rotation: number };
  finish: { x: number; z: number };
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

export function createMapSystem(map: MapData): MapSystem {
  return {
    data: map,
    isWall(x: number, z: number): boolean {
      const row = map.layout[Math.floor(z)];
      if (!row) return true;
      return row[Math.floor(x)] === "1";
    },
    isFinish(x: number, z: number): boolean {
      const dx = x - map.finish.x;
      const dz = z - map.finish.z;
      return dx * dx + dz * dz < FINISH_RADIUS * FINISH_RADIUS;
    },
  };
}
