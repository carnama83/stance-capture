// src/hooks/useIPLocation.ts
// Detects the anonymous user's country via IP geolocation (ipapi.co).
// Used to show a country-filtered feed tab for logged-out users.
//
// - Only fires when the user is NOT authenticated
// - Cached for 24 hours in TanStack Query (single request per day)
// - Fails silently — returns null country on any error, falling back to Global

import { useQuery } from "@tanstack/react-query";

export type IPLocationData = {
  country: string | null;       // e.g. "United States", "India"
  country_code: string | null;  // e.g. "US", "IN"
  city: string | null;
  region: string | null;        // state/province
};

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
    queryFn: async () => {
      try {
        const res = await fetch("https://ipapi.co/json/", {
          signal: AbortSignal.timeout(4000), // 4s timeout — don't block feed
        });
        if (!res.ok) throw new Error("IP lookup failed");
        const data = await res.json();
        return {
          country: data.country_name ?? null,
          country_code: data.country_code ?? null,
          city: data.city ?? null,
          region: data.region ?? null,
        };
      } catch {
        // Silent fallback — anon users see Global feed only
        return {
          country: null,
          country_code: null,
          city: null,
          region: null,
        };
      }
    },
  });

  return {
    country: data?.country ?? null,
    countryCode: data?.country_code ?? null,
    isLoading: enabled ? isLoading : false,
  };
}
