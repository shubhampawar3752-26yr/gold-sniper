import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GOLDAPI_KEY = Deno.env.get("GOLDAPI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function fetchSpot() {
  if (!GOLDAPI_KEY) throw new Error("GOLDAPI_API_KEY is not configured");
  const r = await fetch("https://www.goldapi.io/api/XAU/USD", {
    headers: { "x-access-token": GOLDAPI_KEY, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`GoldAPI error (${r.status}): ${await r.text()}`);
  const d = await r.json();
  if (typeof d.price !== "number") throw new Error("GoldAPI returned no spot price");
  return {
    symbol: "XAU/USD", source: "GoldAPI.io", exchange: d.exchange,
    providerSymbol: d.symbol, timestamp: d.timestamp, price: d.price,
    bid: d.bid, ask: d.ask, open: d.open_price, high: d.high_price,
    low: d.low_price, previousClose: d.prev_close_price, change: d.ch,
    changePct: d.chp,
    spread: typeof d.ask === "number" && typeof d.bid === "number" ? +(d.ask - d.bid).toFixed(4) : null,
  };
}

async function fetchTavily() {
  const query = `XAU USD gold spot market latest news Federal Reserve USD dollar yields geopolitical risk ${new Date().toISOString().slice(0, 10)}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TAVILY_API_KEY) headers.Authorization = `Bearer ${TAVILY_API_KEY}`;
  else headers["X-Tavily-Access-Mode"] = "keyless";

  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, max_results: 5, search_depth: "fast", topic: "general", include_raw_content: false }),
  });
  if (!r.ok) return { ok: false, error: `Tavily error (${r.status})`, results: [] };
  const d = await r.json();
  return {
    ok: true, query,
    results: (d.results || []).slice(0, 5).map((x: any) => ({
      title: x.title, url: x.url, content: x.content,
      published_date: x.published_date, score: x.score,
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const spot = await fetchSpot();
    const news = await fetchTavily();
    const { data: agent, error: ae } = await supabase.from("agents").select("id,name,model").eq("name", "Market Data Analyst").single();
    if (ae || !agent) throw new Error(`Market Data Analyst not found: ${ae?.message ?? "unknown"}`);
    const { data: session, error: se } = await supabase.from("agent_sessions").insert({ agent_id: agent.id, status: "running" }).select("id").single();
    if (se || !session) throw new Error(`Could not create agent session: ${se?.message ?? "unknown"}`);
    const description = `Analyze current XAU/USD SPOT market data and fresh web intelligence. Do NOT use futures prices as the primary price. GoldAPI spot: ${JSON.stringify(spot)}. Tavily web intelligence: ${JSON.stringify(news)}. Use GoldAPI spot as authoritative live spot price; use Tavily only for current news, macro drivers, sentiment/context and source URLs. Clearly separate verified spot data from web commentary. Return current spot condition, key drivers, risks, and immediate data-quality concerns. Keep it factual and concise.`;
    const { data: task, error: te } = await supabase.from("agent_tasks").insert({ session_id: session.id, description, status: "pending" }).select("id").single();
    if (te || !task) throw new Error(`Could not create agent task: ${te?.message ?? "unknown"}`);
    return new Response(JSON.stringify({ ok: true, spot, tavily: news, agent: { name: agent.name, model: agent.model }, task_id: task.id, session_id: session.id, status: "pending" }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
