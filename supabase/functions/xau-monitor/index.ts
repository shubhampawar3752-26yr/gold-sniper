const ATR_SL_MULT = 1.5, RR = [1, 2, 3, 5, 8];
const TFS = [
  { l: '1M', i: '1m', r: '1d' },
  { l: '5M', i: '5m', r: '5d' },
  { l: '15M', i: '15m', r: '5d' },
  { l: '1H', i: '1h', r: '1mo' },
  { l: '4H', i: '1h', r: '3mo', agg: true },
];
const TICKS = 3, TICK_MS = 10000;

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function ema(c: any[], p: number) {
  if (c.length < p) return [];
  const k = 2 / (p + 1);
  let e = [], s = c.slice(0, p).reduce((a, x) => a + x.close, 0) / p;
  e.push(s);
  for (let i = p; i < c.length; i++) { s = c[i].close * k + s * (1 - k); e.push(s); }
  return e;
}

function atr(c: any[], p: number) {
  if (c.length < p + 1) return 0;
  let t = [];
  for (let i = 1; i < c.length; i++) {
    t.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  }
  return t.slice(-p).reduce((a, b) => a + b, 0) / p;
}

function cross(c: any[], lb = 5) {
  if (c.length < 25) return null;
  const e9 = ema(c, 9), e21 = ema(c, 21);
  const o9 = c.length - e9.length, o21 = c.length - e21.length;
  const so = Math.max(o9, o21);
  for (let i = c.length - 1; i >= so + 1 && i > c.length - 1 - lb; i--) {
    const i9 = i - o9, i21 = i - o21;
    if (i9 < 1 || i21 < 1) continue;
    if (e9[i9 - 1] <= e21[i21 - 1] && e9[i9] > e21[i21]) return { signal: 'buy', close: c[i].close };
    if (e9[i9 - 1] >= e21[i21 - 1] && e9[i9] < e21[i21]) return { signal: 'sell', close: c[i].close };
  }
  return null;
}

function allCross(c: any[]) {
  if (c.length < 25) return [];
  const e9 = ema(c, 9), e21 = ema(c, 21);
  const o9 = c.length - e9.length, o21 = c.length - e21.length;
  const so = Math.max(o9, o21);
  let r: any[] = [];
  for (let i = so + 1; i < c.length; i++) {
    const i9 = i - o9, i21 = i - o21;
    if (i9 < 1 || i21 < 1) continue;
    if (e9[i9 - 1] <= e21[i21 - 1] && e9[i9] > e21[i21]) r.push({ signal: 'buy', close: c[i].close, idx: i });
    if (e9[i9 - 1] >= e21[i21 - 1] && e9[i9] < e21[i21]) r.push({ signal: 'sell', close: c[i].close, idx: i });
  }
  return r;
}

function agg4h(c: any[]) {
  let r: any[] = [];
  for (let i = 0; i < c.length; i += 4) {
    let ch = c.slice(i, i + 4);
    if (!ch.length) continue;
    r.push({ time: ch[0].time, open: ch[0].open, high: Math.max(...ch.map(x => x.high)), low: Math.min(...ch.map(x => x.low)), close: ch[ch.length - 1].close, volume: 0 });
  }
  return r;
}

function hit(p: number, t: number, d: string) { return d === 'long' ? p >= t : p <= t; }
function slHit(p: number, s: number, d: string) { return d === 'long' ? p <= s : p >= s; }

async function fetchC(sym: string, interval: string, range: string) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`;
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const d = await r.json();
  const res = d?.chart?.result?.[0];
  if (!res) throw new Error('No data');
  const m = res.meta || {}, ts = res.timestamp || [], q = res.indicators?.quote?.[0];
  if (!q) throw new Error('No quotes');
  let c: any[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    c.push({ time: ts[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 });
  }
  return { candles: c, meta: m };
}

async function livePx(sym = 'GC=F') {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1m`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const d = await r.json();
    const res = d?.chart?.result?.[0];
    return res?.meta?.regularMarketPrice || null;
  } catch (e) { return null; }
}

function chkTick(px: number, s: any, l: string, prev: any, al: any[]) {
  if (s.allDone || s.slHit || s.entry === 0) return;
  if (slHit(px, s.sl, s.dir)) {
    if (!prev.slHit) al.push({ type: 'sl', timeframe: l, sl: s.sl, entry: s.entry, price: px, sent: false });
    s.slHit = true;
    return;
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function ns() {
  return { entry: 0, sl: 0, tp1: 0, tp2: 0, tp3: 0, tp4: 0, tp5: 0, atr: 0, dir: 'long', tp1Hit: false, tp2Hit: false, tp3Hit: false, tp4Hit: false, tp5Hit: false, slHit: false, allDone: false, cycle: 1, lastSignal: null };
}

function setLevels(s: any, a: number) {
  const r = a * ATR_SL_MULT;
  s.sl = s.dir === 'long' ? s.entry - r : s.entry + r;
  [1, 2, 3, 5, 8].forEach((v, i) => { s['tp' + (i + 1)] = s.dir === 'long' ? s.entry + r * v : s.entry - r * v; });
}

// Supabase REST API helpers (no external import needed)
async function supaSelect(table: string, limit = 1) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}?select=*&limit=${limit}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  return await r.json();
}

