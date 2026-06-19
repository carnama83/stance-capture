// src/lib/poleLabels.ts
//
// Shared display helpers for rendering a question's stance distribution in the
// question's OWN terms (its slider poles) instead of a generic oppose/support
// frame.
//
// Mapping (consistent with QuestionStanceSlider and the −2…+2 numeric scale):
//   negative pole / opposePct / red segment  → slider_low_label
//   positive pole / supportPct / green segment → slider_high_label
//   neutral stays "Neutral"
//
// These helpers are PURE display logic. They do not touch the numeric scale,
// percentages, or any analytics — only the words shown to the user. When a
// question has no slider labels (e.g. rows created before the QF pipeline),
// callers fall back to the generic "Oppose" / "Support" wording.

export interface ResolvedPoleLabels {
  /** Full negative-pole label (slider_low_label) or generic fallback. */
  negFull: string;
  /** Full positive-pole label (slider_high_label) or generic fallback. */
  posFull: string;
  /** True when the question supplied real poles (not the generic fallback). */
  hasPoles: boolean;
}

/**
 * Resolve the negative/positive pole labels for display, falling back to the
 * generic oppose/support wording when a question has no slider labels.
 */
export function resolvePoleLabels(
  lowLabel?: string | null,
  highLabel?: string | null,
  fallbackNeg = "Oppose",
  fallbackPos = "Support",
): ResolvedPoleLabels {
  const neg = lowLabel?.trim() ? lowLabel.trim() : null;
  const pos = highLabel?.trim() ? highLabel.trim() : null;
  // Treat poles as present only when BOTH ends are supplied — a half-labelled
  // question would read oddly ("Protect talks ... Support"), so fall back fully.
  const hasPoles = neg != null && pos != null;
  return {
    negFull: hasPoles ? (neg as string) : fallbackNeg,
    posFull: hasPoles ? (pos as string) : fallbackPos,
    hasPoles,
  };
}

/**
 * Shorten a pole label for inline legends where space is tight (the community
 * bar puts the label next to a percentage). Keeps the first `maxWords` words and
 * appends an ellipsis; the caller should expose the full label via `title`/aria.
 * Generic fallbacks ("Oppose"/"Support") are already short and pass through.
 */
export function clampPole(label: string, maxWords = 2): string {
  const trimmed = label.trim();
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;
  return words.slice(0, maxWords).join(" ") + "…";
}

/**
 * Shorten BOTH poles together for an inline legend, keeping them distinguishable.
 *
 * Many trade-off poles share a leading phrase ("Rules were vindicated" /
 * "Rules were weaponised"), and clamping each independently to the first few
 * words collapses both to the same string ("Rules were…"). This strips the
 * shared leading run of words so the distinctive part shows ("Vindicated" /
 * "Weaponised"), always leaving at least one word on each side, then clamps.
 * Full labels should still be exposed via `title`/aria.
 */
export function distinctPoleLabels(
  negFull: string,
  posFull: string,
  maxWords = 2,
): { negShort: string; posShort: string } {
  const negWords = negFull.trim().split(/\s+/).filter(Boolean);
  const posWords = posFull.trim().split(/\s+/).filter(Boolean);

  // Length of the shared leading run, leaving ≥1 distinguishing word per side.
  const maxCommon = Math.min(negWords.length, posWords.length) - 1;
  let common = 0;
  while (
    common < maxCommon &&
    negWords[common].toLowerCase() === posWords[common].toLowerCase()
  ) {
    common++;
  }

  const negRest = negWords.slice(common);
  const posRest = posWords.slice(common);
  const useStripped = common > 0 && negRest.length > 0 && posRest.length > 0;

  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const pick = (all: string[], rest: string[]) => {
    const words = useStripped ? rest : all;
    const out = words.length <= maxWords
      ? words.join(" ")
      : words.slice(0, maxWords).join(" ") + "…";
    return cap(out);
  };

  return {
    negShort: pick(negWords, negRest),
    posShort: pick(posWords, posRest),
  };
}
