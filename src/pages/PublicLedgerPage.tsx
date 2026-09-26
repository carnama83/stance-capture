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
//
// Epic R M-R11 (R-FR-22, R-FR-23, BR-R12, BR-R13): every publish is kept as an
// immutable version (expectation_ledger_versions). The page shows the current
// version and lists earlier ones; ?v=N shows version N exactly as published.
// Below the current response status, the response history comes from the
// append-only authority_response_events (get_authority_response_history —
// no internal notes, no voided events).
//
// Epic R R-FR-15 (expectation_outcomes): "What followed" links each expected
// action to the recorded actions an admin matched to it
// (get_expectation_outcomes). Structured only — type, institution, status,
// date, source — with no verdict on whether the action was enough (BR-R08).

import * as React from "react";
import { localeFor } from "@/lib/intlFormat";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { ShareButton } from "@/components/share/ShareButton";
import { useLanguage } from "@/hooks/useLanguage";
import { EXPECTATION_LABEL_KEYS } from "@/components/question/ExpectationPrompt";
import { STATUS_COLORS, formatResponseDate, responseStatusLabel } from "@/components/question/AuthorityResponseStatusBlock";
import { Loader2, ClipboardCheck, Landmark, History, ExternalLink, Target } from "lucide-react";
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
  current_version: number | null;
  published_at: string | null;
}

interface LedgerVersion {
  version: number;
  snapshot_at: string;
  snapshot_summary: SnapshotEntry[] | null;
  role_summary: RoleAssociation[] | null;
  participation_count: number | null;
  optin_count: number | null;
  collection_window_start: string | null;
  collection_window_end: string | null;
}

function useLedgerVersions(questionId: string, regionId: string, enabled: boolean) {
  return useQuery<LedgerVersion[]>({
    queryKey: ["public-ledger-versions", questionId, regionId],
    enabled: enabled && !!questionId && !!regionId,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb
        .from("expectation_ledger_versions")
        .select(
          "version, snapshot_at, snapshot_summary, role_summary, participation_count, optin_count, collection_window_start, collection_window_end"
        )
        .eq("question_id", questionId)
        .eq("region_id", regionId)
        .order("version", { ascending: false });
      if (error) return [];
      return (data ?? []) as LedgerVersion[];
    },
  });
}

interface ResponseHistoryRow {
  id: string;
  authority_name: string;
  government_role_name: string | null;
  response_status: string;
  effective_at: string;
  source_url: string | null;
}

function useResponseHistory(questionId: string, regionId: string) {
  return useQuery<ResponseHistoryRow[]>({
    queryKey: ["ledger-response-history", questionId, regionId],
    enabled: !!questionId && !!regionId,
    staleTime: 15_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb.rpc("get_authority_response_history", {
        p_question_id: questionId,
        p_region_id: regionId,
      });
      if (error) return [];
      return (data ?? []) as ResponseHistoryRow[];
    },
  });
}

interface OutcomeRow {
  id: string;
  expectation_type: string;
  ledger_version: number;
  ledger_snapshot_at: string;
  authority_name: string;
  government_role_name: string | null;
  response_status: string;
  effective_at: string;
  source_url: string | null;
}

function useExpectationOutcomes(questionId: string, regionId: string, enabled: boolean) {
  return useQuery<OutcomeRow[]>({
    queryKey: ["ledger-expectation-outcomes", questionId, regionId],
    enabled: enabled && !!questionId && !!regionId,
    staleTime: 15_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb.rpc("get_expectation_outcomes", {
        p_question_id: questionId,
        p_region_id: regionId,
      });
      if (error) return [];
      return (data ?? []) as OutcomeRow[];
    },
  });
}

