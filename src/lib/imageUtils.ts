// src/lib/imageUtils.ts
// Upgrades news CDN image URLs to high-resolution versions for hero display.
// Safe to call on any URL — unknown CDNs fall through to the original.

export function getHeroImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;

  try {
    const u = new URL(url);

    // ── Guardian CDN (i.guim.co.uk) ──────────────────────────────────────────
    // Supports query param resizing. fit=max preserves aspect ratio (no crop).
    if (u.hostname.includes("i.guim.co.uk")) {
      u.searchParams.set("width", "1200");
      u.searchParams.set("quality", "85");
      u.searchParams.set("auto", "format");
      u.searchParams.set("fit", "max");
      return u.toString();
    }

    // ── BBC (ichef.bbci.co.uk) ────────────────────────────────────────────────
    // Uses path segments for size. Replace all known small sizes with /1024/.
    // Replacements are applied to the original URL (not chained) to avoid
    // double-replacement edge cases.
    if (u.hostname.includes("ichef.bbci.co.uk")) {
      return url
        .replace("/240/", "/1024/")
        .replace("/320/", "/1024/")
        .replace("/480/", "/1024/")
        .replace("/640/", "/1024/")
        .replace("/800/", "/1024/");
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
