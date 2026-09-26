// src/pages/PublicLedgerPage.tsx
// Epic R — M-R04: Public Expectation Ledger (/ledger/:questionId/:regionId)
//
// Fully public, no login (R-FR-11). No AppTopBar/nav chrome beyond the
// "Data collected by Stance Capture" attribution — mirrors EmbedPage.tsx's
// "no chrome" pattern, the closest existing precedent for a route like this.
//
// Reads the FROZEN snapshot_summary from expectation_ledgers, not a live
// join to question_expectation_summary — matches R-FR-11's "reads
// expectation_ledgers" wording, and publish_expectation_ledger()'s own
// comment: this is a point-in-time published artifact, not a live dashboard.
//
// region_id has no FK on expectation_ledgers (matches the unenforced-
// region_id convention across every Epic R table so far), so the region
// name needs its own query — PostgREST embedding requires a real FK
// relationship, which doesn't exist here.
//
// Epic R M-R10 (US-R22): three separate accountability layers — the
// responsible institution(s) (live question_authority_map), the government
// offices respondents associated with each action (frozen role_summary, set
// at publish), and a current office-holder only where one was verified and
// current at publish time (BR-R11).

import * as React from "react";
import { localeFor } from "@/lib/intlFormat";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { ShareButton } from "@/components/share/ShareButton";
import { useLanguage } from "@/hooks/useLanguage";
import { EXPECTATION_LABEL_KEYS } from "@/components/question/ExpectationPrompt";
import { STATUS_LABEL_KEYS, STATUS_COLORS, formatResponseDate } from "@/components/question/AuthorityResponseStatusBlock";
import { Loader2, ClipboardCheck, Landmark } from "lucide-react";
import { useQuestionAuthorities } from "@/hooks/useQuestionAuthorities";
import { RoleAssociationList, type RoleAssociation } from "@/components/question/RoleAssociationList";

interface SnapshotEntry {
  expectation_type: string;
  response_count: number;
  pct_of_respondents: number;
  /** Epic R R-12: frozen at publish time; absent on snapshots published before the fix. */
  meets_threshold?: boolean;
  threshold_pct?: number;
}

interface LedgerData {
  snapshot_summary: SnapshotEntry[] | null;
  role_summary: RoleAssociation[] | null;
  participation_count: number | null;
  optin_count: number | null;
  time_window_start: string | null;
  time_window_end: string | null;
  questionText: string | null;
  questionSummary: string | null;
  regionName: string | null;
}

