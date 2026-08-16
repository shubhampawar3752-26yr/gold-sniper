import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

// Lightweight live gold price endpoint — returns the current tick price + active trade levels
// Designed for dashboard polling: fast, minimal data, no writes

async function fetchLivePrice(symbol = "GC=F"): Promise<{ price: number; prevClose: number; change: number; changePct: number; marketState: string; timestamp: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=5m`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta || {};
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPreviousClose || 0;
    if (typeof price !== "number" || price <= 0) return null;
    const change = prevClose > 0 ? price - prevClose : 0;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    return {
      price,
      prevClose,
      change,
      changePct,
      marketState: meta.marketState || "unknown",
      timestamp: meta.regularMarketTime || Math.floor(Date.now() / 1000),
    };
  } catch (e) {
    console.error("Live price fetch error:", e.message);
    return null;
  }
}

Deno.serve(async (req) => {
  // Handle CORS for dashboard polling
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const base44 = createClientFromRequest(req);
  const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour12: false });

  // Fetch live price
  const live = await fetchLivePrice("GC=F");

  if (!live) {
    return new Response(JSON.stringify({
      success: false,
      error: "Failed to fetch live price",
      timestamp: now,
    }), { status: 503, headers });
  }

  // Also fetch current trading state to include active levels
  let states: any = null;
  let lastRun: string | null = null;
  let lastTick: any = null;
  try {
    const existing = await base44.asServiceRole.entities.TradingState.list();
    if (existing && existing.length > 0) {
      const rec = existing[0];
      states = (rec as any).states || {};
      lastRun = (rec as any).lastRun || null;
      lastTick = states?.__ticks || null;
    }
  } catch (e) {
    console.error("Error loading state:", e.message);
  }

  // Build active trades summary (exclude __ticks key)
  const activeTrades: any[] = [];
  if (states) {
    for (const key of Object.keys(states)) {
      if (key === "__ticks") continue;
      const s = states[key];
      if (s && s.entry > 0 && !s.slHit && !s.allDone) {
        activeTrades.push({
          timeframe: key,
          direction: s.dir,
          entry: s.entry,
          sl: s.sl,
          tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5,
          tp1Hit: s.tp1Hit, tp2Hit: s.tp2Hit, tp3Hit: s.tp3Hit, tp4Hit: s.tp4Hit, tp5Hit: s.tp5Hit,
          cycle: s.cycle,
          atr: s.atr,
        });
      }
    }
  }

  return new Response(JSON.stringify({
    success: true,
    timestamp: now,
    price: live.price,
    prevClose: live.prevClose,
    change: live.change,
    changePct: live.changePct,
    marketState: live.marketState,
    marketTime: live.timestamp,
    lastMonitorRun: lastRun,
    lastTick: lastTick,
    activeTrades,
    activeCount: activeTrades.length,
  }), { status: 200, headers });
});
