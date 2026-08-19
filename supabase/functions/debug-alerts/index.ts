const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const tf = url.searchParams.get('tf') || '5M';
  const limit = url.searchParams.get('limit') || '20';
  const test = url.searchParams.get('test');

  if (test === 'insert') {
    // Try inserting a test alert with the 'reason' field like signal_flip does
    const r = await fetch(`${SUPA_URL}/rest/v1/alerts`, {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ type: 'sl', timeframe: 'TEST', sl: 1, entry: 1, direction: 'buy', cycle: 999, price: 1, sent: false, reason: 'signal_flip_test' })
    });
    const text = await r.text();
    return new Response(JSON.stringify({ status: r.status, ok: r.ok, body: text }), { headers: { 'Content-Type': 'application/json' } });
  }

  const r = await fetch(`${SUPA_URL}/rest/v1/alerts?timeframe=eq.${tf}&order=created_at.desc&limit=${limit}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  const data = await r.json();

  const r2 = await fetch(`${SUPA_URL}/rest/v1/trading_states?limit=1`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  const states = await r2.json();

  return new Response(JSON.stringify({ alerts: data, state5M: states?.[0]?.states?.[tf] || null }), { headers: { 'Content-Type': 'application/json' } });
});
