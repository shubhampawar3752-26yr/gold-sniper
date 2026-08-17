const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWELVE_DATA_KEY = Deno.env.get('TWELVE_DATA_API_KEY')!;

async function fetchLivePrice() {
  try {
    const url = `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVE_DATA_KEY}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || data.status === 'error') return null;
    const price = parseFloat(data.price);
    if (isNaN(price) || price <= 0) return null;
    return { price, prevClose: 0, change: 0, changePct: 0, marketState: 'open', timestamp: Math.floor(Date.now() / 1000) };
  } catch (e) { return null; }
}

async function fetchQuote() {
  try {
    const url = `https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${TWELVE_DATA_KEY}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || data.status === 'error') return null;
    const price = parseFloat(data.close);
    const prevClose = parseFloat(data.previous_close);
    if (isNaN(price) || price <= 0) return null;
    const change = prevClose > 0 ? price - prevClose : 0;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    return { price, prevClose: prevClose || 0, change, changePct, marketState: data.is_market_open ? 'open' : 'closed', timestamp: Math.floor(Date.now() / 1000) };
  } catch (e) { return null; }
}

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  let live = await fetchQuote();
  if (!live) live = await fetchLivePrice();
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

  let tradeHistory: any[] = [];
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/alerts?select=id,type,timeframe,direction,entry,sl,price,tp_num,tp_price,progress,cycle,created_at&type=neq.test&order=created_at.desc&limit=20`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    tradeHistory = await r.json();
  } catch (e) { console.error('Error loading history:', (e as Error).message); }

  let stats: any = { totalEntries: 0, totalTPs: 0, totalSLs: 0, totalComplete: 0 };
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/alerts?select=type`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    const allAlerts = await r.json();
    stats.totalEntries = allAlerts.filter((a: any) => a.type === 'entry').length;
    stats.totalTPs = allAlerts.filter((a: any) => a.type === 'tp').length;
    stats.totalSLs = allAlerts.filter((a: any) => a.type === 'sl').length;
    stats.totalComplete = allAlerts.filter((a: any) => a.type === 'alldone').length;
  } catch (e) { console.error('Error loading stats:', (e as Error).message); }

  const TF_ORDER = ['1M', '5M', '15M', '30M', '1H', '4H'];
  const activeTrades: any[] = [];
  const allTimeframes: any[] = [];

  if (states) {
    for (const tf of TF_ORDER) {
      const s = states[tf];
      if (!s) {
        allTimeframes.push({ timeframe: tf, direction: null, status: 'waiting', entry: 0, sl: 0, cycle: 0, tpProgress: 0, tpHits: [false, false, false, false, false] });
        continue;
      }
      const tpHits = [s.tp1Hit, s.tp2Hit, s.tp3Hit, s.tp4Hit, s.tp5Hit];
      const tpCount = tpHits.filter(Boolean).length;
      let status = 'waiting';
      if (s.allDone) status = 'complete';
      else if (s.slHit) status = 'stopped';
      else if (s.entry > 0) status = 'active';

      allTimeframes.push({
        timeframe: tf,
        direction: s.dir || null,
        status,
        entry: s.entry || 0,
        sl: s.sl || 0,
        tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5,
        tp1Hit: s.tp1Hit, tp2Hit: s.tp2Hit, tp3Hit: s.tp3Hit, tp4Hit: s.tp4Hit, tp5Hit: s.tp5Hit,
        tpProgress: tpCount,
        tpHits,
        cycle: s.cycle || 0,
        atr: s.atr || 0,
      });

      if (s && s.entry > 0 && !s.slHit && !s.allDone) {
        activeTrades.push({ timeframe: tf, direction: s.dir, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5, tp1Hit: s.tp1Hit, tp2Hit: s.tp2Hit, tp3Hit: s.tp3Hit, tp4Hit: s.tp4Hit, tp5Hit: s.tp5Hit, cycle: s.cycle, atr: s.atr });
      }
    }
  }

  const active = allTimeframes.filter(t => t.status === 'active' || t.status === 'complete');
  const longCount = active.filter(t => t.direction === 'long').length;
  const shortCount = active.filter(t => t.direction === 'short').length;
  let overallSignal = 'neutral';
  if (longCount > shortCount) overallSignal = 'bullish';
  else if (shortCount > longCount) overallSignal = 'bearish';

  return new Response(JSON.stringify({
    success: true, timestamp: now, price: live.price, prevClose: live.prevClose, change: live.change, changePct: live.changePct,
    marketState: live.marketState, marketTime: live.timestamp, lastMonitorRun: lastRun, lastTick,
    activeTrades, activeCount: activeTrades.length,
    allTimeframes, overallSignal, longCount, shortCount,
    tradeHistory, stats,
  }), { status: 200, headers });
});
