// Gold Sniper — HTML/CSS Editor API
// Read files via raw.githubusercontent.com, write via GitHub Git Data API

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'shubhampawar3752-26yr/gold-sniper';
const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

function checkAuth(req) {
  if (!AUTH_TOKEN) return true;
  const authHeader = req.headers['x-auth-token'] || req.headers['authorization'] || '';
  return authHeader.replace('Bearer ', '').trim() === AUTH_TOKEN;
}

const [OWNER, REPO] = GITHUB_REPO.split('/');

// ── Read file via raw.githubusercontent.com (works for public repos) ──
async function readFile(path) {
  const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`File not found: ${path} (${res.status})`);
  const content = await res.text();
  
  // Get SHA via git trees API
  let sha = null;
  try {
    const treeRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/trees/main?recursive=1`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (treeRes.ok) {
      const tree = await treeRes.json();
      const entry = tree.tree.find(t => t.path === path);
      if (entry) sha = entry.sha;
    }
  } catch {}
  
  return { content, sha, size: content.length, path };
}

// ── List directory via git trees API ──
async function listFiles(dirPath) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/trees/main?recursive=1`, {
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!res.ok) throw new Error(`GitHub tree: ${res.status}`);
  const data = await res.json();
  const tree = data.tree || [];
  
  if (dirPath) {
    const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    return tree.filter(t => t.path.startsWith(prefix) && !t.path.slice(prefix.length).includes('/'))
      .map(t => ({ name: t.path.slice(prefix.length), path: t.path, type: t.type === 'blob' ? 'file' : 'dir', size: t.size || 0 }));
  }
  
  // Root: show top-level items
  return tree.filter(t => !t.path.includes('/') || (t.path.match(/\//g) || []).length === 0)
    .map(t => ({ name: t.path.split('/')[0], path: t.path, type: t.type === 'blob' ? 'file' : 'dir', size: t.size || 0 }));
}

// ── Write file via Git Data API (blob + commit) ──
async function writeFile(path, content, message) {
  // Create a blob
  const blobRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/blobs`, {
    method: 'POST',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: Buffer.from(content).toString('base64'), encoding: 'base64' }),
  });
  if (!blobRes.ok) throw new Error(`Blob creation: ${blobRes.status}`);
  const blob = await blobRes.json();

  // Get current commit + tree
  const refRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`, {
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!refRes.ok) throw new Error(`Ref: ${refRes.status}`);
  const ref = await refRes.json();
  const commitSha = ref.object.sha;

  // Get the tree
  const commitRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/commits/${commitSha}`, {
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!commitRes.ok) throw new Error(`Commit: ${commitRes.status}`);
  const commit = await commitRes.json();
  const treeSha = commit.tree.sha;

  // Create new tree with the file
  const newTreeRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/trees`, {
    method: 'POST',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_tree: treeSha,
      tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
    }),
  });
  if (!newTreeRes.ok) throw new Error(`Tree: ${newTreeRes.status}`);
  const newTree = await newTreeRes.json();

  // Create commit
  const newCommitRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/commits`, {
    method: 'POST',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message || `AI Agent edit: ${path}`,
      tree: newTree.sha,
      parents: [commitSha],
    }),
  });
  if (!newCommitRes.ok) throw new Error(`Commit: ${newCommitRes.status}`);
  const newCommit = await newCommitRes.json();

  // Update ref
  const updateRefRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`, {
    method: 'PATCH',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: newCommit.sha }),
  });
  if (!updateRefRes.ok) throw new Error(`Update ref: ${updateRefRes.status}`);

  return { commitSha: newCommit.sha, commitUrl: `https://github.com/${GITHUB_REPO}/commit/${newCommit.sha}` };
}

// ── LLM-powered code editor ──
async function llmEdit(instruction, currentCode, fileName) {
  const systemPrompt = `You are an expert HTML/CSS/JS editor. You receive an instruction to modify code and the current file content. Return ONLY the complete modified file content — no explanations, no markdown fences, no code blocks. Just the raw file content.

Rules:
- Preserve all existing functionality
- Only change what the instruction asks for
- Keep all imports, scripts, and structure intact
- Return the FULL file, not just the changed parts
- Do not wrap in markdown code fences`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `File: ${fileName}\n\nInstruction: ${instruction}\n\nCurrent content:\n\`\`\`\n${currentCode}\n\`\`\`\n\nReturn the complete modified file (no markdown fences, no explanations):` },
  ];

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 4000 }),
  });
  if (!res.ok) throw new Error(`Groq: ${res.status}`);
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content || '';
  content = content.replace(/^```(html|css|javascript|js)?\n?/i, '').replace(/```\s*$/, '');
  return content.trim();
}

// ── Handler ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const { path, list } = req.query;

      if (list !== undefined) {
        const files = await listFiles(list);
        return res.status(200).json({ files });
      }

      if (path) {
        const file = await readFile(path);
        return res.status(200).json({
          path: file.path,
          sha: file.sha,
          size: file.size,
          content: file.content.length > 50000 ? file.content.substring(0, 50000) + '\n...[truncated]' : file.content,
          truncated: file.content.length > 50000,
        });
      }

      const files = await listFiles('');
      return res.status(200).json({ repo: GITHUB_REPO, files });
    }

    if (req.method === 'POST') {
      const { path: filePath, instruction, preview, dryRun } = req.body;
      if (!filePath) return res.status(400).json({ error: 'File path required' });
      if (!instruction) return res.status(400).json({ error: 'Instruction required' });

      const file = await readFile(filePath);
      const newContent = await llmEdit(instruction, file.content, filePath);

      if (dryRun || preview) {
        return res.status(200).json({
          action: 'preview',
          path: filePath,
          oldLength: file.content.length,
          newLength: newContent.length,
          changed: file.content !== newContent,
          preview: newContent.length > 20000 ? newContent.substring(0, 20000) + '\n...[truncated]' : newContent,
        });
      }

      const result = await writeFile(filePath, newContent, `AI Agent edit: ${instruction.substring(0, 50)}`);
      return res.status(200).json({
        action: 'edited',
        path: filePath,
        success: true,
        commit: result.commitSha,
        commitUrl: result.commitUrl,
        oldLength: file.content.length,
        newLength: newContent.length,
        message: `Successfully edited ${filePath} and pushed to GitHub`,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
