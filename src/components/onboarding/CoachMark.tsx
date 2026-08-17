// src/components/onboarding/CoachMark.tsx
// The tip bubble itself — pure presentation, no persistence logic (that's
// useOnboardingTips). Positions absolutely relative to the nearest
// `relative` ancestor, so the caller wraps whatever element it's pointing
// at in a `relative` container and renders this as a sibling inside it.
//
// Visual pattern matches the design mockup exactly: dark bubble, small
// arrow pointing at the target, "Got it" to dismiss — consistent across all
// 4 tips so they read as one system rather than four one-off components.

import * as React from "react";
import { X } from "lucide-react";

export interface CoachMarkProps {
  text: string;
  /** Which side of the target the bubble sits on. Ignored when `fixed` is set. */
  placement?: "above" | "below";
  onDismiss: () => void;
  /** z-index for the bubble itself — bump this if the target's own
   *  elevated z-index (needed to rise above a spotlight backdrop) would
   *  otherwise sit above the bubble. Defaults to 30, matching the
   *  spotlight backdrop's z-20 target-elevation convention used on Home. */
  zIndexClassName?: string;
  /** For targets positioned with `fixed` (e.g. a floating action button),
   *  not normal document flow — wrapping a `fixed` element in a `relative`
   *  container doesn't work, since that container collapses to zero size
   *  and an `absolute`-positioned bubble inside it would render at the
   *  wrong spot. Pass the same fixed-position classes the target itself
   *  uses; the bubble positions independently, fixed to the viewport,
   *  rather than relative to any ancestor. */
  fixed?: { bottom: string; right: string };
}

export function CoachMark({
  text,
  placement = "below",
  onDismiss,
  zIndexClassName = "z-30",
  fixed,
}: CoachMarkProps) {
  if (fixed) {
    return (
      <div
        className={`fixed ${fixed.bottom} ${fixed.right} ${zIndexClassName} w-64`}
        role="tooltip"
      >
        <div className="relative bg-slate-900 text-white rounded-xl shadow-xl px-4 py-3.5">
          <button
            onClick={onDismiss}
            className="absolute top-2 right-2 text-slate-400 hover:text-white p-0.5"
            aria-label="Dismiss tip"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <p className="text-[13px] leading-snug pr-4">{text}</p>
          <button
            onClick={onDismiss}
            className="mt-2.5 text-[12px] font-medium bg-white text-slate-900 rounded-lg px-2.5 py-1 hover:bg-slate-100 transition-colors"
          >
            Got it
          </button>
          {/* Arrow pointing down-right toward a bottom-right fixed FAB */}
          <div className="absolute -bottom-1 right-6 w-2.5 h-2.5 bg-slate-900 rotate-45" />
        </div>
      </div>
    );
  }

  const posClasses =
    placement === "below"
      ? "top-full mt-3 left-1/2 -translate-x-1/2"
      : "bottom-full mb-3 left-1/2 -translate-x-1/2";

  return (
    <div className={`absolute ${zIndexClassName} ${posClasses} w-64`} role="tooltip">
      <div className="relative bg-slate-900 text-white rounded-xl shadow-xl px-4 py-3.5">
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 text-slate-400 hover:text-white p-0.5"
          aria-label="Dismiss tip"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <p className="text-[13px] leading-snug pr-4">{text}</p>
        <button
          onClick={onDismiss}
          className="mt-2.5 text-[12px] font-medium bg-white text-slate-900 rounded-lg px-2.5 py-1 hover:bg-slate-100 transition-colors"
        >
          Got it
        </button>
        <div
          className={
            "absolute left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-slate-900 rotate-45 " +
            (placement === "below" ? "-top-1" : "-bottom-1")
          }
        />
      </div>
    </div>
  );
}

/** Dimmed spotlight backdrop — used on Home only (real competing card
 *  content). My Stances / Settings point at a page header that's already
 *  the first thing visible, so a full-page dim would obscure more than it
 *  helps; those two render CoachMark without this. */
export function CoachMarkBackdrop() {
  return <div className="absolute inset-0 bg-slate-900/40 z-10 transition-opacity" aria-hidden="true" />;
}
