// Gold Sniper — Python Code Execution Skill
// Runs Python code server-side using Python via child process

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { code, mode = 'execute' } = req.body || {};
    if (!code) return res.status(400).json({ error: 'code required' });

    if (mode === 'generate') {
      // AI generates Python code from natural language
      const messages = [
        { role: 'system', content: 'You are a Python code generator. Output ONLY Python code, no explanations, no markdown. The code should be self-contained and runnable.' },
        { role: 'user', content: code },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 2048 }),
      });
      if (!aiRes.ok) throw new Error('AI generation failed');
      const aiData = await aiRes.json();
      let pyCode = aiData.choices?.[0]?.message?.content || '';
      pyCode = pyCode.replace(/^```python\n?/m, '').replace(/\n?```$/m, '');
      return res.status(200).json({ generated: pyCode, mode: 'generate' });
    }

    if (mode === 'preview') {
      // AI explains what the code does without running
      const messages = [
        { role: 'system', content: 'You are a Python code analyzer. Explain concisely what the code does, any issues, and expected output. Use markdown.' },
        { role: 'user', content: `Analyze this Python code:\n\n${code}` },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 1024 }),
      });
      if (!aiRes.ok) throw new Error('AI analysis failed');
      const aiData = await aiRes.json();
      return res.status(200).json({ analysis: aiData.choices?.[0]?.message?.content, mode: 'preview' });
    }

    return res.status(400).json({ error: 'Unknown mode. Use: execute, generate, or preview' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
