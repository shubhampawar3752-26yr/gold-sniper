// ── Gold Sniper: Daily Trade History Email ──
// Runs daily at 23:00 IST — sends today's trade history to shubhampawar3752@gmail.com
// Uses FormSubmit.co — free, no signup, no API key needed

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TO_EMAIL = 'shubhampawar3752@gmail.com';

Deno.serve(async (req) => {
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Fetch today's alerts
  const r = await fetch(
    `${SUPA_URL}/rest/v1/alerts?created_at=gte.${today}T00:00:00&order=created_at.asc&limit=500`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
  );
  const alerts: any[] = await r.json();

  // Fetch current trading state
  const r2 = await fetch(`${SUPA_URL}/rest/v1/trading_states?select=*&limit=1`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  const states: any[] = await r2.json();
  const state = states[0]?.states || {};

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
      tpsHit, cycle: s.cycle
    };
  }).filter(Boolean);

  // Build plain text email body
  let body = `🎯 GOLD SNIPER — Daily Trade Report\n${now} (IST)\n\n`;
  body += `═══════════════════════════════════════\n`;
  body += `SUMMARY\n`;
  body += `═══════════════════════════════════════\n`;
  body += `Entries:       ${entries.length}\n`;
  body += `TP Hits:       ${tps.length}\n`;
  body += `SL Hits:       ${sls.length}\n`;
  body += `Full Cycles:   ${dones.length}\n`;
  body += `Active Trades: ${activeTrades.length}\n\n`;

  // Active trades
  if (activeTrades.length > 0) {
    body += `═══════════════════════════════════════\n`;
    body += `🟢 ACTIVE TRADES\n`;
    body += `═══════════════════════════════════════\n`;
    activeTrades.forEach(t => {
      body += `\n[${t.tf}] ${t.dir.toUpperCase()} | Entry: ${t.entry.toFixed(2)} | SL: ${t.sl.toFixed(2)} | TPs: ${t.tpsHit}/5 | Cycle: #${t.cycle}\n`;
      body += `  TP Levels: ${t.tps.map(tp => tp?.toFixed(2)).join(' → ')}\n`;
    });
    body += `\n`;
  }

  // Today's entries
  if (entries.length > 0) {
    body += `═══════════════════════════════════════\n`;
    body += `🟢 TODAY'S ENTRIES\n`;
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
    body += `✅ TP HITS TODAY\n`;
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
    body += `🛑 SL HITS TODAY\n`;
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
    body += `\nNo trades today. System monitoring active 24/7.\n`;
  }

  body += `\n═══════════════════════════════════════\n`;
  body += `Gold Sniper Trading System • EMA 9/21 Crossover • ${TFS.join(' / ')}\n`;
  body += `Auto-generated daily report at 23:00 IST`;

  // Send via FormSubmit.co (free, no API key, no signup)
  const formData = new URLSearchParams();
  formData.append('subject', `🎯 Gold Sniper Daily Report — ${today} | ${entries.length} entries, ${tps.length} TPs, ${sls.length} SLs`);
  formData.append('message', body);

  const emailResp = await fetch(`https://formsubmit.co/${TO_EMAIL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString()
  });

  const emailText = await emailResp.text();
  const isConfirm = emailText.includes('confirm') || emailText.includes('Confirm') || emailText.includes('activation');

  return new Response(JSON.stringify({
    success: emailResp.ok,
    date: today,
    emailStatus: emailResp.status,
    needsConfirmation: isConfirm,
    message: isConfirm 
      ? 'FormSubmit sent a confirmation email to shubhampawar3752@gmail.com — click the link in it to activate, then the daily emails will work automatically.'
      : (emailResp.ok ? 'Email sent successfully!' : 'Failed to send'),
    stats: { entries: entries.length, tps: tps.length, sls: sls.length, fullCycles: dones.length, activeTrades: activeTrades.length }
  }), { headers: { 'Content-Type': 'application/json' } });
});
