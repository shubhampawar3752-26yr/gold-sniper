// ── AI Candle Scanner Agent ──
// Scans candlestick patterns + momentum across all timeframes
// Uses TradingView scanner for indicators + OHLC, TwelveData for historical candles (smart cached)
// Feeds smart entry/SL/TP recommendations to the signal engine

const TFS = [
  { l: '1M', tv: '1', td: '1min', mins: 1 },
  { l: '5M', tv: '5', td: '5min', mins: 5 },
  { l: '15M', tv: '15', td: '15min', mins: 15 },
  { l: '30M', tv: '30', td: '30min', mins: 30 },
  { l: '1H', tv: '60', td: '1h', mins: 60 },
  { l: '4H', tv: '240', td: '4h', mins: 240 },
];

const TV_SYMBOL = 'OANDA:XAUUSD';
const TV_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Origin': 'https://www.tradingview.com' };
const TD_SYMBOL = 'XAU/USD';
const TD_KEY = Deno.env.get('TWELVE_DATA_API_KEY') || '';

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// In-memory cache for bar-change detection (survives within warm instance)
const barCache: Record<string, { barTime: number; candles: any[] }> = {};

function getBarTime(tfMins: number): number {
  const now = Date.now();
  return Math.floor(now / (tfMins * 60 * 1000)) * (tfMins * 60 * 1000);
}

// ── Fetch TradingView indicators + per-timeframe OHLC ──
async function fetchTVIndicators(): Promise<Record<string, any>> {
  const fields: string[] = [];
  for (const tf of TFS) {
    fields.push(`EMA9|${tf.tv}`, `EMA21|${tf.tv}`, `ATR|${tf.tv}`, `RSI|${tf.tv}`,
      `MACD.macd|${tf.tv}`, `MACD.signal|${tf.tv}`, `Recommend.All|${tf.tv}`, `close|${tf.tv}`);
    fields.push(`open|${tf.tv}`, `high|${tf.tv}`, `low|${tf.tv}`);
  }
  fields.push('EMA9', 'EMA21', 'ATR', 'RSI', 'close', 'open', 'high', 'low');

  const url = `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(TV_SYMBOL)}&fields=${fields.join(',')}`;
  const r = await fetch(url, { headers: TV_HEADERS });
  if (!r.ok) throw new Error(`TV scanner ${r.status}`);
  const d: any = await r.json();
  return d;
}

// ── Build a candle from TradingView per-timeframe OHLC ──
function buildTVCandle(tvData: any, tf: any): any | null {
  const o = tvData[`open|${tf.tv}`];
  const h = tvData[`high|${tf.tv}`];
  const l = tvData[`low|${tf.tv}`];
  const c = tvData[`close|${tf.tv}`] || tvData['close'];
  if (o == null || h == null || l == null || c == null) return null;
  return { open: String(o), high: String(h), low: String(l), close: String(c) };
}

// ── Fetch OHLC candles with smart caching + TradingView fallback ──
async function fetchCandles(tf: any, tvData: any, prevCandle: any): Promise<{ candles: any[]; source: string }> {
  const currentBarTime = getBarTime(tf.mins);
  const tvCandle = buildTVCandle(tvData, tf);
  const currentClose = tvData[`close|${tf.tv}`] || tvData['close'] || 0;

  // Check in-memory cache: if bar hasn't changed, reuse cached candles with updated close
  const cached = barCache[tf.l];
  if (cached && cached.barTime === currentBarTime && cached.candles.length >= 2) {
    const freshCandles = [...cached.candles];
    if (freshCandles.length > 0 && tvCandle) {
      // Update current bar with live TV OHLC
      freshCandles[freshCandles.length - 1] = tvCandle;
    }
    return { candles: freshCandles, source: 'cache' };
  }

  // Bar changed or no cache — try TwelveData
  const tdCandles = await fetchCandlesFromTwelveData(tf);
  if (tdCandles.length >= 2) {
    barCache[tf.l] = { barTime: currentBarTime, candles: tdCandles };
    return { candles: tdCandles, source: 'twelvedata' };
  }

  // TwelveData failed — use DB previous candle + current TV candle
  if (prevCandle && tvCandle) {
    // Check if prevCandle is from a different bar (not the current bar)
    const prevBarTime = prevCandle.barTime || 0;
    if (prevBarTime < currentBarTime) {
      const combined = [prevCandle, tvCandle];
      barCache[tf.l] = { barTime: currentBarTime, candles: combined };
      return { candles: combined, source: 'tv+db' };
    }
    // Same bar — just use current TV candle
    return { candles: [tvCandle], source: 'tv-only' };
  }

  // No prev candle, no TwelveData — just use current TV candle
  if (tvCandle) {
    barCache[tf.l] = { barTime: currentBarTime, candles: [tvCandle] };
    return { candles: [tvCandle], source: 'tv-only' };
  }

  return { candles: [], source: 'none' };
}

