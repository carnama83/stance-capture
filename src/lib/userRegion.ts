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

//
// A user has one user_location_settings row per level (city, county, state,
// country). The region is the most specific level, decided on the server by
// get_my_primary_region() — the same rule set_my_question_expectations() uses
// to store an expectation's region, so the signal shown is always the one the
// user's own expectation counts towards. (It used to be an unordered LIMIT 1
// here and in the RPC, which could disagree.)

export async function fetchUserRegionId(userId: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb || !userId) return null;

  // The RPC answers for the signed-in caller (auth.uid()); userId only gates the call.
  const { data, error } = await sb.rpc("get_my_primary_region");

  if (error) {
    console.error("[fetchUserRegionId] region lookup failed (non-blocking)", error);
    return null;
  }
  return (data as string | null) ?? null;
}
