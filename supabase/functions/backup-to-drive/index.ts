import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  try {
    const { data: alerts, error: alertErr } = await supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(500);
    if (alertErr) throw alertErr;
    const { data: tradingStates, error: tsErr } = await supabase.from('trading_states').select('*').limit(10);
    if (tsErr) throw tsErr;
    const backupData = { project: 'Gold Sniper', backupDate: now, stats: { alertCount: alerts?.length || 0, tradingStateCount: tradingStates?.length || 0 }, alerts, tradingStates };
    return new Response(JSON.stringify({ success: true, ...backupData }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Backup failed' }), { status: 500, headers });
  }
});
