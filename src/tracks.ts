// The playable tracks, shown on the home page. Add an entry per map you author
// (closed-loop maps in public/maps). Rename freely. Bump `version` whenever a
// map's shape changes so its leaderboard starts fresh (must match tracks.version
// in the DB); defaults to 1.
export type TrackDef = { name: string; url: string; version?: number };

export const TRACKS: TrackDef[] = [
  { name: 'Try Not To Drift', url: '/maps/track2.json' },
  { name: 'First Map', url: '/maps/firstreal.json' },
];

// The chosen track from the ?track= URL param (set by the home page), or null
// when absent/invalid - in which case main shows the home/landing page.
export function selectedTrack(): TrackDef | null {
  const param = new URLSearchParams(location.search).get('track');
  return TRACKS.find((t) => t.url === param) ?? null;
}
