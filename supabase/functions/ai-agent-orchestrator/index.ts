// AI Agent Orchestrator — uses OpenCodeZen (OpenAI-compatible) instead of OpenAI directly
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LLM_API_KEY = Deno.env.get('Opencodezen_api_key') || Deno.env.get('OPENAI_API_KEY') || '';
const LLM_BASE_URL = Deno.env.get('OPENAI_BASE_URL') || 'https://opencode.ai/zen/v1';
const LLM_MODEL = 'gpt-5.6';

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

async function supaFetch(table: string, query: string, method = 'GET', body?: any) {
  const url = `${SUPA_URL}/rest/v1/${table}?${query}`;
  const headers: any = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };
  if (method !== 'GET' && body) headers['Prefer'] = 'return=representation';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return await res.json();
}

async function callLLM(systemPrompt: string, userMessage: string) {
  if (!LLM_API_KEY) throw new Error('No LLM API key configured (Opencodezen_api_key or OPENAI_API_KEY)');
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_API_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM API ${res.status}: ${errText.substring(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let body: any = {};
  try { body = await req.json(); } catch { /* GET or empty */ }
  const action = body.action || 'status';

  // STATUS — show config + agent list
  if (action === 'status' || action === 'list' || action === 'agents') {
    const agents = await supaFetch('agents', 'select=id,name,description,model,status&order=created_at.asc', 'GET');
    const tasks = await supaFetch('agent_tasks', 'select=id,description,status&order=created_at.desc&limit=10', 'GET');
    return new Response(JSON.stringify({
      ok: true,
      llm: {
        provider: 'OpenCodeZen',
        base_url: LLM_BASE_URL,
        model: LLM_MODEL,
        api_key_configured: !!LLM_API_KEY,
      },
      agents: agents.map((a: any) => ({ id: a.id, name: a.name, description: a.description, status: a.status })),
      pending_tasks: tasks.filter((t: any) => t.status === 'pending').length,
      total_tasks: tasks.length,
    }), { status: 200, headers: CORS });
  }

  // RUN — execute a specific agent
  if (action === 'run') {
    const agentName = body.agent || body.name;
    if (!agentName) return new Response(JSON.stringify({ ok: false, error: 'Agent name required' }), { status: 400, headers: CORS });

    const agents = await supaFetch('agents', `select=*&name=eq.${encodeURIComponent(agentName)}&limit=1`, 'GET');
    if (!agents || agents.length === 0) return new Response(JSON.stringify({ ok: false, error: `Agent not found: ${agentName}` }), { status: 404, headers: CORS });

    const agent = agents[0];
    if (agent.status !== 'active') return new Response(JSON.stringify({ ok: false, error: `Agent ${agentName} is not active` }), { status: 400, headers: CORS });

    // Create session
    const session = await supaFetch('agent_sessions', '', 'POST', {
      agent_id: agent.id, status: 'running', started_at: new Date().toISOString(),
    });

    // Build context based on agent type
    let userMsg = body.message || `Perform your role as ${agent.name}. ${agent.description}. Analyze current Gold (XAUUSD) market conditions and provide your assessment.`;

    // Add market data context if available
    if (agentName.includes('Market Data') || agentName.includes('Technical')) {
      try {
        const ctxRes = await fetch(`${SUPA_URL}/functions/v1/fetch-ai-market-context`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: agentName }),
        });
        if (ctxRes.ok) {
          const ctx = await ctxRes.json();
          if (ctx.result) userMsg += `\n\nMarket Data Context:\n${JSON.stringify(ctx.result).substring(0, 2000)}`;
        }
      } catch {}
    }

    // Call LLM
    let result = '', error = '';
    try {
      result = await callLLM(agent.system_prompt, userMsg);
    } catch (e) {
      error = (e as Error).message;
    }

    // Update session
    const sessionId = session?.[0]?.id || session?.id;
    if (sessionId) {
      await supaFetch('agent_sessions', `id=eq.${sessionId}`, 'PATCH', {
        status: error ? 'failed' : 'completed', ended_at: new Date().toISOString(), summary: result.substring(0, 500) || error,
      });
    }

    // Log
    await supaFetch('agent_logs', '', 'POST', {
      session_id: sessionId, level: error ? 'error' : 'info',
      message: error || `Agent ${agentName} completed analysis (${result.length} chars)`,
    });

    return new Response(JSON.stringify({
      ok: !error, agent: agentName, session_id: sessionId,
      result: result || null, error: error || null,
    }), { status: 200, headers: CORS });
  }

  // RUN_ALL — execute all active agents in sequence
  if (action === 'run_all') {
    const agents = await supaFetch('agents', 'select=*&status=eq.active&order=created_at.asc', 'GET');
    const results: any[] = [];

    for (const agent of agents) {
      const session = await supaFetch('agent_sessions', '', 'POST', {
        agent_id: agent.id, status: 'running', started_at: new Date().toISOString(),
      });
      const sessionId = session?.[0]?.id || session?.id;

      let userMsg = `Perform your role as ${agent.name}. ${agent.description}. Analyze current Gold (XAUUSD) market conditions and provide your assessment.`;

      // Fetch market context for data-driven agents
      if (agent.name.includes('Market Data') || agent.name.includes('Technical')) {
        try {
          const ctxRes = await fetch(`${SUPA_URL}/functions/v1/fetch-ai-market-context`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: agent.name }),
          });
          if (ctxRes.ok) {
            const ctx = await ctxRes.json();
            if (ctx.result) userMsg += `\n\nMarket Data:\n${JSON.stringify(ctx.result).substring(0, 2000)}`;
          }
        } catch {}
      }

      let result = '', error = '';
      try {
        result = await callLLM(agent.system_prompt, userMsg);
      } catch (e) {
        error = (e as Error).message;
      }

      if (sessionId) {
        await supaFetch('agent_sessions', `id=eq.${sessionId}`, 'PATCH', {
          status: error ? 'failed' : 'completed', ended_at: new Date().toISOString(), summary: result.substring(0, 500) || error,
        });
      }
      await supaFetch('agent_logs', '', 'POST', {
        session_id: sessionId, level: error ? 'error' : 'info',
        message: error || `${agent.name} completed (${result.length} chars)`,
      });

      results.push({ agent: agent.name, ok: !error, result: result.substring(0, 200), error });
    }

    return new Response(JSON.stringify({ ok: true, ran: results.length, results }), { status: 200, headers: CORS });
  }

  return new Response(JSON.stringify({ ok: false, error: 'Unknown action. Use: status, run, run_all' }), { status: 400, headers: CORS });
});
