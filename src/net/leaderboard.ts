// Client calls into the leaderboard. Reads go straight to PostgREST (public
// data, anon key); the score write goes through the submit-score edge function
// so it can validate and hold secrets. No-ops cleanly when env vars are unset.
import type { GhostRecording } from '../ghost';
import { encodeGhost, decodeGhost } from './ghostcodec';
import { authFields, currentUserId } from './identity';

const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Publishable key (legacy name: anon key). Public on purpose - RLS gates it.
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export type LeaderboardEntry = { userId: string; name: string; timeMs: number; verified: boolean };

export function leaderboardEnabled(): boolean {
  return !!(BASE && KEY);
}

// '/maps/track2.json' -> 'track2', matching the tracks table slug.
export function trackSlug(mapUrl: string): string {
  return mapUrl.split('/').pop()!.replace(/\.json$/, '');
}

export async function submitRun(
  mapUrl: string,
  trackVersion: number,
  timeMs: number,
  ghost: GhostRecording
): Promise<{ improved: boolean; bestMs: number } | null> {
  if (!leaderboardEnabled()) return null;
  const { b64, frameCount } = encodeGhost(ghost);
  const auth = await authFields();
  try {
    const res = await fetch(`${BASE}/functions/v1/submit-score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: KEY!, ...auth.headers },
      body: JSON.stringify({
        trackSlug: trackSlug(mapUrl), trackVersion, timeMs, ghost: b64, frameCount,
        guestId: auth.guestId, displayName: auth.displayName,
      }),
    });
    if (!res.ok) return null;
    const out = await res.json();
    return { improved: !!out.improved, bestMs: out.best_ms ?? timeMs };
  } catch {
    return null; // never let a failed upload interrupt play
  }
}

export async function fetchLeaderboard(mapUrl: string, trackVersion: number, limit = 20): Promise<LeaderboardEntry[]> {
  const q = new URLSearchParams({
    select: 'user_id,time_ms,verified,players(display_name)',
    track_slug: `eq.${trackSlug(mapUrl)}`,
    track_version: `eq.${trackVersion}`,
    order: 'time_ms.asc',
    limit: String(limit),
  });
  const rows = await restGet(`scores?${q}`);
  return rows.map((r) => ({ userId: r.user_id, name: playerNameOf(r), timeMs: r.time_ms, verified: r.verified }));
}

// The joined players row carries the name now; fall back defensively.
function playerNameOf(r: any): string {
  return r?.players?.display_name ?? 'Player';
}

// This player's own stored best on a track (time + ghost), to reconcile the
// local record with the server on load so a cleared/new-device localStorage
// can't let a slower lap masquerade as a PB. Guest mode only for now.
export async function fetchMyBest(
  mapUrl: string,
  trackVersion: number
): Promise<{ timeMs: number; ghost: GhostRecording } | null> {
  const userId = currentUserId();
  if (!leaderboardEnabled() || !userId) return null;
  const q = new URLSearchParams({
    select: 'time_ms,ghosts(blob)',
    track_slug: `eq.${trackSlug(mapUrl)}`,
    track_version: `eq.${trackVersion}`,
    user_id: `eq.${userId}`,
    limit: '1',
  });
  const r = (await restGet(`scores?${q}`))[0];
  if (!r) return null;
  return { timeMs: r.time_ms, ghost: r.ghosts?.blob ? decodeGhost(r.ghosts.blob) : { frames: [] } };
}

// This player's standing on a track for the home page: their rank (how many
// players are faster, + 1) out of the total field. `null` offline or empty.
export async function fetchMyStanding(
  mapUrl: string,
  trackVersion: number,
  timeMs: number
): Promise<{ rank: number; total: number } | null> {
  if (!leaderboardEnabled()) return null;
  const base = `${BASE}/rest/v1/scores`;
  const common = `track_slug=eq.${trackSlug(mapUrl)}&track_version=eq.${trackVersion}`;
  const auth = { apikey: KEY!, authorization: `Bearer ${KEY}` };
  // count=exact + limit=1: we only want the Content-Range total, not the rows.
  const count = { ...auth, Prefer: 'count=exact' };
  try {
    const t = Math.round(timeMs);
    const [totalRes, fasterRes] = await Promise.all([
      fetch(`${base}?select=user_id&${common}&limit=1`, { headers: count }),
      fetch(`${base}?select=user_id&${common}&time_ms=lt.${t}&limit=1`, { headers: count }),
    ]);
    if (!totalRes.ok || !fasterRes.ok) return null;
    const total = parseCount(totalRes.headers.get('content-range'));
    const faster = parseCount(fasterRes.headers.get('content-range'));
    if (total === null || faster === null) return null;
    return { rank: faster + 1, total };
  } catch {
    return null;
  }
}

// Push a display-name change to every board at once (via the set-name function).
export async function submitName(name: string): Promise<boolean> {
  if (!leaderboardEnabled()) return false;
  const auth = await authFields();
  try {
    const res = await fetch(`${BASE}/functions/v1/set-name`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: KEY!, ...auth.headers },
      body: JSON.stringify({ displayName: name, guestId: auth.guestId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// The rival to chase: the entry ranked one place above (the immediately-faster
// time), with their ghost ready to race.
export async function fetchRival(
  mapUrl: string,
  trackVersion: number,
  myTimeMs: number | null
): Promise<{ entry: LeaderboardEntry; ghost: GhostRecording } | null> {
  const q = new URLSearchParams({
    select: 'user_id,time_ms,verified,ghosts(blob),players(display_name)',
    track_slug: `eq.${trackSlug(mapUrl)}`,
    track_version: `eq.${trackVersion}`,
    order: 'time_ms.desc',
    limit: '1',
  });
  // With a time: the player just above (immediately faster). Without one (no PB
  // yet): the slowest player on the board, so a newcomer always has a target.
  // time_ms is an integer column, so round - PostgREST rejects a decimal (400).
  if (myTimeMs !== null) q.set('time_ms', `lt.${Math.round(myTimeMs)}`);
  const rows = await restGet(`scores?${q}`);
  const r = rows[0];
  const blob = r?.ghosts?.blob;
  if (!blob) return null;
  return {
    entry: { userId: r.user_id, name: playerNameOf(r), timeMs: r.time_ms, verified: r.verified },
    ghost: decodeGhost(blob),
  };
}

// rank/timeMs are null for the user's own row before they've set a time.
export type LeaderboardRow = { rank: number | null; name: string; timeMs: number | null; isUser: boolean };

// The board window shown in-game: the players ranked just above the user plus
// the user's own row (always present, even with no time yet - shown unranked
// with a blank time). Each carries its absolute rank.
export async function fetchLeaderboardAround(
  mapUrl: string,
  trackVersion: number,
  myTimeMs: number | null,
  myName: string
): Promise<LeaderboardRow[]> {
  if (!leaderboardEnabled()) return [];
  const base = `${BASE}/rest/v1/scores`;
  // Exclude our own server row: we inject the canonical own-row below, so a
  // stale copy (e.g. the just-beaten PB before its upsert lands) can't double up.
  const userId = currentUserId();
  const mine = userId ? `&user_id=neq.${userId}` : '';
  const common = `track_slug=eq.${trackSlug(mapUrl)}&track_version=eq.${trackVersion}${mine}`;
  const auth = { apikey: KEY!, authorization: `Bearer ${KEY}` };
  const select = 'time_ms,players(display_name)';
  try {
    if (myTimeMs === null) {
      // No time yet: everyone is above, so the top 9, then our own blank row.
      const res = await fetch(`${base}?select=${select}&${common}&order=time_ms.asc&limit=9`, { headers: auth });
      if (!res.ok) return [];
      const above = (await res.json()) as any[];
      const rows: LeaderboardRow[] = above.map((r, i) => ({ rank: i + 1, name: playerNameOf(r), timeMs: r.time_ms, isUser: false }));
      rows.push({ rank: null, name: myName, timeMs: null, isUser: true });
      return rows;
    }
    // Up to 9 other players, preferring those ranked above (faster). The count
    // of everyone faster (= our rank - 1) comes from the Content-Range header.
    const t = Math.round(myTimeMs);
    const WANT = 9;
    const aboveRes = await fetch(
      `${base}?select=${select}&${common}&time_ms=lt.${t}&order=time_ms.desc&limit=${WANT}`,
      { headers: { ...auth, Prefer: 'count=exact' } }
    );
    if (!aboveRes.ok) return [];
    const aboveRaw = (await aboveRes.json()) as any[];
    const totalAbove = parseCount(aboveRes.headers.get('content-range')) ?? aboveRaw.length;

    const rows: LeaderboardRow[] = aboveRaw
      .map((r, i) => ({ rank: totalAbove - i, name: playerNameOf(r), timeMs: r.time_ms, isUser: false }))
      .reverse();
    rows.push({ rank: totalAbove + 1, name: myName, timeMs: t, isUser: true });

    // Too few above to fill the window? Backfill with the players just below.
    const belowWant = WANT - aboveRaw.length;
    if (belowWant > 0) {
      const belowRes = await fetch(
        `${base}?select=${select}&${common}&time_ms=gt.${t}&order=time_ms.asc&limit=${belowWant}`,
        { headers: auth }
      );
      if (belowRes.ok) {
        const belowRaw = (await belowRes.json()) as any[];
        belowRaw.forEach((r, j) => {
          rows.push({ rank: totalAbove + 2 + j, name: playerNameOf(r), timeMs: r.time_ms, isUser: false });
        });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

// PostgREST returns "start-end/total"; we want the total after the slash.
function parseCount(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const n = Number(contentRange.split('/')[1]);
  return Number.isFinite(n) ? n : null;
}

async function restGet(path: string): Promise<any[]> {
  if (!leaderboardEnabled()) return [];
  try {
    const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: { apikey: KEY!, authorization: `Bearer ${KEY}` } });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}
