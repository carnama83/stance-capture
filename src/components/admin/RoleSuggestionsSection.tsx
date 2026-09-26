// src/components/admin/RoleSuggestionsSection.tsx
// Epic R — M-R10: admin review of government-role suggestions (US-R21, R-FR-19).
//
// Rendered on /admin/authorities under a selected question. "Suggest roles (AI)"
// calls the suggest-government-roles Edge Function, which may only rank
// verified registry roles of the question's mapped institutions. Every row
// arrives as 'suggested' with confidence, rationale and evidence; users see a
// role only after it is confirmed here (and while the role stays verified).
// Admins can also add a confirmed suggestion by hand.

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, Check, X, Plus } from "lucide-react";

// Mirrors the question_role_suggestions CHECK and the Edge Function's lists.
const GENERAL_ACTIONS = ["investigation", "compensation", "policy_reform", "transparency", "infrastructure_fix", "accountability", "legal_action"];
const INCIDENT_ACTIONS = ["criminal_prosecution", "departmental_suspension", "independent_investigation", "compensation_only", "administrative_transfer"];

interface SuggestionRow {
  id: string;
  expectation_type: string;
  government_role_id: string;
  suggested_by: "ai" | "admin";
  confidence_score: number | null;
  rationale: string | null;
  status: "suggested" | "confirmed" | "rejected";
  government_role_registry: {
    role_name: string;
    verification_status: string;
    authority_registry: { name: string } | null;
  } | null;
}

interface VerifiedRole {
  id: string;
  role_name: string;
  authority_registry: { name: string } | null;
}

const label = (s: string) => s.replace(/_/g, " ");

const STATUS_STYLES: Record<SuggestionRow["status"], string> = {
  suggested: "bg-amber-50 text-amber-700 border-amber-200",
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-slate-50 text-slate-400 border-slate-200",
};

function useRoleSuggestions(questionId: string) {
  return useQuery<SuggestionRow[]>({
    queryKey: ["admin-role-suggestions", questionId],
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("question_role_suggestions")
        .select(
          "id, expectation_type, government_role_id, suggested_by, confidence_score, rationale, status, government_role_registry(role_name, verification_status, authority_registry(name))"
        )
        .eq("question_id", questionId)
        .order("expectation_type")
        .order("confidence_score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as SuggestionRow[];
    },
  });
}

function useVerifiedRoles() {
  return useQuery<VerifiedRole[]>({
    queryKey: ["admin-verified-government-roles"],
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("government_role_registry")
        .select("id, role_name, authority_registry(name)")
        .eq("verification_status", "verified")
        .order("role_name");
      if (error) throw error;
      return (data ?? []) as unknown as VerifiedRole[];
    },
  });
}

export function RoleSuggestionsSection({ questionId, contentType }: { questionId: string; contentType?: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useRoleSuggestions(questionId);
  const { data: verifiedRoles = [] } = useVerifiedRoles();
  const actions = contentType === "incident" ? INCIDENT_ACTIONS : GENERAL_ACTIONS;
  const [adding, setAdding] = React.useState(false);
  const [addAction, setAddAction] = React.useState<string>(actions[0]);
  const [addRole, setAddRole] = React.useState<string>("");

  React.useEffect(() => {
    setAddAction(actions[0]);
    setAddRole("");
    setAdding(false);
  }, [questionId, contentType]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-role-suggestions", questionId] });

  const generate = useMutation({
    mutationFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.functions.invoke("suggest-government-roles", { body: { question_id: questionId } });
      if (error) throw error;
      return data as { added?: number; proposed?: number; reason?: string; error?: string };
    },
    onSuccess: (res) => {
      refresh();
      if (res?.reason) toast({ title: "No new suggestions", description: res.reason });
      else toast({ title: `${res?.added ?? 0} new suggestion(s)`, description: "Review and confirm before users see them." });
    },
    onError: (err: any) => toast({ title: "Suggestion failed", description: err?.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SuggestionRow["status"] }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.from("question_role_suggestions").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (err: any) => toast({ title: "Update failed", description: err?.message, variant: "destructive" }),
  });

  const addManual = useMutation({
    mutationFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.from("question_role_suggestions").insert({
        question_id: questionId,
        expectation_type: addAction,
        government_role_id: addRole,
        suggested_by: "admin",
        status: "confirmed",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      setAdding(false);
      setAddRole("");
      toast({ title: "Office added and confirmed" });
    },
    onError: (err: any) =>
      toast({
        title: "Add failed",
        description: String(err?.message ?? "").includes("duplicate") ? "That office is already listed for this action." : err?.message,
        variant: "destructive",
      }),
  });

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Government role suggestions</p>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Suggest roles (AI)
        </Button>
      </div>
      <p className="text-[11px] text-slate-400 mb-2">
        Picks only from verified roles of the mapped institutions. Users see an office only after you confirm it.
      </p>

      {isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-400">No role suggestions yet.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const role = r.government_role_registry;
            const unverified = role && role.verification_status !== "verified";
            return (
              <div key={r.id} className="rounded-lg border border-slate-100 px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-800 min-w-0 truncate">
                    <span className="text-slate-400 capitalize">{label(r.expectation_type)} → </span>
                    {role?.role_name ?? "Unknown role"}
                    <span className="text-slate-400"> · {role?.authority_registry?.name ?? "—"}</span>
                  </p>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-[10px] rounded-full border px-1.5 py-0.5 ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                    {r.status !== "confirmed" && (
                      <button onClick={() => setStatus.mutate({ id: r.id, status: "confirmed" })} className="p-1 text-slate-400 hover:text-emerald-600" title="Confirm">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {r.status !== "rejected" && (
                      <button onClick={() => setStatus.mutate({ id: r.id, status: "rejected" })} className="p-1 text-slate-400 hover:text-rose-600" title="Reject">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {r.suggested_by === "ai" ? "AI" : "Admin"}
                  {r.confidence_score != null && ` · confidence ${Math.round(r.confidence_score * 100)}%`}
                  {r.rationale && ` · ${r.rationale}`}
                  {unverified && <span className="text-amber-600"> · role is not verified, so users will not see it</span>}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={addAction} onValueChange={setAddAction}>
            <SelectTrigger className="h-8 text-xs w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {actions.map((a) => (
                <SelectItem key={a} value={a} className="text-xs capitalize">{label(a)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={addRole} onValueChange={setAddRole}>
            <SelectTrigger className="h-8 text-xs w-64"><SelectValue placeholder="Choose a verified role" /></SelectTrigger>
            <SelectContent>
              {verifiedRoles.map((v) => (
                <SelectItem key={v.id} value={v.id} className="text-xs">
                  {v.role_name} · {v.authority_registry?.name ?? "—"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 text-xs" onClick={() => addManual.mutate()} disabled={!addRole || addManual.isPending}>
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={verifiedRoles.length === 0}
          className="mt-2 text-[11px] text-slate-500 hover:text-slate-700 flex items-center gap-1 disabled:opacity-40"
          title={verifiedRoles.length === 0 ? "No verified government roles yet" : undefined}
        >
          <Plus className="h-3 w-3" /> Add an office by hand
        </button>
      )}
    </div>
  );
}
