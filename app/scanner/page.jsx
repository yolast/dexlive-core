"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Zap, ExternalLink, Target, Flame, Brain, Loader2
} from "lucide-react";

const STRATEGIES = [
  { id: "1-2x-breakout", name: "15S Momentum Snipers", icon: Zap }
];

export default function ProScannerHome() {
  const router = useRouter();
  const [stats, setStats] = useState({ todayCoins: 0, dex24hCoins: 0, validCoins: 0 });
  const [momentumCoins, setMomentumCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastSynced, setLastSynced] = useState("");
  
  // Track which tokens are currently being analyzed by Gemini
  const [aiScanning, setAiScanning] = useState({});
  // Store fetched AI scores locally to update the UI instantly
  const [aiResults, setAiResults] = useState({});

  const fetchData = async () => {
    try {
      const res = await fetch('/api/scanner/stats');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        setMomentumCoins(data.momentumCoins || []);
        setLastSynced(data.lastSynced || new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.error("Failed to load scanner stats", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); 
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

  // Phase 2: On-Demand Gemini AI Trigger (Fully Wired to API)
  const handleAiScan = async (mint) => {
    if (aiScanning[mint] || aiResults[mint]?.ai_score) return;

    setAiScanning(prev => ({ ...prev, [mint]: true }));
    
    try {
      // Connect to our new Gemini API route
      const response = await fetch('/api/scanner/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setAiResults(prev => ({
          ...prev,
          [mint]: { 
            ai_score: data.ai_score, 
            reasoning: data.reasoning 
          }
        }));
      } else {
        console.error("AI analysis returned false:", data.error);
      }
    } catch (error) {
      console.error("AI Scan HTTP request failed:", error);
    } finally {
      setAiScanning(prev => ({ ...prev, [mint]: false }));
    }
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
            <span className="text-xs text-slate-400 uppercase tracking-wider">Today Coins Ingested</span>
            <div className="text-2xl font-bold text-emerald-400 mt-1">
              {loading ? "..." : (stats.todayCoins || 0).toLocaleString()}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Total live coins fetched from WebSocket today</p>
          </div>
          <div className="bg-[#111827] border border-slate-800 p-4 rounded-xl shadow-md">
            <span className="text-xs text-slate-400 uppercase tracking-wider">24H DEX Coins (Since 5:30 AM)</span>
            <div className="text-2xl font-bold text-cyan-400 mt-1">
              {loading ? "..." : (stats.dex24hCoins || 0).toLocaleString()}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Confirmed & indexed on DEXScreener</p>
          </div>
          <div className="bg-[#111827] border border-slate-800 p-4 rounded-xl shadow-md">
            <span className="text-xs text-slate-400 uppercase tracking-wider">Valid DexLive Coins</span>
            <div className="text-2xl font-bold text-amber-400 mt-1">
              {loading ? "..." : (stats.validCoins || 0).toLocaleString()}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Surviving strict dead-coin checkpoint filters</p>
          </div>
        </div>

        {/* Strategy Bar */}
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
                  className="flex-shrink-0 flex items-center gap-2.5 px-4 py-3 bg-emerald-900/20 hover:bg-slate-800 border border-emerald-500/30 rounded-xl transition group min-w-[210px] shadow"
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

        {/* 15S Momentum Snipers Feed */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl shadow-xl">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/40">
            <div>
              <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <Flame className="w-4 h-4 text-emerald-400" /> 15S Momentum Snipers (Early Entry)
              </h2>
              <p className="text-[10px] text-slate-500 mt-1">Filtering absolute freshest DEX pairs via SYS Score &gt; 40/70</p>
            </div>
            <span className="text-xs text-slate-400">{momentumCoins.length} Prime Candidates</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                  <th className="p-3">Token</th>
                  <th className="p-3">Age</th>
                  <th className="p-3">Market Cap</th>
                  <th className="p-3">Buy/Sell Ratio</th>
                  <th className="p-3 text-center">Score</th>
                  <th className="p-3 text-center">Deep Scan</th>
                  <th className="p-3 text-right">Action Terminals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {momentumCoins.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="p-8 text-center text-slate-500">
                      {loading ? "Scanning blockchain feeds..." : "No early momentum snipes detected in current window."}
                    </td>
                  </tr>
                ) : (
                  momentumCoins.map((coin) => {
                    const aiData = aiResults[coin.mint] || { ai_score: coin.ai_score, reasoning: "" };
                    const isScanning = aiScanning[coin.mint];
                    const totalScore = coin.sys_score + (aiData.ai_score || 0);

                    return (
                      <tr key={coin.mint} className="hover:bg-slate-800/50 transition">
                        <td className="p-3 font-bold text-white flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 overflow-hidden shrink-0">
                            {coin.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={coin.image_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[10px] text-slate-400">{coin.symbol?.[0] || "$"}</span>
                            )}
                          </div>
                          <div>
                            <div className="text-white truncate max-w-[120px]">{coin.name}</div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-1">
                              {coin.symbol} <span className="text-slate-600">|</span> 
                              <span className="font-mono">{coin.mint.slice(0, 4)}...{coin.mint.slice(-4)}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-slate-300 whitespace-nowrap">{formatCoinAge(coin.created_timestamp)}</td>
                        <td className="p-3 text-slate-300">${Number(coin.market_cap || 0).toLocaleString()}</td>
                        <td className="p-3">
                          <div className="text-emerald-400">{coin.buys} Buys</div>
                          <div className="text-red-400/80 text-[10px]">{coin.sells} Sells ({coin.ratio})</div>
                        </td>
                        <td className="p-3 text-center">
                          <div className={`text-lg font-bold ${totalScore >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {totalScore}
                          </div>
                          <div className="text-[9px] text-slate-500">
                            SYS: {coin.sys_score} {aiData.ai_score ? `| AI: ${aiData.ai_score}` : ''}
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          {aiData.ai_score ? (
                             <div className="bg-emerald-900/20 border border-emerald-500/20 text-emerald-400 px-2 py-1 rounded text-[10px] whitespace-nowrap overflow-hidden text-ellipsis max-w-[140px]" title={aiData.reasoning}>
                               AI Verified ✓
                             </div>
                          ) : (
                            <button
                              onClick={() => handleAiScan(coin.mint)}
                              disabled={isScanning}
                              className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/30 rounded flex items-center justify-center gap-1.5 w-full transition disabled:opacity-50"
                            >
                              {isScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                              {isScanning ? "Scanning" : "Run AI"}
                            </button>
                          )}
                        </td>
                        <td className="p-3 text-right space-x-2 whitespace-nowrap">
                          <a
                            href={`https://dexscreener.com/solana/${coin.mint}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition inline-flex items-center gap-1 text-[10px]"
                          >
                            Dex <ExternalLink className="w-3 h-3" />
                          </a>
                          <a
                            href={`https://axiom.trade/t/${coin.mint}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition inline-flex items-center gap-1 text-[10px]"
                          >
                            Axiom <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}