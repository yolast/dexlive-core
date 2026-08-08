import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
require('dotenv').config({ path: './.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HELIUS_API_KEY = process.env.Helius_Pixiesly_API;
const WS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

function connectWebSocket() {
  console.log("🔌 Connecting to Solana WebSocket stream...");
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log("🟢 Connected to Helius WebSocket. Subscribing to Pump.fun logs...");
    
    // Subscribe to logs mentioning the Pump.fun program ID
    const subscriptionMessage = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [
        { mentions: [PUMP_FUN_PROGRAM] },
        { commitment: "processed" } // Fastest on-chain commitment level
      ]
    });
    
    ws.send(subscriptionMessage);
  });

  ws.on('message', async (data) => {
    try {
      const response = JSON.parse(data);
      if (response.method === "logsNotification") {
        const result = response.params.result;
        const signature = result.value.signature;
        const logs = result.value.logs;

        // Check if log indicates a successful token creation
        const isCreate = logs.some(log => log.includes("InitializeMint") || log.includes("Create"));
        if (isCreate) {
          console.log(`🚀 New Pump.fun token event detected! Signature: ${signature}`);
          
          // Instantly trigger metadata fetch or queue for 15S candle analysis
          // Write initial record to Supabase tokens_history
          await supabase.from('tokens_history').upsert({
            mint: signature, // Temporary or parsed mint
            name: "Live Streamed Token",
            symbol: "PUMP",
            market_cap: 5000,
            created_timestamp: Date.now(),
            bonding_curve_progress: 15
          }, { onConflict: 'mint' });
        }
      }
    } catch (err) {
      console.error("Error parsing WebSocket message:", err.message);
    }
  });

  ws.on('close', () => {
    console.warn("⚠️ WebSocket disconnected. Reconnecting in 5 seconds...");
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err) => {
    console.error("❌ WebSocket error:", err.message);
    ws.terminate();
  });
}

connectWebSocket();