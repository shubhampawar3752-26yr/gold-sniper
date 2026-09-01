const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWELVE_DATA_KEY = Deno.env.get('TWELVE_DATA_API_KEY') || '';
const ALPHA_KEY = Deno.env.get('ALPHA_VANTAGE_API_KEY') || '';

const TV_SYMBOL = 'OANDA:XAUUSD';
const TV_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Origin': 'https://www.tradingview.com' };

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const forceUpdate = new URL(req.url).searchParams.get('force') === 'true' || 
                      (await req.clone().json().catch(() => ({})))?.force === 'true' ||
                      (await req.clone().text().catch(() => '')).includes('force');

  // Read current prevClose via atomic RPC (no race condition)
  let dbPrevClose = 0, dbPrevDate = '', dbData: any = {};
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/get_prev_close`, {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await r.json();
    if (data && data.value) {
      dbPrevClose = data.value;
      dbPrevDate = data.date || '';
      dbData = data;
    }
  } catch (e) { console.error('get_prev_close failed:', (e as Error).message); }

  // Skip if already updated today (unless force)
  if (dbPrevDate === today && dbPrevClose > 0 && !forceUpdate) {
    return new Response(JSON.stringify({
      success: true, ...dbData, skipped: true, reason: 'Already updated today'
    }), { status: 200, headers });
  }

  let prevClose = 0, open = 0, high = 0, low = 0, close = 0;
  let source = '';

  // ── Source 1: TwelveData ──
  if (TWELVE_DATA_KEY) {
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
          open = parseFloat(data?.open) || 0;
          high = parseFloat(data?.high) || 0;
          low = parseFloat(data?.low) || 0;
          close = parseFloat(data?.close) || 0;
          console.log(`TwelveData: prevClose=${prevClose} open=${open} high=${high} low=${low}`);
        }
      }
    } catch (e) { console.error('TwelveData failed:', (e as Error).message); }
  }

  // ── Source 2: TradingView scanner ──
  if (prevClose === 0) {
    try {
      const url = `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(TV_SYMBOL)}&fields=open,high,low,close,change_abs`;
      const r = await fetch(url, { headers: TV_HEADERS });
      if (r.ok) {
        const data = await r.json();
        const tvClose = parseFloat(data?.close);
        const tvOpen = parseFloat(data?.open);
        const changeAbs = parseFloat(data?.change_abs);
        if (!isNaN(tvClose) && tvClose > 0 && !isNaN(changeAbs)) {
          prevClose = tvClose - changeAbs;
          if (prevClose > 0) {
            source = 'tradingview';
            open = parseFloat(data?.open) || 0;
            high = parseFloat(data?.high) || 0;
            low = parseFloat(data?.low) || 0;
            close = tvClose;
            console.log(`TradingView: prevClose=${prevClose} open=${open} high=${high} low=${low}`);
          }
        }
      }
    } catch (e) { console.error('TradingView failed:', (e as Error).message); }
  }

  // ── Source 3: Alpha Vantage ──
  if (prevClose === 0 && ALPHA_KEY) {
    try {
      const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=XAUUSD&apikey=${ALPHA_KEY}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (r.ok) {
        const data = await r.json();
        const gq = data?.['Global Quote'];
        const pc = parseFloat(gq?.['08. previous close']);
        if (!isNaN(pc) && pc > 0) {
          prevClose = pc;
          source = 'alphavantage';
          open = parseFloat(gq?.['02. open']) || 0;
          high = parseFloat(gq?.['03. high']) || 0;
          low = parseFloat(gq?.['04. low']) || 0;
          close = parseFloat(gq?.['05. price']) || 0;
          console.log(`Alpha Vantage: prevClose=${prevClose}`);
        }
      }
    } catch (e) { console.error('Alpha Vantage failed:', (e as Error).message); }
  }

  // ── Source 4: livepriceofgold.com ──
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
          const hMatch = html.match(/data-high="([\d.]+)"/);
          const lMatch = html.match(/data-low="([\d.]+)"/);
          if (hMatch) high = parseFloat(hMatch[1]);
          if (lMatch) low = parseFloat(lMatch[1]);
          open = prevClose;
          console.log(`LPOG: prevClose=${prevClose}`);
        }
      }
    } catch (e) { console.error('LPOG failed:', (e as Error).message); }
  }

  // ── Source 5: DB fallback ──
  if (prevClose === 0 && dbPrevClose > 0) {
    prevClose = dbPrevClose;
    source = 'db-fallback';
    open = dbData.open || 0;
    high = dbData.high || 0;
    low = dbData.low || 0;
    close = dbData.close || 0;
    console.log(`DB fallback: prevClose=${dbPrevClose}`);
  }

  if (prevClose === 0) {
    return new Response(JSON.stringify({
      success: false, error: 'All sources failed'
    }), { status: 503, headers });
  }

  const ohlcData = {
    value: prevClose, open: open || 0, high: high || 0, low: low || 0,
    close: close || 0, source, date: today, updated: now
  };

  // Update trading_states.states.__prevClose (this is what get_prev_close reads)
  try {
    const rpcBody = JSON.stringify({ p_data: ohlcData });
    const wr = await fetch(`${SUPA_URL}/rest/v1/rpc/update_prev_close_atomic`, {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: rpcBody
    });
    if (!wr.ok) {
      const errText = await wr.text();
      console.error('update_prev_close_atomic failed:', wr.status, errText);
      // Fallback: update spot_price_cache directly
      const spcBody = { previous_day_close: prevClose, day_open: open || 0, day_high: high || 0, day_low: low || 0, day_open_date: today, fetched_at: now };
      await fetch(`${SUPA_URL}/rest/v1/spot_price_cache?id=eq.1`, {
        method: 'PATCH',
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(spcBody)
      });
    }
    console.log('prev_close updated in trading_states');
  } catch (e) {
    console.error('DB update failed:', (e as Error).message);
    return new Response(JSON.stringify({ success: false, error: 'DB write failed' }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ success: true, ...ohlcData, skipped: false }), { status: 200, headers });
});
