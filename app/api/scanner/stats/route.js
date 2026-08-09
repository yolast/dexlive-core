import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  try {
    const now = new Date();
    // 5:30 AM IST reset time (00:00:00 UTC)
    const todayStartISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();

    // 1. Today Coins Ingested (Bypasses 1,000 row cap via exact count)
    const { count: todayCoinsCount, error: err1 } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .gte("created_at", todayStartISO);

    if (err1) console.error("Error fetching today count:", err1.message);

    // 2. 24H DEX Coins (Indexed on DEXScreener today)
    const { count: dexCoinsCount, error: err2 } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .eq("is_verified", true)
      .gte("created_at", todayStartISO);

    if (err2) console.error("Error fetching DEX count:", err2.message);

    // 3. Valid DexLive Coins (Surviving active coins today)
    const { count: validCoinsCount, error: err3 } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .eq("is_active", true)
      .gte("created_at", todayStartISO);

    if (err3) console.error("Error fetching valid count:", err3.message);

    // 4. Top Performing DEX Coins (+100% gainers, active today, sorted highest gain)
    const { data: topGainers, error: err4 } = await supabase
      .from("tokens_history")
      .select("mint, name, symbol, market_cap_usd, price_change_24h, created_at, uri")
      .eq("is_active", true)
      .gte("price_change_24h", 100)
      .gte("created_at", todayStartISO)
      .order("price_change_24h", { ascending: false })
      .limit(20);

    if (err4) console.error("Error fetching top gainers:", err4.message);

    const momentumCoins = (topGainers || []).map((coin) => ({
      mint: coin.mint,
      name: coin.name || "Pump.fun Token",
      symbol: coin.symbol || "PUMP",
      market_cap: coin.market_cap_usd || 0,
      price_change_24h: coin.price_change_24h || 0,
      created_timestamp: coin.created_at ? new Date(coin.created_at).getTime() : Date.now(),
      image_url: null
    }));

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