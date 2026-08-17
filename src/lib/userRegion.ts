// src/lib/userRegion.ts
// Epic R — best-effort lookup of the user's current region (US-R02).
// Extracted from QuestionDetailPage.tsx (M-R01) so it can be used both
// imperatively (inside the expectation-confirm callback in
// QuestionDetailPage) and reactively (wrapped in useQuery by
// ExpectationSignalBlock, M-R03) without duplicating the query.
//
// Returns null if the user has no location set — question_expectations and
// the M-R03 aggregation views both treat a null region_id as its own group
// (all no-location respondents together), not an error case.

import { getSupabase } from "@/lib/supabaseClient";

export async function fetchUserRegionId(userId: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("user_location_settings")
    .select("location_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[fetchUserRegionId] region lookup failed (non-blocking)", error);
    return null;
  }
  return data?.location_id ?? null;
}
