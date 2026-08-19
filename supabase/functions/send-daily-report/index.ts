// ── Gold Sniper: Daily Trade Report ──
// Evening report at 23:00 IST — full day's trade history via WhatsApp
// Morning report at 09:00 IST — overnight activity + pre-market status via WhatsApp
// Delivers via Meta WhatsApp Cloud API (same as trading alerts)

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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
             rsi: s.rsi, aiRec: s.aiRecommendation, aiPattern: s.aiPattern };
  }).filter(Boolean);

  // Build WhatsApp message
  const title = mode === 'morning' ? '☀️ MORNING REPORT' : '🎯 DAILY REPORT';
  const period = mode === 'morning' ? 'Overnight (last 12h)' : "Today's full history";
  
  let msg = `*GOLD SNIPER — ${title}*\n${now} (IST)\n${period}\n\n`;
  msg += `📊 *SUMMARY*\n`;
  msg += `Entries: ${entries.length}\nTP Hits: ${tps.length}\nSL Hits: ${sls.length}\nFull Cycles: ${dones.length}\nActive Trades: ${activeTrades.length}\n`;

  // Active trades
  if (activeTrades.length > 0) {
    msg += `\n🟢 *ACTIVE TRADES*\n`;
    activeTrades.forEach(t => {
      msg += `\n*${t.tf}* ${t.dir.toUpperCase()} | Entry: $${t.entry.toFixed(2)} | SL: $${t.sl.toFixed(2)} | TPs: ${t.tpsHit}/5 | Cycle: #${t.cycle}\n`;
      if (t.rsi) msg += `RSI: ${Number(t.rsi).toFixed(1)}`;
      if (t.aiRec) msg += ` | AI: ${t.aiRec}`;
      if (t.aiPattern) msg += ` (${t.aiPattern})`;
      msg += `\n`;
    });
  }

  // TP hits
  if (tps.length > 0) {
    msg += `\n✅ *TP HITS${mode === 'morning' ? ' (OVERNIGHT)' : ''}*\n`;
    tps.slice(0, 20).forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      msg += `${t} | ${a.timeframe} | TP${a.tp_num || '?'} | $${(a.tp_price || 0).toFixed(2)}\n`;
    });
    if (tps.length > 20) msg += `... and ${tps.length - 20} more\n`;
  }

  // SL hits
  if (sls.length > 0) {
    msg += `\n🛑 *SL HITS${mode === 'morning' ? ' (OVERNIGHT)' : ''}*\n`;
    sls.slice(0, 15).forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      msg += `${t} | ${a.timeframe} | Entry: $${(a.entry || 0).toFixed(2)} | Exit: $${(a.price || 0).toFixed(2)}\n`;
    });
    if (sls.length > 15) msg += `... and ${sls.length - 15} more\n`;
  }

  // Full cycles
  if (dones.length > 0) {
    msg += `\n🎉 *FULL CYCLE COMPLETIONS*\n`;
    dones.forEach(a => {
      const t = String(a.created_at).substring(11, 19);
      msg += `${t} | ${a.timeframe} | Entry: $${(a.entry || 0).toFixed(2)} | Final: $${(a.price || 0).toFixed(2)} | Cycle: #${a.cycle || '?'}\n`;
    });
  }

  if (entries.length === 0 && tps.length === 0 && sls.length === 0) {
    msg += `\nNo trades in this period. System monitoring active 24/7.\n`;
  }

  msg += `\n_Gold Sniper • EMA 9/21 • ${TFS.join('/')} • Auto ${mode} report_`;

  // Send via Meta WhatsApp Cloud API
  const results: any[] = [];
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
          text: { body: msg }
        })
      });
      const data = await resp.json();
      results.push({ phone, success: resp.ok, id: data?.messages?.[0]?.id, error: resp.ok ? null : data?.error?.message });
    } catch (e) {
      results.push({ phone, success: false, error: String(e) });
    }
  }

  return new Response(JSON.stringify({
    success: results.every(r => r.success),
    mode,
    date: today,
    recipients: RECIPIENTS.length,
    results,
    stats: { entries: entries.length, tps: tps.length, sls: sls.length, fullCycles: dones.length, activeTrades: activeTrades.length },
    messageLength: msg.length
  }), { headers: { 'Content-Type': 'application/json' } });
});
