# 🎯 Gold Sniper

EMA 9/21 crossover gold trading system with ATR-based SL/TP levels across 5 timeframes (1M, 5M, 15M, 1H, 4H).

## 🔴 Live Dashboard

**[https://shubhampawar3752-26yr.github.io/gold-sniper/](https://shubhampawar3752-26yr.github.io/gold-sniper/)**

Real-time gold price, active trades, and TP progress — polls Supabase every 5 seconds.

## Architecture

- **Monitor**: pg_cron runs `xau-monitor` every 5 min — fetches Yahoo Finance gold prices, detects EMA 9/21 crossovers with 5-candle lookback
- **Alerts**: Database trigger on `alerts` table → `send-whatsapp-alert` edge function → WhatsApp delivery
- **Dashboard**: `index.html` polls `get-live-price` endpoint every 5s for real-time price + active trades
- **Backup**: pg_cron runs `backup-to-drive` every 6 hours — exports to Google Drive
- **Hosting**: GitHub Pages (this repo) + Supabase Edge Functions

## Supabase Edge Functions

| Function | Purpose |
|----------|---------|
| `xau-monitor` | 24/7 monitoring: price fetch, EMA crossover detection, TP/SL checks |
| `get-live-price` | Live price endpoint for dashboard polling |
| `dashboard` | Alternate dashboard served from Supabase |
| `send-whatsapp-alert` | WhatsApp alert delivery via Base44 Agent API |
| `backup-to-drive` | Google Drive auto-backup every 6 hours |

## Tech Stack

- Supabase (Postgres, Edge Functions, pg_cron, pg_net)
- Yahoo Finance API for gold prices
- WhatsApp for alert delivery
- Google Drive for backups
- GitHub Pages for dashboard hosting

## Dashboard Features

- Live gold price with up/down flash animation
- Active trade cards with entry, SL, ATR, and TP progress
- TP progress bars (0-100%)
- Market state indicator (OPEN/CLOSED)
- Feed status badge (LIVE/OFFLINE)
- Auto-refresh every 5 seconds
- Mobile responsive
