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
  '1M':  5 * 60 * 1000,
  '5M':  5 * 60 * 1000,
  '15M': 10 * 60 * 1000,
  '30M': 15 * 60 * 1000,
  '1H':  30 * 60 * 1000,
  '4H':  60 * 60 * 1000,
};

// ── Session-based trading: only take new entries during active sessions ──
// Times in IST (Asia/Kolkata, UTC+5:30)
// London session: 12:30 - 21:00 IST
// New York session: 17:00 - 01:30 IST (next day)
// Overlap (best liquidity): 17:00 - 21:00 IST
// Asian session: 05:30 - 12:30 IST — SKIP for lower timeframes (choppy)
const SESSIONS = {
  london:   { startH: 12, startM: 30, endH: 21, endM: 0 },
  newyork:  { startH: 17, startM: 0,  endH: 25, endM: 30 }, // 25:30 = 01:30 next day
};

// Timeframes that require session filtering (lower TFs are choppy in Asian session)
const SESSION_FILTERED_TFS = ['1M', '5M'];

function isSessionActive(tf: string, date: Date): boolean {
  if (!SESSION_FILTERED_TFS.includes(tf)) return true; // Higher TFs trade all sessions

  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(date.getTime() + istOffset - date.getTimezoneOffset() * 60000);
  // Get IST hours as decimal (0-24)
  const istHours = ist.getUTCHours() + ist.getUTCMinutes() / 60;

  const inLondon = istHours >= 12.5 && istHours < 21.0;
  const inNY = istHours >= 17.0 || istHours < 1.5; // NY extends past midnight
  return inLondon || inNY;
}

// ── Smart entry: limit order at slight pullback instead of market price ──
const SMART_ENTRY_PULLBACK_ATR = 0.3; // Enter at 0.3x ATR pullback from current price
const SMART_ENTRY_TIMEOUT_MS: Record<string, number> = {
  '1M':  5 * 60 * 1000,   // 5 min to fill
  '5M':  5 * 60 * 1000,   // 5 min
  '15M': 10 * 60 * 1000,  // 10 min
  '30M': 15 * 60 * 1000,  // 15 min
  '1H':  30 * 60 * 1000,  // 30 min
  '4H':  60 * 60 * 1000,  // 60 min
};

// Cooldown after all TPs hit before starting next trade (prevents choppy entries)
const ALLTP_COOLDOWN_MS: Record<string, number> = {
  '1M':  2 * 60 * 1000,   // 2 min
  '5M':  3 * 60 * 1000,   // 3 min
  '15M': 5 * 60 * 1000,   // 5 min
  '30M': 10 * 60 * 1000,  // 10 min
  '1H':  15 * 60 * 1000,  // 15 min
  '4H':  30 * 60 * 1000,  // 30 min
};

// Min EMA spread as % of ATR — prevents entering when EMAs are barely crossed
const MIN_EMA_SPREAD_ATR_PCT: Record<string, number> = {
  '1M':  0.12,  // 12% of ATR — tighter to prevent choppy 1M entries
  '5M':  0.08,  // 8% of ATR
  '15M': 0.10,  // 10% of ATR
  '30M': 0.12,  // 12% of ATR
  '1H':  0.15,  // 15% of ATR
  '4H':  0.15,  // 15% of ATR
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
    entry: 0, sl: 0, originalSl: 0, tp1: 0, tp2: 0, tp3: 0, atr: 0, dir: 'long',
    tp1Hit: false, tp2Hit: false, tp3Hit: false,
    slMovedToBE: false, slMovedToTP1: false, slMovedToTP2: false,
    slHit: false, allDone: false, allDoneTime: null as string | null, cycle: 0, lastSignal: null,
    prevEma9: null as number | null, prevEma21: null as number | null,
    lastFlipTime: null as string | null,
    aiConfirmed: false, aiReason: 'no_ai_data',
    entryTime: null as string | null,
    pendingEntry: 0, pendingDir: 'long', pendingTime: null as string | null,
    pendingAtr: 0, pendingCycle: 0,
    smartEntry: false,
  };
}

