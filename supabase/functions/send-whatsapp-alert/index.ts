// send-whatsapp-alert.ts — Meta WhatsApp Business Cloud API
// Triggered by database webhook when new alert is inserted into alerts table
// Sends formatted WhatsApp message to all active recipients

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Meta WhatsApp Cloud API credentials
const META_ACCESS_TOKEN = Deno.env.get('META_WHATSAPP_TOKEN') || '';
const META_PHONE_NUMBER_ID = Deno.env.get('META_WHATSAPP_PHONE_ID') || '';
const META_API_VERSION = Deno.env.get('META_WHATSAPP_API_VERSION') || 'v18.0';

// Fallback: comma-separated recipient numbers in env (format: 91XXXXXXXXXX,91YYYYYYYYYY)
const FALLBACK_RECIPIENTS = Deno.env.get('WHATSAPP_RECIPIENTS') || '';

// Blueticks — free WhatsApp REST API for numbers not in Meta test list
const BLUETICKS_API_KEY = Deno.env.get('BLUETICKS_API_KEY') || '';
const BLUETICKS_PHONES = (Deno.env.get('BLUETICKS_PHONES') || '').split(',').map(s => s.trim()).filter(Boolean);

async function sendViaBlueticks(phoneNumber: string, message: string) {
  if (!BLUETICKS_API_KEY) throw new Error('Blueticks: no API key configured');
  const chatId = `${phoneNumber}@c.us`;
  const res = await fetch(`https://api.blueticks.co/v1/messages/${chatId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BLUETICKS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'text', text: message }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Blueticks ${res.status}: ${err.substring(0, 200)}`);
  }
  return { ok: true, phone: phoneNumber };
}

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

interface AlertData {
  id: number;
  type: string;
  timeframe: string;
  direction: string | null;
  entry: number | null;
  sl: number | null;
  tp: any;
  cycle: number | null;
  price: number | null;
  tp_num: number | null;
  tp_price: number | null;
  progress: number | null;
  sent: boolean;
  created_at: string;
}

function formatMessage(alert: AlertData): string {
  const emoji: Record<string, string> = { entry: '🟢', tp: '✅', sl: '🛑', alldone: '🎉', test: '🧪' };
  const icon = emoji[alert.type] || '🔔';
  const tf = alert.timeframe || '?';

  if (alert.type === 'entry') {
    const dir = alert.direction === 'buy' || alert.direction === 'long' ? 'LONG 📈' : 'SHORT 📉';
    const tp = alert.tp || {};
    return `${icon} *GOLD SNIPER — NEW ${tf} SIGNAL*

*Direction:* ${dir}
*Entry:* $${alert.entry?.toFixed(2)}
*SL:* $${alert.sl?.toFixed(2)}
*ATR Cycle:* ${alert.cycle}

*Take Profit Levels:*
TP1: $${tp.tp1?.toFixed(2) || '?'} (1R)
TP2: $${tp.tp2?.toFixed(2) || '?'} (2R)
TP3: $${tp.tp3?.toFixed(2) || '?'} (3R)
TP4: $${tp.tp4?.toFixed(2) || '?'} (5R)
TP5: $${tp.tp5?.toFixed(2) || '?'} (8R)

*Live Price:* $${alert.price?.toFixed(2) || '?'}
_EMA 9/21 crossover detected_`;
  }

  if (alert.type === 'tp') {
    return `${icon} *GOLD SNIPER — TP${alert.tp_num} HIT (${tf})*

*Take Profit ${alert.tp_num}* target reached!
*TP Price:* $${alert.tp_price?.toFixed(2)}
*Live Price:* $${alert.price?.toFixed(2)}

_Cycle ${alert.cycle} — ${alert.progress}/5 TPs hit_`;
  }

  if (alert.type === 'sl') {
    return `${icon} *GOLD SNIPER — STOP LOSS HIT (${tf})*

*SL triggered* at $${alert.sl?.toFixed(2)}
*Entry was:* $${alert.entry?.toFixed(2)}
*Live Price:* $${alert.price?.toFixed(2)}

_Waiting for next EMA 9/21 crossover signal_`;
  }

  if (alert.type === 'alldone') {
    return `${icon} *GOLD SNIPER — ALL TPs HIT! (${tf})*

*Maximum profit achieved!* 🏆
*Entry:* $${alert.entry?.toFixed(2)}
*All 5 take profits hit*

_Cycle ${alert.cycle} complete — awaiting next signal_`;
  }

  return `${icon} *GOLD SNIPER — ${alert.type.toUpperCase()} (${tf})*\n\nPrice: $${alert.price?.toFixed(2) || '?'}`;
}

