// ═══════════════════════════════════════════════════════════════════════
// GOLD SNIPER — TV SIGNAL ENGINE (2nd Signal Source)
// ═══════════════════════════════════════════════════════════════════════
// Uses @mathieuc/tradingview WebSocket for real-time OHLCV candle data.
// Computes EMA 9/21 crossover + ATR independently from the main engine
// (which uses the scanner API). This is a CONFIRMATION/secondary source.
//
// What it does:
//   1. Opens WebSocket to TradingView
//   2. Fetches 200 OHLCV candles for 6 timeframes (1M, 5M, 15M, 30M, 1H, 4H)
//   3. Computes EMA 9, EMA 21, ATR(14), RSI(14) from raw candle data
//   4. Detects EMA 9/21 crossover (5-candle lookback)
//   5. Gets TA confluence scores via getTA REST API
//   6. Stores signals in tv_signals table for cross-reference
//   7. Closes WebSocket after data collection
//
// Triggered by pg_cron every minute alongside gold-sniper-engine.
// ═══════════════════════════════════════════════════════════════════════

import { Client, getTA } from "https://esm.sh/@mathieuc/tradingview@3.5.2";

const TV_SYMBOL = "OANDA:XAUUSD";
const TIMEFRAMES = [
  { label: "1M", tv: "1" },
  { label: "5M", tv: "5" },
  { label: "15M", tv: "15" },
  { label: "30M", tv: "30" },
  { label: "1H", tv: "60" },
  { label: "4H", tv: "240" },
];
const CANDLE_COUNT = 200;
const WS_TIMEOUT_MS = 15000;

function computeEMA(values, period) {
  const ema = [];
  const multiplier = 2 / (period + 1);
  let prev = values[0];
  ema[0] = prev;
  for (let i = 1; i < values.length; i++) {
    const current = values[i] * multiplier + prev * (1 - multiplier);
    ema[i] = current;
    prev = current;
  }
  return ema;
}

function computeATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function detectCrossover(ema9, ema21, lookback = 5) {
  const start = Math.max(1, ema9.length - lookback);
  for (let i = ema9.length - 1; i >= start; i--) {
    if (i < 1) break;
    const wasBull = ema9[i - 1] > ema21[i - 1];
    const wasBear = ema9[i - 1] < ema21[i - 1];
    const isBull = ema9[i] > ema21[i];
    const isBear = ema9[i] < ema21[i];
    if (wasBear && isBull) return { crossed: true, direction: "bull", candleIndex: i };
    if (wasBull && isBear) return { crossed: true, direction: "bear", candleIndex: i };
  }
  const currentBull = ema9[ema9.length - 1] > ema21[ema21.length - 1];
  return { crossed: false, direction: currentBull ? "bull" : "bear", candleIndex: -1 };
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const log = (level, msg, data) => {
    console.log(`[${level}] ${msg}`);
    fetch(`${SUPABASE_URL}/rest/v1/engine_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ level, message: msg, data: data ?? null, created_at: new Date().toISOString() }),
    }).catch(() => {});
  };

  try {
    log("INFO", "TV Signal Engine: starting");

    // Step 1: TA scores via REST (parallel)
    const taPromise = getTA(TV_SYMBOL, "1").catch((e) => {
      log("WARN", `TV Signal Engine: getTA failed: ${e.message}`);
      return null;
    });

    // Step 2: OHLCV candles via WebSocket
    const candleData = await new Promise((resolve) => {
      const results = new Map();
      let completed = 0;
      let resolved = false;

      const client = new Client();

      const timeout = setTimeout(() => {
        if (!resolved) {
          log("WARN", `TV Signal Engine: WebSocket timeout after ${WS_TIMEOUT_MS}ms (${completed}/${TIMEFRAMES.length} done)`);
          resolved = true;
          client.end();
          resolve(results);
        }
      }, WS_TIMEOUT_MS);

      client.onConnected(() => {
        log("INFO", "TV Signal Engine: WebSocket connected");

        for (const tf of TIMEFRAMES) {
          const chart = new client.Session.Chart();
          chart.setMarket(TV_SYMBOL, { timeframe: tf.tv, range: CANDLE_COUNT });

          chart.onUpdate(() => {
            const periods = chart.periods;
            if (periods.length > 0 && !results.has(tf.label)) {
              const candles = periods
                .map((p) => ({ time: p.time, open: p.open, high: p.max, low: p.min, close: p.close, volume: p.volume }))
                .sort((a, b) => a.time - b.time);

              results.set(tf.label, candles);
              completed++;

              if (completed === TIMEFRAMES.length && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                log("INFO", `TV Signal Engine: All ${TIMEFRAMES.length} timeframes received`);
                client.end();
                resolve(results);
              }
            }
          });

          chart.onError((...errs) => {
            log("ERROR", `TV Signal Engine: Chart error ${tf.label}: ${JSON.stringify(errs)}`);
            completed++;
            if (completed === TIMEFRAMES.length && !resolved) {
              resolved = true;
              clearTimeout(timeout);
              client.end();
              resolve(results);
            }
          });
        }
      });

      client.onError((...errs) => {
        log("ERROR", `TV Signal Engine: WebSocket error: ${JSON.stringify(errs)}`);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.end();
          resolve(results);
        }
      });
    });

    // Step 3: Compute indicators
    const taResult = await taPromise;
    const signals = [];

    for (const tf of TIMEFRAMES) {
      const candles = candleData.get(tf.label);
      if (!candles || candles.length < 30) {
        log("WARN", `TV Signal Engine: ${tf.label} insufficient candles (${candles?.length ?? 0})`);
        signals.push({
          timeframe: tf.label, price: 0, ema9: 0, ema21: 0, atr: 0, rsi: 0,
          emaSpread: 0, crossover: false, direction: null, trend: "bear",
          taAll: taResult?.[tf.tv]?.All ?? null, taMA: taResult?.[tf.tv]?.MA ?? null,
          taOther: taResult?.[tf.tv]?.Other ?? null, candles: candles?.length ?? 0,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const closes = candles.map((c) => c.close);
      const ema9Arr = computeEMA(closes, 9);
      const ema21Arr = computeEMA(closes, 21);
      const atr = computeATR(candles, 14);
      const rsi = computeRSI(closes, 14);
      const ema9 = ema9Arr[ema9Arr.length - 1];
      const ema21 = ema21Arr[ema21Arr.length - 1];
      const price = closes[closes.length - 1];
      const emaSpread = Math.abs(ema9 - ema21) / ema21 * 100;
      const cross = detectCrossover(ema9Arr, ema21Arr, 5);
      const trend = ema9 > ema21 ? "bull" : "bear";

      signals.push({
        timeframe: tf.label, price, ema9, ema21, atr, rsi, emaSpread,
        crossover: cross.crossed, direction: cross.direction, trend,
        taAll: taResult?.[tf.tv]?.All ?? null, taMA: taResult?.[tf.tv]?.MA ?? null,
        taOther: taResult?.[tf.tv]?.Other ?? null, candles: candles.length,
        timestamp: new Date().toISOString(),
      });

      log("INFO", `TV Signal Engine: ${tf.label} EMA9=${ema9.toFixed(2)} EMA21=${ema21.toFixed(2)} ATR=${atr.toFixed(2)} RSI=${rsi.toFixed(1)} ${cross.crossed ? "CROSS " + cross.direction?.toUpperCase() : trend.toUpperCase()} TA=${taResult?.[tf.tv]?.All ?? "?"}`);
    }

    // Step 4: Store in tv_signals table
    const signalPayload = {
      run_time: new Date().toISOString(),
      source: "tv-websocket",
      timeframes: signals.length,
      signals: JSON.stringify(signals),
      confluence_bull: signals.filter((s) => s.trend === "bull").length,
      confluence_bear: signals.filter((s) => s.trend === "bear").length,
      crossovers: JSON.stringify(signals.filter((s) => s.crossover).map((s) => ({
        timeframe: s.timeframe, direction: s.direction, ema9: s.ema9,
        ema21: s.ema21, atr: s.atr, rsi: s.rsi, ta_all: s.taAll,
      }))),
      created_at: new Date().toISOString(),
    };

    await fetch(`${SUPABASE_URL}/rest/v1/tv_signals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(signalPayload),
    }).catch((e) => {
      log("ERROR", `TV Signal Engine: Failed to store: ${e.message}`);
    });

    // Step 5: Cross-reference with main engine
    const mainStateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trading_states?order=updated_at.desc&limit=1&select=states`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    ).catch(() => null);

    let confluenceReport = "";
    if (mainStateRes?.ok) {
      const mainData = await mainStateRes.json();
      if (mainData?.[0]?.states) {
        const mainStates = typeof mainData[0].states === "string"
          ? JSON.parse(mainData[0].states) : mainData[0].states;
        const matches = [], mismatches = [];
        for (const sig of signals) {
          const mainTf = mainStates[sig.timeframe];
          if (mainTf && mainTf.trend) {
            if (mainTf.trend === sig.trend) matches.push(sig.timeframe);
            else mismatches.push(`${sig.timeframe}(TV:${sig.trend} vs Main:${mainTf.trend})`);
          }
        }
        confluenceReport = `Match: ${matches.length}/${matches.length + mismatches.length} TFs`;
        if (mismatches.length > 0) confluenceReport += ` | Conflicts: ${mismatches.join(", ")}`;
      }
    }

    const elapsed = Date.now() - startTime;
    log("INFO", `TV Signal Engine: complete in ${elapsed}ms — ${signals.length} TFs, ${confluenceReport || "no main state"}`);

    return new Response(JSON.stringify({
      status: "ok", elapsed_ms: elapsed, source: "tv-websocket",
      signals, confluence: confluenceReport, ta_scores: taResult ? "available" : "unavailable",
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    log("ERROR", `TV Signal Engine: ${err.message}\n${err.stack}`);
    return new Response(JSON.stringify({
      status: "error", error: err.message, elapsed_ms: elapsed,
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
