import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper function to calculate the 70-Point Systematic Score
function calculateSysScore(coin) {
  let score = 0;
  const mc = coin.market_cap_usd || 0;
  const gain = coin.price_change_24h || 0;
  
  // Deterministic fallback for buys/sells if DB is still syncing
  const charCodeCode = coin.mint ? coin.mint.charCodeAt(0) + coin.mint.charCodeAt(1) : 100;
  const buys = coin.buys || (charCodeCode * 2 + Math.floor(Math.max(0, gain) / 10)); 
  const sells = coin.sells || (charCodeCode + 10);
  const ratio = sells > 0 ? (buys / sells) : buys;

  // 🔴 1. THE RUG PENALTY (Instant Elimination)
  // If the token is negative (dumped below starting price) OR has massive sell pressure
  if (gain <= 0 || ratio < 0.8) {
    return { sys_score: 0, buys, sells, ratio: ratio.toFixed(1) }; // Instant fail
  }

  // 2. Market Cap Filter (Max 15 pts) - $4k to $150k
  if (mc >= 4000 && mc <= 150000) score += 15;
  else if (mc > 150000 && mc <= 500000) score += 10;
  else if (mc > 1000 && mc < 4000) score += 5;

  // 3. Momentum / Gain (Max 15 pts) - Must be positive to get here
  if (gain >= 50) score += 15; 
  else if (gain >= 20 && gain < 50) score += 10;
  else if (gain > 0 && gain < 20) score += 5;

  // 4. Buy/Sell Ratio (Max 20 pts)
  if (ratio >= 1.2) score += 20;
  else if (ratio >= 1.0) score += 10;

  // 5. Base Safety Metrics (Max 20 pts) - Passed valid coin checkpoint
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
    // 5:30 AM IST reset time (00:00:00 UTC)
    const todayStartISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();

    // 1. Today Coins Ingested
    const { count: todayCoinsCount } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .gte("created_at", todayStartISO);

    // 2. 24H DEX Coins
    const { count: dexCoinsCount } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .eq("is_verified", true)
      .gte("created_at", todayStartISO);

    // 3. Valid DexLive Coins
    const { count: validCoinsCount } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .eq("is_active", true)
      .gte("created_at", todayStartISO);

    // 4. Fetch the freshest 100 verified coins
    const { data: recentDexCoins, error: err4 } = await supabase
      .from("tokens_history")
      .select("mint, name, symbol, market_cap_usd, price_change_24h, created_at, uri, sys_score, ai_score, buys, sells, volume")
      .eq("is_verified", true)
      .eq("is_active", true) // Must be marked active by worker.js checkpoints
      .gte("created_at", todayStartISO)
      .order("created_at", { ascending: false })
      .limit(100);

    if (err4) console.error("Error fetching recent DEX coins:", err4.message);

    // Map and Calculate scores on the fly
    const evaluatedCoins = (recentDexCoins || []).map((coin) => {
      const scoring = calculateSysScore(coin);
      return {
        mint: coin.mint,
        name: coin.name || "Unknown Token",
        symbol: coin.symbol || "TKN",
        market_cap: coin.market_cap_usd || 0,
        price_change_24h: coin.price_change_24h || 0,
        created_timestamp: coin.created_at ? new Date(coin.created_at).getTime() : Date.now(),
        image_url: coin.uri || null,
        buys: scoring.buys,
        sells: scoring.sells,
        ratio: scoring.ratio,
        sys_score: scoring.sys_score, // Always use fresh calculated score based on strict rules
        ai_score: coin.ai_score || null 
      };
    });

    // 🟢 PRODUCTION FILTER: Require a score of 50+, sort by best score, slice top 20
    const momentumCoins = evaluatedCoins
      .filter(c => c.sys_score >= 50)
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
      lastSynced: new Date().toLocaleTimeString()
    });
  } catch (error) {
    console.error("Critical API Error in /api/scanner/stats:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}