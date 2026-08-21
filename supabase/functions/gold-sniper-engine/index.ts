// ═══════════════════════════════════════════════════════════════════════
// GOLD SNIPER ENGINE — Consolidated Signal Engine + Alert Delivery
// ═══════════════════════════════════════════════════════════════════════
// ONE Edge Function that:
//   1. Fetches XAUUSD spot price + EMA/ATR/RSI from TradingView (one HTTP call)
//   2. Runs EMA 9/21 crossover signal engine across 6 timeframes
//   3. Sets SL (2x ATR) and 3 TPs (2x, 4x, 6x ATR)
//   4. Checks TP/SL hits on each tick
//   5. Sends WhatsApp alerts directly (Meta API + Blueticks fallback)
//   6. Saves state + alerts + execution logs to Supabase
//   7. Idempotency: no duplicate alerts for same timeframe/cycle/type
//
// Triggered by pg_cron every minute. NO Base44 dependencies. NO Yahoo Finance.
// ═══════════════════════════════════════════════════════════════════════

// ── Constants ──
const ATR_SL_MULT = 2;          // SL = 2x ATR
const RR = [1, 2, 3];           // TP1=1R(2xATR) TP2=2R(4xATR) TP3=3R(6xATR)
const TICKS = 3;                // 3 ticks per run
const TICK_MS = 10000;          // 10s between ticks
const TV_SYMBOL = 'OANDA:XAUUSD';

const TFS = [
  { l: '1M', tv: '1' },
  { l: '5M', tv: '5' },
  { l: '15M', tv: '15' },
  { l: '30M', tv: '30' },
  { l: '1H', tv: '60' },
  { l: '4H', tv: '240' },
];

// ── Whipsaw filter: minimum time between signal flips per timeframe ──
const FLIP_COOLDOWN_MS: Record<string, number> = {
  '1M':  3 * 60 * 1000,
  '5M':  5 * 60 * 1000,
  '15M': 10 * 60 * 1000,
  '30M': 15 * 60 * 1000,
  '1H':  30 * 60 * 1000,
  '4H':  60 * 60 * 1000,
};

const TV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Origin': 'https://www.tradingview.com',
};

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Environment Variables ──
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWELVEDATA_KEY = Deno.env.get('TWELVEDATA_API_KEY') || '';
const META_TOKEN = Deno.env.get('META_WHATSAPP_TOKEN') || '';
const META_PHONE_ID = Deno.env.get('META_WHATSAPP_PHONE_ID') || '';
const META_API_VERSION = Deno.env.get('META_WHATSAPP_API_VERSION') || 'v18.0';
const FALLBACK_RECIPIENTS = Deno.env.get('WHATSAPP_RECIPIENTS') || '';
const BLUETICKS_KEY = Deno.env.get('BLUETICKS_API_KEY') || '';
const BLUETICKS_PHONES = (Deno.env.get('BLUETICKS_PHONES') || '').split(',').map(s => s.trim()).filter(Boolean);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════
// TRADING LOGIC
// ═══════════════════════════════════════════════════════════════════════

function hit(p: number, t: number, d: string) { return d === 'long' ? p >= t : p <= t; }
function isSLHit(p: number, s: number, d: string) { return d === 'long' ? p <= s : p >= s; }

function ns() {
  return {
    entry: 0, sl: 0, tp1: 0, tp2: 0, tp3: 0, atr: 0, dir: 'long',
    tp1Hit: false, tp2Hit: false, tp3Hit: false,
    slHit: false, allDone: false, cycle: 0, lastSignal: null,
    prevEma9: null as number | null, prevEma21: null as number | null,
    lastFlipTime: null as string | null,
    aiConfirmed: false, aiReason: 'no_ai_data',
    entryTime: null as string | null,
  };
}

function setLevels(s: any, a: number) {
  const r = a * ATR_SL_MULT;
  s.sl = s.dir === 'long' ? s.entry - r : s.entry + r;
  s.tp1 = s.dir === 'long' ? s.entry + r * RR[0] : s.entry - r * RR[0];
  s.tp2 = s.dir === 'long' ? s.entry + r * RR[1] : s.entry - r * RR[1];
  s.tp3 = s.dir === 'long' ? s.entry + r * RR[2] : s.entry - r * RR[2];
}