// ── Raw TwelveData fetch ──
async function fetchCandlesFromTwelveData(tf: any): Promise<any[]> {
  if (!TD_KEY) return [];
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(TD_SYMBOL)}&interval=${tf.td}&outputsize=5&apikey=${TD_KEY}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const d: any = await r.json();
    if (d.status === 'error' || (d.message && d.message.includes('credits'))) return [];
    return (d?.values || []).slice(0, 3).reverse();
  } catch { return []; }
}

// ── Candlestick Pattern Detection (15 patterns) ──
interface Pattern { name: string; type: 'bullish' | 'bearish' | 'neutral'; confidence: number; }

function detectPatterns(candles: any[]): Pattern[] {
  const patterns: Pattern[] = [];
  if (candles.length < 2) return patterns;

  const cur = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles.length >= 3 ? candles[candles.length - 3] : null;

  const o = parseFloat(cur.open), c = parseFloat(cur.close), h = parseFloat(cur.high), l = parseFloat(cur.low);
  const o1 = parseFloat(prev.open), c1 = parseFloat(prev.close), h1 = parseFloat(prev.high), l1 = parseFloat(prev.low);
  const o2 = prev2 ? parseFloat(prev2.open) : 0, c2 = prev2 ? parseFloat(prev2.close) : 0;

  const body = Math.abs(c - o);
  const range = h - l || 0.001;
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const bodyPct = body / range;

  if (c1 < o1 && c > o && c >= o1 && o <= c1 && body > Math.abs(c1 - o1))
    patterns.push({ name: 'Bullish Engulfing', type: 'bullish', confidence: 0.85 });
  if (c1 > o1 && c < o && c <= o1 && o >= c1 && body > Math.abs(c1 - o1))
    patterns.push({ name: 'Bearish Engulfing', type: 'bearish', confidence: 0.85 });
  if (lowerWick > body * 2 && upperWick < body * 0.5 && bodyPct < 0.4)
    patterns.push({ name: 'Hammer', type: 'bullish', confidence: 0.75 });
  if (upperWick > body * 2 && lowerWick < body * 0.5 && bodyPct < 0.4)
    patterns.push({ name: 'Shooting Star', type: 'bearish', confidence: 0.75 });
  if (bodyPct < 0.1)
    patterns.push({ name: 'Doji', type: 'neutral', confidence: 0.5 });
  if (lowerWick > range * 0.6 && bodyPct < 0.35)
    patterns.push({ name: 'Bullish Pin Bar', type: 'bullish', confidence: 0.7 });
  if (upperWick > range * 0.6 && bodyPct < 0.35)
    patterns.push({ name: 'Bearish Pin Bar', type: 'bearish', confidence: 0.7 });
  if (prev2 && c2 < o2 && Math.abs(c1 - o1) < Math.abs(c2 - o2) * 0.5 && c > o && c > (o2 + c2) / 2)
    patterns.push({ name: 'Morning Star', type: 'bullish', confidence: 0.9 });
  if (prev2 && c2 > o2 && Math.abs(c1 - o1) < Math.abs(c2 - o2) * 0.5 && c < o && c < (o2 + c2) / 2)
    patterns.push({ name: 'Evening Star', type: 'bearish', confidence: 0.9 });
  if (bodyPct > 0.9 && c > o)
    patterns.push({ name: 'Bullish Marubozu', type: 'bullish', confidence: 0.8 });
  if (bodyPct > 0.9 && c < o)
    patterns.push({ name: 'Bearish Marubozu', type: 'bearish', confidence: 0.8 });
  if (prev2 && c > o && c1 > o1 && c2 > o2 && c > c1 && c1 > c2 && o > o1 && o1 > o2)
    patterns.push({ name: 'Three White Soldiers', type: 'bullish', confidence: 0.92 });
  if (prev2 && c < o && c1 < o1 && c2 < o2 && c < c1 && c1 < c2 && o < o1 && o1 < o2)
    patterns.push({ name: 'Three Black Crows', type: 'bearish', confidence: 0.92 });
  if (h < h1 && l > l1)
    patterns.push({ name: 'Inside Bar', type: 'neutral', confidence: 0.4 });
  if (h > h1 && l < l1)
    patterns.push({ name: 'Outside Bar', type: c > o ? 'bullish' : 'bearish', confidence: 0.65 });

  return patterns;
}

