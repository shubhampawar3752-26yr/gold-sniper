// ── Gold Sniper: Daily Trade Report via Email (Resend) + WhatsApp (Meta API) ──
// Evening report at 23:00 IST — full day's trade history
// Morning report at 09:00 IST — overnight activity + pre-market status
// Email: Resend API → shubhampawar3752@gmail.com
// WhatsApp: Meta WhatsApp Cloud API → recipients

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const TO_EMAIL = 'shubhampawar3752@gmail.com';
const META_TOKEN = Deno.env.get('META_WHATSAPP_TOKEN') || '';
const META_PHONE_ID = Deno.env.get('META_WHATSAPP_PHONE_ID') || '';
const RECIPIENTS = (Deno.env.get('WHATSAPP_RECIPIENTS') || '').split(',').map(s => s.trim()).filter(Boolean);

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
    alertUrl = `${SUPA_URL}/rest/v1/alerts?created_at=gte.${since}&order=created_at.asc&limit=500`;
  } else {
    alertUrl = `${SUPA_URL}/rest/v1/alerts?created_at=gte.${today}T00:00:00&order=created_at.asc&limit=500`;
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

  // Categorize
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
    return { tf, dir: s.dir, entry: s.entry, sl: s.sl, tpsHit, cycle: s.cycle,
             rsi: s.rsi, aiRec: s.aiRecommendation, aiPattern: s.aiPattern,
             tps: [s.tp1, s.tp2, s.tp3, s.tp4, s.tp5] };
  }).filter(Boolean);

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
  .stat .num{font-size:28px;font-weight:bold}
  .stat .label{font-size:11px;color:#888}
  .section{background:#1a1a25;border:1px solid #333;border-radius:10px;padding:16px;margin-bottom:16px}
  .section h2{color:#FFD700;font-size:16px;margin:0 0 12px 0}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;color:#888;padding:8px 6px;border-bottom:1px solid #333}
  td{padding:8px 6px;border-bottom:1px solid #222}
  .green{color:#00e676}.red{color:#ff4444}.gold{color:#FFD700}
  .empty{text-align:center;color:#666;padding:24px}
  .footer{text-align:center;color:#555;font-size:11px;margin-top:20px}
  </style></head><body>`;

  html += `<div class="header"><h1>GOLD SNIPER — ${title}</h1><div class="date">${now} (IST) • ${period}</div></div>`;
  
  html += `<div class="stats">
    <div class="stat"><div class="num gold">${entries.length}</div><div class="label">ENTRIES</div></div>
    <div class="stat"><div class="num green">${tps.length}</div><div class="label">TP HITS</div></div>
    <div class="stat"><div class="num red">${sls.length}</div><div class="label">SL HITS</div></div>
    <div class="stat"><div class="num gold">${dones.length}</div><div class="label">FULL CYCLES</div></div>
    <div class="stat"><div class="num green">${activeTrades.length}</div><div class="label">ACTIVE TRADES</div></div>
  </div>`;

  // Active trades
  if (activeTrades.length > 0) {
    html += `<div class="section"><h2>🟢 Active Trades</h2><table><tr><th>TF</th><th>Dir</th><th>Entry</th><th>SL</th><th>TPs Hit</th><th>Cycle</th><th>RSI</th><th>AI</th></tr>`;
    activeTrades.forEach(t => {
      const dc = t.dir === 'long' ? 'green' : 'red';
      html += `<tr><td><b>${t.tf}</b></td><td class="${dc}">${t.dir.toUpperCase()}</td><td>$${t.entry.toFixed(2)}</td><td>$${t.sl.toFixed(2)}</td><td>${t.tpsHit}/5</td><td>#${t.cycle}</td><td>${t.rsi ? Number(t.rsi).toFixed(1) : '-'}</td><td>${t.aiRec || '-'}</td></tr>`;
    });
    html += `</table></div>`;
  }

  // Entries
  if (entries.length > 0) {
    html += `<div class="section"><h2>🟢 Entries</h2><table><tr><th>Time</th><th>TF</th><th>Dir</th><th>Entry</th><th>SL</th></tr>`;
    entries.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      const dc = a.direction === 'buy' || a.direction === 'long' ? 'green' : 'red';
      html += `<tr><td>${t}</td><td><b>${a.timeframe}</b></td><td class="${dc}">${(a.direction||'').toUpperCase()}</td><td>$${(a.entry||0).toFixed(2)}</td><td>$${(a.sl||0).toFixed(2)}</td></tr>`;
    });
    html += `</table></div>`;
  }

  // TP hits
  if (tps.length > 0) {
    html += `<div class="section"><h2>✅ TP Hits</h2><table><tr><th>Time</th><th>TF</th><th>TP #</th><th>TP Price</th><th>Price</th></tr>`;
    tps.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      html += `<tr><td>${t}</td><td><b>${a.timeframe}</b></td><td>TP${a.tp_num||'?'}</td><td>$${(a.tp_price||0).toFixed(2)}</td><td>$${(a.price||0).toFixed(2)}</td></tr>`;
    });
    html += `</table></div>`;
  }

  // SL hits
  if (sls.length > 0) {
    html += `<div class="section"><h2>🛑 SL Hits</h2><table><tr><th>Time</th><th>TF</th><th>Entry</th><th>SL</th><th>Exit</th></tr>`;
    sls.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      html += `<tr><td>${t}</td><td><b>${a.timeframe}</b></td><td>$${(a.entry||0).toFixed(2)}</td><td>$${(a.sl||0).toFixed(2)}</td><td>$${(a.price||0).toFixed(2)}</td></tr>`;
    });
    html += `</table></div>`;
  }

  // Full cycles
  if (dones.length > 0) {
    html += `<div class="section"><h2>🎉 Full Cycle Completions</h2><table><tr><th>Time</th><th>TF</th><th>Entry</th><th>Final</th><th>Cycle</th></tr>`;
    dones.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      html += `<tr><td>${t}</td><td><b>${a.timeframe}</b></td><td>$${(a.entry||0).toFixed(2)}</td><td>$${(a.price||0).toFixed(2)}</td><td>#${a.cycle||'?'}</td></tr>`;
    });
    html += `</table></div>`;
  }

  if (entries.length === 0 && tps.length === 0 && sls.length === 0) {
    html += `<div class="section empty">No trades in this period. System monitoring active 24/7.</div>`;
  }

  html += `<div class="footer">Gold Sniper Trading System • EMA 9/21 Crossover • ${TFS.join(' / ')} • Auto-generated ${mode} report at ${mode === 'morning' ? '09:00' : '23:00'} IST</div>`;
  html += `</body></html>`;

  const subject = mode === 'morning'
    ? `☀️ Gold Sniper Morning Report — ${today} | ${activeTrades.length} active, ${tps.length} TPs, ${sls.length} SLs overnight`
    : `🎯 Gold Sniper Daily Report — ${today} | ${entries.length} entries, ${tps.length} TPs, ${sls.length} SLs`;

  // ── Send Email via Resend ──
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

  // ── Also send via WhatsApp (Meta API) ──
  const waResults: any[] = [];
  for (const phone of RECIPIENTS) {
    if (!phone) continue;
    try {
      const resp = await fetch(`https://graph.facebook.com/v18.0/${META_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone,
          type: 'text',
          text: { body: subject.replace('☀️ ','').replace('🎯 ','') + `\n${tps.length} TPs, ${sls.length} SLs, ${activeTrades.length} active trades` }
        })
      });
      const data = await resp.json();
      waResults.push({ phone, success: resp.ok, id: data?.messages?.[0]?.id });
    } catch (e) {
      waResults.push({ phone, success: false, error: String(e) });
    }
  }

  return new Response(JSON.stringify({
    success: emailResult.success,
    mode, date: today,
    email: emailResult,
    whatsapp: waResults,
    stats: { entries: entries.length, tps: tps.length, sls: sls.length, fullCycles: dones.length, activeTrades: activeTrades.length }
  }), { headers: { 'Content-Type': 'application/json' } });
});
