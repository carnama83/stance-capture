// src/components/question/ElectionCardChrome.tsx
// Epic C / Epic EL — compact election chrome for V5 homepage feed cards (C-11).
//
// The full-card ElectionQuestionCard is unreachable from the V5 homepage, which
// renders its own FeaturedQuestionCard / GridQuestionCard rather than going
// through QuestionCard. Rebuilding those cards around ElectionQuestionCard would
// mean reviving components the V5 redesign deliberately replaced, so this instead
// adds a compact chrome strip the existing cards can drop in: ELECTION badge,
// party abbreviation in the party colour, issue tag, and candidate / constituency.
//
// Deliberately compact — a feed card is not the place for the full Section 126B
// disclosure, which stays on the detail page via ElectionDisclosure. Renders
// nothing when the question is not an election question.

import * as React from "react";
import { Vote, User, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ElectionMeta } from "@/hooks/useElectionMeta";

// Mirrors formatIssueTag in ElectionQuestionCard / ElectionDisclosure.
function formatIssueTag(tag: string | null | undefined): string {
  if (!tag) return "";
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ElectionCardChrome({
  meta,
  className,
}: {
  meta: ElectionMeta | undefined;
  className?: string;
}) {
  if (!meta) return null;

  const colour = meta.election_party_colour ?? "#94a3b8";
  const issue = formatIssueTag(meta.election_issue_tag);

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]", className)}>
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-white"
        style={{ backgroundColor: colour }}
      >
        <Vote className="h-3 w-3" />
        Election
      </span>

      {meta.election_party_abbreviation && (
        <span className="font-semibold" style={{ color: colour }}>
          {meta.election_party_abbreviation}
        </span>
      )}

      {issue && <span className="text-slate-500">{issue}</span>}

      {meta.election_candidate_name && (
        <span className="inline-flex items-center gap-1 text-slate-600">
          <User className="h-3 w-3 text-slate-400" />
          {meta.election_candidate_name}
        </span>
      )}

      {meta.election_constituency_name && (
        <span className="inline-flex items-center gap-1 text-slate-600">
          <MapPin className="h-3 w-3 text-slate-400" />
          {meta.election_constituency_name}
        </span>
      )}
    </div>
  );
}

export default ElectionCardChrome;
