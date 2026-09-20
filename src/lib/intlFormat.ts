// src/lib/intlFormat.ts
//
// PR 1.5 / 1.6 — locale-aware region names and number formatting.
//
// Both use the platform's own Intl data rather than anything stored in the
// database. Country names are standardised and already translated in every
// browser; a `region_translations` table would be a worse copy of CLDR that
// someone has to maintain.

/**
 * Localized country name for a display label.
 *
 * `Intl.DisplayNames` needs an ISO 3166-1 alpha-2 code, not a label, so the
 * caller must supply whatever code it has (IP geolocation, profile region, …).
 * When no code is available the original label is returned unchanged — better a
 * correct English country name than a wrong localized guess.
 *
 *   regionDisplayName("hi", "US", "United States")  → "संयुक्त राज्य"
 *   regionDisplayName("en", "US", "United States")  → "United States"
 *   regionDisplayName("hi", null, "Bhopal, India")  → "Bhopal, India"
 */
export function regionDisplayName(
  languageCode: string,
  countryCode?: string | null,
  fallbackLabel?: string | null,
): string {
  const fallback = fallbackLabel ?? "";
  if (!countryCode) return fallback;
  const code = countryCode.trim().toUpperCase();
  if (code.length !== 2) return fallback;
  try {
    const name = new Intl.DisplayNames([languageCode], { type: "region" }).of(code);
    // Intl returns the input code back when it cannot resolve it.
    if (name && name !== code) return name;
  } catch {
    /* unsupported locale or runtime — fall through */
  }
  return fallback;
}

/** BCP 47 tag for a UI language. Hindi must be hi-IN, see formatNumber. */
export function localeFor(languageCode: string): string {
  return languageCode === "hi" ? "hi-IN" : languageCode || "en";
}

/**
 * Locale-aware number formatting.
 *
 * This is a correctness issue for an Indian audience, not cosmetic: hi-IN uses
 * the Indian grouping system, so 123456 renders as 1,23,456 rather than
 * 123,456. A reader who sees Western grouping in a Hindi page misreads the
 * magnitude of every response count on the screen.
 */
export function formatNumber(
  value: number,
  languageCode: string,
  options?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(localeFor(languageCode), options).format(value);
  } catch {
    return String(value);
  }
}

/** Locale-aware percentage, given a 0–100 value. */
export function formatPercent(
  value: number,
  languageCode: string,
  maximumFractionDigits = 0,
): string {
  try {
    return new Intl.NumberFormat(localeFor(languageCode), {
      style: "percent",
      maximumFractionDigits,
    }).format(value / 100);
  } catch {
    return `${Math.round(value)}%`;
  }
}

/** Locale-aware absolute date. */
export function formatDate(
  value: string | number | Date,
  languageCode: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  try {
    return new Intl.DateTimeFormat(localeFor(languageCode), options).format(new Date(value));
  } catch {
    return String(value);
  }
}

/**
 * PR 1.9 — the name of a language, written in the UI language.
 *
 * Used by the content-language indicator. Deriving this from Intl rather than
 * a hardcoded "English" key means the chip reads correctly for any language
 * pair the platform later supports:
 *
 *   languageDisplayName("hi", "en")  → "अंग्रेज़ी"
 *   languageDisplayName("hi", "mr")  → "मराठी"
 *   languageDisplayName("en", "hi")  → "Hindi"
 *
 * Returns the raw code if Intl cannot resolve it, which is visible and
 * debuggable rather than silently blank.
 */
export function languageDisplayName(uiLanguageCode: string, ofLanguageCode: string): string {
  const of_ = (ofLanguageCode ?? "").trim();
  if (!of_) return "";
  try {
    return new Intl.DisplayNames([localeFor(uiLanguageCode)], { type: "language" }).of(of_) ?? of_;
  } catch {
    return of_;
  }
}
