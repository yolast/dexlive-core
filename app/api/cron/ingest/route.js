import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";
import WebSocket from "ws";

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

// Cache of columns that actually exist on the table (production schema differs
// from the full hybrid schema — writing a missing column fails the whole upsert)
let existingColumns = null;

async function getExistingColumns() {
  if (existingColumns) return existingColumns;
  const { data } = await supabase.from('tokens_history').select('*').limit(1);
  if (data && data[0]) {
    existingColumns = new Set(Object.keys(data[0]));
    console.log(`✅ tokens_history columns detected (${existingColumns.size}):`, [...existingColumns].join(', '));
  } else {
    // Empty table — fall back to the minimal safe set
    existingColumns = new Set(['mint', 'name', 'symbol', 'is_verified', 'is_active',
      'market_cap_usd', 'price_change_24h', 'buys', 'sells', 'volume', 'uri',
      'created_at', 'last_seen_at', 'dex_indexed_timestamp']);
  }
  return existingColumns;
}

// Only keep payload keys that exist as columns in the table
function sanitizePayload(payload, columns) {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => columns.has(key)));
}

// Fetch fresh Solana pairs from several DexScreener queries, deduped by mint.
// (q=pump alone returns mostly tokens literally named "PUMP" — too narrow.)
async function fetchFreshPairs() {
  const terms = ['pump', 'raydium'];
  const byMint = new Map();
  for (const term of terms) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${term}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        cache: 'no-store'
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const p of (data.pairs || [])) {
        if (p.chainId !== 'solana' || !p.baseToken?.address) continue;
        const addr = p.baseToken.address;
        const existing = byMint.get(addr);
        const hasTxns = (p.txns?.m5?.buys || 0) > 0 || (p.txns?.h24?.buys || 0) > 0;
        const existingHasTxns = existing && ((existing.txns?.m5?.buys || 0) > 0 || (existing.txns?.h24?.buys || 0) > 0);
        if (!existing || (hasTxns && !existingHasTxns)) byMint.set(addr, p);
      }
    } catch (_) { /* skip failed query */ }
  }
  return [...byMint.values()];
}

