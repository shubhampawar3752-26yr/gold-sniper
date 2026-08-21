// Gold Sniper — Data Visualization API
// Fetches trade data from Supabase and returns chart-ready datasets

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://schegpkwfwkgfmmpnzic.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN;

function checkAuth(req) {
  if (!AUTH_TOKEN) return true;
  const authHeader = req.headers['x-auth-token'] || req.headers['authorization'] || '';
  return authHeader.replace('Bearer ', '').trim() === AUTH_TOKEN;
}

async function supabaseFetch(table, params = '') {
  const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const res = await fetch(url, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`${table}: ${res.status}`);
  return res.json();
}

async function supabaseFunction(name, payload = {}) {
  const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}

// ── Equity Curve ──
async function getEquityCurve() {
  const history = await supabaseFetch('trade_history', '?select=created_at,pnl_pips,direction,timeframe&order=created_at.asc&limit=200');
  if (!history || history.length === 0) return { labels: [], datasets: [] };
  let cumulative = 0;
  const labels = [], data = [];
  history.forEach((t, i) => {
    cumulative += parseFloat(t.pnl_pips) || 0;
    labels.push(`#${i + 1}`);
    data.push(parseFloat(cumulative.toFixed(2)));
  });
  return { type: 'line', labels, datasets: [{ label: 'Cumulative PnL (pips)', data, borderColor: '#FFD700', backgroundColor: 'rgba(255,215,0,0.1)', fill: true, tension: 0.3 }] };
}

// ── Win/Loss by Timeframe ──
async function getWinLossByTimeframe() {
  const history = await supabaseFetch('trade_history', '?select=timeframe,pnl_pips&order=created_at.desc&limit=200');
  if (!history || history.length === 0) return { labels: [], datasets: [] };
  const tfStats = {};
  history.forEach(t => {
    const tf = t.timeframe || 'unknown';
    if (!tfStats[tf]) tfStats[tf] = { wins: 0, losses: 0 };
    if (parseFloat(t.pnl_pips) > 0) tfStats[tf].wins++;
    else if (parseFloat(t.pnl_pips) < 0) tfStats[tf].losses++;
  });
  const labels = Object.keys(tfStats).sort();
  return { type: 'bar', labels, datasets: [
    { label: 'Wins', data: labels.map(tf => tfStats[tf].wins), backgroundColor: '#00e676' },
    { label: 'Losses', data: labels.map(tf => tfStats[tf].losses), backgroundColor: '#ff4444' },
  ]};
}

// ── PnL Distribution ──
async function getPnLDistribution() {
  const history = await supabaseFetch('trade_history', '?select=pnl_pips&order=created_at.desc&limit=200');
  if (!history || history.length === 0) return { labels: [], datasets: [] };
  const pnls = history.map(t => parseFloat(t.pnl_pips) || 0).filter(p => p !== 0);
  const buckets = { '<-10 pips': 0, '-10 to 0': 0, '0 to 10': 0, '10 to 20': 0, '20+ pips': 0 };
  pnls.forEach(p => {
    if (p < -10) buckets['<-10 pips']++;
    else if (p < 0) buckets['-10 to 0']++;
    else if (p < 10) buckets['0 to 10']++;
    else if (p < 20) buckets['10 to 20']++;
    else buckets['20+ pips']++;
  });
  return { type: 'bar', labels: Object.keys(buckets), datasets: [{
    label: 'Trade Count', data: Object.values(buckets),
    backgroundColor: Object.keys(buckets).map(k => k.includes('-') ? '#ff4444' : '#00e676'),
  }]};
}

// ── Price History ──
async function getPriceHistory() {
  try {
    const trading = await supabaseFunction('get-live-price', {});
    const price = parseFloat(trading.spotPrice || trading.price || 0);
    return { type: 'line', labels: ['Current'], datasets: [{ label: 'Gold Spot ($)', data: [price], borderColor: '#FFD700', backgroundColor: 'rgba(255,215,0,0.1)', fill: true, tension: 0.2 }] };
  } catch { return { labels: [], datasets: [] }; }
}

// ── Buy/Sell Split ──
async function getDirectionSplit() {
  const history = await supabaseFetch('trade_history', '?select=direction&limit=200');
  if (!history || history.length === 0) return { labels: [], datasets: [] };
  const buys = history.filter(t => t.direction === 'buy').length;
  const sells = history.filter(t => t.direction === 'sell').length;
  return { type: 'doughnut', labels: ['Buy', 'Sell'], datasets: [{ data: [buys, sells], backgroundColor: ['#00e676', '#ff4444'] }] };
}

