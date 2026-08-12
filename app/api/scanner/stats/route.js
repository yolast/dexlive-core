import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper function to calculate the 70-Point Systematic Score
// Handles both worker.js legacy columns (market_cap_usd, price_change_24h, uri, buys, sells, volume)
// and cron route new columns (market_cap, price_change_h24, image_url, txns_m5_buys/m5_sells, volume_m5)
function calculateSysScore(coin) {
  let score = 0;
  const mc = coin.market_cap_usd || coin.market_cap || 0;
  const gain = coin.price_change_24h || coin.price_change_h24 || coin.price_change_m5 || 0;

  const buys = coin.buys || coin.txns_m5_buys || 0;
  const sells = coin.sells || coin.txns_m5_sells || 0;
  const ratio = sells > 0 ? (buys / sells) : (buys > 0 ? buys : 0);

  // RUG PENALTY — only reject clear rug-pulls (deep negative + heavy dumps)
  if (gain < -20 || (sells > buys * 3 && buys > 0)) {
    return { sys_score: 0, buys, sells, ratio: ratio.toFixed(1) };
  }

  // 2. Market Cap Filter (Max 15 pts)
  if (mc >= 4000 && mc <= 500000) score += 15;
  else if (mc > 500000 && mc <= 2000000) score += 10;
  else if (mc > 1000 && mc < 4000) score += 5;

  // 3. Momentum / Gain (Max 20 pts)
  if (gain >= 100) score += 20;
  else if (gain >= 50) score += 15;
  else if (gain >= 20) score += 10;
  else if (gain > 0) score += 5;

  // 4. Buy/Sell Ratio (Max 15 pts)
  if (ratio >= 2.0) score += 15;
  else if (ratio >= 1.2) score += 10;
  else if (ratio >= 0.8) score += 5;

  // 5. Base Safety Metrics (Max 20 pts)
  score += 20;

  return {
    sys_score: Math.min(score, 70),
    buys,
    sells,
    ratio: ratio.toFixed(1)
  };
}

export async function GET() {
  try {
    const now = new Date();
    const todayStartISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();

    // Use last_seen_at if the column exists (added by the pipeline), else fall back to created_at
    let freshnessColumn = "last_seen_at";
    const { error: probeError } = await supabase
      .from("tokens_history")
      .select("last_seen_at")
      .limit(1);
    if (probeError) {
      console.warn("last_seen_at column not found, falling back to created_at");
      freshnessColumn = "created_at";
    }

    // 1. Today Coins Ingested
    const { count: todayCoinsCount } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .gte(freshnessColumn, todayStartISO);

    // 2. 24H DEX Coins
    const { count: dexCoinsCount } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .eq("is_verified", true)
      .gte(freshnessColumn, todayStartISO);

    // 3. Valid DexLive Coins
    const { count: validCoinsCount } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .eq("is_active", true)
      .gte(freshnessColumn, todayStartISO);

    // 4. Fetch the freshest 100 verified coins
    const { data: recentDexCoins, error: err4 } = await supabase
      .from("tokens_history")
      .select("mint, name, symbol, market_cap_usd, market_cap, price_change_24h, price_change_h24, price_change_m5, created_at, last_seen_at, uri, image_url, sys_score, ai_score, buys, sells, txns_m5_buys, txns_m5_sells, volume, volume_m5")
      .eq("is_verified", true)
      .eq("is_active", true)
      .gte(freshnessColumn, todayStartISO)
      .order(freshnessColumn, { ascending: false })
      .limit(100);

    if (err4) console.error("Error fetching recent DEX coins:", err4.message);

    // Map and Calculate scores on the fly — handles both ingestion paths
    const evaluatedCoins = (recentDexCoins || []).map((coin) => {
      const scoring = calculateSysScore(coin);
      return {
        mint: coin.mint,
        name: coin.name || "Unknown Token",
        symbol: coin.symbol || "TKN",
        market_cap: coin.market_cap_usd || coin.market_cap || 0,
        price_change_24h: coin.price_change_24h || coin.price_change_h24 || 0,
        created_timestamp: coin.last_seen_at ? new Date(coin.last_seen_at).getTime() : (coin.created_at ? new Date(coin.created_at).getTime() : Date.now()),
        image_url: coin.uri || coin.image_url || null,
        buys: scoring.buys,
        sells: scoring.sells,
        ratio: scoring.ratio,
        sys_score: scoring.sys_score,
        ai_score: coin.ai_score || null 
      };
    });

    // PRODUCTION FILTER: Require a score of 20+, sort by best score, slice top 20
    const momentumCoins = evaluatedCoins
      .filter(c => c.sys_score >= 20)
      .sort((a, b) => b.sys_score - a.sys_score)
      .slice(0, 20);

    return NextResponse.json({
      success: true,
      stats: {
        todayCoins: todayCoinsCount ?? 0,
        dex24hCoins: dexCoinsCount ?? 0,
        validCoins: validCoinsCount ?? 0
      },
      momentumCoins,
      lastSynced: new Date().toLocaleTimeString(),
      db_status: {
        connected: true,
        totalRows: todayCoinsCount ?? 0,
        filterWindow: todayStartISO
      }
    });
  } catch (error) {
    console.error("Critical API Error in /api/scanner/stats:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}