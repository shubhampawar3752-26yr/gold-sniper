// ── Gold Sniper: Daily Trade Report — PDF Email + WhatsApp ──
// Generates a styled PDF report, sends as email attachment via Resend
// Also sends WhatsApp summary via Meta API

import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const TO_EMAIL = 'shubhampawar3752@gmail.com';
const META_TOKEN = Deno.env.get('META_WHATSAPP_TOKEN') || '';
const META_PHONE_ID = Deno.env.get('META_WHATSAPP_PHONE_ID') || '';
const RECIPIENTS = (Deno.env.get('WHATSAPP_RECIPIENTS') || '').split(',').map(s => s.trim()).filter(Boolean);

const TFS = ['1M', '5M', '15M', '30M', '1H', '4H'];

// Colors
const GOLD = rgb(0.85, 0.65, 0.0);
const GREEN = rgb(0.0, 0.7, 0.3);
const RED = rgb(0.8, 0.2, 0.2);
const WHITE = rgb(0.9, 0.9, 0.9);
const GRAY = rgb(0.5, 0.5, 0.5);
const DARK = rgb(0.08, 0.08, 0.12);
const MID = rgb(0.15, 0.15, 0.2);
const LIGHT = rgb(0.25, 0.25, 0.3);

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
    alertUrl = `${SUPA_URL}/rest/v1/alerts?created_at=gte.${since}&order=created_at.asc&limit=1000`;
  } else {
    alertUrl = `${SUPA_URL}/rest/v1/alerts?created_at=gte.${today}T00:00:00&order=created_at.asc&limit=1000`;
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

  // Fetch ALL entry alerts for cycle→entry lookup
  const rEntries = await fetch(
    `${SUPA_URL}/rest/v1/alerts?type=eq.entry&order=created_at.desc&limit=1000`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
  );
  const allEntryAlerts: any[] = await rEntries.json();

  // Build cycle→entry maps
  const cycleEntryMap: Record<string, Record<number, number>> = {};
  const cycleDirMap: Record<string, Record<number, string>> = {};
  const cycleSLMap: Record<string, Record<number, number>> = {};

  for (const tf of TFS) {
    cycleEntryMap[tf] = {};
    cycleDirMap[tf] = {};
    cycleSLMap[tf] = {};
    const tfEntries = allEntryAlerts.filter(a => a.timeframe === tf);
    for (const a of tfEntries) {
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

  function getEntry(tf: string, a: any): number | null {
    if (a.entry) return Number(a.entry);
    if (a.cycle != null && cycleEntryMap[tf][a.cycle]) return cycleEntryMap[tf][a.cycle];
    return null;
  }
  function getDir(tf: string, a: any): string {
    return a.direction || a.dir || (a.cycle != null ? cycleDirMap[tf][a.cycle] || '' : '');
  }
  function getSL(tf: string, a: any): number | null {
    if (a.sl) return Number(a.sl);
    if (a.cycle != null && cycleSLMap[tf][a.cycle]) return cycleSLMap[tf][a.cycle];
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
    const wins = new Set(tps.map(a => a.cycle)).size;
    const losses = sls.length;
    const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    tfData[tf] = { entries, tps, sls, dones, wins, losses, winRate, cycles: entries.length };
  }

  // Active trades
  const activeTrades = TFS.map(tf => {
    const s = state[tf];
    if (!s || s.entry === 0 || s.slHit || s.allDone) return null;
    const tpsHit = [s.tp1Hit, s.tp2Hit, s.tp3Hit, s.tp4Hit, s.tp5Hit].filter(Boolean).length;
    return { tf, dir: s.dir, entry: s.entry, sl: s.sl, tpsHit, cycle: s.cycle, rsi: s.rsi, aiRec: s.aiRecommendation };
  }).filter(Boolean);

  // Totals
  const totalEntries = Object.values(tfData).reduce((s: number, d: any) => s + d.entries.length, 0);
  const totalTPs = Object.values(tfData).reduce((s: number, d: any) => s + d.tps.length, 0);
  const totalSLs = Object.values(tfData).reduce((s: number, d: any) => s + d.sls.length, 0);
  const totalDones = Object.values(tfData).reduce((s: number, d: any) => s + d.dones.length, 0);
  const totalWins = Object.values(tfData).reduce((s: number, d: any) => s + d.wins, 0);
  const totalLosses = Object.values(tfData).reduce((s: number, d: any) => s + d.losses, 0);
  const overallWR = (totalWins + totalLosses) > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0;

  // ════════════════════════════════════════
  // Generate PDF
  // ════════════════════════════════════════
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);
  
  const PAGE_W = 595; // A4 width in points
  const PAGE_H = 842; // A4 height
  const MARGIN = 40;
  const contentW = PAGE_W - MARGIN * 2;
  
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  function ensureSpace(h: number) {
    if (y - h < MARGIN) newPage();
  }

  function drawRect(x: number, y: number, w: number, h: number, color: any, radius = 0) {
    if (radius > 0) {
      // Rounded rect approximation
      page.drawRectangle({ x, y, width: w, height: h, color, radius });
    } else {
      page.drawRectangle({ x, y, width: w, height: h, color });
    }
  }

  function drawText(text: string, x: number, y: number, size: number, color: any, f = font) {
    page.drawText(text, { x, y, size, color, font: f });
  }

  function textW(text: string, size: number, f = font) {
    return f.widthOfTextAtSize(text, size);
  }

  // ── Header ──
  drawRect(MARGIN, y - 60, contentW, 60, DARK, 8);
  const title = mode === 'morning' ? 'MORNING REPORT' : 'DAILY REPORT';
  drawText('GOLD SNIPER', MARGIN + 16, y - 26, 22, GOLD, fontBold);
  drawText(title, MARGIN + 16, y - 46, 12, GRAY);
  drawText(now + ' (IST)', PAGE_W - MARGIN - textW(now + ' (IST)', 10, font) - 16, y - 26, 10, GRAY);
  drawText(`${mode === 'morning' ? 'Overnight (12h)' : "Today's History"}`, PAGE_W - MARGIN - 120, y - 46, 10, GRAY);
  y -= 80;

  // ── Summary Stat Tiles ──
  const tileW = (contentW - 20) / 6;
  const tileH = 50;
  const stats = [
    { label: 'ENTRIES', value: String(totalEntries), color: GOLD },
    { label: 'TP HITS', value: String(totalTPs), color: GREEN },
    { label: 'SL HITS', value: String(totalSLs), color: RED },
    { label: 'CYCLES', value: String(totalDones), color: GOLD },
    { label: 'WIN RATE', value: overallWR + '%', color: overallWR >= 50 ? GREEN : RED },
    { label: 'ACTIVE', value: String(activeTrades.length), color: GREEN },
  ];
  
  for (let i = 0; i < stats.length; i++) {
    const tx = MARGIN + i * (tileW + 4);
    drawRect(tx, y - tileH, tileW, tileH, MID, 6);
    drawText(stats[i].value, tx + tileW/2 - textW(stats[i].value, 20, fontBold)/2, y - 22, 20, stats[i].color, fontBold);
    drawText(stats[i].label, tx + tileW/2 - textW(stats[i].label, 8, font)/2, y - 40, 8, GRAY);
  }
  y -= tileH + 16;

  // ── Timeframe Sections ──
  for (const tf of TFS) {
    const d = tfData[tf];
    if (d.entries.length === 0 && d.tps.length === 0 && d.sls.length === 0 && d.dones.length === 0) continue;

    // Merge all events sorted by time
    const allEvents: {time: string, type: string, data: any}[] = [];
    d.entries.forEach(a => allEvents.push({ time: String(a.created_at).substring(11, 19), type: 'entry', data: a }));
    d.tps.forEach(a => allEvents.push({ time: String(a.created_at).substring(11, 19), type: 'tp', data: a }));
    d.sls.forEach(a => allEvents.push({ time: String(a.created_at).substring(11, 19), type: 'sl', data: a }));
    d.dones.forEach(a => allEvents.push({ time: String(a.created_at).substring(11, 19), type: 'alldone', data: a }));
    allEvents.sort((a, b) => a.time.localeCompare(b.time));

    const sectionH = 50 + allEvents.length * 18 + 10;
    ensureSpace(sectionH);

    // TF header bar
    drawRect(MARGIN, y - 28, contentW, 28, MID, 6);
    drawText(tf, MARGIN + 12, y - 19, 14, GOLD, fontBold);
    
    // Win rate badge
    const wrText = `${d.winRate}% WR`;
    const wrColor = d.winRate >= 60 ? GREEN : d.winRate >= 40 ? GOLD : d.winRate > 0 ? RED : GRAY;
    const wrW = textW(wrText, 11, fontBold) + 16;
    drawRect(MARGIN + 50, y - 22, wrW, 18, DARK, 4);
    drawText(wrText, MARGIN + 58, y - 16, 11, wrColor, fontBold);
    
    // Stats text
    const stText = `Cycles: ${d.cycles}  Wins: ${d.wins}  Losses: ${d.losses}  TPs: ${d.tps.length}  Full: ${d.dones.length}`;
    drawText(stText, PAGE_W - MARGIN - textW(stText, 9, font) - 12, y - 18, 9, GRAY);
    y -= 36;

    // Table header
    const colX = [MARGIN + 4, MARGIN + 60, MARGIN + 110, MARGIN + 175, MARGIN + 240, MARGIN + 280, MARGIN + 320, MARGIN + 380, MARGIN + 430];
    const headers = ['Time', 'Event', 'Dir', 'Entry', 'SL', 'TP#', 'TP Price', 'Price', 'Cycle'];
    drawRect(MARGIN, y - 16, contentW, 16, DARK);
    for (let i = 0; i < headers.length; i++) {
      drawText(headers[i], colX[i], y - 12, 8, GRAY, fontBold);
    }
    y -= 18;

    // Event rows
    for (const ev of allEvents) {
      ensureSpace(18);
      const a = ev.data;
      
      let icon = '', eventColor = WHITE;
      if (ev.type === 'entry') { icon = 'ENTRY'; eventColor = GREEN; }
      else if (ev.type === 'tp') { icon = 'TP HIT'; eventColor = GREEN; }
      else if (ev.type === 'sl') { icon = 'SL HIT'; eventColor = RED; }
      else { icon = 'FULL CYCLE'; eventColor = GOLD; }
      
      const dir = getDir(tf, a);
      const dirText = dir ? dir.toUpperCase().substring(0, 5) : '-';
      const dirColor = (dir === 'buy' || dir === 'long') ? GREEN : (dir === 'sell' || dir === 'short') ? RED : GRAY;
      
      const entryPrice = getEntry(tf, a);
      const slPrice = getSL(tf, a);
      const tpNum = a.tp_num || a.tpNum || '-';
      const tpPrice = (a.tp_price || a.tpPrice) ? '$' + Number(a.tp_price || a.tpPrice).toFixed(2) : '-';
      const price = a.price ? '$' + Number(a.price).toFixed(2) : '-';
      const cycle = '#' + (a.cycle || '-');

      // Alternating row background
      const rowIdx = allEvents.indexOf(ev);
      if (rowIdx % 2 === 0) drawRect(MARGIN, y - 14, contentW, 14, MID);

      drawText(ev.time, colX[0], y - 11, 8, GRAY, fontMono);
      drawText(icon, colX[1], y - 11, 8, eventColor, fontBold);
      drawText(dirText, colX[2], y - 11, 8, dirColor);
      drawText(entryPrice ? '$' + entryPrice.toFixed(2) : '-', colX[3], y - 11, 8, WHITE);
      drawText(slPrice ? '$' + slPrice.toFixed(2) : '-', colX[4], y - 11, 8, WHITE);
      drawText(String(tpNum), colX[5], y - 11, 8, WHITE);
      drawText(tpPrice, colX[6], y - 11, 8, WHITE);
      drawText(price, colX[7], y - 11, 8, WHITE);
      drawText(cycle, colX[8], y - 11, 8, GRAY);
      
      y -= 16;
    }
    y -= 12;
  }

  // ── Active Trades ──
  if (activeTrades.length > 0) {
    ensureSpace(50 + activeTrades.length * 18);
    drawRect(MARGIN, y - 28, contentW, 28, MID, 6);
    drawText('ACTIVE TRADES', MARGIN + 12, y - 19, 14, GREEN, fontBold);
    y -= 36;

    const aColX = [MARGIN + 4, MARGIN + 55, MARGIN + 110, MARGIN + 180, MARGIN + 240, MARGIN + 290, MARGIN + 340, MARGIN + 400];
    const aHeaders = ['TF', 'Dir', 'Entry', 'SL', 'TPs Hit', 'Cycle', 'RSI', 'AI'];
    drawRect(MARGIN, y - 16, contentW, 16, DARK);
    for (let i = 0; i < aHeaders.length; i++) {
      drawText(aHeaders[i], aColX[i], y - 12, 8, GRAY, fontBold);
    }
    y -= 18;

    activeTrades.forEach((t, idx) => {
      ensureSpace(16);
      const dc = t.dir === 'long' ? GREEN : RED;
      if (idx % 2 === 0) drawRect(MARGIN, y - 14, contentW, 14, MID);
      drawText(t.tf, aColX[0], y - 11, 8, GOLD, fontBold);
      drawText(t.dir.toUpperCase(), aColX[1], y - 11, 8, dc);
      drawText('$' + t.entry.toFixed(2), aColX[2], y - 11, 8, WHITE);
      drawText('$' + t.sl.toFixed(2), aColX[3], y - 11, 8, WHITE);
      drawText(t.tpsHit + '/5', aColX[4], y - 11, 8, GREEN);
      drawText('#' + t.cycle, aColX[5], y - 11, 8, GRAY);
      drawText(t.rsi ? Number(t.rsi).toFixed(1) : '-', aColX[6], y - 11, 8, WHITE);
      drawText(t.aiRec || '-', aColX[7], y - 11, 8, WHITE);
      y -= 16;
    });
    y -= 12;
  }

  // Footer
  ensureSpace(30);
  drawRect(MARGIN, y - 20, contentW, 20, DARK, 4);
  drawText('Gold Sniper Trading System • EMA 9/21 • ' + TFS.join('/') + ' • Auto ' + mode + ' report', 
    MARGIN + 8, y - 14, 8, GRAY);

  // Save PDF
  const pdfBytes = await pdfDoc.save();

  // ════════════════════════════════════════
  // Send Email with PDF attachment via Resend
  // ════════════════════════════════════════
  const subject = mode === 'morning'
    ? `☀️ Gold Sniper Morning Report — ${today} | WR ${overallWR}%`
    : `🎯 Gold Sniper Daily Report — ${today} | ${totalTPs} TPs, ${totalSLs} SLs | WR ${overallWR}%`;

  // Build HTML body (brief summary, full details in PDF)
  let htmlBody = `<!DOCTYPE html><html><body style="font-family:Arial;background:#0a0a0f;color:#e0e0e0;padding:20px">
  <h2 style="color:#FFD700">Gold Sniper — ${title}</h2>
  <p style="color:#888">${now} (IST)</p>
  <table style="border-collapse:collapse;width:100%;max-width:500px">
  <tr><td style="background:#12121a;padding:10px;text-align:center"><b style="font-size:20px;color:#FFD700">${totalEntries}</b><br><small style="color:#888">ENTRIES</small></td>
  <td style="background:#12121a;padding:10px;text-align:center"><b style="font-size:20px;color:#00e676">${totalTPs}</b><br><small style="color:#888">TP HITS</small></td>
  <td style="background:#12121a;padding:10px;text-align:center"><b style="font-size:20px;color:#ff4444">${totalSLs}</b><br><small style="color:#888">SL HITS</small></td>
  <td style="background:#12121a;padding:10px;text-align:center"><b style="font-size:20px;color:${overallWR>=50?'#00e676':'#ff4444'}">${overallWR}%</b><br><small style="color:#888">WIN RATE</small></td>
  <td style="background:#12121a;padding:10px;text-align:center"><b style="font-size:20px;color:#00e676">${activeTrades.length}</b><br><small style="color:#888">ACTIVE</small></td></tr>
  </table>`;

  for (const tf of TFS) {
    const d = tfData[tf];
    if (d.entries.length === 0 && d.tps.length === 0 && d.sls.length === 0) continue;
    htmlBody += `<p><b style="color:#FFD700">${tf}</b> — WR ${d.winRate}% | ${d.wins}W ${d.losses}L | ${d.tps.length} TPs, ${d.sls.length} SLs</p>`;
  }
  htmlBody += `<p style="color:#888;margin-top:20px">📄 Full timeframe-wise report with entry prices, TP/SL times attached as PDF.</p>`;
  htmlBody += `</body></html>`;

  let emailResult = { success: false, error: 'No RESEND_API_KEY' };
  if (RESEND_KEY) {
    try {
      // Resend attachment format: base64 encoded
      const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));
      
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Gold Sniper <onboarding@resend.dev>',
          to: TO_EMAIL,
          subject,
          html: htmlBody,
          attachments: [{
            filename: `gold_sniper_report_${today}.pdf`,
            content: pdfBase64
          }]
        })
      });
      const data = await resp.json();
      emailResult = { success: resp.ok, id: data?.id || null, error: resp.ok ? null : data?.message };
    } catch (e) {
      emailResult = { success: false, error: String(e) };
    }
  }

  // ── WhatsApp summary ──
  let waMsg = `*GOLD SNIPER — ${mode === 'morning' ? 'MORNING' : 'DAILY'} REPORT*\n${now} (IST)\n\n`;
  waMsg += `📊 *${totalEntries} entries | ${totalTPs} TPs | ${totalSLs} SLs | WR ${overallWR}%*\n\n`;
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
      waMsg += `  ✅ ${t} TP${a.tp_num||'?'} $${Number(a.tp_price||0).toFixed(2)} (entry $${getEntry(tf,a)?.toFixed(2)||'?'}) #${a.cycle}\n`;
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
  waMsg += `\n📄 PDF report sent to email\n_Gold Sniper • EMA 9/21_`;

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
    overallWinRate: overallWR,
    pdfSize: pdfBytes.length,
    stats: { entries: totalEntries, tps: totalTPs, sls: totalSLs, fullCycles: totalDones, activeTrades: activeTrades.length }
  }), { headers: { 'Content-Type': 'application/json' } });
});
