// Gold Sniper — SQL Query Skill
// Execute SQL queries against Supabase via PostgREST + AI-assisted query generation

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://schegpkwfwkgfmmpnzic.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

// Table schema reference for AI query generation
const SCHEMAS = {
  trade_history: ['id', 'created_at', 'timeframe', 'direction', 'entry_price', 'exit_price', 'exit_reason', 'pnl', 'cycle', 'symbol'],
  alerts: ['id', 'created_at', 'timeframe', 'type', 'direction', 'entry', 'sl', 'tp', 'tp_num', 'tp_price', 'price', 'cycle', 'progress', 'sent'],
  active_trades: ['id', 'created_at', 'timeframe', 'direction', 'entry', 'sl', 'tp1', 'tp2', 'tp3', 'cycle', 'tp1_hit', 'tp2_hit', 'tp3_hit'],
  ai_candle_analysis: ['id', 'created_at', 'timeframe', 'pattern', 'recommendation', 'confidence', 'rsi', 'rsi_signal', 'trend_direction', 'ema9', 'ema21', 'atr'],
  engine_logs: ['id', 'created_at', 'event', 'action', 'message', 'details'],
  conversation_memories: ['id', 'created_at', 'category', 'kind', 'content', 'evidence_level', 'source'],
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || 'query';

    // ── GET: List available tables and schemas ──
    if (req.method === 'GET') {
      if (action === 'schemas') {
        return res.status(200).json({ schemas: SCHEMAS, tables: Object.keys(SCHEMAS) });
      }
      if (action === 'tables') {
        return res.status(200).json({ tables: Object.keys(SCHEMAS) });
      }
      return res.status(400).json({ error: 'Use ?action=schemas or ?action=tables' });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'POST or GET' });

    const { mode = 'query', natural, sql, table, limit = 100 } = req.body || {};

    // ── Mode: Generate SQL from natural language ──
    if (mode === 'generate') {
      if (!natural) return res.status(400).json({ error: 'natural (language description) required' });
      
      const schemaText = Object.entries(SCHEMAS).map(([t, cols]) => `${t}(${cols.join(', ')})`).join('\n');
      const messages = [
        { role: 'system', content: `You are a SQL expert. Given a natural language request, generate a Supabase PostgREST API query. 

Available tables and columns:
${schemaText}

PostgREST rules:
- Use REST API params, not raw SQL: ?select=col1,col2&field=eq.value&order=col.desc&limit=N
- Filters: eq, neq, gt, gte, lt, lte, like, ilike, in, not.in
- Logical: &and=(filter1,filter2) or &or=(filter1,filter2)
- Ordering: order=column.desc or order=column.asc
- Limits: limit=N
- Select specific columns: select=col1,col2
- Count: headers=Prefer,count=exact

Output ONLY the query string (the part after ?), no explanations, no markdown.` },
        { role: 'user', content: natural },
      ];
      
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: 512 }),
      });
      if (!aiRes.ok) throw new Error('AI generation failed');
      const aiData = await aiRes.json();
      let query = aiData.choices?.[0]?.message?.content?.trim() || '';
      query = query.replace(/^```.*\n?/m, '').replace(/\n?```$/m, '').replace(/^\?/, '').trim();
      return res.status(200).json({ query, mode: 'generate' });
    }

    // ── Mode: Execute query ──
    if (mode === 'query') {
      const targetTable = table || (natural ? Object.keys(SCHEMAS).find(t => natural.toLowerCase().includes(t.replace(/_/g, ' ')) || natural.toLowerCase().includes(t)) : null);
      if (!targetTable) return res.status(400).json({ error: 'table required or provide natural language query' });
      
      let queryString = sql || '';
      
      // If no SQL provided but natural language is, generate it
      if (!queryString && natural) {
        const genRes = await fetch('https://gold-sniper-agent.vercel.app/api/sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'generate', natural }),
        });
        if (genRes.ok) {
          const genData = await genRes.json();
          queryString = genData.query;
        }
      }
      
      if (!queryString) queryString = `select=*&order=created_at.desc&limit=${limit}`;
      
      const fetchUrl = `${SUPABASE_URL}/rest/v1/${targetTable}?${queryString}`;
      const fetchRes = await fetch(fetchUrl, {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      
      const data = await fetchRes.json();
      return res.status(200).json({
        table: targetTable,
        query: queryString,
        count: Array.isArray(data) ? data.length : 0,
        data,
        mode: 'query',
      });
    }

    // ── Mode: AI Analyze results ──
    if (mode === 'analyze') {
      const { data, question } = req.body;
      if (!data) return res.status(400).json({ error: 'data required' });
      
      const messages = [
        { role: 'system', content: 'You are a data analyst. Analyze the provided SQL query results and answer the user question. Use markdown formatting.' },
        { role: 'user', content: `Question: ${question || 'Analyze this data'}\n\nData (JSON):\n${JSON.stringify(data).slice(0, 8000)}` },
      ];
      
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, max_tokens: 1024 }),
      });
      if (!aiRes.ok) throw new Error('AI analysis failed');
      const aiData = await aiRes.json();
      return res.status(200).json({ analysis: aiData.choices?.[0]?.message?.content, mode: 'analyze' });
    }

    // ── Mode: Aggregate/Stats ──
    if (mode === 'aggregate') {
      const { table: aggTable, operation, column, groupBy } = req.body;
      if (!aggTable || !operation) return res.status(400).json({ error: 'table and operation required' });
      
      // Build PostgREST query for aggregation
      let aggQuery = '';
      const ops = {
        count: 'count',
        sum: `sum(${column})`,
        avg: `avg(${column})`,
        min: `min(${column})`,
        max: `max(${column})`,
      };
      
      const selectExpr = groupBy ? `${groupBy},${ops[operation] || operation}` : ops[operation] || operation;
      aggQuery = `select=${selectExpr}&order=${groupBy || 'created_at'}.desc&limit=${limit}`;
      
      const aggRes = await fetch(`${SUPABASE_URL}/rest/v1/${aggTable}?${aggQuery}`, {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'count=exact',
        },
      });
      const aggData = await aggRes.json();
      return res.status(200).json({ table: aggTable, operation, column, groupBy, data: aggData, mode: 'aggregate' });
    }

    return res.status(400).json({ error: 'Unknown mode. Use: query, generate, analyze, aggregate' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
