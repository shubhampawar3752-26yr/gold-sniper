// Gold Sniper — Universal Code Skill (All Programming Languages)
// AI-powered code generation, editing, debugging, and explanation for any language

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

const LANGUAGES = {
  python: { ext: 'py', runner: 'python3', comment: '#' },
  javascript: { ext: 'js', runner: 'node', comment: '//' },
  typescript: { ext: 'ts', runner: 'npx tsx', comment: '//' },
  sql: { ext: 'sql', runner: null, comment: '--' },
  html: { ext: 'html', runner: null, comment: '<!--' },
  css: { ext: 'css', runner: null, comment: '/*' },
  json: { ext: 'json', runner: null, comment: '//' },
  bash: { ext: 'sh', runner: 'bash', comment: '#' },
  shell: { ext: 'sh', runner: 'bash', comment: '#' },
  php: { ext: 'php', runner: 'php', comment: '//' },
  java: { ext: 'java', runner: 'javac', comment: '//' },
  c: { ext: 'c', runner: 'gcc', comment: '//' },
  cpp: { ext: 'cpp', runner: 'g++', comment: '//' },
  csharp: { ext: 'cs', runner: 'dotnet', comment: '//' },
  go: { ext: 'go', runner: 'go run', comment: '//' },
  rust: { ext: 'rs', runner: 'rustc', comment: '//' },
  ruby: { ext: 'rb', runner: 'ruby', comment: '#' },
  swift: { ext: 'swift', runner: 'swift', comment: '//' },
  kotlin: { ext: 'kt', runner: 'kotlinc', comment: '//' },
  r: { ext: 'R', runner: 'Rscript', comment: '#' },
  dart: { ext: 'dart', runner: 'dart', comment: '//' },
  yaml: { ext: 'yaml', runner: null, comment: '#' },
  markdown: { ext: 'md', runner: null, comment: '<!--' },
  lua: { ext: 'lua', runner: 'lua', comment: '--' },
  perl: { ext: 'pl', runner: 'perl', comment: '#' },
  scala: { ext: 'scala', runner: 'scala', comment: '//' },
  haskell: { ext: 'hs', runner: 'runghc', comment: '--' },
  elixir: { ext: 'ex', runner: 'elixir', comment: '#' },
  clojure: { ext: 'clj', runner: 'clojure', comment: ';;' },
  solidity: { ext: 'sol', runner: null, comment: '//' },
  vue: { ext: 'vue', runner: null, comment: '<!--' },
  svelte: { ext: 'svelte', runner: null, comment: '<!--' },
  react: { ext: 'jsx', runner: null, comment: '//' },
  graphql: { ext: 'graphql', runner: null, comment: '#' },
  dockerfile: { ext: 'dockerfile', runner: null, comment: '#' },
  toml: { ext: 'toml', runner: null, comment: '#' },
  ini: { ext: 'ini', runner: null, comment: ';' },
  xml: { ext: 'xml', runner: null, comment: '<!--' },
  powershell: { ext: 'ps1', runner: 'pwsh', comment: '#' },
  batch: { ext: 'bat', runner: null, comment: 'REM' },
  makefile: { ext: 'mk', runner: 'make', comment: '#' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = new URL(req.url, 'http://localhost');

    // ── GET: List supported languages ──
    if (req.method === 'GET') {
      if (url.searchParams.get('action') === 'languages') {
        return res.status(200).json({
          languages: Object.keys(LANGUAGES),
          count: Object.keys(LANGUAGES).length,
        });
      }
      return res.status(400).json({ error: 'Use ?action=languages' });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'POST or GET' });

    const { mode, language, code, instruction, question, snippet } = req.body || {};
    if (!mode) return res.status(400).json({ error: 'mode required' });

    const lang = language ? language.toLowerCase() : 'python';
    const langInfo = LANGUAGES[lang] || { ext: 'txt', comment: '//', runner: null };
    const langName = lang.charAt(0).toUpperCase() + lang.slice(1);

    // ── Mode: Generate code from natural language ──
    if (mode === 'generate') {
      if (!instruction) return res.status(400).json({ error: 'instruction required' });
      const messages = [
        { role: 'system', content: `You are an expert ${langName} programmer. Generate clean, production-quality ${langName} code based on the user's request. Output ONLY code with brief inline comments. No markdown fences, no explanations outside code. If the request is complex, add a brief comment at the top explaining what the code does.` },
        { role: 'user', content: instruction },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 2048 }),
      });
      if (!aiRes.ok) throw new Error('AI generation failed');
      const aiData = await aiRes.json();
      let generated = aiData.choices?.[0]?.message?.content || '';
      generated = generated.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '');
      return res.status(200).json({ code: generated, language: lang, mode: 'generate' });
    }

    // ── Mode: Edit existing code ──
    if (mode === 'edit') {
      if (!code || !instruction) return res.status(400).json({ error: 'code and instruction required' });
      const messages = [
        { role: 'system', content: `You are an expert ${langName} code editor. The user gives you existing code and an edit instruction. Output ONLY the complete modified code — no explanations, no markdown fences. Apply ONLY the requested changes while preserving existing functionality.` },
        { role: 'user', content: `Edit this ${langName} code:\n\nInstruction: ${instruction}\n\nCurrent code:\n${code}\n\nOutput the complete modified code:` },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: 4096 }),
      });
      if (!aiRes.ok) throw new Error('AI edit failed');
      const aiData = await aiRes.json();
      let edited = aiData.choices?.[0]?.message?.content || '';
      edited = edited.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '');
      const changed = edited.trim() !== code.trim();
      return res.status(200).json({ code: edited, language: lang, changed, mode: 'edit' });
    }

    // ── Mode: Debug / Find bugs ──
    if (mode === 'debug') {
      if (!code) return res.status(400).json({ error: 'code required' });
      const messages = [
        { role: 'system', content: `You are an expert ${langName} debugger. Analyze the code for bugs, errors, edge cases, security issues, and performance problems. List issues found with severity (critical/high/medium/low), explain each issue, and provide the fix. Use markdown formatting.` },
        { role: 'user', content: `Debug this ${langName} code:\n\n${code}` },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 2048 }),
      });
      if (!aiRes.ok) throw new Error('AI debug failed');
      const aiData = await aiRes.json();
      return res.status(200).json({ analysis: aiData.choices?.[0]?.message?.content, language: lang, mode: 'debug' });
    }

    // ── Mode: Explain code ──
    if (mode === 'explain') {
      if (!code) return res.status(400).json({ error: 'code required' });
      const messages = [
        { role: 'system', content: `You are an expert ${langName} developer. Explain what the code does step by step. Cover: purpose, logic flow, key functions/variables, edge cases, and any improvements. Use markdown formatting with code references.` },
        { role: 'user', content: `Explain this ${langName} code:\n\n${code}` },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 1024 }),
      });
      if (!aiRes.ok) throw new Error('AI explain failed');
      const aiData = await aiRes.json();
      return res.status(200).json({ explanation: aiData.choices?.[0]?.message?.content, language: lang, mode: 'explain' });
    }

    // ── Mode: Convert code to another language ──
    if (mode === 'convert') {
      if (!code || !language) return res.status(400).json({ error: 'code and language (target) required' });
      const targetLang = req.body.targetLanguage || req.body.target || 'python';
      const targetInfo = LANGUAGES[targetLang.toLowerCase()] || { ext: 'txt' };
      const messages = [
        { role: 'system', content: `You are an expert programmer. Convert the given ${langName} code to ${targetLang}. Output ONLY the converted code with inline comments explaining key differences. No markdown fences, no explanations outside code.` },
        { role: 'user', content: `Convert this ${langName} code to ${targetLang}:\n\n${code}` },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 4096 }),
      });
      if (!aiRes.ok) throw new Error('AI conversion failed');
      const aiData = await aiRes.json();
      let converted = aiData.choices?.[0]?.message?.content || '';
      converted = converted.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '');
      return res.status(200).json({ code: converted, from: lang, to: targetLang, mode: 'convert' });
    }

    // ── Mode: Optimize code ──
    if (mode === 'optimize') {
      if (!code) return res.status(400).json({ error: 'code required' });
      const messages = [
        { role: 'system', content: `You are an expert ${langName} optimizer. Optimize the code for performance, readability, and best practices. Output the optimized code with a brief comment block at the top explaining what was optimized. No markdown fences.` },
        { role: 'user', content: `Optimize this ${langName} code:\n\n${code}` },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: 4096 }),
      });
      if (!aiRes.ok) throw new Error('AI optimize failed');
      const aiData = await aiRes.json();
      let optimized = aiData.choices?.[0]?.message?.content || '';
      optimized = optimized.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '');
      return res.status(200).json({ code: optimized, language: lang, mode: 'optimize' });
    }

    // ── Mode: Code review ──
    if (mode === 'review') {
      if (!code) return res.status(400).json({ error: 'code required' });
      const messages = [
        { role: 'system', content: `You are a senior ${langName} code reviewer. Review the code and provide:
1. **Score** (0-10) for: correctness, readability, performance, security
2. **Issues found** — categorized by severity
3. **Best practices** — what's done well
4. **Recommendations** — specific improvements
Use markdown formatting with code references.` },
        { role: 'user', content: `Review this ${langName} code:\n\n${code}` },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, max_tokens: 2048 }),
      });
      if (!aiRes.ok) throw new Error('AI review failed');
      const aiData = await aiRes.json();
      return res.status(200).json({ review: aiData.choices?.[0]?.message?.content, language: lang, mode: 'review' });
    }

    // ── Mode: Test generation ──
    if (mode === 'test') {
      if (!code) return res.status(400).json({ error: 'code required' });
      const messages = [
        { role: 'system', content: `You are an expert ${langName} test engineer. Generate comprehensive unit tests for the given code. Use appropriate testing framework for ${langName} (unittest/pytest for Python, Jest for JS, JUnit for Java, etc.). Output ONLY the test code. No markdown fences.` },
        { role: 'user', content: `Generate tests for this ${langName} code:\n\n${code}` },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 2048 }),
      });
      if (!aiRes.ok) throw new Error('AI test generation failed');
      const aiData = await aiRes.json();
      let tests = aiData.choices?.[0]?.message?.content || '';
      tests = tests.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '');
      return res.status(200).json({ tests, language: lang, mode: 'test' });
    }

    // ── Mode: Complexity analysis ──
    if (mode === 'complexity') {
      if (!code) return res.status(400).json({ error: 'code required' });
      const messages = [
        { role: 'system', content: `You are an expert ${langName} algorithm analyst. Analyze the time and space complexity of the code. Provide:
1. **Time Complexity** — Big O notation with explanation
2. **Space Complexity** — Big O notation with explanation
3. **Optimization suggestions** if applicable
Use markdown formatting.` },
        { role: 'user', content: `Analyze complexity of this ${langName} code:\n\n${code}` },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 1024 }),
      });
      if (!aiRes.ok) throw new Error('AI analysis failed');
      const aiData = await aiRes.json();
      return res.status(200).json({ analysis: aiData.choices?.[0]?.message?.content, language: lang, mode: 'complexity' });
    }

    // ── Mode: Snippet library ──
    if (mode === 'snippet') {
      if (!snippet) return res.status(400).json({ error: 'snippet (type/category) required' });
      const messages = [
        { role: 'system', content: `You are an expert ${langName} developer. Generate a commonly useful ${langName} code snippet for the requested category. Include a brief comment explaining usage. Output ONLY the code. No markdown fences.` },
        { role: 'user', content: `Generate a ${snippet} snippet in ${langName}` },
      ];
      const aiRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, max_tokens: 1024 }),
      });
      if (!aiRes.ok) throw new Error('AI snippet failed');
      const aiData = await aiRes.json();
      let snip = aiData.choices?.[0]?.message?.content || '';
      snip = snip.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '');
      return res.status(200).json({ snippet: snip, language: lang, category: snippet, mode: 'snippet' });
    }

    return res.status(400).json({
      error: 'Unknown mode',
      modes: ['generate', 'edit', 'debug', 'explain', 'convert', 'optimize', 'review', 'test', 'complexity', 'snippet'],
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
