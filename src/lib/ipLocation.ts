// src/lib/ipLocation.ts
// Shared IP geolocation lookup (ipapi.co). Originally lived inline inside
// useIPLocation.ts (for the anonymous-user country-filtered feed tab) —
// pulled out here as a plain async function so OAuthCallbackPage.tsx can
// also call it directly for claim_oauth_ip_location(), without needing a
// component/hook context. useIPLocation.ts now calls this same function;
// its existing behavior (TanStack Query caching, enabled flag, etc.) is
// unchanged.

export type IPLocationData = {
  country: string | null;       // e.g. "United States", "India"
  country_code: string | null;  // e.g. "US", "IN"
  city: string | null;
  region: string | null;        // state/province
};

export async function fetchIPLocation(): Promise<IPLocationData> {
  try {
    const res = await fetch("https://ipapi.co/json/", {
      signal: AbortSignal.timeout(4000), // 4s timeout — don't block the caller
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
    // Silent fallback — callers treat a null country_code as "skip"
    return { country: null, country_code: null, city: null, region: null };
  }
}
