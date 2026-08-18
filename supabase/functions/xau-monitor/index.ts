// ── Gold Sniper Monitor — TradingView Scanner Edition v2 ──
// Indicators from TradingView's scanner API (EMA9, EMA21, ATR per timeframe)
// Crossover detection via stored previous EMA values
// Initial setup: when prevEma is null, set up trade based on current EMA position

const ATR_SL_MULT = 2, RR = [1, 2, 3, 5, 8];
const TFS = [
  { l: '1M', tv: '1' },
  { l: '5M', tv: '5' },
  { l: '15M', tv: '15' },
  { l: '30M', tv: '30' },
  { l: '1H', tv: '60' },
  { l: '4H', tv: '240' },
];
const TICKS = 3, TICK_MS = 10000;

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TV_SYMBOL = 'OANDA:XAUUSD';
const TV_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Origin': 'https://www.tradingview.com' };

function hit(p: number, t: number, d: string) { return d === 'long' ? p >= t : p <= t; }
function slHit(p: number, s: number, d: string) { return d === 'long' ? p <= s : p >= s; }

function setLevels(s: any, a: number) {
  const r = a * ATR_SL_MULT;
  s.sl = s.dir === 'long' ? s.entry - r : s.entry + r;
  [1, 2, 3, 5, 8].forEach((v, i) => { s['tp' + (i + 1)] = s.dir === 'long' ? s.entry + r * v : s.entry - r * v; });
}

function ns() {
  return { entry: 0, sl: 0, tp1: 0, tp2: 0, tp3: 0, tp4: 0, tp5: 0, atr: 0, dir: 'long',
    tp1Hit: false, tp2Hit: false, tp3Hit: false, tp4Hit: false, tp5Hit: false,
    slHit: false, allDone: false, cycle: 0, lastSignal: null,
    prevEma9: null, prevEma21: null };
}

function chkTick(px: number, s: any, l: string, prev: any, al: any[]) {
  if (s.allDone || s.slHit || s.entry === 0) return;
  if (slHit(px, s.sl, s.dir)) {
    if (!prev.slHit) al.push({ type: 'sl', timeframe: l, sl: s.sl, entry: s.entry, price: px, sent: false });
    s.slHit = true; return;
  }
  if (!s.tp1Hit && hit(px, s.tp1, s.dir)) { s.tp1Hit = true; if (!prev.tp1) al.push({ type: 'tp', timeframe: l, tp_num: 1, tp_price: s.tp1, price: px, progress: 1, sent: false }); }
  if (s.tp1Hit && !s.tp2Hit && hit(px, s.tp2, s.dir)) { s.tp2Hit = true; if (!prev.tp2) al.push({ type: 'tp', timeframe: l, tp_num: 2, tp_price: s.tp2, price: px, progress: 2, sent: false }); }
  if (s.tp2Hit && !s.tp3Hit && hit(px, s.tp3, s.dir)) { s.tp3Hit = true; if (!prev.tp3) al.push({ type: 'tp', timeframe: l, tp_num: 3, tp_price: s.tp3, price: px, progress: 3, sent: false }); }
  if (s.tp3Hit && !s.tp4Hit && hit(px, s.tp4, s.dir)) { s.tp4Hit = true; if (!prev.tp4) al.push({ type: 'tp', timeframe: l, tp_num: 4, tp_price: s.tp4, price: px, progress: 4, sent: false }); }
  if (s.tp4Hit && !s.tp5Hit && hit(px, s.tp5, s.dir)) { s.tp5Hit = true; if (!prev.tp5) al.push({ type: 'tp', timeframe: l, tp_num: 5, tp_price: s.tp5, price: px, progress: 5, sent: false }); }
  if (s.tp1Hit && s.tp2Hit && s.tp3Hit && s.tp4Hit && s.tp5Hit) {
    if (!prev.allDone) { s.allDone = true; al.push({ type: 'alldone', timeframe: l, entry: s.entry, cycle: s.cycle, price: px, sent: false }); }
  }
}

