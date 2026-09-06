// src/lib/i18n.ts
//
// UI-chrome translation (buttons, labels, nav, toasts) — separate mechanism
// from question_renditions, which handles dynamic civic-question content.
// See the SettingsProfile.tsx header comment for why these are deliberately
// different systems: fixed finite strings vs. dynamic AI-generated content.
//
// Deliberately NOT using i18next-browser-languagedetector. That would create
// a SECOND, independent source of truth for "what language is this person
// using" — one that could disagree with useLanguage's resolution (URL ?lang=
// > profiles.preferred_language_code > 'en'). Instead, i18n.changeLanguage()
// is called explicitly wherever useLanguage() already resolves a language
// (see AppTopBar.tsx, ShareButton's parent, etc.) — one resolution, driving
// both the question content AND the UI chrome, never two independent guesses
// that could show Hindi questions inside an English-labelled page or vice versa.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en/common.json";
import hi from "@/locales/hi/common.json";

i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    hi: { common: hi },
  },
  lng: "en", // real value set via i18n.changeLanguage() once useLanguage resolves
  fallbackLng: "en", // a key missing in hi.json renders English rather than a raw key string
  ns: ["common"],
  defaultNS: "common",
  interpolation: {
    escapeValue: false, // React already escapes — double-escaping would corrupt {{tweetId}} etc.
  },
});

export default i18n;
