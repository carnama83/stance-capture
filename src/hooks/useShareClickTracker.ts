// src/hooks/useShareClickTracker.ts
// Epic W — Social Sharing (W1 / W6)
//
// Reads the ?sid= param from the URL when a shared link is visited
// and records the click against the originating share event.
// Call this once in App.tsx or in the QuestionDetailPage.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export function useShareClickTracker() {
  const location = useLocation();

  useEffect(() => {
    // Extract sid from query params
    const params = new URLSearchParams(location.search);
    const sid = params.get("sid");
    const ref = params.get("ref"); // platform ref — for analytics

    if (!sid) return;

    // Record the click (non-blocking, fire-and-forget)
    supabase
      .rpc("record_share_click", { p_share_id: sid })
      .then(({ error }) => {
        if (error) console.warn("[ShareClickTracker] Failed to record click:", error.message);
      });

    // Store ref in sessionStorage so we can attribute signups/stances
    if (ref) sessionStorage.setItem("share_ref", ref);
    sessionStorage.setItem("share_sid", sid);
  }, [location.search]);
}
