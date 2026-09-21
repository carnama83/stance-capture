// src/lib/ipLocation.ts
// Approximate location for the current visitor.
//
// This used to fetch https://ipapi.co/json/ directly from the browser, which
// disclosed every visitor's IP address to a third party from their own device,
// on page load, before any consent. It now calls our own /api/geo, which reads
// the geolocation headers Vercel already attaches at its edge — so the IP is
// only ever seen by the infrastructure already serving the page, and no
// external request is made at all.
//
// Keep this the ONLY place that resolves visitor location. Three copies of the
// old third-party call existed (here, ThreeTierQuestionsFeed and Signup), and
// removing one would have left the disclosure in place via the others.

export type IPLocationData = {
  country: string | null;       // e.g. "United States", "India"
  country_code: string | null;  // e.g. "US", "IN"
  city: string | null;
  region: string | null;        // state/province code, e.g. "NJ", "MP"
};

const EMPTY: IPLocationData = { country: null, country_code: null, city: null, region: null };

export async function fetchIPLocation(): Promise<IPLocationData> {
  try {
    const res = await fetch("/api/geo", {
      signal: AbortSignal.timeout(4000), // don't block the caller
    });
    // Under `vite dev` there is no serverless function, so this 404s. That is
    // expected: callers treat a null country_code as "skip".
    if (!res.ok) throw new Error("geo lookup failed");
    const data = await res.json();
    return {
      country: data.country ?? null,
      country_code: data.country_code ?? null,
      city: data.city ?? null,
      region: data.region ?? null,
    };
  } catch {
    return { ...EMPTY };
  }
}
