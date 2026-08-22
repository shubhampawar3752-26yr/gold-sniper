// Gold Sniper — Freebuff-style AI Coding Agent
// Describe what you want → agent reads files, plans, edits, and commits to GitHub

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'shubhampawar3752-26yr/gold-sniper';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

const [OWNER, REPO] = GITHUB_REPO.split('/');

// ── GitHub helpers ──
async function ghAPI(path, opts = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

async function getRepoTree(branch = 'main') {
  const res = await ghAPI(`/repos/${OWNER}/${REPO}/git/trees/${branch}?recursive=1`);
  if (!res.ok) throw new Error(`Tree: ${res.status}`);
  const data = await res.json();
  return data.tree.filter(t => t.type === 'blob').map(t => t.path);
}

async function readFile(path, branch = 'main') {
  const res = await ghAPI(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${branch}`);
  if (!res.ok) throw new Error(`Read ${path}: ${res.status}`);
  const data = await res.json();
  return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

async function writeFile(path, content, message, branch = 'main') {
  let sha = null;
  try { const existing = await readFile(path, branch); sha = existing.sha; } catch {}
  const res = await ghAPI(`/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message: message || `Agent: ${path}`, content: Buffer.from(content).toString('base64'), sha: sha || undefined, branch }),
  });
  if (!res.ok) throw new Error(`Write ${path}: ${res.status}`);
  return { success: true, path };
}

