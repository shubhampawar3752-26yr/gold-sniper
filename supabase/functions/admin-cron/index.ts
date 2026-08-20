const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'list';

  if (action === 'list') {
    // Try pg_cron's job table via pg_catalog schema
    const queries = [
      `${SUPA_URL}/rest/v1/rpc/cron_job_list`,
      `${SUPA_URL}/rest/v1/rpc/get_cron_jobs`,
    ];
    const results = [];
    for (const q of queries) {
      const r = await fetch(q, {
        method: 'POST',
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      results.push({ url: q, status: r.status, body: await r.text() });
    }
    return new Response(JSON.stringify(results, null, 2), { headers: { 'Content-Type': 'application/json' } });
  }

  if (action === 'reschedule') {
    // Unschedule old, schedule new at 02:30 IST = 21:00 UTC
    // pg_cron functions are in the cron schema
    // Try via RPC
    const results = [];
    
    // Unschedule
    const r1 = await fetch(`${SUPA_URL}/rest/v1/rpc/cron_unschedule`, {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_name: 'update-prev-close-daily' })
    });
    results.push({ step: 'unschedule', status: r1.status, body: await r1.text() });
    
    // Schedule  
    const r2 = await fetch(`${SUPA_URL}/rest/v1/rpc/cron_schedule`, {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'update-prev-close-daily',
        schedule: '0 21 * * *',
        command: "SELECT 1;"
      })
    });
    results.push({ step: 'schedule', status: r2.status, body: await r2.text() });
    
    return new Response(JSON.stringify(results, null, 2), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'unknown action' }), { headers: { 'Content-Type': 'application/json' } });
});
