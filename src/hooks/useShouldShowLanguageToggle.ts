// src/hooks/useShouldShowLanguageToggle.ts
//
// Sep 2026, NEW — decides whether AppTopBar's EN/Hindi toggle should render at
// all. The toggle used to show unconditionally to every visitor, including
// people clearly outside India who have no use for it. This gates it on the
// visitor's apparent country, with two rules that take priority over
// geography entirely:
//
//   1. Explicit override always wins: if this device has EVER actually
//      chosen a language (UI_LANGUAGE_STORAGE_KEY set — see useUiLanguage.ts),
//      the toggle stays visible forever, regardless of what current geography
//      says. Never take away a control someone is actively using — this is
//      what protects Indian diaspora/NRI visitors and anyone whose IP/profile
//      happens to disagree with a real past choice.
//   2. Fail OPEN: whenever geography can't be confidently determined at all
//      (still loading, IP lookup failed/timed out, no profile location set),
//      default to SHOWING the toggle. A non-Indian visitor seeing one
//      unnecessary pill costs nothing; hiding it from an actual Hindi
//      speaker we failed to detect is the worse outcome.
//
// Only when neither of those applies does actual geography decide: the
// signed-in user's profile country (public.user_region_dimensions, same
// table/pattern SettingsLocation.tsx already queries) takes priority, falling
// back to IP geolocation (useIPLocation — real, already-working, ipapi.co-
// backed) only when there's no profile location to answer with. This mirrors
// useIPLocation's existing "skip when the answer already came from elsewhere"
// posture, and avoids burning an ipapi.co call (rate-limited free tier) for
// the ~35% of signed-in users whose profile already has a country set.
//
// Explicitly does NOT affect content-language resolution — useLanguage.ts's
// ?lang= share-link precedence is completely separate and untouched. A
// visitor who doesn't see this toggle can still open a ?lang=hi link and see
// Hindi content exactly as before.

import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { useIPLocation } from "./useIPLocation";
import { UI_LANGUAGE_STORAGE_KEY } from "./useUiLanguage";

function readStoredUiLanguage(): string | null {
  try {
    return window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
  } catch {
    return null; // private browsing / storage disabled — just means no override
  }
}

async function fetchProfileCountryCode(userId: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("user_region_dimensions")
    .select("country_code")
    .eq("user_id", userId)
    .maybeSingle<{ country_code: string | null }>();

  if (error) {
    console.error("[useShouldShowLanguageToggle] failed to load user_region_dimensions", error);
    return null;
  }
  return data?.country_code ?? null;
}

export function useShouldShowLanguageToggle(userId: string | null | undefined): boolean {
  const hasStoredOverride = !!readStoredUiLanguage();

  const {
    data: profileCountryCode,
    isLoading: profileLoading,
    isFetched: profileFetched,
  } = useQuery({
    queryKey: ["user-region-country-code", userId ?? null],
    queryFn: () => fetchProfileCountryCode(userId as string),
    enabled: !!userId && !hasStoredOverride,
    staleTime: 5 * 60_000,
  });

  // Anonymous visitors always need IP-geo. Signed-in visitors only need it as
  // a fallback, and only once we know the profile query has actually
  // resolved to "no country set" — never fire it in parallel with a profile
  // query that's still in flight, and never fire it at all once the override
  // rule already makes the whole lookup moot.
  const needsIpGeo = !hasStoredOverride && (!userId || (profileFetched && !profileCountryCode));
  const { countryCode: ipCountryCode, isLoading: ipLoading } = useIPLocation(needsIpGeo);

  if (hasStoredOverride) return true;

  const resolvedCountryCode = userId ? (profileCountryCode ?? ipCountryCode) : ipCountryCode;

  // Fail open: still resolving, or both signals came back empty.
  if (!resolvedCountryCode) return true;
  if (userId && profileLoading) return true;
  if (needsIpGeo && ipLoading) return true;

  return resolvedCountryCode.toUpperCase() === "IN";
}