async function deleteFile(path, message, branch = 'main') {
  const file = await readFile(path, branch);
  await ghAPI(`/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message: message || `Agent: Delete ${path}`, sha: file.sha, branch }),
  });
  return { success: true, path, deleted: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { instruction, mode = 'plan', files: requestedFiles, language } = req.body || {};
    if (!instruction) return res.status(400).json({ error: 'instruction required' });

    // ── Step 1: Get repo file tree ──
    const allFiles = await getRepoTree();
    
    // ── Step 2: AI decides which files to read ──
    const planMessages = [
      { role: 'system', content: `You are a coding agent like Freebuff/Claude Code. Given a natural language instruction and a repo file list, decide which files to read and what plan to follow.

Output JSON only:
{
  "files_to_read": ["path1", "path2"],
  "plan": "step-by-step plan",
  "files_to_edit": [{"path": "X", "action": "create|edit|delete", "description": "what to change"}]
}

Rules:
- Read max 5 files most relevant to the instruction
- Only include files that need changes
- Keep plan concise (3-5 steps)` },
      { role: 'user', content: `Instruction: ${instruction}\n\nRepo files:\n${allFiles.join('\n')}` },
    ];
    
    const planRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: planMessages, temperature: 0.3, max_tokens: 1024 }),
    });
    if (!planRes.ok) throw new Error('AI plan failed');
    const planData = await planRes.json();
    
    let plan;
    try {
      let rawPlan = planData.choices?.[0]?.message?.content || '{}';
      rawPlan = rawPlan.replace(/^```json\n?/m, '').replace(/\n?```$/m, '').trim();
      plan = JSON.parse(rawPlan);
    } catch { plan = { files_to_read: [], plan: 'Could not generate plan', files_to_edit: [] }; }

    // ── Mode: PLAN only (preview what will happen) ──
    if (mode === 'plan') {
      // Read the files the AI wants to inspect
      const fileContents = {};
      if (plan.files_to_read) {
        for (const f of plan.files_to_read.slice(0, 5)) {
          try { fileContents[f] = (await readFile(f)).content.slice(0, 4000); } catch {}
        }
      }
      return res.status(200).json({
        mode: 'plan',
        instruction,
        plan: plan.plan,
        files_to_read: plan.files_to_read || [],
        files_to_edit: plan.files_to_edit || [],
        file_previews: fileContents,
        total_repo_files: allFiles.length,
      });
    }

    // ── Mode: EXECUTE (read files, generate edits, apply to GitHub) ──
    if (mode === 'execute') {
      const results = [];
      
      if (!plan.files_to_edit || plan.files_to_edit.length === 0) {
        return res.status(200).json({ mode: 'execute', results: [], message: 'No files to edit' });
      }

      // Read files that need editing
      const fileContents = {};
      for (const edit of plan.files_to_edit) {
        if (edit.action !== 'create') {
          try { fileContents[edit.path] = (await readFile(edit.path)).content; } catch {}
        }
      }

      // Generate each edit with AI
      for (const edit of plan.files_to_edit) {
        try {
          if (edit.action === 'delete') {
            await deleteFile(edit.path, `Agent: Delete ${edit.path} — ${instruction.slice(0, 50)}`);
            results.push({ path: edit.path, action: 'delete', success: true });
            continue;
          }

          if (edit.action === 'create') {
            // Generate new file from instruction
            const genMessages = [
              { role: 'system', content: `You are an expert coder. Generate the file ${edit.path} based on the instruction. Output ONLY the file content, no markdown fences, no explanations.${language ? ` Language: ${language}.` : ''}` },
              { role: 'user', content: `${edit.description || instruction}\n\nContext from instruction: ${instruction}` },
            ];
            const genRes = await fetch(GROQ_URL, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: MODEL, messages: genMessages, temperature: 0.3, max_tokens: 4096 }),
            });
            if (!genRes.ok) { results.push({ path: edit.path, action: 'create', success: false, error: 'AI generation failed' }); continue; }
            const genData = await genRes.json();
            let newContent = genData.choices?.[0]?.message?.content || '';
            newContent = newContent.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '');
            await writeFile(edit.path, newContent, `Agent: Create ${edit.path} — ${instruction.slice(0, 50)}`);
            results.push({ path: edit.path, action: 'create', success: true, size: newContent.length });
            continue;
          }

          // action: 'edit' — modify existing file
          const currentContent = fileContents[edit.path] || '';
          if (!currentContent) { results.push({ path: edit.path, action: 'edit', success: false, error: 'File not found' }); continue; }
          
          const editMessages = [
            { role: 'system', content: `You are an expert code editor. Edit the file ${edit.path} based on the instruction. Output ONLY the complete modified file content — no markdown fences, no explanations. Apply ONLY the requested changes, preserve everything else.` },
            { role: 'user', content: `Instruction: ${edit.description || instruction}\n\nFull context: ${instruction}\n\nCurrent ${edit.path}:\n${currentContent.slice(0, 8000)}\n\nOutput the complete modified file:` },
          ];
          const editRes = await fetch(GROQ_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODEL, messages: editMessages, temperature: 0.2, max_tokens: 4096 }),
          });
          if (!editRes.ok) { results.push({ path: edit.path, action: 'edit', success: false, error: 'AI edit failed' }); continue; }
          const editData = await editRes.json();
          let newContent = editData.choices?.[0]?.message?.content || '';
          newContent = newContent.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '');
          const changed = newContent.trim() !== currentContent.trim();
          if (changed) {
            await writeFile(edit.path, newContent, `Agent: Edit ${edit.path} — ${instruction.slice(0, 50)}`);
          }
          results.push({ path: edit.path, action: 'edit', success: true, changed, size: newContent.length });
        } catch (e) {
          results.push({ path: edit.path, action: edit.action, success: false, error: e.message });
        }
      }

      return res.status(200).json({
        mode: 'execute',
        instruction,
        plan: plan.plan,
        results,
        success_count: results.filter(r => r.success).length,
        total: results.length,
      });
    }

    // ── Mode: CHAT (full agent conversation — plan + answer questions) ──
    if (mode === 'chat') {
      // Read relevant files for context
      const fileContents = {};
      if (plan.files_to_read) {
        for (const f of plan.files_to_read.slice(0, 3)) {
          try { fileContents[f] = (await readFile(f)).content.slice(0, 3000); } catch {}
        }
      }
      
      const chatMessages = [
        { role: 'system', content: `You are a coding agent (like Freebuff/Claude Code). You have access to the Gold Sniper repo on GitHub. 

Repo has ${allFiles.length} files. Here are relevant files for this request:

${Object.entries(fileContents).map(([p, c]) => `--- ${p} ---\n${c}`).join('\n\n')}

Help the user with their request. If code changes are needed, explain what files to change and how. If they want to apply changes, tell them to use mode=plan then mode=execute. Be concise and specific.` },
        { role: 'user', content: instruction },
      ];
      
      const chatRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: chatMessages, temperature: 0.4, max_tokens: 2048 }),
      });
      if (!chatRes.ok) throw new Error('AI chat failed');
      const chatData = await chatRes.json();
      return res.status(200).json({
        mode: 'chat',
        reply: chatData.choices?.[0]?.message?.content,
        files_read: plan.files_to_read || [],
        plan: plan.plan,
      });
    }

    return res.status(400).json({ error: 'Unknown mode. Use: plan, execute, or chat' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
