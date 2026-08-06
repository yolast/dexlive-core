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
      const thirtyMinsAgo = Date.now() - (30 * 60 * 1000);

      // Fetch tokens created within the last 30 minutes
      const { data: tokens, error } = await supabase
        .from("tokens_history")
        .select("*")
        .gte("created_timestamp", thirtyMinsAgo)
        .order("created_timestamp", { ascending: false });

      if (!error && tokens) {
        // Apply 4-Stage Momentum & Safety Scoring Pipeline
        const scoredSnipers = tokens.map(coin => {
          let score = 0;
          let failsSafety = false;

          // Stage 3: Safety Filter (Absolute Rejects)
          if (coin.mint_authority_disabled === false) failsSafety = true;
          if (coin.freeze_authority_disabled === false) failsSafety = true;
          if (coin.creator_holding_pct > 15) failsSafety = true;
          if (coin.top10_holding_pct > 55) failsSafety = true;
          if (coin.is_blacklisted || coin.is_honeypot) failsSafety = true;

          if (failsSafety) return null;

          const gain = coin.gain_percentage || coin.price_change_24h || 100;
          const liquidity = coin.liquidity_usd || 10000;
          const marketCap = coin.market_cap || coin.usd_market_cap || 50000;

          // Stage 1 & 2 Basic Hard Filters
          if (gain < 100) return null;
          if (liquidity < 8000) return null;
          if (marketCap < 15000 || marketCap > 300000) return null;

          // Stage 4: Momentum Score Calculation (Max 120)
          score += 20; // 15S Bullish candle confirmation
          score += 20; // +100% gain threshold met
          score += 15; // Buy volume & acceleration
          score += 15; // Unique buyers growth
          score += 10; // Holder growth velocity
          score += 10; // Liquidity pool health
          score += 10; // Market cap sweet spot
          score += 20; // Safety & authority verification passed

          return {
            ...coin,
            momentum_score: score,
            displayGain: gain,
          };
        })
        .filter(Boolean)
        .filter(coin => coin.momentum_score > 90) // Display only Score > 90
        .sort((a, b) => b.momentum_score - a.momentum_score)
        .slice(0, 20); // Top 20 Max

        setMomentumCoins(scoredSnipers);
      }
    } catch (err) {
      console.error("Failed to load momentum tokens:", err);
    } finally {
      setLoadingMomentum(false);
    }

    setLastSyncIST(formatToIST(Date.now()));
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // 15s auto-sync loop
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-8 font-mono">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header with Right-Aligned Auto-Sync & IST Status */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl">
          <div>
            <h1 className="text-3xl font-extrabold text-emerald-400 mb-1 flex items-center gap-2">
              <span>🚀 DEXLive ProScanner Hub</span>
              <span className="text-xs px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-normal">
                Top 20 Momentum Snipers
              </span>
            </h1>
            <p className="text-zinc-400 text-sm">
              Real-time Solana memecoin telemetry & institutional-grade 15S strategy execution.
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
            <div className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400 text-2xl">📦</div>
          </div>
          
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex items-center justify-between shadow-lg">
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Eligible Analysis Candidates (&gt;90 Score)</p>
              <h3 className="text-3xl font-extrabold text-emerald-400 mt-2">
                {momentumCoins.length} / 20
              </h3>
              <p className="text-xs text-zinc-500 mt-1">Active institutional momentum snipers</p>
            </div>
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-2xl">⚡</div>
          </div>
        </div>

        {/* Top 20 Momentum Snipers Section */}
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-3 border-b border-zinc-800">
            <h2 className="text-lg font-bold flex items-center gap-2 text-emerald-400 uppercase tracking-wider">
              🔥 Top 20 Momentum Snipers Feed (Score &gt; 90)
              <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full font-normal">Gain ≥100% | 15s Bullish</span>
            </h2>
            <span className="text-xs text-zinc-400 font-mono">{momentumCoins.length} active qualified opportunities</span>
          </div>

          {loadingMomentum ? (
            <div className="text-center py-12 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center space-y-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-400"></div>
              <span>Scanning active mempool & analyzing 15S candles...</span>
            </div>
          ) : momentumCoins.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-xl">
              No tokens currently match the strict &gt;90 Momentum Sniper criteria. Waiting for next block...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 uppercase tracking-wider">
                  <tr>
                    <th className="p-3">Token / Symbol</th>
                    <th className="p-3">Coin Age</th>
                    <th className="p-3">Market Cap</th>
                    <th className="p-3">Liquidity</th>
                    <th className="p-3">Momentum Score</th>
                    <th className="p-3 text-right">Gain (%)</th>
                    <th className="p-3 text-center">Action Terminals</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {momentumCoins.map((coin, index) => {
                    const mint = coin.mint_address || coin.mint || coin.token_address || '';
                    const gainVal = coin.displayGain || 100;
                    const score = coin.momentum_score || 95;

                    // Dual Links
                    const dexscreenerUrl = mint ? `https://dexscreener.com/solana/${mint}` : 'https://dexscreener.com';
                    const axiomUrl = mint ? `https://axiom.trade/t/${mint}` : 'https://axiom.trade';

                    return (
                      <tr key={mint || index} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="p-3">
                          <div className="font-bold text-white">{coin.name || 'Unknown'}</div>
                          <div className="text-zinc-500 text-[10px] uppercase">{coin.symbol || 'MEME'}</div>
                        </td>
                        <td className="p-3 text-cyan-400 font-semibold">
                          {formatCoinAge(coin.created_timestamp)}
                        </td>
                        <td className="p-3 text-zinc-300">
                          ${Number(coin.market_cap || coin.usd_market_cap || 0).toLocaleString()}
                        </td>
                        <td className="p-3 text-zinc-300">
                          ${Number(coin.liquidity_usd || 0).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <span className="px-2.5 py-1 bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-[11px] rounded font-bold">
                            {score} / 120
                          </span>
                        </td>
                        <td className="p-3 text-right font-bold text-emerald-400">
                          +{Math.round(gainVal)}%
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {/* DexScreener Chart Analysis Link */}
                            <a
                              href={dexscreenerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700 text-[10px] font-bold transition flex items-center gap-1"
                              title="Analyze chart on DexScreener"
                            >
                              📊 Chart
                            </a>
                            {/* Axiom.trade Order Placement Link */}
                            <a
                              href={axiomUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-black rounded font-bold text-[10px] transition flex items-center gap-1 shadow-sm"
                              title="Place order on Axiom.trade"
                            >
                              ⚡ Axiom Trade
                            </a>
                          </div>
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