const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });

  try {
    const alertsRes = await fetch(`${SUPA_URL}/rest/v1/alerts?select=*&order=created_at.desc&limit=500`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    const alerts = await alertsRes.json();

    const tsRes = await fetch(`${SUPA_URL}/rest/v1/trading_states?select=*&limit=10`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    const tradingStates = await tsRes.json();

    return new Response(JSON.stringify({
      success: true,
      project: 'Gold Sniper',
      backupDate: now,
      stats: { alertCount: alerts?.length || 0, tradingStateCount: tradingStates?.length || 0 },
      alerts, tradingStates,
    }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message || 'Backup failed' }), { status: 500, headers });
  }
});
