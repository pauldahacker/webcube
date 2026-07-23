// The identity seam. Basic Launch trusts a client guest id; Full Launch verifies
// a CrazyGames JWT. Both return the same shape, so nothing downstream changes -
// only which branch runs. Drop-in: the game just starts sending a Bearer token.
import { importSPKI, jwtVerify } from 'https://deno.land/x/jose@v5.9.6/index.ts';

export type Identity = { userId: string; displayName: string; verified: boolean };

// CrazyGames publishes the RSA key that signs user tokens here; refetch
// periodically to survive key rotation (their recommendation).
const CG_PUBLIC_KEY_URL = 'https://sdk.crazygames.com/publicKey.json';
let cgKey: CryptoKey | null = null;
let cgKeyAt = 0;

async function crazyGamesKey(): Promise<CryptoKey> {
  if (cgKey && Date.now() - cgKeyAt < 3_600_000) return cgKey;
  const res = await fetch(CG_PUBLIC_KEY_URL);
  const data = await res.json();
  const pem = typeof data === 'string' ? data : data.publicKey ?? data.key;
  cgKey = await importSPKI(pem, 'RS256');
  cgKeyAt = Date.now();
  return cgKey;
}

const GUEST_RE = /^[A-Za-z0-9_-]{8,64}$/;
const cleanName = (n: unknown) => (String(n ?? '').trim().slice(0, 24) || 'Player');

// Full Launch path: verified CrazyGames token wins when present.
// Basic Launch path: fall back to the guest id carried in the body.
export async function resolveIdentity(
  req: Request,
  body: { guestId?: string; displayName?: string }
): Promise<Identity> {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const { payload } = await jwtVerify(auth.slice(7), await crazyGamesKey());
    return { userId: 'cg:' + String(payload.userId), displayName: cleanName(payload.username), verified: true };
  }
  const guestId = body.guestId ?? '';
  if (!GUEST_RE.test(guestId)) throw new Error('missing or invalid guestId');
  return { userId: 'guest:' + guestId, displayName: cleanName(body.displayName), verified: false };
}
