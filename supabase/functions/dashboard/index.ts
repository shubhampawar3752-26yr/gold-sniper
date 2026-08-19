const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gold Sniper Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0f; color: #e0e0e0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; min-height: 100vh; }
  
  /* Header */
  .header { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; background: linear-gradient(135deg, #12121a, #1a1a25); border-bottom: 1px solid #333; }
  .logo { display: flex; align-items: center; gap: 12px; }
  .logo-icon { font-size: 28px; }
  .logo-text { font-size: 24px; font-weight: 800; letter-spacing: 2px; background: linear-gradient(135deg, #FFD700, #FFA500); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .feed-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px; background: rgba(0, 255, 100, 0.1); border: 1px solid rgba(0, 255, 100, 0.3); border-radius: 20px; font-size: 12px; font-weight: 600; letter-spacing: 1px; color: #00e676; }
  .feed-dot { width: 8px; height: 8px; border-radius: 50%; background: #00e676; animation: pulse 1.5s ease-in-out infinite; }
  .feed-dot.offline { background: #ff4444; animation: none; }
  .feed-badge.offline { background: rgba(255, 68, 68, 0.1); border-color: rgba(255, 68, 68, 0.3); color: #ff4444; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  
  /* Main container */
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  
  /* Price card */
  .price-card { background: linear-gradient(135deg, #1a1a25, #12121a); border: 1px solid #333; border-radius: 16px; padding: 32px; margin-bottom: 24px; text-align: center; position: relative; overflow: hidden; }
  .price-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, transparent, #FFD700, transparent); }
  .price-label { font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #888; margin-bottom: 8px; }
  .price-value { font-size: 48px; font-weight: 800; color: #FFD700; transition: color 0.3s; }
  .price-value.up { color: #00e676; }
  .price-value.down { color: #ff4444; }
  .price-change { font-size: 18px; margin-top: 8px; font-weight: 600; }
  .price-change.up { color: #00e676; }
  .price-change.down { color: #ff4444; }
  .price-meta { display: flex; justify-content: center; gap: 24px; margin-top: 16px; font-size: 13px; color: #666; }
  .price-meta span { display: flex; align-items: center; gap: 6px; }
  .market-state { padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
  .market-state.regular { background: rgba(0, 255, 100, 0.15); color: #00e676; }
  .market-state.closed { background: rgba(255, 68, 68, 0.15); color: #ff4444; }
  .market-state.unknown { background: rgba(255, 204, 0, 0.15); color: #ffcc00; }
  .last-update { font-size: 12px; color: #555; margin-top: 12px; }
  
  /* Active trades section */
  .trades-section { margin-bottom: 24px; }
  .section-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .section-title h2 { font-size: 18px; font-weight: 700; color: #ccc; }
  .trade-count { padding: 4px 12px; background: rgba(255, 215, 0, 0.1); border: 1px solid rgba(255, 215, 0, 0.3); border-radius: 12px; font-size: 13px; font-weight: 600; color: #FFD700; }
  
  .trade-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
  .trade-card { background: linear-gradient(135deg, #1a1a25, #12121a); border: 1px solid #333; border-radius: 12px; padding: 20px; position: relative; overflow: hidden; }
  .trade-card::before { content: ''; position: absolute; top: 0; left: 0; bottom: 0; width: 3px; }
  .trade-card.long::before { background: #00e676; }
  .trade-card.short::before { background: #ff4444; }
  .trade-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .trade-tf { font-size: 16px; font-weight: 700; color: #fff; }
  .trade-dir { padding: 3px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
  .trade-dir.long { background: rgba(0, 255, 100, 0.15); color: #00e676; }
  .trade-dir.short { background: rgba(255, 68, 68, 0.15); color: #ff4444; }
  
  .trade-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .stat { text-align: center; padding: 10px; background: rgba(255, 255, 255, 0.03); border-radius: 8px; }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; margin-bottom: 4px; }
  .stat-value { font-size: 15px; font-weight: 700; color: #ccc; }
  .stat-value.entry { color: #FFD700; }
  .stat-value.sl { color: #ff4444; }
  .stat-value.atr { color: #00e676; }
  
  .tp-section { margin-top: 12px; }
  .tp-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #666; margin-bottom: 8px; }
  .tp-grid { display: flex; gap: 6px; }
  .tp-item { flex: 1; text-align: center; padding: 8px 4px; border-radius: 6px; font-size: 11px; font-weight: 600; border: 1px solid transparent; transition: all 0.3s; }
  .tp-item .tp-label { font-size: 9px; color: #555; margin-bottom: 2px; }
  .tp-item .tp-price { font-size: 12px; font-weight: 700; }
  .tp-item.hit { background: rgba(0, 255, 100, 0.1); border-color: rgba(0, 255, 100, 0.3); }
  .tp-item.hit .tp-price { color: #00e676; }
  .tp-item.hit .tp-label { color: #00e676; }
  .tp-item.pending { background: rgba(255, 255, 255, 0.03); border-color: rgba(255, 255, 255, 0.1); }
  .tp-item.pending .tp-price { color: #888; }
  .tp-item.pending .tp-label { color: #555; }
  
  .trade-cycle { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.05); font-size: 12px; color: #666; }
  .trade-cycle .cycle-badge { padding: 2px 8px; border-radius: 4px; background: rgba(255, 215, 0, 0.1); color: #FFD700; font-weight: 600; }
  
  /* No trades */
  .no-trades { text-align: center; padding: 48px 24px; background: linear-gradient(135deg, #1a1a25, #12121a); border: 1px solid #333; border-radius: 12px; }
  .no-trades-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.3; }
  .no-trades-text { font-size: 15px; color: #666; }
  
  /* Loading state */
  .loading { opacity: 0.6; pointer-events: none; }
  
  /* Error banner */
  .error-banner { padding: 12px 20px; background: rgba(255, 68, 68, 0.1); border: 1px solid rgba(255, 68, 68, 0.3); border-radius: 10px; margin-bottom: 16px; font-size: 14px; color: #ff4444; text-align: center; display: none; }
  
  /* Footer */
  .footer { text-align: center; padding: 24px; font-size: 12px; color: #444; }
  .footer a { color: #FFD700; text-decoration: none; }
  
  /* Responsive */
  @media (max-width: 600px) {
    .price-value { font-size: 36px; }
    .trade-grid { grid-template-columns: 1fr; }
    .trade-stats { grid-template-columns: 1fr 1fr; }
    .stat:nth-child(3) { grid-column: 1 / -1; }
  }
</style>
</head>
<body>

<div class="header">
  <div class="logo">
    <span class="logo-icon">🎯</span>
    <span class="logo-text">GOLD SNIPER</span>
  </div>
  <div class="feed-badge" id="feedBadge">
    <span class="feed-dot" id="feedDot"></span>
    <span id="feedText">FEED</span>
  </div>
</div>

<div class="container">
  <div class="error-banner" id="errorBanner"></div>

  <!-- Price Card -->
  <div class="price-card" id="priceCard">
    <div class="price-label">Gold (GC=F) — Live Price</div>
    <div class="price-value" id="priceValue">— —</div>
    <div class="price-change" id="priceChange"></div>
    <div class="price-meta">
      <span>Prev Close: <strong id="prevClose" style="color:#aaa">—</strong></span>
      <span>Open: <strong id="dayOpen" style="color:#aaa">—</strong></span>
      <span>High: <strong id="dayHigh" style="color:#39ff14">—</strong></span>
      <span>Low: <strong id="dayLow" style="color:#ff3b3b">—</strong></span>
      <span>Market: <span class="market-state unknown" id="marketState">—</span></span>
      <span>Last Tick: <strong id="lastTick" style="color:#aaa">—</strong></span>
    </div>
    <div class="last-update" id="lastUpdate">Connecting…</div>
  </div>

  <!-- Active Trades -->
  <div class="trades-section">
    <div class="section-title">
      <h2>Active Trades</h2>
      <span class="trade-count" id="tradeCount">0</span>
    </div>
    <div class="trade-grid" id="tradeGrid">
      <div class="no-trades">
        <div class="no-trades-icon">📊</div>
        <div class="no-trades-text">No active trades</div>
      </div>
    </div>
  </div>
</div>

<div class="footer">
  Gold Sniper Trading System &copy; 2026 — <a href="#">Dashboard</a>
</div>

<script>
const API = 'https://schegpkwfwkgfmmpnzic.supabase.co/functions/v1/get-live-price';
let isOnline = false;
let lastPrice = null;

function setOnline(online) {
  if (isOnline === online) return;
  isOnline = online;
  const badge = document.getElementById('feedBadge');
  const dot = document.getElementById('feedDot');
  const text = document.getElementById('feedText');
  if (online) {
    badge.classList.remove('offline');
    dot.classList.remove('offline');
    text.textContent = 'FEED';
    document.getElementById('errorBanner').style.display = 'none';
  } else {
    badge.classList.add('offline');
    dot.classList.add('offline');
    text.textContent = 'OFFLINE';
  }
}

function fmtPrice(v) {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(2);
}

function fmtDir(d) {
  return d === 'long' || d === 'buy' ? 'long' : 'short';
}

function dirLabel(d) {
  return (d === 'long' || d === 'buy') ? 'LONG' : 'SHORT';
}

async function fetchDashboard() {
  try {
    const res = await fetch(API, { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Fetch failed');
    
    setOnline(true);
    document.getElementById('errorBanner').style.display = 'none';

    // Price card
    const priceEl = document.getElementById('priceValue');
    const newPrice = data.price;
    priceEl.textContent = '$' + newPrice.toFixed(2);
    if (lastPrice !== null) {
      priceEl.classList.remove('up', 'down');
      if (newPrice > lastPrice) priceEl.classList.add('up');
      else if (newPrice < lastPrice) priceEl.classList.add('down');
    }
    lastPrice = newPrice;

    document.getElementById('prevClose').textContent = '$' + fmtPrice(data.prevClose);
    if (data.dayOpen) document.getElementById('dayOpen').textContent = '$' + fmtPrice(data.dayOpen);
    if (data.dayHigh) document.getElementById('dayHigh').textContent = '$' + fmtPrice(data.dayHigh);
    if (data.dayLow) document.getElementById('dayLow').textContent = '$' + fmtPrice(data.dayLow);

    const changeEl = document.getElementById('priceChange');
    const chg = data.change || 0;
    const chgPct = data.changePct || 0;
    changeEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '  (' + (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%)';
    changeEl.className = 'price-change ' + (chg >= 0 ? 'up' : 'down');

    const msEl = document.getElementById('marketState');
    const ms = (data.marketState || 'unknown').toLowerCase();
    msEl.textContent = ms === 'regular' ? 'OPEN' : (ms === 'closed' ? 'CLOSED' : ms.toUpperCase());
    msEl.className = 'market-state ' + (ms === 'regular' ? 'regular' : ms === 'closed' ? 'closed' : 'unknown');

    document.getElementById('lastTick').textContent = data.lastTick ? data.lastTick : (data.marketTime ? new Date(data.marketTime * 1000).toLocaleTimeString('en-US', { hour12: false }) : '—');
    document.getElementById('lastUpdate').textContent = 'Updated: ' + (data.timestamp || new Date().toLocaleString('en-US', { hour12: false })) + (data.lastMonitorRun ? ' • Monitor: ' + data.lastMonitorRun : '');

    // Active trades
    const trades = data.activeTrades || [];
    document.getElementById('tradeCount').textContent = data.activeCount != null ? data.activeCount : trades.length;

    const grid = document.getElementById('tradeGrid');
    if (trades.length === 0) {
      grid.innerHTML = '<div class="no-trades"><div class="no-trades-icon">📊</div><div class="no-trades-text">No active trades</div></div>';
      return;
    }

    grid.innerHTML = trades.map(t => {
      const dir = fmtDir(t.direction);
      const tps = [
        { label: 'TP1', price: t.tp1, hit: t.tp1Hit },
        { label: 'TP2', price: t.tp2, hit: t.tp2Hit },
        { label: 'TP3', price: t.tp3, hit: t.tp3Hit },
        { label: 'TP4', price: t.tp4, hit: t.tp4Hit },
        { label: 'TP5', price: t.tp5, hit: t.tp5Hit }
      ];
      const tpHtml = tps.map(tp => {
        const isHit = tp.hit === true;
        return '<div class="tp-item ' + (isHit ? 'hit' : 'pending') + '">' +
          '<div class="tp-label">' + tp.label + (isHit ? ' ✓' : '') + '</div>' +
          '<div class="tp-price">' + (tp.price != null && tp.price > 0 ? fmtPrice(tp.price) : '—') + '</div>' +
        '</div>';
      }).join('');

      return '<div class="trade-card ' + dir + '">' +
        '<div class="trade-header">' +
          '<span class="trade-tf">' + (t.timeframe || '—') + '</span>' +
          '<span class="trade-dir ' + dir + '">' + dirLabel(t.direction) + '</span>' +
        '</div>' +
        '<div class="trade-stats">' +
          '<div class="stat"><div class="stat-label">Entry</div><div class="stat-value entry">' + fmtPrice(t.entry) + '</div></div>' +
          '<div class="stat"><div class="stat-label">Stop Loss</div><div class="stat-value sl">' + fmtPrice(t.sl) + '</div></div>' +
          '<div class="stat"><div class="stat-label">ATR</div><div class="stat-value atr">' + fmtPrice(t.atr) + '</div></div>' +
        '</div>' +
        '<div class="tp-section">' +
          '<div class="tp-section-title">Take Profit Progress</div>' +
          '<div class="tp-grid">' + tpHtml + '</div>' +
        '</div>' +
        '<div class="trade-cycle">' +
          '<span>Cycle</span>' +
          '<span class="cycle-badge">#' + (t.cycle || '—') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (err) {
    setOnline(false);
    document.getElementById('errorBanner').textContent = '⚠ Connection error: ' + err.message + ' — Retrying…';
    document.getElementById('errorBanner').style.display = 'block';
  }
}

// Initial fetch
fetchDashboard();
// Poll every 5 seconds
setInterval(fetchDashboard, 5000);
</script>
</body>
</html>`;

Deno.serve(async (req) => {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  return new Response(HTML, { status: 200, headers });
});
