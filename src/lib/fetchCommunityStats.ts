// src/lib/fetchCommunityStats.ts
//
// Reads ONE row from public.question_stance_stats_region using a raw fetch.
// Uses only the anon key — no JWT or getSession() call needed because the
// table has "Anyone can read" RLS policy (no auth required for reads).
// This avoids the supabase-js internal getSession() lock that can block
// when a background token refresh is in flight after navigation.

import { getSupabase } from "@/lib/supabaseClient";
import {
  CommunityStanceData,
  RawStanceStatsRegionRow,
  mapToCommunityStanceData,
  COMMUNITY_STANCE_GLOBAL_SCOPE,
  COMMUNITY_STANCE_GLOBAL_KEY,
} from "@/types/communityStance";

export async function fetchCommunityStats(
  questionId: string,
  regionScope: string = COMMUNITY_STANCE_GLOBAL_SCOPE,
  regionKey: string   = COMMUNITY_STANCE_GLOBAL_KEY,
): Promise<CommunityStanceData | null> {
  if (!questionId) return null;

  const sb = getSupabase();
  if (!sb) return null;

  const supabaseUrl = (sb as any).supabaseUrl as string;
  const anonKey     = (sb as any).supabaseKey as string;
  if (!supabaseUrl || !anonKey) return null;

  // Raw fetch — no getSession() call. question_stance_stats_region is publicly
  // readable so the anon key alone is sufficient. This prevents the supabase-js
  // auth mutex from blocking this fetch when a token refresh is in flight.
  const params = new URLSearchParams({
    question_id:  `eq.${questionId}`,
    region_scope: `eq.${regionScope}`,
    region_key:   `eq.${regionKey}`,
    select: "question_id,region_scope,region_key,region_label,total_responses,pct_agree,pct_disagree,pct_neutral,avg_score,updated_at",
    limit: "1",
  });

  try {
    console.log(`[fetchCommunityStats] querying qId=${questionId.slice(0,8)} scope=${regionScope} key=${regionKey}`);

    const res = await fetch(
      `${supabaseUrl}/rest/v1/question_stance_stats_region?${params}`,
      {
        headers: {
          "apikey": anonKey,
          "Accept": "application/json",
        },
      }
    );

    if (!res.ok) {
      console.error("[fetchCommunityStats] HTTP error:", res.status);
      return null;
    }

    const rows = await res.json() as RawStanceStatsRegionRow[];
    const data = rows[0] ?? null;

    if (!data) {
      console.warn(`[fetchCommunityStats] ✗ no global row yet for qId=${questionId.slice(0,8)}`);
      return null;
    }

    console.log(`[fetchCommunityStats] ✓ found row — responses=${data.total_responses} agree=${data.pct_agree}% disagree=${data.pct_disagree}% neutral=${data.pct_neutral}%`);
    return mapToCommunityStanceData(data);
  } catch (e) {
    console.error("[fetchCommunityStats] Unexpected error:", e);
    return null;
  }
}

export const communityStatsKey = (
  questionId: string,
  regionScope: string = COMMUNITY_STANCE_GLOBAL_SCOPE,
  regionKey: string   = COMMUNITY_STANCE_GLOBAL_KEY,
) => ["community-stats", questionId, regionScope, regionKey] as const;
