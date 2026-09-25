// src/components/question/AuthorityResponseStatusBlock.tsx
// Epic R — M-R08: Response status display (US-R16, QA-R17).
//
// Unlike ExpectationSignalBlock, this is NOT gated by the viewer's own
// region — US-R16 says "on the question detail page ... I can see the
// current authority response status", with no "for my region" qualifier
// the way US-R09 had for the expectation signal. Treated here as an
// objective institutional-accountability record: shown regardless of who's
// viewing, across all regions the question has tracked responses for.
// authority_responses has public SELECT (no RLS restriction beyond
// admin-write), so this works for anonymous visitors too.
//
// STATUS_LABELS/STATUS_COLORS are exported so PublicLedgerPage (which needs
// the exact same status vocabulary, filtered to one region) doesn't
// maintain a second, driftable copy — same reasoning as EXPECTATION_LABELS.

import * as React from "react";
import { localeFor } from "@/lib/intlFormat";
import i18n from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface AuthorityResponseRow {
  id: string;
  response_status: string;
  status_updated_at: string;
  region_id: string | null;
  authority_registry: { name: string } | null;
  /** Epic R R-10: the region this status applies to, so rows are never ambiguous. */
  region_name?: string | null;
}

export const STATUS_LABEL_KEYS: Record<string, string> = {
  unacknowledged: "authorityStatus.unacknowledged",
  under_review: "authorityStatus.underReview",
  action_announced: "authorityStatus.actionAnnounced",
  action_completed: "authorityStatus.actionCompleted",
  no_response: "authorityStatus.noResponse",
};

export const STATUS_COLORS: Record<string, string> = {
  unacknowledged: "bg-slate-100 text-slate-600",
  under_review: "bg-amber-100 text-amber-700",
  action_announced: "bg-blue-100 text-blue-700",
  action_completed: "bg-green-100 text-green-700",
  no_response: "bg-red-100 text-red-700",
};

export function formatResponseDate(iso: string): string {
  return new Date(iso).toLocaleDateString(localeFor(i18n.language), { dateStyle: "medium" });
}

function useAuthorityResponses(questionId: string) {
  return useQuery<AuthorityResponseRow[]>({
    queryKey: ["authority-responses", questionId],
    enabled: !!questionId,
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb
        .from("authority_responses")
        .select("id, response_status, status_updated_at, region_id, authority_registry(name)")
        .eq("question_id", questionId)
        .order("status_updated_at", { ascending: false });
      if (error) {
        console.error("[AuthorityResponseStatusBlock] fetch failed", error);
        return [];
      }
      const rows = (data ?? []) as unknown as AuthorityResponseRow[];
      // Epic R R-10: label each row with its region. There is no FK from
      // authority_responses.region_id to locations, so look the names up.
      const regionIds = Array.from(new Set(rows.map((r) => r.region_id).filter((id): id is string => !!id)));
      if (regionIds.length > 0) {
        const { data: locs } = await sb.from("locations").select("id, name").in("id", regionIds);
        const names = new Map((locs ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));
        for (const r of rows) r.region_name = r.region_id ? names.get(r.region_id) ?? null : null;
      }
      return rows;
    },
  });
}

export function AuthorityResponseStatusBlock({ questionId }: { questionId: string }) {
  const { t } = useTranslation();
  const { data: responses = [] } = useAuthorityResponses(questionId);

  if (responses.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 mb-3">
      <div className="flex items-center gap-1.5 mb-2">
        <ClipboardCheck className="h-3.5 w-3.5 text-slate-500" />
        <p className="text-xs font-medium text-slate-700">{t("publicLedger.responseStatus")}</p>
      </div>
      <div className="space-y-1.5">
        {responses.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-600 truncate">
              {r.authority_registry?.name ?? t("publicLedger.authority")}
              {r.region_name && <span className="text-slate-400"> · {r.region_name}</span>}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${
                  STATUS_COLORS[r.response_status] ?? "bg-slate-100 text-slate-600"
                }`}
              >
                {STATUS_LABEL_KEYS[r.response_status]
                  ? t(STATUS_LABEL_KEYS[r.response_status])
                  : r.response_status}
              </span>
              <span className="text-[10px] text-slate-400">{formatResponseDate(r.status_updated_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
