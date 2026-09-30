// src/hooks/useShareClickTracker.ts
// Epic W — Social Sharing (W1 / W6)
//
// Reads the ?sid= param from the URL when a shared link is visited
// and records the click against the originating share event.
// Call this once in App.tsx or in the QuestionDetailPage.
//
// Sep 2026: counts people, not page loads. Pasting a link into Facebook set
// off 5–10 recorded "clicks" within the first minute (preview/safety scanners
// that run the page like a browser, plus reloads), so 117 of 124 clicks on the
// Pune posts were automated. Now a click is recorded only:
//   • once per browser per link (remembered in localStorage),
//   • not from an automated browser or a known crawler user agent,
//   • after the page has stayed open and visible for DWELL_MS.
// The pending count lives at module level, not in the effect, so an in-app URL
// change during the dwell (e.g. the page tidying its query) doesn't cancel it.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const DWELL_MS = 3000;
const SEEN_PREFIX = "sc_share_clicked_";
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|facebot|meta-externalagent|headless|lighthouse|preview|scanner|python|curl|wget/i;

function looksAutomated(): boolean {
  if (typeof navigator === "undefined") return true;
  if ((navigator as any).webdriver) return true;
  return BOT_UA.test(navigator.userAgent || "");
}

function alreadyCounted(sid: string): boolean {
  try { return localStorage.getItem(SEEN_PREFIX + sid) !== null; } catch { return false; }
}

function markCounted(sid: string) {
  try { localStorage.setItem(SEEN_PREFIX + sid, String(Date.now())); } catch { /* private mode */ }
}

// sid → pending timer (null while the page is hidden and the dwell is paused).
const pending = new Map<string, ReturnType<typeof setTimeout> | null>();

function record(sid: string) {
  pending.delete(sid);
  if (alreadyCounted(sid)) return;
  markCounted(sid);
  supabase
    .rpc("record_share_click", { p_share_id: sid })
    .then(({ error }) => {
      if (error) console.warn("[ShareClickTracker] Failed to record click:", error.message);
    });
}

function arm(sid: string) {
  if (pending.get(sid) || document.visibilityState !== "visible") return;
  pending.set(sid, setTimeout(() => record(sid), DWELL_MS));
}

if (typeof document !== "undefined") {
  // Hidden before the dwell elapsed → pause (restart the full dwell on return).
  document.addEventListener("visibilitychange", () => {
    for (const [sid, timer] of pending) {
      if (document.visibilityState === "visible") arm(sid);
      else if (timer) { clearTimeout(timer); pending.set(sid, null); }
    }
  });
}

export function useShareClickTracker() {
  const location = useLocation();

  useEffect(() => {
    // Extract sid from query params
    const params = new URLSearchParams(location.search);
    const sid = params.get("sid");
    const ref = params.get("ref"); // platform ref — for analytics

    if (!sid) return;

    // Store ref in sessionStorage so we can attribute signups/stances
    if (ref) sessionStorage.setItem("share_ref", ref);
    sessionStorage.setItem("share_sid", sid);

    if (looksAutomated() || alreadyCounted(sid) || pending.has(sid)) return;
    pending.set(sid, null);
    arm(sid);
  }, [location.search]);
}
