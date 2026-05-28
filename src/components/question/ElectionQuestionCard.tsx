// src/components/question/ElectionQuestionCard.tsx
//
// Epic EL — Election Question Card
//
// Renders an election question card with:
//   - Coloured left border (party brand colour)
//   - ELECTION badge + issue tag badge
//   - Party abbreviation + local candidate cross-link (Option C)
//   - Question text
//   - Context summary (paraphrased source)
//   - Disclosure footer (Section 126B / anti-funding note)
//   - Silence state awareness: shows locked state during SILENCE
//
// Used by QuestionCard when is_election_question = true.
// Self-contained — does not depend on election-specific state stores.

import * as React from "react";
import { Link } from "react-router-dom";
import type { QuestionWithLifecycle } from "@/types/questionLifecycleTypes";
import { Badge } from "@/components/ui/badge";
import { Vote, User, MapPin, Lock, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ElectionQuestionCardProps = {
  question: QuestionWithLifecycle;
  isSilent?: boolean;    // true when election state = SILENCE or POLLING
  showDisclosure?: boolean;
  className?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatIssueTag(tag: string | null | undefined): string {
  if (!tag) return "";
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Returns a readable label for question type
function questionTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case "PARTY_POLICY":       return "Party Policy";
    case "CANDIDATE_STATEMENT":return "Candidate Statement";
    case "ALLIANCE_POSITION":  return "Alliance Position";
    case "MANUAL":             return "Admin";
    default:                   return "Election";
  }
}

// ─── Party Colour Bar ─────────────────────────────────────────────────────────

function PartyColourBar({ colour }: { colour: string | null | undefined }) {
  return (
    <div
      className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
      style={{ backgroundColor: colour ?? "#94a3b8" }}
    />
  );
}

// ─── Local Candidate Strip (Option C) ─────────────────────────────────────────
// Shown only for party-level questions when a local candidate is found

function LocalCandidateStrip({
  candidateName,
  candidateNameLocal,
  partyAbbreviation,
  partyColour,
  constituencyName,
}: {
  candidateName: string;
  candidateNameLocal: string | null | undefined;
  partyAbbreviation: string | null | undefined;
  partyColour: string | null | undefined;
  constituencyName: string | null | undefined;
}) {
  return (
    <div className="flex items-center gap-2 rounded bg-slate-50 border border-slate-200 px-3 py-1.5 text-xs">
      <User className="h-3 w-3 text-muted-foreground shrink-0" />
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        <span className="text-muted-foreground">Your</span>
        {partyAbbreviation && (
          <span
            className="font-semibold px-1 py-0.5 rounded text-white text-[10px]"
            style={{ backgroundColor: partyColour ?? "#64748b" }}
          >
            {partyAbbreviation}
          </span>
        )}
        <span className="text-muted-foreground">candidate:</span>
        <span className="font-medium text-foreground truncate">{candidateName}</span>
        {candidateNameLocal && (
          <span className="text-muted-foreground">({candidateNameLocal})</span>
        )}
        {constituencyName && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <MapPin className="h-2.5 w-2.5" />
              {constituencyName}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Silence Overlay ──────────────────────────────────────────────────────────

function SilenceBanner() {
  return (
    <div className="flex items-center gap-2 rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
      <Lock className="h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>Stance submission paused.</strong> Electoral silence period is active (RPA 1951 §126).
        Submissions reopen after polling closes.
      </span>
    </div>
  );
}

// ─── Main Card ────────────────────────────────────────────────────────────────

export function ElectionQuestionCard({
  question,
  isSilent = false,
  showDisclosure = true,
  className = "",
}: ElectionQuestionCardProps) {
  const {
    id,
    question: questionText,
    election_party_colour,
    election_party_abbreviation,
    election_candidate_name,
    election_constituency_name,
    election_disclosure_text,
    election_issue_tag,
    election_question_type,
    election_candidate_id,
    local_candidate_id,
    local_candidate_name,
    local_candidate_name_local,
    local_candidate_status,
  } = question;

  // Determine attribution display
  const isPartyLevel = !election_candidate_id;
  const isCandidateLevel = !!election_candidate_id;

  // Option C: show local candidate strip only for party-level questions
  // where we found a matching candidate in the user's constituency
  const showLocalCandidate =
    isPartyLevel &&
    !!local_candidate_id &&
    !!local_candidate_name &&
    local_candidate_status !== "WITHDRAWN" &&
    local_candidate_status !== "DISQUALIFIED";

  return (
    <Link
      to={`/q/${id}`}
      className={`
        relative block border rounded-lg overflow-hidden bg-white pl-3
        hover:shadow-md transition-all duration-200
        ${isSilent ? "opacity-75 pointer-events-none" : "hover:border-blue-300"}
        ${className}
      `}
    >
      {/* Party colour left border */}
      <PartyColourBar colour={election_party_colour} />

      <div className="p-4 pl-3 space-y-3">

        {/* Header badges */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* ELECTION badge */}
            <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-white uppercase tracking-wide">
              <Vote className="h-2.5 w-2.5" />
              Election
            </span>

            {/* Party abbreviation badge */}
            {election_party_abbreviation && (
              <span
                className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold text-white uppercase"
                style={{ backgroundColor: election_party_colour ?? "#64748b" }}
              >
                {election_party_abbreviation}
              </span>
            )}

            {/* Question type */}
            <span className="text-[10px] text-muted-foreground">
              {questionTypeLabel(election_question_type)}
            </span>

            {/* Issue tag */}
            {election_issue_tag && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                {formatIssueTag(election_issue_tag)}
              </Badge>
            )}
          </div>

          {/* Constituency scope */}
          {isCandidateLevel && election_constituency_name && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
              <MapPin className="h-3 w-3" />
              {election_constituency_name}
            </span>
          )}
        </div>

        {/* Candidate attribution for candidate-level questions */}
        {isCandidateLevel && election_candidate_name && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3 w-3 shrink-0" />
            <span>{election_candidate_name}</span>
          </div>
        )}

        {/* Option C: local candidate cross-link for party-level questions */}
        {showLocalCandidate && local_candidate_name && (
          <LocalCandidateStrip
            candidateName={local_candidate_name}
            candidateNameLocal={local_candidate_name_local}
            partyAbbreviation={election_party_abbreviation}
            partyColour={election_party_colour}
            constituencyName={election_constituency_name}
          />
        )}

        {/* Question text */}
        <h3 className="text-base font-semibold leading-snug text-gray-900 hover:text-blue-700">
          {questionText}
        </h3>

        {/* Context / paraphrase */}
        {question.summary && (
          <p className="text-sm text-gray-500 line-clamp-2 leading-relaxed">
            {question.summary}
          </p>
        )}

        {/* Silence banner */}
        {isSilent && <SilenceBanner />}

        {/* Disclosure footer */}
        {showDisclosure && election_disclosure_text && !isSilent && (
          <p className="text-[10px] text-muted-foreground border-t pt-2 leading-relaxed">
            {election_disclosure_text}
          </p>
        )}
      </div>
    </Link>
  );
}
