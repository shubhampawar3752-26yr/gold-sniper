// fetch-ai-market-context — fetches live market data from configured providers
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWELVE_DATA_KEY = Deno.env.get('TWELVE_DATA_API_KEY') || '';
const ALPHA_VANTAGE_KEY = Deno.env.get('ALPHA_VANTAGE_API_KEY') || '';
const FRED_KEY = Deno.env.get('FRED_API_KEY') || '';
const NEWSAPI_KEY = Deno.env.get('NEWSAPI_KEY') || '';

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

async function twelveData() {
  if (!TWELVE_DATA_KEY) return { available: false };
  try {
    const res = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=10&apikey=${TWELVE_DATA_KEY}`);
    const data = await res.json();
    return { available: true, provider: 'Twelve Data', data };
  } catch (e) { return { available: false, error: e.message }; }
}

async function alphaVantage() {
  if (!ALPHA_VANTAGE_KEY) return { available: false };
  try {
    const res = await fetch(`https://www.alphavantage.co/query?function=GOLD_SILVER_SPOT&apikey=${ALPHA_VANTAGE_KEY}`);
    const data = await res.json();
    return { available: true, provider: 'Alpha Vantage', data };
  } catch (e) { return { available: false, error: e.message }; }
}

async function fredData() {
  if (!FRED_KEY) return { available: false };
  try {
    const series = ['DGS10', 'DGS2', 'DFF', 'DFII10'];
    const results: any = {};
    for (const s of series) {
      const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${s}&api_key=${FRED_KEY}&file_type=json&limit=1&sort_order=desc`);
      const data = await res.json();
      results[s] = data.observations?.[0] || null;
    }
    return { available: true, provider: 'FRED', data: results };
  } catch (e) { return { available: false, error: e.message }; }
}

async function gdeltNews() {
  try {
    const res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=gold XAUUSD&mode=ArtList&maxrecords=5&format=json`);
    const data = await res.json();
    return { available: true, provider: 'GDELT', data: data.articles?.slice(0, 5) || [] };
  } catch (e) { return { available: false, error: e.message }; }
}

async function newsAPI() {
  if (!NEWSAPI_KEY) return { available: false };
  try {
    const res = await fetch(`https://newsapi.org/v2/everything?q=gold+XAUUSD&sortBy=publishedAt&pageSize=5&apiKey=${NEWSAPI_KEY}`);
    const data = await res.json();
    return { available: true, provider: 'NewsAPI', data: data.articles?.slice(0, 5) || [] };
  } catch (e) { return { available: false, error: e.message }; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: CORS });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const agent = body.agent || 'all';

  const [td, av, fred, gdelt, news] = await Promise.all([
    twelveData(), alphaVantage(), fredData(), gdeltNews(), newsAPI(),
  ]);

  return new Response(JSON.stringify({
    ok: true,
    result: {
      agent,
      generated_at: new Date().toISOString(),
      twelve_data: td,
      alpha_vantage: av,
      fred: fred,
      gdelt: gdelt,
      newsapi: news,
    },
  }), { status: 200, headers: CORS });
});
