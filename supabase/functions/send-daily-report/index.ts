// ── Gold Sniper: Daily Trade History Email ──
// Runs daily at 23:00 IST — sends today's trade history to shubhampawar3752@gmail.com
// Uses Resend API (free tier: 100 emails/day) — needs RESEND_API_KEY env var

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
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

  // Build HTML email
  let html = `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0a0a0f; color: #e0e0e0; margin: 0; padding: 20px; }
  .header { text-align: center; padding: 20px; background: linear-gradient(135deg, #1a1a25, #12121a); border-radius: 12px; border: 1px solid #333; margin-bottom: 20px; }
  .header h1 { color: #FFD700; margin: 0; font-size: 24px; letter-spacing: 2px; }
  .header .date { color: #888; font-size: 14px; margin-top: 8px; }
  .section { background: #1a1a25; border: 1px solid #333; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .section h2 { color: #FFD700; font-size: 16px; margin: 0 0 12px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #888; padding: 8px 6px; border-bottom: 1px solid #333; }
  td { padding: 8px 6px; border-bottom: 1px solid #222; }
  .green { color: #00e676; } .red { color: #ff4444; } .gold { color: #FFD700; }
  .stat { display: inline-block; text-align: center; padding: 12px 20px; background: #12121a; border: 1px solid #333; border-radius: 8px; margin: 4px; }
  .stat .num { font-size: 28px; font-weight: bold; } .stat .label { font-size: 11px; color: #888; }
  .summary { text-align: center; margin-bottom: 16px; }
</style></head><body>
<div class="header">
  <h1>🎯 GOLD SNIPER — Daily Trade Report</h1>
  <div class="date">${now} (IST)</div>
</div>
<div class="summary">
  <div class="stat"><div class="num gold">${entries.length}</div><div class="label">ENTRIES</div></div>
  <div class="stat"><div class="num green">${tps.length}</div><div class="label">TP HITS</div></div>
  <div class="stat"><div class="num red">${sls.length}</div><div class="label">SL HITS</div></div>
  <div class="stat"><div class="num gold">${dones.length}</div><div class="label">FULL CYCLES</div></div>
  <div class="stat"><div class="num green">${activeTrades.length}</div><div class="label">ACTIVE TRADES</div></div>
</div>
`;

  // Active trades section
  if (activeTrades.length > 0) {
    html += `<div class="section"><h2>🟢 Active Trades</h2><table><tr><th>TF</th><th>Dir</th><th>Entry</th><th>SL</th><th>TPs Hit</th><th>Cycle</th></tr>`;
    activeTrades.forEach(t => {
      const dirColor = t.dir === 'long' ? 'green' : 'red';
      html += `<tr><td><b>${t.tf}</b></td><td class="${dirColor}">${t.dir.toUpperCase()}</td><td>${t.entry.toFixed(2)}</td><td>${t.sl.toFixed(2)}</td><td>${t.tpsHit}/5</td><td>#${t.cycle}</td></tr>`;
    });
    html += `</table></div>`;
  }

  // Today's entries
  if (entries.length > 0) {
    html += `<div class="section"><h2>🟢 Today's Entries</h2><table><tr><th>Time</th><th>TF</th><th>Dir</th><th>Entry</th><th>SL</th><th>AI</th></tr>`;
    entries.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      const dirColor = a.direction === 'buy' ? 'green' : 'red';
      html += `<tr><td>${t}</td><td><b>${a.timeframe}</b></td><td class="${dirColor}">${(a.direction || '').toUpperCase()}</td><td>${a.entry?.toFixed(2) || '-'}</td><td>${a.sl?.toFixed(2) || '-'}</td><td>${a.aiReason || '-'}</td></tr>`;
    });
    html += `</table></div>`;
  }

  // TP hits
  if (tps.length > 0) {
    html += `<div class="section"><h2>✅ TP Hits Today</h2><table><tr><th>Time</th><th>TF</th><th>TP #</th><th>TP Price</th><th>Price</th></tr>`;
    tps.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      html += `<tr><td>${t}</td><td><b>${a.timeframe}</b></td><td>TP${a.tpNum || a.tp_num || '?'}</td><td>${(a.tpPrice || a.tp_price || 0).toFixed(2)}</td><td>${a.price?.toFixed(2) || '-'}</td></tr>`;
    });
    html += `</table></div>`;
  }

  // SL hits
  if (sls.length > 0) {
    html += `<div class="section"><h2>🛑 SL Hits Today</h2><table><tr><th>Time</th><th>TF</th><th>Entry</th><th>SL</th><th>Exit Price</th></tr>`;
    sls.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      html += `<tr><td>${t}</td><td><b>${a.timeframe}</b></td><td>${a.entry?.toFixed(2) || '-'}</td><td>${a.sl?.toFixed(2) || '-'}</td><td>${a.price?.toFixed(2) || '-'}</td></tr>`;
    });
    html += `</table></div>`;
  }

  // Full cycles
  if (dones.length > 0) {
    html += `<div class="section"><h2>🎉 Full Cycle Completions</h2><table><tr><th>Time</th><th>TF</th><th>Entry</th><th>Final Price</th><th>Cycle</th></tr>`;
    dones.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      html += `<tr><td>${t}</td><td><b>${a.timeframe}</b></td><td>${a.entry?.toFixed(2) || '-'}</td><td>${a.price?.toFixed(2) || '-'}</td><td>#${a.cycle || '-'}</td></tr>`;
    });
    html += `</table></div>`;
  }

  if (entries.length === 0 && tps.length === 0 && sls.length === 0) {
    html += `<div class="section" style="text-align:center;color:#888;padding:30px;">No trades today. System monitoring active 24/7.</div>`;
  }

  html += `<div style="text-align:center;color:#555;font-size:11px;margin-top:20px;">Gold Sniper Trading System • EMA 9/21 Crossover • ${TFS.join(' / ')} • Auto-generated daily report</div>`;
  html += `</body></html>`;

  // Send via Resend API
  if (!RESEND_KEY) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'RESEND_API_KEY not set. Get a free key at https://resend.com',
      alertCount: alerts.length,
      entries: entries.length,
      tps: tps.length,
      sls: sls.length,
      activeTrades: activeTrades.length
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Gold Sniper <onboarding@resend.dev>',
      to: TO_EMAIL,
      subject: `🎯 Gold Sniper Daily Report — ${today} | ${entries.length} entries, ${tps.length} TPs, ${sls.length} SLs`,
      html
    })
  });

  const emailData = await emailResp.json();

  return new Response(JSON.stringify({
    success: emailResp.ok,
    date: today,
    sent: emailResp.ok,
    emailId: emailData?.id || null,
    error: emailResp.ok ? null : (emailData?.message || 'Unknown error'),
    stats: { entries: entries.length, tps: tps.length, sls: sls.length, fullCycles: dones.length, activeTrades: activeTrades.length }
  }), { headers: { 'Content-Type': 'application/json' } });
});
