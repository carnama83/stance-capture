// api/geo.js
//
// Approximate location, derived WITHOUT disclosing the visitor's IP address to
// anyone.
//
// This replaced a direct browser call to https://ipapi.co/json/. That call sent
// every visitor's IP to a third party from their own device, on page load,
// before any consent and without disclosure in the privacy policy. Three
// separate copies of it existed (src/lib/ipLocation.ts, an inline duplicate in
// ThreeTierQuestionsFeed, and another in Signup).
//
// Vercel already resolves geolocation at its own edge and injects it as request
// headers, so there is no lookup to perform and no request to make: the IP is
// only ever seen by the infrastructure already serving the page. Nothing is
// stored here.
//
// Headers (present on Serverless/Edge requests; absent locally under `vite dev`,
// which is why every field is nullable and callers treat null as "skip"):
//   x-vercel-ip-country         ISO 3166-1 alpha-2, e.g. "IN"
//   x-vercel-ip-country-region  region/state code, e.g. "MP"
//   x-vercel-ip-city            city, percent-encoded
function decode(v) {
  if (!v) return null;
  try { return decodeURIComponent(v) || null; } catch { return v || null; }
}

// ISO code -> English country name, from the platform's own CLDR data rather
// than a hardcoded table. Callers render this string directly today; if that
// ever needs to follow the UI language, send the code and localise client-side.
function countryName(code) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const code = (req.headers["x-vercel-ip-country"] || "").toUpperCase() || null;
  const region = decode(req.headers["x-vercel-ip-country-region"]);
  const city = decode(req.headers["x-vercel-ip-city"]);

  // Per-visitor, so it must never be shared in a CDN cache.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).end(JSON.stringify({
    country: countryName(code),
    country_code: code,
    city,
    region,
  }));
}
