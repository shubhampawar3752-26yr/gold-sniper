// Gold Sniper — Full IDE API
// File CRUD + Directory Tree + Code Search + Git Operations + Multi-file editing

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'shubhampawar3752-26yr/gold-sniper';
const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

const [OWNER, REPO] = GITHUB_REPO.split('/');

function checkAuth(req) { return true; } // Auth removed

// ── GitHub API helpers ──
async function ghAPI(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  return res;
}

// ── Get full repo tree ──
async function getRepoTree(branch = 'main') {
  const res = await ghAPI(`/repos/${OWNER}/${REPO}/git/trees/${branch}?recursive=1`);
  if (!res.ok) throw new Error(`Tree: ${res.status}`);
  const data = await res.json();
  return data.tree;
}

// ── Read file content + SHA ──
async function readFile(path, branch = 'main') {
  // Get SHA from tree
  const tree = await getRepoTree(branch);
  const entry = tree.find(t => t.path === path);
  if (!entry) throw new Error(`File not found: ${path}`);
  
  const res = await ghAPI(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${branch}`);
  if (!res.ok) throw new Error(`Read ${path}: ${res.status}`);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { content, sha: data.sha, path, size: data.size };
}

// ── Write/create file ──
async function writeFile(path, content, message, branch = 'main') {
  // Get current SHA if file exists
  let sha = null;
  try {
    const existing = await readFile(path, branch);
    sha = existing.sha;
  } catch {}
  
  const res = await ghAPI(`/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: message || `IDE: Update ${path}`,
      content: Buffer.from(content).toString('base64'),
      sha: sha || undefined,
      branch,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Write ${path}: ${res.status} ${err.message || ''}`);
  }
  return { success: true, path, sha: (await res.json()).content?.sha };
}

// ── Delete file ──
async function deleteFile(path, message, branch = 'main') {
  const file = await readFile(path, branch);
  const res = await ghAPI(`/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message: message || `IDE: Delete ${path}`, sha: file.sha, branch }),
  });
  if (!res.ok) throw new Error(`Delete ${path}: ${res.status}`);
  return { success: true, path, deleted: true };
}

// ── Search code in repo ──
async function searchCode(query) {
  const res = await ghAPI(`/search/code?q=${encodeURIComponent(query)}+repo:${OWNER}/${REPO}&per_page=20`);
  if (!res.ok) throw new Error(`Search: ${res.status}`);
  const data = await res.json();
  return (data.items || []).map(item => ({
    path: item.path,
    name: item.name,
    score: item.score,
  }));
}

// ── List branches ──
async function listBranches() {
  const res = await ghAPI(`/repos/${OWNER}/${REPO}/branches?per_page=30`);
  if (!res.ok) throw new Error(`Branches: ${res.status}`);
  const data = await res.json();
  return data.map(b => ({ name: b.name, sha: b.commit.sha, protected: b.protected }));
}

// ── Create branch ──
async function createBranch(branchName, from = 'main') {
  // Get SHA of source branch
  const refRes = await ghAPI(`/repos/${OWNER}/${REPO}/git/refs/heads/${from}`);
  if (!refRes.ok) throw new Error(`Source branch ${from}: ${refRes.status}`);
  const refData = await refRes.json();
  
  const res = await ghAPI(`/repos/${OWNER}/${REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: refData.object.sha }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Create branch: ${res.status} ${err.message || ''}`);
  }
  return { success: true, branch: branchName, from };
}

// ── Get commit history ──
async function getCommits(path, limit = 10) {
  let url = `/repos/${OWNER}/${REPO}/commits?per_page=${limit}`;
  if (path) url += `&path=${encodeURIComponent(path)}`;
  const res = await ghAPI(url);
  if (!res.ok) throw new Error(`Commits: ${res.status}`);
  const data = await res.json();
  return data.map(c => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author.name,
    date: c.commit.author.date,
  }));
}

