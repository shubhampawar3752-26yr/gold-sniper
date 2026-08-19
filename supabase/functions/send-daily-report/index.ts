// ── Gold Sniper: Daily Trade History Email ──
// Evening report at 23:00 IST — full day's trade history
// Morning report at 09:00 IST — overnight activity + pre-market status
// Uses FormSubmit.co — free, no signup, no API key needed

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TO_EMAIL = 'shubhampawar3752@gmail.com';

Deno.serve(async (req) => {
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  
  let mode = 'evening';
  try {
    const body = await req.json();
    if (body?.mode === 'morning') mode = 'morning';
  } catch {}

  // Fetch today's alerts (for evening) or last 12 hours (for morning)
  let alertFilter;
  if (mode === 'morning') {
    // Last 12 hours (overnight coverage from ~9pm to 9am)
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    alertFilter = `created_at=gte.${since}&order=created_at.asc&limit=500`;
  } else {
    alertFilter = `created_at=gte.${today}T00:00:00&order=created_at.asc&limit=500`;
  }

  const r = await fetch(`${SUPA_URL}/rest/v1/alerts?${alertFilter}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  const alerts: any[] = await r.json();

  // Fetch current trading state
  const r2 = await fetch(`${SUPA_URL}/rest/v1/trading_states?select=*&limit=1`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  const states: any[] = await r2.json();
  const state = states[0]?.states || {};

  // Fetch AI candle analysis for current readings
  const r3 = await fetch(`${SUPA_URL}/rest/v1/ai_candle_analysis?order=created_at.desc&limit=6`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  const aiData: any[] = await r3.json();

  // Build trade history
  const entries = alerts.filter(a => a.type === 'entry');
  const tps = alerts.filter(a => a.type === 'tp');
  const sls = alerts.filter(a => a.type === 'sl');
  const dones = alerts.filter(a => a.type === 'alldone');

  // Active trades
  const TFS = ['1M', '5M', '15M', '30M', '1H', '4H'];
  const activeTrades = TFS.map(tf => {
    const s = state[tf];
    if (!s || s.entry === 0 || s.slHit || s.allDone) return null;
    const tpsHit = [s.tp1Hit, s.tp2Hit, s.tp3Hit, s.tp4Hit, s.tp5Hit].filter(Boolean).length;
    return {
      tf, dir: s.dir, entry: s.entry, sl: s.sl,
      tps: [s.tp1, s.tp2, s.tp3, s.tp4, s.tp5],
      tpsHit, cycle: s.cycle,
      rsi: s.rsi, aiRec: s.aiRecommendation, aiPattern: s.aiPattern
    };
  }).filter(Boolean);

  // Build email body
  const title = mode === 'morning' ? '☀️ MORNING REPORT' : '🎯 DAILY REPORT';
  const subtitle = mode === 'morning' 
    ? 'Overnight activity + pre-market status' 
    : "Today's full trade history";
  
  let body = `${title} — Gold Sniper\n${now} (IST)\n${subtitle}\n\n`;
  body += `═══════════════════════════════════════\n`;
  body += `SUMMARY${mode === 'morning' ? ' (last 12h)' : ''}\n`;
  body += `═══════════════════════════════════════\n`;
  body += `Entries:       ${entries.length}\n`;
  body += `TP Hits:       ${tps.length}\n`;
  body += `SL Hits:       ${sls.length}\n`;
  body += `Full Cycles:   ${dones.length}\n`;
  body += `Active Trades: ${activeTrades.length}\n\n`;

  // Active trades with AI scanner data
  if (activeTrades.length > 0) {
    body += `═══════════════════════════════════════\n`;
    body += `🟢 ACTIVE TRADES\n`;
    body += `═══════════════════════════════════════\n`;
    activeTrades.forEach(t => {
      body += `\n[${t.tf}] ${t.dir.toUpperCase()} | Entry: ${t.entry.toFixed(2)} | SL: ${t.sl.toFixed(2)} | TPs: ${t.tpsHit}/5 | Cycle: #${t.cycle}\n`;
      body += `  TP Levels: ${t.tps.map(tp => tp?.toFixed(2)).join(' → ')}\n`;
      if (t.rsi) body += `  RSI: ${Number(t.rsi).toFixed(1)}`;
      if (t.aiRec) body += ` | AI: ${t.aiRec} (${t.aiPattern || '-'})`;
      body += `\n`;
    });
    body += `\n`;
  }

  // AI Scanner readings (morning only)
  if (mode === 'morning' && aiData.length > 0) {
    body += `═══════════════════════════════════════\n`;
    body += `🤖 AI CANDLE SCANNER — Latest Readings\n`;
    body += `═══════════════════════════════════════\n`;
    const seen = new Set();
    aiData.forEach(a => {
      const tf = a.timeframe;
      if (seen.has(tf)) return;
      seen.add(tf);
      body += `${tf} | ${a.recommendation?.toUpperCase() || '?'} | ${a.pattern || '-'} | Confidence: ${a.confidence || '?'}\n`;
    });
    body += `\n`;
  }

  // Today's entries
  if (entries.length > 0) {
    body += `═══════════════════════════════════════\n`;
    body += `🟢 ENTRIES\n`;
    body += `═══════════════════════════════════════\n`;
    entries.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      body += `${t} | ${a.timeframe} | ${(a.direction || '').toUpperCase()} | Entry: ${a.entry?.toFixed(2) || '-'} | SL: ${a.sl?.toFixed(2) || '-'} | AI: ${a.aiReason || '-'}\n`;
    });
    body += `\n`;
  }

  // TP hits
  if (tps.length > 0) {
    body += `═══════════════════════════════════════\n`;
    body += `✅ TP HITS\n`;
    body += `═══════════════════════════════════════\n`;
    tps.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      body += `${t} | ${a.timeframe} | TP${a.tpNum || a.tp_num || '?'} | TP: ${(a.tpPrice || a.tp_price || 0).toFixed(2)} | Price: ${a.price?.toFixed(2) || '-'}\n`;
    });
    body += `\n`;
  }

  // SL hits
  if (sls.length > 0) {
    body += `═══════════════════════════════════════\n`;
    body += `🛑 SL HITS\n`;
    body += `═══════════════════════════════════════\n`;
    sls.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      body += `${t} | ${a.timeframe} | Entry: ${a.entry?.toFixed(2) || '-'} | SL: ${a.sl?.toFixed(2) || '-'} | Exit: ${a.price?.toFixed(2) || '-'}\n`;
    });
    body += `\n`;
  }

  // Full cycles
  if (dones.length > 0) {
    body += `═══════════════════════════════════════\n`;
    body += `🎉 FULL CYCLE COMPLETIONS\n`;
    body += `═══════════════════════════════════════\n`;
    dones.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      body += `${t} | ${a.timeframe} | Entry: ${a.entry?.toFixed(2) || '-'} | Final: ${a.price?.toFixed(2) || '-'} | Cycle: #${a.cycle || '-'}\n`;
    });
    body += `\n`;
  }

  if (entries.length === 0 && tps.length === 0 && sls.length === 0) {
    body += `\nNo trades in this period. System monitoring active 24/7.\n`;
  }

  body += `\n═══════════════════════════════════════\n`;
  body += `Gold Sniper Trading System • EMA 9/21 Crossover • ${TFS.join(' / ')}\n`;
  body += `Auto-generated ${mode === 'morning' ? 'morning' : 'daily'} report at ${mode === 'morning' ? '09:00' : '23:00'} IST`;

  // Send via FormSubmit.co
  const subject = mode === 'morning'
    ? `☀️ Gold Sniper Morning Report — ${today} | ${activeTrades.length} active, ${tps.length} TPs, ${sls.length} SLs overnight`
    : `🎯 Gold Sniper Daily Report — ${today} | ${entries.length} entries, ${tps.length} TPs, ${sls.length} SLs`;

  const formData = new URLSearchParams();
  formData.append('subject', subject);
  formData.append('message', body);

  const emailResp = await fetch(`https://formsubmit.co/${TO_EMAIL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString()
  });

  return new Response(JSON.stringify({
    success: emailResp.ok,
    mode,
    date: today,
    emailStatus: emailResp.status,
    stats: { entries: entries.length, tps: tps.length, sls: sls.length, fullCycles: dones.length, activeTrades: activeTrades.length }
  }), { headers: { 'Content-Type': 'application/json' } });
});
