const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWELVE_DATA_KEY = Deno.env.get('TWELVE_DATA_API_KEY')!;

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  
  let prevClose = 0;
  let source = '';
  
  // Try TwelveData quote API for previous_close
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
      }
    }
  } catch (e) { console.error('TwelveData failed:', (e as Error).message); }

  // Fallback: Alpha Vantage
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
        }
      }
    } catch (e) { console.error('Alpha Vantage failed:', (e as Error).message); }
  }

  // Fallback: livepriceofgold.com HTML scrape
  if (prevClose === 0) {
    try {
      const r = await fetch('https://www.livepriceofgold.com/', {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
      });
      if (r.ok) {
        const html = await r.text();
        const m = html.match(/data-open="([\d.]+)"/);
        if (m) {
          prevClose = parseFloat(m[1]);
          source = 'livepriceofgold';
        }
      }
    } catch (e) { console.error('LPOG failed:', (e as Error).message); }
  }

  if (prevClose === 0) {
    return new Response(JSON.stringify({ success: false, error: 'All sources failed' }), { status: 503, headers });
  }

  // Store in trading_states (append to the JSON states as __prevClose)
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  
  // Read current state
  const stateResp = await fetch(`${SUPA_URL}/rest/v1/trading_states?limit=1`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  const stateData = await stateResp.json();
  
  if (stateData && stateData.length > 0) {
    const id = stateData[0].id;
    const states = stateData[0].states || {};
    states.__prevClose = { value: prevClose, source, updated: now };
    
    await fetch(`${SUPA_URL}/rest/v1/trading_states?id=eq.${id}`, {
      method: 'PATCH',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ states })
    });
  }

  return new Response(JSON.stringify({ success: true, prevClose, source, updated: now }), { headers });
});
