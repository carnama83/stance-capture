// src/hooks/useElectionMeta.ts
// Epic C / Epic EL — election metadata for feed cards (bug C-11, feed half).
//
// get_trending_questions_homepage() does not return the election_* columns, and
// the V5 homepage builds its own cards (FeaturedQuestionCard / GridQuestionCard
// and their Anon variants) rather than going through QuestionCard, so the
// ElectionQuestionCard path never runs for the feed. Rather than widen that
// shared RPC's return type — which every homepage query depends on — this
// fetches the election columns for the currently visible questions in ONE
// request and hands the cards a lookup map.
//
// Only election questions come back (is_election_question=eq.true), so on a feed
// with no election content the map is simply empty and every card renders as before.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

export type ElectionMeta = {
  id: string;
  election_party_abbreviation: string | null;
  election_party_colour: string | null;
  election_candidate_name: string | null;
  election_constituency_name: string | null;
  election_issue_tag: string | null;
};

const FIELDS = [
  "id",
  "election_party_abbreviation",
  "election_party_colour",
  "election_candidate_name",
  "election_constituency_name",
  "election_issue_tag",
].join(",");

const EMPTY: ReadonlyMap<string, ElectionMeta> = new Map();

/**
 * Look up election chrome for a set of question ids. Returns an empty map while
 * loading, when nothing is passed, or when none of the questions are election
 * questions — callers can treat "not in the map" as "render normally".
 */
export function useElectionMeta(questionIds: (string | null | undefined)[]): ReadonlyMap<string, ElectionMeta> {
  // Stable, de-duplicated, sorted key so the query doesn't refetch just because
  // the feed re-rendered in a different order.
  const ids = React.useMemo(
    () => [...new Set(questionIds.filter((v): v is string => !!v))].sort(),
    [questionIds],
  );

  const { data } = useQuery<ElectionMeta[]>({
    queryKey: ["election-meta", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const inList = ids.map((id) => `"${id}"`).join(",");
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/questions?id=in.(${inList})&is_election_question=eq.true&select=${FIELDS}`,
        { headers: supabaseHeaders(getJwt()) },
      );
      if (!res.ok) return [];
      const rows = (await res.json()) as ElectionMeta[];
      return Array.isArray(rows) ? rows : [];
    },
  });

  return React.useMemo(() => {
    if (!data || data.length === 0) return EMPTY;
    return new Map(data.map((r) => [r.id, r]));
  }, [data]);
}

export default useElectionMeta;
