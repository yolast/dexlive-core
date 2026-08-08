import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date();
    
    // 1. Calculate Start of Month timestamp
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // 2. Calculate 5:30 AM IST today timestamp (IST is UTC + 5:30)
    // 5:30 AM IST corresponds to 00:00 UTC of the current calendar day in IST
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(now.getTime() + istOffset);
    nowIst.setUTCHours(0, 0, 0, 0);
    const startOf24hIstMs = nowIst.getTime() - istOffset;

    // Fetch counts and tokens from Supabase concurrently
    const [monthlyRes, dailyRes, validRes, momentumRes] = await Promise.all([
      supabase.from('tokens_history').select('*', { count: 'exact', head: true }).gte('created_timestamp', startOfMonth),
      supabase.from('tokens_history').select('*', { count: 'exact', head: true }).gte('created_timestamp', startOf24hIstMs),
      supabase.from('tokens_history').select('*', { count: 'exact', head: true }),
      supabase.from('tokens_history').select('*').order('created_timestamp', { ascending: false }).limit(20)
    ]);

    return NextResponse.json({
      success: true,
      stats: {
        totalMonthlyCoins: monthlyRes.count || 0,
        last24HoursCoins: dailyRes.count || 0,
        eligibleCoins: validRes.count || 0,
      },
      momentumCoins: momentumRes.data || [],
      lastSynced: new Date().toLocaleTimeString()
    });
  } catch (err) {
    console.error("Scanner stats error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}