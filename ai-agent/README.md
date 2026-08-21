# Gold Sniper AI Agent

AI-powered trading assistant deployed on Vercel, powered by Groq LLM + Supabase.

## Features
- 10 skills: Live Price, Active Trades, Trade History, AI Patterns, Alerts, Engine Status, Market Analysis, Trade Performance, WhatsApp Send, Memory Store
- Streaming responses via Groq API
- Password-protected (token auth)
- Real-time Supabase data integration
- Conversation memory persistence

## Tech Stack
- **LLM:** Groq GPT-OSS-120B
- **Backend:** Vercel Serverless Functions
- **Database:** Supabase (PostgreSQL)
- **Auth:** Token-based (X-Auth-Token header)

## Environment Variables
- GROQ_API_KEY
- AGENT_AUTH_TOKEN
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

## Deploy
```bash
cd ai-agent
vercel --prod
```
