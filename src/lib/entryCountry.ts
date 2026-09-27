// src/lib/entryCountry.ts
//
// Sep 2026 — a visitor who arrives through a shared question link (WhatsApp
// forwards on launch day) should start on that question's country, not on
// whatever country their IP appears to be in. The question page records the
// country of the FIRST question opened this browser session; the home feed
// uses it as the signed-out visitor's starting region.
//
// sessionStorage only: it lasts for this tab's visit, is never sent anywhere,
// and a signed-in user's saved location always wins over it.

const KEY = "sc.entryCountry";

// "Pune, India" -> "India"; "India" -> "India"; "Global"/empty -> null.
function countryFromLabel(label: string | null | undefined): string | null {
  const last = (label ?? "").split(",").pop()?.trim() ?? "";
  if (!last || last.toLowerCase() === "global") return null;
  return last;
}

export function rememberEntryCountry(locationLabel: string | null | undefined): void {
  const country = countryFromLabel(locationLabel);
  if (!country) return;
  try {
    if (!sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, country);
  } catch {
    // Storage blocked (private mode, embedded view): fall back to IP/time zone.
  }
}

export function getEntryCountry(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
