// src/lib/stanceColors.ts
//
// Centralized color helpers for stance slider and sentiment mood.

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
