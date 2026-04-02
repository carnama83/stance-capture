// src/hooks/useOgMeta.ts
// Epic W — OG Metadata (W2)
//
// Dynamically updates <meta> tags in <head> when viewing a question.
// This enables rich previews when the question URL is shared on social platforms.
// Also injects twitter:card meta for X/Twitter large image cards.

import { useEffect } from "react";

interface OgMetaOptions {
  title: string;
  description: string;
  questionId: string;
  /** Falls back to a generated OG image URL if not provided */
  imageUrl?: string | null;
}

function setMeta(property: string, content: string, isName = false) {
  const attr = isName ? "name" : "property";
  let el = document.querySelector(`meta[${attr}="${property}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function removeMeta(property: string, isName = false) {
  const attr = isName ? "name" : "property";
  const el = document.querySelector(`meta[${attr}="${property}"]`);
  if (el) el.remove();
}

export function useOgMeta({ title, description, questionId, imageUrl }: OgMetaOptions) {
  useEffect(() => {
    const originalTitle = document.title;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

    // Dynamic OG image via Edge Function
    const ogImageUrl = imageUrl
      ?? `${supabaseUrl}/functions/v1/og-image?question_id=${questionId}`;

    const shareUrl = `${window.location.origin}/#/q/${questionId}`;
    const fullTitle = `${title} | Stance Capture`;

    // Page title
    document.title = fullTitle;

    // Open Graph
    setMeta("og:title", fullTitle);
    setMeta("og:description", description);
    setMeta("og:image", ogImageUrl);
    setMeta("og:url", shareUrl);
    setMeta("og:type", "article");
    setMeta("og:site_name", "Stance Capture");

    // Twitter / X
    setMeta("twitter:card", "summary_large_image", true);
    setMeta("twitter:title", fullTitle, true);
    setMeta("twitter:description", description, true);
    setMeta("twitter:image", ogImageUrl, true);

    return () => {
      // Restore original title and remove dynamic metas on unmount
      document.title = originalTitle;
      removeMeta("og:title");
      removeMeta("og:description");
      removeMeta("og:image");
      removeMeta("og:url");
      removeMeta("og:type");
      removeMeta("og:site_name");
      removeMeta("twitter:card", true);
      removeMeta("twitter:title", true);
      removeMeta("twitter:description", true);
      removeMeta("twitter:image", true);
    };
  }, [title, description, questionId, imageUrl]);
}
