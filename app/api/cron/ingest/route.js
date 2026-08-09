import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 45; // Slightly increased to handle hybrid fetching

// Helper Function: Fetch Pre-DEX Data gracefully
async function fetchPreDexData(mint) {
  try {
    const res = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      // Short timeout so a blocked request doesn't hang your pipeline
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
    // If Pump.fun blocks us, fail silently so DEXScreener data still saves
    return null;
  }
}

export async function GET(req) {
  try {
    console.log("🔄 Hybrid Pipeline started at:", new Date().toISOString());
    let insertedCount = 0;

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

      // STEP 2: The Hybrid Fusion - Fetch Pump.fun pre-data for this specific coin
      const preDexData = await fetchPreDexData(mintAddress);

      // STEP 3: Calculate the AI Velocity Metric (Time to Index)
      let timeToIndexMs = null;
      if (preDexData && preDexData.pump_created_timestamp) {
        timeToIndexMs = dexIndexedTimestamp - preDexData.pump_created_timestamp;
        // Failsafe: if indexing appears to happen before creation due to API lag, set to 0
        if (timeToIndexMs < 0) timeToIndexMs = 0; 
      }

      // STEP 4: Construct the Master Payload using the new DB Schema
      const payload = {
        // Core Identity
        mint: mintAddress,
        name: pair.baseToken?.name || "Unknown",
        symbol: pair.baseToken?.symbol || "MEME",
        
        // Financials & Liquidity
        market_cap: Number(pair.marketCap || 0),
        fdv: Number(pair.fdv || 0),
        liquidity_usd: Number(pair.liquidity?.usd || 0),
        
        // Momentum & Price Changes (%)
        price_change_m5: Number(pair.priceChange?.m5 || 0),
        price_change_h1: Number(pair.priceChange?.h1 || 0),
        price_change_h24: Number(pair.priceChange?.h24 || 0),
        
        // Trading Volume (USD)
        volume_m5: Number(pair.volume?.m5 || 0),
        volume_h1: Number(pair.volume?.h1 || 0),
        volume_h24: Number(pair.volume?.h24 || 0),
        
        // Buy/Sell Pressure
        txns_m5_buys: Number(pair.txns?.m5?.buys || 0),
        txns_m5_sells: Number(pair.txns?.m5?.sells || 0),
        txns_h1_buys: Number(pair.txns?.h1?.buys || 0),
        txns_h1_sells: Number(pair.txns?.h1?.sells || 0),
        txns_h24_buys: Number(pair.txns?.h24?.buys || 0),
        txns_h24_sells: Number(pair.txns?.h24?.sells || 0),
        
        // Metadata & Links
        image_url: pair.info?.imageUrl || null,
        dex_url: pair.url || `https://dexscreener.com/solana/${mintAddress}`,
        
        // --- THE HYBRID TIMELINE ---
        dex_indexed_timestamp: dexIndexedTimestamp,
        pump_created_timestamp: preDexData?.pump_created_timestamp || null,
        time_to_index_ms: timeToIndexMs,
        
        // --- PRE-DEX ANALYTICS ---
        bonding_curve_progress: preDexData?.bonding_curve_progress || 0,
        dev_holding_percent: preDexData?.dev_holding_percent || 0,
        is_migrated_raydium: preDexData?.is_migrated_raydium || false
      };

      // Push to Supabase
      const { error: upsertError } = await supabase
        .from('tokens_history')
        .upsert(payload, { onConflict: 'mint' });

      if (!upsertError) insertedCount++;
    }

    // STEP 5: Optimized Dead-Coin Purge (Market Cap < $3k AND older than 45 mins)
    const cutoffTimeMs = Date.now() - (45 * 60 * 1000);
    const { error: deleteError } = await supabase
      .from('tokens_history')
      .delete()
      .lt('dex_indexed_timestamp', cutoffTimeMs)
      .lt('market_cap', 3000);

    if (deleteError) console.warn("Cleanup warning:", deleteError.message);

    console.log(`✅ Hybrid Pipeline Complete: Synced ${insertedCount} tokens.`);

    return NextResponse.json({
      success: true,
      message: `Successfully ingested/synced ${insertedCount} tokens.`,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("Hybrid Ingestion Error:", err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}