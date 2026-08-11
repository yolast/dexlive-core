require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const axios = require('axios');

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// PumpPortal WebSocket URL
const PUMP_PORTAL_WS = 'wss://pumpportal.fun/api/data';

// Connect to PumpPortal to listen for new mints
function connectPumpPortal() {
  const ws = new WebSocket(PUMP_PORTAL_WS);

  ws.on('open', () => {
    console.log('✅ Connected to PumpPortal WebSocket');
    // Subscribe to new token creations
    ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
  });

  ws.on('message', async (data) => {
    try {
      const parsedData = JSON.parse(data);
      
      if (parsedData.mint) {
        console.log(`🚀 New Token Minted: ${parsedData.mint}`);
        
        // 1. Save raw mint to DB immediately
        const { error: insertError } = await supabase
          .from('tokens_history')
          .insert([{ 
            mint: parsedData.mint, 
            is_verified: false,
            is_active: false
          }]);

        if (insertError) {
          console.error(`DB Insert Error for ${parsedData.mint}:`, insertError.message);
          return;
        }

        // 2. Start checking DEXScreener with a delay for initial liquidity to pool
        setTimeout(() => checkDexScreener(parsedData.mint), 15000); // 15-second delay
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    console.log('❌ PumpPortal WS disconnected. Reconnecting in 5s...');
    setTimeout(connectPumpPortal, 5000);
  });
}

// Poll DexScreener to verify and map data
async function checkDexScreener(mint, retries = 5) {
  try {
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = res.data;

    if (data && data.pairs && data.pairs.length > 0) {
      // Find the most active Solana pair (usually Raydium or Pumpfun)
      const pair = data.pairs.find(p => p.chainId === 'solana') || data.pairs[0];
      
      const marketCap = pair.fdv || pair.marketCap || 0;
      // Map the 5M data for momentum snipers, fallback to 24h if missing
      const priceChange = pair.priceChange?.m5 || pair.priceChange?.h24 || 0; 
      const buys = pair.txns?.m5?.buys || 0;
      const sells = pair.txns?.m5?.sells || 0;
      const volume = pair.volume?.m5 || 0;

      // 🔴 WIDENED CHECKPOINTS: Let the frontend do the heavy sorting!
      // - Market Cap: $3k to $500k (Captures fast movers blowing past $30k)
      // - Minimum Buys: Dropped to 10 (Captures 15-second early snipes)
      // - Buy/Sell Ratio: Removed the strict 2.0 block here. 
      
      if (marketCap < 3000 || marketCap > 500000) {
        console.log(`[Filtered] ${mint} - Market Cap out of bounds: $${marketCap}`);
        return null;
      }
      
      if (buys < 10) {
         console.log(`[Filtered] ${mint} - Not enough early buys: ${buys}`);
         return null; 
      }

      console.log(`✅ [Verified] Momentum Coin Found! ${mint} | +${priceChange}% | MC: $${marketCap}`);

      // 🟢 MAPPING REAL DATA: Send the exact m5 buys/sells to DB
      const updateData = {
        is_verified: true,
        is_active: true,
        name: pair.baseToken.name,
        symbol: pair.baseToken.symbol,
        market_cap_usd: marketCap,
        price_change_24h: priceChange, // Storing m5/recent gain here so route.js scores it perfectly
        uri: pair.info?.imageUrl || null,
        buys: buys,
        sells: sells,
        volume: volume
      };

      const { error: updateError } = await supabase
        .from('tokens_history')
        .update(updateData)
        .eq('mint', mint);

      if (updateError) console.error(`DB Update Error for ${mint}:`, updateError.message);
      return; 
    }
    
    // Retry logic if token isn't indexed by DexScreener yet
    if (retries > 0) {
      console.log(`[Retry] ${mint} not found yet. Retrying in 10s... (${retries} left)`);
      setTimeout(() => checkDexScreener(mint, retries - 1), 10000);
    } else {
      console.log(`[Dead] ${mint} failed to index after retries.`);
    }

  } catch (error) {
    console.error(`DexScreener API Error for ${mint}:`, error.message);
  }
}

// Initialize
connectPumpPortal();