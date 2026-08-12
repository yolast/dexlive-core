import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let freshnessColumn = "last_seen_at";
    const { error: probeError } = await supabase
      .from('tokens_history')
      .select('last_seen_at')
      .limit(1);
    if (probeError) {
      console.warn("last_seen_at column not found, falling back to created_at");
      freshnessColumn = "created_at";
    }

    const { data: tokens, error } = await supabase
      .from('tokens_history')
      .select('*')
      .eq('is_verified', true)
      .eq('is_active', true)
      .gte(freshnessColumn, twentyFourHoursAgo)
      .order(freshnessColumn, { ascending: false })
      .limit(100);

    if (error) {
      throw new Error(error.message);
    }

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ success: true, snipers: [] });
    }

    const scoredSnipers = tokens
      .map((token) => {
        let score = 0;

        const mc = token.market_cap_usd || token.market_cap || 0;
        const gain = token.price_change_24h || token.price_change_h24 || token.price_change_m5 || 0;
        const liquidity = token.liquidity_usd || 0;
        const buys = token.buys || token.txns_m5_buys || token.txns_h24_buys || 0;
        const sells = token.sells || token.txns_m5_sells || token.txns_h24_sells || 0;
        const volume = token.volume || token.volume_m5 || token.volume_h24 || 0;
        const ratio = sells > 0 ? (buys / sells) : (buys > 0 ? buys : 0);

        // --- HARD FILTERS ---
        if (mc < 3000 || mc > 3000000) return null;

        // --- MOMENTUM SCORE (Max 100) ---
        // 1. Market Cap sweet spot (0-15)
        if (mc >= 4000 && mc <= 500000) score += 15;
        else if (mc > 500000 && mc <= 2000000) score += 8;

        // 2. Gain / momentum (0-25)
        if (gain >= 500) score += 25;
        else if (gain >= 100) score += 20;
        else if (gain >= 50) score += 15;
        else if (gain >= 20) score += 10;
        else if (gain > 0) score += 5;

        // 3. Buy pressure ratio (0-20)
        if (ratio >= 3.0) score += 20;
        else if (ratio >= 1.5) score += 15;
        else if (ratio >= 1.0) score += 10;
        else if (ratio >= 0.5 && buys > 0) score += 5;

        // 4. Volume health (0-15)
        if (volume >= 500000) score += 15;
        else if (volume >= 100000) score += 10;
        else if (volume >= 10000) score += 5;

        // 5. Liquidity depth (0-15)
        if (liquidity >= 100000) score += 15;
        else if (liquidity >= 30000) score += 10;
        else if (liquidity >= 8000) score += 5;

        // 6. Verification / is_active checkpoint passed (base +10)
        score += 10;

        return {
          mint: token.mint,
          name: token.name || 'Unknown',
          symbol: token.symbol || 'TKN',
          market_cap: mc,
          price_change_24h: gain,
          buys,
          sells,
          ratio: ratio.toFixed(1),
          volume,
          liquidity_usd: liquidity,
          momentum_score: score,
          image_url: token.uri || token.image_url || null,
          created_timestamp: token.last_seen_at
            ? new Date(token.last_seen_at).getTime()
            : (token.created_at ? new Date(token.created_at).getTime() : Date.now()),
        };
      })
      .filter(Boolean)
      .filter((token) => token.momentum_score >= 40)
      .sort((a, b) => b.momentum_score - a.momentum_score)
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