// Types that are not an action have no outcome to record.
const NON_ACTION_TYPES = new Set(["no_action", "unsure", "no_accountability_expected"]);

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
          "snapshot_summary, role_summary, participation_count, optin_count, time_window_start, time_window_end, status, current_version, published_at, questions(question, summary)"
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
        current_version: (ledger as any).current_version ?? null,
        published_at: (ledger as any).published_at ?? null,
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
  const { data: versions = [] } = useLedgerVersions(questionId ?? "", regionId ?? "", !!ledger);
  const { data: history = [] } = useResponseHistory(questionId ?? "", regionId ?? "");
  const { data: outcomes = [] } = useExpectationOutcomes(questionId ?? "", regionId ?? "", !!ledger);
  const [searchParams] = useSearchParams();
  const requestedVersion = Number(searchParams.get("v")) || null;

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

  // M-R11: ?v=N shows that immutable version exactly as published.
  const viewing = requestedVersion ? versions.find((v) => v.version === requestedVersion) ?? null : null;
  const latestVersion = ledger.current_version ?? versions[0]?.version ?? null;
  const shown = viewing
    ? {
        snapshot_summary: viewing.snapshot_summary,
        role_summary: viewing.role_summary,
        participation_count: viewing.participation_count,
        optin_count: viewing.optin_count,
        time_window_start: viewing.collection_window_start,
        time_window_end: viewing.collection_window_end,
      }
    : ledger;
  const shownVersion = viewing?.version ?? latestVersion;
  const shownPublishedAt = viewing?.snapshot_at ?? ledger.published_at;
  const earlier = versions.filter((v) => v.version !== shownVersion);

  const breakdown = [...(shown.snapshot_summary ?? [])].sort(
    (a, b) => b.pct_of_respondents - a.pct_of_respondents
  );
  // Epic R R-12 / BR-R09: no single winner. Every type that met the threshold
  // when the ledger was published is emphasised equally (the flag is frozen
  // into the snapshot by publish_expectation_ledger). Snapshots published
  // before the flag existed emphasise nothing rather than guessing.
  const thresholdPct = breakdown.find((r) => r.threshold_pct != null)?.threshold_pct ?? null;

  // R-FR-15: outcomes grouped by expected action, oldest first (the progression).
  // They are shown whichever version is being viewed; one recorded against a
  // different version says so.
  const typeLabel = (type: string) => {
    const key = EXPECTATION_LABEL_KEYS[type];
    return key ? t(key) : type;
  };
  const outcomesByType = new Map<string, OutcomeRow[]>();
  for (const o of outcomes) {
    outcomesByType.set(o.expectation_type, [...(outcomesByType.get(o.expectation_type) ?? []), o]);
  }
  // Expected actions with nothing recorded yet: those that met the threshold, or
  // every action type on snapshots published before the threshold flag existed.
  const hasFlags = breakdown.some((r) => r.meets_threshold != null);
  const awaiting = breakdown
    .filter((r) => !NON_ACTION_TYPES.has(r.expectation_type) && !outcomesByType.has(r.expectation_type))
    .filter((r) => (hasFlags ? r.meets_threshold === true : true))
    .map((r) => typeLabel(r.expectation_type));
  const showOutcomes = outcomesByType.size > 0 || (awaiting.length > 0 && (responses.length > 0 || history.length > 0));
  const timing = (o: OutcomeRow) => {
    const days = Math.floor((Date.parse(o.effective_at) - Date.parse(o.ledger_snapshot_at)) / 86_400_000);
    if (days < 0) return t("publicLedger.outcomeBeforeVersion", { n: o.ledger_version });
    if (days === 0) return t("publicLedger.outcomeSameDay", { n: o.ledger_version });
    return t("publicLedger.outcomeDaysAfter", { count: days, n: o.ledger_version });
  };

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
            <p className="text-xs text-slate-500 mb-1">
              {t("publicLedger.region")} <span className="font-medium text-slate-700">{ledger.regionName}</span>
            </p>
          )}
          {shownVersion != null && (
            <p className="text-[11px] text-slate-400 mb-5">
              {t("publicLedger.versionPublished", { n: shownVersion, date: formatDate(shownPublishedAt) })}
            </p>
          )}
          {viewing && latestVersion != null && viewing.version !== latestVersion && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-5 text-[11px] text-amber-800">
              {t("publicLedger.viewingOlderVersion", { n: viewing.version, latest: latestVersion })}{" "}
              <Link to={`/ledger/${questionId}/${regionId}`} className="underline underline-offset-2">
                {t("publicLedger.viewCurrentVersion")}
              </Link>
            </div>
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

          {shown.role_summary && shown.role_summary.length > 0 && (
            <div className="mb-5 -mt-2">
              <RoleAssociationList entries={shown.role_summary} title={t("publicLedger.relevantOffices")} />
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
                        {responseStatusLabel(t, r.response_status, r.status_updated_at)}
                      </span>
                      {r.response_status !== "no_response" && (
                        <span className="text-[10px] text-slate-400">{formatResponseDate(r.status_updated_at)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center gap-1.5 mb-2">
                <History className="h-3.5 w-3.5 text-slate-400" />
                <p className="text-xs font-medium text-slate-600">{t("publicLedger.responseHistory")}</p>
              </div>
              <ol className="space-y-1 border-l border-slate-200 pl-3">
                {history.map((h) => (
                  <li key={h.id} className="text-[11px] text-slate-600">
                    <span className="text-slate-400">{formatResponseDate(h.effective_at)}</span>
                    {" · "}
                    {h.authority_name}
                    {h.government_role_name && <span className="text-slate-400"> ({h.government_role_name})</span>}
                    {" · "}
                    {/* The date already leads the line, so the plain label (no "as of" date). */}
                    <span className="font-medium">{responseStatusLabel(t, h.response_status)}</span>
                    {h.source_url && (
                      <a
                        href={h.source_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-0.5 text-slate-400 hover:text-slate-600 ml-1"
                      >
                        {t("publicLedger.source")} <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {showOutcomes && (
            <div className="mb-5">
              <div className="flex items-center gap-1.5 mb-1">
                <Target className="h-3.5 w-3.5 text-slate-400" />
                <p className="text-xs font-medium text-slate-600">{t("publicLedger.outcomesTitle")}</p>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">{t("publicLedger.outcomesIntro")}</p>
              <div className="space-y-2">
                {[...outcomesByType.entries()].map(([type, rows]) => (
                  <div key={type}>
                    <p className="text-xs font-medium text-slate-700 mb-0.5">{typeLabel(type)}</p>
                    <ol className="space-y-0.5 border-l border-slate-200 pl-3">
                      {rows.map((o) => (
                        <li key={o.id} className="text-[11px] text-slate-600">
                          <span className="text-slate-400">{formatResponseDate(o.effective_at)}</span>
                          {" · "}
                          {o.authority_name}
                          {o.government_role_name && <span className="text-slate-400"> ({o.government_role_name})</span>}
                          {" · "}
                          <span className="font-medium">{responseStatusLabel(t, o.response_status)}</span>
                          <span className="text-slate-400"> · {timing(o)}</span>
                          {o.source_url && (
                            <a
                              href={o.source_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-0.5 text-slate-400 hover:text-slate-600 ml-1"
                            >
                              {t("publicLedger.source")} <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
                {awaiting.length > 0 && (
                  <p className="text-[11px] text-slate-500">
                    {t("publicLedger.noOutcomeRecorded", {
                      date: formatDate(new Date().toISOString()),
                      types: awaiting.join(", "),
                    })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Participation count + time window shown as data metadata, not
              social proof (BR-R04 / §6.3 — no "X people signed" language). */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 border-t border-slate-100 pt-4 mb-5">
            <span>{t("publicLedger.respondentCount", { count: shown.participation_count ?? 0 })}</span>
            {/* Epic R R-06 / US-R10: the opted-in "visible support" count is a separate,
                smaller population than the respondents above, and is labelled as such.
                It is frozen at publish time like the rest of the snapshot. */}
            <span>{t("publicLedger.visibleSupportCount", { count: shown.optin_count ?? 0 })}</span>
            <span>
              {formatDate(shown.time_window_start)} – {formatDate(shown.time_window_end)}
            </span>
          </div>

          {earlier.length > 0 && (
            <div className="mb-5 -mt-2">
              <p className="text-[11px] font-medium text-slate-500 mb-1">{t("publicLedger.otherVersions")}</p>
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {earlier.map((v) => (
                  <li key={v.version}>
                    <Link
                      to={v.version === latestVersion ? `/ledger/${questionId}/${regionId}` : `/ledger/${questionId}/${regionId}?v=${v.version}`}
                      className="text-[11px] text-slate-500 hover:text-slate-800 underline underline-offset-2"
                    >
                      {t("publicLedger.versionShort", { n: v.version, date: formatDate(v.snapshot_at) })}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