export async function GET(req) {
  try {
    console.log("🔄 Hybrid Pipeline started at:", new Date().toISOString());
    let insertedCount = 0;
    let failedCount = 0;

    const columns = await getExistingColumns();
    const nowISO = new Date().toISOString();

    // STEP 1: Fetch the core live market data from DEXScreener
    const pairs = await fetchFreshPairs();
    console.log(`Search returned ${pairs.length} unique Solana pairs`);

    for (const pair of pairs) {
      if (pair.chainId !== 'solana') continue;

      const mintAddress = pair.baseToken?.address;
      if (!mintAddress) continue;

      const dexIndexedTimestamp = pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now();
      // dex_indexed_timestamp is TIMESTAMPTZ in production — must write ISO, not epoch ms
      const dexIndexedISO = new Date(dexIndexedTimestamp).toISOString();

      // NOTE: pump.fun per-coin enrichment is skipped — its columns
      // (pump_created_timestamp, bonding_curve_progress, ...) don't exist
      // in the production table and are dropped by sanitization. Skipping
      // keeps the pipeline fast.

      // Prefer m5 (live) but fall back to h24/h1 so values are never wiped to 0
      const m5PriceChange = Number(pair.priceChange?.m5 || 0);
      const h24PriceChange = Number(pair.priceChange?.h24 || 0);
      const m5Buys = Number(pair.txns?.m5?.buys || 0);
      const h24Buys = Number(pair.txns?.h24?.buys || 0);
      const h1Buys = Number(pair.txns?.h1?.buys || 0);
      const m5Sells = Number(pair.txns?.m5?.sells || 0);
      const h24Sells = Number(pair.txns?.h24?.sells || 0);
      const h1Sells = Number(pair.txns?.h1?.sells || 0);
      const m5Volume = Number(pair.volume?.m5 || 0);
      const h24Volume = Number(pair.volume?.h24 || 0);
      const h1Volume = Number(pair.volume?.h1 || 0);

      const buys = m5Buys > 0 ? m5Buys : (h1Buys > 0 ? h1Buys : h24Buys);
      const sells = m5Sells > 0 ? m5Sells : (h1Sells > 0 ? h1Sells : h24Sells);
      const volume = m5Volume > 0 ? m5Volume : (h1Volume > 0 ? h1Volume : h24Volume);

      const mc = Number(pair.fdv || pair.marketCap || 0);
      // Funnel semantics:
      //  is_verified = true  → the coin IS listed on DexScreener (we found it there)
      //  is_active   = true  → it passes the basic early-entry checkpoints
      //                       (market cap range + real buy activity)
      const passesCheckpoints = mc >= 3000 && mc <= 2000000 && buys > 0;

      const payload = {
        mint: mintAddress,
        name: pair.baseToken?.name || "Unknown",
        symbol: pair.baseToken?.symbol || "MEME",
        is_verified: true,
        is_active: passesCheckpoints,

        market_cap_usd: mc,
        fdv: Number(pair.fdv || 0),
        liquidity_usd: Number(pair.liquidity?.usd || 0),

        price_change_m5: m5PriceChange,
        price_change_h1: Number(pair.priceChange?.h1 || 0),
        price_change_h24: h24PriceChange,
        price_change_24h: h24PriceChange || m5PriceChange,

        volume_m5: m5Volume,
        volume_h1: h1Volume,
        volume_h24: h24Volume,
        volume,

        txns_m5_buys: m5Buys,
        txns_m5_sells: m5Sells,
        txns_h1_buys: h1Buys,
        txns_h1_sells: h1Sells,
        txns_h24_buys: h24Buys,
        txns_h24_sells: h24Sells,
        buys,
        sells,

        image_url: pair.info?.imageUrl || null,
        uri: pair.info?.imageUrl || null,
        dex_url: pair.url || `https://dexscreener.com/solana/${mintAddress}`,

        dex_indexed_timestamp: dexIndexedISO,

        last_seen_at: nowISO
      };

      const cleanPayload = sanitizePayload(payload, columns);

      const { error: upsertError } = await supabase
        .from('tokens_history')
        .upsert(cleanPayload, { onConflict: 'mint' });

      if (!upsertError) insertedCount++;
      else {
        failedCount++;
        if (failedCount <= 3) console.error(`Upsert error for ${mintAddress}:`, upsertError.message);
      }
    }

    // STEP 5: Dead-Coin Purge (Market Cap < $3k AND older than 45 mins)
    const cutoffTimeMs = Date.now() - (45 * 60 * 1000);
    const { error: deleteError } = await supabase
      .from('tokens_history')
      .delete()
      .lt('dex_indexed_timestamp', new Date(cutoffTimeMs).toISOString())
      .lt('market_cap_usd', 3000);

    if (deleteError) console.warn("Cleanup warning:", deleteError.message);

    console.log(`✅ Hybrid Pipeline Complete: Synced ${insertedCount}, failed ${failedCount} tokens.`);

    return NextResponse.json({
      success: true,
      message: `Successfully ingested/synced ${insertedCount} tokens.`,
      failed: failedCount,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("Hybrid Ingestion Error:", err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Real-time new-mint listener (PumpPortal WebSocket).
// New Pump.fun coins are inserted instantly, feeding the "Today Coins
// Ingested" counter even if the separate PM2 worker is down.
// ─────────────────────────────────────────────────────────────────────────
const PUMP_PORTAL_WS = 'wss://pumpportal.fun/api/data';

function startPumpPortalListener() {
  if (globalThis.__dexliveWsStarted) return;
  globalThis.__dexliveWsStarted = true;

  const connect = () => {
    const ws = new WebSocket(PUMP_PORTAL_WS);

    ws.on('open', () => {
      console.log('🟢 [Bg] PumpPortal WS connected — listening for new mints');
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    });

    ws.on('error', (err) => {
      console.error('🔴 [Bg] PumpPortal WS error:', err.message || err);
    });

    ws.on('message', async (data) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.mint) {
          const { error } = await supabase.from('tokens_history').insert([
            { mint: parsed.mint, is_verified: false, is_active: false }
          ]);
          if (error && !error.message.includes('duplicate')) {
            console.error(`[Bg] Insert error for ${parsed.mint}:`, error.message);
          }
        }
      } catch (err) {
        // non-JSON keepalive frames etc.
      }
    });

    ws.on('close', () => {
      console.log('🔴 [Bg] PumpPortal WS closed — reconnecting in 5s');
      setTimeout(connect, 5000);
    });
  };

  connect();
}

// ─────────────────────────────────────────────────────────────────────────
// Verification sweep: take recent unverified mints and check them against
// DexScreener so they advance through the funnel (verified -> active).
// Runs alongside the batch on the background interval.
// ─────────────────────────────────────────────────────────────────────────
async function verifyRecentMints() {
  try {
    const columns = await getExistingColumns();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: mints, error } = await supabase
      .from('tokens_history')
      .select('mint')
      .eq('is_verified', false)
      .gte('created_at', dayAgo)
      .order('created_at', { ascending: false })
      .limit(15);

    if (error) return;
    if (!mints || mints.length === 0) return;

    for (const { mint } of mints) {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          cache: 'no-store',
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) continue;
        const data = await res.json();
        const pair = (data.pairs || []).find((p) => p.chainId === 'solana');
        if (!pair) continue;

        const mc = Number(pair.fdv || pair.marketCap || 0);
        const m5Buys = Number(pair.txns?.m5?.buys || 0);
        const buys = m5Buys || Number(pair.txns?.h24?.buys || 0);
        const sells = Number(pair.txns?.m5?.sells || 0) || Number(pair.txns?.h24?.sells || 0);
        const volume = Number(pair.volume?.m5 || 0) || Number(pair.volume?.h24 || 0);
        const passes = mc >= 3000 && mc <= 2000000 && buys > 0;

        const update = sanitizePayload({
          is_verified: true,
          is_active: passes,
          name: pair.baseToken?.name || 'Unknown',
          symbol: pair.baseToken?.symbol || 'MEME',
          market_cap_usd: mc,
          price_change_24h: Number(pair.priceChange?.h24 || 0) || Number(pair.priceChange?.m5 || 0),
          buys,
          sells,
          volume,
          uri: pair.info?.imageUrl || null,
          dex_indexed_timestamp: new Date(pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now()).toISOString(),
          last_seen_at: new Date().toISOString()
        }, columns);

        await supabase.from('tokens_history').update(update).eq('mint', mint);
      } catch (err) {
        // per-mint failures are non-fatal
      }
    }
  } catch (err) {
    console.error('[Bg] Verification sweep error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Self-healing background ingest.
// `next start` is a long-running Node process on OCI, so a module-level
// interval keeps the DB fresh every 15s even if the separate PM2 worker
// process is down. Uses the Next.js process env (which provably works —
// the stats route reads the same Supabase credentials successfully).
// Guarded so it never starts during `next build`.
// ─────────────────────────────────────────────────────────────────────────
const BG_INTERVAL_MS = 15 * 1000;

function startBackgroundIngest() {
  if (globalThis.__dexliveBgIngestStarted) return;
  globalThis.__dexliveBgIngestStarted = true;

  const run = async () => {
    try {
      await GET();
      await verifyRecentMints();
    } catch (err) {
      console.error('🔄 Background ingest error:', err.message);
    }
  };

  run();
  setInterval(run, BG_INTERVAL_MS);
  console.log('⏰ Self-healing background ingest started (every 15s)');
}

// Skip only during the production build phase.
if (process.env.NEXT_PHASE !== 'phase-production-build') {
  startBackgroundIngest();
  startPumpPortalListener();
}