function setLevels(s: any, a: number) {
  const r = a * ATR_SL_MULT;
  s.sl = s.dir === 'long' ? s.entry - r : s.entry + r;
  s.originalSl = s.sl; // Save original SL for trailing reference
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

  // TP1 hit → move SL to entry (breakeven)
  if (!s.tp1Hit && hit(px, s.tp1, s.dir)) {
    s.tp1Hit = true;
    s.sl = s.entry; // Move SL to entry price (breakeven)
    s.slMovedToBE = true;
    if (!prev.tp1) al.push({ type: 'tp', timeframe: l, tp_num: 1, tp_price: s.tp1, entry: s.entry, direction: dir, sl: s.sl, sl_moved: 'breakeven', cycle: s.cycle, price: px, progress: 1, sent: false });
  }
  // TP2 hit → move SL to TP1 price
  if (s.tp1Hit && !s.tp2Hit && hit(px, s.tp2, s.dir)) {
    s.tp2Hit = true;
    s.sl = s.tp1; // Move SL to TP1 price (lock in TP1 profit)
    s.slMovedToTP1 = true;
    if (!prev.tp2) al.push({ type: 'tp', timeframe: l, tp_num: 2, tp_price: s.tp2, entry: s.entry, direction: dir, sl: s.sl, sl_moved: 'tp1', cycle: s.cycle, price: px, progress: 2, sent: false });
  }
  if (s.tp2Hit && !s.tp3Hit && hit(px, s.tp3, s.dir)) {
    s.tp3Hit = true;
    // TP3 hit = target achieved — no SL move needed, trade closes at TP3
    if (!prev.tp3) al.push({ type: 'tp', timeframe: l, tp_num: 3, tp_price: s.tp3, entry: s.entry, direction: dir, sl: s.sl, cycle: s.cycle, price: px, progress: 3, sent: false });
  }
  if (s.tp1Hit && s.tp2Hit && s.tp3Hit) {
    if (!prev.allDone) { s.allDone = true; s.allDoneTime = new Date().toISOString(); al.push({ type: 'alldone', timeframe: l, entry: s.entry, direction: dir, sl: s.sl, cycle: s.cycle, price: px, sent: false }); }
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

  // Determine exit level: where did the trade close?
  let exitLevel = 'unknown';
  if (exitReason === 'all_tps_hit') {
    exitLevel = 'tp3';
  } else if (exitReason === 'sl_hit') {
    if (s.slMovedToTP1) exitLevel = 'tp1';
    else if (s.slMovedToBE) exitLevel = 'breakeven';
    else exitLevel = 'original_sl';
  } else if (exitReason === 'ema_flip') {
    if (s.slMovedToTP1) exitLevel = 'tp1';
    else if (s.slMovedToBE) exitLevel = 'breakeven';
    else exitLevel = 'original_sl';
  }
  // Points captured = PnL in price units
  const points = Math.round(pnlPips * 100) / 100;
  
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
      exit_level: exitLevel,
      sl_at_exit: s.sl,
      points: points,
      smart_entry: s.smartEntry || false,
    });

    // Update cumulative trade_stats via atomic RPC function
    const isWin = pnlPips > 0 || (s.tp1Hit && exitReason === 'ema_flip');
    const isLoss = pnlPips < 0 && !(s.tp1Hit && exitReason === 'ema_flip');
    const isBE = pnlPips === 0 && !(s.tp1Hit && exitReason === 'ema_flip');
    const isAllTPs = tpsHit === 3;
    try {
      await fetch(`${SUPA_URL}/rest/v1/rpc/update_trade_stats`, {
        method: 'POST',
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tf: l, pnl_pips: pnlPips, pnl_pct: pnlPercent,
          is_win: isWin, is_loss: isLoss, is_be: isBE, is_alltp: isAllTPs,
        }),
      });
      console.log(`[${l}] Stats updated: pnl=${pnlPips}pts win=${isWin} allTPs=${isAllTPs}`);
    } catch (e) { console.error(`trade_stats update failed: ${(e as Error).message}`); }
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
_Trailing: TP1→SL to Entry, TP2→SL to TP1_

*Take Profit Levels:*
TP1: $${tp.tp1?.toFixed(2) || '?'} (1R)
TP2: $${tp.tp2?.toFixed(2) || '?'} (2R)
TP3: $${tp.tp3?.toFixed(2) || '?'} (3R)

