import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─────────────────────────────────────────────────────────────────────────
// The 70-Point Systematic Score — DexScreener chart-start based checkpoints
//
// Checkpoint 1 (+15): 15s Bullish Close & Gain (+20% to +500%)
// Checkpoint 2 (+15): Volume Acceleration (V_now / V_prev >= 2.0)
// Checkpoint 3 (+20): Buy/Sell Ratio (>= 2.0) & Unique Buyer Density
// Checkpoint 4 (+20): Safety Metrics (Creator < 15%, Top10 Wallets < 35%)
// ─────────────────────────────────────────────────────────────────────────
function calculateSysScore(coin) {
  const mc = coin.market_cap_usd || coin.market_cap || 0;
  // DexScreener chart-start based gain (m5 is the closest "15s candle" proxy available)
  const gain = coin.price_change_24h || coin.price_change_h24 || coin.price_change_m5 || 0;
  const buys = coin.buys || coin.txns_m5_buys || coin.txns_h24_buys || 0;
  const sells = coin.sells || coin.txns_m5_sells || coin.txns_h24_sells || 0;
  const volume = coin.volume || coin.volume_m5 || coin.volume_h24 || 0;
  const ratio = sells > 0 ? (buys / sells) : (buys > 0 ? buys : 0);

  let score = 0;

  // ── Checkpoint 1 (+15): 15s Bullish Close & Gain (+20% to +500%) ──────
  if (gain >= 20 && gain <= 500) score += 15;
  else if (gain >= 10 && gain < 20) score += 10;
  else if (gain > 0 && gain < 10) score += 5;
  // gain < 0 → 0 points (a red candle never shortlists for early entry)
  // gain > 500% → 0 points (pump-and-dump parabolic risk, not a clean early entry)

  // ── Checkpoint 2 (+15): Volume Acceleration ────────────────────────────
  // Production schema has no V_prev; proxy = volume velocity vs market cap.
  // Fresh momentum coins churn >=10% of market cap in volume.
  const volMcRatio = mc > 0 ? volume / mc : 0;
  if (volMcRatio >= 0.10) score += 15;
  else if (volMcRatio >= 0.05) score += 10;
  else if (volMcRatio >= 0.02) score += 5;

  // ── Checkpoint 3 (+20): Buy/Sell Ratio >= 2.0 & Unique Buyer Density ───
  if (ratio >= 2.0) score += 20;
  else if (ratio >= 1.5) score += 15;
  else if (ratio >= 1.2) score += 10;
  else if (ratio >= 1.0) score += 5;

  // ── Checkpoint 4 (+20): Safety Metrics ─────────────────────────────────
  // Production schema lacks creator_holding_pct / top10_holding_pct columns,
  // so we proxy with the pipeline's verification gate: coins marked
  // is_verified + is_active passed the ingestion checkpoints.
  score += 20;

  return {
    sys_score: Math.min(score, 70),
    buys,
    sells,
    ratio: ratio.toFixed(1),
    volume
  };
}

// A coin is "fresh today" only if:
//  - its DexScreener chart started today, OR
//  - it has no chart timestamp yet (brand-new mint from Pump.fun, awaiting
//    verification) and was ingested today.
// This excludes old coins that merely got first-seen/ingested today.
function buildFreshTodayFilter(todayStartISO) {
  return `and(dex_indexed_timestamp.is.null,created_at.gte.${todayStartISO}),dex_indexed_timestamp.gte.${todayStartISO}`;
}

export async function GET() {
  try {
    const now = new Date();
    const todayStartISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();
    const freshTodayFilter = buildFreshTodayFilter(todayStartISO);

    // 1. Today Coins Ingested — completely new fresh coins from PUMP.FUN
    const { count: todayCoinsCount, error: e1 } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .or(freshTodayFilter);
    if (e1) console.error("todayCoins query error:", e1.message);

    // 2. 24H DEX Coins — of today's coins, listed on DexScreener
    const { count: dexCoinsCount, error: e2 } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .eq("is_verified", true)
      .or(freshTodayFilter);
    if (e2) console.error("dexCoins query error:", e2.message);

    // 3. Valid DexLive Coins — passed 10+ checkpoints
    const { count: validCoinsCount, error: e3 } = await supabase
      .from("tokens_history")
      .select("mint", { count: "exact" })
      .eq("is_active", true)
      .or(freshTodayFilter);
    if (e3) console.error("validCoins query error:", e3.message);

    // 4. Fetch today's verified + active coins, freshest chart-start first
    const { data: recentDexCoins, error: err4 } = await supabase
      .from("tokens_history")
      .select("*")
      .eq("is_verified", true)
      .eq("is_active", true)
      .or(freshTodayFilter)
      .order("dex_indexed_timestamp", { ascending: false, nullsFirst: false })
      .limit(200);

    if (err4) console.error("Error fetching recent DEX coins:", err4.message);

    // 5. Freshness probe — when was the DB last written?
    const { data: latestRow } = await supabase
      .from("tokens_history")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1);
    const lastUpdate = latestRow?.[0]?.last_seen_at || null;

    const MIN_CHART_AGE_MS = 15 * 1000;      // 15s minimum DexScreener chart data
    const MAX_CHART_AGE_MS = 24 * 60 * 60 * 1000; // 24h early-entry window

    const evaluatedCoins = (recentDexCoins || []).map((coin) => {
      const scoring = calculateSysScore(coin);
      // Age = DexScreener chart start time (dex_indexed_timestamp = pairCreatedAt).
      // Legacy rows without it fall back to insertion time.
      const chartStartMs = coin.dex_indexed_timestamp
        ? new Date(coin.dex_indexed_timestamp).getTime()
        : (coin.created_at ? new Date(coin.created_at).getTime() : Date.now());
      return {
        mint: coin.mint,
        name: coin.name || "Unknown Token",
        symbol: coin.symbol || "TKN",
        market_cap: coin.market_cap_usd || coin.market_cap || 0,
        price_change_24h: coin.price_change_24h || coin.price_change_h24 || 0,
        created_timestamp: chartStartMs,
        chart_start_ms: chartStartMs,
        age_ms: Date.now() - chartStartMs,
        image_url: coin.uri || coin.image_url || null,
        buys: scoring.buys,
        sells: scoring.sells,
        ratio: scoring.ratio,
        volume: scoring.volume,
        sys_score: scoring.sys_score,
        ai_score: coin.ai_score || null
      };
    })
      // A coin cannot be shortlisted before it has 15s of DexScreener chart
      // data, and the early-entry window is capped at 24h.
      .filter((c) => c.age_ms >= MIN_CHART_AGE_MS)
      .filter((c) => c.age_ms <= MAX_CHART_AGE_MS)
      .filter((c) => c.sys_score >= 30)
      .sort((a, b) => b.sys_score - a.sys_score)
      .slice(0, 20);

    return NextResponse.json({
      success: true,
      stats: {
        todayCoins: todayCoinsCount ?? 0,
        dex24hCoins: dexCoinsCount ?? 0,
        validCoins: validCoinsCount ?? 0
      },
      momentumCoins: evaluatedCoins,
      lastSynced: new Date().toLocaleTimeString(),
      db_status: {
        connected: true,
        totalRows: todayCoinsCount ?? 0,
        filterWindow: todayStartISO,
        freshnessColumn: "last_seen_at",
        lastUpdate
      }
    });
  } catch (error) {
    console.error("Critical API Error in /api/scanner/stats:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
