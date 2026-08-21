// Gold Sniper AI Agent — Vercel Serverless Function
// Auth + Groq LLM + Supabase memory & trading data

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://schegpkwfwkgfmmpnzic.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = `You are Lyra — Shubham's personal AI assistant. You have TWO modes:

## Mode 1: General Assistant (like ChatGPT)
Answer ANY question naturally — coding, math, science, writing, translation, explanations, brainstorming, recipes, trivia, advice, etc. Be helpful, concise, and conversational. Format responses with markdown when useful (tables, lists, code blocks, bold). When no trading intent is detected, respond as a general AI assistant.

## Mode 2: Gold Sniper Trading Assistant
When the user asks about gold prices, trades, alerts, patterns, or trading performance, activate your trading skills. Gold Sniper is an EMA 9/21 crossover gold (XAU/USD) trading system with ATR-based SL/TP levels across 6 timeframes (1M, 5M, 15M, 30M, 1H, 4H).

Gold Sniper is an EMA 9/21 crossover gold (XAU/USD) trading system with ATR-based SL/TP levels across 6 timeframes (1M, 5M, 15M, 30M, 1H, 4H).

Key facts:
- Stop-loss: 2x ATR
- TP levels: TP1=2xATR, TP2=4xATR, TP3=6xATR, TP4=10xATR, TP5=16xATR
- Backend: Supabase Edge Functions + pg_cron (runs every minute)
- Dashboard: GitHub Pages + Vercel
- WhatsApp alerts sent automatically on entry/TP/SL hits
- AI Candle Scanner runs every minute for pattern detection
- Daily reports sent at 09:00 IST and 23:00 IST
- Data sources: TwelveData, Alpha Vantage, livepriceofgold.com, GoldAPI (NO Yahoo Finance)
- TradingView scanner API for EMA/ATR/RSI indicators

You have these SKILLS:
1. LIVE_PRICE — fetch real-time gold spot price
2. ACTIVE_TRADES — show all open trades with entry/SL/TP/status
3. TRADE_HISTORY — query closed trades with PnL
4. ALERTS — pull recent alerts
5. AI_ANALYSIS — read AI candle patterns & momentum
6. ENGINE_STATUS — check engine logs for health
7. WHATSAPP_SEND — send a WhatsApp message via Supabase
8. MEMORY_STORE — save new facts to conversation_memories table
9. MARKET_ANALYSIS — comprehensive analysis combining all data
10. TRADE_PERFORMANCE — aggregate stats (win rate, avg PnL, etc.)
11. DATA_VISUALIZATION — view charts and stats (available at /Charts tab)
12. DATABASE_CRUD — insert, update, delete, query records in Supabase tables
13. HTML_CSS_EDITOR — read, edit, and push HTML/CSS/JS files to GitHub via natural language

For HTML_CSS_EDITOR:
- Available at /api/editor endpoint
- GET /api/editor?path=index.html — read a file from the GitHub repo
- GET /api/editor?list= — list files in a directory
- POST /api/editor with { path: "file.html", instruction: "make the background blue", preview: true } — preview an edit
- POST /api/editor with { path: "file.html", instruction: "make the background blue" } — apply and push to GitHub
- The LLM generates the edit based on natural language instruction
- Changes are committed to GitHub and auto-deploy via GitHub Pages
- ALWAYS show a preview first (preview: true) before applying changes

For DATABASE_CRUD:
- Allowed tables: trade_history, alerts, ai_candle_analysis, engine_logs, conversation_memories, active_trades
- When user asks to insert/update/delete, ALWAYS confirm the operation before executing
- Use the /api/database endpoint with X-Auth-Token header
- For reads: GET /api/database?table=X&select=field1,field2&limit=50&order=created_at.desc
- For inserts: POST /api/database with { table: "X", data: {...} }
- For updates: PATCH /api/database with { table: "X", filter: "id=eq.5", data: {...} }
- For deletes: DELETE /api/database?table=X&filter=id=eq.5
- Always show what will be changed before confirming

When the user asks you to:
- "Send WhatsApp" / "notify me" / "alert" -> use WHATSAPP_SEND skill
- "Remember this" / "save this" -> use MEMORY_STORE skill
- "Analyze" / "overview" / "how's the market" -> use MARKET_ANALYSIS skill
- "Performance" / "win rate" / "stats" -> use TRADE_PERFORMANCE skill

