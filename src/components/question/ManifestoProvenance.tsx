// src/components/question/ManifestoProvenance.tsx
//
// Epic MP — public trust block for manifesto-promise questions.
// Reads questions.source_meta (populated by mp_publish_promise) and renders the
// verbatim manifesto quote + a provenance chip (party · year · citation).
// Renders nothing for non-manifesto questions, so it is safe to drop anywhere.

import * as React from "react";
import { Quote } from "lucide-react";

export interface ManifestoSourceMeta {
  kind?: string;
  verbatim_quote?: string | null;
  citation?: string | null;
  party_name?: string | null;
  party_abbreviation?: string | null;
  election_year?: number | null;
  jurisdiction?: string | null;
}

export function ManifestoProvenance({
  sourceMeta,
  className = "",
}: {
  sourceMeta?: unknown;
  className?: string;
}) {
  const meta = (sourceMeta ?? null) as ManifestoSourceMeta | null;
  if (!meta || meta.kind !== "manifesto_promise" || !meta.verbatim_quote) {
    return null;
  }

  const party = meta.party_abbreviation || meta.party_name || "Party";
  const year = meta.election_year ? `${meta.election_year} manifesto` : "manifesto";
  const chip = [party, year, meta.citation].filter(Boolean).join(" · ");

  return (
    <figure
      className={`my-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 ${className}`}
    >
      <div className="flex gap-2">
        <Quote className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
        <blockquote className="text-sm md:text-base italic text-slate-700 leading-relaxed">
          {meta.verbatim_quote}
        </blockquote>
      </div>
      <figcaption className="mt-2 pl-6 text-xs font-medium text-slate-500">
        {chip}
      </figcaption>
    </figure>
  );
}

export default ManifestoProvenance;
