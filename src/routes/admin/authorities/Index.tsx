// src/routes/admin/authorities/Index.tsx
// Epic R — M-R02: Admin Authority Management (/admin/authorities)
// Epic R — M-R07: Pending Suggestions tab (QA-R19)
// Epic R — M-R09: Government Roles tab (GovernmentRolesPanel)
// Epic R — M-R10: government-role suggestions per question (RoleSuggestionsSection)
// Epic R — M-R11: response statuses are recorded as append-only events
// Epic R — M-R12: Audit log tab (AuditLogPanel)
//
// Two-panel layout per Epic R doc §6.4:
//   Left  — authority_registry CRUD
//   Right — question search + question_authority_map assignment
// Plus a separate "Pending Suggestions" tab (M-R07) reviewing
// pending_authority_suggestions rows logged by entity extraction — nothing
// there is ever auto-mapped without this explicit admin confirm (BR-R07).
//
// Mirrors the mutation/query conventions from parties/Index.tsx and
// publishers/Index.tsx (both admin-only tables with public read).

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RegionMultiSelect } from "@/components/admin/RegionMultiSelect";
import { GovernmentRolesPanel } from "@/components/admin/GovernmentRolesPanel";
import { RoleSuggestionsSection } from "@/components/admin/RoleSuggestionsSection";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { Landmark, Plus, Trash2, Pencil, Search, X, Loader2, Check, ExternalLink, Inbox } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────

type JurisdictionLevel = "local" | "state" | "national" | "international";
type Domain = "water" | "health" | "policing" | "transport" | "environment" | "education" | "other";
type ConfidenceLevel = "confirmed" | "likely" | "unclear";

interface Authority {
  id: string;
  name: string;
  jurisdiction_level: JurisdictionLevel;
  region_id: string | null;
  domain: Domain;
  contact_url: string | null;
  created_at: string;
}

interface QuestionRow {
  id: string;
  question: string;
  content_type?: string | null;
}

interface Assignment {
  question_id: string;
  authority_id: string;
  confidence_level: ConfidenceLevel;
  authority_registry: { name: string; domain: Domain } | null;
}

interface PendingSuggestion {
  id: string;
  question_id: string;
  candidate_name: string;
  candidate_type: "institution" | "named_official";
  source_article_id: string | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
  questions: { question: string } | null;
  news_items: { title: string; url: string } | null;
}

const JURISDICTION_LEVELS: JurisdictionLevel[] = ["local", "state", "national", "international"];
const DOMAINS: Domain[] = ["water", "health", "policing", "transport", "environment", "education", "other"];
const CONFIDENCE_LEVELS: ConfidenceLevel[] = ["confirmed", "likely", "unclear"];

// ── Left panel: authority_registry hooks ────────────────────────────────

function useAuthorities() {
  return useQuery<Authority[]>({
    queryKey: ["admin-authorities"],
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("authority_registry")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Authority[];
    },
  });
}

function useUpsertAuthority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Partial<Authority> & { name: string; jurisdiction_level: JurisdictionLevel; domain: Domain }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { id, ...rest } = row;
      const { error } = id
        ? await sb.from("authority_registry").update(rest).eq("id", id)
        : await sb.from("authority_registry").insert(rest);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-authorities"] }),
  });
}

function useDeleteAuthority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.from("authority_registry").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-authorities"] }),
  });
}

// ── Right panel: question search + question_authority_map hooks ────────

function useQuestionSearch(search: string) {
  return useQuery<QuestionRow[]>({
    queryKey: ["admin-authorities-question-search", search],
    enabled: search.trim().length >= 2,
    staleTime: 15_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("questions")
        .select("id, question, content_type")
        .ilike("question", `%${search.trim()}%`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as QuestionRow[];
    },
  });
}

function useQuestionAssignments(questionId: string | null) {
  return useQuery<Assignment[]>({
    queryKey: ["admin-authorities-assignments", questionId],
    enabled: !!questionId,
    staleTime: 10_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("question_authority_map")
        .select("question_id, authority_id, confidence_level, authority_registry(name, domain)")
        .eq("question_id", questionId as string);
      if (error) throw error;
      return (data ?? []) as unknown as Assignment[];
    },
  });
}

function useAssignAuthority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { question_id: string; authority_id: string; confidence_level: ConfidenceLevel }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data: userData } = await sb.auth.getUser();
      const { error } = await sb.from("question_authority_map").upsert(
        { ...vars, assigned_by: userData?.user?.id ?? null, assigned_at: new Date().toISOString() },
        { onConflict: "question_id,authority_id" }
      );
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["admin-authorities-assignments", vars.question_id] }),
  });
}

function useUnassignAuthority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { question_id: string; authority_id: string }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb
        .from("question_authority_map")
        .delete()
        .eq("question_id", vars.question_id)
        .eq("authority_id", vars.authority_id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["admin-authorities-assignments", vars.question_id] }),
  });
}

