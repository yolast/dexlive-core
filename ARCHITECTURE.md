# DexLive Architecture

## Overview

DexLive is an AI-powered Solana meme coin momentum scanner and quantitative analysis platform. It ingests real-time token minting data from Pump.fun via WebSocket, enriches it with DEXScreener and Pump.fun REST APIs, scores tokens with systematic and AI (Gemini) filters, and presents results in a subscription-gated Next.js dashboard.

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + Supabase (Postgres) + Clerk Auth + Google Gemini AI + Resend Email

---

## System Components

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL DATA SOURCES                          │
│                                                                          │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                 │
│  │ PumpPortal   │   │ DexScreener  │   │  Pump.fun    │                 │
│  │ WebSocket    │   │ REST API     │   │  REST API    │                 │
│  │ (new mints)  │   │ (pair data)  │   │ (pre-DEX)    │                 │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘                 │
│         │                  │                  │                          │
└─────────┼──────────────────┼──────────────────┼──────────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        DATA INGESTION LAYER                              │
│                                                                          │
│  ┌──────────────────────┐       ┌──────────────────────────────────┐    │
│  │    worker.js          │       │  app/api/cron/ingest/route.js     │    │
│  │  (Standalone process) │       │  (HTTP cron endpoint)              │    │
│  │                       │       │                                    │    │
│  │  WebSocket → DB       │       │  DexScreener search → Pump.fun    │    │
│  │  DexScreener poll     │       │  Hybrid enrichment → DB upsert    │    │
│  │  (per-token, 15s      │       │  Dead-coin purge (45min, <$3k)    │    │
│  │   delay, 5 retries)   │       │                                    │    │
│  └──────────┬───────────┘       └──────────────┬───────────────────┘    │
│             │                                   │                        │
└─────────────┼───────────────────────────────────┼────────────────────────┘
              │                                   │
              ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        DATABASE (Supabase Postgres)                       │