${tp.aiConfirmed ? `AI: ${tp.aiReason} ${tp.aiPattern ? '(' + tp.aiPattern + ')' : ''}` : ''}
_Gold Sniper Engine_`;
  }

  if (alert.type === 'tp') {
    const slNote = alert.sl_moved === 'breakeven'
      ? '\n*🛡️ SL moved to Entry (Breakeven)*'
      : alert.sl_moved === 'tp1'
      ? `\n*🛡️ SL moved to TP1 ($${alert.sl?.toFixed(2) || '?'})*`
      : '';
    return `${icon} *GOLD SNIPER — TP${alert.tp_num} HIT (${tf})*

*TP${alert.tp_num} Target:* $${alert.tp_price?.toFixed(2)}
*Entry:* $${alert.entry?.toFixed(2)}
*Current Price:* $${alert.price?.toFixed(2)}
*New SL:* $${alert.sl?.toFixed(2)}${slNote}

_Cycle ${alert.cycle} — ${alert.progress}/3 TPs hit_
_Gold Sniper Engine_`;
  }

  if (alert.type === 'sl') {
    const trailingNote = alert.sl === alert.entry ? '\n_📌 SL at Breakeven (TP1 was hit)_' : '';
    return `${icon} *GOLD SNIPER — SL HIT (${tf})*

*SL:* $${alert.sl?.toFixed(2)}
*Entry:* $${alert.entry?.toFixed(2)}
*Current Price:* $${alert.price?.toFixed(2)}${trailingNote}

_Cycle ${alert.cycle} — Trade closed_
_Gold Sniper Engine_`;
  }

  if (alert.type === 'alldone') {
    return `${icon} *GOLD SNIPER — ALL TPs HIT (${tf})*

*Entry:* $${alert.entry?.toFixed(2)}
*Current Price:* $${alert.price?.toFixed(2)}

