// src/routes/admin/expectation-ledgers/Index.tsx
// Epic R — M-R04: Admin publish workflow for Public Expectation Ledgers
//
// A separate page from /admin/authorities: authorities/pending-suggestions
// are all "who is responsible" concerns over the same two tables; ledger
// publishing is a distinct concern (aggregation → frozen public snapshot),
// closer in kind to how Epic EL splits elections/parties/candidates into
// separate admin routes rather than one large tabbed page.

import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RegionMultiSelect } from "@/components/admin/RegionMultiSelect";
import { EXPECTATION_LABEL_KEYS } from "@/components/question/ExpectationPrompt";
// Admin screens stay English regardless of the viewer's UI language. This
// reads the shared expectation vocabulary (keys, not text) purely so the
// panel keeps showing labels rather than raw keys — it is not localization.
import i18n from "@/lib/i18n";
import type { QuestionInsightReport, ReportInsightsResponse } from "@/types/questionReport";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ScrollText, Search, X, Loader2, ExternalLink, Archive, RefreshCw,
  FileText, Check, Send, Sparkles,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────

interface QuestionRow {
  id: string;
  question: string;
}

interface SummaryRow {
  expectation_type: string;
  response_count: number;
  pct_of_respondents: number;
  total_respondents: number;
  first_response_at: string;
  last_response_at: string;
}

interface PreviewData {
  signal_crossed: boolean;
  total_respondents: number;
  signal_strength_score: number | null;
  qualifying_expectation_types: string[];
  thresholds: { threshold_pct: number; min_respondents: number; persistence_hours: number };
  rows: SummaryRow[];
}

interface LedgerRow {
  question_id: string;
  region_id: string;
  status: "draft" | "published" | "archived";
  participation_count: number | null;
  published_at: string | null;
  questions: { question: string } | null;
}

interface AuthorityOption {
  authority_id: string;
  authority_registry: { name: string } | null;
}

interface BriefRow {
  id: string;
  question_id: string;
  region_id: string;
  authority_id: string;
  brief_text: string | null;
  status: "draft" | "approved" | "delivered";
  generated_at: string | null;
  // Epic Report R7: the Insight Report snapshot frozen when the brief was generated.
  report_print_id: string | null;
  questions: { question: string } | null;
  authority_registry: { name: string } | null;
}

// ── Hooks ────────────────────────────────────────────────────────────────

function useQuestionSearch(search: string) {
  return useQuery<QuestionRow[]>({
    queryKey: ["admin-ledgers-question-search", search],
    enabled: search.trim().length >= 2,
    staleTime: 15_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("questions")
        .select("id, question")
        .ilike("question", `%${search.trim()}%`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as QuestionRow[];
    },
  });
}

// Epic R R-01: the aggregate views are closed to browser roles, so the
// preview goes through an admin-only RPC. It also reports whether the signal
// has crossed threshold, which publish_expectation_ledger now requires (R-03).
function usePreview(questionId: string | null, regionId: string | null) {
  return useQuery<PreviewData>({
    queryKey: ["admin-ledgers-preview", questionId, regionId],
    enabled: !!questionId && !!regionId,
    staleTime: 10_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("admin_get_expectation_preview", {
        p_question_id: questionId as string,
        p_region_id: regionId as string,
      });
      if (error) throw error;
      return data as unknown as PreviewData;
    },
  });
}

function usePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { questionId: string; regionId: string }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("publish_expectation_ledger", {
        p_question_id: vars.questionId,
        p_region_id: vars.regionId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-ledgers-all"] }),
  });
}

function useAllLedgers() {
  return useQuery<LedgerRow[]>({
    queryKey: ["admin-ledgers-all"],
    staleTime: 15_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("expectation_ledgers")
        .select("question_id, region_id, status, participation_count, published_at, questions(question)")
        .order("published_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as LedgerRow[];
    },
  });
}