// ── Response status (M-R08) hooks ──────────────────────────────────────────

interface ResponseStatusRow {
  id: string;
  authority_id: string;
  region_id: string;
  response_status: string;
  status_updated_at: string;
}

function useResponseStatuses(questionId: string | null) {
  return useQuery<ResponseStatusRow[]>({
    queryKey: ["admin-authorities-response-statuses", questionId],
    enabled: !!questionId,
    staleTime: 10_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("authority_responses")
        .select("id, authority_id, region_id, response_status, status_updated_at")
        .eq("question_id", questionId as string)
        .not("region_id", "is", null)
        .order("status_updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ResponseStatusRow[];
    },
  });
}

// Epic R M-R11 (R-FR-23): statuses are recorded as append-only events through
// admin_record_authority_response_event(), which derives the current status and
// calls update_authority_response_status() only when it changes — so the
// notification fan-out (change-only, R-04) still happens in one call. A raw
// table write would skip both the history and the notifications.
interface ResponseEventRow {
  id: string;
  authority_id: string;
  region_id: string | null;
  government_role_id: string | null;
  response_status: string;
  effective_at: string;
  recorded_at: string;
  source_url: string | null;
  notes: string | null;
  origin: "event" | "legacy" | "backfill";
  voided_at: string | null;
  void_reason: string | null;
}

function useResponseEvents(questionId: string | null) {
  return useQuery<ResponseEventRow[]>({
    queryKey: ["admin-authorities-response-events", questionId],
    enabled: !!questionId,
    staleTime: 10_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("authority_response_events")
        .select("id, authority_id, region_id, government_role_id, response_status, effective_at, recorded_at, source_url, notes, origin, voided_at, void_reason")
        .eq("question_id", questionId as string)
        .order("effective_at", { ascending: false })
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ResponseEventRow[];
    },
  });
}

function useAuthorityRoles(authorityId: string) {
  return useQuery<{ id: string; role_name: string }[]>({
    queryKey: ["admin-authority-roles", authorityId],
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("government_role_registry")
        .select("id, role_name")
        .eq("authority_id", authorityId)
        .neq("verification_status", "retired")
        .order("role_name");
      if (error) throw error;
      return (data ?? []) as { id: string; role_name: string }[];
    },
  });
}

function useRecordResponseEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      questionId: string;
      authorityId: string;
      regionId: string;
      status: string;
      effectiveDate: string;
      sourceUrl: string;
      roleId: string | null;
      notes: string;
    }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      // A date-only value is recorded at the end of that day in UTC, capped at now.
      const effective = vars.effectiveDate
        ? new Date(Math.min(Date.parse(`${vars.effectiveDate}T23:59:59Z`), Date.now())).toISOString()
        : null;
      const { data, error } = await sb.rpc("admin_record_authority_response_event", {
        p_question_id: vars.questionId,
        p_authority_id: vars.authorityId,
        p_region_id: vars.regionId,
        p_response_status: vars.status,
        p_effective_at: effective,
        p_source_url: vars.sourceUrl || null,
        p_notes: vars.notes || null,
        p_government_role_id: vars.roleId,
      });
      if (error) throw error;
      return data as { status_changed: boolean; current_status: string | null };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-authorities-response-statuses", vars.questionId] });
      qc.invalidateQueries({ queryKey: ["admin-authorities-response-events", vars.questionId] });
    },
  });
}

function useVoidResponseEvent(questionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { eventId: string; reason: string }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.rpc("admin_void_authority_response_event", {
        p_event_id: vars.eventId,
        p_reason: vars.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-authorities-response-statuses", questionId] });
      qc.invalidateQueries({ queryKey: ["admin-authorities-response-events", questionId] });
    },
  });
}

// Epic R R-FR-15: an expectation outcome links an announced / completed action
// (a response event) to an expected action in the region's published ledger.
// Structured only — no public free text and no met / not-met verdict.
interface OutcomeRow {
  id: string;
  response_event_id: string;
  expectation_type: string;
  ledger_version: number;
  notes: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

const OUTCOME_EVENT_STATUSES = new Set(["action_announced", "action_completed"]);
const NON_ACTION_TYPES = new Set(["no_action", "unsure", "no_accountability_expected"]);

function useExpectationOutcomes(questionId: string | null) {
  return useQuery<OutcomeRow[]>({
    queryKey: ["admin-authorities-expectation-outcomes", questionId],
    enabled: !!questionId,
    staleTime: 10_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("expectation_outcomes")
        .select("id, response_event_id, expectation_type, ledger_version, notes, voided_at, void_reason")
        .eq("question_id", questionId as string)
        .order("recorded_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OutcomeRow[];
    },
  });
}

// The action types respondents selected in the region's current ledger version
// (the latest version is the current one; versions are append-only).
function useLedgerActionTypes(questionId: string, regionId: string | null, enabled: boolean) {
  return useQuery<{ version: number; types: string[] } | null>({
    queryKey: ["admin-ledger-action-types", questionId, regionId],
    enabled: enabled && !!regionId,
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("expectation_ledger_versions")
        .select("version, snapshot_summary")
        .eq("question_id", questionId)
        .eq("region_id", regionId as string)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const types = ((data.snapshot_summary ?? []) as { expectation_type: string }[])
        .map((s) => s.expectation_type)
        .filter((t) => !NON_ACTION_TYPES.has(t));
      return { version: data.version as number, types };
    },
  });
}

