// src/lib/imageUtils.ts
// Upgrades news CDN image URLs to high-resolution versions for hero display.
// Safe to call on any URL — unknown CDNs fall through to the original.

export function getHeroImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;

  try {
    // Support both absolute and relative URLs safely
    const base =
      typeof window !== "undefined" && window.location
        ? window.location.href
        : "https://example.com";

    const u = new URL(url, base);

    // ── Guardian CDN (i.guim.co.uk) ──────────────────────────────────────────
    // IMPORTANT: Guardian URLs often omit `width` entirely, which can default
    // to a tiny rendition (your intrinsic 140×112 case).
    // Force a large width + dpr for crisp hero rendering.
    if (u.hostname.includes("i.guim.co.uk")) {
      // Always force width (even if missing)
      u.searchParams.set("width", "1600");

      // Retina / high-DPR boost (leave existing dpr if already set)
      if (!u.searchParams.get("dpr")) u.searchParams.set("dpr", "2");

      // Reasonable quality; keep if already present
      if (!u.searchParams.get("quality")) u.searchParams.set("quality", "85");

      // Ensure modern format + no-crop behavior
      // (Guardian commonly uses auto=format)
      u.searchParams.set("auto", "format");
      u.searchParams.set("fit", "max");

      return u.toString();
    }

    // ── BBC (ichef.bbci.co.uk) ────────────────────────────────────────────────
    // Uses path segments for size: /240/ /320/ /480/ etc. Upgrade to /1024/.
    if (u.hostname.includes("ichef.bbci.co.uk")) {
      const upgraded = u.toString().replace(
        /\/(80|120|160|240|320|480|624|640|660|800|976)\//,
        "/1024/"
      );
      return upgraded;
    }

    // ── NYTimes CDN ───────────────────────────────────────────────────────────
    // NYT URLs are typically already full-resolution. Pass through unchanged.
    if (u.hostname.includes("nyt") || u.hostname.includes("nytimes")) {
      return url;
    }

    // ── Default ───────────────────────────────────────────────────────────────
    // Unknown CDN — return original URL unchanged. Safe fallback.
    return url;
  } catch {
    // URL parsing failed (relative URL or malformed) — return as-is.
    return url;
  }
}
