# Database Schema

## Provider: Supabase (Cloud Postgres)

All tables reside in a single Supabase project. There are no local DDL files or migration scripts; the schema is managed via the Supabase dashboard.

---

## Table: `tokens_history`

Primary store for all token data. Two ingestion paths write to this table with overlapping but different column subsets:

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `mint` | `text` | Both | **Primary key.** Solana token mint address. |
| `name` | `text` | Both | Token name (e.g. "DogWifHat"). |
| `symbol` | `text` | Both | Token ticker symbol (e.g. "WIF"). |
| `is_verified` | `boolean` | worker.js | Whether DexScreener confirmed the token (default `false`). |
| `is_active` | `boolean` | worker.js | Whether token passed checkpoint filters (default `false`). |

### Financial & Market Data

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `market_cap_usd` | `numeric` | worker.js | Market cap in USD (from DexScreener `pair.fdv` or `pair.marketCap`). |
| `market_cap` | `numeric` | cron route | Market cap in USD (from DexScreener `pair.marketCap`). |
| `fdv` | `numeric` | cron route | Fully diluted valuation. |
| `liquidity_usd` | `numeric` | cron route | Liquidity in USD. |

### Price Changes (%) - From cron route (DexScreener)

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `price_change_m5` | `numeric` | cron route | 5-minute price change %. |
| `price_change_h1` | `numeric` | cron route | 1-hour price change %. |
| `price_change_h24` | `numeric` | Both | **Misleading name.** worker.js stores m5 change here. Cron route stores actual h24 change. |
| `price_change_24h` | `numeric` | worker.js | Alias for m5 price change (used in stats scoring). |

### Trading Volume (USD) - From cron route (DexScreener)

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `volume_m5` | `numeric` | cron route | 5-minute volume in USD. |
| `volume_h1` | `numeric` | cron route | 1-hour volume in USD. |
| `volume_h24` | `numeric` | cron route | 24-hour volume in USD. |
| `volume` | `numeric` | worker.js | 5-minute volume in USD. |

### Transaction Counts (Buy/Sell Pressure) - From cron route (DexScreener)

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `txns_m5_buys` | `numeric` | cron route | 5-minute buy transactions. |
| `txns_m5_sells` | `numeric` | cron route | 5-minute sell transactions. |
| `txns_h1_buys` | `numeric` | cron route | 1-hour buy transactions. |
| `txns_h1_sells` | `numeric` | cron route | 1-hour sell transactions. |
| `txns_h24_buys` | `numeric` | cron route | 24-hour buy transactions. |
| `txns_h24_sells` | `numeric` | cron route | 24-hour sell transactions. |
| `buys` | `numeric` | worker.js | Number of buys (m5 equivalent, used in scoring). |
| `sells` | `numeric` | worker.js | Number of sells (m5 equivalent, used in scoring). |

### Metadata & Links

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `image_url` | `text` | cron route | Token image URL from DexScreener. |
| `uri` | `text` | worker.js | Token image URL (stored as `uri` by worker). |
| `dex_url` | `text` | cron route | DexScreener pair URL. |

### Timeline Data - From cron route (Hybrid Pipeline)

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `dex_indexed_timestamp` | `bigint` | cron route | Unix ms when DEXScreener first indexed the pair (`pairCreatedAt`). |
| `pump_created_timestamp` | `bigint` | cron route | Unix ms when Pump.fun created the token. |
| `time_to_index_ms` | `bigint` | cron route | Duration from Pump.fun creation to DEXScreener indexing (velocity metric). |

### Pre-DEX Analytics - From cron route (Pump.fun API)

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `bonding_curve_progress` | `numeric` | cron route | Bonding curve completion %. 0-100, or 100 if migrated to Raydium. |
| `dev_holding_percent` | `numeric` | cron route | Developer/creator holding percentage. |
| `is_migrated_raydium` | `boolean` | cron route | Whether the token has graduated to Raydium. |

### Scoring & Analysis

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `sys_score` | `numeric` | stats route | Pre-computed systematic score (0-70). |
| `ai_score` | `numeric` | ai-analyze route | Gemini AI score (0-30). |
| `ai_reasoning` | `text` | ai-analyze route | One-sentence AI risk thesis. |
| `ai_analyzed_at` | `timestamptz` | ai-analyze route | Timestamp when AI analysis was performed. |