function useLedger(questionId: string, regionId: string) {
  return useQuery<LedgerData | null>({
    queryKey: ["public-ledger", questionId, regionId],
    enabled: !!questionId && !!regionId,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;

      // RLS (expectation_ledgers_public_read_published) already restricts
      // this to status='published' rows for an anonymous session — the
      // .eq("status", "published") below is defence in depth, not the only
      // gate. See the M-R04 migration comment for why that matters.
      const { data: ledger, error } = await sb
        .from("expectation_ledgers")
        .select(
          "snapshot_summary, role_summary, participation_count, optin_count, time_window_start, time_window_end, status, questions(question, summary)"
        )
        .eq("question_id", questionId)
        .eq("region_id", regionId)
        .eq("status", "published")
        .maybeSingle();

      if (error || !ledger) return null;

      const { data: region } = await sb.from("locations").select("name").eq("id", regionId).maybeSingle();

      const q = (ledger as any).questions;
      return {
        snapshot_summary: (ledger as any).snapshot_summary ?? null,
        role_summary: (ledger as any).role_summary ?? null,
        participation_count: (ledger as any).participation_count,
        optin_count: (ledger as any).optin_count ?? null,
        time_window_start: (ledger as any).time_window_start,
        time_window_end: (ledger as any).time_window_end,
        questionText: q?.question ?? null,
        questionSummary: q?.summary ?? null,
        regionName: region?.name ?? null,
      };
    },
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(localeFor(i18n.language), { dateStyle: "medium" });
}

// M-R08 / QA-R17: authority_responses is read LIVE here, not from the
// frozen snapshot — status changes should reflect on the ledger page
// immediately, without needing a re-publish. Scoped to this exact region
// (unlike AuthorityResponseStatusBlock on QuestionDetailPage, which shows
// every region a question has tracked responses for) since this page is
// inherently one-region-per-URL.
interface RegionResponseRow {
  id: string;
  response_status: string;
  status_updated_at: string;
  authority_registry: { name: string } | null;
}

function useRegionAuthorityResponses(questionId: string, regionId: string) {
  return useQuery<RegionResponseRow[]>({
    queryKey: ["ledger-authority-responses", questionId, regionId],
    enabled: !!questionId && !!regionId,
    staleTime: 15_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb
        .from("authority_responses")
        .select("id, response_status, status_updated_at, authority_registry(name)")
        .eq("question_id", questionId)
        .eq("region_id", regionId)
        .order("status_updated_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as unknown as RegionResponseRow[];
    },
  });
}

export default function PublicLedgerPage() {
  const { t } = useTranslation();
  const { questionId, regionId } = useParams<{ questionId: string; regionId: string }>();
  // No AppTopBar on this page (see file header — "no chrome" by design), so
  // there's no parent already resolving language. Called directly here,
  // with a null userId since this page has no concept of a logged-in user
  // at all — resolves from ?lang= on the URL or defaults to English, same
  // as any other anonymous visitor.
  const { languageCode } = useLanguage(null);
  const { data: ledger, isLoading } = useLedger(questionId ?? "", regionId ?? "");
  const { data: responses = [] } = useRegionAuthorityResponses(questionId ?? "", regionId ?? "");
  const { data: institutions = [] } = useQuestionAuthorities(questionId ?? "");

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  // QA-R09: unpublished/nonexistent ledgers show this, never draft content —
  // and per the RLS policy above, a draft row is literally unreachable here,
  // not just hidden by this check.
  if (!ledger) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-sm">
          <p className="text-sm font-medium text-slate-700 mb-1">{t("publicLedger.ledgerNotYetPublished")}</p>
          <p className="text-xs text-slate-500">
            {t("publicLedger.thisExpectationLedgerEitherDoesn")}
          </p>
        </div>
      </div>
    );
  }

  const breakdown = [...(ledger.snapshot_summary ?? [])].sort(
    (a, b) => b.pct_of_respondents - a.pct_of_respondents
  );
  // Epic R R-12 / BR-R09: no single winner. Every type that met the threshold
  // when the ledger was published is emphasised equally (the flag is frozen
  // into the snapshot by publish_expectation_ledger). Snapshots published
  // before the flag existed emphasise nothing rather than guessing.
  const thresholdPct = breakdown.find((r) => r.threshold_pct != null)?.threshold_pct ?? null;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="max-w-xl mx-auto">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8 shadow-sm">
          <p className="text-[11px] font-medium tracking-wide uppercase text-slate-400 mb-3">
            {t("publicLedger.publicExpectationLedger")}
          </p>

          {ledger.questionText && (
            <h1 className="text-lg font-semibold text-slate-900 mb-1">{ledger.questionText}</h1>
          )}
          {ledger.questionSummary && (
            <p className="text-sm text-slate-500 mb-4">{ledger.questionSummary}</p>
          )}

          {ledger.regionName && (
            <p className="text-xs text-slate-500 mb-5">
              {t("publicLedger.region")} <span className="font-medium text-slate-700">{ledger.regionName}</span>
            </p>
          )}

          <div className="space-y-2.5 mb-5">
            {breakdown.map((row) => {
              const qualifies = row.meets_threshold === true;
              const labelKey = EXPECTATION_LABEL_KEYS[row.expectation_type];
              const label = labelKey ? t(labelKey) : row.expectation_type;
              return (
                <div key={row.expectation_type}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={qualifies ? "font-semibold text-slate-800" : "text-slate-600"}>
                      {label}
                    </span>
                    <span className={qualifies ? "font-semibold text-slate-800" : "text-slate-400"}>
                      {row.pct_of_respondents}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={qualifies ? "h-full bg-slate-900" : "h-full bg-slate-300"}
                      style={{ width: `${Math.min(100, Math.max(0, row.pct_of_respondents))}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {/* BR-R09: rates are independent (multi-select), so they can sum past 100%. */}
            <p className="text-[11px] text-slate-400 pt-1">
              {thresholdPct != null
                ? t("expectationSignalBlock.multiSelectNoteWithThreshold", { pct: thresholdPct })
                : t("expectationSignalBlock.multiSelectNote")}
            </p>
          </div>

          {institutions.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Landmark className="h-3.5 w-3.5 text-slate-400" />
                <p className="text-xs font-medium text-slate-600">{t("publicLedger.responsibleInstitution")}</p>
              </div>
              <ul className="space-y-0.5">
                {institutions.map((a) => (
                  <li key={a.authority_id} className="text-xs text-slate-600">
                    {a.authority_registry?.name ?? t("publicLedger.authority")}
                    {a.confidence_level === "unclear" && (
                      <span className="text-slate-400"> {t("publicLedger.unconfirmed")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ledger.role_summary && ledger.role_summary.length > 0 && (
            <div className="mb-5 -mt-2">
              <RoleAssociationList entries={ledger.role_summary} title={t("publicLedger.relevantOffices")} />
            </div>
          )}

          {responses.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center gap-1.5 mb-2">
                <ClipboardCheck className="h-3.5 w-3.5 text-slate-400" />
                <p className="text-xs font-medium text-slate-600">{t("publicLedger.responseStatus")}</p>
              </div>
              <div className="space-y-1.5">
                {responses.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-600 truncate">
                      {r.authority_registry?.name ?? t("publicLedger.authority")}
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
          )}

          {/* Participation count + time window shown as data metadata, not
              social proof (BR-R04 / §6.3 — no "X people signed" language). */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 border-t border-slate-100 pt-4 mb-5">
            <span>{t("publicLedger.respondentCount", { count: ledger.participation_count ?? 0 })}</span>
            {/* Epic R R-06 / US-R10: the opted-in "visible support" count is a separate,
                smaller population than the respondents above, and is labelled as such.
                It is frozen at publish time like the rest of the snapshot. */}
            <span>{t("publicLedger.visibleSupportCount", { count: ledger.optin_count ?? 0 })}</span>
            <span>
              {formatDate(ledger.time_window_start)} – {formatDate(ledger.time_window_end)}
            </span>
          </div>

          {questionId && (
            <ShareButton
              questionId={questionId}
              questionText={ledger.questionText ?? "Expectation Ledger"}
              questionSummary={ledger.questionSummary}
              shareType="question"
              languageCode={languageCode}
              ledgerRegionId={regionId}
            />
          )}
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-4">{t("publicLedger.dataCollectedByStanceCapture")}</p>
      </div>
    </div>
  );
}
