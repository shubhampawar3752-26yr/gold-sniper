import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    const body = await req.json();
    const { type, timeframe, direction, entry, sl, tp, cycle, price, tpNum, tpPrice, progress } = body;
    const validTypes = ['entry', 'tp', 'sl', 'alldone', 'test'];
    if (!validTypes.includes(type)) return new Response(JSON.stringify({ error: `Unknown alert type: ${type}` }), { status: 400, headers });
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await supabase.from('alerts').insert({
      type, timeframe: timeframe || null, direction: direction || null,
      entry: entry || null, sl: sl || null, tp: tp || null,
      cycle: cycle || null, price: price || null,
      tp_num: tpNum || null, tp_price: tpPrice || null, progress: progress || null, sent: false
    }).select().single();
    if (error) throw error;
    return new Response(JSON.stringify({ success: true, alertId: data.id, type, timeframe, timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false }) }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
