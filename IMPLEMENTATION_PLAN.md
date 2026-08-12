# Implementation Plan

## Implementation Status

### Complete

| Feature | Location | Notes |
|---------|----------|-------|
| Homepage | `app/page.js` | Public landing page with sign-in gate |
| Clerk Authentication | `proxy.js`, `app/layout.tsx` | Email/pass auth, modal sign-in, route protection |
| Navbar + Footer | `components/Navbar.jsx`, `components/Footer.jsx` | Global layout with auth-aware navigation |
| WebSocket Token Ingestion | `worker.js` | PumpPortal WS → immediate DB insert → DexScreener verification (15s delay, 5 retries, 10s apart) |
| Hybrid Cron Ingestion | `app/api/cron/ingest/route.js` | DexScreener search + Pump.fun enrichment → DB upsert + dead-coin purge (45min, <$3k) |
| SYS Score Calculation | `app/api/scanner/stats/route.js` | 70-point deterministic scoring: market cap, gain, buy/sell ratio, safety |
| Momentum Scanner Feed | `app/scanner/page.jsx` | Live table, 10s auto-refresh, DexScreener + Axiom action links |
| On-Demand AI Analysis | `app/api/scanner/ai-analyze/route.js` | Gemini 1.5 Flash, JSON response mode, 30-point AI score |
| AI Verify Token Pipeline | `app/api/verify-token/route.js` | Dual Gemini analysis (GMGN wallet intel + DEX technical), systematic pre-check |
| Support Ticket System | `app/api/support/create-ticket/`, `app/api/support/my-tickets/` | CRUD with Resend email notifications to admin |
| Help/FAQ Page | `app/help/page.jsx` | Ticket submission form + user ticket tracking |
| Subscription Tiers UI | `app/subscription/page.jsx` | 4 tiers (Free Trial, 1 Month, 12 Months, 24 Months), Solana wallet connect |
| Subscription Metadata Update | `app/api/user/update-subscription/route.js` | Writes `subscriptionTier`, `walletAddress`, `subscriptionExpiry` to Clerk metadata |
| Pro Scanner Hub | `app/proscanner/page.jsx` | Subscription-gated, 8 strategy navigation cards, live feed |
| Pro Scanner Layout | `app/proscanner/layout.jsx` | Sidebar with nav + live token counter, useProAccess gate |
| Pre-Migration Hub | `app/proscanner/pre-migration/page.jsx` | Pump.fun bonding curve candidates, pipeline log expansion |
| Post-Migration Hub | `app/proscanner/post-migration/page.jsx` | Raydium DEX graduated tokens, LP health checks |
| Strategy Detail Page | `app/proscanner/strategy/page.jsx` | Strategy switcher, live log viewer |
| Momentum Dashboard | `app/dashboard/page.jsx` | 8 strategy selectors, AI audit trigger |
| Per-Token Analysis | `app/[address]/page.jsx` | Dynamic route, AI analysis for any token address |
| Pipeline Orchestrator | `app/list/page.jsx` | SSE-based streaming pipeline execution log |
| Live Sidebar Counter | `components/SidebarCounter.jsx` | Real-time token count from Supabase |
| Access Gate Components | `lib/auth.js`, `hooks/useProAccess.js`, `components/RequireSubscription.jsx` | Server, client, and page-level access control |
| Legal Pages | `app/privacy/page.jsx`, `app/terms/page.jsx`, `app/dmca/page.jsx` | Privacy Policy, Terms of Service, DMCA Policy |
| CI/CD Pipeline | `.github/workflows/deploy.yml` | GitHub Actions → SSH to OCI → git pull → build → PM2 reload |
| ESLint + TypeScript Config | `eslint.config.mjs`, `tsconfig.json` | ESLint 9 flat config, Next.js TypeScript plugin |
| Tailwind CSS v4 Setup | `postcss.config.mjs`, `app/globals.css` | CSS-based Tailwind config via `@tailwindcss/postcss` |

### Partial / Mock Implementations

| Feature | Location | Status | What's Missing |
|---------|----------|--------|----------------|
| Post-Migration Route | `app/api/scanner/post-migration/route.js` | Mock data | Uses `Math.random()` for holder concentration, volume continuation, bull flag detection, whale analysis. No real on-chain data. |
| Strategy Log Viewer | `app/proscanner/strategy/page.jsx` | Mock logs | Generates fake evaluation log entries with hardcoded mint address prefixes on a 3-second interval. |
| Momentum Sniper Route | `app/api/scanner/momentum-snipers/route.js` | Reads undefined columns | References ~15 columns (`mint_authority_disabled`, `freeze_authority_disabled`, `creator_holding_pct`, `top10_holding_pct`, `is_blacklisted`, `is_honeypot`, `first_candle_bullish`, `gain_percentage`, `buy_sell_ratio`, `holder_count`, `unique_buyers`, `volume_1m`) that are never written by any ingestion pipeline. |
| Dashboard Strategy View | `app/dashboard/page.jsx` | Hardcoded sample | Only shows a single hardcoded "Sample Token ($SAMPLE)" card. Does not display real data. |
| Pre-Migration Route | `app/api/scanner/pre-migration/route.js` | Reads undefined fields | References `bonding_curve`, `price_change_24h` (as `gain_percentage`) which are populated only for worker.js path, not the cron path. |
| Solana Payment | `app/subscription/page.jsx` | Wallet connect only | Connects Phantom wallet but the actual SOL transfer transaction is not built (`// Note: In production, build and send the web3.js transaction`). |
| Momentum Sidebar | `components/MomentumSidebar.jsx` | UI only | Routes to `/list?params` but the filters don't actually affect the API pipeline. |
| SSE Pipeline | `app/list/page.jsx` | References `/api/pipeline` | The SSE endpoint `/api/pipeline` does not exist in the codebase. |

