// src/components/question/ContentLanguageIndicator.tsx
//
// PR 1.9 — the content-language indicator.
//
// Under the permissive language policy (profiles.show_unavailable_language),
// a question with no rendition in the reader's language is shown in its
// original language instead of being withheld. Until now that happened
// SILENTLY: the page simply contained a question in another language with
// nothing to say so.
//
// A labelled fallback is the whole difference between "this item is in English
// and we are telling you" and "this page is mixed-language for reasons you
// cannot see". It also matters for measurement: a stance recorded against a
// fallback rendition is a real response to a real instrument, just not one in
// the reader's language, and the reader should know which they answered.
//
// The chip renders in the UI LANGUAGE, not the content language — a Hindi
// reader sees "अंग्रेज़ी में", never "English". Rendering it as "English" and
// allowlisting it in the DOM scan would be a genuine Latin-script leak waved
// through by hand.
//
// The language NAME comes from Intl rather than a hardcoded key, so this reads
// correctly for any future language pair without new strings.

import { useTranslation } from "react-i18next";
import { languageDisplayName } from "@/lib/intlFormat";

type Props = {
  /** Language of the rendition actually being displayed. */
  renditionLanguageCode?: string | null;
  className?: string;
};

export function ContentLanguageIndicator({ renditionLanguageCode, className }: Props) {
  const { t, i18n } = useTranslation();

  const uiLanguage = i18n.language || "en";
  const contentLanguage = (renditionLanguageCode ?? "").trim();

  // Nothing to say when the content is already in the reader's language, or
  // when we do not know what language it is in. Comparison is on the base
  // subtag so "hi" and "hi-IN" are not treated as different languages.
  const base = (code: string) => code.split("-")[0].toLowerCase();
  if (!contentLanguage || base(contentLanguage) === base(uiLanguage)) return null;

  const name = languageDisplayName(uiLanguage, contentLanguage);

  return (
    <span
      className={
        className ??
        "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600"
      }
      title={t("language.shownInTitle", { language: name })}
    >
      {t("language.shownIn", { language: name })}
    </span>
  );
}