// ── AI Confidence ──
async function getAIConfidence() {
  try {
    const analysis = await supabaseFetch('ai_candle_analysis', '?select=timeframe,confidence,recommendation,pattern&order=created_at.desc&limit=6');
    if (!analysis || analysis.length === 0) return { labels: [], datasets: [] };
    const labels = analysis.map(a => a.timeframe);
    return { type: 'bar', labels, datasets: [{ label: 'AI Confidence (%)', data: analysis.map(a => a.confidence || 0),
      backgroundColor: analysis.map(a => {
        const rec = (a.recommendation || '').toLowerCase();
        if (rec.includes('buy')) return '#00e676';
        if (rec.includes('sell')) return '#ff4444';
        return '#FFD700';
      }),
    }]};
  } catch { return { labels: [], datasets: [] }; }
}

// ── TP Progress ──
async function getTPProgress() {
  try {
    const trading = await supabaseFunction('get-live-price', {});
    if (!trading || !trading.activeTrades || trading.activeTrades.length === 0) return { labels: [], datasets: [] };
    const labels = trading.activeTrades.map(t => `${t.timeframe} ${(t.direction||'').toUpperCase()}`);
    return { type: 'bar', labels, datasets: [
      { label: 'TP1', data: trading.activeTrades.map(t => t.tp1Hit ? 1 : 0), backgroundColor: '#00e676' },
      { label: 'TP2', data: trading.activeTrades.map(t => t.tp2Hit ? 1 : 0), backgroundColor: '#FFD700' },
      { label: 'TP3', data: trading.activeTrades.map(t => t.tp3Hit ? 1 : 0), backgroundColor: '#FF8C00' },
    ]};
  } catch { return { labels: [], datasets: [] }; }
}

// ── Stats ──
async function getStats() {
  const history = await supabaseFetch('trade_history', '?select=pnl_pips,pnl_percent,direction,timeframe,exit_reason&order=created_at.desc&limit=200');
  if (!history || history.length === 0) return { total: 0 };
  const wins = history.filter(t => parseFloat(t.pnl_pips) > 0);
  const losses = history.filter(t => parseFloat(t.pnl_pips) < 0);
  const closed = history.filter(t => t.exit_reason !== 'open');
  const totalPips = history.reduce((s, t) => s + (parseFloat(t.pnl_pips) || 0), 0);
  const exitReasons = {};
  history.forEach(t => { const r = t.exit_reason || 'unknown'; exitReasons[r] = (exitReasons[r] || 0) + 1; });
  return {
    total: history.length, closed: closed.length, wins: wins.length, losses: losses.length,
    winRate: history.length > 0 ? (wins.length / history.length * 100).toFixed(1) : '0',
    totalPips: totalPips.toFixed(1),
    avgWin: wins.length > 0 ? (wins.reduce((s, t) => s + parseFloat(t.pnl_pips), 0) / wins.length).toFixed(1) : '0',
    avgLoss: losses.length > 0 ? (losses.reduce((s, t) => s + parseFloat(t.pnl_pips), 0) / losses.length).toFixed(1) : '0',
    bestTrade: Math.max(...history.map(t => parseFloat(t.pnl_pips) || 0)).toFixed(1),
    worstTrade: Math.min(...history.map(t => parseFloat(t.pnl_pips) || 0)).toFixed(1),
    exitReasons,
  };
}

// ── Handler ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const chartType = req.query.type || 'all';

  try {
    const chartMap = { equity: getEquityCurve, winloss: getWinLossByTimeframe, distribution: getPnLDistribution, price: getPriceHistory, direction: getDirectionSplit, confidence: getAIConfidence, tp: getTPProgress };

    if (chartType === 'stats') {
      const stats = await getStats();
      return res.status(200).json({ stats });
    }

    if (chartType === 'all') {
      const results = await Promise.allSettled([
        getEquityCurve(), getWinLossByTimeframe(), getPnLDistribution(),
        getPriceHistory(), getDirectionSplit(), getAIConfidence(), getTPProgress(), getStats(),
      ]);
      const keys = ['equity', 'winloss', 'distribution', 'price', 'direction', 'confidence', 'tp'];
      const charts = {};
      keys.forEach((k, i) => {
        charts[k] = results[i].status === 'fulfilled' ? results[i].value : { labels: [], datasets: [] };
      });
      const stats = results[7].status === 'fulfilled' ? results[7].value : { total: 0 };
      return res.status(200).json({ charts, stats });
    }

    const fn = chartMap[chartType];
    if (!fn) return res.status(400).json({ error: `Unknown chart type: ${chartType}` });
    const chart = await fn();
    return res.status(200).json({ chart });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
