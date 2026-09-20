// src/hooks/useTopicLabels.ts
//
// PR 1.5 — localized topic labels, resolved client-side.
//
// Topic titles reach the UI from several directions: the feed RPCs return
// topic_title, the societal-pulse chips carry their own titles, and the
// early-stage pulse returns featured_topics. Threading a language through every
// one of those and rewriting each to call topic_title_for() would mean touching
// a lot of SQL for what is, by the brief's own classification, a plain Class 3
// lookup with no lineage and no review queue.
//
// Instead the whole map is fetched once per language and applied wherever a
// topic is rendered. It is small — 115 rows for every topic in use — cached by
// TanStack Query, and every consumer already has the topic_id in hand.
//
// Deliberately falls back to the canonical English title rather than hiding
// anything. An untranslated topic chip must not remove a translated question
// from the feed; that is the opposite of wording_for(), where a missing
// rendition SHOULD withhold the item, because there the words are the
// instrument being measured against.

import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";

type TopicTranslationRow = {
  topic_id: string;
  display_name: string;
};

/**
 * Map of topic_id → localized display name for one language.
 *
 * English resolves to an empty map on purpose: `topics.title` is already the
 * canonical English, so there is nothing to override and no request to make.
 */
export function useTopicLabels(languageCode: string) {
  const query = useQuery<Map<string, string>>({
    queryKey: ["topic-labels", languageCode],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const empty = new Map<string, string>();
      if (!languageCode || languageCode === "en") return empty;

      const sb = getSupabase();
      if (!sb) return empty;

      const { data, error } = await sb
        .from("topic_translations")
        .select("topic_id, display_name")
        .eq("language_code", languageCode);

      if (error) {
        // Non-fatal: callers fall back to the English title, so a failed
        // lookup degrades to today's behaviour rather than blanking labels.
        console.warn("[useTopicLabels] falling back to canonical titles", error);
        return empty;
      }

      const map = new Map<string, string>();
      for (const row of (data ?? []) as TopicTranslationRow[]) {
        if (row.topic_id && row.display_name) map.set(row.topic_id, row.display_name);
      }
      return map;
    },
  });

  const labels = query.data ?? new Map<string, string>();

  /** Localized label for a topic, falling back to the supplied English title. */
  const topicLabel = (topicId: string | null | undefined, fallback: string | null | undefined) =>
    (topicId ? labels.get(topicId) : undefined) ?? fallback ?? "";

  return { labels, topicLabel, isLoading: query.isLoading };
}