function chkTick(px: number, s: any, l: string, prev: any, al: any[]) {
  if (s.allDone || s.slHit || s.entry === 0) return;
  const dir = s.dir === 'long' ? 'buy' : 'sell';

  if (isSLHit(px, s.sl, s.dir)) {
    if (!prev.slHit) al.push({ type: 'sl', timeframe: l, sl: s.sl, entry: s.entry, direction: dir, cycle: s.cycle, price: px, sent: false });
    s.slHit = true;
    return;
  }

  if (!s.tp1Hit && hit(px, s.tp1, s.dir)) { s.tp1Hit = true; if (!prev.tp1) al.push({ type: 'tp', timeframe: l, tp_num: 1, tp_price: s.tp1, entry: s.entry, direction: dir, sl: s.sl, cycle: s.cycle, price: px, progress: 1, sent: false }); }
  if (s.tp1Hit && !s.tp2Hit && hit(px, s.tp2, s.dir)) { s.tp2Hit = true; if (!prev.tp2) al.push({ type: 'tp', timeframe: l, tp_num: 2, tp_price: s.tp2, entry: s.entry, direction: dir, sl: s.sl, cycle: s.cycle, price: px, progress: 2, sent: false }); }
  if (s.tp2Hit && !s.tp3Hit && hit(px, s.tp3, s.dir)) { s.tp3Hit = true; if (!prev.tp3) al.push({ type: 'tp', timeframe: l, tp_num: 3, tp_price: s.tp3, entry: s.entry, direction: dir, sl: s.sl, cycle: s.cycle, price: px, progress: 3, sent: false }); }
  if (s.tp1Hit && s.tp2Hit && s.tp3Hit) {
    if (!prev.allDone) { s.allDone = true; al.push({ type: 'alldone', timeframe: l, entry: s.entry, direction: dir, sl: s.sl, cycle: s.cycle, price: px, sent: false }); }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════════════════════════════════

async function fetchTVIndicators(): Promise<Record<string, any>> {
  const fields: string[] = [];
  for (const tf of TFS) {
    fields.push(`EMA9|${tf.tv}`, `EMA21|${tf.tv}`, `ATR|${tf.tv}`, `close|${tf.tv}`, `RSI|${tf.tv}`);
  }
  fields.push('EMA9', 'EMA21', 'ATR', 'RSI', 'close', 'open', 'high', 'low', 'change', 'change_abs');
  const url = `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(TV_SYMBOL)}&fields=${fields.join(',')}`;
  const resp = await fetch(url, { headers: TV_HEADERS });
  if (!resp.ok) throw new Error(`TV scanner HTTP ${resp.status}`);
  return await resp.json();
}

async function fetchLivePrice(): Promise<number | null> {
  // Source 1: TwelveData API
  try {
    const r = await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVEDATA_KEY}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (r.ok) {
      const d = await r.json();
      const px = parseFloat(d?.price);
      if (px > 0) return px;
    }
  } catch { /* fall through */ }

  // Source 2: livepriceofgold.com HTML scrape
  try {
    const r = await fetch('https://livepriceofgold.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (r.ok) {
      const html = await r.text();
      const m = html.match(/bold\.\s*price[^>]*>\s*\$?([\d,]+\.\d+)/i) || html.match(/>([\d,]+\.\d{2})</);
      if (m) {
        const px = parseFloat(m[1].replace(/,/g, ''));
        if (px > 0) return px;
      }
    }
  } catch { /* fall through */ }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// AI CANDLE SCANNER INTEGRATION
// ═══════════════════════════════════════════════════════════════════════

async function fetchAIAnalysis(): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/ai_candle_analysis?select=timeframe,recommendation,confidence,pattern,pattern_type,rsi,rsi_signal,trend_direction,trend_strength,suggested_entry,suggested_sl,suggested_tp1&order=created_at.desc&limit=12`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );
    if (r.ok) {
      const rows: any[] = await r.json();
      for (const row of rows) {
        if (!map[row.timeframe]) map[row.timeframe] = row;
      }
    }
  } catch {}
  return map;
}

function aiConfirms(aiData: any, direction: string): { confirmed: boolean; reason: string } {
  if (!aiData || !aiData.recommendation) return { confirmed: true, reason: 'no_ai_data' };
  const rec = aiData.recommendation;
  const isLong = direction === 'long';
  if (isLong && (rec === 'buy' || rec === 'strong_buy' || rec === 'weak_buy'))
    return { confirmed: true, reason: `ai_${rec}` };
  if (!isLong && (rec === 'sell' || rec === 'strong_sell' || rec === 'weak_sell'))
    return { confirmed: true, reason: `ai_${rec}` };
  if (rec === 'neutral')
    return { confirmed: true, reason: 'ai_neutral' };
  return { confirmed: false, reason: `ai_disagrees_${rec}` };
}

// ═══════════════════════════════════════════════════════════════════════
// SUPABASE DATABASE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════

async function supaSelect(table: string, limit = 1) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}?select=*&limit=${limit}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  return await r.json();
}

async function supaInsert(table: string, data: any) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const err = await r.text();
    console.error(`Insert ${table} FAILED (${r.status}):`, err.substring(0, 300));
    return null;
  }
  return await r.json();
}

async function supaUpdate(table: string, data: any, id: number) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(data),
  });
  if (!r.ok) console.error(`Update ${table} FAILED (${r.status})`);
}



// ── Record closed trade in trade_history table ──
async function recordTradeHistory(s: any, l: string, exitPrice: number, exitReason: string) {
  if (!s.entry || s.entry === 0 || !s.entryTime) return;
  const tpsHit = (s.tp1Hit ? 1 : 0) + (s.tp2Hit ? 1 : 0) + (s.tp3Hit ? 1 : 0);
  const entryTime = new Date(s.entryTime);
  const exitTime = new Date();
  const durationMin = Math.round((exitTime.getTime() - entryTime.getTime()) / 60000);
  
  // Calculate PnL in pips (gold: 1 pip = $0.01, but we'll use $1 = 1 pip for simplicity)
  let pnlPips = 0;
  if (exitReason === 'sl_hit' || exitReason === 'ema_flip') {
    pnlPips = s.dir === 'long' ? exitPrice - s.entry : s.entry - exitPrice;
  } else if (exitReason === 'all_tps_hit') {
    pnlPips = s.dir === 'long' ? s.tp3 - s.entry : s.entry - s.tp3;
  }
  const pnlPercent = s.entry > 0 ? (pnlPips / s.entry) * 100 : 0;
  
  try {
    await supaInsert('trade_history', {
      timeframe: l,
      cycle: s.cycle,
      direction: s.dir,
      entry_price: s.entry,
      exit_price: exitPrice,
      sl_price: s.sl,
      tp1_price: s.tp1,
      tp2_price: s.tp2,
      tp3_price: s.tp3,
      tp1_hit: s.tp1Hit,
      tp2_hit: s.tp2Hit,
      tp3_hit: s.tp3Hit,
      tps_hit: tpsHit,
      exit_reason: exitReason,
      atr: s.atr || 0,
      ai_confirmed: s.aiConfirmed || false,
      ai_reason: s.aiReason || '',
      entry_time: s.entryTime,
      exit_time: exitTime.toISOString(),
      duration_minutes: durationMin,
      pnl_pips: pnlPips,
      pnl_percent: pnlPercent,
    });
  } catch (e) { console.error(`trade_history insert failed: ${(e as Error).message}`); }
}

// ── Idempotency: check if alert already exists for this timeframe/cycle/type ──
async function alertExists(timeframe: string, cycle: number, type: string, tpNum?: number): Promise<boolean> {
  let url = `${SUPA_URL}/rest/v1/alerts?select=id&timeframe=eq.${timeframe}&cycle=eq.${cycle}&type=eq.${type}&limit=1`;
  if (tpNum != null) url += `&tp_num=eq.${tpNum}`;
  const r = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!r.ok) return false;
  const data = await r.json();
  return Array.isArray(data) && data.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════
// WHATSAPP ALERT DELIVERY
// ═══════════════════════════════════════════════════════════════════════

async function getRecipients(): Promise<string[]> {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/whatsapp_recipients?select=phone_number&is_active=eq.true`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    if (r.ok) {
      const data = await r.json();
      const phones = (data || []).map((r: any) => r.phone_number).filter(Boolean);
      if (phones.length > 0) return phones;
    }
  } catch {}
  return FALLBACK_RECIPIENTS.split(',').map(s => s.trim()).filter(Boolean);
}

