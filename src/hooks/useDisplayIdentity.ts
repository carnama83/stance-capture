// src/hooks/useDisplayIdentity.ts
// Reads the caller's current display identity (profiles.random_id/username/
// display_handle_mode), same fields/table AppTopBar.tsx already queries for
// the header handle. Extracted here as a shared hook so other components
// (e.g. VideoRecorderPanel, which needs to know whether the proposer is
// currently anonymous before deciding how to submit a video question — see
// its header note) don't duplicate that query.
//
// Reads profiles.display_handle_mode directly — the LEGACY field everything
// else in the app already keys off (ProposerBadge, resolveDisplayName,
// AppTopBar) — not SettingsPrivacy.tsx's newer, not-yet-wired-in display_mode
// RPC setting.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DisplayIdentity = {
  userId: string;
  randomId: string;
  username: string | null;
  displayHandleMode: "random_id" | "username";
  isAnonymous: boolean;
};

async function fetchIdentity(): Promise<DisplayIdentity | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("random_id, username, display_handle_mode")
    .eq("user_id", user.id)
    .maybeSingle();
  const mode: "random_id" | "username" = data?.display_handle_mode === "username" ? "username" : "random_id";
  return {
    userId: user.id,
    randomId: data?.random_id ?? "",
    username: data?.username ?? null,
    displayHandleMode: mode,
    isAnonymous: mode === "random_id",
  };
}

export function useDisplayIdentity() {
  const [identity, setIdentity] = useState<DisplayIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const next = await fetchIdentity();
    setIdentity(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await fetchIdentity();
      if (!cancelled) {
        setIdentity(next);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { identity, loading, reload };
}
