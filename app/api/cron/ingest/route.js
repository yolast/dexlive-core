import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req) {
  try {
    console.log("🔄 OCI Ingestion Pipeline started at:", new Date().toISOString());
    let insertedCount = 0;

    // Fetch live trending/new pump tokens from unblocked aggregator endpoint
    const response = await fetch("https://api.dexscreener.com/latest/dex/tokens/pump", {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Aggregator responded with status ${response.status}`);
    }

    const data = await response.json();
    const pairs = data.pairs || [];

    for (const pair of pairs) {
      const mintAddress = pair.baseToken?.address;
      if (!mintAddress) continue;

      const payload = {
        mint: mintAddress,
        name: pair.baseToken.name || "Unknown",
        symbol: pair.baseToken.symbol || "MEME",
        market_cap: Number(pair.marketCap || pair.fdv || 10000),
        price_change_24h: Number(pair.priceChange?.h24 || 100),
        created_timestamp: pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now(),
        liquidity_usd: Number(pair.liquidity?.usd || 5000),
        volume_h24: Number(pair.volume?.h24 || 0),
        bonding_curve_progress: Number(pair.pairCreatedAt && Date.now() - pair.pairCreatedAt > 3600000 ? 100 : 25),
        dex_url: pair.url || `https://dexscreener.com/solana/${mintAddress}`,
        image_url: pair.info?.imageUrl || null
      };

      const { error: upsertError } = await supabase
        .from('tokens_history')
        .upsert(payload, { onConflict: 'mint' });

      if (!upsertError) {
        insertedCount++;
      }
    }

    // Automated Dead-Coin Cleanup: Purge tokens older than 45 mins with market cap < $3,000
    const cutoffTimeMs = Date.now() - (45 * 60 * 1000);
    const { error: deleteError } = await supabase
      .from('tokens_history')
      .delete()
      .lt('created_timestamp', cutoffTimeMs)
      .or('market_cap.lt.3000,usd_market_cap.lt.3000');

    if (deleteError) {
      console.warn("Cleanup warning:", deleteError.message);
    }

    return NextResponse.json({
      success: true,
      message: `Successfully ingested/synced ${insertedCount} tokens.`,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("Ingestion Route Error:", err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}