Be concise, friendly, and direct. Use IST timezone. Format prices with $.`;

// ── Auth check ──
const LIGHTWEIGHT_PROMPT = `You are Lyra — a helpful AI assistant (like ChatGPT). Answer any question naturally and concisely. Use markdown formatting when useful (tables, lists, code blocks, bold). Be friendly, direct, and helpful.`;

function checkAuth(req) {
  if (!AUTH_TOKEN) return true; // No token set = open access
  const authHeader = req.headers['x-auth-token'] || req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  return token === AUTH_TOKEN;
}

// ── Supabase helpers ──
async function supabaseFetch(table, params = '') {
  const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const res = await fetch(url, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status}`);
  return res.json();
}

async function supabaseInsert(table, data) {
  const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase insert ${table}: ${res.status}`);
  return res.json();
}

async function supabaseFunction(name, payload = {}) {
  const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Function ${name}: ${res.status}`);
  return res.json();
}

// ── Data fetchers ──
async function getMemories() {
  try { return await supabaseFetch('conversation_memories', '?select=category,kind,content&order=created_at.desc&limit=50'); }
  catch { return []; }
}
async function getTradingData() {
  try { return await supabaseFunction('get-live-price', {}); }
  catch { return null; }
}
async function getRecentAlerts(limit = 10) {
  try { return await supabaseFetch('alerts', `?select=*&order=created_at.desc&limit=${limit}`); }
  catch { return []; }
}
async function getTradeHistory(limit = 20) {
  try { return await supabaseFetch('trade_history', `?select=*&order=created_at.desc&limit=${limit}`); }
  catch { return []; }
}
async function getAIAnalysis(limit = 6) {
  try { return await supabaseFetch('ai_candle_analysis', `?select=*&order=created_at.desc&limit=${limit}`); }
  catch { return []; }
}
async function getEngineLogs(limit = 5) {
  try { return await supabaseFetch('engine_logs', `?select=*&order=created_at.desc&limit=${limit}`); }
  catch { return []; }
}

// ── Action skills ──
async function sendWhatsApp(message) {
  try {
    const result = await supabaseFunction('gold-sniper-engine', { action: 'send_whatsapp', message });
    return { success: true, result };
  } catch (e) { return { success: false, error: e.message }; }
}

