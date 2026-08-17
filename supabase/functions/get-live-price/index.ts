const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWELVE_DATA_KEY = Deno.env.get('TWELVE_DATA_API_KEY')!;
const ALPHA_VANTAGE_KEY = Deno.env.get('ALPHA_VANTAGE_API_KEY')!;
const GOLDAPI_KEY = Deno.env.get('GOLDAPI_KEY') || '';

// ── Source 1: LivePriceOfGold.com (HTML scrape, free, no key) ──
async function fetchLivePriceOfGold(): Promise<{ price: number; prevClose: number; source: string }> {
  const r = await fetch('https://www.livepriceofgold.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
  });
  if (!r.ok) throw new Error(`livepriceofgold HTTP ${r.status}`);
  const html = await r.text();
  const priceMatch = html.match(/data-price="XAUUSD"[^>]*>([^<]+)/);
  const openMatch = html.match(/data-open="([\d.]+)"/);
  if (!priceMatch) throw new Error('livepriceofgold: price not found in HTML');
  const price = parseFloat(priceMatch[1].trim().replace(/,/g, ''));
  const prevClose = openMatch ? parseFloat(openMatch[1]) : 0;
  if (isNaN(price) || price <= 0) throw new Error('livepriceofgold: invalid price');
  return { price, prevClose, source: 'livepriceofgold' };
}

// ── Source 2: TwelveData (XAU/USD price endpoint) ──
async function fetchTwelveData(): Promise<{ price: number; prevClose: number; source: string }> {
  if (!TWELVE_DATA_KEY) throw new Error('twelvedata: no key');
  const url = `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVE_DATA_KEY}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`twelvedata HTTP ${r.status}`);
  const data = await r.json();
  if (!data || data.status === 'error') throw new Error(`twelvedata: ${data?.message || 'error'}`);
  const price = parseFloat(data.price);
  if (isNaN(price) || price <= 0) throw new Error('twelvedata: invalid price');
  return { price, prevClose: 0, source: 'twelvedata' };
}

// ── Source 3: GoldAPI.io (XAU) ──
async function fetchGoldAPI(): Promise<{ price: number; prevClose: number; source: string }> {
  if (!GOLDAPI_KEY) throw new Error('goldapi: no key');
  const r = await fetch('https://www.goldapi.io/api/XAU/USD', {
    headers: { 'x-access-token': GOLDAPI_KEY, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!r.ok) throw new Error(`goldapi HTTP ${r.status}`);
  const data = await r.json();
  const price = parseFloat(data?.price);
  const prevClose = parseFloat(data?.prev_close_price) || parseFloat(data?.open_price) || 0;
  if (isNaN(price) || price <= 0) throw new Error('goldapi: invalid price');
  return { price, prevClose, source: 'goldapi' };
}

// ── Source 4: Alpha Vantage (GC=F global quote) ──
async function fetchAlphaVantage(): Promise<{ price: number; prevClose: number; source: string }> {
  if (!ALPHA_VANTAGE_KEY) throw new Error('alphavantage: no key');
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=GC=F&apikey=${ALPHA_VANTAGE_KEY}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`alphavantage HTTP ${r.status}`);
  const data = await r.json();
  const quote = data?.['Global Quote'] || {};
  const price = parseFloat(quote?.['05. price'] || '0');
  const prevClose = parseFloat(quote?.['08. previous close'] || '0');
  if (isNaN(price) || price <= 0) throw new Error('alphavantage: invalid price');
  return { price, prevClose, source: 'alphavantage' };
}

// ── Race all sources: fastest valid result wins (throw on failure so Promise.any skips them) ──
async function fetchLivePrice() {
  try {
    const winner = await Promise.any([
      fetchLivePriceOfGold(),
      fetchTwelveData(),
      fetchGoldAPI(),
      fetchAlphaVantage(),
    ]);
    return winner;
  } catch {
    // All rejected — try sequentially as last resort
    for (const fn of [fetchLivePriceOfGold, fetchTwelveData, fetchGoldAPI, fetchAlphaVantage]) {
      try {
        return await fn();
      } catch { /* skip */ }
    }
    return null;
  }
}

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const live = await fetchLivePrice();
  if (!live) return new Response(JSON.stringify({ success: false, error: 'All price sources failed', timestamp: now }), { status: 503, headers });

  const change = live.prevClose > 0 ? live.price - live.prevClose : 0;
  const changePct = live.prevClose > 0 ? (change / live.prevClose) * 100 : 0;

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
        timeframe: tf, direction: s.dir || null, status,
        entry: s.entry || 0, sl: s.sl || 0,
        tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5,
        tp1Hit: s.tp1Hit, tp2Hit: s.tp2Hit, tp3Hit: s.tp3Hit, tp4Hit: s.tp4Hit, tp5Hit: s.tp5Hit,
        tpProgress: tpCount, tpHits, cycle: s.cycle || 0, atr: s.atr || 0,
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
    success: true, timestamp: now, price: live.price, prevClose: live.prevClose, change, changePct,
    marketState: 'open', marketTime: Math.floor(Date.now() / 1000), priceSource: live.source,
    lastMonitorRun: lastRun, lastTick,
    activeTrades, activeCount: activeTrades.length,
    allTimeframes, overallSignal, longCount, shortCount,
    tradeHistory, stats,
  }), { status: 200, headers });
});