// ── Support/Resistance from candles ──
function calcPivots(candles: any[]): any {
  if (candles.length < 2) return { pivot: 0, support: 0, resistance: 0 };
  const prev = candles[candles.length - 2];
  const h = parseFloat(prev.high), l = parseFloat(prev.low), c = parseFloat(prev.close);
  const pivot = (h + l + c) / 3;
  return { pivot, support: 2 * pivot - h, resistance: 2 * pivot - l, support2: pivot - (h - l), resistance2: pivot + (h - l) };
}

// ── AI Recommendation Engine ──
function generateRecommendation(patterns: Pattern[], momentum: any, trend: any, pivots: any, atr: number, price: number) {
  let bullScore = 0, bearScore = 0;

  for (const p of patterns) {
    if (p.type === 'bullish') bullScore += p.confidence * 2;
    else if (p.type === 'bearish') bearScore += p.confidence * 2;
  }
  if (momentum.rsiSignal === 'oversold') bullScore += 1.5;
  else if (momentum.rsiSignal === 'overbought') bearScore += 1.5;
  else if (momentum.rsiSignal === 'bullish') bullScore += 0.5;
  else if (momentum.rsiSignal === 'bearish') bearScore += 0.5;
  if (momentum.macdCross === 'bullish') bullScore += 1.5;
  else if (momentum.macdCross === 'bearish') bearScore += 1.5;
  if (trend.trendDirection === 'bullish') bullScore += trend.trendStrength * 2;
  else if (trend.trendDirection === 'bearish') bearScore += trend.trendStrength * 2;
  if (trend.aboveEma9) bullScore += 0.5; else bearScore += 0.5;
  if (trend.aboveEma21) bullScore += 0.3; else bearScore += 0.3;
  if (pivots.support && price <= pivots.support * 1.002) bullScore += 0.7;
  if (pivots.resistance && price >= pivots.resistance * 0.998) bearScore += 0.7;
  if (trend.recommend != null) {
    if (trend.recommend > 0.3) bullScore += Math.abs(trend.recommend) * 2;
    else if (trend.recommend < -0.3) bearScore += Math.abs(trend.recommend) * 2;
  }

  const totalScore = bullScore - bearScore;
  let recommendation = 'neutral', confidence = 0.5;
  if (totalScore >= 5) { recommendation = 'strong_buy'; confidence = 0.95; }
  else if (totalScore >= 2.5) { recommendation = 'buy'; confidence = 0.75; }
  else if (totalScore >= 0.5) { recommendation = 'weak_buy'; confidence = 0.6; }
  else if (totalScore <= -5) { recommendation = 'strong_sell'; confidence = 0.95; }
  else if (totalScore <= -2.5) { recommendation = 'sell'; confidence = 0.75; }
  else if (totalScore <= -0.5) { recommendation = 'weak_sell'; confidence = 0.6; }

  const r = atr * 2;
  const dir = totalScore >= 0 ? 'long' : 'short';
  let entry = price, sl = dir === 'long' ? price - r : price + r;
  let tp1 = dir === 'long' ? price + r : price - r;
  let tp2 = dir === 'long' ? price + r * 2 : price - r * 2;
  let tp3 = dir === 'long' ? price + r * 3 : price - r * 3;
  let riskReward = 1.5;
  if (recommendation === 'neutral') { entry = 0; sl = 0; tp1 = 0; tp2 = 0; tp3 = 0; riskReward = 0; }

  return { recommendation, confidence, bullScore, bearScore, totalScore, direction: dir, suggested_entry: entry, suggested_sl: sl, suggested_tp1: tp1, suggested_tp2: tp2, suggested_tp3: tp3, risk_reward: riskReward };
}

