const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWELVE_DATA_KEY = Deno.env.get('TWELVE_DATA_API_KEY')!;

// ── Previous close price logic ──
// Gold trades nearly 24/5 (Sun 11pm – Fri 10:30pm IST, with a 1-hour daily break 10:30–11:00pm IST).
// "Previous close" = the settlement price from the previous trading day.
//
// Source priority (most reliable first):
//   1. TwelveData quote API -> previous_close field
//   2. Alpha Vantage -> GLOBAL_QUOTE -> 08. previous close
//   3. livepriceofgold.com -> data-open attribute (today's open = yesterday's close)
//   4. DB fallback -> keep last known good value (don't overwrite with 0)
//
// Smart: if already updated today, skip (prevent stale overwrite from repeated calls)

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // Get today's date in IST
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Read current DB state first (for fallback)
  let dbPrevClose = 0, dbPrevDate = '', dbId = 0, dbStates: any = {};
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

  // If already updated today, skip (prevent stale overwrite)
  if (dbPrevDate === today && dbPrevClose > 0) {
    return new Response(JSON.stringify({
      success: true,
      prevClose: dbPrevClose,
      source: dbStates?.__prevClose?.source || 'db',
      updated: dbStates?.__prevClose?.updated || now,
      skipped: true,
      reason: 'Already updated today'
    }), { status: 200, headers });
  }

  let prevClose = 0;
  let source = '';

  // ── Source 1: TwelveData quote API ──
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
          console.log(`TwelveData prevClose: ${pc}`);
        }
      }
    } catch (e) { console.error('TwelveData failed:', (e as Error).message); }
  }

  // ── Source 2: Alpha Vantage ──
  if (prevClose === 0) {
    try {
      const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=GC=F&apikey=${Deno.env.get('ALPHA_VANTAGE_API_KEY')}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (r.ok) {
        const data = await r.json();
        const pc = parseFloat(data?.['Global Quote']?.['08. previous close']);
        if (!isNaN(pc) && pc > 0) {
          prevClose = pc;
          source = 'alphavantage';
          console.log(`Alpha Vantage prevClose: ${pc}`);
        }
      }
    } catch (e) { console.error('Alpha Vantage failed:', (e as Error).message); }
  }

  // ── Source 3: livepriceofgold.com HTML scrape ──
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
          console.log(`livepriceofgold prevClose: ${prevClose}`);
        }
      }
    } catch (e) { console.error('LPOG failed:', (e as Error).message); }
  }

  // ── Source 4: DB fallback — keep last known good value ──
  if (prevClose === 0 && dbPrevClose > 0) {
    prevClose = dbPrevClose;
    source = 'db-fallback';
    console.log(`All sources failed, using DB fallback: ${dbPrevClose}`);
  }

  if (prevClose === 0) {
    return new Response(JSON.stringify({
      success: false,
      error: 'All sources failed and no DB fallback available',
      dbPrevClose,
      dbPrevDate
    }), { status: 503, headers });
  }

  // Store in trading_states
  if (dbId > 0) {
    dbStates.__prevClose = { value: prevClose, source, date: today, updated: now };

    await fetch(`${SUPA_URL}/rest/v1/trading_states?id=eq.${dbId}`, {
      method: 'PATCH',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ states: dbStates })
    });
  }

  return new Response(JSON.stringify({
    success: true,
    prevClose,
    source,
    date: today,
    updated: now,
    skipped: false
  }), { status: 200, headers });
});
