// POST a display-name change. Upserts the caller's players row so every board
// reflects the new name at once. Body: { displayName, guestId? }. Identity via
// the shared seam (guest now, CrazyGames JWT later).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveIdentity } from '../_shared/identity.ts';
import { corsHeaders } from '../_shared/cors.ts';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const body = await req.json();
    const identity = await resolveIdentity(req, body);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error } = await supabase
      .from('players')
      .upsert(
        { user_id: identity.userId, display_name: identity.displayName, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) throw error;

    return json({ ok: true, name: identity.displayName });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
