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
import { EXPECTATION_LABELS } from "@/components/question/ExpectationPrompt";
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

function usePreview(questionId: string | null, regionId: string | null) {
  return useQuery<SummaryRow[]>({
    queryKey: ["admin-ledgers-preview", questionId, regionId],
    enabled: !!questionId && !!regionId,
    staleTime: 10_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb
        .from("question_expectation_summary")
        .select("*")
        .eq("question_id", questionId as string)
        .eq("region_id", regionId as string)
        .order("pct_of_respondents", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
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
        .select("id, question_id, region_id, authority_id, brief_text, status, generated_at, questions(question), authority_registry(name)")
        .order("generated_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as BriefRow[];
    },
  });
}

// Plain table write — approving/marking delivered is just a status change,
// no external call or fan-out involved (unlike generation itself).
function useUpdateBriefStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; status: "approved" | "delivered" }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data: userData } = await sb.auth.getUser();
      const updates: Record<string, unknown> = { status: vars.status };
      if (vars.status === "approved") {
        updates.approved_by = userData?.user?.id ?? null;
        updates.approved_at = new Date().toISOString();
      }
      const { error } = await sb.from("authority_briefs").update(updates).eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-briefs-all"] }),
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
  const { data: preview = [], isLoading: previewLoading } = usePreview(
    selectedQuestion?.id ?? null,
    regionId
  );
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
                    <div key={row.expectation_type} className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">
                        {EXPECTATION_LABELS[row.expectation_type] ?? row.expectation_type}
                      </span>
                      <span className="text-slate-400">{row.pct_of_respondents}%</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-400 pt-1">
                    {preview[0]?.total_respondents ?? 0} total respondents
                  </p>
                </div>
              )}

              <Button
                size="sm"
                className="w-full gap-1.5"
                disabled={preview.length === 0 || publish.isPending}
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

function BriefCard({ brief }: { brief: BriefRow }) {
  const { toast } = useToast();
  const updateStatus = useUpdateBriefStatus();

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

      <div className="flex gap-2">
        {brief.status === "draft" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-7"
            disabled={updateStatus.isPending}
            onClick={async () => {
              try {
                await updateStatus.mutateAsync({ id: brief.id, status: "approved" });
                toast({ title: "Brief approved" });
              } catch (err: any) {
                toast({ title: "Approve failed", description: err?.message, variant: "destructive" });
              }
            }}
          >
            <Check className="h-3 w-3" /> Approve
          </Button>
        )}
        {brief.status === "approved" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-7"
            disabled={updateStatus.isPending}
            onClick={async () => {
              try {
                await updateStatus.mutateAsync({ id: brief.id, status: "delivered" });
                toast({ title: "Marked delivered" });
              } catch (err: any) {
                toast({ title: "Update failed", description: err?.message, variant: "destructive" });
              }
            }}
          >
            <Send className="h-3 w-3" /> Mark delivered
          </Button>
        )}
      </div>
    </div>
  );
}

function BriefsPanel() {
  const { data: briefs = [], isLoading } = useAllBriefs();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-4 w-4 text-slate-600" />
        <h2 className="text-sm font-semibold text-slate-800">Authority Briefs (Phase 2)</h2>
      </div>
      <p className="text-[11px] text-slate-400 mb-3">
        AI-generated, never shown publicly — admin approval required before "delivered" (BR-R04).
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
            <BriefCard key={b.id} brief={b} />
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
