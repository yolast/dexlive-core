import WebSocket from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env.local') });

const HELIUS_API_KEY = process.env.Helius_Pixiesly_API;
const WS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

function connectWebSocket() {
  console.log("🔌 Connecting to Solana WebSocket stream...");
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log("🟢 Connected to Helius WebSocket. Subscribing to Pump.fun logs...");
    
    const subscriptionMessage = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [
        { mentions: [PUMP_FUN_PROGRAM] },
        { commitment: "processed" }
      ]
    });
    
    ws.send(subscriptionMessage);
  });

  ws.on('message', async (data) => {
    try {
      const response = JSON.parse(data);
      if (response.method === "logsNotification") {
        const result = response.params.result;
        const signature = result?.value?.signature;
        const logs = result?.value?.logs || [];

        // Check if log indicates a successful token creation
        const isCreate = logs.some(log => 
          typeof log === 'string' && (log.includes("InitializeMint") || log.includes("Create"))
        );

        if (isCreate && signature) {
          console.log(`🚀 New Pump.fun token event detected! Signature: ${signature}`);
          
          // Instantly trigger your OCI server's ingestion endpoint to grab the real token mint & metadata
          try {
            const res = await fetch('http://localhost:3000/api/cron/ingest');
            const resultData = await res.json();
            console.log(`⚡ Instant Ingestion Triggered:`, resultData);
          } catch (fetchErr) {
            console.error("Failed to trigger local ingestion route:", fetchErr.message);
          }
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

if (!HELIUS_API_KEY) {
  console.error("❌ Helius_Pixiesly_API is missing! Check your .env.local file.");
  process.exit(1);
}

connectWebSocket();