import { supabase } from "@/lib/supabase";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req) {
  try {
    const body = await req.json();
    let { mint, strategy } = body;

    // If no explicit mint was provided, select the latest active token from Supabase based on strategy
    if (!mint) {
      const { data: latestTokens, error: fetchError } = await supabase
        .from('tokens_history')
        .select('*')
        .order('created_timestamp', { ascending: false })
        .limit(1);

      if (fetchError || !latestTokens || latestTokens.length === 0) {
        return new Response(JSON.stringify({ success: false, reason: "No active tokens found in Supabase database to analyze." }), { status: 200 });
      }
      mint = latestTokens[0].mint;
    }

    // 1. Fetch target token record from Supabase
    const { data: token, error } = await supabase
      .from('tokens_history')
      .select('*')
      .eq('mint', mint)
      .single();

    if (error || !token) {
      return new Response(JSON.stringify({ success: false, reason: "Token record not found." }), { status: 200 });
    }

    const rawData = token.raw_payload || {};

    // 2. SYSTEMATIC PRE-CHECK (Deterministic fast validation)
    const liquidity = rawData.usd_market_cap || token.market_cap || 0;
    if (liquidity < 3000) {
      return new Response(JSON.stringify({ 
        success: false, 
        stage: "Systematic Filter",
        reason: `Strategy [${strategy || 'Default'}] filtered out token: Liquidity below minimum threshold (<$3,000).` 
      }), { status: 200 });
    }

    // 3. GEMINI AI QUALITATIVE ANALYSIS
    const gmgnSystemPrompt = `You are an Elite Solana On-Chain Wallet Intelligence Analyst. Evaluate smart-money behavior and conviction for token: ${JSON.stringify(rawData)}. Output score out of 100 and structured breakdown.`;
    
    const gmgnResponse = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: gmgnSystemPrompt,
    });
    const gmgnText = gmgnResponse.text();

    const dexSystemPrompt = `You are an Elite Solana DEXScreener Technical Analyst. Interpret price trend health and entry timing for token: ${JSON.stringify(rawData)}. Output score out of 100 and phase breakdowns.`;

    const dexResponse = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: dexSystemPrompt,
    });
    const dexText = dexResponse.text();

    // 4. Update Supabase record
    await supabase
      .from('tokens_history')
      .update({
        verification_status: 'VERIFIED',
        gmgn_report: { report: gmgnText },
        dex_report: { report: dexText }
      })
      .eq('mint', mint);

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Strategy audit completed successfully for [${strategy || 'Standard'}].`,
      gmgn: gmgnText,
      dex: dexText
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Verification Pipeline Error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }, { status: 500 }));
  }
}