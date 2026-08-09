import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1. WebSocket Ingestion
function startIngestion() {
  console.log("🚀 Starting DEXLive Ingestion & Accelerated Pruner...");
  const ws = new WebSocket('wss://pumpportal.fun/api/data');

  ws.on('open', () => {
    console.log('✅ Connected to PumpPortal WebSocket');
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      if (message.mint && message.name && message.symbol) {
        console.log(`🔥 Ingested Token: ${message.name} (${message.symbol}) [${message.mint}]`);

        await supabase.from("tokens_history").upsert(
          {
            mint: message.mint,
            name: message.name,
            symbol: message.symbol,
            uri: message.uri || null,
            trader_public_key: message.traderPublicKey || null,
            signature: message.signature || null,
            initial_buy: message.initialBuy || 0,
            is_active: true,
            is_verified: false,
            created_at: new Date().toISOString()
          },
          { onConflict: "mint" }
        );
      }
    } catch (err) {
      console.error("⚠️ Ingestion Error:", err);
    }
  });

  ws.on('close', () => {
    console.log('❌ WebSocket disconnected. Reconnecting in 5s...');
    setTimeout(startIngestion, 5000);
  });
  
  ws.on('error', (err) => console.error('🔥 WS Error:', err.message));
}

// 2. Fast Dead-Coin & DEX Verification Evaluator (Runs every 3 seconds)
async function evaluateTokens() {
  try {
    // Prioritize unverified tokens first, then active tokens
    const { data: tokens, error } = await supabase
      .from("tokens_history")
      .select("mint, name, symbol, created_at, is_verified, initial_dex_price_usd, initial_liquidity_usd, ath_usd")
      .eq("is_active", true)
      .order("is_verified", { ascending: true }) // Unverified first
      .limit(30);

    if (error || !tokens || tokens.length === 0) return;

    const mints = tokens.map(t => t.mint);
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`);
    if (!res.ok) return;

    const data = await res.json();
    const pairs = data.pairs || [];

    for (const token of tokens) {
      const ageMinutes = (Date.now() - new Date(token.created_at).getTime()) / (1000 * 60);
      const matchedPair = pairs.find(p => p.baseToken?.address === token.mint && p.chainId === 'solana');

      if (!matchedPair) {
        if (ageMinutes > 15 || token.is_verified) {
          await markDeadCoin(token.mint, `Unlisted / Missing from DEXScreener after 15m`);
        }
        continue;
      }

      // Telemetry
      const priceUsd = parseFloat(matchedPair.priceUsd || "0");
      const liquidityUsd = matchedPair.liquidity?.usd || 0;
      const volume1h = matchedPair.volume?.h1 || 0;
      const priceChange5m = matchedPair.priceChange?.m5 || 0;
      const priceChange1h = matchedPair.priceChange?.h1 || 0;
      const priceChange24h = matchedPair.priceChange?.h24 || 0;
      const marketCap = matchedPair.fdv || matchedPair.marketCap || 0;

      const buys1h = matchedPair.txns?.h1?.buys || 0;
      const sells1h = matchedPair.txns?.h1?.sells || 0;
      const totalTxns1h = buys1h + sells1h;
      const buySellRatio1h = sells1h > 0 ? (buys1h / sells1h) : buys1h;

      const initialDexPrice = token.initial_dex_price_usd > 0 ? token.initial_dex_price_usd : priceUsd;
      const initialLiquidity = token.initial_liquidity_usd > 0 ? token.initial_liquidity_usd : liquidityUsd;
      const currentATH = Math.max(token.ath_usd || 0, priceUsd);

      // --- EVALUATE CHECKPOINTS ---

      if (initialDexPrice > 0 && priceUsd < initialDexPrice) {
        await markDeadCoin(token.mint, `Price ($${priceUsd}) dropped below starting price`);
        continue;
      }

      if (ageMinutes > 15 && buySellRatio1h < 1.0) {
        await markDeadCoin(token.mint, `Buy/Sell Ratio (${buySellRatio1h.toFixed(2)}) < 1.0`);
        continue;
      }

      if (ageMinutes > 30 && buys1h < 50) {
        await markDeadCoin(token.mint, `Unique Buyers (${buys1h}) < 50 in first 30m`);
        continue;
      }

      if (ageMinutes > 15 && initialLiquidity > 0 && liquidityUsd <= initialLiquidity) {
        await markDeadCoin(token.mint, `Liquidity failed to grow above initial`);
        continue;
      }

      if (ageMinutes > 30 && Math.abs(priceChange5m) < 0.1 && Math.abs(priceChange1h) < 0.5) {
        await markDeadCoin(token.mint, `Market Cap growth flat for 30m`);
        continue;
      }

      if (ageMinutes > 60 && volume1h < 20000) {
        await markDeadCoin(token.mint, `1H Volume ($${volume1h}) < $20,000 in first hour`);
        continue;
      }

      if (ageMinutes > 60 && totalTxns1h < 50) {
        await markDeadCoin(token.mint, `Transactions (${totalTxns1h}) < 50 in first hour`);
        continue;
      }

      if (ageMinutes > 60 && buys1h < 30) {
        await markDeadCoin(token.mint, `Holder growth stagnated`);
        continue;
      }

      if (ageMinutes > 15 && volume1h > 0 && (volume1h / Math.max(1, totalTxns1h)) < 6) {
        await markDeadCoin(token.mint, `No whale activity (No wallet > $300 buy proxy)`);
        continue;
      }

      if (currentATH > 0 && priceUsd < currentATH * 0.50 && priceChange5m <= 0) {
        await markDeadCoin(token.mint, `Price failed to recover after >50% dump`);
        continue;
      }

      if (ageMinutes <= 60 && currentATH > 0 && priceUsd <= currentATH * 0.20) {
        await markDeadCoin(token.mint, `ATH Retracement > 80% within first hour`);
        continue;
      }

      // Passed checks: Mark verified & update metrics
      await supabase
        .from("tokens_history")
        .update({
          is_verified: true,
          market_cap_usd: marketCap,
          price_change_24h: priceChange24h,
          name: matchedPair.baseToken?.name || token.name,
          symbol: matchedPair.baseToken?.symbol || token.symbol,
          initial_dex_price_usd: initialDexPrice,
          initial_liquidity_usd: initialLiquidity,
          ath_usd: currentATH,
          last_updated_at: new Date().toISOString()
        })
        .eq("mint", token.mint);
    }
  } catch (error) {
    console.error("⚠️ Evaluation Error:", error.message);
  }
}

// Garbage Collector: Hard deletes yesterday's dead coins to save Supabase storage space
async function purgeOldDeadCoins() {
  try {
    const now = new Date();
    const today530AM_IST = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();

    const { data, error } = await supabase
      .from("tokens_history")
      .delete()
      .eq("is_active", false)
      .lt("created_at", today530AM_IST)
      .select("mint");

    if (!error && data && data.length > 0) {
      console.log(`🧹 Garbage Collector: Hard-deleted ${data.length} old dead coins.`);
    }
  } catch (error) {
    console.error("⚠️ Purge Error:", error.message);
  }
}

// Soft Delete: Sets is_active = false so daily counters show funnel stats
async function markDeadCoin(mint, reason) {
  const { error } = await supabase
    .from("tokens_history")
    .update({ is_active: false })
    .eq("mint", mint);

  if (!error) {
    console.log(`💀 MARKED DEAD [${mint}]: ${reason}`);
  }
}

startIngestion();

setTimeout(evaluateTokens, 2000);
setTimeout(purgeOldDeadCoins, 5000);

setInterval(evaluateTokens, 3000); // Check DEXScreener every 3 seconds
setInterval(purgeOldDeadCoins, 60 * 60 * 1000); // Purge yesterday's dead coins every hour