// src/hooks/useIPLocation.ts
// Detects the anonymous user's country via IP geolocation (ipapi.co).
// Used to show a country-filtered feed tab for logged-out users.
//
// - Only fires when the user is NOT authenticated
// - Cached for 24 hours in TanStack Query (single request per day)
// - Fails silently — returns null country on any error, falling back to Global
//
// The actual ipapi.co fetch now lives in src/lib/ipLocation.ts, shared with
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
