import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// The 70-point systematic score (same checkpoints as the scanner feed)
function calculateSysScore(token) {
  const mc = token.market_cap_usd || token.market_cap || 0;
  const gain = token.price_change_24h || token.price_change_h24 || token.price_change_m5 || 0;
  const buys = token.buys || token.txns_m5_buys || token.txns_h24_buys || 0;
  const sells = token.sells || token.txns_m5_sells || token.txns_h24_sells || 0;
  const volume = token.volume || token.volume_m5 || token.volume_h24 || 0;
  const ratio = sells > 0 ? (buys / sells) : (buys > 0 ? buys : 0);

  let score = 0;

  // Checkpoint 1 (+15): 15s Bullish Close & Gain (+20% to +500%)
  if (gain >= 20 && gain <= 500) score += 15;
  else if (gain >= 10 && gain < 20) score += 10;
  else if (gain > 0 && gain < 10) score += 5;

  // Checkpoint 2 (+15): Volume Acceleration (proxied by volume velocity vs MC)
  const volMcRatio = mc > 0 ? volume / mc : 0;
  if (volMcRatio >= 0.10) score += 15;
  else if (volMcRatio >= 0.05) score += 10;
  else if (volMcRatio >= 0.02) score += 5;

  // Checkpoint 3 (+20): Buy/Sell Ratio >= 2.0 & Unique Buyer Density
  if (ratio >= 2.0) score += 20;
  else if (ratio >= 1.5) score += 15;
  else if (ratio >= 1.2) score += 10;
  else if (ratio >= 1.0) score += 5;

  // Checkpoint 4 (+20): Safety Metrics (proxied by pipeline verification gate)
  score += 20;

  return {
    sys_score: Math.min(score, 70),
    buys,
    sells,
    ratio: ratio.toFixed(1),
    volume
  };
}

export async function GET() {
  try {
    const now = new Date();
    const todayStartISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();
    // Fresh today = chart started today OR brand-new mint (no chart ts yet) ingested today
    const freshTodayFilter = `and(dex_indexed_timestamp.is.null,created_at.gte.${todayStartISO}),dex_indexed_timestamp.gte.${todayStartISO}`;

    const { data: tokens, error } = await supabase
      .from('tokens_history')
      .select('*')
      .eq('is_verified', true)
      .eq('is_active', true)
      .or(freshTodayFilter)
      .order('dex_indexed_timestamp', { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) {
      throw new Error(error.message);
    }

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ success: true, snipers: [] });
    }

    const MIN_CHART_AGE_MS = 15 * 1000;
    const MAX_CHART_AGE_MS = 24 * 60 * 60 * 1000;

    const scoredSnipers = tokens
      .map((token) => {
        const scoring = calculateSysScore(token);
        // Age = DexScreener chart start time; legacy rows fall back to insertion time
        const chartStartMs = token.dex_indexed_timestamp
          ? new Date(token.dex_indexed_timestamp).getTime()
          : (token.created_at ? new Date(token.created_at).getTime() : Date.now());

        return {
          mint: token.mint,
          name: token.name || 'Unknown',
          symbol: token.symbol || 'TKN',
          market_cap: token.market_cap_usd || token.market_cap || 0,
          price_change_24h: token.price_change_24h || token.price_change_h24 || 0,
          buys: scoring.buys,
          sells: scoring.sells,
          ratio: scoring.ratio,
          volume: scoring.volume,
          liquidity_usd: token.liquidity_usd || 0,
          sys_score: scoring.sys_score,
          momentum_score: scoring.sys_score,
          image_url: token.uri || token.image_url || null,
          created_timestamp: chartStartMs,
          chart_start_ms: chartStartMs,
          age_ms: Date.now() - chartStartMs,
        };
      })
      // A coin cannot be shortlisted before it has 15s of chart data, and the
      // early-entry window is capped at 24h.
      .filter((token) => token.age_ms >= MIN_CHART_AGE_MS)
      .filter((token) => token.age_ms <= MAX_CHART_AGE_MS)
      .filter((token) => token.sys_score >= 30)
      .sort((a, b) => b.sys_score - a.sys_score)
      .slice(0, 20);

    return NextResponse.json({
      success: true,
      count: scoredSnipers.length,
      snipers: scoredSnipers,
    });
  } catch (err) {
    console.error('Momentum Sniper API Error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
