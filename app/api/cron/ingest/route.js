import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req) {
  try {
    console.log("Pump.fun API direct ingestion started at:", new Date().toISOString());

    // 1. Fetch live newly created coins from Pump.fun public frontend API with browser headers
    const pumpApiUrl = "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC";
    
    const response = await fetch(pumpApiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://pump.fun/',
        'Origin': 'https://pump.fun/'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Pump.fun API responded with status: ${response.status}`);
    }

    const coins = await response.json();
    if (!Array.isArray(coins)) {
      throw new Error("Invalid response structure from Pump.fun API");
    }

    let insertedCount = 0;

    for (const coin of coins) {
      const mintAddress = coin.mint;
      if (!mintAddress) continue;

      const payload = {
        mint: mintAddress,
        name: coin.name || "Unknown",
        symbol: coin.symbol || "MEME",
        market_cap: Number(coin.usd_market_cap || coin.market_cap || 0),
        price_change_24h: Number(coin.price_change_24h || 100),
        created_timestamp: coin.created_timestamp ? Number(coin.created_timestamp) : Date.now(),
        liquidity_usd: Number(coin.complete ? 12000 : (coin.market_cap * 0.2) || 0),
        volume_h24: Number(coin.volume_24h || 0),
        bonding_curve_progress: Number(coin.complete ? 100 : (coin.raydium_pool ? 100 : 15)),
        dex_url: `https://dexscreener.com/solana/${mintAddress}`,
        image_url: coin.image_uri || null
      };

      const { error: upsertError } = await supabase
        .from('tokens_history')
        .upsert(payload, { onConflict: 'mint' });

      if (!upsertError) {
        insertedCount++;
      }
    }

    // 2. Automated Dead-Coin Cleanup: Purge tokens older than 45 mins with market cap < $3,000
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
      message: `Successfully ingested ${insertedCount} tokens from Pump.fun API.`,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("Pump.fun API Ingestion Error:", err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}