function useArchiveLedger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { questionId: string; regionId: string }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb
        .from("expectation_ledgers")
        .update({ status: "archived" })
        .eq("question_id", vars.questionId)
        .eq("region_id", vars.regionId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-ledgers-all"] }),
  });
}

// ── Brief (M-R06) hooks ─────────────────────────────────────────────────

function useQuestionAuthorityOptions(questionId: string | null) {
  return useQuery<AuthorityOption[]>({
    queryKey: ["admin-ledgers-question-authorities", questionId],
    enabled: !!questionId,
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("question_authority_map")
        .select("authority_id, authority_registry(name)")
        .eq("question_id", questionId as string);
      if (error) throw error;
      return (data ?? []) as unknown as AuthorityOption[];
    },
  });
}

// Calls the edge function, not a table write — generation requires an
// external OpenAI call, which a SQL function can't do synchronously (unlike
// publish_expectation_ledger / update_authority_response_status, both pure
// SQL). Auth: the admin's own JWT, verified server-side via is_admin_me().
function useGenerateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { questionId: string; regionId: string; authorityId: string }) => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-authority-brief`, {
        method: "POST",
        headers: supabaseHeaders(getJwt()),
        body: JSON.stringify({
          question_id: vars.questionId,
          region_id: vars.regionId,
          authority_id: vars.authorityId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-briefs-all"] }),
  });
}

function useAllBriefs() {
  return useQuery<BriefRow[]>({
    queryKey: ["admin-briefs-all"],
    staleTime: 15_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("authority_briefs")
        .select("id, question_id, region_id, authority_id, brief_text, status, generated_at, report_print_id, questions(question), authority_registry(name)")
        .order("generated_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as BriefRow[];
    },
  });
}

// Approving is a plain table write (a status change, no fan-out). Delivery is
// not: since M-R06 "delivered" is derived from recorded deliveries (below), and
// the database refuses a bare status change to 'delivered'.
function useApproveBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data: userData } = await sb.auth.getUser();
      const { error } = await sb
        .from("authority_briefs")
        .update({ status: "approved", approved_by: userData?.user?.id ?? null, approved_at: new Date().toISOString() })
        .eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-briefs-all"] }),
  });
}

// Epic R M-R06 (decided 26 Sep 2026): the platform never contacts an
// institution. An admin sends the approved brief (its printable /brief/:id page)
// through the institution's official channel and records each delivery here.
// Deliveries are append-only; a mistaken one is voided with a reason.
interface DeliveryRow {
  id: string;
  brief_id: string;
  channel: string;
  recipient: string;
  delivered_at: string;
  reference: string | null;
  evidence_url: string | null;
  notes: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

const DELIVERY_CHANNELS = [
  { value: "email", label: "Email" },
  { value: "official_portal", label: "Official portal" },
  { value: "letter", label: "Letter" },
  { value: "in_person", label: "In person" },
  { value: "rti", label: "RTI application" },
  { value: "other", label: "Other official channel" },
];

function useBriefDeliveries() {
  return useQuery<DeliveryRow[]>({
    queryKey: ["admin-brief-deliveries"],
    staleTime: 10_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("authority_brief_deliveries")
        .select("id, brief_id, channel, recipient, delivered_at, reference, evidence_url, notes, voided_at, void_reason")
        .order("delivered_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DeliveryRow[];
    },
  });
}

function useRecordDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      briefId: string;
      channel: string;
      recipient: string;
      date: string;
      reference: string;
      evidenceUrl: string;
      notes: string;
    }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      // A date-only value is recorded at the end of that day in UTC, capped at now.
      const when = vars.date
        ? new Date(Math.min(Date.parse(`${vars.date}T23:59:59Z`), Date.now())).toISOString()
        : null;
      const { error } = await sb.rpc("admin_record_brief_delivery", {
        p_brief_id: vars.briefId,
        p_channel: vars.channel,
        p_recipient: vars.recipient,
        p_delivered_at: when,
        p_reference: vars.reference || null,
        p_evidence_url: vars.evidenceUrl || null,
        p_notes: vars.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-briefs-all"] });
      qc.invalidateQueries({ queryKey: ["admin-brief-deliveries"] });
    },
  });
}

function useVoidDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { deliveryId: string; reason: string }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.rpc("admin_void_brief_delivery", {
        p_delivery_id: vars.deliveryId,
        p_reason: vars.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-briefs-all"] });
      qc.invalidateQueries({ queryKey: ["admin-brief-deliveries"] });
    },
  });
}

// ── Publish panel ────────────────────────────────────────────────────────

function PublishPanel() {
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [selectedQuestion, setSelectedQuestion] = React.useState<QuestionRow | null>(null);
  const [regionIds, setRegionIds] = React.useState<string[]>([]);
  const regionId = regionIds[0] ?? null;

  const { data: results = [], isFetching: searching } = useQuestionSearch(search);
  const { data: previewData, isLoading: previewLoading } = usePreview(
    selectedQuestion?.id ?? null,
    regionId
  );
  const preview = previewData?.rows ?? [];
  const canPublish = !!previewData?.signal_crossed;
  const publish = usePublish();

  async function handlePublish() {
    if (!selectedQuestion || !regionId) return;
    try {
      await publish.mutateAsync({ questionId: selectedQuestion.id, regionId });
      toast({ title: "Ledger published", description: "Snapshot captured and made publicly visible." });
    } catch (err: any) {
      toast({ title: "Publish failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800 mb-3">Publish a Ledger</h2>

      <div className="relative mb-3">
        <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelectedQuestion(null);
          }}
          placeholder="Search questions by title…"
          className="pl-8 h-9 text-xs"
        />
      </div>

      {!selectedQuestion && (
        <div className="max-h-56 overflow-y-auto space-y-1 mb-2">
          {searching && <p className="text-xs text-slate-400 px-1">Searching…</p>}
          {!searching && search.trim().length >= 2 && results.length === 0 && (
            <p className="text-xs text-slate-400 px-1">No matching questions.</p>
          )}
          {results.map((q) => (
            <button
              key={q.id}
              onClick={() => setSelectedQuestion(q)}
              className="w-full text-left text-xs text-slate-700 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50 truncate"
            >
              {q.question}
            </button>
          ))}
        </div>
      )}

      {selectedQuestion && (
        <div>
          <div className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 mb-3">
            <p className="text-xs text-slate-700">{selectedQuestion.question}</p>
            <button
              onClick={() => {
                setSelectedQuestion(null);
                setRegionIds([]);
              }}
              className="text-slate-400 hover:text-slate-600 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <ReportContext questionId={selectedQuestion.id} />

          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">
            Region
          </p>
          <RegionMultiSelect
            value={regionIds}
            onChange={(ids) => setRegionIds(ids.slice(-1))}
            placeholder="Select a region to publish for"
          />
          <p className="text-[10px] text-slate-400 mt-1 mb-3">
            Ledgers require a named region — the no-location bucket can't be published (see M-R04 notes).
          </p>

          {regionId && (
            <>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">
                Live preview
              </p>
              {previewLoading ? (
                <p className="text-xs text-slate-400 mb-3">Loading…</p>
              ) : preview.length === 0 ? (
                <p className="text-xs text-slate-400 mb-3">
                  No expectation data yet for this question in this region — nothing to publish.
                </p>
              ) : (
                <div className="space-y-1.5 mb-3">
                  {preview.map((row) => (
                    <div key={row.expectation_type} className={`flex items-center justify-between text-xs ${previewData?.qualifying_expectation_types?.includes(row.expectation_type) ? "font-semibold" : ""}`}>
                      <span className="text-slate-600">
                        {EXPECTATION_LABEL_KEYS[row.expectation_type]
                          ? i18n.t(EXPECTATION_LABEL_KEYS[row.expectation_type], { lng: "en" })
                          : row.expectation_type}
                      </span>
                      <span className="text-slate-400">{row.pct_of_respondents}%</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-400 pt-1">
                    {previewData?.total_respondents ?? 0} total respondents
                  </p>
                </div>
              )}

              {preview.length > 0 && !canPublish && previewData && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mb-3">
                  Below the signal threshold — this ledger can't be published yet. It needs a single
                  expectation at {previewData.thresholds.threshold_pct}%+ from at least{" "}
                  {previewData.thresholds.min_respondents} respondents, collected over at least{" "}
                  {previewData.thresholds.persistence_hours}h.
                </p>
              )}

              <Button
                size="sm"
                className="w-full gap-1.5"
                disabled={!canPublish || publish.isPending}
                onClick={handlePublish}
              >
                {publish.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScrollText className="h-3.5 w-3.5" />}
                Publish Ledger
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Epic Report R7: Insight Report context for the publish decision ────────
//
// The ledger publishes only which expectations respondents selected. Before
// publishing, the admin sees the question's Insight Report alongside it — how
// respondents answered, the reasons they gave, and what they appear to want
// (the report's AI summary, desired outcomes) — as input to the decision.
// Read-only: nothing here is written to the ledger.

function ReportContext({ questionId }: { questionId: string }) {
  const { data: report, isLoading } = useQuery({
    queryKey: ["admin-ledgers-report-context", questionId],
    staleTime: 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_question_insight_report", {
        p_question_id: questionId,
        p_language: "en",
      });
      if (error) throw error;
      return data as QuestionInsightReport;
    },
  });
  const total = report?.responseSummary.total ?? 0;
  const { data: insights } = useQuery({
    queryKey: ["admin-ledgers-report-insights", questionId],
    enabled: total >= 5,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data } = await sb.functions.invoke("question-report-insights", {
        body: { question_id: questionId, language_code: "en" },
      });
      return (data ?? null) as ReportInsightsResponse | null;
    },
  });

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2.5 mb-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-medium text-indigo-900 uppercase tracking-wide">Insight Report context</p>
        <Link to={`/q/${questionId}/report`} target="_blank" className="text-[11px] text-indigo-700 hover:underline">
          Open report ↗
        </Link>
      </div>
      {isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : !report || total === 0 ? (
        <p className="text-xs text-slate-500">No responses yet, so there is no report to draw on.</p>
      ) : (
        <div className="space-y-2 text-xs text-slate-700">
          <p>
            {report.responseSummary.lean.high} of {total} respondents lean toward “{report.question.highLabel ?? "+2"}”,{" "}
            {report.responseSummary.lean.low} toward “{report.question.lowLabel ?? "−2"}”, {report.responseSummary.lean.neutral}{" "}
            neutral · average {report.responseSummary.mean ?? "—"} on −2..+2
            {report.responseSummary.strength === "early" ? " · early signal (fewer than 30 responses)" : ""}.
          </p>
          {report.reasons && report.reasons.totalWithReasons > 0 && (
            <div>
              <p className="text-[11px] text-slate-500">
                Reasons given ({report.reasons.totalWithReasons} respondents):
              </p>
              <ul className="list-disc pl-4">
                {report.reasons.sides
                  .filter((sd) => sd.respondents > 0)
                  .flatMap((sd) =>
                    [...sd.options]
                      .filter((o) => o.count > 0)
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 2)
                      .map((o) => (
                        <li key={o.key}>
                          {o.label} — {o.count} of {sd.respondents}
                        </li>
                      )),
                  )}
              </ul>
            </div>
          )}
          {insights?.status === "ok" && insights.insights ? (
            <div>
              <p className="text-[11px] text-slate-500">What respondents appear to want (AI summary):</p>
              <p>{insights.insights.whatPeopleAppearToWant}</p>
              {insights.insights.desiredOutcomes.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {insights.insights.desiredOutcomes.map((o) => (
                    <span key={o} className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[10px] text-indigo-800">
                      {o}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : total < 5 ? (
            <p className="text-[11px] text-slate-400">The AI summary appears from 5 responses.</p>
          ) : null}
          <p className="text-[10px] text-slate-400">
            Context only — the ledger publishes the expectation data below. Use this to judge whether it reflects how
            respondents answered.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Ledger list panel ────────────────────────────────────────────────────

// Per-ledger brief generation control, expandable — mirrors
// ResponseStatusTracker's pattern in authorities-Index.tsx (badge summary +
// expand-to-act). A ledger doesn't carry a specific authority_id (a question
// can have several mapped), so generating requires picking one first.
function GenerateBriefControl({ questionId, regionId }: { questionId: string; regionId: string }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = React.useState(false);
  const [authorityId, setAuthorityId] = React.useState("");
  const { data: authorities = [] } = useQuestionAuthorityOptions(expanded ? questionId : null);
  const generate = useGenerateBrief();

  async function handleGenerate() {
    if (!authorityId) return;
    try {
      await generate.mutateAsync({ questionId, regionId, authorityId });
      toast({ title: "Brief generated", description: "Review it in the Briefs panel below before approving." });
      setExpanded(false);
      setAuthorityId("");
    } catch (err: any) {
      toast({ title: "Generation failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="w-full mt-2 pt-2 border-t border-slate-100">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2 flex items-center gap-1"
      >
        <Sparkles className="h-3 w-3" />
        {expanded ? "Cancel" : "Generate authority brief"}
      </button>

      {expanded && (
        <div className="mt-2 flex gap-2">
          <Select value={authorityId} onValueChange={setAuthorityId}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder={authorities.length === 0 ? "No authorities mapped to this question" : "Select authority"} />
            </SelectTrigger>
            <SelectContent>
              {authorities.map((a) => (
                <SelectItem key={a.authority_id} value={a.authority_id} className="text-xs">
                  {a.authority_registry?.name ?? a.authority_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!authorityId || generate.isPending}
            onClick={handleGenerate}
          >
            {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate
          </Button>
        </div>
      )}
    </div>
  );
}

function LedgerListPanel() {
  const { data: ledgers = [], isLoading } = useAllLedgers();
  const archive = useArchiveLedger();
  const publish = usePublish();
  const { toast } = useToast();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800 mb-3">All Ledgers</h2>

      {isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : ledgers.length === 0 ? (
        <p className="text-xs text-slate-400">No ledgers published yet.</p>
      ) : (
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
          {ledgers.map((l) => (
            <div
              key={`${l.question_id}-${l.region_id}`}
              className="rounded-lg border border-slate-100 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-800 truncate">
                    {l.questions?.question ?? l.question_id}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge
                      variant={l.status === "published" ? "default" : "secondary"}
                      className="text-[10px] capitalize"
                    >
                      {l.status}
                    </Badge>
                    {l.participation_count != null && (
                      <span className="text-[10px] text-slate-400">{l.participation_count} respondents</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {l.status === "published" && (
                    <Link
                      to={`/ledger/${l.question_id}/${l.region_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-slate-700 p-1"
                      title="View public page"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                  {l.status === "published" ? (
                    <button
                      onClick={async () => {
                        try {
                          await archive.mutateAsync({ questionId: l.question_id, regionId: l.region_id });
                          toast({ title: "Ledger archived" });
                        } catch (err: any) {
                          toast({ title: "Archive failed", description: err?.message, variant: "destructive" });
                        }
                      }}
                      className="text-slate-400 hover:text-amber-600 p-1"
                      title="Archive"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        try {
                          await publish.mutateAsync({ questionId: l.question_id, regionId: l.region_id });
                          toast({ title: "Ledger re-published", description: "Snapshot refreshed." });
                        } catch (err: any) {
                          toast({ title: "Re-publish failed", description: err?.message, variant: "destructive" });
                        }
                      }}
                      className="text-slate-400 hover:text-slate-700 p-1"
                      title="Publish / refresh snapshot"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {l.status === "published" && (
                <GenerateBriefControl questionId={l.question_id} regionId={l.region_id} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Briefs review panel (M-R06) ─────────────────────────────────────────

function BriefCard({ brief, deliveries }: { brief: BriefRow; deliveries: DeliveryRow[] }) {
  const { toast } = useToast();
  const approve = useApproveBrief();
  const record = useRecordDelivery();
  const voidDelivery = useVoidDelivery();
  const [recording, setRecording] = React.useState(false);
  const [channel, setChannel] = React.useState("email");
  const [recipient, setRecipient] = React.useState("");
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = React.useState("");
  const [evidenceUrl, setEvidenceUrl] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [voidingId, setVoidingId] = React.useState<string | null>(null);
  const [voidReason, setVoidReason] = React.useState("");
  const mine = deliveries.filter((d) => d.brief_id === brief.id);
  const deliverable = brief.status === "approved" || brief.status === "delivered";

  async function handleRecord() {
    if (!recipient.trim()) {
      toast({ title: "Say who it was delivered to", variant: "destructive" });
      return;
    }
    if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl.trim())) {
      toast({ title: "Evidence must be an http(s) URL", variant: "destructive" });
      return;
    }
    try {
      await record.mutateAsync({
        briefId: brief.id, channel, recipient: recipient.trim(), date,
        reference: reference.trim(), evidenceUrl: evidenceUrl.trim(), notes: notes.trim(),
      });
      toast({ title: "Delivery recorded", description: "The public ledger now says the brief was delivered." });
      setRecording(false);
      setRecipient(""); setReference(""); setEvidenceUrl(""); setNotes("");
    } catch (err: any) {
      toast({ title: "Record failed", description: err?.message, variant: "destructive" });
    }
  }

  async function handleVoid(deliveryId: string) {
    if (!voidReason.trim()) {
      toast({ title: "Give a reason for voiding", variant: "destructive" });
      return;
    }
    try {
      await voidDelivery.mutateAsync({ deliveryId, reason: voidReason.trim() });
      toast({ title: "Delivery voided" });
      setVoidingId(null);
      setVoidReason("");
    } catch (err: any) {
      toast({ title: "Void failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="rounded-lg border border-slate-100 p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-800 truncate">
            {brief.questions?.question ?? brief.question_id}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            To: {brief.authority_registry?.name ?? "Authority"}
          </p>
        </div>
        <Badge
          variant={brief.status === "delivered" ? "default" : "secondary"}
          className="text-[10px] capitalize shrink-0"
        >
          {brief.status}
        </Badge>
      </div>

      <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2.5 mb-2 leading-relaxed">
        {brief.brief_text}
      </p>
      {brief.report_print_id ? (
        <Link
          to={`/q/${brief.question_id}/report?print=${brief.report_print_id}`}
          target="_blank"
          className="mb-2 inline-block text-[11px] text-indigo-700 hover:underline"
        >
          Insight Report snapshot cited by this brief ↗
        </Link>
      ) : (
        <p className="mb-2 text-[10px] text-slate-400">No Insight Report snapshot cited (brief generated before R7).</p>
      )}

      {mine.length > 0 && (
        <ul className="mb-2 space-y-1 border-l border-slate-200 pl-2.5">
          {mine.map((d) => (
            <li key={d.id} className={`text-[10px] ${d.voided_at ? "text-slate-300" : "text-slate-600"}`}>
              {new Date(d.delivered_at).toLocaleDateString()} · {DELIVERY_CHANNELS.find((c) => c.value === d.channel)?.label ?? d.channel} · {d.recipient}
              {d.reference && <span className="text-slate-400"> · ref {d.reference}</span>}
              {d.evidence_url && (
                <a href={d.evidence_url} target="_blank" rel="noreferrer" className="ml-1 text-slate-400 hover:text-slate-700">evidence</a>
              )}
              {d.notes && <span className="text-slate-400"> · {d.notes}</span>}
              {d.voided_at ? (
                <span className="text-slate-400"> (voided: {d.void_reason})</span>
              ) : voidingId === d.id ? (
                <span className="inline-flex items-center gap-1 ml-1">
                  <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason" className="h-6 w-40 text-[10px]" />
                  <button onClick={() => handleVoid(d.id)} className="text-red-600" disabled={voidDelivery.isPending}>Void</button>
                  <button onClick={() => { setVoidingId(null); setVoidReason(""); }} className="text-slate-400">Cancel</button>
                </span>
              ) : (
                <button onClick={() => setVoidingId(d.id)} className="ml-1 text-slate-400 hover:text-red-600">void</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {brief.status === "draft" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-7"
            disabled={approve.isPending}
            onClick={async () => {
              try {
                await approve.mutateAsync({ id: brief.id });
                toast({ title: "Brief approved", description: "Its text is now frozen. Open the printable page to send it." });
              } catch (err: any) {
                toast({ title: "Approve failed", description: err?.message, variant: "destructive" });
              }
            }}
          >
            <Check className="h-3 w-3" /> Approve
          </Button>
        )}
        {deliverable && (
          <>
            <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs h-7">
              <Link to={`/brief/${brief.id}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3 w-3" /> Printable page
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7"
              onClick={() => setRecording((v) => !v)}
            >
              <Send className="h-3 w-3" /> {recording ? "Cancel" : "Record a delivery"}
            </Button>
          </>
        )}
      </div>

      {recording && (
        <div className="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100 space-y-2">
          <p className="text-[10px] text-slate-500">
            Stance Capture never sends briefs itself. Send the printable page through the institution's official
            channel, then record it here. Recipient, reference, evidence and notes stay internal; the public ledger
            shows only the institution, date and channel.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DELIVERY_CHANNELS.map((c) => (
                  <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 text-xs"
              title="When it was delivered"
            />
          </div>
          <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Delivered to (office, address or portal)" className="h-8 text-xs" />
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference / acknowledgement no. (optional)" className="h-8 text-xs" />
          <Input value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="Evidence URL (optional)" className="h-8 text-xs" />
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="h-8 text-xs" />
          <Button size="sm" className="w-full" disabled={record.isPending} onClick={handleRecord}>
            {record.isPending ? "Saving…" : "Record delivery"}
          </Button>
        </div>
      )}
    </div>
  );
}

function BriefsPanel() {
  const { data: briefs = [], isLoading } = useAllBriefs();
  const { data: deliveries = [] } = useBriefDeliveries();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-4 w-4 text-slate-600" />
        <h2 className="text-sm font-semibold text-slate-800">Authority Briefs (Phase 2)</h2>
      </div>
      <p className="text-[11px] text-slate-400 mb-3">
        AI-generated. A draft is never shown publicly; an approved brief gets a link-only printable page to send
        through the institution's official channel. Record each delivery (BR-R04; M-R06).
      </p>

      {isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : briefs.length === 0 ? (
        <p className="text-xs text-slate-400">
          No briefs generated yet — use "Generate authority brief" on a published ledger above.
        </p>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {briefs.map((b) => (
            <BriefCard key={b.id} brief={b} deliveries={deliveries} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function AdminExpectationLedgersPage() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <ScrollText className="h-5 w-5 text-slate-700" />
        <h1 className="text-lg font-semibold text-slate-900">Expectation Ledgers</h1>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Epic R — publishes a frozen, public snapshot of a question's expectation distribution
        for a named region. Published ledgers are visible without login at /ledger/:questionId/:regionId
        (BR-R04 — neutral, data-driven copy only).
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <PublishPanel />
        <LedgerListPanel />
      </div>

      <BriefsPanel />
    </div>
  );
}