// ── Get file diff between two branches ──
async function compareBranches(base, head) {
  const res = await ghAPI(`/repos/${OWNER}/${REPO}/compare/${base}...${head}`);
  if (!res.ok) throw new Error(`Compare: ${res.status}`);
  const data = await res.json();
  return {
    ahead: data.ahead_by,
    behind: data.behind_by,
    files: (data.files || []).map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })),
  };
}

// ── AI-powered code edit ──
async function aiEditFile(path, instruction, content, preview = true) {
  const systemPrompt = `You are a code editor. The user gives you a file and an instruction. You output ONLY the modified file content — no explanations, no markdown code blocks, no \`\`\` wrappers. Just the raw file content with the changes applied.

Rules:
- Preserve all existing functionality unless explicitly asked to change it
- Keep the same encoding and line ending style
- Apply ONLY the requested changes
- If the instruction is ambiguous, make the most sensible interpretation
- Output the complete file, not just the changed parts`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `File: ${path}\n\nInstruction: ${instruction}\n\nCurrent content:\n${content}\n\nOutput the complete modified file:` },
  ];

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 4096 }),
  });
  if (!res.ok) throw new Error('AI edit failed');
  const data = await res.json();
  let newContent = data.choices?.[0]?.message?.content || '';
  // Strip markdown code blocks if present
  newContent = newContent.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '');
  return { original: content, modified: newContent, path, preview };
}

// ── Multi-file edit (batch) ──
async function batchEdit(edits, branch = 'main') {
  const results = [];
  for (const edit of edits) {
    try {
      const file = await readFile(edit.path, branch);
      const aiResult = await aiEditFile(edit.path, edit.instruction, file.content, false);
      if (!edit.preview) {
        await writeFile(edit.path, aiResult.modified, edit.message || `IDE: Edit ${edit.path}`, branch);
      }
      results.push({ path: edit.path, success: true, preview: edit.preview ? aiResult.modified : null });
    } catch (e) {
      results.push({ path: edit.path, success: false, error: e.message });
    }
  }
  return results;
}

// ── Directory tree builder ──
function buildTree(paths) {
  const tree = {};
  for (const p of paths) {
    if (p.type === 'tree') continue;
    const parts = p.path.split('/');
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        node[part] = '📄';
      } else {
        if (!node[part]) node[part] = {};
        node = node[part];
      }
    }
  }
  return tree;
}

function formatTree(tree, indent = '') {
  let out = '';
  const entries = Object.entries(tree).sort((a, b) => {
    const aDir = typeof a[1] === 'object';
    const bDir = typeof b[1] === 'object';
    if (aDir && !bDir) return -1;
    if (!aDir && bDir) return 1;
    return a[0].localeCompare(b[0]);
  });
  for (const [key, val] of entries) {
    if (typeof val === 'object') {
      out += `${indent}📁 ${key}/\n`;
      out += formatTree(val, indent + '  ');
    } else {
      out += `${indent}${val} ${key}\n`;
    }
  }
  return out;
}