async function supaInsert(table: string, data: any) {
  await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(data),
  });
}

async function supaUpdate(table: string, data: any, id: number) {
  await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(data),
  });
}

Deno.serve(async (req) => {
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  let sid: number | null = null;
  let states: any = {};
  let prev: any = {};

  try {
    const rows = await supaSelect('trading_states', 1);
    if (rows && rows.length > 0) {
      const r = rows[0];
      sid = r.id;
      states = r.states || {};
      prev = r.prev_hits || {};
    }
  } catch (e) { console.error('State load:', (e as Error).message); }

  const alerts: any[] = [], tl: any[] = [], td: any = {};

  for (const tf of TFS) {
    const l = tf.l;
    if (!states[l]) states[l] = ns();
    if (!prev[l]) prev[l] = {};
    const s = states[l];
    try {
      const res = await fetchC('GC=F', tf.i, tf.r);
      if (!res.candles || res.candles.length < 25) continue;
      let c = res.candles;
      if (tf.agg) c = agg4h(c);
      const a = atr(c, 14);
      const px = res.meta?.regularMarketPrice || c[c.length - 1].close;
      td[l] = { candles: c, atr: a, price: px };
      const done = s.slHit || s.allDone || s.entry === 0;
      const cr = cross(c, 5);
      if (cr && done && s.lastSignal !== cr.signal) {
        s.dir = cr.signal === 'buy' ? 'long' : 'short';
        s.cycle++;
        s.entry = cr.close;
        s.atr = a;
        s.tp1Hit = s.tp2Hit = s.tp3Hit = s.tp4Hit = s.tp5Hit = false;
        s.slHit = s.allDone = false;
        s.lastSignal = cr.signal;
        setLevels(s, a);
        alerts.push({ type: 'entry', timeframe: l, direction: cr.signal, entry: s.entry, sl: s.sl, tp: { tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5 }, cycle: s.cycle, price: px, sent: false });
      }
      if (s.entry === 0) {
        const ac = allCross(c);
        if (ac.length > 0) {
          const lc = ac[ac.length - 1];
          const cb = c.slice(0, lc.idx + 1);
          const aa = cb.length >= 15 ? atr(cb, 14) : a;
          s.dir = lc.signal === 'buy' ? 'long' : 'short';
          s.entry = c[lc.idx].close;
          s.atr = aa;
          s.lastSignal = lc.signal;
          setLevels(s, aa);
        }
      }
      chkTick(px, s, l, prev[l] || {}, alerts);
    } catch (e) { console.error(`TF ${l}:`, (e as Error).message); }
  }

  for (let t = 0; t < TICKS; t++) {
    if (t > 0) await sleep(TICK_MS);
    const px = await livePx();
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
  states.__ticks = { lastPrice: lt?.price || td['1M']?.price || 0, lastTime: lt?.time || now, tickCount: tl.length, ticks: tl, updated: now };

  for (const a of alerts) {
    try { await supaInsert('alerts', a); } catch (e) { console.error('Alert:', (e as Error).message); }
  }

  try {
    if (sid) {
      await supaUpdate('trading_states', { states, prev_hits: prev, last_run: now }, sid);
    } else {
      await supaInsert('trading_states', { states, prev_hits: prev, last_run: now });
    }
  } catch (e) { console.error('State save:', (e as Error).message); }

  return new Response(JSON.stringify({
    success: true, timestamp: now, mode: 'tick-by-tick', ticksCaptured: tl.length, lastTickPrice: lt?.price || null,
    ticks: tl, stateId: sid, timeframesChecked: TFS.length, alertsGenerated: alerts.length,
    alertTypes: alerts.map(a => a.type + ':' + a.timeframe),
    states: Object.keys(states).filter(k => k !== '__ticks').map(k => ({
      tf: k, entry: states[k].entry, dir: states[k].dir, cycle: states[k].cycle,
      slHit: states[k].slHit, allDone: states[k].allDone,
      tpHits: [states[k].tp1Hit, states[k].tp2Hit, states[k].tp3Hit, states[k].tp4Hit, states[k].tp5Hit],
    })),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
