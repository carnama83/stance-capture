export function getHeroImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;

  try {
    const u = new URL(url);

    // Guardian CDN (i.guim.co.uk)
    if (u.hostname.includes("i.guim.co.uk")) {
      u.searchParams.set("width", "1200");
      u.searchParams.set("quality", "85");
      u.searchParams.set("auto", "format");
      u.searchParams.set("fit", "max");
      return u.toString();
    }

    // BBC images
    if (u.hostname.includes("ichef.bbci.co.uk")) {
      return url
        .replace("/240/", "/1024/")
        .replace("/480/", "/1024/")
        .replace("/640/", "/1024/");
    }

    // NYTimes CDN (images.nytimes.com etc.)
    if (u.hostname.includes("nyt") || u.hostname.includes("nytimes")) {
      return url;
    }

    // Default: return original
    return url;
  } catch {
    return url;
  }
}
