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
import { useLanguage, readStoredUiLanguage, UI_LANGUAGE_CHANGE_EVENT } from "./useLanguage";

export const UI_LANGUAGE_STORAGE_KEY = "sc_ui_language";

// Sep 2026, NEW: records THAT a deliberate choice was made, separately from
// WHICH language was chosen. The value alone cannot carry that signal: the
// header toggle used to render unconditionally, so a large number of browsers
// have sc_ui_language="en" saved from a single click on an already-active
// button, which is indistinguishable from never having chosen at all. Anything
// written before this key existed is therefore treated as "no explicit choice",
// while a new choice counts regardless of which language it names — including
// English, which a stored-value heuristic could never honour.
export const UI_LANGUAGE_EXPLICIT_KEY = "sc_ui_language_explicit";
const DEFAULT_LANGUAGE = "en"; // mirrors useLanguage.ts's own DEFAULT_LANGUAGE


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

  // Sep 2026, NEW: every mounted instance of this hook converges on the same
  // value. The state above is per-instance, so once a SECOND component called
  // this hook (SettingsProfile, so its control could see the language actually
  // on screen rather than only the profile row), the two could hold different
  // languages indefinitely: the one that handled the click moved, the other did
  // not, and each drives i18n.changeLanguage and <html lang> from its own copy.
  // The visible symptom was the header pill still reading EN over a page
  // rendering Hindi. useLanguage already listens to this same event for exactly
  // this reason; the hook that OWNS the value was the one not listening to it.
  React.useEffect(() => {
    const onChange = () => {
      const next = readStoredUiLanguage();
      if (next) setLanguageCodeState(next); // same value => React bails out
    };
    window.addEventListener(UI_LANGUAGE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(UI_LANGUAGE_CHANGE_EVENT, onChange);
  }, []);

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
        // Marks this as a real choice by a real person, which is what
        // useLanguage and useShouldShowLanguageToggle now key off.
        window.localStorage.setItem(UI_LANGUAGE_EXPLICIT_KEY, "1");
      } catch {
        // Non-fatal — the choice still applies for the rest of this session
        // via React state, it just won't survive a reload.
      }
      // Sep 2026, NEW — see useLanguage.ts's useReactiveStoredUiLanguage
      // comment. The localStorage write above is invisible to every OTHER
      // component's useLanguage() call (Index.tsx, QuestionDetailPage.tsx,
      // ...) until they happen to re-render for some unrelated reason — this
      // event is what actually wakes them up to re-read the new value now,
      // instead of leaving question/feed content stuck on the old language
      // until a hard reload.
      window.dispatchEvent(new Event(UI_LANGUAGE_CHANGE_EVENT));
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
