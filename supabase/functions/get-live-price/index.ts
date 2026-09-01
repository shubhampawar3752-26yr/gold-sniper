const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWELVE_DATA_KEY = Deno.env.get('TWELVE_DATA_API_KEY')!;
const ALPHA_VANTAGE_KEY = Deno.env.get('ALPHA_VANTAGE_API_KEY')!;
const GOLDAPI_KEY = Deno.env.get('GOLDAPI_KEY') || '';

const SIO_BASE = 'https://www.livepriceofgold.com/sio/p7012/socket.io/';
const SIO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*' };

// ── Fetch prevClose from HTML (data-open attribute = today's open = yesterday's close) ──
async function fetchPrevClose(): Promise<number> {
  try {
    const r = await fetch('https://www.livepriceofgold.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
    });
    if (!r.ok) return 0;
    const html = await r.text();
    const openMatch = html.match(/data-open="([\d.]+)"/);
    return openMatch ? parseFloat(openMatch[1]) : 0;
  } catch { return 0; }
}

// ── PRIMARY: LivePriceOfGold.com Socket.IO (real-time, ~500ms updates) ──
async function fetchLivePriceOfGoldSIO(): Promise<{ price: number; prevClose: number; source: string }> {
  // Start prevClose fetch in parallel (runs while we handshake+poll SIO)
  const prevClosePromise = fetchPrevClose();

  // Step 1: Handshake
  const hsResp = await fetch(`${SIO_BASE}?EIO=4&transport=polling`, { headers: SIO_HEADERS });
  if (!hsResp.ok) throw new Error(`SIO handshake HTTP ${hsResp.status}`);
  const hsText = await hsResp.text();
  const sidMatch = hsText.match(/"sid":"([^"]+)"/);
  if (!sidMatch) throw new Error('SIO: no sid in handshake');
  const sid = sidMatch[1];

  // Step 2: Connect (POST 40)
  await fetch(`${SIO_BASE}?EIO=4&transport=polling&sid=${sid}`, {
    method: 'POST',
    headers: { ...SIO_HEADERS, 'Content-Type': 'text/plain;charset=UTF-8' },
    body: '40',
  });

  // Step 3: Poll for update events (up to 4 attempts)
  for (let i = 0; i < 4; i++) {
    const pollResp = await fetch(`${SIO_BASE}?EIO=4&transport=polling&sid=${sid}`, { headers: SIO_HEADERS });
    if (!pollResp.ok) { await new Promise(r => setTimeout(r, 300)); continue; }
    const raw = await pollResp.text();

    const xauMatch = raw.match(/XAUUSD[\\":\s]+([\d.]+)/);
    if (xauMatch) {
      const price = parseFloat(xauMatch[1]);
      if (!isNaN(price) && price > 0) {
        const prevClose = (await prevClosePromise) || 0;
        return { price, prevClose, source: 'livepriceofgold-sio' };
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('SIO: no XAUUSD update after 4 polls');
}

// ── FALLBACK 1: LivePriceOfGold.com HTML scrape (has price + prevClose) ──
async function fetchLivePriceOfGoldHTML(): Promise<{ price: number; prevClose: number; source: string }> {
  const r = await fetch('https://www.livepriceofgold.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
  });
  if (!r.ok) throw new Error(`livepriceofgold HTML HTTP ${r.status}`);
  const html = await r.text();
  const priceMatch = html.match(/data-price="XAUUSD"[^>]*>([^<]+)/);
  const openMatch = html.match(/data-open="([\d.]+)"/);
  if (!priceMatch) throw new Error('livepriceofgold HTML: price not found');
  const price = parseFloat(priceMatch[1].trim().replace(/,/g, ''));
  const prevClose = openMatch ? parseFloat(openMatch[1]) : 0;
  if (isNaN(price) || price <= 0) throw new Error('livepriceofgold HTML: invalid price');
  return { price, prevClose, source: 'livepriceofgold' };
}

// ── FALLBACK 2: TwelveData (price endpoint + parallel quote for prevClose) ──
async function fetchTwelveData(): Promise<{ price: number; prevClose: number; source: string }> {
  if (!TWELVE_DATA_KEY) throw new Error('twelvedata: no key');
  const [priceResp, quoteResp] = await Promise.all([
    fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVE_DATA_KEY}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
    fetch(`https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${TWELVE_DATA_KEY}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
  ]);
  if (!priceResp.ok) throw new Error(`twelvedata price HTTP ${priceResp.status}`);
  const priceData = await priceResp.json();
  if (!priceData || priceData.status === 'error') throw new Error(`twelvedata: ${priceData?.message || 'error'}`);
  const price = parseFloat(priceData.price);
  if (isNaN(price) || price <= 0) throw new Error('twelvedata: invalid price');
  let prevClose = 0;
  try {
    if (quoteResp.ok) {
      const quoteData = await quoteResp.json();
      prevClose = parseFloat(quoteData?.previous_close) || 0;
    }
  } catch { /* quote may fail on free tier, that's ok */ }
  return { price, prevClose, source: 'twelvedata' };
}

// ── FALLBACK 3: GoldAPI.io ──
async function fetchGoldAPI(): Promise<{ price: number; prevClose: number; source: string }> {
  if (!GOLDAPI_KEY) throw new Error('goldapi: no key');
  const r = await fetch('https://www.goldapi.io/api/XAU/USD', { headers: { 'x-access-token': GOLDAPI_KEY, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`goldapi HTTP ${r.status}`);
  const data = await r.json();
  const price = parseFloat(data?.price);
  if (isNaN(price) || price <= 0) throw new Error('goldapi: invalid price');
  return { price, prevClose: parseFloat(data?.prev_close_price) || parseFloat(data?.open_price) || 0, source: 'goldapi' };
}

// ── FALLBACK 4: Alpha Vantage ──
async function fetchAlphaVantage(): Promise<{ price: number; prevClose: number; source: string }> {
  if (!ALPHA_VANTAGE_KEY) throw new Error('alphavantage: no key');
  const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=XAUUSD&apikey=${ALPHA_VANTAGE_KEY}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`alphavantage HTTP ${r.status}`);
  const data = await r.json();
  const quote = data?.['Global Quote'] || {};
  const price = parseFloat(quote?.['05. price'] || '0');
  if (isNaN(price) || price <= 0) throw new Error('alphavantage: invalid price');
  return { price, prevClose: parseFloat(quote?.['08. previous close'] || '0'), source: 'alphavantage' };
}

// ── Price fetch: SIO first, then race fallbacks ──
async function fetchLivePrice() {
  try { return await fetchLivePriceOfGoldSIO(); }
  catch (e) { console.error('SIO failed:', (e as Error).message); }

  try {
    return await Promise.any([fetchLivePriceOfGoldHTML(), fetchTwelveData(), fetchGoldAPI(), fetchAlphaVantage()]);
  } catch {
    for (const fn of [fetchLivePriceOfGoldHTML, fetchTwelveData, fetchGoldAPI, fetchAlphaVantage]) {
      try { return await fn(); } catch { /* skip */ }
    }
    return null;
  }
}

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const t0 = Date.now();
  const live = await fetchLivePrice();
  const fetchMs = Date.now() - t0;
  if (!live) return new Response(JSON.stringify({ success: false, error: 'All price sources failed', timestamp: now }), { status: 503, headers });

  const change = live.prevClose > 0 ? live.price - live.prevClose : 0;
  const changePct = live.prevClose > 0 ? (change / live.prevClose) * 100 : 0;

  let states: any = null, lastRun: string | null = null, lastTick: any = null;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/trading_states?select=*&limit=1`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
    const data = await r.json();
    if (data && data.length > 0) { states = data[0].states || {}; lastRun = data[0].last_run || null; lastTick = states?.__ticks || null; }
  } catch (e) { console.error('State error:', (e as Error).message); }

  // Override prevClose from DB (updated daily by update-prev-close function)
  const dbPrevClose = states?.__prevClose?.value || 0;
  const effectivePrevClose = dbPrevClose || live.prevClose || 0;
  const finalChange = effectivePrevClose > 0 ? live.price - effectivePrevClose : change;
  const finalChangePct = effectivePrevClose > 0 ? (finalChange / effectivePrevClose) * 100 : changePct;

  let tradeHistory: any[] = [];
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/alerts?select=id,type,timeframe,direction,entry,sl,tp,price,tp_num,tp_price,progress,cycle,created_at&type=neq.test&order=created_at.desc&limit=20`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
    tradeHistory = await r.json();
  } catch (e) { console.error('History error:', (e as Error).message); }

  // Stats from trade_history (source of truth, not alerts)
  let stats: any = { totalEntries: 0, totalTPs: 0, totalSLs: 0, totalComplete: 0 };
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/trade_history?select=id,tp1_hit,tp2_hit,tp3_hit,exit_reason`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
    const trades = await r.json();
    stats.totalEntries = trades.length;
    stats.totalTPs = trades.filter((t: any) => t.tp1_hit || t.tp2_hit || t.tp3_hit).length;
    stats.totalSLs = trades.filter((t: any) => !t.tp1_hit && (t.exit_reason === 'sl_hit' || t.exit_reason === 'ema_flip')).length;
    stats.totalComplete = trades.filter((t: any) => t.exit_reason === 'all_tps_hit').length;
  } catch (e) { console.error('Stats error:', (e as Error).message); }

  const TF_ORDER = ['1M', '5M', '15M', '30M', '1H', '4H'];
  const activeTrades: any[] = [];
  const allTimeframes: any[] = [];

  if (states) {
    for (const tf of TF_ORDER) {
      const s = states[tf];
      if (!s) { allTimeframes.push({ timeframe: tf, direction: null, status: 'waiting', entry: 0, sl: 0, cycle: 0, tpProgress: 0, tpHits: [false, false, false] }); continue; }
      const tpHits = [s.tp1Hit, s.tp2Hit, s.tp3Hit];
      const tpCount = tpHits.filter(Boolean).length;
      let status = 'waiting';
      if (s.allDone) status = 'complete'; else if (s.slHit) status = "waiting"; else if (s.entry > 0) status = 'active';
      allTimeframes.push({ timeframe: tf, direction: s.dir || null, status, entry: s.entry || 0, sl: s.sl || 0, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp1Hit: s.tp1Hit, tp2Hit: s.tp2Hit, tp3Hit: s.tp3Hit, tpProgress: tpCount, tpHits, cycle: s.cycle || 0, atr: s.atr || 0 });
      if (s && s.entry > 0 && !s.slHit && !s.allDone) activeTrades.push({ timeframe: tf, direction: s.dir, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp1Hit: s.tp1Hit, tp2Hit: s.tp2Hit, tp3Hit: s.tp3Hit, cycle: s.cycle, atr: s.atr });
    }
  }

  const active = allTimeframes.filter(t => t.status === 'active' || t.status === 'complete');
  const longCount = active.filter(t => t.direction === 'long').length;
  const shortCount = active.filter(t => t.direction === 'short').length;
  let overallSignal = 'neutral';
  if (longCount > shortCount) overallSignal = 'bullish'; else if (shortCount > longCount) overallSignal = 'bearish';

  return new Response(JSON.stringify({
    success: true, timestamp: now, price: live.price, prevClose: effectivePrevClose || live.prevClose, prevCloseSource: states?.__prevClose?.source || '', prevCloseDate: states?.__prevClose?.date || '',
    dayOpen: states?.__prevClose?.open || 0, dayHigh: states?.__prevClose?.high || 0, dayLow: states?.__prevClose?.low || 0, dayClose: states?.__prevClose?.close || 0,
    change: finalChange, changePct: finalChangePct,
    marketState: 'open', marketTime: Math.floor(Date.now() / 1000), priceSource: live.source,
    fetchMs, lastMonitorRun: lastRun, lastTick, activeTrades, activeCount: activeTrades.length,
    allTimeframes, overallSignal, longCount, shortCount, tradeHistory, stats,
    // Market context from engine
    dxy: states?.__dxy || null,
    confluence: states?.__confluence || null,
    news: states?.__news || null,
    streaks: TF_ORDER.map(tf => {
      const s = states?.[tf] || {};
      return { tf, losses: s.__lossStreak || 0, pausedUntil: s.__streakPauseTime || null };
    }),
  }), { status: 200, headers });
  } catch (e) {
    console.error('Fatal:', (e as Error).message);
    return new Response(JSON.stringify({ success: false, error: (e as Error).message, price: 0, timestamp: new Date().toISOString() }), { status: 500, headers });
  }
});
