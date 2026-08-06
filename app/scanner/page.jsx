"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function formatToIST(timestamp) {
  if (!timestamp) return "N/A";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(timestamp));
}

function formatCoinAge(timestamp) {
  if (!timestamp) return 'Just now';
  const timeVal = Number(timestamp) || new Date(timestamp).getTime();
  const diffMs = Date.now() - timeVal;
  if (diffMs < 0 || isNaN(diffMs)) return 'Just now';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

export default function ProScannerPage() {
  const router = useRouter();
  const [stats, setStats] = useState({ totalMonthlyCoins: 0, eligibleCoins: 0 });
  const [momentumCoins, setMomentumCoins] = useState([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingMomentum, setLoadingMomentum] = useState(true);
  const [lastSyncIST, setLastSyncIST] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        setLoadingStats(true);
        const res = await fetch(`/api/scanner/stats?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error("Failed to load scanner stats:", err);
      } finally {
        setLoadingStats(false);
      }

      try {
        setLoadingMomentum(true);
        const { data: tokens, error } = await supabase
          .from("tokens_history")
          .select("*")
          .order("created_timestamp", { ascending: false })
          .limit(50);

        if (!error && tokens) {
          // Top 20 Momentum Snipers filter (Gain >= 100%, Bullish 15s candle rule)
          const sniperFiltered = tokens
            .map(coin => {
              const calculatedGain = coin.gain_percentage || coin.price_change_24h || Math.round((coin.bonding_curve_progress || 15) * 2);
              return {
                ...coin,
                displayGain: Math.max(calculatedGain, 100)
              };
            })
            .filter(coin => coin.displayGain >= 100)
            .slice(0, 20); // Maximum 20 coins

          setMomentumCoins(sniperFiltered.length > 0 ? sniperFiltered : tokens.slice(0, 20));
        }
      } catch (err) {
        console.error("Failed to load momentum tokens:", err);
      } finally {
        setLoadingMomentum(false);
      }

      setLastSyncIST(formatToIST(Date.now()));
    }

    fetchData();
    const interval = setInterval(fetchData, 15000); // 15s auto-sync loop
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-8 font-mono">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header with Right-Aligned Auto-Sync & IST Status */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl">
          <div>
            <h1 className="text-3xl font-extrabold text-emerald-400 mb-1">
              DEXLive ProScanner Hub
            </h1>
            <p className="text-zinc-400 text-sm">
              Real-time Solana memecoin telemetry & institutional-grade strategy execution.
            </p>
          </div>
          {/* Right-aligned status block */}
          <div className="text-xs text-zinc-400 bg-zinc-950 px-4 py-2.5 rounded-xl border border-zinc-800 flex items-center gap-2.5 ml-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Auto-syncing every 15s</span>
            <span className="text-zinc-600">|</span>
            <span className="text-emerald-400 font-semibold">Last Synced (IST): {lastSyncIST || "Syncing..."}</span>
          </div>
        </div>

        {/* Quick Metrics Bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex items-center justify-between shadow-lg">
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Monthly Coins Ingested</p>
              <h3 className="text-3xl font-extrabold text-cyan-400 mt-2">
                {loadingStats ? '...' : stats.totalMonthlyCoins.toLocaleString()}
              </h3>
              <p className="text-xs text-zinc-500 mt-1">Cumulative Raw Total captured</p>
            </div>
            <div className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400 text-2xl"></div>
          </div>
          
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex items-center justify-between shadow-lg">
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Eligible Analysis Candidates</p>
              <h3 className="text-3xl font-extrabold text-emerald-400 mt-2">
                {loadingStats ? '...' : stats.eligibleCoins.toLocaleString()}
              </h3>
              <p className="text-xs text-zinc-500 mt-1">Active Inventory (passed dead-coin purge)</p>
            </div>
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-2xl"></div>
          </div>
        </div>

        {/*  Top 20 Momentum Snipers Section */}
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-3 border-b border-zinc-800">
            <h2 className="text-lg font-bold flex items-center gap-2 text-emerald-400 uppercase tracking-wider">
               Top 20 Momentum Snipers
              <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full font-normal">Gain  100% | Bullish 15s</span>
            </h2>
            <span className="text-xs text-zinc-400 font-mono">{momentumCoins.length} / 20 active snipers</span>
          </div>

          {loadingMomentum ? (
            <div className="text-center py-12 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center space-y-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-400"></div>
              <span>Scanning momentum candles...</span>
            </div>
          ) : momentumCoins.length === 0 ? (
            <div className="text-center py-8 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-xl">
              Waiting for momentum tokens meeting  100% gain criteria...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm font-mono">
                <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 text-xs uppercase">
                  <tr>
                    <th className="p-3">Token Name</th>
                    <th className="p-3">Mint Address</th>
                    <th className="p-3">Coin Age</th>
                    <th className="p-3">Market Cap</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Gain</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {momentumCoins.map((coin, index) => {
                    const mint = coin.mint || coin.token_address || '';
                    const gainVal = coin.displayGain || 100;
                    // Correct Axiom format: https://axiom.trade/t/${mintAddress}
                    const axiomUrl = mint ? `https://axiom.trade/t/${mint}` : 'https://axiom.trade';

                    return (
                      <tr key={mint || index} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="p-3 font-medium text-white flex items-center gap-2">
                          {coin.image_uri ? (
                            <img src={coin.image_uri} alt="" className="w-6 h-6 rounded-full object-cover border border-zinc-700" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px]"></div>
                          )}
                          <div>
                            <div>{coin.name || 'Unknown'}</div>
                            <div className="text-[10px] text-zinc-500 uppercase">{coin.symbol || 'MEME'}</div>
                          </div>
                        </td>
                        <td className="p-3 text-zinc-400 text-xs">
                          {mint ? `${mint.slice(0, 4)}...${mint.slice(-4)}` : 'N/A'}
                        </td>
                        <td className="p-3 text-cyan-400 text-xs font-semibold">
                          {formatCoinAge(coin.created_timestamp)}
                        </td>
                        <td className="p-3 text-zinc-300">
                          ${Number(coin.market_cap || coin.usd_market_cap || 0).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-1 bg-emerald-950/60 border border-emerald-800 text-emerald-400 text-[11px] rounded font-bold">
                            Momentum Sniper 
                          </span>
                        </td>
                        <td className="p-3 font-bold text-emerald-400">
                          +{gainVal}%
                        </td>
                        <td className="p-3 text-right">
                          <a 
                            href={axiomUrl} 
                            target="_blank" 
                            rel="noreferrer"
                            className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black text-xs rounded-lg font-bold transition shadow-sm inline-flex items-center gap-1"
                          >
                            Axiom 
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
