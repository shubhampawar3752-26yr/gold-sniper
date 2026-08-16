const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  try {
    const body = await req.json();
    const { type, timeframe, direction, entry, sl, tp, cycle, price, tpNum, tpPrice, progress } = body;
    const validTypes = ['entry', 'tp', 'sl', 'alldone', 'test'];
    if (!validTypes.includes(type)) {
      return new Response(JSON.stringify({ error: `Unknown alert type: ${type}` }), { status: 400, headers });
    }

    const alertData = {
      type, timeframe: timeframe || null, direction: direction || null,
      entry: entry || null, sl: sl || null, tp: tp || null,
      cycle: cycle || null, price: price || null,
      tp_num: tpNum || null, tp_price: tpPrice || null, progress: progress || null, sent: false,
    };

    const r = await fetch(`${SUPA_URL}/rest/v1/alerts`, {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(alertData),
    });
    const data = await r.json();

    return new Response(JSON.stringify({
      success: true, alertId: data[0]?.id, type, timeframe,
      timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false }),
    }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message || 'Internal error' }), { status: 500, headers });
  }
});
