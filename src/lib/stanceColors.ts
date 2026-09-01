// src/lib/stanceColors.ts
//
// Centralized color helpers for stance slider and sentiment mood.

// Plain JSON import, not react-i18next's useTranslation — this file has no
// component/hook context to call useTranslation() from. Importing the same
// locale files directly keeps ONE source of truth for these words rather
// than a second, disconnected Hindi string living only here.
import en from "@/locales/en/common.json";
import hi from "@/locales/hi/common.json";

const STANCE_WORDS: Record<string, { neutral: string; leanOppose: string; leanSupport: string }> = {
  en: en.stance,
  hi: hi.stance,
};

/**
 * Map stance value (-2..2) to a hex color.
 * Used for the stance slider fill / thumb styling.
 */
export function getStanceColorHex(value: number): string {
  switch (value) {
    case -2:
      return "#ef4444"; // red-500 – strongly disagree
    case -1:
      return "#f97316"; // orange-500 – disagree
    case 0:
      return "#eab308"; // amber-500 – neutral / unsure
    case 1:
      return "#84cc16"; // lime-500 – agree
    case 2:
      return "#22c55e"; // emerald-500 – strongly agree
    default:
      return "#6b7280"; // slate-500 – fallback
  }
}

/**
 * Map sentiment score (-1..1-ish) to a hex color.
 * Used for "Trending" dot in Discussion Mood.
 *
 * Rough thresholds:
 *   <= -0.3   → red (negative)
 *   -0.3..0.3 → orange (mixed/neutral-ish)
 *   >= 0.3    → green (positive)
 */
export function getSentimentColorHex(
  score: number | null | undefined
): string {
  if (score == null || Number.isNaN(score)) {
    return "#9ca3af"; // slate-400 – unknown / no data
  }

  if (score <= -0.3) {
    return "#ef4444"; // red-500 – negative
  }
  if (score < 0.3) {
    return "#f97316"; // orange-500 – mixed / neutral-ish
  }
  return "#22c55e"; // emerald-500 – positive
}

// ─── Dynamic stance label helpers ────────────────────────────────────────────
//
// Builds a full 5-position label map from the two endpoint labels generated
// by the reframe pipeline. The ±1 positions are derived automatically by
// taking the first 3 words of the endpoint label and prefixing with "Lean toward".
//
// Example — prediction markets question:
//   sliderLowLabel  = "Protect individuals from exploitation"
//   sliderHighLabel = "Prioritise predictive power"
//
//   -2 → "Protect individuals from exploitation"
//   -1 → "Lean toward protecting individuals"
//    0 → "Neutral"
//   +1 → "Lean toward prioritising predictive"
//   +2 → "Prioritise predictive power"
//
// Falls back to generic labels when endpoint labels are null (existing
// questions, reframe failures, or questions not yet through the pipeline).

export function deriveLeanLabel(
  endpointLabel: string | null | undefined,
  fallback: string,
  languageCode: string = "en"
): string {
  if (!endpointLabel) return fallback;
  // BUG FIX: this used to prepend the English phrase "Lean toward " onto
  // whatever endpointLabel was and lowercase its first character —
  // a mechanical trick that only works for English grammar. Applied to a
  // Hindi rendition (e.g. "पूरी तरह असहमत"), it produced broken,
  // mixed-language text like "Lean toward पूरी तरह असहमत" — worse than
  // just showing untranslated English. For any non-English language, skip
  // the derivation entirely and use the static fallback instead: less
  // specific than English's dynamically-derived version, but never broken.
  if (languageCode !== "en") return fallback;
  // Take the first 3 words, lowercase the first character so it reads
  // naturally after "Lean toward" (e.g. "Protect" → "protecting" is handled
  // by the lowercase — the actual word stays as-is, which is close enough
  // for display purposes without needing a full conjugation lookup).
  const words = endpointLabel.trim().split(/\s+/).slice(0, 3).join(" ");
  const lowered = words.charAt(0).toLowerCase() + words.slice(1);
  return `Lean toward ${lowered}`;
}

export function buildStanceLabels(
  sliderLowLabel?: string | null,
  sliderHighLabel?: string | null,
  languageCode: string = "en"
): Record<number, string> {
  const words = STANCE_WORDS[languageCode] ?? STANCE_WORDS.en;
  return {
    [-2]: sliderLowLabel  ?? "Strongly oppose",
    [-1]: deriveLeanLabel(sliderLowLabel,  words.leanOppose, languageCode),
    [0]:  words.neutral,
    [1]:  deriveLeanLabel(sliderHighLabel, words.leanSupport, languageCode),
    [2]:  sliderHighLabel ?? "Strongly support",
  };
}
