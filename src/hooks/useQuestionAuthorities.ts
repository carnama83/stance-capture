// src/hooks/useQuestionAuthorities.ts
// Epic R — shared data hook for question_authority_map + authority_registry.
// Extracted from AuthorityBlock.tsx (M-R02) so IncidentSummaryCard (M-R07)
// can reuse the same query — same queryKey means react-query serves both
// components from a single cached fetch, not two separate network calls.

import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";

export interface QuestionAuthorityRow {
  authority_id: string;
  confidence_level: "confirmed" | "likely" | "unclear";
  authority_registry: {
    name: string;
    domain: string;
    jurisdiction_level: string;
  } | null;
}

export function useQuestionAuthorities(questionId: string) {
  return useQuery<QuestionAuthorityRow[]>({
    queryKey: ["question-authorities", questionId],
    enabled: !!questionId,
    staleTime: 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb
        .from("question_authority_map")
        .select("authority_id, confidence_level, authority_registry(name, domain, jurisdiction_level)")
        .eq("question_id", questionId);
      if (error) {
        console.error("[useQuestionAuthorities] fetch failed", error);
        return [];
      }
      return (data ?? []) as unknown as QuestionAuthorityRow[];
    },
  });
}
