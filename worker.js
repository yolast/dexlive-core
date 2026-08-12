require('dotenv').config({ path: '.env.local', override: true });
require('dotenv').config(); // fallback to .env if present
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const axios = require('axios');

// Verify credentials are present (dotenv reads .env by default, but the
// server keeps secrets in .env.local which Next.js loads automatically)
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Loaded .env.local:', require('fs').existsSync('.env.local'));
  process.exit(1);
}

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

        // 2. Start checking DEXScreener with a short delay for initial liquidity to pool
        setTimeout(() => checkDexScreener(parsedData.mint), 5000); // 5-second delay
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

// Poll DexScreener for batch fresh data every 3 minutes
let hasLastSeenAt = false;
async function probeLastSeenAt() {
  const { error } = await supabase.from('tokens_history').select('last_seen_at').limit(1);
  hasLastSeenAt = !error;
  if (hasLastSeenAt) console.log('✅ last_seen_at column detected');
  else console.warn('⚠️ last_seen_at column not found — freshness bump disabled');
}

async function batchIngestFromDexScreener() {
  try {
    console.log('🔄 [Batch] Starting DexScreener search at', new Date().toISOString());
    const res = await axios.get('https://api.dexscreener.com/latest/dex/search?q=pump', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 30000
    });
    const pairs = (res.data.pairs || []).filter(p => p.chainId === 'solana');

    let synced = 0;
    const nowISO = new Date().toISOString();
    for (const pair of pairs) {
      const mintAddress = pair.baseToken?.address;
      if (!mintAddress) continue;

      const m5PriceChange = Number(pair.priceChange?.m5 || 0);
      const h24PriceChange = Number(pair.priceChange?.h24 || 0);
      const m5Buys = Number(pair.txns?.m5?.buys || 0);
      const m5Sells = Number(pair.txns?.m5?.sells || 0);
      const m5Volume = Number(pair.volume?.m5 || 0);

      let pumpData = null;
      try {
        const pumpRes = await axios.get(`https://frontend-api.pump.fun/coins/${mintAddress}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 2000
        });
        if (pumpRes.status === 200) pumpData = pumpRes.data;
      } catch (_) { /* Pump.fun may block — skip enrichment */ }

      const payload = {
        mint: mintAddress,
        name: pair.baseToken?.name || 'Unknown',
        symbol: pair.baseToken?.symbol || 'MEME',
        is_verified: true,
        is_active: true,
        market_cap: Number(pair.marketCap || 0),
        market_cap_usd: Number(pair.fdv || pair.marketCap || 0),
        fdv: Number(pair.fdv || 0),
        liquidity_usd: Number(pair.liquidity?.usd || 0),
        price_change_m5: m5PriceChange,
        price_change_h1: Number(pair.priceChange?.h1 || 0),
        price_change_h24: h24PriceChange,
        price_change_24h: m5PriceChange || h24PriceChange,
        volume_m5: m5Volume,
        volume_h1: Number(pair.volume?.h1 || 0),
        volume_h24: Number(pair.volume?.h24 || 0),
        volume: m5Volume,
        txns_m5_buys: m5Buys,
        txns_m5_sells: m5Sells,
        txns_h1_buys: Number(pair.txns?.h1?.buys || 0),
        txns_h1_sells: Number(pair.txns?.h1?.sells || 0),
        txns_h24_buys: Number(pair.txns?.h24?.buys || 0),
        txns_h24_sells: Number(pair.txns?.h24?.sells || 0),
        buys: m5Buys,
        sells: m5Sells,
        image_url: pair.info?.imageUrl || null,
        uri: pair.info?.imageUrl || null,
        dex_url: pair.url || `https://dexscreener.com/solana/${mintAddress}`,
        dex_indexed_timestamp: pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now(),
        pump_created_timestamp: pumpData?.created_timestamp || null,
        bonding_curve_progress: pumpData?.bonding_curve_progress || (pumpData?.usd_market_cap > 55000 ? 100 : 0),
        dev_holding_percent: pumpData?.creator_holding_percent || 0,
        is_migrated_raydium: pumpData?.complete || false,
      };
      if (hasLastSeenAt) payload.last_seen_at = nowISO;

      const { error: upsertError } = await supabase
        .from('tokens_history')
        .upsert(payload, { onConflict: 'mint' });
      if (!upsertError) synced++;
      else if (synced < 3) console.error(`[Batch] Upsert error for ${mintAddress}:`, upsertError.message);
    }

    // Dead-coin purge
    const cutoff = Date.now() - 45 * 60 * 1000;
    await supabase.from('tokens_history').delete()
      .lt('dex_indexed_timestamp', cutoff)
      .lt('market_cap', 3000);

    console.log(`✅ [Batch] Synced ${synced} tokens at`, new Date().toISOString());
  } catch (err) {
    console.error('[Batch] Ingest error:', err.message);
  }
}

function startPeriodicBatchIngest() {
  probeLastSeenAt().then(() => {
    batchIngestFromDexScreener(); // run immediately
    setInterval(batchIngestFromDexScreener, 15 * 1000); // every 15 seconds
    console.log('⏰ Periodic batch ingest started (every 15s)');
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
      const m5Buys = buys;
      const m5Sells = sells;
      const m5Vol = volume;
      const h24Change = pair.priceChange?.h24 || 0;
      const updateData = {
        is_verified: true,
        is_active: true,
        name: pair.baseToken.name,
        symbol: pair.baseToken.symbol,
        market_cap_usd: marketCap,
        market_cap: marketCap,
        price_change_24h: priceChange,
        price_change_m5: priceChange,
        price_change_h24: h24Change,
        uri: pair.info?.imageUrl || null,
        image_url: pair.info?.imageUrl || null,
        buys: m5Buys,
        sells: m5Sells,
        volume: m5Vol,
        txns_m5_buys: m5Buys,
        txns_m5_sells: m5Sells,
        volume_m5: m5Vol,
        liquidity_usd: Number(pair.liquidity?.usd || 0),
        dex_indexed_timestamp: pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now(),
      };
      if (hasLastSeenAt) updateData.last_seen_at = new Date().toISOString();

      const { error: updateError } = await supabase
        .from('tokens_history')
        .update(updateData)
        .eq('mint', mint);

      if (updateError) console.error(`DB Update Error for ${mint}:`, updateError.message);
      return; 
    }
    
    // Retry logic if token isn't indexed by DexScreener yet
    if (retries > 0) {
      console.log(`[Retry] ${mint} not found yet. Retrying in 3s... (${retries} left)`);
      setTimeout(() => checkDexScreener(mint, retries - 1), 3000);
    } else {
      console.log(`[Dead] ${mint} failed to index after retries.`);
    }

  } catch (error) {
    console.error(`DexScreener API Error for ${mint}:`, error.message);
  }
}

// Initialize
connectPumpPortal();
startPeriodicBatchIngest();