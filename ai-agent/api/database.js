// Gold Sniper — Database CRUD API
// Full read/write/delete access to Supabase tables (auth-protected)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://schegpkwfwkgfmmpnzic.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN;

function checkAuth(req) {
  if (!AUTH_TOKEN) return true;
  const authHeader = req.headers['x-auth-token'] || req.headers['authorization'] || '';
  return authHeader.replace('Bearer ', '').trim() === AUTH_TOKEN;
}

// ── Allowed tables (whitelist for safety) ──
const ALLOWED_TABLES = [
  'trade_history', 'alerts', 'ai_candle_analysis', 'engine_logs',
  'conversation_memories', 'active_trades', 'backup_log',
];

async function supabaseRequest(method, table, params = '', body = null) {
  const key = SUPABASE_SERVICE_KEY;
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (method === 'POST') headers['Prefer'] = 'return=representation';
  if (method === 'PATCH' || method === 'DELETE') headers['Prefer'] = 'return=representation';

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${table}: ${res.status} ${text}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { action, table, query, data, limit, offset, select, order } = req.query.method ? req.query : (req.body || {});

    // GET: List tables / Read records
    if (req.method === 'GET') {
      const tbl = req.query.table;
      if (!tbl) {
        // List allowed tables
        return res.status(200).json({ tables: ALLOWED_TABLES });
      }
      if (!ALLOWED_TABLES.includes(tbl)) {
        return res.status(403).json({ error: `Table '${tbl}' not allowed. Available: ${ALLOWED_TABLES.join(', ')}` });
      }

      let params = '?';
      if (req.query.select) params += `select=${req.query.select}&`;
      if (req.query.filter) {
        // Format: field=eq.value or field=gt.value etc
        const filters = req.query.filter.split(',');
        filters.forEach(f => { params += f + '&'; });
      }
      params += `limit=${req.query.limit || 50}&`;
      params += `offset=${req.query.offset || 0}&`;
      if (req.query.order) params += `order=${req.query.order}&`;

      const result = await supabaseRequest('GET', tbl, params);
      return res.status(200).json({ table: tbl, count: result.length, data: result });
    }

    // POST: Insert new record(s)
    if (req.method === 'POST') {
      const { table: tbl, data: records } = req.body;
      if (!tbl || !ALLOWED_TABLES.includes(tbl)) {
        return res.status(403).json({ error: `Table '${tbl}' not allowed. Available: ${ALLOWED_TABLES.join(', ')}` });
      }
      if (!records) return res.status(400).json({ error: 'Data required' });

      const result = await supabaseRequest('POST', tbl, '', records);
      return res.status(200).json({ table: tbl, action: 'insert', success: true, data: result });
    }

    // PATCH: Update records (requires filter)
    if (req.method === 'PATCH') {
      const { table: tbl, filter, data: updates } = req.body;
      if (!tbl || !ALLOWED_TABLES.includes(tbl)) {
        return res.status(403).json({ error: `Table '${tbl}' not allowed. Available: ${ALLOWED_TABLES.join(', ')}` });
      }
      if (!filter) return res.status(400).json({ error: 'Filter required for updates. Example: { "filter": "id=eq.5" }' });
      if (!updates) return res.status(400).json({ error: 'Data required' });

      let params = `?${filter}`;
      const result = await supabaseRequest('PATCH', tbl, params, updates);
      return res.status(200).json({ table: tbl, action: 'update', filter, success: true, count: result.length, data: result });
    }

    // DELETE: Delete records (requires filter)
    if (req.method === 'DELETE') {
      const tbl = req.query.table;
      const filter = req.query.filter;
      if (!tbl || !ALLOWED_TABLES.includes(tbl)) {
        return res.status(403).json({ error: `Table '${tbl}' not allowed. Available: ${ALLOWED_TABLES.join(', ')}` });
      }
      if (!filter) return res.status(400).json({ error: 'Filter required for deletes. Example: ?table=alerts&filter=id=eq.5' });

      const params = `?${filter}`;
      const result = await supabaseRequest('DELETE', tbl, params);
      return res.status(200).json({ table: tbl, action: 'delete', filter, success: true, count: result.length, data: result });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
