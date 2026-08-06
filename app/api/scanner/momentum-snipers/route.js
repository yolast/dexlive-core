import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);

    // Fetch raw tokens from Supabase created within the last 30 minutes
    const { data: tokens, error } = await supabase
      .from('tokens_history')
      .select('*')
      .gte('created_timestamp', thirtyMinutesAgo)
      .order('created_timestamp', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ success: true, snipers: [] });
    }

    const scoredSnipers = tokens.map((token) => {
      let score = 0;
      let failsSafety = false;

      // --- STAGE 3: SAFETY FILTER (Absolute Rejects) ---
      if (token.mint_authority_disabled === false && token.mint_authority_disabled !== null) failsSafety = true;
      if (token.freeze_authority_disabled === false && token.freeze_authority_disabled !== null) failsSafety = true;
      if (token.creator_holding_pct > 15) failsSafety = true;
      if (token.top10_holding_pct > 55) failsSafety = true;
      if (token.is_blacklisted || token.is_honeypot) failsSafety = true;

      if (failsSafety) return null;

      // --- STAGE 1 & 2: BASIC & MOMENTUM CHECKS ---
      const gain = token.gain_percentage || 0;
      const buySellRatio = token.buy_sell_ratio || 0;
      const liquidity = token.liquidity_usd || 0;
      const volume1m = token.volume_1m || 0;
      const holders = token.holder_count || 0;
      const uniqueBuyers = token.unique_buyers || 0;
      const marketCap = token.market_cap || token.usd_market_cap || 0;

      // Basic hard filter requirements for Momentum Sniper
      if (gain < 100) return null; // Must be at least +100% gain
      if (liquidity < 8000) return null; // Min liquidity $8K
      if (marketCap < 15000 || marketCap > 300000) return null; // MC $15K - $300K

      // --- STAGE 4: MOMENTUM SCORE CALCULATION (Max 120) ---
      // 1. 15S Bullish Candle Confirmation
      if (token.first_candle_bullish !== false) score += 20;

      // 2. +100% Gain Threshold Met
      if (gain >= 100) score += 20;

      // 3. Buy Volume & Acceleration
      if (volume1m >= 10000 || buySellRatio >= 3.0) score += 15;

      // 4. Unique Buyers Growth
      if (uniqueBuyers >= 10) score += 15;

      // 5. Holder Growth Velocity
      if (holders >= 40) score += 10;

      // 6. Liquidity Pool Health
      if (liquidity >= 8000) score += 10;

      // 7. Market Cap Sweet Spot
      if (marketCap >= 15000 && marketCap <= 300000) score += 10;

      // 8. Safety & Authority Verification passed
      score += 20;

      return {
        ...token,
        momentum_score: score,
        gain_percentage: gain,
      };
    })
    .filter(Boolean)
    .filter((token) => token.momentum_score > 90) // Display only Score > 90
    .sort((a, b) => b.momentum_score - a.momentum_score)
    .slice(0, 20); // Top 20 Max

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