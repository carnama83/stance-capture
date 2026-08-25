// src/components/question/QuestionContextCard.tsx
// Generic background-context card — the non-incident counterpart to
// IncidentSummaryCard. Deliberately NEUTRAL styling (no AlertTriangle, no
// "Civic Incident" label, no authority/institution coupling): this renders
// for ANY question with a context_summary, most commonly UGQ auto-published
// questions where ugq-screen's preview pass adds a grounded background
// blurb + source links pulled from web search (see ugq-screen). Reusing
// IncidentSummaryCard here would visually mislabel ordinary policy/opinion
// questions as incidents/warnings — this component exists specifically to
// avoid that.
//
// Placement: same slot IncidentSummaryCard occupies (before AuthorityBlock,
// before the stance slider) — shown before the user takes a stance so
// context is clear, same rationale as US-R14, just for content_type !=
// 'incident'.
//
// supporting_links renders as a short "Sources" list. Each URL is shown by
// hostname only (not the full link) to keep the card compact — full link
// still lives in the href.

import * as React from "react";
import { Info, ExternalLink } from "lucide-react";

interface QuestionContextCardProps {
  contextSummary?: string | null;
  supportingLinks?: string[] | null;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function QuestionContextCard({
  contextSummary,
  supportingLinks,
}: QuestionContextCardProps) {
  const text = contextSummary?.trim() || null;
  const links = (supportingLinks ?? []).filter((u): u is string => typeof u === "string" && u.trim().length > 0);

  if (!text) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-3">
      <div className="flex items-start gap-2">
        <Info className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-500 mb-1">
            Background
          </p>

          <p className="text-sm text-slate-700 leading-relaxed">{text}</p>

          {links.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-slate-200">
              <span className="text-[11px] font-medium text-slate-500">Sources:</span>
              {links.slice(0, 3).map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[11px] text-slate-600 hover:text-slate-900 hover:underline"
                >
                  {hostnameOf(url)}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default QuestionContextCard;