async function storeMemory(category, kind, content) {
  try {
    const result = await supabaseInsert('conversation_memories', {
      category: category || 'General', kind: kind || 'fact',
      content, evidence_level: 'user_stated', source: 'vercel_agent',
    });
    return { success: true, stored: result };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getTradePerformance() {
  try {
    const history = await getTradeHistory(100);
    if (!history || history.length === 0) return { total: 0, message: 'No closed trades yet.' };
    const wins = history.filter(t => t.pnl && parseFloat(t.pnl) > 0);
    const losses = history.filter(t => t.pnl && parseFloat(t.pnl) < 0);
    const totalPnL = history.reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0);
    const winRate = history.length > 0 ? (wins.length / history.length * 100).toFixed(1) : '0';
    const avgWin = wins.length > 0 ? (wins.reduce((s, t) => s + parseFloat(t.pnl), 0) / wins.length).toFixed(2) : '0';
    const avgLoss = losses.length > 0 ? (losses.reduce((s, t) => s + parseFloat(t.pnl), 0) / losses.length).toFixed(2) : '0';
    const byTF = {};
    history.forEach(t => {
      const tf = t.timeframe || 'unknown';
      if (!byTF[tf]) byTF[tf] = { trades: 0, wins: 0, pnl: 0 };
      byTF[tf].trades++;
      if (parseFloat(t.pnl) > 0) byTF[tf].wins++;
      byTF[tf].pnl += parseFloat(t.pnl) || 0;
    });
    return { total: history.length, wins: wins.length, losses: losses.length,
      winRate: `${winRate}%`, totalPnL: totalPnL.toFixed(2), avgWin, avgLoss, byTimeframe: byTF };
  } catch (e) { return { error: e.message }; }
}

async function getMarketAnalysis() {
  const [trading, analysis, alerts] = await Promise.all([getTradingData(), getAIAnalysis(6), getRecentAlerts(5)]);
  let summary = [];
  if (trading) {
    const price = trading.spotPrice || trading.price || 'N/A';
    const change = trading.change || 0;
    const direction = parseFloat(change) >= 0 ? 'bullish' : 'bearish';
    summary.push(`PRICE: $${price} (${direction}, ${trading.changePct || 0}% today)`);
    if (trading.activeTrades && trading.activeTrades.length > 0) {
      const longs = trading.activeTrades.filter(t => t.direction === 'long').length;
      const shorts = trading.activeTrades.filter(t => t.direction === 'short').length;
      summary.push(`TRADES: ${trading.activeTrades.length} active (${longs} long, ${shorts} short)`);
    } else { summary.push('TRADES: No active trades'); }
  }
  if (analysis && analysis.length > 0) {
    const buySignals = analysis.filter(a => a.recommendation && a.recommendation.toLowerCase().includes('buy')).length;
    const sellSignals = analysis.filter(a => a.recommendation && a.recommendation.toLowerCase().includes('sell')).length;
    const avgConf = analysis.reduce((s, a) => s + (a.confidence || 0), 0) / analysis.length;
    summary.push(`AI: ${buySignals} buy, ${sellSignals} sell (avg ${avgConf.toFixed(0)}% conf)`);
  }
  if (alerts && alerts.length > 0) {
    summary.push(`LAST ALERT: ${alerts[0].timeframe} ${alerts[0].type} ${alerts[0].direction || ''}`);
  }
  return summary.join('\n');
}

// ── Intent detection ──
function detectIntent(message) {
  const msg = message.toLowerCase();
  const intents = [];
  if (msg.match(/live|price|current|spot|now|gold price/)) intents.push('live_price');
  if (msg.match(/trade|position|entry|active|open/) && !msg.match(/history|past|closed/)) intents.push('active_trades');
  if (msg.match(/history|past|previous|closed|record/)) intents.push('trade_history');
  if (msg.match(/alert|notification|signal/)) intents.push('alerts');
  if (msg.match(/pattern|ai|candle|scanner|analysis/)) intents.push('ai_analysis');
  if (msg.match(/status|health|engine|running|working|log/)) intents.push('engine_status');
  if (msg.match(/memory|remember|save|note|store/)) intents.push('memory');
  if (msg.match(/whatsapp|send.*message|notify|broadcast/)) intents.push('whatsapp_send');
  if (msg.match(/performance|win rate|stats|p&l|pnl|profit/)) intents.push('trade_performance');
  if (msg.match(/analyz|overview|summary|how.*market|market.*summary/)) intents.push('market_analysis');
  if (msg.match(/tp.*hit|take profit/) || msg.match(/sl.*hit|stop loss/)) intents.push('active_trades');
  if (msg.match(/insert|add.*record|create.*record|update.*record|delete.*record|query.*table|database|db /)) intents.push('database');
  if (msg.match(/edit.*html|edit.*css|change.*color|change.*layout|update.*dashboard|modify.*page|edit.*file|fix.*css|style/)) intents.push('editor');
  // If no specific intent detected, it's a general question (ChatGPT mode)
  if (intents.length === 0) intents.push('general');
  return intents;
}

// ── Build context ──
async function buildContext(userMessage) {
  const intents = detectIntent(userMessage);
  let parts = [];
  let actions = [];
  const memories = await getMemories();
  if (memories && memories.length > 0) {
    parts.push(`=== AGENT MEMORY (${memories.length} entries) ===\n${memories.map(m => `[${m.category}/${m.kind}] ${m.content}`).join('\n')}`);
  }
  if (intents.includes('live_price') || intents.includes('active_trades')) {
    const trading = await getTradingData();
    if (trading) {
      parts.push(`=== LIVE DATA ===\nGold Spot: $${trading.spotPrice || trading.price || 'N/A'}\nChange: ${trading.change || 'N/A'} (${trading.changePct || 'N/A'}%)`);
      if (trading.activeTrades && trading.activeTrades.length > 0) {
        parts.push(`=== ACTIVE TRADES (${trading.activeTrades.length}) ===\n${trading.activeTrades.map(t => `${t.timeframe} ${t.direction?.toUpperCase()} | Entry: $${t.entry} | SL: $${t.sl} | TPs: ${t.tp1Hit?'Y':'N'}/${t.tp2Hit?'Y':'N'}/${t.tp3Hit?'Y':'N'}/${t.tp4Hit?'Y':'N'}/${t.tp5Hit?'Y':'N'} | Cycle: ${t.cycle}`).join('\n')}`);
      } else { parts.push('=== ACTIVE TRADES ===\nNo active trades'); }
    }
  }
  if (intents.includes('trade_history')) {
    const history = await getTradeHistory(15);
    if (history && history.length > 0) {
      parts.push(`=== TRADE HISTORY (last 15) ===\n${history.map(h => `${h.timeframe} ${h.direction?.toUpperCase()} | Entry: $${h.entry_price} Exit: $${h.exit_price} | ${h.exit_reason} | PnL: ${h.pnl || 'N/A'}`).join('\n')}`);
    }
  }
  if (intents.includes('trade_performance')) {
    const perf = await getTradePerformance();
    if (perf.total) {
      let perfText = `Total: ${perf.total} | Wins: ${perf.wins} | Losses: ${perf.losses}\nWin Rate: ${perf.winRate} | Total PnL: $${perf.totalPnL}\nAvg Win: $${perf.avgWin} | Avg Loss: $${perf.avgLoss}`;
      if (perf.byTimeframe) {
        perfText += `\nBy TF:\n${Object.entries(perf.byTimeframe).map(([tf, d]) => `${tf}: ${d.trades} trades, ${d.wins}W (${(d.wins/d.trades*100).toFixed(0)}%), PnL: $${d.pnl.toFixed(2)}`).join('\n')}`;
      }
      parts.push(`=== PERFORMANCE ===\n${perfText}`);
    }
  }
  if (intents.includes('alerts')) {
    const alerts = await getRecentAlerts(10);
    if (alerts && alerts.length > 0) {
      parts.push(`=== RECENT ALERTS ===\n${alerts.map(a => `${a.created_at} | ${a.timeframe} ${a.type?.toUpperCase()} | ${a.direction || ''} | Entry: $${a.entry || 'N/A'} | TP${a.tpNum || ''}: $${a.tpPrice || 'N/A'}`).join('\n')}`);
    }
  }
  if (intents.includes('ai_analysis')) {
    const analysis = await getAIAnalysis(6);
    if (analysis && analysis.length > 0) {
      parts.push(`=== AI CANDLE ANALYSIS ===\n${analysis.map(a => `${a.timeframe} | ${a.recommendation || 'N/A'} (${a.confidence || 0}%) | Pattern: ${a.pattern || 'none'} | RSI: ${a.rsi || 'N/A'} ${a.rsi_signal || ''} | Trend: ${a.trend_direction || ''}`).join('\n')}`);
    }
  }
  if (intents.includes('market_analysis')) {
    const analysis = await getMarketAnalysis();
    parts.push(`=== MARKET ANALYSIS ===\n${analysis}`);
  }
  if (intents.includes('engine_status')) {
    const logs = await getEngineLogs(5);
    if (logs && logs.length > 0) {
      parts.push(`=== ENGINE LOGS ===\n${logs.map(l => `${l.created_at} | ${l.event || l.action || 'tick'} | ${l.message || l.details || ''}`).join('\n')}`);
    }
  }
  if (intents.includes('whatsapp_send')) { actions.push('whatsapp_send'); }
  if (intents.includes('memory')) { actions.push('memory_store'); }
  if (intents.includes('database')) {
    const dbCmd = parseDBCommand(message);
    if (dbCmd) {
      actions.push('database');
      parts.push(`=== DATABASE COMMAND DETECTED ===\nAction: ${dbCmd.action}\nTable: ${dbCmd.table || 'unknown'}\nAvailable tables: trade_history, alerts, ai_candle_analysis, engine_logs, conversation_memories, active_trades\nTell the user what you detected and ask for confirmation before executing writes/deletes.`);
    }
  }
  if (intents.includes('editor')) {
    actions.push('editor');
    parts.push('=== HTML/CSS EDITOR READY ===\nUser wants to edit HTML/CSS. Ask which file to edit if not specified. Available files: index.html (dashboard), ai-agent/index.html (AI agent UI), styles.css, etc. Use /api/editor to read and modify files. ALWAYS preview before applying.');
  }
  if (intents.includes('general')) {
    // General ChatGPT mode — no Supabase data needed, just use LLM knowledge
    parts.push('=== GENERAL MODE ===\nNo trading intent detected. Respond as a general AI assistant (like ChatGPT). Answer the question directly using your knowledge. Be helpful, concise, and natural. Use markdown formatting when useful.');
  }
  return { context: parts.join('\n\n'), actions, intents };
}


// ── Database CRUD skill ──
async function dbListTables() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY}` },
    });
    return ['trade_history', 'alerts', 'ai_candle_analysis', 'engine_logs', 'conversation_memories', 'active_trades'];
  } catch { return []; }
}

async function dbInsert(table, records) {
  try {
    const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(records),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return { success: true, data: await res.json() };
  } catch (e) { return { success: false, error: e.message }; }
}

async function dbUpdate(table, filter, updates) {
  try {
    const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return { success: true, data: await res.json() };
  } catch (e) { return { success: false, error: e.message }; }
}

async function dbDelete(table, filter) {
  try {
    const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return { success: true, data: await res.json() };
  } catch (e) { return { success: false, error: e.message }; }
}

async function dbRead(table, params = '') {
  try {
    const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return { success: true, data: await res.json() };
  } catch (e) { return { success: false, error: e.message }; }
}

// ── Parse natural language database command ──
function parseDBCommand(message) {
  const msg = message.toLowerCase();
  const ALLOWED = ['trade_history', 'alerts', 'ai_candle_analysis', 'engine_logs', 'conversation_memories', 'active_trades'];
  
  // Detect CRUD intent
  let action = null;
  if (msg.match(/insert|add|create|new/) && msg.match(/record|entry|row|trade|alert/)) action = 'insert';
  else if (msg.match(/update|modify|change|edit|set/)) action = 'update';
  else if (msg.match(/delete|remove|drop|clear/)) action = 'delete';
  else if (msg.match(/query|select|fetch|get.*from|show.*table|list.*table/)) action = 'read';
  
  if (!action) return null;
  
  // Detect table
  let table = null;
  for (const t of ALLOWED) {
    if (msg.includes(t.replace(/_/g, ' ')) || msg.includes(t)) { table = t; break; }
  }
  if (msg.includes('trade history') || msg.includes('trade_history')) table = 'trade_history';
  if (msg.includes('alert')) table = 'alerts';
  if (msg.includes('ai') && msg.includes('analysis')) table = 'ai_candle_analysis';
  if (msg.includes('engine') && msg.includes('log')) table = 'engine_logs';
  if (msg.includes('memory') || msg.includes('memories')) table = 'conversation_memories';
  if (msg.includes('active') && msg.includes('trade')) table = 'active_trades';
  
  return { action, table };
}

function extractWhatsAppMessage(message) {
  return message.replace(/send (a )?whatsapp (message|alert|notification)?/gi, '').replace(/whatsapp (me|send|alert|notify)/gi, '').replace(/notify me (about|that|if)?/gi, '').replace(/broadcast/gi, '').replace(/^["']|["']$/g, '').trim();
}
function extractMemoryContent(message) {
  return message.replace(/remember (this|that|the following)?/gi, '').replace(/save (this|that|the following)?/gi, '').replace(/note (this|that)?/gi, '').replace(/to memory/gi, '').replace(/^["']|["']$/g, '').trim();
}

// ── Main handler ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth check
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing auth token' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, history = [], stream = false } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const { context, actions, intents } = await buildContext(message);

    let skillResults = {};
    if (actions.includes('whatsapp_send')) {
      const waMsg = extractWhatsAppMessage(message);
      if (waMsg.length > 5) skillResults.whatsapp = await sendWhatsApp(waMsg);
    }
    if (actions.includes('memory_store')) {
      const memContent = extractMemoryContent(message);
      if (memContent.length > 3) skillResults.memory = await storeMemory('General', 'fact', memContent);
    }

    let skillContext = context;
    if (skillResults.whatsapp) skillContext += `\n\n=== WHATSAPP RESULT ===\n${skillResults.whatsapp.success ? 'Sent successfully' : 'Failed: ' + skillResults.whatsapp.error}`;
    if (skillResults.memory) skillContext += `\n\n=== MEMORY STORED ===\n${skillResults.memory.success ? 'Saved' : 'Failed: ' + skillResults.memory.error}`;

    const isGeneral = intents.includes('general') && !intents.includes('live_price') && !intents.includes('active_trades') && !intents.includes('trade_history') && !intents.includes('alerts') && !intents.includes('ai_analysis') && !intents.includes('market_analysis') && !intents.includes('trade_performance');
    
    const systemContent = isGeneral 
      ? `${LIGHTWEIGHT_PROMPT}\n\n${skillContext ? '=== RELEVANT CONTEXT ===\n' + skillContext : ''}`
      : `${SYSTEM_PROMPT}\n\n=== REAL-TIME CONTEXT FROM SUPABASE ===\n${skillContext}`;
    
    const messages = [
      { role: 'system', content: systemContent },
      ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const groqRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 2048, stream: true }),
      });
      if (!groqRes.ok) { const err = await groqRes.text(); res.write(`data: ${JSON.stringify({ error: err })}\n\n`); return res.end(); }
      const reader = groqRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') { res.write('data: [DONE]\n\n'); return res.end(); }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
            } catch {}
          }
        }
      }
      return res.end();
    }

    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 2048, stream: false }),
    });
    if (!groqRes.ok) { const err = await groqRes.text(); return res.status(500).json({ error: 'LLM error', details: err }); }
    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content || 'No response';
    return res.status(200).json({ reply, model: MODEL, intents, skills: { whatsapp: skillResults.whatsapp || null, memory: skillResults.memory || null }, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Agent error:', error);
    return res.status(500).json({ error: 'Agent error', details: error.message });
  }
}
