"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Zap, TrendingUp, ShieldCheck, Activity, Target, 
  BarChart2, Flame, ExternalLink, Terminal, CheckCircle2 
} from "lucide-react";

const STRATEGIES = [
  { id: "1-2x-breakout", name: "15S Momentum Snipers", icon: Zap },
  { id: "2-5x-runner", name: "2-5X Runner", icon: TrendingUp },
  { id: "healthy-pullback", name: "Healthy Pullback (Bull Flag)", icon: BarChart2 },
  { id: "smart-money", name: "Smart Money Net-flow", icon: Activity },
  { id: "buy-sell-ratio", name: "Organic Buy/Sell Ratio Guard", icon: ShieldCheck },
  { id: "bonding-curve", name: "Bonding Curve Graduation Guard", icon: Target },
  { id: "sniper-flush", name: "Sniper Flush Filter", icon: Flame },
  { id: "gain-trigger", name: "100% Gain Trigger", icon: Zap },
];

export default function ProScannerHub() {
  const router = useRouter();
  const [stats, setStats] = useState({ totalMonthlyCoins: 0, last24HoursCoins: 0, eligibleCoins: 0 });
  const [momentumCoins, setMomentumCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastSynced, setLastSynced] = useState("");

  const fetchData = async () => {
    try {
      const res = await fetch('/api/scanner/stats');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setStats(data.stats || { totalMonthlyCoins: 0, last24HoursCoins: 0, eligibleCoins: 0 });
          setMomentumCoins(data.momentumCoins || []);
          setLastSynced(data.lastSynced || new Date().toLocaleTimeString());
        }
      }
    } catch (err) {
      console.error("Failed to load scanner telemetry:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Auto-sync every minute
    return () => clearInterval(interval);
  }, []);

  const formatCoinAge = (timestamp) => {
    if (!timestamp) return "Just now";
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ago`;
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-200 font-mono p-4 md:p-6 space-y-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Top Header & Telemetry Banner */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#111827] border border-slate-800 p-5 rounded-xl shadow-lg">
          <div>
            <h1 className="text-lg md:text-xl font-bold text-emerald-400 tracking-wider flex items-center gap-2">
              <Zap className="w-5 h-5 animate-pulse text-emerald-400" />
              DEXLive ProScanner Hub
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Real-time Solana memecoin telemetry & institutional-grade strategy execution.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs bg-slate-900 px-3 py-2 rounded-lg border border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-slate-300">Auto-syncing</span>
            <span className="text-slate-500">| Last {lastSynced || "Syncing..."}</span>
          </div>
        </div>

        {/* 3 Core Metric Counters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#111827] border border-slate-800 p-4 rounded-xl shadow-md">
            <span className="text-xs text-slate-400 uppercase tracking-wider">Monthly Coins Ingested</span>
            <div className="text-2xl font-bold text-emerald-400 mt-1">
              {loading ? "..." : stats.totalMonthlyCoins.toLocaleString()}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Total mints captured this calendar month</p>
          </div>
          
          <div className="bg-[#111827] border border-slate-800 p-4 rounded-xl shadow-md">
            <span className="text-xs text-slate-400 uppercase tracking-wider">24H Coins (Since 5:30 AM IST)</span>
            <div className="text-2xl font-bold text-cyan-400 mt-1">
              {loading ? "..." : stats.last24HoursCoins.toLocaleString()}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Counter starts daily at 5:30 AM IST</p>
          </div>
          
          <div className="bg-[#111827] border border-slate-800 p-4 rounded-xl shadow-md">
            <span className="text-xs text-slate-400 uppercase tracking-wider">Valid Active Coins (Post-Cleanup)</span>
            <div className="text-2xl font-bold text-amber-400 mt-1">
              {loading ? "..." : stats.eligibleCoins.toLocaleString()}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">After automated dead-coin cleanup filter</p>
          </div>
        </div>

        {/* Horizontal 8 Strategies Navigation Bar */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-400" /> ProScanner Execution Strategies
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-800">
            {STRATEGIES.map((strat) => {
              const Icon = strat.icon;
              return (
                <Link
                  key={strat.id}
                  href={`/proscanner/${strat.id}`}
                  className="flex-shrink-0 flex items-center gap-2.5 px-4 py-3 bg-[#111827] hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/50 rounded-xl transition group min-w-[210px] shadow"
                >
                  <div className="p-2 bg-slate-900 rounded-lg text-emerald-400 group-hover:scale-110 transition">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold text-slate-300 group-hover:text-white truncate">
                    {strat.name}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Top 20 Momentum Snipers Feed (Score > 90) */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/40">
            <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
              <Flame className="w-4 h-4 text-emerald-400" /> Top 20 Momentum Snipers Feed (Score &gt; 90)
            </h2>
            <span className="text-xs text-slate-400">{momentumCoins.length} Live Candidates</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                  <th className="p-3">Token / Ticker</th>
                  <th className="p-3">Mint Address</th>
                  <th className="p-3">Coin Age</th>
                  <th className="p-3">Market Cap</th>
                  <th className="p-3 text-right">Gain (%)</th>
                  <th className="p-3 text-center">Action Terminals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {momentumCoins.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="p-8 text-center text-slate-500">
                      {loading ? "Scanning blockchain feeds..." : "No momentum snipers meeting >90 score criteria right now."}
                    </td>
                  </tr>
                ) : (
                  momentumCoins.map((coin) => (
                    <tr key={coin.mint} className="hover:bg-slate-800/50 transition">
                      <td className="p-3 font-bold text-white flex items-center gap-2">
                        {coin.image_url ? (
                          <img src={coin.image_url} alt="" className="w-6 h-6 rounded-full border border-slate-700" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-emerald-900/50 flex items-center justify-center text-emerald-400 font-bold text-[10px]">
                            {coin.symbol?.[0] || "$"}
                          </div>
                        )}
                        <div>
                          <div className="text-white">{coin.name}</div>
                          <div className="text-[10px] text-slate-400">{coin.symbol}</div>
                        </div>
                      </td>
                      <td className="p-3 font-mono text-slate-400 text-[11px]">
                        {coin.mint.slice(0, 4)}...{coin.mint.slice(-4)}
                      </td>
                      <td className="p-3 text-slate-300">{formatCoinAge(coin.created_timestamp)}</td>
                      <td className="p-3 text-slate-300">${Number(coin.market_cap || 0).toLocaleString()}</td>
                      <td className="p-3 text-right font-bold text-emerald-400">
                        +{Number(coin.price_change_24h || 100).toFixed(0)}%
                      </td>
                      <td className="p-3 text-center space-x-2">
                        <a
                          href={`https://dexscreener.com/solana/${coin.mint}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition inline-flex items-center gap-1 text-[10px]"
                        >
                          Dex <ExternalLink className="w-3 h-3" />
                        </a>
                        <a
                          href={`https://axiom.trade/t/${coin.mint}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition inline-flex items-center gap-1 text-[10px]"
                        >
                          Axiom <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}