// src/components/ugq/ProposerBadge.tsx
// Epic UGQ — Build Step 6: attribution badge (spec §9.3).
//
// Shows "Proposed by @handle" only for community-sourced questions. Resolves the
// proposer's display handle privacy-safely via get_question_proposer (random_id
// unless the user opted into username display). Renders nothing otherwise.
//
// Pass `source` when the caller already knows it (e.g. the question detail page)
// so editorial questions skip the network call entirely.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type ProposerRow = { proposer_handle: string | null; proposed_by: string | null };

type Props = {
  questionId: string;
  source?: string | null;
  className?: string;
};

export function ProposerBadge({ questionId, source, className }: Props) {
  const enabled = !!questionId && (source == null || source === "community");

  const { data } = useQuery<ProposerRow | null>({
    queryKey: ["question-proposer", questionId],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_question_proposer`, {
        method: "POST",
        headers: supabaseHeaders(getJwt()),
        body: JSON.stringify({ p_question_id: questionId }),
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as ProposerRow[];
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
  });

  if (!data?.proposer_handle) return null;

  return (
    <div className={cn("inline-flex items-center gap-1 text-xs text-slate-500", className)}>
      <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
      <span>Proposed by <span className="font-medium text-slate-700">@{data.proposer_handle}</span></span>
    </div>
  );
}

export default ProposerBadge;
