require('dotenv').config({ path: '.env.local', override: true });
require('dotenv').config(); // fallback to .env if present
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const axios = require('axios');

// Verify credentials are present. Do NOT exit — if env is missing we keep
// the process alive so PM2 doesn't crash-loop-stop it; the batch loop will
// simply retry each cycle and succeed once the environment is available.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. .env.local exists:', require('fs').existsSync('.env.local'));
}

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

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

  ws.on('error', (err) => {
    // CRITICAL: without this handler an 'error' event throws an uncaught
    // exception and kills the whole worker (crash-loop -> PM2 stops it)
    console.error('❌ PumpPortal WS error:', err.message || err);
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

// Keep the process alive even if a callback throws — a WS/API hiccup must
// never take down the whole ingestion daemon.
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught exception (worker continues):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled rejection (worker continues):', reason?.message || reason);
});

// Poll DexScreener for batch fresh data every 3 minutes
let hasLastSeenAt = false;
let existingColumns = null;

async function probeSchema() {
  if (!supabase) {
    console.error('❌ Supabase client not initialized (env missing) — will retry next cycle');
    return;
  }
  try {
    // last_seen_at support
    const { error } = await supabase.from('tokens_history').select('last_seen_at').limit(1);
    hasLastSeenAt = !error;
    if (hasLastSeenAt) console.log('✅ last_seen_at column detected');
    else console.warn('⚠️ last_seen_at column not found — freshness bump disabled');

    // actual column set — writing a missing column fails the whole upsert
    const { data } = await supabase.from('tokens_history').select('*').limit(1);
    if (data && data[0]) {
      existingColumns = new Set(Object.keys(data[0]));
      console.log(`✅ tokens_history columns detected (${existingColumns.size})`);
    } else {
      existingColumns = new Set(['mint', 'name', 'symbol', 'is_verified', 'is_active',
        'market_cap_usd', 'price_change_24h', 'buys', 'sells', 'volume', 'uri',
        'created_at', 'last_seen_at', 'dex_indexed_timestamp']);
      console.warn('⚠️ Table empty — using minimal fallback column set');
    }
  } catch (err) {
    console.error('⚠️ Schema probe failed, using minimal fallback:', err.message);
    existingColumns = new Set(['mint', 'name', 'symbol', 'is_verified', 'is_active',
      'market_cap_usd', 'price_change_24h', 'buys', 'sells', 'volume', 'uri',
      'created_at', 'last_seen_at', 'dex_indexed_timestamp']);
    hasLastSeenAt = true;
  }
}

function sanitizePayload(payload) {
  if (!existingColumns) return payload;
  return Object.fromEntries(Object.entries(payload).filter(([key]) => existingColumns.has(key)));
}

// Fetch fresh Solana pairs from several DexScreener queries, deduped by mint
async function fetchFreshPairs() {
  const terms = ['pump', 'raydium'];
  const byMint = new Map();
  for (const term of terms) {
    try {
      const res = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${term}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 20000
      });
      for (const p of (res.data.pairs || [])) {
        if (p.chainId !== 'solana' || !p.baseToken?.address) continue;
        const addr = p.baseToken.address;
        const existing = byMint.get(addr);
        const hasTxns = (p.txns?.m5?.buys || 0) > 0 || (p.txns?.h24?.buys || 0) > 0;
        const existingHasTxns = existing && ((existing.txns?.m5?.buys || 0) > 0 || (existing.txns?.h24?.buys || 0) > 0);
        if (!existing || (hasTxns && !existingHasTxns)) byMint.set(addr, p);
      }
    } catch (_) { /* skip failed query */ }
  }
  return [...byMint.values()];
}