### Not Implemented / Planned

| Feature | Priority | Notes |
|---------|----------|-------|
| **Schema normalization** | Critical | Merge duplicate columns (`market_cap_usd`/`market_cap`, `image_url`/`uri`, `buys`/`txns_m5_buys`, `price_change_24h`/`price_change_h24` etc.). Standardize both ingestion paths to write to the same columns. |
| **Database migrations** | Critical | Add Prisma or Drizzle ORM with migration files. Currently zero schema-as-code. |
| **Fix `price_change_24h` semantics** | Critical | worker.js stores m5 data in `price_change_24h`. Either rename the column or store correct data. |
| **Real Post-Migration pipeline** | High | Replace `Math.random()` with real Helius RPC calls for holder concentration, volume data, and whale wallet analysis. |
| **Real Momentum Sniper pipeline** | High | Wire up the momentum-snipers route to columns actually populated by ingestion, or implement a Helius/Geyser pipeline for safety checks (mint authority, freeze authority, holder distribution, honeypot detection). |
| **Solana payment transaction** | High | Build and broadcast actual SOL transfer using `@solana/web3.js` from Phantom wallet to treasury address. |
| **`/api/pipeline` SSE endpoint** | High | The orchestrator page at `/list` references this endpoint but it doesn't exist. Needs to be built. |
| **Dashboard real data** | Medium | Replace hardcoded "Sample Token" with real fetched token data. |
| **Strategy-specific filtering** | Medium | Each of the 8 strategies currently uses the same `/api/scanner/stats` endpoint. Build strategy-specific scoring logic. |
| **Environment variable cleanup** | Medium | `Helius_Pixiesly_API` env var exists but Helius is not used anywhere. Remove or integrate. Create `.env.example`. |
| **Hardcoded admin email removal** | Medium | `rajadsinfo@gmail.com` is hardcoded in `lib/auth.js:15` and `hooks/useProAccess.js:14`. Move to env var. |
| **Worker.js CJS migration** | Low | `worker.js` uses CommonJS (`require`) while the rest of the project is ESM (`"type": "module"`). Requires `dotenv` which is already a dependency. Consider migrating to ESM with `--loader` flag or separate tsconfig. |
| **TypeScript migration** | Low | Most route handlers are `.js`/`.jsx`. Migrate to `.ts`/`.tsx` for type safety. |
| **Testing** | Low | No test framework or test files exist. Add Vitest or Jest. |
| **Rate limiting** | Low | No rate limiting on API routes. Add `@upstash/ratelimit` or similar. |
| **API key rotation** | Low | `.env.local` committed to repo? `.gitignore` has `.env*` but `.env.local` was present in the working tree. Verify it's not committed. |
| **Error monitoring** | Low | Add Sentry or similar for production error tracking. |

---

## Recommended Next Steps (Priority Order)

1. **Schema normalization** — Standardize the `tokens_history` columns used by both `worker.js` and the cron route. Eliminate duplicate columns, fix `price_change_24h` semantics, and consolidate on a single set of column names.

2. **Add database migrations** — Install Prisma or Drizzle, introspect the existing schema, and generate migration files tracked in git.

3. **Build real post-migration data** — Replace `Math.random()` with Helius RPC queries for holder distribution, LP health, and whale concentration.

4. **Implement Solana payment** — Add `@solana/web3.js`, build the actual transfer transaction to the treasury wallet, and verify on-chain before updating Clerk metadata.

5. **Build the `/api/pipeline` SSE endpoint** — The orchestrator page is wired but the backend is missing.

6. **Wire momentum-sniper safety checks** — Implement Helius/Geyser queries to populate the ~15 undefined safety columns (mint authority, freeze authority, holder concentration, honeypot detection).

7. **Populate dashboard with real data** — Replace hardcoded sample data with live tokens.

8. **Create `.env.example`** — Document required environment variables without exposing secrets.

9. **Move hardcoded admin email to env var** — Replace `rajadsinfo@gmail.com` with `SUPER_ADMIN_EMAIL` env variable.

10. **Add testing and monitoring** — Set up Vitest, add Sentry error tracking.