async function sendViaMeta(phone: string, message: string) {
  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: message },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meta API ${res.status}: ${err.substring(0, 200)}`);
  }
  return await res.json();
}

async function sendViaBlueticks(phone: string, message: string) {
  if (!BLUETICKS_KEY) throw new Error('Blueticks: no API key');
  const chatId = `${phone}@c.us`;
  const res = await fetch(`https://api.blueticks.co/v1/messages/${chatId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BLUETICKS_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'text', text: message }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Blueticks ${res.status}: ${err.substring(0, 200)}`);
  }
  return { ok: true, phone };
}

function formatMessage(alert: any): string {
  const emoji: Record<string, string> = { entry: '🟢', tp: '✅', sl: '🛑', alldone: '🎉', test: '🧪' };
  const icon = emoji[alert.type] || '🔔';
  const tf = alert.timeframe || '?';

  if (alert.type === 'entry') {
    const dir = alert.direction === 'buy' || alert.direction === 'long' ? 'LONG 📈' : 'SHORT 📉';
    const tp = alert.tp || {};
    return `${icon} *GOLD SNIPER — NEW ${tf} SIGNAL*

*Direction:* ${dir}
*Entry:* $${alert.entry?.toFixed(2)}
*SL:* $${alert.sl?.toFixed(2)}
*ATR Cycle:* ${alert.cycle}

*Take Profit Levels:*
TP1: $${tp.tp1?.toFixed(2) || '?'} (1R)
TP2: $${tp.tp2?.toFixed(2) || '?'} (2R)
TP3: $${tp.tp3?.toFixed(2) || '?'} (3R)

${tp.aiConfirmed ? `AI: ${tp.aiReason} ${tp.aiPattern ? '(' + tp.aiPattern + ')' : ''}` : ''}
_Gold Sniper Engine_`;
  }

  if (alert.type === 'tp') {
    return `${icon} *GOLD SNIPER — TP${alert.tp_num} HIT (${tf})*

*TP${alert.tp_num} Target:* $${alert.tp_price?.toFixed(2)}
*Entry:* $${alert.entry?.toFixed(2)}
*Current Price:* $${alert.price?.toFixed(2)}

_Cycle ${alert.cycle} — ${alert.progress}/3 TPs hit_
_Gold Sniper Engine_`;
  }

  if (alert.type === 'sl') {
    return `${icon} *GOLD SNIPER — SL HIT (${tf})*

*SL:* $${alert.sl?.toFixed(2)}
*Entry:* $${alert.entry?.toFixed(2)}
*Current Price:* $${alert.price?.toFixed(2)}

_Cycle ${alert.cycle} — Trade closed_
_Gold Sniper Engine_`;
  }

  if (alert.type === 'alldone') {
    return `${icon} *GOLD SNIPER — ALL TPs HIT (${tf})*

*Entry:* $${alert.entry?.toFixed(2)}
*Current Price:* $${alert.price?.toFixed(2)}

*All 3 TP targets reached!*
_Cycle ${alert.cycle} — Perfect trade_
_Gold Sniper Engine_`;
  }

  return `${icon} GOLD SNIPER — ${alert.type} (${tf})`;
}

