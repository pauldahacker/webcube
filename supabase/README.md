# Leaderboard backend

Own leaderboard + ghost store. Needed regardless of CrazyGames launch tier
because CrazyGames' `data` module can't serve another player's ghost, and its
native leaderboard isn't available in Basic Launch. Identity is a pluggable
seam: guest id now, CrazyGames JWT at Full Launch, with no table changes.

## Layout

- `migrations/0001_leaderboard.sql` — `tracks` (thin registry), `scores` (one
  best per player), `ghosts` (base64 replay blob). RLS = public read, no client
  writes.
- `migrations/0002_players.sql` — normalizes names into a `players` table
  (one row per user), referenced by `scores`; a rename updates one row and every
  board reflects it. Drops the denormalized `scores.display_name`.
- `functions/submit-score/` — the score write path: validates, keeps the best,
  upserts the player name + ghost + score. Service role (secret).
- `functions/set-name/` — the rename write path: upserts the caller's
  `players` row so a name change propagates to every board immediately.
- `functions/_shared/identity.ts` — the seam. Bearer token → verified
  CrazyGames userId (`cg:*`); otherwise the body's guest id (`guest:*`).

## Deploy (first time)

Prereqs: create a project at supabase.com, then install the CLI
(`brew install supabase/tap/supabase`, or `npx supabase <cmd>`).

```bash
supabase login                              # authorize the CLI (browser)
supabase link --project-ref YOUR_PROJECT_REF # project ref = the xxxx in xxxx.supabase.co
supabase db push                            # applies both migrations
supabase functions deploy submit-score --no-verify-jwt
supabase functions deploy set-name --no-verify-jwt
```

Applying by SQL editor instead of the CLI? Run `0002_players.sql` and then
**redeploy `submit-score`** (it no longer writes `scores.display_name`, which
`0002` drops) and deploy `set-name`. Order: migration first, then the functions.

`--no-verify-jwt` is required: this function runs its OWN identity check (guest
id now, a CrazyGames-signed JWT at Full Launch). Supabase's gateway can't verify
a CrazyGames token, so the platform JWT gate must be off and the check left to
`_shared/identity.ts`.

The function receives `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the
platform automatically — no secrets to set for Basic Launch.

## Client env

Copy `.env.example` to `.env.local` and fill both from the dashboard
(Project Settings -> API Keys):

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # legacy projects: the "anon key"
```

Vite inlines these at build time, so the deployed game knows which Supabase
project to call. No value here is secret; the publishable key is RLS-gated.

## Full Launch swap

1. Add the CrazyGames SDK, then in the client:
   `setCrazyGamesTokenProvider(() => sdk.user.getUserToken())`.
2. That's it — the function already verifies the token against
   `https://sdk.crazygames.com/publicKey.json` and keys scores on `cg:<userId>`.
3. Optional: migrate a device's `guest:<uuid>` rows to the linked `cg:<userId>`.

## Wiring into the game (not done yet)

- On lap finish, when a new personal best is set: `submitRun(mapUrl, version, timeMs, ghost)`.
- To race the rival above you: `fetchRival(mapUrl, version, myBestMs)` → feed
  `.ghost` to `createGhost().show()`.
- `fetchLeaderboard(mapUrl, version)` for a board UI.

`version` is the track's geometry version — bump `tracks.version` (and the
number you pass here) whenever a map's shape changes so old times don't mix.