function useRecordOutcome(questionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { eventId: string; expectationType: string; notes: string }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.rpc("admin_record_expectation_outcome", {
        p_response_event_id: vars.eventId,
        p_expectation_type: vars.expectationType,
        p_notes: vars.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-authorities-expectation-outcomes", questionId] }),
  });
}

function useVoidOutcome(questionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { outcomeId: string; reason: string }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.rpc("admin_void_expectation_outcome", {
        p_outcome_id: vars.outcomeId,
        p_reason: vars.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-authorities-expectation-outcomes", questionId] }),
  });
}

// ── Pending suggestions (M-R07) hooks ──────────────────────────────────────

function usePendingSuggestions() {
  return useQuery<PendingSuggestion[]>({
    queryKey: ["admin-authorities-pending-suggestions"],
    staleTime: 15_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("pending_authority_suggestions")
        .select("id, question_id, candidate_name, candidate_type, source_article_id, status, created_at, questions(question), news_items(title, url)")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PendingSuggestion[];
    },
  });
}

// Confirm: links an EXISTING authority_registry entry to the suggestion's
// question (confidence_level='likely' — AI-suggested, not admin-authored
// from scratch), then marks the suggestion resolved. If no matching
// authority exists yet, the admin creates it first in the Registry panel,
// then returns here to confirm — kept as two steps rather than an inline
// create-and-link flow, since the suggestion only carries a name, not the
// jurisdiction/domain an authority_registry row requires.
function useResolveSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      suggestion: PendingSuggestion;
      action: "confirm" | "reject";
      authorityId?: string;
    }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data: userData } = await sb.auth.getUser();
      const reviewerId = userData?.user?.id ?? null;

      if (vars.action === "confirm") {
        if (!vars.authorityId) throw new Error("Select an authority to link before confirming.");
        const { error: mapErr } = await sb.from("question_authority_map").upsert(
          {
            question_id: vars.suggestion.question_id,
            authority_id: vars.authorityId,
            confidence_level: "likely",
            assigned_by: reviewerId,
            assigned_at: new Date().toISOString(),
          },
          { onConflict: "question_id,authority_id" }
        );
        if (mapErr) throw mapErr;
      }

      const { error } = await sb
        .from("pending_authority_suggestions")
        .update({
          status: vars.action === "confirm" ? "confirmed" : "rejected",
          reviewed_by: reviewerId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", vars.suggestion.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-authorities-pending-suggestions"] });
      qc.invalidateQueries({ queryKey: ["admin-authorities-assignments", vars.suggestion.question_id] });
      qc.invalidateQueries({ queryKey: ["question-authorities", vars.suggestion.question_id] });
    },
  });
}

// ── Left panel UI ─────────────────────────────────────────────────────────

