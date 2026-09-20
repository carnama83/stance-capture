// src/hooks/useRenditionLanguages.ts
//
// PR 1.9 — which language is each displayed rendition actually in?
//
// The content-language indicator needs to compare the rendition on screen
// against the reader's UI language. wording_for() picks the rendition and the
// RPCs return its id, but not its language.
//
// Adding language_code to every wording-returning RPC would mean another
// DROP + CREATE across ten functions — each one a return-type change — to carry
// a field that is a plain attribute of a row the client can already read.
// public.question_renditions has a public_read policy for
// lifecycle_status = 'published', and wording_for() only ever selects published
// rows, so every rendition that can appear on screen is readable by the client.
//
// One batched query per set of ids, not one per question.

import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";

type RenditionLanguageRow = { id: string; language_code: string };

/**
 * Map of rendition_id → language_code for the supplied ids.
 *
 * Ids are sorted into the query key so that the same set in a different order
 * is one cache entry rather than two.
 */
export function useRenditionLanguages(renditionIds: Array<string | null | undefined>) {
  const ids = Array.from(
    new Set(renditionIds.filter((x): x is string => typeof x === "string" && x.length > 0)),
  ).sort();

  const query = useQuery<Map<string, string>>({
    enabled: ids.length > 0,
    queryKey: ["rendition-languages", ids],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const map = new Map<string, string>();
      const sb = getSupabase();
      if (!sb || ids.length === 0) return map;

      const { data, error } = await sb
        .from("question_renditions")
        .select("id, language_code")
        .in("id", ids);

      if (error) {
        // Non-fatal: the indicator simply does not render, which is today's
        // behaviour. It must never block the question itself.
        console.warn("[useRenditionLanguages] indicator unavailable", error);
        return map;
      }
      for (const row of (data ?? []) as RenditionLanguageRow[]) {
        if (row.id && row.language_code) map.set(row.id, row.language_code);
      }
      return map;
    },
  });

  const languages = query.data ?? new Map<string, string>();

  const languageOf = (renditionId: string | null | undefined): string | null =>
    (renditionId ? languages.get(renditionId) : undefined) ?? null;

  return { languages, languageOf, isLoading: query.isLoading };
}
