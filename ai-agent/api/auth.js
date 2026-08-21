// Gold Sniper — Lightweight auth check (no LLM call)
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN;
  const authHeader = req.headers['x-auth-token'] || req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!AUTH_TOKEN) {
    return res.status(200).json({ authenticated: true, message: 'No auth required' });
  }

  if (token === AUTH_TOKEN) {
    return res.status(200).json({ authenticated: true, message: 'Token valid' });
  }

  return res.status(401).json({ authenticated: false, error: 'Invalid token' });
}
