// src/lib/fetchCommunityStats.ts
//
// Phase 3 — Shared aggregate fetcher for Community Stance bar.
//
// Reads ONE row directly from public.question_stance_stats_region.
// This replaces all dependence on get_question_distribution(...) for
// community bar rendering.
//
// Why direct table read instead of RPC:
//   - Avoids PostgREST schema cache issues
//   - Avoids RLS problems that affected get_question_distribution
//   - question_stance_stats_region has "Anyone can read" policy
//   - The aggregate is already maintained by DB trigger on every stance change
//   - No time-window filtering edge cases (unlike the old RPC)
//
// Usage:
//   const stats = await fetchCommunityStats(questionId);
//   if (!stats) { /* show empty state */ }

import { getSupabase } from "@/lib/supabaseClient";
import {
  CommunityStanceData,
  RawStanceStatsRegionRow,
  mapToCommunityStanceData,
  COMMUNITY_STANCE_GLOBAL_SCOPE,
  COMMUNITY_STANCE_GLOBAL_KEY,
} from "@/types/communityStance";

// ── Main fetcher ──────────────────────────────────────────────────────────────

/**
 * Fetch the global community stance aggregate for a question.
 *
 * Queries question_stance_stats_region for:
 *   question_id  = questionId
 *   region_scope = 'global'   ← stored DB value, NOT display label
 *   region_key   = 'global'   ← stored DB value, NOT display label
 *
 * Returns null if:
 *   - No row exists yet (no responses)
 *   - Supabase client unavailable
 *   - Any query error
 *
 * @param questionId  UUID of the question
 * @param regionScope Stored DB scope value (default: 'global')
 * @param regionKey   Stored DB key value   (default: 'global')
 */
export async function fetchCommunityStats(
  questionId: string,
  regionScope: string = COMMUNITY_STANCE_GLOBAL_SCOPE,
  regionKey: string   = COMMUNITY_STANCE_GLOBAL_KEY,
): Promise<CommunityStanceData | null> {
  const sb = getSupabase();
  if (!sb) {
    console.warn("[fetchCommunityStats] Supabase client not available");
    return null;
  }

  if (!questionId) {
    console.warn("[fetchCommunityStats] No questionId provided");
    return null;
  }

  try {
    console.log(`[fetchCommunityStats] querying qId=${questionId.slice(0,8)} scope=${regionScope} key=${regionKey}`);

    const { data, error } = await sb
      .from("question_stance_stats_region")
      .select(
        "question_id, region_scope, region_key, region_label, total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at"
      )
      .eq("question_id", questionId)
      .eq("region_scope", regionScope)
      .eq("region_key", regionKey)
      .maybeSingle<RawStanceStatsRegionRow>();

    if (error) {
      console.error("[fetchCommunityStats] Query error:", error);
      return null;
    }

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

// ── TanStack Query key factory ────────────────────────────────────────────────
//
// Use this for consistent cache keys across Hero and QDP.
// Both surfaces should share the same cache entry for the same question.
//
// Usage in useQuery:
//   queryKey: communityStatsKey(questionId)
//   queryFn:  () => fetchCommunityStats(questionId)

export const communityStatsKey = (
  questionId: string,
  regionScope: string = COMMUNITY_STANCE_GLOBAL_SCOPE,
  regionKey: string   = COMMUNITY_STANCE_GLOBAL_KEY,
) => ["community-stats", questionId, regionScope, regionKey] as const;