// ── Main handler ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || 'tree';

    // ── GET: Read operations ──
    if (req.method === 'GET') {
      // Full repo tree
      if (action === 'tree') {
        const tree = await getRepoTree();
        const files = tree.filter(t => t.type === 'blob').map(t => t.path);
        const treeObj = buildTree(tree);
        return res.status(200).json({ files, tree: formatTree(treeObj), count: files.length });
      }
      
      // List files in directory
      if (action === 'list') {
        const dir = url.searchParams.get('dir') || '';
        const tree = await getRepoTree();
        const files = tree.filter(t => t.type === 'blob' && (dir === '' || t.path.startsWith(dir + '/'))).map(t => t.path);
        return res.status(200).json({ dir, files, count: files.length });
      }
      
      // Read file
      if (action === 'read') {
        const path = url.searchParams.get('path');
        if (!path) return res.status(400).json({ error: 'path required' });
        const file = await readFile(path);
        return res.status(200).json(file);
      }
      
      // Search code
      if (action === 'search') {
        const query = url.searchParams.get('q');
        if (!query) return res.status(400).json({ error: 'q required' });
        const results = await searchCode(query);
        return res.status(200).json({ query, results, count: results.length });
      }
      
      // List branches
      if (action === 'branches') {
        const branches = await listBranches();
        return res.status(200).json({ branches });
      }
      
      // Commit history
      if (action === 'commits') {
        const path = url.searchParams.get('path');
        const limit = parseInt(url.searchParams.get('limit') || '10');
        const commits = await getCommits(path, limit);
        return res.status(200).json({ commits });
      }
      
      // Compare branches
      if (action === 'compare') {
        const base = url.searchParams.get('base') || 'main';
        const head = url.searchParams.get('head');
        if (!head) return res.status(400).json({ error: 'head required' });
        const diff = await compareBranches(base, head);
        return res.status(200).json(diff);
      }

      // Repo info
      if (action === 'info') {
        const r = await ghAPI(`/repos/${OWNER}/${REPO}`);
        const data = await r.json();
        return res.status(200).json({
          name: data.name, full_name: data.full_name, description: data.description,
          default_branch: data.default_branch, size: data.size,
          stars: data.stargazers_count, forks: data.forks_count,
          private: data.private, html_url: data.html_url,
          updated_at: data.updated_at,
        });
      }
    }

    // ── POST: Write operations ──
    if (req.method === 'POST') {
      const body = req.body || {};
      
      // AI edit file
      if (action === 'ai-edit') {
        const { path, instruction, preview = true } = body;
        if (!path || !instruction) return res.status(400).json({ error: 'path and instruction required' });
        const file = await readFile(path);
        const result = await aiEditFile(path, instruction, file.content, preview);
        if (!preview) {
          await writeFile(path, result.modified, `IDE AI: ${instruction.slice(0, 50)}`);
        }
        return res.status(200).json({ path, preview, modified: result.modified, diff: result.modified !== file.content });
      }
      
      // Write/create file
      if (action === 'write') {
        const { path, content, message } = body;
        if (!path || content === undefined) return res.status(400).json({ error: 'path and content required' });
        const result = await writeFile(path, content, message || `IDE: Write ${path}`);
        return res.status(200).json(result);
      }
      
      // Delete file
      if (action === 'delete') {
        const { path, message } = body;
        if (!path) return res.status(400).json({ error: 'path required' });
        const result = await deleteFile(path, message || `IDE: Delete ${path}`);
        return res.status(200).json(result);
      }
      
      // Create branch
      if (action === 'branch') {
        const { name, from } = body;
        if (!name) return res.status(400).json({ error: 'name required' });
        const result = await createBranch(name, from || 'main');
        return res.status(200).json(result);
      }
      
      // Multi-file batch edit
      if (action === 'batch-edit') {
        const { edits, preview = true } = body;
        if (!edits || !Array.isArray(edits)) return res.status(400).json({ error: 'edits array required' });
        const results = await batchEdit(edits);
        return res.status(200).json({ results });
      }
      
      // Rename/move file
      if (action === 'move') {
        const { from, to, message } = body;
        if (!from || !to) return res.status(400).json({ error: 'from and to required' });
        const file = await readFile(from);
        await writeFile(to, file.content, message || `IDE: Move ${from} → ${to}`);
        await deleteFile(from, `IDE: Remove old path ${from}`);
        return res.status(200).json({ success: true, from, to });
      }
    }

    // ── DELETE: Delete file via query params ──
    if (req.method === 'DELETE') {
      const path = url.searchParams.get('path');
      if (!path) return res.status(400).json({ error: 'path required' });
      const result = await deleteFile(path, `IDE: Delete ${path}`);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Unknown action. Use: tree, list, read, search, branches, commits, compare, info, ai-edit, write, delete, branch, batch-edit, move' });
  } catch (error) {
    console.error('IDE error:', error);
    return res.status(500).json({ error: error.message });
  }
}
