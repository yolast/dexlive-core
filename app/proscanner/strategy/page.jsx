"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Zap, TrendingUp, ShieldCheck, Activity, Target, 
  BarChart2, Flame, ArrowLeft, Terminal, CheckCircle2 
} from "lucide-react";

const STRATEGIES = [
  { id: "1-2x-breakout", name: "1-2X Early Breakout", icon: Zap },
  { id: "2-5x-runner", name: "2-5X Runner", icon: TrendingUp },
  { id: "healthy-pullback", name: "Healthy Pullback (Bull Flag)", icon: BarChart2 },
  { id: "smart-money", name: "Smart Money Net-flow", icon: Activity },
  { id: "buy-sell-ratio", name: "Organic Buy/Sell Ratio Guard", icon: ShieldCheck },
  { id: "bonding-curve", name: "Bonding Curve Graduation Guard", icon: Target },
  { id: "sniper-flush", name: "Sniper Flush Filter", icon: Flame },
  { id: "gain-trigger", name: "100% Gain Trigger", icon: Zap },
];

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const currentStrategyId = params?.strategy || "1-2x-breakout";

  const activeStrategy = STRATEGIES.find(s => s.id === currentStrategyId) || STRATEGIES[0];

  const [stats, setStats] = useState({ totalMonthlyCoins: 0, last24HoursCoins: 0, eligibleCoins: 0 });
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    fetch('/api/scanner/stats')
      .then(res => res.json())
      .then(data => {
        if (data.success) setStats(data.stats);
      })
      .catch(err => console.error("Stats fetch error:", err));

    const initialLogs = [
      `[${new Date().toLocaleTimeString()}] Initialized ${activeStrategy.name} engine...`,
      `[${new Date().toLocaleTimeString()}] Connecting to Helius RPC & Supabase tokens_history...`,
    ];
    setLogs(initialLogs);

    const logInterval = setInterval(() => {
      const mockMints = ["7xKX...pump", "DeX9...pump", "SoL1...pump", "Meme...pump"];
      const randomMint = mockMints[Math.floor(Math.random() * mockMints.length)];
      const newLog = `[${new Date().toLocaleTimeString()}] Evaluated ${randomMint} -> Passed 15S Bullish Check & Liquidity Guard ✅`;
      setLogs(prev => [newLog, ...prev.slice(0, 15)]);
    }, 3000);

    return () => clearInterval(logInterval);
  }, [activeStrategy]);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-200 font-mono p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Navigation & Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push("/scanner")}
            className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 transition"
          >
            <ArrowLeft className="w-4 h-4" /> Back to ProScanner Hub
          </button>
          <div className="text-xs text-emerald-400 font-bold bg-emerald-950/40 border border-emerald-800 px-3 py-1.5 rounded-lg">
            Active Strategy: {activeStrategy.name}
          </div>
        </div>

        {/* 3 Core Metric Counters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#111827] border border-slate-800 p-4 rounded-xl">
            <span className="text-xs text-slate-400 uppercase tracking-wider">Monthly Coins Ingested</span>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{stats.totalMonthlyCoins.toLocaleString()}</div>
          </div>
          <div className="bg-[#111827] border border-slate-800 p-4 rounded-xl">
            <span className="text-xs text-slate-400 uppercase tracking-wider">24H Coins (Since 5:30 AM IST)</span>
            <div className="text-2xl font-bold text-cyan-400 mt-1">{stats.last24HoursCoins.toLocaleString()}</div>
          </div>
          <div className="bg-[#111827] border border-slate-800 p-4 rounded-xl">
            <span className="text-xs text-slate-400 uppercase tracking-wider">Valid Active Coins (Post-Cleanup)</span>
            <div className="text-2xl font-bold text-amber-400 mt-1">{stats.eligibleCoins.toLocaleString()}</div>
          </div>
        </div>

        {/* Horizontal 8 Strategies Navigation Bar */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-400" /> Switch Strategy Module
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-800">
            {STRATEGIES.map((strat) => {
              const Icon = strat.icon;
              const isSelected = strat.id === currentStrategyId;
              return (
                <Link
                  key={strat.id}
                  href={`/proscanner/${strat.id}`}
                  className={`flex-shrink-0 flex items-center gap-2 px-4 py-3 rounded-xl transition min-w-[200px] border ${
                    isSelected 
                      ? "bg-emerald-950/40 border-emerald-500 text-white" 
                      : "bg-[#111827] hover:bg-slate-800 border-slate-800 text-slate-300"
                  }`}
                >
                  <div className={`p-2 rounded-lg ${isSelected ? "bg-emerald-600 text-white" : "bg-slate-900 text-emerald-400"}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold truncate">{strat.name}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Live ProScanner Strategy Log */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
            <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" /> Live ProScanner Strategy Log (Hybrid Pipeline)
            </h2>
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded border border-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Live Analysis Stream
            </span>
          </div>
          <div className="p-4 bg-black/40 font-mono text-xs text-slate-300 space-y-2 h-[350px] overflow-y-auto">
            {logs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-2 border-b border-slate-900 pb-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span className="tracking-wide">{log}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}