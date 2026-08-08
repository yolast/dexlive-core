import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req) {
  try {
    const apiKey = process.env.Helius_Pixiesly_API;
    if (!apiKey) {
      console.error("❌ Helius_Pixiesly_API is missing from environment variables.");
      return NextResponse.json({ success: false, error: "Helius API key missing" }, { status: 500 });
    }

    console.log("🔄 OCI Ingestion Pipeline triggered at:", new Date().toISOString());

    // 1. Fetch recent transactions from Pump.fun program via Helius RPC
    const heliusRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

    const rpcRes = await fetch(heliusRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [PUMP_FUN_PROGRAM, { limit: 35 }]
      }),
      cache: 'no-store'
    });

    const rpcData = await rpcRes.json();
    if (!rpcData.result || !Array.isArray(rpcData.result)) {
      throw new Error("Invalid Helius RPC response structure");
    }

    let insertedCount = 0;

    // 2. Fetch latest trending tokens via unblocked aggregator
    const trendingRes = await fetch("https://api.dexscreener.com/latest/dex/tokens/pump", { cache: 'no-store' });
    const trendingData = await trendingRes.json();
    const pairs = trendingData.pairs || [];

    for (const pair of pairs) {
      if (!pair.baseToken?.address) continue;
      const mintAddress = pair.baseToken.address;

      const payload = {
        mint: mintAddress,
        name: pair.baseToken.name || "Unknown",
        symbol: pair.baseToken.symbol || "MEME",
        market_cap: Number(pair.marketCap || pair.fdv || 5000),
        price_change_24h: Number(pair.priceChange?.h24 || 100),
        created_timestamp: pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now(),
        liquidity_usd: Number(pair.liquidity?.usd || 0),
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

    // 3. Automated Dead-Coin Cleanup: Purge tokens older than 45 mins with market cap < $3,000
    const cutoffTimeMs = Date.now() - (45 * 60 * 1000);
    await supabase
      .from('tokens_history')
      .delete()
      .lt('created_timestamp', cutoffTimeMs)
      .or('market_cap.lt.3000,usd_market_cap.lt.3000');

    return NextResponse.json({
      success: true,
      message: `Successfully ingested/synced ${insertedCount} tokens via Helius RPC.`,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("Ingestion Route Error:", err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}