function AuthorityFormDialog({
  editing,
  onClose,
}: {
  editing: Authority | "new" | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const upsert = useUpsertAuthority();
  const isNew = editing === "new";
  const initial = isNew || !editing ? null : editing;

  const [name, setName] = React.useState(initial?.name ?? "");
  const [jurisdiction, setJurisdiction] = React.useState<JurisdictionLevel>(initial?.jurisdiction_level ?? "local");
  const [domain, setDomain] = React.useState<Domain>(initial?.domain ?? "other");
  const [regionIds, setRegionIds] = React.useState<string[]>(initial?.region_id ? [initial.region_id] : []);
  const [contactUrl, setContactUrl] = React.useState(initial?.contact_url ?? "");

  if (!editing) return null;

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    try {
      await upsert.mutateAsync({
        id: isNew ? undefined : (editing as Authority).id,
        name: name.trim(),
        jurisdiction_level: jurisdiction,
        domain,
        region_id: regionIds[0] ?? null,
        contact_url: contactUrl.trim() || null,
      });
      toast({ title: isNew ? "Authority created" : "Authority updated" });
      onClose();
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-slate-200 p-5 w-full max-w-md shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            {isNew ? "New Authority" : "Edit Authority"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Indore Municipal Corporation" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Jurisdiction</label>
              <Select value={jurisdiction} onValueChange={(v) => setJurisdiction(v as JurisdictionLevel)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JURISDICTION_LEVELS.map((j) => (
                    <SelectItem key={j} value={j} className="text-xs capitalize">{j}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Domain</label>
              <Select value={domain} onValueChange={(v) => setDomain(v as Domain)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOMAINS.map((d) => (
                    <SelectItem key={d} value={d} className="text-xs capitalize">{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(jurisdiction === "local" || jurisdiction === "state") && (
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Region <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <RegionMultiSelect
                value={regionIds}
                onChange={(ids) => setRegionIds(ids.slice(-1))}
                placeholder="Select region"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">
              Contact URL <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <Input value={contactUrl} onChange={(e) => setContactUrl(e.target.value)} placeholder="https://..." />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={upsert.isPending}>
            {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isNew ? "Create" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuthorityRegistryPanel({
  authorities,
  isLoading,
  onEdit,
}: {
  authorities: Authority[];
  isLoading: boolean;
  onEdit: (a: Authority | "new") => void;
}) {
  const deleteAuthority = useDeleteAuthority();
  const { toast } = useToast();
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-800">Authority Registry</h2>
        <Button size="sm" onClick={() => onEdit("new")} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : authorities.length === 0 ? (
        <p className="text-xs text-slate-400">No authorities yet.</p>
      ) : (
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
          {authorities.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-800 truncate">{a.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge variant="secondary" className="text-[10px] capitalize">{a.domain}</Badge>
                  <Badge variant="outline" className="text-[10px] capitalize">{a.jurisdiction_level}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => onEdit(a)} className="text-slate-400 hover:text-slate-700 p-1">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {confirmDeleteId === a.id ? (
                  <button
                    onClick={async () => {
                      try {
                        await deleteAuthority.mutateAsync(a.id);
                        toast({ title: "Authority deleted" });
                      } catch (err: any) {
                        toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
                      }
                      setConfirmDeleteId(null);
                    }}
                    className="text-[10px] font-medium text-red-600 px-1.5"
                  >
                    Confirm?
                  </button>
                ) : (
                  <button onClick={() => setConfirmDeleteId(a.id)} className="text-slate-400 hover:text-red-600 p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Right panel UI ───────────────────────────────────────────────────────

const RESPONSE_STATUS_OPTIONS = [
  { value: "unacknowledged", label: "Unacknowledged" },
  { value: "under_review", label: "Under review" },
  { value: "action_announced", label: "Action announced" },
  { value: "action_completed", label: "Action completed" },
  { value: "no_response", label: "No response" },
];

// Per-authority response tracking, rendered inline under each assigned
// authority row. Scoped to named regions only — the RegionMultiSelect
// picker never produces a null selection, so this UI never creates a
// null-region authority_responses row. The null-region case (relevant only
// for expectation-stakers with no location set) still gets a working
// notification link via update_authority_response_status()'s /q/:id
// fallback, it just isn't something this admin form manages directly.
// R-FR-15: under an announced / completed action, the expected actions it has
// been linked to, and a control to link it to another one.
function EventOutcomes({
  questionId,
  event,
  outcomes,
}: {
  questionId: string;
  event: ResponseEventRow;
  outcomes: OutcomeRow[];
}) {
  const { toast } = useToast();
  const [linking, setLinking] = React.useState(false);
  const [type, setType] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [voidingId, setVoidingId] = React.useState<string | null>(null);
  const [voidReason, setVoidReason] = React.useState("");
  const { data: ledger, isLoading } = useLedgerActionTypes(questionId, event.region_id, linking);
  const record = useRecordOutcome(questionId);
  const voidOutcome = useVoidOutcome(questionId);
  const mine = outcomes.filter((o) => o.response_event_id === event.id);
  const linkedTypes = new Set(mine.filter((o) => !o.voided_at && o.ledger_version === ledger?.version).map((o) => o.expectation_type));
  const options = (ledger?.types ?? []).filter((t) => !linkedTypes.has(t));

  async function handleLink() {
    try {
      await record.mutateAsync({ eventId: event.id, expectationType: type, notes: notes.trim() });
      toast({ title: "Outcome linked", description: "Shown on the public ledger under What followed." });
      setLinking(false);
      setType("");
      setNotes("");
    } catch (err: any) {
      toast({ title: "Link failed", description: err?.message, variant: "destructive" });
    }
  }

  async function handleVoid(outcomeId: string) {
    if (!voidReason.trim()) {
      toast({ title: "Give a reason for voiding", variant: "destructive" });
      return;
    }
    try {
      await voidOutcome.mutateAsync({ outcomeId, reason: voidReason.trim() });
      toast({ title: "Outcome voided" });
      setVoidingId(null);
      setVoidReason("");
    } catch (err: any) {
      toast({ title: "Void failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="ml-2 mt-0.5 no-underline" style={{ textDecoration: "none" }}>
      {mine.map((o) => (
        <div key={o.id} className={o.voided_at ? "text-slate-300" : "text-emerald-700"}>
          ↳ outcome for <span className="font-medium">{o.expectation_type.replace(/_/g, " ")}</span> (ledger v{o.ledger_version})
          {o.notes && <span className="text-slate-400"> · {o.notes}</span>}
          {o.voided_at ? (
            <span className="text-slate-400"> (voided: {o.void_reason})</span>
          ) : voidingId === o.id ? (
            <span className="inline-flex items-center gap-1 ml-1">
              <Input value={voidReason} onChange={(ev) => setVoidReason(ev.target.value)} placeholder="Reason" className="h-6 w-40 text-[10px]" />
              <button onClick={() => handleVoid(o.id)} className="text-red-600" disabled={voidOutcome.isPending}>Void</button>
              <button onClick={() => { setVoidingId(null); setVoidReason(""); }} className="text-slate-400">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setVoidingId(o.id)} className="ml-1 text-slate-400 hover:text-red-600">void</button>
          )}
        </div>
      ))}
      {!linking ? (
        <button onClick={() => setLinking(true)} className="text-slate-400 hover:text-slate-700 underline underline-offset-2">
          link to an expected action
        </button>
      ) : isLoading ? (
        <span className="text-slate-400">Loading ledger…</span>
      ) : !ledger ? (
        <span className="text-slate-400">
          No published ledger for this region yet.{" "}
          <button onClick={() => setLinking(false)} className="underline">Close</button>
        </span>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-6 w-44 text-[10px]"><SelectValue placeholder={`Expected action (ledger v${ledger.version})`} /></SelectTrigger>
            <SelectContent>
              {options.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">{t.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (internal)" className="h-6 w-36 text-[10px]" />
          <button onClick={handleLink} disabled={!type || record.isPending} className="text-slate-700 font-medium disabled:text-slate-300">
            Link
          </button>
          <button onClick={() => setLinking(false)} className="text-slate-400">Cancel</button>
        </span>
      )}
    </div>
  );
}

function ResponseStatusTracker({
  questionId,
  authorityId,
  authorityName,
  existing,
  events,
  outcomes,
}: {
  questionId: string;
  authorityId: string;
  authorityName: string;
  existing: ResponseStatusRow[];
  events: ResponseEventRow[];
  outcomes: OutcomeRow[];
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const [regionIds, setRegionIds] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState("unacknowledged");
  const [effectiveDate, setEffectiveDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [roleId, setRoleId] = React.useState<string>("none");
  const [notes, setNotes] = React.useState("");
  const [voidingId, setVoidingId] = React.useState<string | null>(null);
  const [voidReason, setVoidReason] = React.useState("");
  const record = useRecordResponseEvent();
  const voidEvent = useVoidResponseEvent(questionId);
  const { data: roles = [] } = useAuthorityRoles(authorityId);

  const regionId = regionIds[0] ?? null;
  const rowsForThisAuthority = existing.filter((r) => r.authority_id === authorityId);
  const eventsForThisAuthority = events.filter((e) => e.authority_id === authorityId);
  const roleName = new Map(roles.map((r) => [r.id, r.role_name]));

  async function handleSubmit() {
    if (!regionId) return;
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl.trim())) {
      toast({ title: "Source must be an http(s) URL", variant: "destructive" });
      return;
    }
    try {
      const res = await record.mutateAsync({
        questionId, authorityId, regionId, status, effectiveDate,
        sourceUrl: sourceUrl.trim(), roleId: roleId === "none" ? null : roleId, notes,
      });
      // Epic R R-04: notifications go out only when the derived status changes.
      toast(
        res?.status_changed
          ? { title: "Response recorded", description: "The current status changed, so stakers in this region have been notified." }
          : { title: "Response recorded", description: "Added to the history. The current status did not change, so no notifications were sent." }
      );
      setExpanded(false);
      setNotes("");
      setSourceUrl("");
      setRoleId("none");
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    }
  }

  async function handleVoid(eventId: string) {
    if (!voidReason.trim()) {
      toast({ title: "Give a reason for voiding", variant: "destructive" });
      return;
    }
    try {
      await voidEvent.mutateAsync({ eventId, reason: voidReason.trim() });
      toast({ title: "Event voided", description: "The current status was re-derived from the remaining events." });
      setVoidingId(null);
      setVoidReason("");
    } catch (err: any) {
      toast({ title: "Void failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="mt-1.5">
      {rowsForThisAuthority.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {rowsForThisAuthority.map((r) => (
            <Badge key={r.id} variant="outline" className="text-[10px] capitalize">
              {r.response_status.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-slate-400 hover:text-slate-600 underline underline-offset-2"
        >
          {expanded ? "Cancel" : "Record a response"}
        </button>
        {eventsForThisAuthority.length > 0 && (
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-[10px] text-slate-400 hover:text-slate-600 underline underline-offset-2"
          >
            {showHistory ? "Hide history" : `History (${eventsForThisAuthority.length})`}
          </button>
        )}
      </div>

      {showHistory && (
        <ol className="mt-1.5 space-y-1 border-l border-slate-200 pl-2.5">
          {eventsForThisAuthority.map((e) => (
            <li key={e.id} className={`text-[10px] ${e.voided_at ? "text-slate-300 line-through" : "text-slate-600"}`}>
              {new Date(e.effective_at).toLocaleDateString()} · {e.response_status.replace(/_/g, " ")}
              {e.government_role_id && roleName.get(e.government_role_id) && <> · {roleName.get(e.government_role_id)}</>}
              {e.origin !== "event" && <span className="text-slate-400"> · {e.origin}</span>}
              {e.source_url && (
                <a href={e.source_url} target="_blank" rel="noreferrer" className="ml-1 text-slate-400 hover:text-slate-700">source</a>
              )}
              {e.notes && <span className="text-slate-400"> · {e.notes}</span>}
              {e.voided_at ? (
                <span className="no-underline text-slate-400" style={{ textDecoration: "none" }}> (voided: {e.void_reason})</span>
              ) : voidingId === e.id ? (
                <span className="inline-flex items-center gap-1 ml-1">
                  <Input
                    value={voidReason}
                    onChange={(ev) => setVoidReason(ev.target.value)}
                    placeholder="Reason"
                    className="h-6 w-40 text-[10px]"
                  />
                  <button onClick={() => handleVoid(e.id)} className="text-red-600" disabled={voidEvent.isPending}>Void</button>
                  <button onClick={() => { setVoidingId(null); setVoidReason(""); }} className="text-slate-400">Cancel</button>
                </span>
              ) : (
                <button onClick={() => setVoidingId(e.id)} className="ml-1 text-slate-400 hover:text-red-600">void</button>
              )}
              {!e.voided_at && e.region_id && OUTCOME_EVENT_STATUSES.has(e.response_status) && (
                <EventOutcomes questionId={questionId} event={e} outcomes={outcomes} />
              )}
            </li>
          ))}
        </ol>
      )}

      {expanded && (
        <div className="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100 space-y-2">
          <RegionMultiSelect
            value={regionIds}
            onChange={(ids) => setRegionIds(ids.slice(-1))}
            placeholder="Select region"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESPONSE_STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={effectiveDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="h-8 text-xs"
              title="When the response happened"
            />
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Office (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">No specific office</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="text-xs">{r.role_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="Source URL (optional, shown publicly)"
            className="h-8 text-xs"
          />
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional, internal only)"
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            className="w-full"
            disabled={!regionId || record.isPending}
            onClick={handleSubmit}
          >
            {record.isPending ? "Saving…" : `Record — notifies stakers in this region if the current status changes`}
          </Button>
        </div>
      )}
    </div>
  );
}

// Epic R R-08: set a question's content type (incident / policy / election /
// general) and generate authority suggestions from the entities extracted
// from its source articles. Marking a question as an incident generates them
// automatically; they land in the Pending Suggestions tab for review and are
// never mapped automatically. 'video' is owned by the UGQ publish flow.
const CONTENT_TYPE_OPTIONS = [
  { value: "general", label: "General" },
  { value: "incident", label: "Incident" },
  { value: "policy", label: "Policy" },
  { value: "election", label: "Election" },
];

function ContentTypeControl({
  question,
  onChanged,
}: {
  question: QuestionRow;
  onChanged: (contentType: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const current = question.content_type ?? "general";
  const isVideo = current === "video";

  function suggestionsToast(added: number) {
    return added > 0
      ? `${added} authority suggestion${added === 1 ? "" : "s"} added to Pending Suggestions for review.`
      : "No new authority suggestions found in this question's source articles.";
  }

  async function setType(value: string) {
    if (value === current || busy) return;
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    try {
      const { data, error } = await sb.rpc("admin_set_question_content_type", {
        p_question_id: question.id,
        p_content_type: value,
      });
      if (error) throw error;
      onChanged(value);
      qc.invalidateQueries({ queryKey: ["admin-authorities-pending-suggestions"] });
      const added = (data as { suggestions_added?: number } | null)?.suggestions_added ?? 0;
      toast({
        title: `Content type set to ${value}`,
        description: value === "incident" ? suggestionsToast(added) : undefined,
      });
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function findSuggestions() {
    const sb = getSupabase();
    if (!sb || busy) return;
    setBusy(true);
    try {
      const { data, error } = await sb.rpc("admin_generate_authority_suggestions", { p_question_id: question.id });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["admin-authorities-pending-suggestions"] });
      toast({ title: "Authority suggestions", description: suggestionsToast((data as number) ?? 0) });
    } catch (err: any) {
      toast({ title: "Could not generate suggestions", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3">
      <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Content type</p>
      <div className="flex items-center gap-2">
        {isVideo ? (
          <p className="text-xs text-slate-500">Video (set by the UGQ publish flow)</p>
        ) : (
          <Select value={current} onValueChange={setType} disabled={busy}>
            <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONTENT_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={findSuggestions}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Find authority suggestions"}
        </Button>
      </div>
      <p className="text-[10px] text-slate-400 mt-1">
        Incident questions show the incident card and the accountability prompt. Suggestions come from the
        institutions named in the source articles and always need review.
      </p>
    </div>
  );
}

function QuestionAssignmentPanel({ authorities }: { authorities: Authority[] }) {
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [selectedQuestion, setSelectedQuestion] = React.useState<QuestionRow | null>(null);
  const [pickAuthorityId, setPickAuthorityId] = React.useState<string>("");
  const [pickConfidence, setPickConfidence] = React.useState<ConfidenceLevel>("confirmed");

  const { data: results = [], isFetching: searching } = useQuestionSearch(search);
  const { data: assignments = [], isLoading: loadingAssignments } = useQuestionAssignments(
    selectedQuestion?.id ?? null
  );
  const { data: responseStatuses = [] } = useResponseStatuses(selectedQuestion?.id ?? null);
  const { data: responseEvents = [] } = useResponseEvents(selectedQuestion?.id ?? null);
  const { data: outcomes = [] } = useExpectationOutcomes(selectedQuestion?.id ?? null);
  const assign = useAssignAuthority();
  const unassign = useUnassignAuthority();

  const assignedIds = new Set(assignments.map((a) => a.authority_id));
  const availableToAssign = authorities.filter((a) => !assignedIds.has(a.id));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800 mb-3">Question Assignments</h2>

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
        <div className="max-h-64 overflow-y-auto space-y-1">
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
            <button onClick={() => setSelectedQuestion(null)} className="text-slate-400 hover:text-slate-600 shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <ContentTypeControl
            question={selectedQuestion}
            onChanged={(contentType) => setSelectedQuestion({ ...selectedQuestion, content_type: contentType })}
          />

          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">
            Assigned authorities
          </p>
          {loadingAssignments ? (
            <p className="text-xs text-slate-400 mb-3">Loading…</p>
          ) : assignments.length === 0 ? (
            <p className="text-xs text-slate-400 mb-3">None assigned yet.</p>
          ) : (
            <div className="space-y-1.5 mb-3">
              {assignments.map((a) => (
                <div
                  key={a.authority_id}
                  className="rounded-lg border border-slate-100 px-3 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-800 truncate">{a.authority_registry?.name}</p>
                      <Badge variant="outline" className="text-[10px] capitalize mt-0.5">
                        {a.confidence_level}
                      </Badge>
                    </div>
                    <button
                      onClick={() =>
                        unassign.mutate({ question_id: a.question_id, authority_id: a.authority_id })
                      }
                      className="text-slate-400 hover:text-red-600 p-1 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <ResponseStatusTracker
                    questionId={a.question_id}
                    authorityId={a.authority_id}
                    authorityName={a.authority_registry?.name ?? "Authority"}
                    existing={responseStatuses}
                    events={responseEvents}
                    outcomes={outcomes}
                  />
                </div>
              ))}
            </div>
          )}

          {availableToAssign.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">
                Assign authority
              </p>
              <div className="flex gap-2">
                <Select value={pickAuthorityId} onValueChange={setPickAuthorityId}>
                  <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Select authority" /></SelectTrigger>
                  <SelectContent>
                    {availableToAssign.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={pickConfidence} onValueChange={(v) => setPickConfidence(v as ConfidenceLevel)}>
                  <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONFIDENCE_LEVELS.map((c) => (
                      <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!pickAuthorityId || assign.isPending}
                  onClick={async () => {
                    try {
                      await assign.mutateAsync({
                        question_id: selectedQuestion.id,
                        authority_id: pickAuthorityId,
                        confidence_level: pickConfidence,
                      });
                      setPickAuthorityId("");
                      toast({ title: "Authority assigned" });
                    } catch (err: any) {
                      toast({ title: "Assign failed", description: err?.message, variant: "destructive" });
                    }
                  }}
                >
                  Assign
                </Button>
              </div>
            </div>
          )}

          <RoleSuggestionsSection questionId={selectedQuestion.id} contentType={selectedQuestion.content_type} />
        </div>
      )}
    </div>
  );
}

// ── Pending Suggestions panel UI (M-R07) ────────────────────────────────

function SuggestionRow({
  suggestion,
  authorities,
}: {
  suggestion: PendingSuggestion;
  authorities: Authority[];
}) {
  const { toast } = useToast();
  const resolve = useResolveSuggestion();
  const [pickAuthorityId, setPickAuthorityId] = React.useState("");

  async function handleConfirm() {
    try {
      await resolve.mutateAsync({ suggestion, action: "confirm", authorityId: pickAuthorityId });
      toast({ title: "Suggestion confirmed", description: "Authority linked to question." });
    } catch (err: any) {
      toast({ title: "Confirm failed", description: err?.message, variant: "destructive" });
    }
  }

  async function handleReject() {
    try {
      await resolve.mutateAsync({ suggestion, action: "reject" });
      toast({ title: "Suggestion rejected" });
    } catch (err: any) {
      toast({ title: "Reject failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-sm font-medium text-slate-800 truncate">{suggestion.candidate_name}</p>
            <Badge variant="secondary" className="text-[10px] capitalize shrink-0">
              {suggestion.candidate_type.replace("_", " ")}
            </Badge>
          </div>
          {suggestion.questions?.question && (
            <p className="text-xs text-slate-500 truncate mb-0.5">
              On: {suggestion.questions.question}
            </p>
          )}
          {suggestion.news_items?.url && (
            <a
              href={suggestion.news_items.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              {suggestion.news_items.title ?? "Source article"} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <button
          onClick={handleReject}
          disabled={resolve.isPending}
          className="text-slate-400 hover:text-red-600 p-1 shrink-0"
          title="Reject"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-slate-100">
        <Select value={pickAuthorityId} onValueChange={setPickAuthorityId}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue placeholder="Link to existing authority…" />
          </SelectTrigger>
          <SelectContent>
            {authorities.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="gap-1.5"
          disabled={!pickAuthorityId || resolve.isPending}
          onClick={handleConfirm}
        >
          {resolve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Confirm
        </Button>
      </div>
      {authorities.length === 0 && (
        <p className="text-[11px] text-slate-400 mt-1.5">
          No authorities in the registry yet — create one in the Registry tab first.
        </p>
      )}
    </div>
  );
}

function PendingSuggestionsPanel({ authorities }: { authorities: Authority[] }) {
  const { data: suggestions = [], isLoading } = usePendingSuggestions();

  if (isLoading) {
    return <p className="text-xs text-slate-400">Loading…</p>;
  }

  if (suggestions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <Inbox className="h-6 w-6 text-slate-300 mx-auto mb-2" />
        <p className="text-xs text-slate-400">No pending suggestions.</p>
        <p className="text-[11px] text-slate-400 mt-1">
          Populated when entity extraction flags a public institution named in a civic-harm article.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {suggestions.map((s) => (
        <SuggestionRow key={s.id} suggestion={s} authorities={authorities} />
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function AdminAuthoritiesPage() {
  const { data: authorities = [], isLoading } = useAuthorities();
  const [editing, setEditing] = React.useState<Authority | "new" | null>(null);
  const [tab, setTab] = React.useState<"manage" | "pending" | "roles" | "audit">("manage");
  const { data: pendingSuggestions = [] } = usePendingSuggestions();

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Landmark className="h-5 w-5 text-slate-700" />
        <h1 className="text-lg font-semibold text-slate-900">Authorities</h1>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Epic R — maps civic authorities to questions. Authority display must precede any
        expectation or action content shown to users (BR-R03).
      </p>

      <div className="flex gap-1 mb-4 border-b border-slate-200">
        <button
          onClick={() => setTab("manage")}
          className={[
            "text-xs font-medium px-3 py-2 border-b-2 -mb-px transition-colors",
            tab === "manage" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600",
          ].join(" ")}
        >
          Registry &amp; Assignments
        </button>
        <button
          onClick={() => setTab("pending")}
          className={[
            "text-xs font-medium px-3 py-2 border-b-2 -mb-px transition-colors flex items-center gap-1.5",
            tab === "pending" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600",
          ].join(" ")}
        >
          Pending Suggestions
          {pendingSuggestions.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{pendingSuggestions.length}</Badge>
          )}
        </button>
        <button
          onClick={() => setTab("roles")}
          className={[
            "text-xs font-medium px-3 py-2 border-b-2 -mb-px transition-colors",
            tab === "roles" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600",
          ].join(" ")}
        >
          Government Roles
        </button>
        <button
          onClick={() => setTab("audit")}
          className={[
            "text-xs font-medium px-3 py-2 border-b-2 -mb-px transition-colors",
            tab === "audit" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600",
          ].join(" ")}
        >
          Audit log
        </button>
      </div>

      {tab === "manage" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AuthorityRegistryPanel authorities={authorities} isLoading={isLoading} onEdit={setEditing} />
          <QuestionAssignmentPanel authorities={authorities} />
        </div>
      ) : tab === "pending" ? (
        <PendingSuggestionsPanel authorities={authorities} />
      ) : tab === "roles" ? (
        <GovernmentRolesPanel authorities={authorities} />
      ) : (
        <AuditLogPanel />
      )}

      <AuthorityFormDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