async function getRecipients(): Promise<string[]> {
  // Try database table first
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/whatsapp_recipients?select=phone_number&active=eq.true`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) {
      return rows.map((r: any) => r.phone_number);
    }
  } catch (e) { console.error('Failed to fetch recipients:', (e as Error).message); }

  // Fallback to env var
  if (FALLBACK_RECIPIENTS) {
    return FALLBACK_RECIPIENTS.split(',').map(s => s.trim()).filter(Boolean);
  }

  return [];
}

async function sendViaMeta(phoneNumber: string, message: string) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phoneNumber,
      type: 'text',
      text: { body: message },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meta API ${res.status}: ${err.substring(0, 200)}`);
  }

  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // GET — list recipients and config status
  if (req.method === 'GET') {
    const recipients = await getRecipients();
    return new Response(JSON.stringify({
      ok: true,
      meta_configured: !!META_ACCESS_TOKEN && !!META_PHONE_NUMBER_ID,
      recipients_count: recipients.length,
      recipients: recipients,
    }), { status: 200, headers: CORS });
  }

  try {
    const body = await req.json();
    const record: AlertData = body.record || body;

    if (record.sent === true) {
      return new Response(JSON.stringify({ success: true, message: 'Already sent' }), { status: 200, headers: CORS });
    }

    if (!META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) {
      return new Response(JSON.stringify({
        error: 'META_WHATSAPP_TOKEN or META_WHATSAPP_PHONE_ID not configured',
        hint: 'Set these as Supabase edge function secrets',
      }), { status: 500, headers: CORS });
    }

    const message = formatMessage(record);
    const recipients = await getRecipients();

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ error: 'No recipients configured', hint: 'Add numbers to whatsapp_recipients table or WHATSAPP_RECIPIENTS env var' }), { status: 400, headers: CORS });
    }

    const results: any[] = [];
    let allOk = true;

    for (const phone of recipients) {
      // Use CallMeBot for numbers in the CallMeBot list, Meta for the rest
      const useBlueticks = BLUETICKS_PHONES.includes(phone);
      try {
        if (useBlueticks) {
          const result = await sendViaBlueticks(phone, message);
          results.push({ phone, ok: true, via: 'blueticks' });
        } else {
          const result = await sendViaMeta(phone, message);
          results.push({ phone, ok: true, message_id: result?.messages?.[0]?.id, via: 'meta' });
        }
      } catch (e) {
        // If Meta fails, try CallMeBot as fallback
        if (!useBlueticks && BLUETICKS_API_KEY) {
          try {
            await sendViaBlueticks(phone, message);
            results.push({ phone, ok: true, via: 'blueticks-fallback' });
            continue;
          } catch (e2) {
            results.push({ phone, ok: false, error: `Meta: ${(e as Error).message} | CallMeBot: ${(e2 as Error).message}` });
          }
        } else {
          results.push({ phone, ok: false, error: (e as Error).message });
        }
        allOk = false;
      }
    }

    // Mark alert as sent in Supabase if at least one succeeded
    if (allOk || results.some(r => r.ok)) {
      try {
        await fetch(`${SUPA_URL}/rest/v1/alerts?id=eq.${record.id}`, {
          method: 'PATCH',
          headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sent: true }),
        });
      } catch {}
    }

    return new Response(JSON.stringify({
      success: allOk,
      sent_to: results.filter(r => r.ok).map(r => r.phone),
      failed: results.filter(r => !r.ok),
      total: recipients.length,
      message_preview: message.substring(0, 100),
    }), { status: 200, headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: CORS });
  }
});
