import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req) {
  try {
    const apiKey = process.env.Helius_Pixiesly_API;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "Helius API key missing" }, { status: 500 });
    }

    console.log("🔄 Running OCI Ingestion Pipeline at:", new Date().toISOString());
    let insertedCount = 0;

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
        params: [PUMP_FUN_PROGRAM, { limit: 25 }]
      }),
      cache: 'no-store'
    });

    const rpcData = await rpcRes.json();
    if (rpcData.result && Array.isArray(rpcData.result)) {
      const signatures = rpcData.result.map(item => item.signature);
      
      if (signatures.length > 0) {
        // Fetch parsed/enhanced transactions from Helius API
        const parseRes = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactions: signatures }),
          cache: 'no-store'
        });

        const txs = await parseRes.json();
        if (Array.isArray(txs)) {
          for (const tx of txs) {
            const accountData = tx.accountData || [];
            let mintAddress = null;

            for (const acc of accountData) {
              if (acc.mint && acc.mint.endsWith('pump')) {
                mintAddress = acc.mint;
                break;
              }
            }

            if (mintAddress) {
              const payload = {
                mint: mintAddress,
                name: tx.description ? tx.description.slice(0, 30) : "Pump Token",
                symbol: "PUMP",
                market_cap: 15000,
                price_change_24h: 100,
                created_timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
                liquidity_usd: 5000,
                volume_h24: 0,
                bonding_curve_progress: 20,
                dex_url: `https://dexscreener.com/solana/${mintAddress}`,
                image_url: null
              };

              const { error: upsertError } = await supabase
                .from('tokens_history')
                .upsert(payload, { onConflict: 'mint' });

              if (!upsertError) {
                insertedCount++;
              }
            }
          }
        }
      }
    }

    // 2. Primary/Fallback Feed: Fetch latest pump tokens from unblocked aggregator to guarantee fresh tokens
    const trendingRes = await fetch("https://api.dexscreener.com/latest/dex/tokens/pump", { cache: 'no-store' });
    const trendingData = await trendingRes.json();
    const pairs = trendingData.pairs || [];

    for (const pair of pairs) {
      if (!pair.baseToken?.address || !pair.baseToken.address.endsWith('pump')) continue;
      const mintAddress = pair.baseToken.address;

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

    // 3. Automated Dead-Coin Cleanup: Purge tokens older than 45 mins with market cap < $3,000
    const cutoffTimeMs = Date.now() - (45 * 60 * 1000);
    await supabase
      .from('tokens_history')
      .delete()
      .lt('created_timestamp', cutoffTimeMs)
      .or('market_cap.lt.3000,usd_market_cap.lt.3000');

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