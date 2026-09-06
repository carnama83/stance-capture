// src/hooks/useLanguage.ts
//
// Resolves the language a question/feed should render in, for both signed-in
// and anonymous visitors. Precedence:
//   1. localStorage sc_ui_language (Sep 2026, NEW) — an explicit past choice
//      on THIS device via the header language toggle (see useUiLanguage.ts,
//      which owns writing this key). Deliberately wins over ?lang= too: a
//      visitor who has ever toggled the header is treated as having stated a
//      standing preference for this device, which should hold even when they
//      later open a WhatsApp/social share link carrying someone else's
//      ?lang= — same "explicit local choice always wins" rule useUiLanguage
//      already applies to UI-chrome language. A visitor who has never
//      toggled falls through to the URL/profile behavior below exactly as
//      before this change.
//   2. ?lang= on the current URL — set by the /s/<slug>/<lang> share redirect
//      (see api/s/[slug].js), or a manual override.
//   3. profiles.preferred_language_code, for a signed-in user.
//   4. 'en'.
//
// Deliberately does NOT write a URL-sourced language back into
// profiles.preferred_language_code. A shared link reflects what the SENDER
// was viewing, not necessarily a deliberate preference change by whoever
// clicked it — only an explicit language-switcher action (useUiLanguage.ts)
// updates the stored preference.
//
// HashRouter note: with routes like /#/q/<id>?lang=hi, useSearchParams()
// still resolves `lang` correctly — HashRouter treats the `?...` portion
// within the hash as the search string, same as a normal route.
//
// Takes userId as a parameter rather than resolving session itself — every
// page in this app currently has its own local session hook (useSupabaseSession
// in Index.tsx, an inline equivalent in QuestionDetailPage.tsx); this hook
// stays decoupled from that duplication rather than adding a third variant.
//
// isLoading matters here beyond the usual spinner use: while a signed-in
// user's profile language is still in flight, languageCode is only a
// placeholder ('en'), not a settled answer. Callers should gate their actual
// content query with `enabled: !isLoading` — firing a query with the
// placeholder value would risk a visible flash of English before the real
// preference (e.g. Hindi) loads in.

import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";

const DEFAULT_LANGUAGE = "en";
// Sep 2026, NEW. Must match UI_LANGUAGE_STORAGE_KEY in useUiLanguage.ts —
// kept as an independent literal (not imported) to avoid a circular import,
// since useUiLanguage.ts itself imports useLanguage from this file.
const UI_LANGUAGE_STORAGE_KEY = "sc_ui_language";

function readStoredUiLanguage(): string | null {
  try {
    return window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
  } catch {
    return null; // private browsing / storage disabled — just means no override
  }
}

async function fetchPreferredLanguage(userId: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("profiles")
    .select("preferred_language_code")
    .eq("user_id", userId)
    .maybeSingle<{ preferred_language_code: string | null }>();

  if (error) {
    console.error("[useLanguage] failed to load preferred_language_code", error);
    return null;
  }
  return data?.preferred_language_code ?? null;
}

export interface UseLanguageResult {
  languageCode: string;
  source: "device" | "url" | "profile" | "default";
  isLoading: boolean;
}

export function useLanguage(userId: string | null | undefined): UseLanguageResult {
  const [searchParams] = useSearchParams();
  const urlLang = searchParams.get("lang");
  const storedLang = readStoredUiLanguage();

  // No point fetching a stored preference that's about to be overridden by
  // an explicit device choice or the URL, and nothing to fetch at all for an
  // anonymous visitor.
  const shouldFetchProfile = !storedLang && !urlLang && !!userId;

  const { data: profileLang, isLoading: profileLoading } = useQuery({
    queryKey: ["preferred-language", userId ?? null],
    queryFn: () => fetchPreferredLanguage(userId as string),
    enabled: shouldFetchProfile,
    staleTime: 5 * 60_000,
  });

  if (storedLang) {
    return { languageCode: storedLang, source: "device", isLoading: false };
  }
  if (urlLang) {
    return { languageCode: urlLang, source: "url", isLoading: false };
  }
  if (shouldFetchProfile && profileLoading) {
    // Genuinely unresolved — see isLoading note above.
    return { languageCode: DEFAULT_LANGUAGE, source: "default", isLoading: true };
  }
  if (profileLang) {
    return { languageCode: profileLang, source: "profile", isLoading: false };
  }
  return { languageCode: DEFAULT_LANGUAGE, source: "default", isLoading: false };
}