async function batchIngestFromDexScreener() {
  if (!supabase) {
    console.error('❌ Supabase client not initialized (env missing) — skipping batch');
    return;
  }
  try {
    console.log('🔄 [Batch] Starting DexScreener search at', new Date().toISOString());
    const pairs = await fetchFreshPairs();
    console.log(`[Batch] Search returned ${pairs.length} unique Solana pairs`);

    let synced = 0;
    let failed = 0;
    const nowISO = new Date().toISOString();
    for (const pair of pairs) {
      const mintAddress = pair.baseToken?.address;
      if (!mintAddress) continue;

      const m5PriceChange = Number(pair.priceChange?.m5 || 0);
      const h24PriceChange = Number(pair.priceChange?.h24 || 0);
      const m5Buys = Number(pair.txns?.m5?.buys || 0);
      const h1Buys = Number(pair.txns?.h1?.buys || 0);
      const h24Buys = Number(pair.txns?.h24?.buys || 0);
      const m5Sells = Number(pair.txns?.m5?.sells || 0);
      const h1Sells = Number(pair.txns?.h1?.sells || 0);
      const h24Sells = Number(pair.txns?.h24?.sells || 0);
      const m5Volume = Number(pair.volume?.m5 || 0);
      const h1Volume = Number(pair.volume?.h1 || 0);
      const h24Volume = Number(pair.volume?.h24 || 0);

      const buys = m5Buys > 0 ? m5Buys : (h1Buys > 0 ? h1Buys : h24Buys);
      const sells = m5Sells > 0 ? m5Sells : (h1Sells > 0 ? h1Sells : h24Sells);
      const volume = m5Volume > 0 ? m5Volume : (h1Volume > 0 ? h1Volume : h24Volume);

      // NOTE: pump.fun per-coin enrichment is intentionally skipped — its
      // columns (pump_created_timestamp, bonding_curve_progress, ...) don't
      // exist in the production table and would be dropped by sanitization.
      // Skipping keeps each batch cycle to ~2-3s so freshness stays live.

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
        volume_h1: h1Volume,
        volume_h24: h24Volume,
        volume,
        txns_m5_buys: m5Buys,
        txns_m5_sells: m5Sells,
        txns_h1_buys: h1Buys,
        txns_h1_sells: h1Sells,
        txns_h24_buys: h24Buys,
        txns_h24_sells: h24Sells,
        buys,
        sells,
        image_url: pair.info?.imageUrl || null,
        uri: pair.info?.imageUrl || null,
        dex_url: pair.url || `https://dexscreener.com/solana/${mintAddress}`,
        // dex_indexed_timestamp is TIMESTAMPTZ in production — must write ISO, not epoch ms
        dex_indexed_timestamp: new Date(pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now()).toISOString(),
      };
      if (hasLastSeenAt) payload.last_seen_at = nowISO;

      const cleanPayload = sanitizePayload(payload);

      const { error: upsertError } = await supabase
        .from('tokens_history')
        .upsert(cleanPayload, { onConflict: 'mint' });
      if (!upsertError) synced++;
      else {
        failed++;
        if (failed <= 3) console.error(`[Batch] Upsert error for ${mintAddress}:`, upsertError.message);
      }
    }

    // Dead-coin purge (dex_indexed_timestamp is TIMESTAMPTZ, market_cap_usd exists)
    const cutoff = Date.now() - 45 * 60 * 1000;
    const { error: purgeError } = await supabase.from('tokens_history').delete()
      .lt('dex_indexed_timestamp', new Date(cutoff).toISOString())
      .lt('market_cap_usd', 3000);
    if (purgeError) console.error('[Batch] Purge error:', purgeError.message);

    console.log(`✅ [Batch] Synced ${synced}, failed ${failed} tokens at`, new Date().toISOString());
  } catch (err) {
    console.error('[Batch] Ingest error:', err.message);
  }
}

function startPeriodicBatchIngest() {
  probeSchema().then(() => {
    batchIngestFromDexScreener(); // run immediately
    setInterval(batchIngestFromDexScreener, 15 * 1000); // every 15 seconds
    console.log('⏰ Periodic batch ingest started (every 15s)');
  }).catch((err) => {
    // Never let a startup probe failure take down the process
    console.error('⚠️ Schema probe rejected, starting batch anyway:', err.message);
    batchIngestFromDexScreener();
    setInterval(batchIngestFromDexScreener, 15 * 1000);
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
        dex_indexed_timestamp: new Date(pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now()).toISOString(),
      };
      if (hasLastSeenAt) updateData.last_seen_at = new Date().toISOString();

      const cleanUpdate = sanitizePayload(updateData);

      const { error: updateError } = await supabase
        .from('tokens_history')
        .update(cleanUpdate)
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