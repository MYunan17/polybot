# polymarket-mirofish-bot

Production-oriented TypeScript + Node.js Polymarket research/calibration/guarded-execution bot for low-memory Ubuntu VPS (2 GB RAM).

## Safety First
- Default mode is `DRY_RUN=true`.
- No live order is placed unless `DRY_RUN=false`.
- High ambiguity markets are skipped.
- Wide spread / low edge / missing token ID are skipped.
- OpenClaw health failure blocks live trading.

Prediction markets involve financial risk. Use at your own risk.

## Architecture
- Node.js 20+ + TypeScript
- PM2 process scheduler
- Docker Compose for MiroFish
- DeepSeek V3 via MiroFish
- Zep Cloud memory (SQLite remains source of truth)
- Polymarket Gamma + CLOB orderbook
- OpenClaw execution adapter
- Telegram alerts
- SQLite local persistence

## Ubuntu VPS Setup
1. Install Node.js 20:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```
2. Install PM2:
```bash
sudo npm i -g pm2
```
3. Install Docker:
```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
```
4. Clone this project to `/root/polymarket-mirofish/`.

## MiroFish Setup
```bash
cd /root/polymarket-mirofish
git clone https://github.com/666ghj/MiroFish
cp MiroFish/.env.example MiroFish/.env
```
Set `MiroFish/.env` with:
- `DEEPSEEK_API_KEY=...`
- `ZEP_API_KEY=...` (if required by your MiroFish config)

Then run:
```bash
docker compose up -d
```

Healthcheck:
```bash
curl -f http://localhost:5001/health
```
Confirm port mapping:
```bash
ss -ltnp | grep 5001
```

Debug MiroFish adapter from this bot repo:
```bash
npm run debug:mirofish
```
Interpretation:
- If reachable and compatible, output includes parsed `rawProbability` and `rawConfidenceScore`.
- If unreachable, script exits gracefully with setup instructions.
- If reachable but payload/route mismatched, script prints raw response and parse failure reason.

## Bot Setup
```bash
cd /root/polymarket-mirofish
cp .env.example .env
npm install
npm run build
```

## Required .env
Configure API keys and addresses in `.env`. Keep:
- `DRY_RUN=true` for first runs.
- `CONCURRENCY=1` on 2 GB RAM.
- `ENABLE_MIROFISH=false` for Phase 1-only flow, then enable later.

## Run Commands
- Dry run:
```bash
npm run dry-run
```
- Scanner:
```bash
npm run scanner
```
- DB inspect:
```bash
npm run inspect-db
```
- Telegram test:
```bash
npm run telegram-test
```
- OpenClaw healthcheck:
```bash
npm run openclaw-health
```
- MiroFish healthcheck:
```bash
npm run mirofish-health
```

## PM2
```bash
npm run build
pm2 start ecosystem.config.js
pm2 logs polymarket-mirofish-bot
pm2 save
```

## VPS Deployment - DRY_RUN only
This deployment profile is for Ubuntu VPS (2 GB RAM) with research and paper-flow only.

Live execution is not implemented/enabled in this setup. Keep `DRY_RUN=true`.

1. Provision Node.js 20:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```
2. Install project deps and build:
```bash
cd /root/polymarket-mirofish
cp .env.production.example .env
npm install
npm run typecheck
npm run build
```
3. Ensure SQLite data directory exists:
```bash
mkdir -p /root/polymarket-mirofish/data
```
4. Install PM2:
```bash
sudo npm i -g pm2
```
5. Install Docker:
```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
```
6. Clone and configure MiroFish:
```bash
cd /root/polymarket-mirofish
git clone https://github.com/666ghj/MiroFish
cp MiroFish/.env.example MiroFish/.env
```
Set MiroFish keys in `MiroFish/.env` (`DEEPSEEK_API_KEY`, optional `ZEP_API_KEY`), then:
```bash
docker compose up -d
```

Dry-run health and cycle checks:
```bash
npm run health
npm run full-dry-cycle
```

`full-dry-cycle` runs: `dry-run` -> `seed` -> `mirofish` -> `paper`, and continues even if a step fails. It never executes trades.

PM2 scheduled dry-run only example:
```bash
pm2 start "npm run full-dry-cycle" --name polymarket-dry-cycle --cron "0 */6 * * *"
pm2 logs polymarket-dry-cycle
pm2 save
```

## SQLite
DB file default: `./data/polymarket-bot.sqlite`.

Inspect manually:
```bash
sqlite3 ./data/polymarket-bot.sqlite ".tables"
sqlite3 ./data/polymarket-bot.sqlite "select count(*) from markets;"
```

## Enable Live Trading Safely
1. Verify at least several days of dry-run logs.
2. Verify risk rejections/approvals are sane.
3. Set `DRY_RUN=false`.
4. Keep conservative sizes and exposure limits.
5. Monitor Telegram and PM2 logs continuously.

## Development Phases
- Phase 1: config/log/db/scanner/telegram summary.
- Phase 2: evidence/rules/bull-bear seed.
- Phase 3: MiroFish integration.
- Phase 4: calibration + edge judgment.
- Phase 5: strict risk + OpenClaw execution.
- Phase 6: monitoring + calibration feedback loop.
