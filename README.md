# Gold Sniper

EMA 9/21 crossover gold trading system with ATR-based SL/TP levels across 5 timeframes (1M, 5M, 15M, 1H, 4H).

## Components

- `backend-functions/xauMonitor.ts` — 24/7 monitoring: fetches gold prices, detects EMA crossovers, checks TP/SL hits
- `backend-functions/getLivePrice.ts` — Live price endpoint for dashboard polling
- `backend-functions/dashboard.ts` — Serves the Gold Sniper dashboard HTML
- `backend-functions/sendEntryAlert.ts` — Receives alerts and saves to Alert entity
- `backend-functions/backupToDrive.ts` — Auto-backup to Google Drive every 6 hours
- `dashboard/gold_sniper.html` — Offline-capable dashboard with live price feed
- `apk/assets/dashboard.html` — APK-bundled offline dashboard

## Architecture

- **Monitor**: Scheduled every 5 min, fetches Yahoo Finance gold prices, checks EMA 9/21 crossover with 5-candle lookback
- **Alerts**: Entity-triggered workflow sends WhatsApp messages on entry/TP/SL/cycle completion
- **Dashboard**: Polls getLivePrice every 5 seconds for real-time price + active trades
- **Backup**: Google Drive auto-backup every 6 hours (Alert + TradingState entities)
- **APK**: Signed Android app with bundled offline dashboard

## Tech Stack

- Base44 backend (Deno/TypeScript)
- Yahoo Finance API for gold prices
- WhatsApp for alert delivery
- Google Drive for backups
- GitHub for version control
