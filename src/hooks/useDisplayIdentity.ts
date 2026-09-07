// src/hooks/useDisplayIdentity.ts
// Anonymous-video feature — reads the caller's current display identity
// (profiles.random_id/username/display_handle_mode), same fields/table
// AppTopBar.tsx already queries for the header handle, plus the new
// anonymous_avatar_config. Extracted here as a shared hook so
// VideoRecorderPanel/ProposeQuestionModal don't duplicate that query, per
// the anonymous-video plan.
//
// Per the plan's explicit decision: this reads profiles.display_handle_mode
// directly — the LEGACY field everything else in the app already keys off
// (ProposerBadge, resolveDisplayName, AppTopBar) — not
// SettingsPrivacy.tsx's newer, not-yet-wired-in display_mode RPC setting.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  type AnonymousAvatarConfig,
  parseAvatarConfig,
  randomAvatarConfig,
} from "@/components/ugq/avatarConfig";

export type DisplayIdentity = {
  userId: string;
  randomId: string;
  username: string | null;
  displayHandleMode: "random_id" | "username";
  isAnonymous: boolean;
  avatarConfig: AnonymousAvatarConfig | null;
};

async function fetchIdentity(): Promise<DisplayIdentity | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("random_id, username, display_handle_mode, anonymous_avatar_config")
    .eq("user_id", user.id)
    .maybeSingle();
  const mode: "random_id" | "username" = data?.display_handle_mode === "username" ? "username" : "random_id";
  return {
    userId: user.id,
    randomId: data?.random_id ?? "",
    username: data?.username ?? null,
    displayHandleMode: mode,
    isAnonymous: mode === "random_id",
    avatarConfig: parseAvatarConfig(data?.anonymous_avatar_config),
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

  // First-run avatar creation (see plan): if no config exists yet, assign
  // and persist a random default immediately, never blocking recording.
  // Call this right before starting a recording in random_id mode.
  const ensureAvatarConfig = useCallback(async (): Promise<AnonymousAvatarConfig> => {
    if (identity?.avatarConfig) return identity.avatarConfig;
    const config = randomAvatarConfig();
    if (identity?.userId) {
      await supabase.from("profiles").update({ anonymous_avatar_config: config }).eq("user_id", identity.userId);
      setIdentity((prev) => (prev ? { ...prev, avatarConfig: config } : prev));
    }
    return config;
  }, [identity]);

  return { identity, loading, reload, ensureAvatarConfig };
}
