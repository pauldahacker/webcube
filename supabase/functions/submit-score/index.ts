// POST a finished run. Validates it, keeps the player's best, stores the ghost.
// Body: { trackSlug, trackVersion, timeMs, frameCount, ghost(base64),
//         guestId?, displayName? }. Identity comes from the shared seam.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveIdentity } from '../_shared/identity.ts';
import { corsHeaders } from '../_shared/cors.ts';

const MIN_TIME_MS = 1_000; // a sub-second lap is impossible on these tracks
const MAX_TIME_MS = 60 * 60 * 1000;
const MAX_GHOST_BYTES = 512 * 1024;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const body = await req.json();
    const trackSlug = String(body.trackSlug ?? '');
    const trackVersion = Number(body.trackVersion ?? 1);
    const timeMs = Math.round(Number(body.timeMs));
    const frameCount = Math.round(Number(body.frameCount ?? 0));
    const ghost = String(body.ghost ?? '');

    if (!trackSlug) return json({ error: 'trackSlug required' }, 400);
    if (!Number.isFinite(timeMs) || timeMs < MIN_TIME_MS || timeMs > MAX_TIME_MS)
      return json({ error: 'implausible time' }, 400);
    // Decoded length is the real payload size; reject empty or oversized ghosts.
    const ghostBytes = ghost ? atob(ghost).length : 0;
    if (ghostBytes === 0 || ghostBytes > MAX_GHOST_BYTES) return json({ error: 'bad ghost' }, 400);

    const identity = await resolveIdentity(req, body);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Track must exist and be open for submissions.
    const { data: track, error: tErr } = await supabase
      .from('tracks').select('slug').eq('slug', trackSlug).eq('active', true).maybeSingle();
    if (tErr) return json({ error: 'track lookup failed', detail: tErr.message }, 500);
    if (!track) return json({ error: 'unknown track' }, 404);

    // Keep only genuine improvements.
    const { data: existing } = await supabase
      .from('scores').select('time_ms')
      .eq('track_slug', trackSlug).eq('track_version', trackVersion).eq('user_id', identity.userId)
      .maybeSingle();
    if (existing && existing.time_ms <= timeMs) return json({ improved: false, best_ms: existing.time_ms });

    // Player name row first - scores references it, and it's the single source
    // of the display name across every board.
    const { error: pErr } = await supabase
      .from('players')
      .upsert(
        { user_id: identity.userId, display_name: identity.displayName, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (pErr) throw pErr;

    // Ghost next - the score row points at it.
    const { data: g, error: gErr } = await supabase
      .from('ghosts')
      .upsert(
        { track_slug: trackSlug, track_version: trackVersion, user_id: identity.userId, blob: ghost, frame_count: frameCount },
        { onConflict: 'track_slug,track_version,user_id' }
      )
      .select('id').single();
    if (gErr) throw gErr;

    const { error: sErr } = await supabase
      .from('scores')
      .upsert(
        {
          track_slug: trackSlug, track_version: trackVersion, user_id: identity.userId,
          time_ms: timeMs, verified: identity.verified,
          ghost_id: g.id, updated_at: new Date().toISOString(),
        },
        { onConflict: 'track_slug,track_version,user_id' }
      );
    if (sErr) throw sErr;

    return json({ improved: true, best_ms: timeMs });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
