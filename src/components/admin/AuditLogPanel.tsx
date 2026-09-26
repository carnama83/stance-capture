// src/components/admin/AuditLogPanel.tsx
// Epic R — admin audit log (R-FR-24, M-R12).
//
// Read-only view of epic_r_audit_log through admin_get_audit_log(): every
// insert, update and delete on the Epic R admin surfaces, newest first, with
// the actor and — for updates — only the columns that changed (old → new).
// The log itself is append-only and admin-only; this page cannot change it.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface AuditRow {
  id: number;
  occurred_at: string;
  actor: string | null;
  actor_email: string | null;
  actor_kind: "admin" | "service" | "user" | "system";
  table_name: string;
  row_key: Record<string, unknown>;
  action: "INSERT" | "UPDATE" | "DELETE";
  changes: Record<string, unknown>;
}

const TABLES = [
  "authority_registry",
  "question_authority_map",
  "government_role_registry",
  "question_role_suggestions",
  "pending_authority_suggestions",
  "expectation_ledgers",
  "authority_responses",
  "authority_briefs",
  "questions",
];
const ACTIONS = ["INSERT", "UPDATE", "DELETE"];
const PAGE = 100;

const ACTION_STYLES: Record<AuditRow["action"], string> = {
  INSERT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UPDATE: "bg-blue-50 text-blue-700 border-blue-200",
  DELETE: "bg-rose-50 text-rose-700 border-rose-200",
};

// Long values (snapshots, brief text) are shortened; the full row stays in the log.
function short(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function useAuditLog(table: string, action: string, beforeId: number | null) {
  return useQuery<AuditRow[]>({
    queryKey: ["admin-epic-r-audit-log", table, action, beforeId],
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("admin_get_audit_log", {
        p_table: table === "all" ? null : table,
        p_action: action === "all" ? null : action,
        p_before_id: beforeId,
        p_limit: PAGE,
      });
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });
}

function Changes({ row }: { row: AuditRow }) {
  if (row.action === "UPDATE") {
    return (
      <ul className="space-y-0.5">
        {Object.entries(row.changes).map(([col, diff]) => {
          const d = diff as { old: unknown; new: unknown };
          return (
            <li key={col} className="text-[11px] text-slate-600">
              <span className="font-medium text-slate-700">{col}</span>: <span className="text-slate-400">{short(d.old)}</span> →{" "}
              {short(d.new)}
            </li>
          );
        })}
      </ul>
    );
  }
  const entries = Object.entries(row.changes).filter(([k]) => k !== "created_at" && k !== "updated_at");
  return (
    <p className="text-[11px] text-slate-500 break-all">
      {entries.slice(0, 6).map(([k, v]) => `${k}=${short(v)}`).join(" · ")}
      {entries.length > 6 && ` · +${entries.length - 6} more`}
    </p>
  );
}

export function AuditLogPanel() {
  const [table, setTable] = React.useState("all");
  const [action, setAction] = React.useState("all");
  // Paged by id: rows written in one transaction share occurred_at.
  const [cursors, setCursors] = React.useState<(number | null)[]>([null]);
  const beforeId = cursors[cursors.length - 1];
  const { data: rows = [], isLoading, error, isFetching } = useAuditLog(table, action, beforeId);

  const reset = () => setCursors([null]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Audit log</h2>
          <p className="text-[11px] text-slate-400">
            Every change to the Epic R admin tables, newest first. Append-only; it cannot be edited from here.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={table} onValueChange={(v) => { setTable(v); reset(); }}>
            <SelectTrigger className="h-8 text-xs w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All tables</SelectItem>
              {TABLES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={(v) => { setAction(v); reset(); }}>
            <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All actions</SelectItem>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <p className="text-xs text-red-600">Could not load the audit log: {(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-400">No changes recorded{cursors.length > 1 ? " before this point" : ""}.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                <span className={`text-[10px] rounded-full border px-1.5 py-0.5 ${ACTION_STYLES[r.action]}`}>{r.action}</span>
                <span className="text-xs font-medium text-slate-800">{r.table_name}</span>
                <span className="text-[10px] text-slate-400 break-all">{short(r.row_key)}</span>
                <span className="ml-auto text-[10px] text-slate-400">
                  {new Date(r.occurred_at).toLocaleString()} · {r.actor_email ?? r.actor_kind}
                  {r.actor_email && r.actor_kind !== "admin" && ` (${r.actor_kind})`}
                </span>
              </div>
              <Changes row={r} />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={cursors.length <= 1 || isFetching}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          Newer
        </Button>
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={rows.length < PAGE || isFetching}
          onClick={() => setCursors((c) => [...c, rows[rows.length - 1].id])}
        >
          Older
        </Button>
      </div>
    </div>
  );
}
