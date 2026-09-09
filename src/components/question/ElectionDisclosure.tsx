// src/components/question/ElectionDisclosure.tsx
// Epic C / Epic EL — election chrome for the question detail page (bug C-11).
//
// §6.2 of the Epic C doc says election questions render party/candidate/
// constituency chrome and election_disclosure_text on /q/:id. They did not:
// QuestionDetailPage had no election handling at all, and ElectionQuestionCard
// — the only component that renders this — is reachable only through
// QuestionCard, whose entire feed chain (ActiveQuestionsFeed,
// ThreeTierQuestionsFeed via TodayQuestionsFeed, TrendingQuestionsSection) has
// no referents, so nothing rendered it. The disclosure is a compliance surface
// (Section 126B), so an election question showing none of it is the real defect.
//
// Self-contained and fetches by questionId, the same shape as ProposerBadge,
// so get_question_localized keeps its current signature and every other caller
// of it is untouched. Renders nothing for non-election questions.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Vote, User, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type ElectionRow = {
  is_election_question: boolean | null;
  election_party_abbreviation: string | null;
  election_party_colour: string | null;
  election_candidate_name: string | null;
  election_constituency_name: string | null;
  election_issue_tag: string | null;
  election_disclosure_text: string | null;
};

const FIELDS = [
  "is_election_question",
  "election_party_abbreviation",
  "election_party_colour",
  "election_candidate_name",
  "election_constituency_name",
  "election_issue_tag",
  "election_disclosure_text",
].join(",");

// Mirrors formatIssueTag in ElectionQuestionCard.
function formatIssueTag(tag: string | null | undefined): string {
  if (!tag) return "";
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type Props = {
  questionId: string;
  className?: string;
};

export function ElectionDisclosure({ questionId, className }: Props) {
  const { data } = useQuery<ElectionRow | null>({
    queryKey: ["question-election", questionId],
    enabled: !!questionId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/questions?id=eq.${questionId}&select=${FIELDS}`,
        { headers: supabaseHeaders(getJwt()) },
      );
      if (!res.ok) return null;
      const rows = (await res.json()) as ElectionRow[];
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
  });

  if (!data?.is_election_question) return null;

  const colour = data.election_party_colour ?? "#94a3b8";
  const issue = formatIssueTag(data.election_issue_tag);

  return (
    <div
      className={cn(
        "relative rounded-lg border border-slate-200 bg-slate-50 py-3 pl-4 pr-3",
        className,
      )}
    >
      {/* Party brand colour bar, same treatment as ElectionQuestionCard */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
        style={{ backgroundColor: colour }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1 text-xs">
          <Vote className="h-3.5 w-3.5" />
          Election
        </Badge>

        {data.election_party_abbreviation && (
          <span
            className="rounded px-1.5 py-0.5 text-xs font-semibold text-white"
            style={{ backgroundColor: colour }}
          >
            {data.election_party_abbreviation}
          </span>
        )}

        {issue && (
          <Badge variant="outline" className="text-xs">
            {issue}
          </Badge>
        )}
      </div>

      {(data.election_candidate_name || data.election_constituency_name) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          {data.election_candidate_name && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5 text-slate-400" />
              {data.election_candidate_name}
            </span>
          )}
          {data.election_constituency_name && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              {data.election_constituency_name}
            </span>
          )}
        </div>
      )}

      {data.election_disclosure_text && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          {data.election_disclosure_text}
        </p>
      )}
    </div>
  );
}

export default ElectionDisclosure;