*All 3 TP targets reached!*
_Cycle ${alert.cycle} — 🎯 TARGET ACHIEVED — All 3 TPs hit!_
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
    
    // Re-apply trailing SL if lost (TP1 hit but SL not at breakeven)
    if (!s.slHit && !s.allDone && s.tp1Hit && s.entry > 0) {
      // TP2 hit → SL should be at TP1
      if (s.tp2Hit && s.tp1 > 0 && s.sl !== s.tp1) {
        s.sl = s.tp1;
        s.slMovedToTP1 = true;
        s.slMovedToBE = true;
        console.log(`[${tf.l}] Fixup: SL moved to TP1 ($${s.sl})`);
      }
      // TP1 hit → SL should be at entry (breakeven)
      else if (!s.slMovedToBE || s.sl !== s.entry) {
        s.originalSl = s.originalSl || s.sl;
        s.sl = s.entry;
        s.slMovedToBE = true;
        console.log(`[${tf.l}] Fixup: SL moved to breakeven ($${s.sl})`);
      }
    }
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

    // ── Smart entry: check if pending limit order should fill ──
    if (s.pendingEntry > 0) {
      const pendingAge = s.pendingTime ? Date.now() - new Date(s.pendingTime).getTime() : 0;
      const timeout = SMART_ENTRY_TIMEOUT_MS[l] || 300000;

      // Check if price reached the limit level
      const fillLong = s.pendingDir === 'long' && livePrice <= s.pendingEntry;
      const fillShort = s.pendingDir === 'short' && livePrice >= s.pendingEntry;

      // Check if EMA crossover has reversed (cancel pending)
      const emaReversed = (s.pendingDir === 'long' && ema9 < ema21) || (s.pendingDir === 'short' && ema9 > ema21);

      if (fillLong || fillShort) {
        // Fill the pending entry at limit price
        s.entry = s.pendingEntry;
        s.dir = s.pendingDir;
        s.atr = s.pendingAtr;
        s.cycle = s.pendingCycle;
        s.tp1Hit = s.tp2Hit = s.tp3Hit = false;
        s.slMovedToBE = false; s.slMovedToTP1 = false; s.slMovedToTP2 = false;
        s.slHit = s.allDone = false;
        s.lastSignal = s.pendingDir === 'long' ? 'buy' : 'sell';
        setLevels(s, s.pendingAtr);
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
            tp: { tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, atr: s.atr, rsi, aiConfirmed: aiCheck.confirmed, aiReason: aiCheck.reason, aiPattern: ai?.pattern, aiRecommendation: ai?.recommendation, aiConfidence: ai?.confidence },
            cycle: s.cycle, price: tfPrice, sent: false, smart_entry: true,
          });
        }
        s.smartEntry = true;
        console.log(`[${l}] Smart entry FILLED: cycle ${s.cycle} (${s.lastSignal}) at $${s.entry} (limit order)`);
        // Clear pending
        s.pendingEntry = 0; s.pendingDir = 'long'; s.pendingTime = null; s.pendingAtr = 0; s.pendingCycle = 0;
      } else if (emaReversed || pendingAge > timeout) {
        // Cancel pending entry — EMA reversed or timed out
        console.log(`[${l}] Smart entry CANCELLED: ${emaReversed ? 'EMA reversed' : 'timeout'} (age=${Math.round(pendingAge/1000)}s)`);
        s.pendingEntry = 0; s.pendingDir = 'long'; s.pendingTime = null; s.pendingAtr = 0; s.pendingCycle = 0;
      }
      // If still pending, skip new entry logic this run
      if (s.pendingEntry > 0) {
        s.prevEma9 = ema9;
        s.prevEma21 = ema21;
        if (tfPrice && s.entry > 0) chkTick(tfPrice, s, l, prev[l] || {}, alerts);
        tfResults.push({ tf: l, ema9, ema21, signal: ema9 > ema21 ? 'buy' : 'sell', atr, rsi, entry: s.entry, sl: s.sl, cycle: s.cycle, dir: s.dir, slHit: s.slHit, allDone: s.allDone, tpHits: [s.tp1Hit, s.tp2Hit, s.tp3Hit], pendingEntry: s.pendingEntry, smartEntry: true });
        continue;
      }
    }

    // Recompute done after smart entry fill
    const doneNow = s.slHit || s.allDone || s.entry === 0;

    // ── Signal flip: close trade when EMA is opposite to trade direction ──
    if (!doneNow && s.prevEma9 != null && s.prevEma21 != null) {
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

    const justFinishedAllTPs = s.allDone && !s.slHit; // All TPs hit — immediately find new trade

    // ── First run (prevEma is null): set up initial trade ──
    if (doneNow && s.prevEma9 == null && s.prevEma21 == null) {
      const signal = ema9 > ema21 ? 'buy' : 'sell';
      const dir = signal === 'buy' ? 'long' : 'short';

      // Session filter: skip new entries in Asian session for lower TFs
      if (!isSessionActive(l, new Date())) {
        console.log(`[${l}] Skipping entry — outside active session (Asian chop filter)`);
      } else {
        // Smart entry: set limit order at pullback instead of market entry
        const pullback = atr * SMART_ENTRY_PULLBACK_ATR;
        const limitPrice = dir === 'long' ? livePrice - pullback : livePrice + pullback;

        s.pendingEntry = limitPrice;
        s.pendingDir = dir;
        s.pendingTime = new Date().toISOString();
        s.pendingAtr = atr;
        s.pendingCycle = 1;
        s.dir = dir;
        s.lastSignal = signal;
        console.log(`[${l}] Smart entry PENDING: cycle 1 (${signal}) limit=$${limitPrice.toFixed(2)} (pullback ${pullback.toFixed(2)})`);
      }
    }
    // ── All TPs hit: start new trade after cooldown + EMA spread check ──
    else if (justFinishedAllTPs && s.prevEma9 != null && s.prevEma21 != null) {
      // Check cooldown since allDone was set
      const alltpCooldown = ALLTP_COOLDOWN_MS[l] || 0;
      const allDoneTime = s.allDoneTime ? new Date(s.allDoneTime).getTime() : Date.now();
      const sinceAllTP = Date.now() - allDoneTime;
      const inAllTPCooldown = alltpCooldown > 0 && sinceAllTP < alltpCooldown;

      // Check EMA spread strength — avoid choppy entries when EMAs are barely crossed
      const emaSpread = Math.abs(ema9 - ema21);
      const minSpread = atr * (MIN_EMA_SPREAD_ATR_PCT[l] || 0.10);
      const spreadOK = emaSpread >= minSpread;

      const rsiNeutralAllTP = rsi != null && rsi >= 40 && rsi <= 60;
      if (!inAllTPCooldown && spreadOK && !rsiNeutralAllTP) {
        const signal = ema9 > ema21 ? 'buy' : 'sell';
        const dir = signal === 'buy' ? 'long' : 'short';

        // Session filter
        if (!isSessionActive(l, new Date())) {
          console.log(`[${l}] All TPs hit — waiting for active session (Asian chop filter)`);
        } else {
          // Smart entry: limit at pullback
          const pullback = atr * SMART_ENTRY_PULLBACK_ATR;
          const limitPrice = dir === 'long' ? livePrice - pullback : livePrice + pullback;

          s.pendingEntry = limitPrice;
          s.pendingDir = dir;
          s.pendingTime = new Date().toISOString();
          s.pendingAtr = atr;
          s.pendingCycle = s.cycle + 1;
          s.dir = dir;
          s.lastSignal = signal;
          s.lastFlipTime = new Date().toISOString();
          console.log(`[${l}] All TPs hit — smart entry PENDING: cycle ${s.pendingCycle} (${signal}) limit=$${limitPrice.toFixed(2)} after ${Math.round(sinceAllTP/1000)}s cooldown`);
        }
      } else {
        console.log(`[${l}] All TPs hit — waiting: cooldown=${inAllTPCooldown} spread=${emaSpread.toFixed(2)} minReq=${minSpread.toFixed(2)}`);
      }
    }
    // ── SL hit: enter new trade on fresh crossover OR if EMA already flipped ──
    else if (doneNow && s.prevEma9 != null && s.prevEma21 != null) {
      const crossUp = s.prevEma9 <= s.prevEma21 && ema9 > ema21;
      const crossDn = s.prevEma9 >= s.prevEma21 && ema9 < ema21;

      // Also detect if EMA direction is already OPPOSITE to the closed trade direction
      // (crossover happened gradually and was missed tick-by-tick)
      const currentLong = ema9 > ema21;
      const wasShortTrade = s.dir === 'short';
      const wasLongTrade = s.dir === 'long';
      const alreadyFlipped = (currentLong && wasShortTrade) || (!currentLong && wasLongTrade);

      const cooldownMs = FLIP_COOLDOWN_MS[l] || 0;
      const lastFlip = s.lastFlipTime ? new Date(s.lastFlipTime).getTime() : 0;
      const sinceLast = Date.now() - lastFlip;
      const inCooldown = cooldownMs > 0 && sinceLast < cooldownMs;

      // EMA spread filter
      const emaSpreadSL = Math.abs(ema9 - ema21);
      const minSpreadSL = atr * (MIN_EMA_SPREAD_ATR_PCT[l] || 0.10);
      const spreadOKSL = emaSpreadSL >= minSpreadSL;

      // Enter on: fresh crossover OR already-flipped OR EMA has clear direction
      // (After SL hit, if EMA is still signaling a direction, we should re-enter)
      // RSI filter: skip if RSI is in neutral zone (choppy market)
      const rsiNeutral = rsi != null && rsi >= 40 && rsi <= 60;
      const shouldEnter = !inCooldown && spreadOKSL && !rsiNeutral;

      if (shouldEnter) {
        const dir = currentLong ? 'long' : 'short';
        const signal = currentLong ? 'buy' : 'sell';

        // Session filter
        if (!isSessionActive(l, new Date())) {
          console.log(`[${l}] Crossover detected — skipping entry (outside active session)`);
        } else {
          // Smart entry: limit at pullback
          const pullback = atr * SMART_ENTRY_PULLBACK_ATR;
          const limitPrice = dir === 'long' ? livePrice - pullback : livePrice + pullback;

          s.pendingEntry = limitPrice;
          s.pendingDir = dir;
          s.pendingTime = new Date().toISOString();
          s.pendingAtr = atr;
          s.pendingCycle = s.cycle + 1;
          s.dir = dir;
          s.lastSignal = signal;
          s.lastFlipTime = new Date().toISOString();
          console.log(`[${l}] Smart entry PENDING: cycle ${s.pendingCycle} (${signal}) limit=$${limitPrice.toFixed(2)} | trigger=${crossUp||crossDn ? 'crossover' : 'already-flipped'}`);
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
      entry: s.entry, sl: s.sl, originalSl: s.originalSl, tps: [s.tp1, s.tp2, s.tp3],
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
          // If TP1 was hit, exit at SL price (breakeven or TP1/TP2 level)
          // This ensures a trade that hit TP1 is NOT counted as a loss
          if (s.tp1Hit) {
            exitPrice = s.sl; // SL is at breakeven (or TP1/TP2 if trailing)
          } else {
            exitPrice = lastAlert.price || s.entry;
          }
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
      // WhatsApp alerts disabled — save to database only for dashboard
      alertDetails.push({ ...alert, status: 'saved', alertId });
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