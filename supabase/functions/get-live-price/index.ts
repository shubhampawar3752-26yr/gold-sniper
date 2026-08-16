const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function fetchLivePrice(symbol = 'GC=F') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=5m`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    if (!r.ok) return null;
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta || {};
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPreviousClose || 0;
    if (typeof price !== 'number' || price <= 0) return null;
    const change = prevClose > 0 ? price - prevClose : 0;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    return { price, prevClose, change, changePct, marketState: meta.marketState || 'unknown', timestamp: meta.regularMarketTime || Math.floor(Date.now() / 1000) };
  } catch (e) { return null; }
}

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const live = await fetchLivePrice('GC=F');
  if (!live) return new Response(JSON.stringify({ success: false, error: 'Failed to fetch live price', timestamp: now }), { status: 503, headers });

  let states: any = null, lastRun: string | null = null, lastTick: any = null;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/trading_states?select=*&limit=1`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    const data = await r.json();
    if (data && data.length > 0) {
      states = data[0].states || {};
      lastRun = data[0].last_run || null;
      lastTick = states?.__ticks || null;
    }
  } catch (e) { console.error('Error loading state:', (e as Error).message); }

  const activeTrades: any[] = [];
  if (states) {
    for (const key of Object.keys(states)) {
      if (key === '__ticks') continue;
      const s = states[key];
      if (s && s.entry > 0 && !s.slHit && !s.allDone) {
        activeTrades.push({ timeframe: key, direction: s.dir, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5, tp1Hit: s.tp1Hit, tp2Hit: s.tp2Hit, tp3Hit: s.tp3Hit, tp4Hit: s.tp4Hit, tp5Hit: s.tp5Hit, cycle: s.cycle, atr: s.atr });
      }
    }
  }

  return new Response(JSON.stringify({ success: true, timestamp: now, price: live.price, prevClose: live.prevClose, change: live.change, changePct: live.changePct, marketState: live.marketState, marketTime: live.timestamp, lastMonitorRun: lastRun, lastTick, activeTrades, activeCount: activeTrades.length }), { status: 200, headers });
});
