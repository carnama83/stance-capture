// src/components/question/IncidentSummaryCard.tsx
// Epic R — M-R07: Incident summary card (US-R14, BR-R07).
//
// Shown above the stance slider when content_type='incident' — displayed
// BEFORE the user takes a stance, so context is clear (US-R14). This is a
// different placement rule than AuthorityBlock: the incident card explains
// what happened, the authority block explains who's responsible for it —
// natural reading order is what-happened first, then who's-responsible,
// then stance, then (post-stance) expectation capture. Both BR-R03
// (authority precedes expectation) and BR-R07 (incident card precedes
// expectation prompt) hold regardless of which of these two renders first,
// so this ordering is a readability choice, not a compliance requirement.
//
// "What happened" reads from context_summary (falls back to summary if
// null, matching the fallback convention already used elsewhere for these
// two fields — see the v_context_summary comment in the topic-draft
// finalisation function). "Responsible institution category" reads
// authority_registry.domain via the shared useQuestionAuthorities hook —
// no new column needed; R-FR-16 never specified one.

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { useQuestionAuthorities } from "@/hooks/useQuestionAuthorities";

interface IncidentSummaryCardProps {
  questionId: string;
  summary?: string | null;
  contextSummary?: string | null;
  publishedAt?: string | null;
}

export function IncidentSummaryCard({
  questionId,
  summary,
  contextSummary,
  publishedAt,
}: IncidentSummaryCardProps) {
  const { data: authorities = [] } = useQuestionAuthorities(questionId);

  const whatHappened = contextSummary?.trim() || summary?.trim() || null;
  const dateLabel = publishedAt
    ? new Date(publishedAt).toLocaleDateString(undefined, { dateStyle: "long" })
    : null;

  // Distinct institution categories (domains) across all mapped authorities,
  // deduplicated — a question can have more than one authority mapped.
  const institutionCategories = Array.from(
    new Set(
      authorities
        .map((a) => a.authority_registry?.domain)
        .filter((d): d is string => !!d)
    )
  );

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-wide uppercase text-amber-700 mb-1">
            Civic Incident
          </p>

          {whatHappened && (
            <p className="text-sm text-amber-900 mb-2">{whatHappened}</p>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-700">
            {dateLabel && (
              <span>
                <span className="font-medium">When:</span> {dateLabel}
              </span>
            )}
            {institutionCategories.length > 0 && (
              <span className="capitalize">
                <span className="font-medium">Category:</span>{" "}
                {institutionCategories.join(", ")}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
