// ── Gold Sniper: Daily Trade Report — HTML Email + WhatsApp ──
// Timeframe-wise report with entry/SL/TP hit times + entry price + win rate per TF
// Email: Resend API (styled HTML) → shubhampawar3752@gmail.com
// WhatsApp: Meta WhatsApp Cloud API → recipients

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const TO_EMAIL = 'shubhampawar3752@gmail.com';
const META_TOKEN = Deno.env.get('META_WHATSAPP_TOKEN') || '';
const META_PHONE_ID = Deno.env.get('META_WHATSAPP_PHONE_ID') || '';
const RECIPIENTS = (Deno.env.get('WHATSAPP_RECIPIENTS') || '').split(',').map(s => s.trim()).filter(Boolean);

const TFS = ['1M', '5M', '15M', '30M', '1H', '4H'];

Deno.serve(async (req) => {
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  
  let mode = 'evening';
  try {
    const body = await req.json();
    if (body?.mode === 'morning') mode = 'morning';
  } catch {}

  // Fetch alerts
  let alertUrl;
  if (mode === 'morning') {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    alertUrl = `${SUPA_URL}/rest/v1/alerts?select=*,tp&created_at=gte.${since}&order=created_at.asc&limit=1000`;
    // Note: tp is a JSONB field with tp1-tp5 + AI info for entry alerts
  } else {
    alertUrl = `${SUPA_URL}/rest/v1/alerts?created_at=gte.${today}T00:00:00&order=created_at.asc&limit=1000`;
    // Note: select=* includes tp JSONB field with tp1-tp5 for entry alerts
  }

  const r = await fetch(alertUrl, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  const alerts: any[] = await r.json();

  // Fetch trading state
  const r2 = await fetch(`${SUPA_URL}/rest/v1/trading_states?select=*&limit=1`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  const states: any[] = await r2.json();
  const state = states[0]?.states || {};

  // Fetch trade_history for PnL data
  let tradeHistory: any[] = [];
  try {
    const since = mode === 'morning' ? new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() : `${today}T00:00:00+05:30`;
    const rh = await fetch(`${SUPA_URL}/rest/v1/trade_history?select=id,timeframe,cycle,direction,entry_price,exit_price,tp1_price,tp2_price,tp3_price,tp1_hit,tp2_hit,tp3_hit,tps_hit,exit_reason,pnl_pips,pnl_percent,exit_level,entry_time,exit_time,duration_minutes,smart_entry&created_at=gte.${since}&order=id.asc`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    tradeHistory = await rh.json();
  } catch (e) { console.error('Trade history fetch failed:', (e as Error).message); }

  // Fetch ALL trade_history for cumulative stats
  let allTradeHistory: any[] = [];
  try {
    const rah = await fetch(`${SUPA_URL}/rest/v1/trade_history?select=id,timeframe,pnl_pips,pnl_percent,tp1_hit,exit_reason&order=id.asc`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    allTradeHistory = await rah.json();
  } catch (e) { console.error('All trade history fetch failed:', (e as Error).message); }

  // Fetch trade_summary
  let tradeSummary: any = null;
  try {
    const rs = await fetch(`${SUPA_URL}/rest/v1/trade_summary?select=*&order=id.desc&limit=1`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    const summaries = await rs.json();
    tradeSummary = summaries[0] || null;
  } catch (e) { console.error('Trade summary fetch failed:', (e as Error).message); }

  // Fetch trade_stats per timeframe
  let tradeStats: any[] = [];
  try {
    const rst = await fetch(`${SUPA_URL}/rest/v1/trade_stats?select=*&order=timeframe.asc`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    tradeStats = await rst.json();
  } catch (e) { console.error('Trade stats fetch failed:', (e as Error).message); }

  // Compute cumulative PnL from all trade history
  const cumPips = allTradeHistory.reduce((s: number, t: any) => s + parseFloat(t.pnl_pips || 0), 0);
  const cumPnl = allTradeHistory.reduce((s: number, t: any) => s + parseFloat(t.pnl_percent || 0), 0);
  const cumWins = allTradeHistory.filter((t: any) => t.tp1_hit || parseFloat(t.pnl_pips) > 0).length;
  const cumLosses = allTradeHistory.filter((t: any) => !t.tp1_hit && parseFloat(t.pnl_pips) < 0).length;
  const cumWinRate = allTradeHistory.length > 0 ? Math.round((cumWins / allTradeHistory.length) * 100) : 0;

  // Today's PnL from tradeHistory
  const todayPips = tradeHistory.reduce((s: number, t: any) => s + parseFloat(t.pnl_pips || 0), 0);
  const todayPnl = tradeHistory.reduce((s: number, t: any) => s + parseFloat(t.pnl_percent || 0), 0);
  const todayWins = tradeHistory.filter((t: any) => t.tp1_hit || parseFloat(t.pnl_pips) > 0).length;
  const todayLosses = tradeHistory.filter((t: any) => !t.tp1_hit && parseFloat(t.pnl_pips) < 0).length;
  const todayWinRate = tradeHistory.length > 0 ? Math.round((todayWins / tradeHistory.length) * 100) : 0;
  const todayBest = tradeHistory.length > 0 ? Math.max(...tradeHistory.map((t: any) => parseFloat(t.pnl_pips || 0))) : 0;
  const todayWorst = tradeHistory.length > 0 ? Math.min(...tradeHistory.map((t: any) => parseFloat(t.pnl_pips || 0))) : 0;

  // Fetch ALL entry alerts for time-based entry price lookup
  // TP/SL alerts don't carry entry/direction/cycle fields, so we match by timeframe + time
  const rEntries = await fetch(
    `${SUPA_URL}/rest/v1/alerts?type=eq.entry&select=id,type,timeframe,direction,entry,sl,tp,cycle,price,created_at&order=created_at.asc&limit=2000`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
  );
  const allEntryAlerts: any[] = await rEntries.json();

  // Per-TF sorted entry list for time-based lookup
  const tfEntries: Record<string, any[]> = {};
  for (const tf of TFS) {
    tfEntries[tf] = allEntryAlerts.filter(a => a.timeframe === tf);
  }

  // Cycle→entry maps (for alerts that DO have cycle)
  const cycleEntryMap: Record<string, Record<number, number>> = {};
  const cycleDirMap: Record<string, Record<number, string>> = {};
  const cycleSLMap: Record<string, Record<number, number>> = {};
  for (const tf of TFS) {
    cycleEntryMap[tf] = {};
    cycleDirMap[tf] = {};
    cycleSLMap[tf] = {};
    for (const a of tfEntries[tf]) {
      if (a.entry && a.cycle != null && cycleEntryMap[tf][a.cycle] === undefined) {
        cycleEntryMap[tf][a.cycle] = Number(a.entry);
        cycleDirMap[tf][a.cycle] = a.direction || '';
        cycleSLMap[tf][a.cycle] = Number(a.sl) || 0;
      }
    }
    const s = state[tf];
    if (s && s.entry && s.cycle != null && cycleEntryMap[tf][s.cycle] === undefined) {
      cycleEntryMap[tf][s.cycle] = Number(s.entry);
      cycleDirMap[tf][s.cycle] = s.dir || '';
      cycleSLMap[tf][s.cycle] = Number(s.sl) || 0;
    }
  }

  // Find most recent entry for a TF at or before timestamp
  function findEntryByTime(tf: string, timestamp: string): any | null {
    const entries = tfEntries[tf];
    if (!entries || entries.length === 0) return null;
    let result = null;
    for (const e of entries) {
      if (e.created_at <= timestamp) result = e;
      else break;
    }
    return result;
  }

  // Match TP/SL to trading state by TP price or SL price
  function getEntryFromState(tf: string, alert: any): number | null {
    const s = state[tf];
    if (!s || !s.entry || s.entry === 0) return null;
    if (alert.tp_price) {
      const tpPrice = Number(alert.tp_price);
      const stateTPs = [s.tp1, s.tp2, s.tp3, s.tp4, s.tp5].filter(Boolean);
      for (const stp of stateTPs) {
        if (Math.abs(stp - tpPrice) < 0.5) return Number(s.entry);
      }
    }
    if (alert.type === 'sl' && alert.price && s.sl) {
      if (Math.abs(Number(alert.price) - Number(s.sl)) < 1) return Number(s.entry);
    }
    return null;
  }

  function getEntry(tf: string, alert: any): number | null {
    if (alert.entry) return Number(alert.entry);
    if (alert.cycle != null && cycleEntryMap[tf][alert.cycle]) return cycleEntryMap[tf][alert.cycle];
    if (alert.created_at) {
      const matched = findEntryByTime(tf, alert.created_at);
      if (matched && matched.entry) return Number(matched.entry);
    }
    const fromState = getEntryFromState(tf, alert);
    if (fromState) return fromState;
    const s = state[tf];
    if (s && s.entry) return Number(s.entry);
    return null;
  }

  function getDir(tf: string, alert: any): string {
    if (alert.direction || alert.dir) return alert.direction || alert.dir;
    if (alert.cycle != null && cycleDirMap[tf][alert.cycle]) return cycleDirMap[tf][alert.cycle];
    if (alert.created_at) {
      const matched = findEntryByTime(tf, alert.created_at);
      if (matched && matched.direction) return matched.direction;
    }
    const s = state[tf];
    if (s && s.dir) return s.dir;
    return '';
  }

  function getSL(tf: string, alert: any): number | null {
    if (alert.sl) return Number(alert.sl);
    if (alert.cycle != null && cycleSLMap[tf][alert.cycle]) return cycleSLMap[tf][alert.cycle];
    if (alert.created_at) {
      const matched = findEntryByTime(tf, alert.created_at);
      if (matched && matched.sl) return Number(matched.sl);
    }
    const s = state[tf];
    if (s && s.sl) return Number(s.sl);
    return null;
  }

  // Group by timeframe
  const tfData: Record<string, any> = {};
  for (const tf of TFS) {
    const tfAlerts = alerts.filter(a => a.timeframe === tf);
    const entries = tfAlerts.filter(a => a.type === 'entry');
    const tps = tfAlerts.filter(a => a.type === 'tp');
    const sls = tfAlerts.filter(a => a.type === 'sl');
    const dones = tfAlerts.filter(a => a.type === 'alldone');
    
    // Win rate: TP alerts don't have cycle numbers, so we group TPs by which
    // entry they belong to using time-based lookup. Each unique entry that had
    // at least 1 TP = 1 win. Each SL = 1 loss.
    const winningEntries = new Set<string>();
    for (const tp of tps) {
      const matched = findEntryByTime(tf, tp.created_at);
      if (matched) {
        winningEntries.add(matched.created_at);
      } else {
        // No entry found (entry was before our lookup range) — count as unique win by TP time
        winningEntries.add(tp.created_at);
      }
    }
    const wins = winningEntries.size;
    const losses = sls.length;
    const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    tfData[tf] = { entries, tps, sls, dones, wins, losses, winRate, cycles: entries.length };
  }

  // Active trades
  const activeTrades = TFS.map(tf => {
    const s = state[tf];
    if (!s || s.entry === 0 || s.slHit || s.allDone) return null;
    const tpsHit = [s.tp1Hit, s.tp2Hit, s.tp3Hit, s.tp4Hit, s.tp5Hit].filter(Boolean).length;
    // Find entry time from alerts
    const entryAlert = alerts.find(a => a.type === 'entry' && a.timeframe === tf && (a.cycle || 0) === (s.cycle || 0));
    const entryTime = entryAlert ? String(entryAlert.created_at).substring(11, 19) : (s.lastRun ? String(s.lastRun).substring(11, 19) : '-');
    return { tf, dir: s.dir, entry: s.entry, sl: s.sl, tpsHit, cycle: s.cycle, rsi: s.rsi, aiRec: s.aiRecommendation,
      entryTime, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5,
      tp1Hit: s.tp1Hit, tp2Hit: s.tp2Hit, tp3Hit: s.tp3Hit, tp4Hit: s.tp4Hit, tp5Hit: s.tp5Hit };
  }).filter(Boolean);

  // Totals
  const totalEntries = Object.values(tfData).reduce((s: number, d: any) => s + d.entries.length, 0);
  const totalTPs = Object.values(tfData).reduce((s: number, d: any) => s + d.tps.length, 0);
  const totalSLs = Object.values(tfData).reduce((s: number, d: any) => s + d.sls.length, 0);
  const totalDones = Object.values(tfData).reduce((s: number, d: any) => s + d.dones.length, 0);
  const totalWins = Object.values(tfData).reduce((s: number, d: any) => s + d.wins, 0);
  const totalLosses = Object.values(tfData).reduce((s: number, d: any) => s + d.losses, 0);
  const overallWR = (totalWins + totalLosses) > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0;

  // ── Build HTML Email ──
  const title = mode === 'morning' ? '☀️ Morning Report' : '🎯 Daily Report';
  const period = mode === 'morning' ? 'Overnight (last 12h)' : "Today's Full History";

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#0a0a0f;color:#e0e0e0;margin:0;padding:20px}
  .header{text-align:center;padding:24px;background:linear-gradient(135deg,#1a1a25,#12121a);border-radius:12px;border:1px solid #333;margin-bottom:20px}
  .header h1{color:#FFD700;margin:0;font-size:24px;letter-spacing:2px}
  .header .date{color:#888;font-size:14px;margin-top:8px}
  .stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
  .stat{flex:1;min-width:100px;text-align:center;padding:14px 8px;background:#12121a;border:1px solid #333;border-radius:8px}
  .stat .num{font-size:28px;font-weight:bold}.stat .label{font-size:11px;color:#888}
  .tf-section{background:#1a1a25;border:1px solid #333;border-radius:10px;padding:16px;margin-bottom:16px}
  .tf-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #333}
  .tf-name{color:#FFD700;font-size:18px;font-weight:bold}
  .tf-winrate{font-size:14px;padding:4px 12px;border-radius:6px;font-weight:bold}
  .wr-good{background:#0a3a1a;color:#00e676}
  .wr-bad{background:#3a0a0a;color:#ff4444}
  .wr-neutral{background:#2a2a1a;color:#FFD700}
  .tf-stats{font-size:12px;color:#888;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;color:#888;padding:6px;border-bottom:1px solid #333}
  td{padding:6px;border-bottom:1px solid #222}
  .green{color:#00e676}.red{color:#ff4444}.gold{color:#FFD700}
  .event-row td{font-size:12px}
  .time-col{color:#aaa;font-family:monospace;white-space:nowrap}
  .footer{text-align:center;color:#555;font-size:11px;margin-top:20px}
  </style></head><body>`;

  html += `<div class="header"><h1>GOLD SNIPER — ${title}</h1><div class="date">${now} (IST) • ${period}</div></div>`;
  const pnlColor = todayPips >= 0 ? 'green' : 'red';
  const cumPnlColor = cumPips >= 0 ? 'green' : 'red';
  html += `<div class="stats">
    <div class="stat"><div class="num gold">${tradeHistory.length || totalEntries}</div><div class="label">TRADES</div></div>
    <div class="stat"><div class="num green">${todayWins}</div><div class="label">WINS</div></div>
    <div class="stat"><div class="num red">${todayLosses}</div><div class="label">LOSSES</div></div>
    <div class="stat"><div class="num ${todayWinRate >= 50 ? 'green' : 'red'}">${todayWinRate}%</div><div class="label">WIN RATE</div></div>
    <div class="stat"><div class="num ${pnlColor}">${todayPips >= 0 ? '+' : ''}${todayPips.toFixed(1)}</div><div class="label">TODAY PIPS</div></div>
    <div class="stat"><div class="num ${pnlColor}">${todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(2)}%</div><div class="label">TODAY PnL%</div></div>
    <div class="stat"><div class="num green">${activeTrades.length}</div><div class="label">ACTIVE</div></div>
  </div>`;

  // Cumulative summary section
  html += `<div class="tf-section" style="background:linear-gradient(135deg,#1a1a25,#12121a);border-color:#FFD70033">
    <div class="tf-header"><span class="tf-name" style="font-size:16px">📊 ALL-TIME SUMMARY</span></div>
    <div class="stats" style="margin-bottom:0">
      <div class="stat"><div class="num gold">${allTradeHistory.length}</div><div class="label">TOTAL TRADES</div></div>
      <div class="stat"><div class="num green">${cumWins}</div><div class="label">TOTAL WINS</div></div>
      <div class="stat"><div class="num red">${cumLosses}</div><div class="label">TOTAL LOSSES</div></div>
      <div class="stat"><div class="num ${cumWinRate >= 50 ? 'green' : 'red'}">${cumWinRate}%</div><div class="label">WIN RATE</div></div>
      <div class="stat"><div class="num ${cumPnlColor}">${cumPips >= 0 ? '+' : ''}${cumPips.toFixed(1)}</div><div class="label">TOTAL PIPS</div></div>
      <div class="stat"><div class="num ${cumPnlColor}">${cumPnl >= 0 ? '+' : ''}${cumPnl.toFixed(2)}%</div><div class="label">TOTAL PnL%</div></div>
    </div>`;

  // Per-timeframe stats from trade_stats
  if (tradeStats.length > 0) {
    html += `<table style="margin-top:10px"><tr><th>Timeframe</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Win Rate</th><th>Total Pips</th><th>Best</th><th>Worst</th><th>All-TP</th></tr>`;
    for (const ts of tradeStats) {
      const tPips = parseFloat(ts.total_pips || 0);
      const pipCls = tPips >= 0 ? 'green' : 'red';
      const wr = parseFloat(ts.win_rate || 0);
      const wrCls = wr >= 50 ? 'green' : 'red';
      html += `<tr><td><b style="color:#FFD700">${ts.timeframe}</b></td><td>${ts.total_trades}</td><td class="green">${ts.wins}</td><td class="red">${ts.losses}</td><td class="${wrCls}">${wr}%</td><td class="${pipCls}">${tPips >= 0 ? '+' : ''}${tPips.toFixed(1)}</td><td class="green">${parseFloat(ts.best_trade||0).toFixed(1)}</td><td class="red">${parseFloat(ts.worst_trade||0).toFixed(1)}</td><td class="gold">${ts.all_tp_trades}</td></tr>`;
    }
    html += `</table>`;
  }
  html += `</div>`;

  // Today's trade history with PnL
  if (tradeHistory.length > 0) {
    html += `<div class="tf-section"><div class="tf-header"><span class="tf-name" style="font-size:16px">📋 TODAY'S CLOSED TRADES (${tradeHistory.length})</span></div>`;
    html += `<table><tr><th>ID</th><th>TF</th><th>Dir</th><th>Entry</th><th>Exit</th><th>TP1</th><th>TPs</th><th>Exit Reason</th><th>PnL Pips</th><th>PnL %</th><th>Duration</th></tr>`;
    for (const t of tradeHistory) {
      const dir = t.direction || '';
      const dirCls = dir === 'long' ? 'green' : 'red';
      const pnl = parseFloat(t.pnl_pips || 0);
      const pnlPct = parseFloat(t.pnl_percent || 0);
      const pnlCls = pnl >= 0 ? 'green' : 'red';
      const tp1Hit = t.tp1_hit ? '✅' : '❌';
      const dur = t.duration_minutes || 0;
      const entryT = t.entry_time ? String(t.entry_time).substring(11, 16) : '-';
      html += `<tr><td>#${t.id}</td><td><b>${t.timeframe}</b></td><td class="${dirCls}">${dir.toUpperCase()}</td><td>$${parseFloat(t.entry_price||0).toFixed(2)}</td><td>$${parseFloat(t.exit_price||0).toFixed(2)}</td><td>${tp1Hit}</td><td>${t.tps_hit||0}/3</td><td style="font-size:11px">${t.exit_reason||'-'}</td><td class="${pnlCls}"><b>${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}</b></td><td class="${pnlCls}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</td><td style="font-size:11px;color:#888">${dur}m</td></tr>`;
    }
    html += `</table></div>`;
  }

  // Timeframe sections
  for (const tf of TFS) {
    const d = tfData[tf];
    if (d.entries.length === 0 && d.tps.length === 0 && d.sls.length === 0 && d.dones.length === 0) continue;

    const wrClass = d.winRate >= 60 ? 'wr-good' : d.winRate >= 40 ? 'wr-neutral' : d.winRate > 0 ? 'wr-bad' : 'wr-neutral';

    html += `<div class="tf-section">`;
    html += `<div class="tf-header"><span class="tf-name">${tf}</span><span class="tf-winrate ${wrClass}">${d.winRate}% WR</span></div>`;
    html += `<div class="tf-stats">Cycles: ${d.cycles} | Wins: ${d.wins} | Losses: ${d.losses} | TPs: ${d.tps.length} | Full Cycles: ${d.dones.length}</div>`;

    // Merge all events sorted by time
    const allEvents: {time: string, type: string, data: any}[] = [];
    d.entries.forEach(a => allEvents.push({ time: String(a.created_at).substring(11, 19), type: 'entry', data: a }));
    d.tps.forEach(a => allEvents.push({ time: String(a.created_at).substring(11, 19), type: 'tp', data: a }));
    d.sls.forEach(a => allEvents.push({ time: String(a.created_at).substring(11, 19), type: 'sl', data: a }));
    d.dones.forEach(a => allEvents.push({ time: String(a.created_at).substring(11, 19), type: 'alldone', data: a }));
    allEvents.sort((a, b) => a.time.localeCompare(b.time));

    html += `<table><tr><th>Time</th><th>Event</th><th>Dir</th><th>Entry</th><th>SL</th><th>TP #</th><th>TP Price</th><th>TP Levels</th><th>Price</th><th>Cycle</th></tr>`;
    
    for (const ev of allEvents) {
      const a = ev.data;
      let icon, eventClass;
      const tpNum = a.tp_num || a.tpNum || '';
      if (ev.type === 'entry') { icon = '🟢 ENTRY'; eventClass = 'green'; }
      else if (ev.type === 'tp') { icon = `✅ TP ${tpNum} HIT`; eventClass = 'green'; }
      else if (ev.type === 'sl') { icon = '🛑 SL HIT'; eventClass = 'red'; }
      else { icon = '🎉 FULL CYCLE'; eventClass = 'gold'; }
      
      const dir = getDir(tf, a);
      const dirClass = (dir === 'buy' || dir === 'long') ? 'green' : (dir === 'sell' || dir === 'short') ? 'red' : '';
      const dirText = dir ? dir.toUpperCase() : '-';
      
      const entryPrice = getEntry(tf, a);
      const slPrice = getSL(tf, a);
      
      // For entry alerts, show TP1-TP5 levels from the tp JSON field
      let tpLevels = '-';
      if (ev.type === 'entry' && a.tp) {
        const tp = a.tp;
        const parts = [];
        if (tp.tp1) parts.push(`TP1:$${Number(tp.tp1).toFixed(2)}`);
        if (tp.tp2) parts.push(`TP2:$${Number(tp.tp2).toFixed(2)}`);
        if (tp.tp3) parts.push(`TP3:$${Number(tp.tp3).toFixed(2)}`);
        if (tp.tp4) parts.push(`TP4:$${Number(tp.tp4).toFixed(2)}`);
        if (tp.tp5) parts.push(`TP5:$${Number(tp.tp5).toFixed(2)}`);
        tpLevels = parts.length > 0 ? `<span style="font-size:11px">${parts.join(' ')}</span>` : '-';
      }
      html += `<tr class="event-row">
        <td class="time-col">${ev.time}</td>
        <td class="${eventClass}"><b>${icon}</b></td>
        <td class="${dirClass}">${dirText}</td>
        <td>${entryPrice ? '$' + entryPrice.toFixed(2) : '-'}</td>
        <td>${slPrice ? '$' + slPrice.toFixed(2) : '-'}</td>
        <td>${a.tp_num || a.tpNum || '-'}</td>
        <td>${(a.tp_price || a.tpPrice) ? '$' + Number(a.tp_price || a.tpPrice).toFixed(2) : '-'}</td>
        <td>${tpLevels}</td>
        <td>${a.price ? '$' + Number(a.price).toFixed(2) : '-'}</td>
        <td>#${a.cycle || '-'}</td>
      </tr>`;
    }
    html += `</table>`;
html += `</div>`;
  }

  // Active trades
  if (activeTrades.length > 0) {
    html += `<div class="tf-section"><div class="tf-header"><span class="tf-name">🟢 Active Trades</span></div>`;
    html += `<table><tr><th>TF</th><th>Entry Time</th><th>Dir</th><th>Entry</th><th>SL</th><th>TP1</th><th>TP2</th><th>TP3</th><th>TP4</th><th>TP5</th><th>Hit</th><th>Cycle</th><th>AI</th></tr>`;
    activeTrades.forEach(t => {
      const dc = t.dir === 'long' ? 'green' : 'red';
      const tpCell = (hit, price) => hit
        ? `<td class="green">✅ $${price ? price.toFixed(2) : '-'}</td>`
        : `<td style="color:#555">⬜ $${price ? price.toFixed(2) : '-'}</td>`;
      html += `<tr><td><b>${t.tf}</b></td><td style="color:#888;font-size:11px">${t.entryTime}</td><td class="${dc}">${t.dir.toUpperCase()}</td><td>$${t.entry.toFixed(2)}</td><td>$${t.sl.toFixed(2)}</td>${tpCell(t.tp1Hit, t.tp1)}${tpCell(t.tp2Hit, t.tp2)}${tpCell(t.tp3Hit, t.tp3)}${tpCell(t.tp4Hit, t.tp4)}${tpCell(t.tp5Hit, t.tp5)}<td><b>${t.tpsHit}/5</b></td><td>#${t.cycle}</td><td>${t.aiRec || '-'}</td></tr>`;
    });
    html += `</table></div>`;
  }

  if (totalEntries === 0 && totalTPs === 0 && totalSLs === 0) {
    html += `<div class="tf-section" style="text-align:center;color:#666;padding:24px">No trades in this period. System monitoring active 24/7.</div>`;
  }

  html += `<div class="footer">Gold Sniper Trading System • EMA 9/21 Crossover • ${TFS.join(' / ')} • ${allTradeHistory.length} total trades • ${cumPips >= 0 ? '+' : ''}${cumPips.toFixed(1)} cumulative pips</div>`;
  html += `</body></html>`;

  const subject = mode === 'morning'
    ? `☀️ Gold Sniper Morning — ${today} | ${tradeHistory.length} trades, ${todayWins}W/${todayLosses}L, ${todayPips >= 0 ? '+' : ''}${todayPips.toFixed(1)} pips | WR ${todayWinRate}%`
    : `🎯 Gold Sniper Daily — ${today} | ${tradeHistory.length} trades, ${todayWins}W/${todayLosses}L, ${todayPips >= 0 ? '+' : ''}${todayPips.toFixed(1)} pips | WR ${todayWinRate}%`;

  // Send Email via Resend (styled HTML, no attachment)
  let emailResult = { success: false, error: 'No RESEND_API_KEY' };
  if (RESEND_KEY) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Gold Sniper <onboarding@resend.dev>',
          to: TO_EMAIL,
          subject,
          html
        })
      });
      const data = await resp.json();
      emailResult = { success: resp.ok, id: data?.id || null, error: resp.ok ? null : data?.message };
    } catch (e) {
      emailResult = { success: false, error: String(e) };
    }
  }

  // WhatsApp summary
  let waMsg = `*GOLD SNIPER — ${mode === 'morning' ? 'MORNING' : 'DAILY'} REPORT*\n${now} (IST)\n\n`;
  waMsg += `📊 *TODAY: ${tradeHistory.length || totalEntries} trades | ${todayWins}W ${todayLosses}L | WR ${todayWinRate}%*\n`;
  waMsg += `💰 *Today PnL: ${todayPips >= 0 ? '+' : ''}${todayPips.toFixed(1)} pips (${todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(2)}%)*\n`;
  waMsg += `📈 Best: +${todayBest.toFixed(1)} | Worst: ${todayWorst.toFixed(1)} pips\n\n`;
  waMsg += `*ALL-TIME: ${allTradeHistory.length} trades | ${cumWins}W ${cumLosses}L | WR ${cumWinRate}%*\n`;
  waMsg += `*Total PnL: ${cumPips >= 0 ? '+' : ''}${cumPips.toFixed(1)} pips (${cumPnl >= 0 ? '+' : ''}${cumPnl.toFixed(2)}%)*\n\n`;
  for (const tf of TFS) {
    const d = tfData[tf];
    if (d.entries.length === 0 && d.tps.length === 0 && d.sls.length === 0) continue;
    waMsg += `*${tf}* WR ${d.winRate}% | ${d.wins}W ${d.losses}L\n`;
    for (const a of d.entries) {
      const t = String(a.created_at).substring(11, 19);
      waMsg += `  🟢 ${t} ENTRY ${getDir(tf,a).toUpperCase()} $${getEntry(tf,a)?.toFixed(2)||'?'} #${a.cycle}\n`;
    }
    for (const a of d.tps) {
      const t = String(a.created_at).substring(11, 19);
      const tpN = a.tp_num || a.tpNum || '?';
      waMsg += `  ✅ ${t} TP ${tpN} HIT $${Number(a.tp_price||0).toFixed(2)} (entry $${getEntry(tf,a)?.toFixed(2)||'?'}) #${a.cycle}\n`;
    }
    for (const a of d.sls) {
      const t = String(a.created_at).substring(11, 19);
      waMsg += `  🛑 ${t} SL $${Number(a.price||0).toFixed(2)} (entry $${getEntry(tf,a)?.toFixed(2)||'?'}) #${a.cycle}\n`;
    }
    waMsg += `\n`;
  }
  if (activeTrades.length > 0) {
    waMsg += `🟢 *ACTIVE TRADES*\n`;
    activeTrades.forEach(t => {
      waMsg += `${t.tf} ${t.dir.toUpperCase()} $${t.entry.toFixed(2)} TPs:${t.tpsHit}/5 #${t.cycle}\n`;
    });
  }
  waMsg += `\n_Gold Sniper • EMA 9/21 • ${TFS.join('/')}_`;

  const waResults: any[] = [];
  for (const phone of RECIPIENTS) {
    if (!phone) continue;
    try {
      const resp = await fetch(`https://graph.facebook.com/v18.0/${META_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: waMsg } })
      });
      const data = await resp.json();
      waResults.push({ phone, success: resp.ok });
    } catch (e) {
      waResults.push({ phone, success: false, error: String(e) });
    }
  }

  return new Response(JSON.stringify({
    success: emailResult.success,
    mode, date: today,
    email: emailResult,
    whatsapp: waResults,
    todayPips: Math.round(todayPips * 100) / 100,
    todayPnl: Math.round(todayPnl * 100) / 100,
    todayWinRate,
    cumulativePips: Math.round(cumPips * 100) / 100,
    cumulativePnl: Math.round(cumPnl * 100) / 100,
    cumulativeWinRate: cumWinRate,
    totalTrades: allTradeHistory.length,
    stats: { trades: tradeHistory.length, wins: todayWins, losses: todayLosses, activeTrades: activeTrades.length }
  }), { headers: { 'Content-Type': 'application/json' } });
});
