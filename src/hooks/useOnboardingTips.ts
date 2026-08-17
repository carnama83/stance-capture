// src/hooks/useOnboardingTips.ts
// Shared discoverability coach-marks. Product-finalized set: 4 tips total
// across the app (Home: slider + propose, sequenced; My Stances; Settings >
// Location, both standalone). See design discussion for the full rationale.
//
// One hook call per PAGE, covering that page's 1-2 tips — not one call per
// tip. This is what lets the dependsOn chain work: both tips share the same
// `dismissed` Set in one component's state, so dismissing home_slider
// immediately makes home_propose eligible on the same render, no
// cross-component notification needed.
//
// Persistence: localStorage, one key per tip (sc_tip_seen_<id>) — matches
// the sc_ prefix convention already used for the Epic R expectation-prompt
// dismiss key (ExpectationPrompt.tsx). Fails open on read (show the tip)
// and fails silently on write (worst case it reappears next visit) — same
// posture as every other localStorage/sessionStorage usage in this codebase.

import * as React from "react";

export interface TipDef {
  id: string;
  /** Another tip's id. This tip only becomes eligible once that one has
   *  been dismissed. Omit for a standalone, page-triggered tip. */
  dependsOn?: string;
}

const STORAGE_PREFIX = "sc_tip_seen_";

function readSeen(id: string): boolean {
  try {
    return !!localStorage.getItem(`${STORAGE_PREFIX}${id}`);
  } catch {
    return false;
  }
}

function writeSeen(id: string) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${id}`, "1");
  } catch {
    /* fail silently */
  }
}

export function useOnboardingTips(tips: TipDef[]) {
  const [dismissed, setDismissed] = React.useState<Set<string>>(() => new Set());
  const [hydrated, setHydrated] = React.useState(false);
  // Tip defs are static per page (defined inline at each call site as a
  // literal array) — read once on mount, not on every render.
  const tipsRef = React.useRef(tips);

  React.useEffect(() => {
    const initial = new Set<string>();
    for (const tip of tipsRef.current) {
      if (readSeen(tip.id)) initial.add(tip.id);
    }
    setDismissed(initial);
    setHydrated(true);
  }, []);

  const dismiss = React.useCallback((id: string) => {
    writeSeen(id);
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const isVisible = React.useCallback(
    (id: string): boolean => {
      // Never show before localStorage has been read — avoids a one-frame
      // flash of a tip the user already dismissed, on every page load.
      if (!hydrated) return false;
      const tip = tipsRef.current.find((t) => t.id === id);
      if (!tip) return false;
      if (dismissed.has(id)) return false;
      if (tip.dependsOn && !dismissed.has(tip.dependsOn)) return false;
      return true;
    },
    [hydrated, dismissed]
  );

  // True when at least one of this page's tips is currently showing —
  // pages that use a dimmed spotlight backdrop (Home) key their overlay off
  // this rather than tracking it separately.
  const anyVisible = tipsRef.current.some((t) => isVisible(t.id));

  return { isVisible, dismiss, anyVisible, hydrated };
}
