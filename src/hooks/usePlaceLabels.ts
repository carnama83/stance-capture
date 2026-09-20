// src/hooks/usePlaceLabels.ts
//
// PR 1.5 — localize COUNTRY names that arrive as labels rather than codes.
//
// Question rows carry audience_location_label as free text ("United States",
// "Maharashtra", "Bhopal, India"). Intl.DisplayNames needs an ISO code, so a
// bare label cannot be localized directly. public.locations already holds every
// country with its iso_code, so the label → code map is a 15-row lookup.
//
// Only COUNTRIES are localized. Cities, states and composite labels pass
// through untouched: CLDR has no data for them, and inventing transliterations
// for place names is exactly the kind of guess that produces a wrong name in a
// language the author cannot read. A Hindi page showing "Maharashtra" in Latin
// script is mildly untidy; showing a mistransliterated district name is worse.

import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { regionDisplayName } from "@/lib/intlFormat";

type CountryRow = { name: string; iso_code: string | null };

export function usePlaceLabels(languageCode: string) {
  const query = useQuery<Map<string, string>>({
    queryKey: ["country-codes-by-label"],
    staleTime: 60 * 60_000, // country list is effectively static
    queryFn: async () => {
      const map = new Map<string, string>();
      const sb = getSupabase();
      if (!sb) return map;

      const { data, error } = await sb
        .from("locations")
        .select("name, iso_code")
        .eq("type", "country");

      if (error) {
        console.warn("[usePlaceLabels] falling back to raw labels", error);
        return map;
      }
      for (const row of (data ?? []) as CountryRow[]) {
        // Keyed case-insensitively: labels are authored by hand upstream.
        if (row.name && row.iso_code) map.set(row.name.trim().toLowerCase(), row.iso_code);
      }
      return map;
    },
  });

  const byLabel = query.data ?? new Map<string, string>();

  /**
   * Localized country name when `label` names a country we know; the original
   * label otherwise.
   */
  const placeLabel = (label: string | null | undefined): string => {
    const raw = (label ?? "").trim();
    if (!raw) return "";
    const code = byLabel.get(raw.toLowerCase());
    if (!code) return raw;
    return regionDisplayName(languageCode, code, raw);
  };

  return { placeLabel, isLoading: query.isLoading };
}
