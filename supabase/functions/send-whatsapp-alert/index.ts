// send-whatsapp-alert.ts
// Triggered by database webhook when new alert is inserted into alerts table
// Calls Base44 Agent API to send WhatsApp message to Shubham

const AGENT_ID = '6a59ebfbbec4437165873f86';
const AGENT_API_URL = `https://app.base44.com/api/agents/${AGENT_ID}`;
const AGENT_API_KEY = Deno.env.get('BASE44_AGENT_API_KEY') || '';

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

function formatWhatsAppMessage(alert: AlertData): string {
  const emoji: Record<string, string> = {
    entry: '🟢',
    tp: '✅',
    sl: '🛑',
    alldone: '🎉',
    test: '🧪',
  };
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

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  try {
    const body = await req.json();
    const record = body.record || body;
    
    // Don't send if already sent or if it's a test
    if (record.sent === true) {
      return new Response(JSON.stringify({ success: true, message: 'Already sent, skipping' }), { status: 200, headers });
    }

    const message = formatWhatsAppMessage(record);

    if (!AGENT_API_KEY) {
      console.error('BASE44_AGENT_API_KEY not set');
      return new Response(JSON.stringify({ error: 'API key not configured', message }), { status: 500, headers });
    }

    // Get or create default conversation
    const convRes = await fetch(`${AGENT_API_URL}/conversations`, {
      headers: { 'api_key': AGENT_API_KEY, 'Content-Type': 'application/json' },
    });
    
    if (!convRes.ok) {
      return new Response(JSON.stringify({ error: `Agent API auth failed: ${convRes.status}` }), { status: 500, headers });
    }
    
    const convs = await convRes.json();
    let conversationId: string;
    
    if (Array.isArray(convs) && convs.length > 0) {
      conversationId = convs[0].id;
    } else {
      // Create new conversation
      const newConvRes = await fetch(`${AGENT_API_URL}/conversations`, {
        method: 'POST',
        headers: { 'api_key': AGENT_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const newConv = await newConvRes.json();
      conversationId = newConv.id;
    }

    // Send message to agent (which will forward to WhatsApp)
    const msgRes = await fetch(`${AGENT_API_URL}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'api_key': AGENT_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `SYSTEM ALERT — Send this WhatsApp message to Shubham immediately:\n\n${message}`,
      }),
    });

    if (msgRes.ok) {
      // Mark alert as sent in Supabase
      const supaUrl = Deno.env.get('SUPABASE_URL')!;
      const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      await fetch(`${supaUrl}/rest/v1/alerts?id=eq.${record.id}`, {
        method: 'PATCH',
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sent: true }),
      });
      
      return new Response(JSON.stringify({ success: true, message: 'WhatsApp alert sent', conversationId }), { status: 200, headers });
    } else {
      const errText = await msgRes.text();
      return new Response(JSON.stringify({ error: `Failed to send: ${msgRes.status}`, details: errText }), { status: 500, headers });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers });
  }
});