async function fetchTVIndicators(): Promise<Record<string, any>> {
  const fields: string[] = [];
  for (const tf of TFS) {
    fields.push(`EMA9|${tf.tv}`, `EMA21|${tf.tv}`, `ATR|${tf.tv}`, `close|${tf.tv}`,
      `RSI|${tf.tv}`, `MACD.macd|${tf.tv}`, `MACD.signal|${tf.tv}`, `Recommend.All|${tf.tv}`);
  }
  fields.push('EMA9', 'EMA21', 'ATR', 'RSI', 'close', 'MACD.macd', 'MACD.signal', 'Recommend.All',
    'open', 'high', 'low', 'change', 'change_abs');
  const url = `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(TV_SYMBOL)}&fields=${fields.join(',')}`;
  const resp = await fetch(url, { headers: TV_HEADERS });
  if (!resp.ok) throw new Error(`TV scanner HTTP ${resp.status}`);
  return await resp.json();
}

async function yahooLivePx(): Promise<number | null> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1m`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
  } catch { return null; }
}

async function supaSelect(table: string, limit = 1) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}?select=*&limit=${limit}`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  return await r.json();
}
async function supaInsert(table: string, data: any) {
  await fetch(`${SUPA_URL}/rest/v1/${table}`, { method: 'POST', headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(data) });
}
async function supaUpdate(table: string, data: any, id: number) {
  await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, { method: 'PATCH', headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(data) });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req) => {
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  let sid: number | null = null;
  let states: any = {};
  let prev: any = {};

  try {
    const rows = await supaSelect('trading_states', 1);
    if (rows && rows.length > 0) { sid = rows[0].id; states = rows[0].states || {}; prev = rows[0].prev_hits || {}; }
  } catch (e) { console.error('State load:', (e as Error).message); }

  const alerts: any[] = [], tl: any[] = [];
  let tvData: Record<string, any> = {};
  let livePrice: number | null = null;

  try {
    tvData = await fetchTVIndicators();
    livePrice = tvData['close'] || tvData['close|1'] || null;
    console.log(`TV: price=${livePrice}, EMA9|5=${tvData['EMA9|5']}, EMA21|5=${tvData['EMA21|5']}`);
  } catch (e) {
    console.error('TV scanner failed:', (e as Error).message);
    livePrice = await yahooLivePx();
  }

  for (const tf of TFS) {
    const l = tf.l;
    if (!states[l]) states[l] = ns();
    if (!prev[l]) prev[l] = {};
    const s = states[l];
    
    const ema9 = tvData[`EMA9|${tf.tv}`];
    const ema21 = tvData[`EMA21|${tf.tv}`];
    const atr = tvData[`ATR|${tf.tv}`];
    const tfPrice = tvData[`close|${tf.tv}`] || livePrice;
    
    if (ema9 == null || ema21 == null || atr == null) {
      console.error(`TV ${l}: missing indicators`);
      continue;
    }

    const done = s.slHit || s.allDone || s.entry === 0;

    // ── First run (prevEma is null): set up initial trade based on current EMA position ──
    if (done && s.prevEma9 == null && s.prevEma21 == null) {
      const signal = ema9 > ema21 ? 'buy' : 'sell';
      s.dir = signal === 'buy' ? 'long' : 'short';
      s.cycle = 1;
      s.entry = tfPrice || livePrice || 0;
      s.atr = atr;
      s.lastSignal = signal;
      s.tp1Hit = s.tp2Hit = s.tp3Hit = s.tp4Hit = s.tp5Hit = false;
      s.slHit = s.allDone = false;
      setLevels(s, atr);
      alerts.push({
        type: 'entry', timeframe: l, direction: signal,
        entry: s.entry, sl: s.sl,
        tp: { tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5 },
        cycle: s.cycle, price: tfPrice, sent: false,
        atr: atr, rsi: tvData[`RSI|${tf.tv}`],
      });
      console.log(`🟡 ${l} initial ${signal.toUpperCase()} setup | entry=${s.entry} SL=${s.sl} ATR=${atr}`);
    }
    // ── Subsequent runs: detect crossover by comparing current vs previous EMA ──
    else if (done && s.prevEma9 != null && s.prevEma21 != null) {
      const prevEma9 = s.prevEma9, prevEma21 = s.prevEma21;
      const crossUp = prevEma9 <= prevEma21 && ema9 > ema21;
      const crossDn = prevEma9 >= prevEma21 && ema9 < ema21;
      
      if ((crossUp || crossDn) && s.lastSignal !== (crossUp ? 'buy' : 'sell')) {
        s.dir = crossUp ? 'long' : 'short';
        s.cycle++;
        s.entry = tfPrice || livePrice || 0;
        s.atr = atr;
        s.tp1Hit = s.tp2Hit = s.tp3Hit = s.tp4Hit = s.tp5Hit = false;
        s.slHit = s.allDone = false;
        s.lastSignal = crossUp ? 'buy' : 'sell';
        setLevels(s, atr);
        alerts.push({
          type: 'entry', timeframe: l, direction: s.lastSignal,
          entry: s.entry, sl: s.sl,
          tp: { tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5 },
          cycle: s.cycle, price: tfPrice, sent: false,
          atr: atr, rsi: tvData[`RSI|${tf.tv}`],
        });
        console.log(`🟢 ${l} ${s.lastSignal.toUpperCase()} crossover | entry=${s.entry} SL=${s.sl} ATR=${atr}`);
      }
    }
    
    // Store current EMA for next run
    s.prevEma9 = ema9;
    s.prevEma21 = ema21;
    
    // Check TP/SL hits
    if (tfPrice && s.entry > 0) chkTick(tfPrice, s, l, prev[l] || {}, alerts);
  }

  // Live ticks
  for (let t = 0; t < TICKS; t++) {
    if (t > 0) await sleep(TICK_MS);
    const px = await yahooLivePx();
    if (px == null) continue;
    const tt = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
    tl.push({ time: tt, price: px, tick: t + 1 });
    for (const tf of TFS) {
      const l = tf.l, s = states[l];
      if (!s || s.entry === 0 || s.allDone || s.slHit) continue;
      chkTick(px, s, l, prev[l] || {}, alerts);
    }
  }

  for (const tf of TFS) {
    const l = tf.l, s = states[l];
    if (s) prev[l] = { tp1: s.tp1Hit, tp2: s.tp2Hit, tp3: s.tp3Hit, tp4: s.tp4Hit, tp5: s.tp5Hit, slHit: s.slHit, allDone: s.allDone };
  }

  const lt = tl.length > 0 ? tl[tl.length - 1] : null;
  states.__ticks = { lastPrice: lt?.price || livePrice || 0, lastTime: lt?.time || now, tickCount: tl.length, ticks: tl, updated: now };

  for (const a of alerts) {
    try { await supaInsert('alerts', a); } catch (e) { console.error('Alert insert:', (e as Error).message); }
  }

  try {
    if (sid != null) await supaUpdate('trading_states', { states, last_run: now }, sid);
    else await supaInsert('trading_states', { states, last_run: now });
  } catch (e) { console.error('State save:', (e as Error).message); }

  return new Response(JSON.stringify({
    success: true, timestamp: now,
    price: livePrice, source: 'tradingview-scanner',
    alerts: alerts.length,
    alertDetails: alerts.map(a => ({ type: a.type, tf: a.timeframe, dir: a.direction, entry: a.entry, sl: a.sl })),
    timeframes: TFS.map(tf => {
      const l = tf.l, s = states[l];
      const e9 = tvData[`EMA9|${tf.tv}`], e21 = tvData[`EMA21|${tf.tv}`];
      return {
        tf: l, ema9: e9, ema21: e21,
        signal: e9 > e21 ? 'buy' : 'sell',
        atr: tvData[`ATR|${tf.tv}`], rsi: tvData[`RSI|${tf.tv}`],
        macd: tvData[`MACD.macd|${tf.tv}`], recommend: tvData[`Recommend.All|${tf.tv}`],
        entry: s.entry, sl: s.sl, cycle: s.cycle, dir: s.dir,
        slHit: s.slHit, allDone: s.allDone,
        tpHits: [s.tp1Hit, s.tp2Hit, s.tp3Hit, s.tp4Hit, s.tp5Hit],
        tps: [s.tp1, s.tp2, s.tp3, s.tp4, s.tp5],
      };
    }),
    ticks: tl.length,
  }), { headers: { 'Content-Type': 'application/json' } });
});
