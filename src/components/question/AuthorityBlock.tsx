// src/components/question/AuthorityBlock.tsx
// Epic R — M-R02: Authority display on QuestionDetailPage (R-FR-09).
//
// BR-R03: Authority display must always precede any expectation or action
// content. This component is self-contained (fetches its own data by
// questionId, mirrors TradeoffExplorer.tsx's self-fetch pattern) so the
// parent only needs to render it — and render it first.
//
// Renders nothing if no authority is mapped for this question (R-FR-09:
// "only rendered when at least one authority is mapped by admin").
//
// M-R07 update: the fetch hook now lives in useQuestionAuthorities.ts,
// shared with IncidentSummaryCard — same queryKey means both components
// read from one cached fetch, not two separate network calls.

import * as React from "react";
import { Landmark } from "lucide-react";
import { useQuestionAuthorities } from "@/hooks/useQuestionAuthorities";

export function AuthorityBlock({ questionId }: { questionId: string }) {
  const { data: authorities = [] } = useQuestionAuthorities(questionId);

  if (authorities.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-3">
      <div className="flex items-start gap-2">
        <Landmark className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700">
            This issue falls under the responsibility of:
          </p>
          <div className="mt-1 space-y-0.5">
            {authorities.map((a) => {
              const reg = a.authority_registry;
              if (!reg) return null;
              const isUnclear = a.confidence_level === "unclear";
              return (
                <p key={a.authority_id} className="text-xs text-slate-600">
                  <span className="font-medium">{reg.name}</span>
                  {" — "}
                  <span className="capitalize">{reg.domain}</span>
                  {" / "}
                  <span className="capitalize">{reg.jurisdiction_level}</span>
                  {isUnclear && (
                    <span className="text-slate-400 italic"> (unconfirmed)</span>
                  )}
                </p>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
