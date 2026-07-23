// Shared CORS headers. Origin is open because the leaderboard is public; tighten
// to the crazygames.com + localhost origins if you ever want to lock it down.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
