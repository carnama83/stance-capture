// src/hooks/useLanguage.ts
//
// Resolves the language a question/feed should render in, for both signed-in
// and anonymous visitors. Precedence:
//   1. ?lang= on the current URL — set by the /s/<slug>/<lang> share redirect
//      (see api/s/[slug].js), or a manual override. Highest priority: this is
//      an explicit signal for the CURRENT page view.
//   2. profiles.preferred_language_code, for a signed-in user.
//   3. 'en'.
//
// Deliberately does NOT write a URL-sourced language back into
// profiles.preferred_language_code. A shared link reflects what the SENDER
// was viewing, not necessarily a deliberate preference change by whoever
// clicked it — only an explicit language-switcher action (not built yet)
// should update the stored preference.
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
  source: "url" | "profile" | "default";
  isLoading: boolean;
}

export function useLanguage(userId: string | null | undefined): UseLanguageResult {
  const [searchParams] = useSearchParams();
  const urlLang = searchParams.get("lang");

  // No point fetching a stored preference the URL is about to override, and
  // nothing to fetch at all for an anonymous visitor.
  const shouldFetchProfile = !urlLang && !!userId;

  const { data: profileLang, isLoading: profileLoading } = useQuery({
    queryKey: ["preferred-language", userId ?? null],
    queryFn: () => fetchPreferredLanguage(userId as string),
    enabled: shouldFetchProfile,
    staleTime: 5 * 60_000,
  });

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
