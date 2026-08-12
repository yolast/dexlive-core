import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Robust JSON extraction — strips markdown fences and finds the first {...} block
function extractJson(text) {
  if (!text) return null;
  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (__) {
        return null;
      }
    }
    return null;
  }
}

// Mirror of the stats route's 70-point systematic score so
// TOTAL = SYS(70) + AI(30) is computed consistently server-side.
function calculateSysScore(coin) {
  let score = 0;
  const mc = coin.market_cap_usd || coin.market_cap || 0;
  const gain = coin.price_change_24h || coin.price_change_h24 || coin.price_change_m5 || 0;

  const buys = coin.buys || coin.txns_m5_buys || coin.txns_h24_buys || 0;
  const sells = coin.sells || coin.txns_m5_sells || coin.txns_h24_sells || 0;
  const ratio = sells > 0 ? (buys / sells) : (buys > 0 ? buys : 0);

  if (gain < -20 || (sells > buys * 3 && buys > 0)) {
    return { sys_score: 0, buys, sells, ratio: ratio.toFixed(1) };
  }

  if (mc >= 4000 && mc <= 500000) score += 15;
  else if (mc > 500000 && mc <= 2000000) score += 10;
  else if (mc > 1000 && mc < 4000) score += 5;

  if (gain >= 100) score += 20;
  else if (gain >= 50) score += 15;
  else if (gain >= 20) score += 10;
  else if (gain > 0) score += 5;

  if (ratio >= 2.0) score += 15;
  else if (ratio >= 1.2) score += 10;
  else if (ratio >= 0.8) score += 5;

  score += 20;

  if (buys > 0 || sells > 0 || (coin.volume || coin.volume_h24 || 0) > 0) {
    score += 5;
  }

  return {
    sys_score: Math.min(score, 70),
    buys,
    sells,
    ratio: ratio.toFixed(1)
  };
}

export async function POST(req) {
  try {
    const { mint } = await req.json();

    if (!mint) {
      return NextResponse.json({ success: false, error: "Mint address required" }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "GEMINI_API_KEY is not configured on the server" },
        { status: 500 }
      );
    }

    // 1. Fetch exact token data from Supabase
    const { data: coin, error: dbError } = await supabase
      .from("tokens_history")
      .select("*")
      .eq("mint", mint)
      .single();

    if (dbError || !coin) {
      return NextResponse.json({ success: false, error: "Token not found in database for analysis." }, { status: 404 });
    }

    // 2. Prepare the AI Payload — rich telemetry for the model to judge
    const mc = coin.market_cap_usd || coin.market_cap || 0;
    const gain = coin.price_change_24h || coin.price_change_h24 || coin.price_change_m5 || 0;
    const buys = coin.buys || coin.txns_m5_buys || coin.txns_h24_buys || 0;
    const sells = coin.sells || coin.txns_m5_sells || coin.txns_h24_sells || 0;
    const volume = coin.volume || coin.volume_m5 || coin.volume_h24 || 0;
    const liquidity = coin.liquidity_usd || 0;

    const analysisPayload = {
      name: coin.name,
      symbol: coin.symbol,
      market_cap_usd: mc,
      price_change_pct: gain,
      volume_usd: volume,
      liquidity_usd: liquidity,
      buys,
      sells,
      buy_sell_ratio: sells > 0 ? (buys / sells).toFixed(2) : "N/A",
      age_minutes: coin.created_at
        ? Math.floor(Math.max(0, Date.now() - new Date(coin.created_at).getTime()) / 60000)
        : "Unknown",
      holder_dev_percent: coin.dev_holding_percent ?? "Unknown",
      bonding_curve_progress: coin.bonding_curve_progress ?? "Unknown"
    };

    // 3. The Institutional HFT Prompt — 30-point on-click engine
    const prompt = `
      You are an elite high-frequency trading risk assessor for Solana memecoins.
      Analyze the following live telemetry for a token.

      TOKEN DATA:
      ${JSON.stringify(analysisPayload)}

      SCORING CRITERIA (Max 30 Points Total):
      1. Wash-Trading/Bot Detection (0-15 points): Penalize if buys/sells look perfectly artificial or bot-driven. Reward organic-looking friction (varied wallet sizes, natural buy/sell cadence).
      2. Smart Money Conviction & Narrative (0-15 points): Evaluate whether this is a viral meta with strong narrative/symbol, and momentum relative to age.

      CALIBRATION: Use the FULL 0-30 range. A genuinely promising token with real buy pressure
      and a hot narrative should score 20-30. A suspicious or low-conviction token scores 0-10.
      Reserve 1-3 only for tokens that are clear wash-trading honeypots.

      OUTPUT STRICTLY AS JSON. Do not include markdown formatting like \`\`\`json.
      Format exactly like this:
      {
        "ai_score": <integer between 0 and 30>,
        "reasoning": "<A strict, 1-sentence analytical thesis explaining the risk or conviction level>"
      }
    `;

    // 4. Execute Gemini Model (Forcing JSON response)
    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      generationConfig: { responseMimeType: "application/json" }
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    if (!responseText) {
      return NextResponse.json({ success: false, error: "Gemini returned an empty response." }, { status: 502 });
    }

    const aiData = extractJson(responseText);
    if (!aiData || aiData.ai_score === undefined) {
      return NextResponse.json(
        { success: false, error: "Gemini returned unparseable output.", raw: responseText.slice(0, 300) },
        { status: 502 }
      );
    }

    // Ensure safe integer within 0-30
    const finalAiScore = Math.min(30, Math.max(0, parseInt(aiData.ai_score, 10) || 0));
    const reasoning = typeof aiData.reasoning === "string" ? aiData.reasoning : "No reasoning provided.";

    // Compute the CURRENT systematic score (not stored in DB — it's derived)
    const sysScoring = calculateSysScore(coin);
    const sysScore = sysScoring.sys_score;

    // 5. Save AI results back to Supabase so we don't have to scan it again
    const { error: updateError } = await supabase
      .from("tokens_history")
      .update({
        ai_score: finalAiScore,
        ai_reasoning: reasoning,
        ai_analyzed_at: new Date().toISOString()
      })
      .eq("mint", mint);

    if (updateError) console.error("Failed to persist AI score:", updateError.message);

    // 6. Return payload to frontend: TOTAL = SYS(70) + AI(30) = /100
    return NextResponse.json({
      success: true,
      ai_score: finalAiScore,
      sys_score: sysScore,
      total_score: sysScore + finalAiScore,
      reasoning
    });

  } catch (error) {
    console.error("AI Analysis Error:", error);
    const msg = error?.message?.includes("API key")
      ? "Gemini API key is invalid or expired. Check GEMINI_API_KEY on the server."
      : error?.message || "Unknown AI analysis error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
