import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

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

// Helper Function: Fetch Pre-DEX Data gracefully
async function fetchPreDexData(mint) {
  try {
    const res = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(2000),
      cache: 'no-store'
    });

    if (!res.ok) return null;
    const data = await res.json();

    return {
      pump_created_timestamp: data.created_timestamp || null,
      dev_holding_percent: data.creator_holding_percent || 0,
      bonding_curve_progress: data.bonding_curve_progress || (data.usd_market_cap > 55000 ? 100 : 0),
      is_migrated_raydium: data.complete || false
    };
  } catch (error) {
    return null;
  }
}

export async function GET(req) {
  try {
    console.log("🔄 Hybrid Pipeline started at:", new Date().toISOString());
    let insertedCount = 0;
    let failedCount = 0;

    const columns = await getExistingColumns();
    const nowISO = new Date().toISOString();

    // STEP 1: Fetch the core live market data from DEXScreener
    const searchRes = await fetch("https://api.dexscreener.com/latest/dex/search?q=pump", {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store'
    });

    if (!searchRes.ok) throw new Error(`DexScreener API status ${searchRes.status}`);
    const searchData = await searchRes.json();
    const pairs = searchData.pairs || [];

    for (const pair of pairs) {
      if (pair.chainId !== 'solana') continue;

      const mintAddress = pair.baseToken?.address;
      if (!mintAddress) continue;

      const dexIndexedTimestamp = pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now();
      // dex_indexed_timestamp is TIMESTAMPTZ in production — must write ISO, not epoch ms
      const dexIndexedISO = new Date(dexIndexedTimestamp).toISOString();

      const preDexData = await fetchPreDexData(mintAddress);

      let timeToIndexMs = null;
      if (preDexData && preDexData.pump_created_timestamp) {
        timeToIndexMs = dexIndexedTimestamp - preDexData.pump_created_timestamp;
        if (timeToIndexMs < 0) timeToIndexMs = 0;
      }

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

      const payload = {
        mint: mintAddress,
        name: pair.baseToken?.name || "Unknown",
        symbol: pair.baseToken?.symbol || "MEME",
        is_verified: true,
        is_active: true,

        market_cap_usd: Number(pair.fdv || pair.marketCap || 0),
        fdv: Number(pair.fdv || 0),
        liquidity_usd: Number(pair.liquidity?.usd || 0),

        price_change_m5: m5PriceChange,
        price_change_h1: Number(pair.priceChange?.h1 || 0),
        price_change_h24: h24PriceChange,
        price_change_24h: m5PriceChange || h24PriceChange,

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
        pump_created_timestamp: preDexData?.pump_created_timestamp || null,
        time_to_index_ms: timeToIndexMs,

        bonding_curve_progress: preDexData?.bonding_curve_progress || 0,
        dev_holding_percent: preDexData?.dev_holding_percent || 0,
        is_migrated_raydium: preDexData?.is_migrated_raydium || false,

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
