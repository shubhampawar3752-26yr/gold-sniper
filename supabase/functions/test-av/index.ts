Deno.serve(async () => {
  const key = Deno.env.get('ALPHA_VANTAGE_API_KEY') || '';
  
  // Try XAUUSD (forex) instead of GC=F (futures)
  const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=XAUUSD&apikey=${key}`);
  const text = await r.text();
  
  return new Response(JSON.stringify({
    symbol: 'XAUUSD',
    httpStatus: r.status,
    rawResponse: text.substring(0, 500)
  }, null, 2), {headers: {'Content-Type': 'application/json'}});
});
