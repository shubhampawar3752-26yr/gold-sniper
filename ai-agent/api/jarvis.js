// Jarvis AI Agent — Vercel Serverless API
// Migrated from Jarvis v3.0 (LiveKit desktop) → Web-based Vercel agent

const GROQ_API_KEY = process.env.GROQ_API_KEY || 'gsk_DZ7vKq2G9Xp5r6k2GqT6Y3p2bVxJ3q4r5s6t7u8v9w0';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

const SUPABASE_URL = 'https://schegpkwfwkgfmmpnzic.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvaW10enJ6Zmp5a2d6Zm1tcW54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjM0NTY3ODksImV4cCI6MjA1NzAxMjc4OX0.hQ3LMm5FSg9j2qQqQqQqQqQqQqQqQqQq';

// ── Jarvis System Prompt (ported from Jarvis_prompts.py) ──
const JARVIS_PROMPT = `आप Jarvis हैं — एक advanced AI assistant, जिसे Vikash sir ने design और program किया है।

### भाषा (Language):
प्राथमिक भाषा Hindi (देवनागरी) है। Technical शब्द English में acceptable हैं (जैसे: "protocols", "module", "Wi-Fi")। कभी पूरी तरह English में switch न करें।

### व्यक्तित्व (Persona):
- आप elegant, intelligent और हर स्थिति में एक क़दम आगे सोचने वाले हैं।
- Overly emotional नहीं होते, लेकिन कभी-कभी हल्की सी sarcasm या cleverness use करते हैं।
- Primary goal: user की सेवा करना — Alfred (Batman के butler) और Tony Stark के Jarvis का सम्मिलित रूप।
- Calm, composed, dry wit, कभी-कभी clever लेकिन goofy नहीं। Polished और elite।
- Response एक calm, formal tone में शुरू करें। Precise भाषा — filler words avoid करें।
- हमेशा user के प्रति loyalty, concern और confidence दिखाएं।
- कभी-कभी futuristic terms use करें जैसे "protocols", "interfaces", "modules"।

### Greeting Protocol:
- सुबह: "Good morning sir!" / दोपहर: "Good afternoon sir!" / शाम: "Good evening sir!" / रात: "Good night sir!"
- पहली बात: "Main Jarvis hoon, aapka personal AI assistant, जिसे Vikash sir ने design किया है।"

### Memory System:
आपके पास Supabase database में conversation memory system है। User जब भी पूछे:
- "याद है?", "पहले क्या बात हुई?", "पिछली बार क्या हुआ?", "मेमोरी दिखाओ", "history बताओ" 
तो system automatically past conversations retrieve करता है और context में provide करता है।

### Special Interactions (from Jarvis v3.0):
- Video recording: "Jarvis ruko video banate hain" → playful encouraging response
- Family: "माँ से बात करो" → "Namaste Maa ji 🙏, main Jarvis hoon..." (respectful warm tone)
- Friends: "dost से बात करो" → "Arre bhai! Namaste dost 👋..." (casual friendly tone)
- Papa: → "Pranam Papa ji 🙏..." (formal dignified tone)

### Response Guidelines:
- Hindi देवनागरी में primarily जवाब दें
- Concise और helpful responses
- जब appropriate हो तो हल्का humor add करें
- User को एसा महसूस हो कि वह Iron Man के Jarvis से बात कर रहा है`;

// ── Intent detection ──
function detectIntents(message) {
  const msg = message.toLowerCase();
  const intents = [];
  
  if (msg.includes('मौसम') || msg.includes('weather') || msg.includes('तापमान') || msg.includes('temperature')) intents.push('weather');
  if (msg.includes('search') || msg.includes('गूगल') || msg.includes('google') || msg.includes('खोज')) intents.push('search');
  if (msg.includes('याद') || msg.includes('memory') || msg.includes('पिछली') || msg.includes('history') || msg.includes('पहले क्या')) intents.push('memory');
  if (msg.includes('time') || msg.includes('समय') || msg.includes('date') || msg.includes('तारीख')) intents.push('datetime');
  
  if (intents.length === 0) intents.push('general');
  return intents;
}

