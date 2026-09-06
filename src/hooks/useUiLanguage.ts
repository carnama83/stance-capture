// src/hooks/useUiLanguage.ts
//
// The "explicit language-switcher action" useLanguage.ts's own header
// comment anticipated but marked "not built yet" — this is that switcher.
// Deliberately separate from useLanguage(userId), which stays untouched and
// keeps doing its original job (resolving what language a shared
// question/feed item should render in, via ?lang= or the stored profile
// preference). This hook instead owns what language the app's OWN UI chrome
// (every t() label) renders in, for every visitor — signed in, anonymous,
// or mid-signup, none of whom useLanguage alone can cover on its own:
// useLanguage has no setter and, for an anonymous visitor with no ?lang=,
// always resolves to 'en' with nothing to remember a manual choice by.
//
// Precedence for the resolved value:
//   1. An explicit past choice on THIS device (localStorage, see
//      UI_LANGUAGE_STORAGE_KEY) — sc_-prefixed, matching this codebase's
//      existing localStorage key convention (see useBootstrapUser.ts /
//      Signup.tsx's sc_pending_merge_fp, sc_embed_fp_v1).
//   2. profiles.preferred_language_code, for a signed-in user with no local
//      choice yet (e.g. a fresh browser/device) — sourced via the existing
//      useLanguage(userId), not duplicated here.
//   3. 'en'.
//
// setLanguageCode() is the one place that both persists the choice
// (localStorage, always) AND — when signed in — writes it back to
// profiles.preferred_language_code, so a manual pick here and
// SettingsProfile's own switcher stay a single, consistent preference
// rather than two independent ones.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { useLanguage } from "./useLanguage";

export const UI_LANGUAGE_STORAGE_KEY = "sc_ui_language";
const DEFAULT_LANGUAGE = "en"; // mirrors useLanguage.ts's own DEFAULT_LANGUAGE

function readStoredUiLanguage(): string | null {
  try {
    return window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
  } catch {
    return null; // private browsing / storage disabled — just means no override, not an error
  }
}

export interface UseUiLanguageResult {
  languageCode: string;
  setLanguageCode: (code: string) => void;
}

export function useUiLanguage(userId: string | null | undefined): UseUiLanguageResult {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const sb = React.useMemo(getSupabase, []);

  // Fallback source ONLY — used to seed a signed-in user's device that has
  // no local override yet (see the effect below). Never referenced again
  // once languageCode has a value, so this hook never fights a manual pick
  // with a stale profile read the way reusing useLanguage's result directly
  // in AppTopBar's old effect did for anonymous visitors (see git history:
  // that effect reset i18n back to 'en' on every render for anyone without
  // a session, since useLanguage(null) has no concept of a local choice).
  const { languageCode: profileLanguageCode, isLoading: profileLoading } = useLanguage(userId);

  const [languageCode, setLanguageCodeState] = React.useState<string>(
    () => readStoredUiLanguage() ?? DEFAULT_LANGUAGE
  );

  React.useEffect(() => {
    if (readStoredUiLanguage()) return; // an explicit local choice always wins
    if (profileLoading) return;
    if (profileLanguageCode && profileLanguageCode !== languageCode) {
      setLanguageCodeState(profileLanguageCode);
    }
    // languageCode intentionally excluded — this only ever seeds FROM the
    // profile once, it must not re-fire just because languageCode changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLanguageCode, profileLoading]);

  // Keeps i18next's active language, and <html lang>, in sync with whatever
  // languageCode above resolved to — the single place either now gets set,
  // replacing the effect AppTopBar used to run directly against useLanguage.
  React.useEffect(() => {
    if (i18n.language !== languageCode) i18n.changeLanguage(languageCode);
    document.documentElement.lang = languageCode;
  }, [languageCode, i18n]);

  const setLanguageCode = React.useCallback(
    (code: string) => {
      setLanguageCodeState(code);
      try {
        window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, code);
      } catch {
        // Non-fatal — the choice still applies for the rest of this session
        // via React state, it just won't survive a reload.
      }
      if (userId && sb) {
        sb.from("profiles")
          .update({ preferred_language_code: code })
          .eq("user_id", userId)
          .then(({ error }) => {
            if (error) {
              console.error("[useUiLanguage] failed to persist preferred_language_code", error);
              return;
            }
            // Must match useLanguage's own queryKey (["preferred-language", userId])
            // exactly — same cache SettingsProfile's switcher already invalidates.
            queryClient.invalidateQueries({ queryKey: ["preferred-language", userId] });
          });
      }
    },
    [userId, sb, queryClient]
  );

  return { languageCode, setLanguageCode };
}
