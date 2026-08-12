"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Zap, ExternalLink, Target, Flame, Brain, Loader2, RefreshCw, Database
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
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState("");
  
  // Track which tokens are currently being analyzed by Gemini
  const [aiScanning, setAiScanning] = useState({});
  // Store fetched AI scores locally to update the UI instantly
  const [aiResults, setAiResults] = useState({});
  // Store AI errors per mint so failures are visible
  const [aiErrors, setAiErrors] = useState({});
  // Which mint has its reasoning row expanded
  const [expandedAi, setExpandedAi] = useState(null);
  // Freshness of the DB (seconds since last worker write)
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/scanner/stats');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        // We trust the backend route.js to send the dynamically scored top 20 coins
        setMomentumCoins(data.momentumCoins || []);
        setLastSynced(data.lastSynced || new Date().toLocaleTimeString());
        if (data.db_status?.lastUpdate) {
          setLastUpdate(data.db_status.lastUpdate);
        }
      }
    } catch (err) {
      console.error("Failed to load scanner stats", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Live analysis: poll every 3 seconds
    const interval = setInterval(fetchData, 3000); 
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

  // How stale is the database? (0 = live)
  const dataAgeSeconds = lastUpdate
    ? Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 1000)
    : null;
  const isLive = dataAgeSeconds !== null && dataAgeSeconds <= 30;

  // Phase 2: On-Demand Gemini AI Trigger (The 30-Point Deep Scan Engine)
  const handleAiScan = async (mint) => {
    if (aiScanning[mint] || aiResults[mint]?.ai_score) return;

    setAiScanning(prev => ({ ...prev, [mint]: true }));
    setAiErrors(prev => ({ ...prev, [mint]: null }));
    
    try {
      // Connect to our Gemini API route
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
            sys_score: data.sys_score,
            total_score: data.total_score,
            reasoning: data.reasoning
          }
        }));
      } else {
        setAiErrors(prev => ({ ...prev, [mint]: data.error || "AI scan failed" }));
        console.error("AI analysis returned false:", data.error);
      }
    } catch (error) {
      setAiErrors(prev => ({ ...prev, [mint]: error.message || "AI scan request failed" }));
      console.error("AI Scan HTTP request failed:", error);
    } finally {
      setAiScanning(prev => ({ ...prev, [mint]: false }));
    }
  };

  const handleRunPipeline = async () => {
    setPipelineRunning(true);
    setPipelineResult("");
    try {
      const res = await fetch('/api/cron/ingest');
      const data = await res.json();
      setPipelineResult(data.success 
        ? `Pipeline synced ${data.message}` 
        : `Pipeline error: ${data.error}`);
      fetchData();
    } catch (err) {
      setPipelineResult(`Pipeline request failed: ${err.message}`);
    } finally {
      setPipelineRunning(false);
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
            <span className={`w-2 h-2 rounded-full ${isLive ? "bg-emerald-500 animate-ping" : "bg-amber-500"}`} />
            <span className={isLive ? "text-emerald-400" : "text-amber-400"}>
              {isLive ? "LIVE" : "STALE"}
            </span>
            <span className="text-slate-500">
              {dataAgeSeconds === null ? "..." : `DB updated ${dataAgeSeconds}s ago`}
            </span>
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
              <p className="text-[10px] text-slate-500 mt-1">Filtering absolute freshest DEX pairs via SYS Score &gt; 25/70</p>
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
                    <td colSpan="7" className="p-8 text-center">
                      {loading ? (
                        <span className="text-slate-500">Scanning blockchain feeds...</span>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-center gap-2 text-amber-400">
                            <Database className="w-4 h-4" />
                            <span className="text-sm font-medium">
                              {stats.todayCoins === 0 
                                ? "No tokens in database. Run the pipeline to ingest live data."
                                : `${stats.todayCoins} tokens ingested, ${stats.dex24hCoins} verified, but none passed the SYS Score ≥50 threshold.`}
                            </span>
                          </div>
                          <div className="flex flex-col items-center gap-3">
                            <button
                              onClick={handleRunPipeline}
                              disabled={pipelineRunning}
                              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition inline-flex items-center gap-2 text-sm disabled:opacity-50"
                            >
                              {pipelineRunning ? (
                                <><RefreshCw className="w-4 h-4 animate-spin" /> Running Pipeline...</>
                              ) : (
                                <><RefreshCw className="w-4 h-4" /> Run Data Pipeline</>
                              )}
                            </button>
                            {pipelineResult && (
                              <p className="text-xs text-slate-400">{pipelineResult}</p>
                            )}
                            <p className="text-[10px] text-slate-600 max-w-md">
                              This fetches live Solana tokens from DexScreener and Pump.fun, enriches them with market data, and populates the database. After running, this page auto-refreshes.
                            </p>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  momentumCoins.map((coin) => {
                    const aiData = aiResults[coin.mint] || { ai_score: coin.ai_score, reasoning: "", total_score: null };
                    const isScanning = aiScanning[coin.mint];
                    const aiError = aiErrors[coin.mint];
                    const hasAi = Boolean(aiData.ai_score);
                    const totalScore = aiData.total_score ?? (coin.sys_score + (aiData.ai_score || 0));
                    const showReasoning = expandedAi === coin.mint && hasAi && aiData.reasoning;

                    return (
                      <React.Fragment key={coin.mint}>
                        <tr className="hover:bg-slate-800/50 transition">
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
                          
                          {/* Buy/Sell Pressure */}
                          <td className="p-3">
                            <div className="text-emerald-400">{coin.buys} Buys</div>
                            <div className="text-slate-500 text-[10px]">
                              {coin.sells} Sells (<span className={coin.ratio >= 1.2 ? "text-emerald-400 font-bold" : "text-slate-400"}>{coin.ratio}x</span>)
                            </div>
                          </td>
                          
                          {/* Score — TOTAL = SYS + AI (/100) */}
                          <td className="p-3 text-center">
                            <div className={`text-lg font-bold ${totalScore >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {hasAi ? `TOTAL: ${totalScore}` : totalScore}
                            </div>
                            <div className="text-[9px] text-slate-500">
                              SYS: {coin.sys_score} {hasAi ? `| AI: ${aiData.ai_score}/30` : ''}
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            {hasAi ? (
                              <button
                                onClick={() => setExpandedAi(expandedAi === coin.mint ? null : coin.mint)}
                                className="bg-emerald-900/20 border border-emerald-500/20 text-emerald-400 px-2 py-1 rounded text-[10px] whitespace-nowrap w-full transition hover:bg-emerald-900/40"
                                title={aiData.reasoning}
                              >
                                AI Verified ✓ {showReasoning ? "▲" : "▼"}
                              </button>
                            ) : (
                              <div className="flex flex-col items-center gap-1">
                                <button
                                  onClick={() => handleAiScan(coin.mint)}
                                  disabled={isScanning}
                                  className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/30 rounded flex items-center justify-center gap-1.5 w-full transition disabled:opacity-50"
                                >
                                  {isScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                                  {isScanning ? "Scanning..." : "Run AI"}
                                </button>
                                {aiError && (
                                  <span className="text-[9px] text-red-400 max-w-[150px] text-center leading-tight" title={aiError}>
                                    {aiError.length > 40 ? aiError.slice(0, 40) + "…" : aiError}
                                  </span>
                                )}
                              </div>
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
                        {showReasoning && (
                          <tr className="bg-emerald-950/20 border-t-0">
                            <td colSpan="7" className="px-6 py-3">
                              <div className="text-[11px] text-emerald-300 leading-relaxed border-l-2 border-emerald-500/40 pl-3">
                                <span className="font-bold text-emerald-400">AI Risk Thesis: </span>
                                {aiData.reasoning}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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