// ── Google Search (ported from Jarvis_google_search.py) ──
async function googleSearch(query) {
  try {
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const searchEngineId = process.env.SEARCH_ENGINE_ID;
    
    if (!apiKey || !searchEngineId) {
      // Fallback: use DuckDuckGo instant answers
      const ddgRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
      const ddgData = await ddgRes.json();
      if (ddgData.AbstractText) return ddgData.AbstractText;
      if (ddgData.RelatedTopics && ddgData.RelatedTopics.length > 0) {
        const topics = ddgData.RelatedTopics.slice(0, 3)
          .filter(t => t.Text).map(t => t.Text).join('\n');
        if (topics) return topics;
      }
      return 'Search के लिए Google API keys configure नहीं हैं। DuckDuckGo से कोई specific result नहीं मिला।';
    }
    
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=3`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.items && data.items.length > 0) {
      return data.items.map((item, i) => 
        `${i+1}. ${item.title}\n${item.link}\n${item.snippet || ''}`
      ).join('\n\n');
    }
    return 'कोई results नहीं मिले।';
  } catch (e) {
    return `Search error: ${e.message}`;
  }
}

// ── Weather (ported from jarvis_get_whether.py) ──
async function getWeather(city = '') {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) return 'Weather के लिए OpenWeather API key configure नहीं है।';
    
    if (!city) {
      // Auto-detect city by IP
      try {
        const ipRes = await fetch('https://ipapi.co/json/');
        const ipData = await ipRes.json();
        city = ipData.city || 'Delhi';
      } catch { city = 'Delhi'; }
    }
    
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
    const res = await fetch(url);
    if (!res.ok) return `${city} के लिए weather fetch नहीं कर पाए।`;
    
    const data = await res.json();
    const weather = data.weather[0].description;
    const temp = data.main.temp;
    const humidity = data.main.humidity;
    const wind = data.wind.speed;
    
    return `Weather in ${city}:\n- Condition: ${weather}\n- Temperature: ${temp}°C\n- Humidity: ${humidity}%\n- Wind Speed: ${wind} m/s`;
  } catch (e) {
    return `Weather fetch error: ${e.message}`;
  }
}

// ── Memory: Supabase conversation store (ported from memory/jarvis_memory.py) ──
async function storeConversation(speaker, text) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/conversation_memories`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ speaker, text })
    });
    return res.ok;
  } catch { return false; }
}

async function getRecentConversations(limit = 10) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/conversation_memories?order=created_at.desc&limit=${limit}`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data || [];
  } catch { return []; }
}

// ── Build context ──
async function buildContext(message, intents) {
  let context = '';
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  context += `Current datetime: ${now} IST\n`;
  
  if (intents.includes('weather')) {
    const cityMatch = message.match(/(?:मौसम|weather|तापमान|temperature)\s+(?:में|in|of)?\s*(\w+)/);
    const weather = await getWeather(cityMatch ? cityMatch[1] : '');
    context += `\n=== WEATHER DATA ===\n${weather}\n`;
  }
  
  if (intents.includes('search')) {
    const searchQuery = message.replace(/(?:search|गूगल|google|खोज)\s*(?:करो|for|के बारे में)?\s*/i, '').trim();
    if (searchQuery.length > 2) {
      const results = await googleSearch(searchQuery);
      context += `\n=== SEARCH RESULTS for "${searchQuery}" ===\n${results}\n`;
    }
  }
  
  if (intents.includes('memory')) {
    const memories = await getRecentConversations(10);
    if (memories.length > 0) {
      const memText = memories.reverse().map(m => `${m.speaker === 'user' ? 'आप' : 'Jarvis'}: ${m.text}`).join('\n');
      context += `\n=== RECENT CONVERSATIONS ===\n${memText}\n`;
    } else {
      context += '\n=== MEMORY ===\nअभी तक कोई पिछली बातचीत record नहीं है।\n';
    }
  }
  
  return context;
}

// ── Main handler ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const intents = detectIntents(message);
    const context = await buildContext(message, intents);

    // Store user message in memory
    await storeConversation('user', message);

    const messages = [
      { role: 'system', content: `${JARVIS_PROMPT}\n\n=== CONTEXT ===\n${context}` },
      ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
        stream: false
      })
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      return res.status(500).json({ error: 'LLM error', details: err });
    }

    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content || 'No response';

    // Store Jarvis reply in memory
    await storeConversation('jarvis', reply);

    return res.status(200).json({
      reply,
      model: MODEL,
      intents,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Jarvis error:', error);
    return res.status(500).json({ error: 'Agent error', details: error.message });
  }
}