### Verification Reports - From verify-token route

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `verification_status` | `text` | verify-token route | Set to `'VERIFIED'` after AI audit completes. |
| `gmgn_report` | `jsonb` | verify-token route | GMGN wallet intelligence AI report. |
| `dex_report` | `jsonb` | verify-token route | DEX technical AI report. |

### Timestamps

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `created_at` | `timestamptz` | Supabase default | Row creation time (auto). |
| `created_timestamp` | `bigint` | Both | Custom timestamp field (referenced in queries). |

### Miscellaneous (Referenced in code but origin unclear)

| Column | Type | Description |
|--------|------|-------------|
| `raw_payload` | `jsonb`? | Referenced in verify-token route. Raw token data. |
| `mint_authority_disabled` | `boolean` | Referenced in momentum-snipers safety filter. |
| `freeze_authority_disabled` | `boolean` | Referenced in momentum-snipers safety filter. |
| `creator_holding_pct` | `numeric` | Referenced in momentum-snipers safety filter. |
| `top10_holding_pct` | `numeric` | Referenced in momentum-snipers safety filter. |
| `is_blacklisted` | `boolean` | Referenced in momentum-snipers safety filter. |
| `is_honeypot` | `boolean` | Referenced in momentum-snipers safety filter. |
| `gain_percentage` | `numeric` | Referenced in momentum-snipers scoring. |
| `buy_sell_ratio` | `numeric` | Referenced in momentum-snipers scoring. |
| `volume_1m` | `numeric` | Referenced in momentum-snipers scoring. |
| `holder_count` | `numeric` | Referenced in momentum-snipers scoring. |
| `unique_buyers` | `numeric` | Referenced in momentum-snipers scoring. |
| `first_candle_bullish` | `boolean` | Referenced in momentum-snipers scoring. |
| `bonding_curve` | `numeric` | Referenced in post-migration route. |

> **Note:** The columns in the "Miscellaneous" section are referenced in API route handlers but are never written by either `worker.js` or the cron ingest route. They may have been added directly via the Supabase dashboard or represent fields planned for future ingestion pipelines.

---

## Table: `support_tickets`

Stores user-submitted help desk tickets.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `serial` / `uuid` | Primary key, auto-generated. |
| `user_id` | `text` | Clerk user ID (nullable for guest submissions). |
| `email` | `text` | Submitter's email address. |
| `guest_email` | `text` | Email for non-authenticated submitters. |
| `wallet_address` | `text` | Connected wallet address (or `"Not Connected"`). |
| `subject` | `text` | Ticket subject line. |
| `message` | `text` | Full ticket body. |
| `category` | `text` | One of: `Technical`, `Billing`, `General`, `Partnership`. Default: `"General"`. |
| `status` | `text` | Ticket status. Known values: `"open"`. |
| `admin_reply` | `text` | Admin response (displayed in ticket view). |
| `created_at` | `timestamptz` | Auto-generated creation timestamp. |

---

## Indexes & Constraints

- **`tokens_history.mint`**: Primary key (unique token address).
- **`tokens_history.created_at`**: Referenced in date-range queries (`gte("created_at", todayStartISO)`).
- **`tokens_history.dex_indexed_timestamp`**: Used in dead-coin purge queries.
- **`tokens_history.is_verified` / `is_active`**: Used as filter columns in stats queries.
- **`support_tickets.user_id`**: Used for user-specific ticket lookups.

---

## Schema Concerns

1. **Column duplication:** `market_cap_usd` vs `market_cap`, `image_url` vs `uri`, `volume` vs `volume_m5`, `buys`/`sells` vs `txns_m5_buys`/`txns_m5_sells`, `price_change_24h` vs `price_change_h24`. The two ingestion paths write to different columns for the same conceptual data.

2. **`price_change_24h` semantic error:** `worker.js` stores m5 (5-minute) price change data in a column named `price_change_24h`. This column is then read as-if it were 24-hour data by the stats scoring route.

3. **Undefined columns:** ~15 columns are read by API routes but never written by any ingestion code. These appear to be manually created columns for future or external data pipelines.

4. **No foreign keys or relationships:** The database has no defined relationships between tables.

5. **No schema versioning:** There is no migration system. Schema changes happen directly in the Supabase dashboard and are not tracked in the repository.
