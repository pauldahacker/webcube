// Client identity seam. Basic Launch: a persistent guest id + a chosen name.
// Full Launch: call setCrazyGamesTokenProvider() once the SDK is up and every
// request switches to a verified Bearer token - nothing else changes.
const GUEST_KEY = 'webcube.guestId';
const NAME_KEY = 'webcube.playerName';

export function guestId(): string {
  let id = safeGet(GUEST_KEY);
  if (!id) { id = crypto.randomUUID(); safeSet(GUEST_KEY, id); }
  return id;
}

// Auto-assigns and persists a Guest-##### handle the first time, so everyone
// has a stable name on the leaderboard until they choose their own.
export function playerName(): string {
  let name = safeGet(NAME_KEY);
  if (!name) {
    name = `Guest-${Math.floor(10000 + Math.random() * 90000)}`;
    safeSet(NAME_KEY, name);
  }
  return name;
}

// Clearing the name drops the stored value so playerName() re-issues a Guest.
export function setPlayerName(name: string): void {
  const clean = name.trim().slice(0, 24);
  if (clean) safeSet(NAME_KEY, clean);
  else safeRemove(NAME_KEY);
}

// The opaque user_id this client's rows use, for reading back our own best.
// Guest mode only; null once a CrazyGames token is in play (the server derives
// the id from the token, so the client can't construct it).
export function currentUserId(): string | null {
  return tokenProvider ? null : 'guest:' + guestId();
}

// Full Launch hook: main() registers a getter for a fresh CrazyGames token.
let tokenProvider: (() => Promise<string | null>) | null = null;
export function setCrazyGamesTokenProvider(fn: () => Promise<string | null>): void {
  tokenProvider = fn;
}

// What the leaderboard client attaches to a write: a Bearer token when signed
// in via CrazyGames, otherwise the guest id + name in the body.
export async function authFields(): Promise<{
  headers: Record<string, string>;
  guestId?: string;
  displayName?: string;
}> {
  if (tokenProvider) {
    const token = await tokenProvider();
    if (token) return { headers: { authorization: 'Bearer ' + token } };
  }
  return { headers: {}, guestId: guestId(), displayName: playerName() };
}

function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function safeRemove(k: string): void { try { localStorage.removeItem(k); } catch { /* ignore */ } }