│                                                                          │
│  ┌────────────────────┐   ┌──────────────────────┐                      │
│  │  tokens_history     │   │  support_tickets      │                      │
│  │  (primary table)    │   │  (help desk)           │                      │
│  └─────────┬───────────┘   └──────────────────────┘                      │
│            │                                                              │
└────────────┼──────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API LAYER (Next.js Route Handlers)                │
│                                                                          │
│  GET  /api/scanner/stats             → Dashboard stats + scored tokens   │
│  GET  /api/scanner/momentum-snipers  → Real-time sniper scoring (>90)    │
│  GET  /api/scanner/pre-migration     → Pump.fun bonding curve tokens     │
│  GET  /api/scanner/post-migration    → Raydium graduated tokens          │
│  POST /api/scanner/ai-analyze        → Gemini AI on-demand per token     │
│  POST /api/verify-token              → Dual Gemini analysis (GMGN+DEX)   │
│  POST /api/support/create-ticket     → Submit support ticket + email     │
│  GET  /api/support/my-tickets        → Fetch user's tickets              │
│  POST /api/user/update-subscription  → Update Clerk subscription metadata│
│                                                                          │
└─────────────┬───────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION LAYER                              │
│                                                                          │
│  proxy.js (Clerk middleware)                                              │
│  ├─ Public: /, /api/cron/ingest, /api/support/*, /subscription, etc.    │
│  └─ Protected: /proscanner/*, /scanner/*, /list/*, /api/pipeline/*       │
│                                                                          │
│  hooks/useProAccess.js (client-side gate)                                │
│  lib/auth.js (server-side gate)                                          │
│  components/RequireSubscription.jsx (page-level gate)                    │
│                                                                          │
│  Subscription tiers stored in Clerk user publicMetadata:                 │
│    { subscriptionTier, walletAddress, subscriptionExpiry }               │
│                                                                          │
└─────────────┬───────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         PRESENTATION LAYER                                │
│                                                                          │
│  Pages (App Router):                                                     │
│  ├─ / (homepage, public)                                                 │
│  ├─ /scanner (live momentum feed, 10s auto-refresh)                      │
│  ├─ /proscanner (subscription-gated hub with sidebar)                    │
│  │   ├─ /proscanner/pre-migration (Pump.fun bonding curve hub)           │
│  │   ├─ /proscanner/post-migration (Raydium DEX hub)                     │
│  │   └─ /proscanner/strategy (strategy log viewer)                       │
│  ├─ /dashboard (momentum suite with AI audits)                           │
│  ├─ /list (SSE-based pipeline orchestrator)                              │
│  ├─ /subscription (Solana wallet payment tiers)                          │
│  ├─ /help (support tickets + FAQ)                                        │
│  ├─ /[address] (per-token AI analysis page)                              │
│  ├─ /privacy, /terms, /dmca (legal pages)                                │
│                                                                          │
│  Shared Components:                                                      │
│  ├─ Navbar (Clerk sign-in/out, navigation)                               │
│  ├─ Footer (legal links)                                                 │
│  ├─ SidebarCounter (live token count)                                    │
│  ├─ MomentumSidebar (filter config drawer)                               │
│  ├─ VerificationReportCard (AI audit slide-over)                         │
│  └─ RequireSubscription (page-level access gate)                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Token Lifecycle

```
1. MINT DETECTED
   PumpPortal WebSocket → worker.js receives { mint }
   └─> INSERT tokens_history (mint, is_verified=false, is_active=false)

2. DEXSCREENER VERIFICATION (15s delay)
   worker.js polls DexScreener /tokens/{mint} (up to 5 retries, 10s apart)
   ├─ PASS: Market cap $3k-$500k + ≥10 buys → UPDATE tokens_history
   │   (name, symbol, market_cap_usd, price_change, buys, sells, volume,
   │    is_verified=true, is_active=true)
   └─ FAIL: Token doesn't appear or filtered out → no update, token stays unverified

3. HYBRID CRON INGEST (alternative path)
   GET /api/cron/ingest
   ├─ Queries DexScreener /search?q=pump for all Solana pairs
   ├─ For each pair, fetches Pump.fun /coins/{mint} for pre-DEX data
   ├─ Calculates time_to_index_ms (DEX creation - Pump.fun creation)
   └─ UPSERT tokens_history with full hybrid payload

4. DEAD COIN PURGE
   Ingest route deletes tokens where:
   └─ dex_indexed_timestamp < 45min ago AND market_cap < $3,000

5. FRONTEND SCORING & DISPLAY
   /api/scanner/stats:
   ├─ Fetches verified + active tokens (today)
   ├─ Calculates SYS score (70-point scale): MC, gain, buy/sell ratio, safety
   ├─ Filters to score ≥50, sorts descending, slices top 20
   └─ Returns to frontend for 10s auto-refresh table

6. AI DEEP SCAN (on-demand)
   User clicks "Run AI" → POST /api/scanner/ai-analyze
   ├─ Fetches token data from Supabase
   ├─ Sends to Gemini 1.5 Flash (JSON mode)
   ├─ Returns ai_score (0-30) + reasoning
   └─ Saves back to tokens_history (ai_score, ai_reasoning, ai_analyzed_at)
```

---

## Scoring Systems

### SYS Score (Deterministic, 70-point max)

Calculated in `/api/scanner/stats` via `calculateSysScore()`:

| Criteria | Points | Condition |
|----------|--------|-----------|
| Rug Penalty | Instant elimination | gain ≤ 0 OR buy/sell ratio < 0.8 |
| Market Cap | 5-15 | $1k-$4k (5), $4k-$150k (15), $150k-$500k (10) |
| Momentum/Gain | 5-15 | 0-20% (5), 20-50% (10), ≥50% (15) |
| Buy/Sell Ratio | 10-20 | ≥1.0 (10), ≥1.2 (20) |
| Base Safety | 20 | Passed valid coin checkpoint |

### Momentum Sniper Score (120-point max)

Used in `/api/scanner/momentum-snipers`. Requires score >90.

### AI Score (Gemini, 0-30)

Two-criteria evaluation:
1. Wash-Trading/Bot Detection (0-15)
2. Smart Money Conviction (0-15)

---

## Deployment

**Target:** Oracle Cloud Infrastructure (OCI) VM  
**Process Manager:** PM2 (manages `dexlive` Next.js app + `worker` standalone process)  
**CI/CD:** GitHub Actions → SSH into OCI, `git pull`, `npm ci`, `npm run build`, `pm2 reload`  

```
.github/workflows/deploy.yml:
  push to main → SSH to OCI host
    → cd ~/dexlive
    → git fetch origin main && git reset --hard origin/main
    → npm ci --prefer-offline && npm run build
    → pm2 reload dexlive || pm2 restart dexlive
    → pm2 restart worker
    → pm2 save
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google Gemini AI for token analysis |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk client-side auth |
| `CLERK_SECRET_KEY` | Clerk server-side auth |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (admin) key |
| `RESEND_API_KEY` | Resend email delivery |
| `ADMIN_EMAIL` | Admin notification email |
| `Helius_Pixiesly_API` | Helius RPC API key (unused in current code) |

---

## Key External Dependencies

| Service | Usage |
|---------|-------|
| PumpPortal WebSocket | Real-time new token mint detection |
| DexScreener API | Token pair data, OHLCV, transactions |
| Pump.fun API | Pre-DEX metadata (bonding curve, dev holding, migration status) |
| Clerk | User authentication, session management, metadata storage |
| Supabase | Cloud Postgres database |
| Google Gemini | AI analysis of token telemetry |
| Resend | Email notifications for support tickets |

---

## Known Architecture Issues

1. **`price_change_24h` field misuse:** `worker.js` stores m5 price change data in `price_change_24h` column. The field name does not match its actual content.

2. **Dual ingestion paths:** `worker.js` (WebSocket) and `app/api/cron/ingest` (HTTP cron) both write to `tokens_history` with overlapping but different schemas. `worker.js` uses `market_cap_usd`, `uri`, `buys`, `sells`, `volume` while the cron route uses `market_cap`, `image_url`, `txns_m5_buys`, `txns_m5_sells`, `volume_m5`, etc. These are different column sets.

3. **No database schema migrations:** All tables are created/managed directly in the Supabase dashboard with no migration files or schema-as-code.

4. **Hardcoded super admin:** Both `lib/auth.js:15` and `hooks/useProAccess.js:14` contain the hardcoded email `rajadsinfo@gmail.com`.

5. **Mock data in production paths:** `/api/scanner/post-migration` generates random values for `holder_concentration`, `volume_continuation`, `bullFlagDetected`, and `whaleClean` rather than reading real on-chain data.