// ── Store in Supabase ──
async function storeAnalysis(analysis: any) {
  await fetch(`${SUPA_URL}/rest/v1/ai_candle_analysis`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(analysis),
  });
}


// ── Read previous candle from ai_candle_analysis (persists across invocations) ──
async function readPrevCandles(): Promise<Record<string, any>> {
  try {
    // Read most recent analysis for each timeframe
    const r = await fetch(`${SUPA_URL}/rest/v1/ai_candle_analysis?select=timeframe,metadata&order=created_at.desc&limit=24`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    if (!r.ok) return {};
    const rows = await r.json();
    const result: Record<string, any> = {};
    for (const row of rows) {
      const tf = row.timeframe;
      if (result[tf]) continue; // already have the most recent for this TF
      const meta = row.metadata || {};
      if (meta.lastCandle) {
        result[tf] = meta.lastCandle; // { open, high, low, close, barTime }
      }
    }
    return result;
  } catch { return {}; }
}

// ── Main handler ──
Deno.serve(async (req) => {
  try {
    const t_start = Date.now();
    const tvData = await fetchTVIndicators();
    const livePrice = tvData['close'] || tvData['EMA9'] || tvData['close|1'] || 0;
    const results: any[] = [];
    const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
    const sources: Record<string, string> = {};
    let tdCalls = 0;
    const prevCandles = await readPrevCandles();

    for (const tf of TFS) {
      const tv = tf.tv;
      const price = tvData[`close|${tv}`] || livePrice;
      const atr = tvData[`ATR|${tv}`] || 0;
      const rsi = tvData[`RSI|${tv}`];
      const macd = tvData[`MACD.macd|${tv}`];
      const macdSignal = tvData[`MACD.signal|${tv}`];
      const macdHist = macd != null && macdSignal != null ? macd - macdSignal : 0;
      const ema9 = tvData[`EMA9|${tv}`];
      const ema21 = tvData[`EMA21|${tv}`];
      const recommend = tvData[`Recommend.All|${tv}`];

      // Momentum
      let rsiSignal = 'neutral';
      if (rsi >= 70) rsiSignal = 'overbought';
      else if (rsi <= 30) rsiSignal = 'oversold';
      else if (rsi >= 55) rsiSignal = 'bullish';
      else if (rsi <= 45) rsiSignal = 'bearish';

      let macdCross = 'none';
      if (macd != null && macdSignal != null) {
        if (macd > macdSignal && macdHist > 0) macdCross = 'bullish';
        else if (macd < macdSignal && macdHist < 0) macdCross = 'bearish';
      }

      // Trend
      const emaSpread = ema9 - ema21;
      const emaSpreadPct = ema21 ? (emaSpread / ema21) * 100 : 0;
      let trendDir = 'sideways';
      if (ema9 > ema21) trendDir = 'bullish';
      else if (ema9 < ema21) trendDir = 'bearish';
      let strength = Math.min(Math.abs(emaSpreadPct) / 0.5, 1);
      if (recommend != null) strength = (strength + Math.abs(recommend)) / 2;
      strength = Math.min(strength, 1);

      // Fetch candles with smart caching + TradingView fallback
      const { candles, source } = await fetchCandles(tf, tvData, prevCandles[tf.l]);
      sources[tf.l] = source;
      if (source === 'twelvedata') tdCalls++;

      const patterns = detectPatterns(candles);
      const pivots = calcPivots(candles);

      // AI recommendation
      const rec = generateRecommendation(patterns, { rsi, rsiSignal, macdCross }, { trendDirection: trendDir, trendStrength: strength, recommend, aboveEma9: price > ema9, aboveEma21: price > ema21 }, pivots, atr, price);
      const topPattern = [...patterns].sort((a, b) => b.confidence - a.confidence)[0];

      const analysis = {
        timeframe: tf.l, price,
        pattern: topPattern?.name || 'none',
        pattern_type: topPattern?.type || 'neutral',
        pattern_confidence: topPattern?.confidence || 0,
        rsi, rsi_signal: rsiSignal,
        macd, macd_signal: macdSignal, macd_histogram: macdHist, macd_cross: macdCross,
        ema9, ema21, ema_spread: emaSpread,
        trend_strength: strength, trend_direction: trendDir,
        support: pivots.support, resistance: pivots.resistance, pivot: pivots.pivot,
        recommendation: rec.recommendation, confidence: rec.confidence,
        suggested_entry: rec.suggested_entry, suggested_sl: rec.suggested_sl,
        suggested_tp1: rec.suggested_tp1, suggested_tp2: rec.suggested_tp2, suggested_tp3: rec.suggested_tp3,
        risk_reward: rec.risk_reward,
        patterns_detected: patterns.map(p => ({ name: p.name, type: p.type, confidence: p.confidence })),
        metadata: { recommendAll: recommend, bullScore: rec.bullScore, bearScore: rec.bearScore, totalScore: rec.totalScore, atr, candleCount: candles.length, source, lastCandle: candles.length > 0 ? { open: candles[candles.length-1].open, high: candles[candles.length-1].high, low: candles[candles.length-1].low, close: candles[candles.length-1].close, barTime: getBarTime(tf.mins) } : null },
      };

      await storeAnalysis(analysis);
      results.push(analysis);
    }

    const duration_ms = Date.now() - t_start;
    return new Response(JSON.stringify({
      success: true, timestamp: now, price: livePrice,
      td_calls: tdCalls,
      duration_ms,
      sources,
      timeframes: results.map(r => ({
        tf: r.timeframe, price: r.price,
        pattern: r.pattern, patternType: r.pattern_type, patternConfidence: r.pattern_confidence,
        rsi: r.rsi?.toFixed(1), rsiSignal: r.rsi_signal,
        macdCross: r.macd_cross, trend: r.trend_direction, trendStrength: r.trend_strength?.toFixed(2),
        recommendation: r.recommendation, confidence: r.confidence,
        direction: r.suggested_entry > 0 ? (r.suggested_sl < r.suggested_entry ? 'long' : 'short') : 'none',
        entry: r.suggested_entry?.toFixed(2), sl: r.suggested_sl?.toFixed(2),
        tp1: r.suggested_tp1?.toFixed(2), tp2: r.suggested_tp2?.toFixed(2), tp3: r.suggested_tp3?.toFixed(2),
        support: r.support?.toFixed(2), resistance: r.resistance?.toFixed(2),
        patternsDetected: r.patterns_detected?.length || 0,
        candleCount: r.metadata?.candleCount || 0,
        source: r.metadata?.source || '?',
        bullScore: r.metadata?.bullScore?.toFixed(1), bearScore: r.metadata?.bearScore?.toFixed(1),
      })),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message, stack: (e as Error).stack?.slice(0, 500) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});