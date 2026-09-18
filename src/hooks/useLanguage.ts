// src/hooks/useLanguage.ts
//
// Resolves the language a question/feed should render in, for both signed-in
// and anonymous visitors. Precedence:
//   1. localStorage sc_ui_language, but ONLY when sc_ui_language_explicit="1"
//      marks it as a deliberate past choice (see readStoredUiLanguage) —
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

import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";

const DEFAULT_LANGUAGE = "en";
// Sep 2026, NEW. Must match UI_LANGUAGE_STORAGE_KEY in useUiLanguage.ts —
// kept as an independent literal (not imported) to avoid a circular import,
// since useUiLanguage.ts itself imports useLanguage from this file.
const UI_LANGUAGE_STORAGE_KEY = "sc_ui_language";
// Must match UI_LANGUAGE_EXPLICIT_KEY in useUiLanguage.ts — same independent
// literal convention as above, for the same circular-import reason.
const UI_LANGUAGE_EXPLICIT_KEY = "sc_ui_language_explicit";

// Sep 2026, NEW — see the reactivity fix below. Exported so useUiLanguage.ts
// (which already imports from this file — a safe, existing one-way
// dependency) can dispatch it whenever the toggle changes the stored value.
export const UI_LANGUAGE_CHANGE_EVENT = "sc-ui-language-changed";

// Sep 2026, FIXED: this returned the stored value unconditionally, so a stale
// sc_ui_language="en" — left behind by one click on the header toggle back when
// it rendered for everyone — outranked the user's actual profile preference
// forever. Two hooks then disagreed about the same value: this one treated it as
// an explicit standing choice, while useShouldShowLanguageToggle deliberately
// treated it as meaningless for exactly the same reason it is meaningless here.
//
// Observed consequence: an account whose profile said Hindi kept seeing English
// through hard reloads, the Settings language control appeared to do nothing,
// and the header toggle that could have overwritten the stale value is hidden
// outside India — leaving no reachable way to change language at all.
//
// Three cases, and the middle one is the migration that matters:
//
//   flag set          -> honour the value, whatever it is. Keyed on the FLAG and
//                        not on "value differs from default", because a stored
//                        "en" from a real click is a genuine preference and must
//                        still beat a profile that says otherwise.
//   no flag, non-"en" -> honour it. Written before the flag existed, but nobody
//                        ever ended up with "hi" by accident — the stale-value
//                        problem is specific to the DEFAULT, which the old
//                        unconditional toggle wrote on a single click of an
//                        already-active button. Dropping these would strip the
//                        language from exactly the Hindi speakers this is meant
//                        to serve.
//   no flag, "en"     -> ignore. Indistinguishable from never having chosen.
// Exported (Sep 2026) so useUiLanguage can apply the SAME rule. It used to keep
// its own unguarded copy, and the moment this one gained the flag check the two
// disagreed: on a browser carrying the stale "en", question CONTENT correctly
// fell through to the profile (Hindi) while the UI CHROME still honoured the
// stale value and stayed English — one page, two languages. A duplicated rule is
// only safe while it never changes, and this one just did.
export function readStoredUiLanguage(): string | null {
  try {
    const value = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    if (!value) return null;
    const explicit = window.localStorage.getItem(UI_LANGUAGE_EXPLICIT_KEY) === "1";
    if (!explicit && value === DEFAULT_LANGUAGE) return null;
    return value;
  } catch {
    return null; // private browsing / storage disabled — just means no override
  }
}

// Sep 2026, NEW — see header note update. `readStoredUiLanguage()` used to
// be called directly inline at render time: a plain, non-reactive
// localStorage.getItem(). That's fine for a component's OWN first render,
// but React has no way to know it needs to re-render THIS component just
// because some other, unrelated component (the header toggle, via
// useUiLanguage.setLanguageCode) wrote a new value to localStorage —
// localStorage writes don't trigger re-renders on their own. Confirmed live:
// clicking EN in the header correctly flipped the toggle's own pill
// (AppTopBar re-renders itself, since useUiLanguage owns real React state),
// but Index.tsx / QuestionDetailPage.tsx — which only ever call useLanguage(),
// never useUiLanguage() directly — kept showing the previous language's
// content until a hard reload, since nothing told them to re-run this hook.
// This wraps the read in real state that updates on the shared change event
// useUiLanguage now dispatches, so every consumer of useLanguage() re-renders
// the moment the toggle (or any other setLanguageCode call) fires, not just
// the one component that happens to own the click handler.
function useReactiveStoredUiLanguage(): string | null {
  const [stored, setStored] = React.useState<string | null>(readStoredUiLanguage);
  React.useEffect(() => {
    const onChange = () => setStored(readStoredUiLanguage());
    window.addEventListener(UI_LANGUAGE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(UI_LANGUAGE_CHANGE_EVENT, onChange);
  }, []);
  return stored;
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
  const storedLang = useReactiveStoredUiLanguage();

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