async function sendAlertWhatsApp(alert: any, alertId: number): Promise<boolean> {
  const message = formatMessage(alert);
  const recipients = await getRecipients();
  if (recipients.length === 0) {
    console.error('No recipients configured');
    return false;
  }

  let anySent = false;
  for (const phone of recipients) {
    try {
      await sendViaMeta(phone, message);
      anySent = true;
    } catch (metaErr) {
      // Try Blueticks fallback for specific numbers
      if (BLUETICKS_PHONES.includes(phone) && BLUETICKS_KEY) {
        try {
          await sendViaBlueticks(phone, message);
          anySent = true;
        } catch (btErr) {
          console.error(`Both providers failed for ${phone}: ${metaErr} | ${btErr}`);
        }
      } else {
        console.error(`Meta failed for ${phone}: ${metaErr}`);
      }
    }
  }

  if (anySent) {
    await supaUpdate('alerts', { sent: true }, alertId);
  }
  return anySent;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const t0 = Date.now();
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const errors: string[] = [];

  let sid: number | null = null;
  let states: any = {};
  let prev: any = {};

  // ── Load trading state ──
  try {
    const rows = await supaSelect('trading_states', 1);
    if (rows && rows.length > 0) { sid = rows[0].id; states = rows[0].states || {}; prev = rows[0].prev_hits || {}; }
  } catch (e) { errors.push(`State load: ${(e as Error).message}`); }

  // ── Fixup: clear stale tp4/tp5 from 5-TP era for existing active trades ──
  for (const tf of TFS) {
    const s = states[tf.l];
    if (!s || s.entry === 0) continue;
    if (s.tp4 !== undefined) { s.tp4 = 0; s.tp4Hit = false; }
    if (s.tp5 !== undefined) { s.tp5 = 0; s.tp5Hit = false; }
    if (s.allDone && s.tp3Hit && !s.tp1Hit) s.allDone = false; // reset allDone if it was set by 5-TP
  }

  // ── Fetch TradingView indicators (ONE HTTP call) ──
  let tvData: Record<string, any> = {};
  let livePrice: number | null = null;
  let aiAnalysis: Record<string, any> = {};

  try {
    tvData = await fetchTVIndicators();
    livePrice = tvData['close'] || tvData['close|1'] || null;
  } catch (e) {
    errors.push(`TV scanner: ${(e as Error).message}`);
    livePrice = await fetchLivePrice();
  }

  if (!livePrice || livePrice <= 0) {
    errors.push('No live price available');
    return new Response(JSON.stringify({ success: false, error: 'No live price', errors, timestamp: now }), { status: 503, headers: CORS });
  }

  // ── Fetch AI Candle Scanner analysis ──
  try {
    aiAnalysis = await fetchAIAnalysis();
  } catch (e) {
    errors.push(`AI analysis: ${(e as Error).message}`);
  }

  const alerts: any[] = [];
  const tfResults: any[] = [];

  // ── Signal engine: process each timeframe ──
  for (const tf of TFS) {
    const l = tf.l;
    if (!states[l]) states[l] = ns();
    if (!prev[l]) prev[l] = {};
    const s = states[l];

    const ema9 = tvData[`EMA9|${tf.tv}`];
    const ema21 = tvData[`EMA21|${tf.tv}`];
    const atr = tvData[`ATR|${tf.tv}`];
    const tfPrice = tvData[`close|${tf.tv}`] || livePrice;
    const rsi = tvData[`RSI|${tf.tv}`];

    if (ema9 == null || ema21 == null || atr == null) {
      errors.push(`TV ${l}: missing indicators`);
      tfResults.push({ tf: l, error: 'missing indicators', ema9, ema21, atr });
      continue;
    }

    const done = s.slHit || s.allDone || s.entry === 0;

    // ── Signal flip: close trade when EMA is opposite to trade direction ──
    if (!done && s.prevEma9 != null && s.prevEma21 != null) {
      const wasLong = s.prevEma9 > s.prevEma21;
      const nowLong = ema9 > ema21;
      const flippedToShort = wasLong && ema9 < ema21;
      const flippedToLong = !wasLong && ema9 > ema21;

      if ((flippedToShort && s.dir === 'long') || (flippedToLong && s.dir === 'short')) {
        if (!s.slHit && !s.allDone) {
          alerts.push({ type: 'sl', timeframe: l, sl: s.entry, entry: s.entry, direction: s.dir === 'long' ? 'buy' : 'sell', cycle: s.cycle, price: tfPrice, sent: false });
          s.slHit = true;
        }
      }
    }

    const doneNow = s.slHit || s.allDone || s.entry === 0;

    // ── First run (prevEma is null): set up initial trade ──
    if (doneNow && s.prevEma9 == null && s.prevEma21 == null) {
      const signal = ema9 > ema21 ? 'buy' : 'sell';
      s.dir = signal === 'buy' ? 'long' : 'short';
      s.cycle = 1;
      s.entry = tfPrice || livePrice || 0;
      s.atr = atr;
      s.lastSignal = signal;
      s.tp1Hit = s.tp2Hit = s.tp3Hit = false;
      s.slHit = s.allDone = false;
      setLevels(s, atr);
      s.entryTime = new Date().toISOString();

      const ai = aiAnalysis[l];
      const aiCheck = aiConfirms(ai, s.dir);
      s.aiConfirmed = aiCheck.confirmed;
      s.aiReason = aiCheck.reason;

      const exists = await alertExists(l, s.cycle, 'entry');
      if (!exists) {
        alerts.push({
          type: 'entry', timeframe: l, direction: signal,
          entry: s.entry, sl: s.sl,
          tp: { tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, atr, rsi, aiConfirmed: aiCheck.confirmed, aiReason: aiCheck.reason, aiPattern: ai?.pattern, aiRecommendation: ai?.recommendation, aiConfidence: ai?.confidence },
          cycle: s.cycle, price: tfPrice, sent: false,
        });
      }
    }
    // ── Subsequent runs: detect crossover ──
    else if (doneNow && s.prevEma9 != null && s.prevEma21 != null) {
      const crossUp = s.prevEma9 <= s.prevEma21 && ema9 > ema21;
      const crossDn = s.prevEma9 >= s.prevEma21 && ema9 < ema21;

      const cooldownMs = FLIP_COOLDOWN_MS[l] || 0;
      const lastFlip = s.lastFlipTime ? new Date(s.lastFlipTime).getTime() : 0;
      const sinceLast = Date.now() - lastFlip;
      const inCooldown = cooldownMs > 0 && sinceLast < cooldownMs;

      if ((crossUp || crossDn) && !inCooldown) {
        s.lastFlipTime = new Date().toISOString();
        s.dir = crossUp ? 'long' : 'short';
        s.cycle++;
        s.entry = tfPrice || livePrice || 0;
        s.atr = atr;
        s.tp1Hit = s.tp2Hit = s.tp3Hit = false;
        s.slHit = s.allDone = false;
        s.lastSignal = crossUp ? 'buy' : 'sell';
        setLevels(s, atr);
        s.entryTime = new Date().toISOString();

        const ai = aiAnalysis[l];
        const aiCheck = aiConfirms(ai, s.dir);
        s.aiConfirmed = aiCheck.confirmed;
        s.aiReason = aiCheck.reason;

        const exists = await alertExists(l, s.cycle, 'entry');
        if (!exists) {
          alerts.push({
            type: 'entry', timeframe: l, direction: s.lastSignal,
            entry: s.entry, sl: s.sl,
            tp: { tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, atr, rsi, aiConfirmed: aiCheck.confirmed, aiReason: aiCheck.reason, aiPattern: ai?.pattern, aiRecommendation: ai?.recommendation, aiConfidence: ai?.confidence },
            cycle: s.cycle, price: tfPrice, sent: false,
          });
        }
      }
    }

    // ── Update prev EMA values ──
    s.prevEma9 = ema9;
    s.prevEma21 = ema21;

    // ── Tick 0: check TP/SL with current price ──
    if (tfPrice && s.entry > 0) chkTick(tfPrice, s, l, prev[l] || {}, alerts);

    tfResults.push({
      tf: l, ema9, ema21, signal: ema9 > ema21 ? 'buy' : 'sell', atr, rsi,
      entry: s.entry, sl: s.sl, tps: [s.tp1, s.tp2, s.tp3],
      cycle: s.cycle, dir: s.dir, slHit: s.slHit, allDone: s.allDone,
      tpHits: [s.tp1Hit, s.tp2Hit, s.tp3Hit],
      aiConfirmed: s.aiConfirmed, aiReason: s.aiReason,
    });
  }

  // ── Tick loop: poll for TP/SL hits ──
  const tickData: any[] = [{ price: livePrice, time: Date.now() }];
  for (let t = 1; t < TICKS; t++) {
    await sleep(TICK_MS);
    try {
      const tickPrice = await fetchLivePrice() || livePrice;
      tickData.push({ price: tickPrice, time: Date.now() });
      for (const tf of TFS) {
        const l = tf.l;
        const s = states[l];
        if (s && s.entry > 0) chkTick(tickPrice, s, l, prev[l] || {}, alerts);
      }
    } catch (e) {
      errors.push(`Tick ${t}: ${(e as Error).message}`);
    }
  }


  // ── Record closed trades in trade_history ──
  for (const tf of TFS) {
    const l = tf.l;
    const s = states[l];
    const p = prev[l] || {};
    if (!s || s.entry === 0) continue;
    
    // Check if trade just closed in this run
    const wasOpen = !p.slHit && !p.allDone;
    const isNowClosed = s.slHit || s.allDone;
    
    if (wasOpen && isNowClosed) {
      // Determine exit reason and price
      let exitReason = '';
      let exitPrice = 0;
      
      if (s.allDone) {
        exitReason = 'all_tps_hit';
        exitPrice = s.tp3; // Last TP price
      } else if (s.slHit) {
        // Check if SL was hit by EMA flip (price = s.entry in flip alert) or actual SL
        const lastAlert = alerts.find(a => a.timeframe === l && a.type === 'sl' && a.cycle === s.cycle);
        if (lastAlert && lastAlert.sl === s.entry) {
          exitReason = 'ema_flip';
          exitPrice = lastAlert.price || s.entry;
        } else {
          exitReason = 'sl_hit';
          exitPrice = s.sl;
        }
      }
      
      await recordTradeHistory(s, l, exitPrice, exitReason);
    }
  }

  // ── Save alerts to database + send WhatsApp ──
  let alertsSent = 0;
  const alertDetails: any[] = [];

  for (const alert of alerts) {
    // Idempotency: double-check before inserting
    const exists = await alertExists(alert.timeframe, alert.cycle, alert.type, alert.tp_num);
    if (exists) {
      alertDetails.push({ ...alert, status: 'duplicate_skipped' });
      continue;
    }

    const inserted = await supaInsert('alerts', alert);
    if (inserted && Array.isArray(inserted) && inserted.length > 0) {
      const alertId = inserted[0].id;
      const sent = await sendAlertWhatsApp(alert, alertId);
      if (sent) alertsSent++;
      alertDetails.push({ ...alert, status: sent ? 'sent' : 'saved_not_sent', alertId });
    } else {
      alertDetails.push({ ...alert, status: 'insert_failed' });
    }
  }

  // ── Update prev_hits for next run ──
  const newPrev: any = {};
  for (const tf of TFS) {
    const s = states[tf.l];
    newPrev[tf.l] = {
      tp1: s.tp1Hit, tp2: s.tp2Hit, tp3: s.tp3Hit,
      slHit: s.slHit, allDone: s.allDone,
    };
  }

  // ── Save tick data ──
  states.__ticks = {
    lastPrice: tickData[tickData.length - 1]?.price || livePrice,
    lastTime: new Date().toISOString(),
    tickCount: tickData.length,
    ticks: tickData,
    updated: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false }),
  };

  // ── Save trading state ──
  try {
    if (sid != null) await supaUpdate('trading_states', { states, last_run: now, prev_hits: newPrev }, sid);
    else await supaInsert('trading_states', { states, last_run: now, prev_hits: newPrev });
  } catch (e) { errors.push(`State save: ${(e as Error).message}`); }

  // ── Save execution log ──
  const durationMs = Date.now() - t0;
  try {
    await supaInsert('engine_logs', {
      run_time: now,
      price: livePrice,
      alerts_generated: alerts.length,
      alerts_sent: alertsSent,
      errors: errors.length > 0 ? errors.join('; ') : null,
      status: errors.length > 0 ? 'partial' : 'ok',
      duration_ms: durationMs,
    });
  } catch (e) { /* non-critical */ }

  // ── Return response (dashboard-compatible) ──
  return new Response(JSON.stringify({
    success: true,
    timestamp: now,
    price: livePrice,
    source: 'tradingview-scanner',
    alerts: alerts.length,
    alertsSent,
    alertDetails,
    timeframes: tfResults,
    ticks: tickData.length,
    duration_ms: durationMs,
    errors,
  }), { status: 200, headers: CORS });
});