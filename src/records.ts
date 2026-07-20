import type { GhostRecording } from './ghost';

// Per-map personal record (best time + the ghost to race against), persisted
// in localStorage so it survives reloads. Every access is wrapped: storage can
// be unavailable (private mode), full, or hold stale/corrupt JSON - none of
// which should crash the game. Keyed per map and versioned so the format can
// change later (e.g. moving from position frames to an input stream).
const VERSION = 1;

export type SavedRecord = { timeMs: number; ghost: GhostRecording };

function storageKey(mapUrl: string): string {
  return `webcube.record.v${VERSION}.${mapUrl}`;
}

export function loadRecord(mapUrl: string): SavedRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(mapUrl));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedRecord;
    if (typeof parsed.timeMs !== 'number' || !parsed.ghost?.frames?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRecord(mapUrl: string, record: SavedRecord): void {
  try {
    localStorage.setItem(storageKey(mapUrl), JSON.stringify(record));
  } catch {
    // Storage full or unavailable - a lost record is not worth crashing over.
  }
}
