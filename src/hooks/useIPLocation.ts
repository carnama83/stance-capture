// src/hooks/useIPLocation.ts
// Detects a visitor's country via IP geolocation (ipapi.co). General-purpose —
// `enabled` is caller-controlled, not hardcoded to any one auth state.
//
// - Cached for 24 hours in TanStack Query (single request per day per visitor)
// - Fails silently — returns null country on any error, falling back to Global
//
// Callers (Sep 2026): Index.tsx enables this for anonymous (`!isAuthed`)
// visitors, to show a country-filtered feed tab for logged-out users.
// useShouldShowLanguageToggle.ts also enables it — for anonymous visitors
// unconditionally, and for signed-in visitors only as a fallback once their
// profile has confirmed it has no location set — to decide whether the
// EN/Hindi toggle should render at all.
//
// The actual ipapi.co fetch lives in src/lib/ipLocation.ts, shared with
// OAuthCallbackPage.tsx's claim_oauth_ip_location() fallback — this hook's
// own caching/enabled behavior is unchanged.

import { useQuery } from "@tanstack/react-query";
import { fetchIPLocation, type IPLocationData } from "@/lib/ipLocation";

export type { IPLocationData };

const STALE_TIME = 24 * 60 * 60 * 1000; // 24 hours

export function useIPLocation(enabled = true): {
  country: string | null;
  countryCode: string | null;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<IPLocationData>({
    queryKey: ["ip-location"],
    enabled,
    staleTime: STALE_TIME,
    gcTime: STALE_TIME,
    retry: 1,
    queryFn: fetchIPLocation,
  });

  return {
    country: data?.country ?? null,
    countryCode: data?.country_code ?? null,
    isLoading: enabled ? isLoading : false,
  };
}
