Deno.serve(async () => {
  const tdKey = Deno.env.get('TWELVE_DATA_API_KEY') || '';
  
  // Test TwelveData
  const r1 = await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${tdKey}`);
  const d1 = await r1.json();
  
  // Test TwelveData quote (for prev_close)
  const r2 = await fetch(`https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${tdKey}`);
  const d2 = await r2.json();
  
  return new Response(JSON.stringify({
    tdKeyPrefix: tdKey.substring(0, 6) + '...',
    tdKeyLength: tdKey.length,
    price: d1,
    quote: d2
  }, null, 2), {headers: {'Content-Type': 'application/json'}});
});
