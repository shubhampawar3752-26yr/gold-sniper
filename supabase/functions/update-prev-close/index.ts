const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWELVE_DATA_KEY = Deno.env.get('TWELVE_DATA_API_KEY')!;

// ── Daily OHLC + Previous Close price logic ──
// Fetches: previous close, open, high, low, close, change
// Source priority:
//   1. TradingView scanner -> open, high, low, close, change_abs (prevClose = close - change_abs)
//   2. TwelveData quote API -> previous_close, open, high, low, close
//   3. Alpha Vantage -> GLOBAL_QUOTE -> previous close, open, high, low
//   4. livepriceofgold.com -> data-open (prevClose), HTML scrape for high/low
//   5. DB fallback -> keep last known good values
//
// Smart: if already updated today, skip (prevent stale overwrite)

const TV_SYMBOL = 'OANDA:XAUUSD';
const TV_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Origin': 'https://www.tradingview.com' };

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Read current DB state first (for fallback)
  let dbId = 0, dbStates: any = {};
  let dbPrevClose = 0, dbPrevDate = '';
  try {
    const stateResp = await fetch(`${SUPA_URL}/rest/v1/trading_states?limit=1`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    const stateData = await stateResp.json();
    if (stateData && stateData.length > 0) {
      dbId = stateData[0].id;
      dbStates = stateData[0].states || {};
      dbPrevClose = dbStates?.__prevClose?.value || 0;
      dbPrevDate = dbStates?.__prevClose?.date || '';
    }
  } catch (e) { console.error('DB read failed:', (e as Error).message); }

  // If already updated today, skip (unless ?force=true)
  const forceUpdate = new URL(req.url).searchParams.get('force') === 'true';
  if (dbPrevDate === today && dbPrevClose > 0 && !forceUpdate) {
    return new Response(JSON.stringify({
      success: true,
      ...dbStates.__prevClose,
      skipped: true,
      reason: 'Already updated today'
    }), { status: 200, headers });
  }

  let prevClose = 0, open = 0, high = 0, low = 0, close = 0;
  let source = '';

  // ── Source 1: TradingView scanner ──
  if (prevClose === 0) {
    try {
      const url = `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(TV_SYMBOL)}&fields=open,high,low,close,change_abs`;
      const r = await fetch(url, { headers: TV_HEADERS });
      if (r.ok) {
        const data = await r.json();
        const tvClose = parseFloat(data?.close);
        const tvOpen = parseFloat(data?.open);
        const tvHigh = parseFloat(data?.high);
        const tvLow = parseFloat(data?.low);
        const changeAbs = parseFloat(data?.change_abs);

        if (!isNaN(tvClose) && !isNaN(changeAbs) && tvClose > 0 && changeAbs > 0) {
          prevClose = tvClose - changeAbs;
        }
        if (!isNaN(tvOpen) && tvOpen > 0) open = tvOpen;
        if (!isNaN(tvHigh) && tvHigh > 0) high = tvHigh;
        if (!isNaN(tvLow) && tvLow > 0) low = tvLow;
        if (!isNaN(tvClose) && tvClose > 0) close = tvClose;

        // Fallback prevClose from open if change_abs missing
        if (prevClose === 0 && open > 0) prevClose = open;

        if (prevClose > 0) {
          source = 'tradingview';
          console.log(`TradingView: prevClose=${prevClose} open=${open} high=${high} low=${low} close=${close}`);
        }
      }
    } catch (e) { console.error('TradingView failed:', (e as Error).message); }
  }

  // ── Source 2: TwelveData quote API ──
  if (prevClose === 0) {
    try {
      const r = await fetch(`https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${TWELVE_DATA_KEY}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (r.ok) {
        const data = await r.json();
        const pc = parseFloat(data?.previous_close);
        if (!isNaN(pc) && pc > 0) {
          prevClose = pc;
          source = 'twelvedata';
          open = parseFloat(data?.open) || open;
          high = parseFloat(data?.high) || high;
          low = parseFloat(data?.low) || low;
          close = parseFloat(data?.close) || close;
          console.log(`TwelveData: prevClose=${prevClose} open=${open} high=${high} low=${low} close=${close}`);
        }
      }
    } catch (e) { console.error('TwelveData failed:', (e as Error).message); }
  }

  // ── Source 3: Alpha Vantage ──
  if (prevClose === 0) {
    try {
      const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=GC=F&apikey=${Deno.env.get('ALPHA_VANTAGE_API_KEY')}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (r.ok) {
        const data = await r.json();
        const gq = data?.['Global Quote'];
        const pc = parseFloat(gq?.['08. previous close']);
        if (!isNaN(pc) && pc > 0) {
          prevClose = pc;
          source = 'alphavantage';
          open = parseFloat(gq?.['02. open']) || open;
          high = parseFloat(gq?.['03. high']) || high;
          low = parseFloat(gq?.['04. low']) || low;
          close = parseFloat(gq?.['05. price']) || close;
          console.log(`Alpha Vantage: prevClose=${prevClose} open=${open} high=${high} low=${low} close=${close}`);
        }
      }
    } catch (e) { console.error('Alpha Vantage failed:', (e as Error).message); }
  }

  // ── Source 4: livepriceofgold.com HTML scrape ──
  if (prevClose === 0) {
    try {
      const r = await fetch('https://www.livepriceofgold.com/', {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
      });
      if (r.ok) {
        const html = await r.text();
        let m = html.match(/data-open="([\d.]+)"/);
        if (!m) m = html.match(/prev(?:ious)?\s*close[^\d]*(\d{3,5}\.\d+)/i);
        if (m) {
          prevClose = parseFloat(m[1]);
          source = 'livepriceofgold';
          // Try to extract high/low from HTML
          const hMatch = html.match(/data-high="([\d.]+)"/);
          const lMatch = html.match(/data-low="([\d.]+)"/);
          if (hMatch) high = parseFloat(hMatch[1]);
          if (lMatch) low = parseFloat(lMatch[1]);
          open = prevClose; // open ≈ prevClose for this source
          console.log(`livepriceofgold: prevClose=${prevClose} high=${high} low=${low}`);
        }
      }
    } catch (e) { console.error('LPOG failed:', (e as Error).message); }
  }

  // ── Source 5: DB fallback ──
  if (prevClose === 0 && dbPrevClose > 0) {
    prevClose = dbPrevClose;
    source = 'db-fallback';
    open = dbStates?.__prevClose?.open || 0;
    high = dbStates?.__prevClose?.high || 0;
    low = dbStates?.__prevClose?.low || 0;
    close = dbStates?.__prevClose?.close || 0;
    console.log(`DB fallback: prevClose=${dbPrevClose}`);
  }

  if (prevClose === 0) {
    return new Response(JSON.stringify({
      success: false,
      error: 'All sources failed and no DB fallback available'
    }), { status: 503, headers });
  }

  // Store everything in trading_states
  const ohlcData = {
    value: prevClose,
    open: open || 0,
    high: high || 0,
    low: low || 0,
    close: close || 0,
    source,
    date: today,
    updated: now
  };

  if (dbId > 0) {
    dbStates.__prevClose = ohlcData;
    await fetch(`${SUPA_URL}/rest/v1/trading_states?id=eq.${dbId}`, {
      method: 'PATCH',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ states: dbStates })
    });
  }

  return new Response(JSON.stringify({
    success: true,
    ...ohlcData,
    skipped: false
  }), { status: 200, headers });
});
