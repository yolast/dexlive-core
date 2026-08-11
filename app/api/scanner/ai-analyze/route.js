import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function POST(req) {
  try {
    const { mint } = await req.json();

    if (!mint) {
      return NextResponse.json({ success: false, error: "Mint address required" }, { status: 400 });
    }

    // 1. Fetch exact token data from Supabase
    const { data: coin, error: dbError } = await supabase
      .from("tokens_history")
      .select("*")
      .eq("mint", mint)
      .single();

    if (dbError || !coin) {
      throw new Error("Token not found in database for analysis.");
    }

    // 2. Prepare the AI Payload
    // We pass the raw telemetry data to Gemini to evaluate wash trading and conviction.
    const analysisPayload = {
      name: coin.name,
      symbol: coin.symbol,
      market_cap: coin.market_cap_usd,
      price_change_1h: coin.price_change_24h, // Stored as 24h in your DB schema but acts as current session
      age_minutes: Math.floor((Date.now() - new Date(coin.created_at).getTime()) / 60000),
      buys: coin.buys || "Unknown",
      sells: coin.sells || "Unknown"
    };

    // 3. The Institutional HFT Prompt
    const prompt = `
      You are an elite high-frequency trading risk assessor for Solana memecoins.
      Analyze the following live telemetry for a token launched in the last 30 minutes.
      
      TOKEN DATA:
      ${JSON.stringify(analysisPayload)}

      SCORING CRITERIA (Max 30 Points Total):
      1. Wash-Trading/Bot Detection (0-15 points): Penalize if buys/sells look perfectly artificial. Reward organic looking friction.
      2. Smart Money Conviction (0-15 points): Evaluate narrative/symbol and momentum relative to age. 

      OUTPUT STRICTLY AS JSON. Do not include markdown formatting like \`\`\`json. 
      Format exactly like this:
      {
        "ai_score": <integer between 0 and 30>,
        "reasoning": "<A strict, 1-sentence analytical thesis explaining the risk or conviction level>"
      }
    `;

    // 4. Execute Gemini Model (Forcing JSON response)
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });
    
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const aiData = JSON.parse(responseText);

    // Ensure safe integer
    const finalAiScore = parseInt(aiData.ai_score, 10) || 0;

    // 5. Save AI results back to Supabase so we don't have to scan it again
    await supabase
      .from("tokens_history")
      .update({
        ai_score: finalAiScore,
        ai_reasoning: aiData.reasoning,
        ai_analyzed_at: new Date().toISOString()
      })
      .eq("mint", mint);

    // 6. Return payload to frontend
    return NextResponse.json({
      success: true,
      ai_score: finalAiScore,
      reasoning: aiData.reasoning
    });

  } catch (error) {
    console.error("AI Analysis Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}