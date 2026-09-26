// src/components/admin/GovernmentRolesPanel.tsx
// Epic R — M-R09: government-role registry admin (US-R20, BR-R11, QA-R22).
//
// Stable offices / designations (Municipal Commissioner, District Magistrate…)
// linked to a responsible institution and a jurisdiction. The role is the
// identity; a named office-holder is optional, must cite an official source,
// and is changed only through admin_set_government_role_holder(), which keeps
// the previous holder in government_role_holder_history — so a change of
// personnel never changes the role id.
//
// Rendered as the "Government Roles" tab on /admin/authorities. Authority
// names are mapped client-side from the list the page already loads.

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RegionMultiSelect } from "@/components/admin/RegionMultiSelect";
import { Plus, Trash2, Pencil, X, Loader2, UserRound, ExternalLink, Search } from "lucide-react";

type GovernmentLevel = "local" | "state" | "national" | "international";
type Domain = "water" | "health" | "policing" | "transport" | "environment" | "education" | "other";
type RoleType = "elected" | "appointed" | "administrative" | "judicial" | "law_enforcement" | "other";
type VerificationStatus = "suggested" | "verified" | "stale" | "retired";

export interface RoleAuthority {
  id: string;
  name: string;
  jurisdiction_level: GovernmentLevel;
  region_id: string | null;
  domain: Domain;
}

interface GovernmentRole {
  id: string;
  role_name: string;
  authority_id: string;
  government_level: GovernmentLevel;
  region_id: string | null;
  domain: Domain;
  role_type: RoleType;
  parent_role_id: string | null;
  current_office_holder_name: string | null;
  office_holder_source_url: string | null;
  office_holder_verified_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  verification_status: VerificationStatus;
  updated_at: string;
}

interface HolderHistoryRow {
  id: string;
  office_holder_name: string;
  source_url: string | null;
  valid_from: string | null;
  valid_to: string | null;
  ended_at: string;
  end_reason: "replaced" | "cleared" | "corrected";
}

const LEVELS: GovernmentLevel[] = ["local", "state", "national", "international"];
const DOMAINS: Domain[] = ["water", "health", "policing", "transport", "environment", "education", "other"];
const ROLE_TYPES: RoleType[] = ["administrative", "elected", "appointed", "judicial", "law_enforcement", "other"];
const STATUSES: VerificationStatus[] = ["suggested", "verified", "stale", "retired"];

const STATUS_STYLES: Record<VerificationStatus, string> = {
  suggested: "bg-amber-50 text-amber-700 border-amber-200",
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  stale: "bg-slate-100 text-slate-600 border-slate-200",
  retired: "bg-slate-50 text-slate-400 border-slate-200",
};

const label = (s: string) => s.replace(/_/g, " ");
const today = () => new Date().toISOString().slice(0, 10);

// A holder is shown publicly only while verified, sourced and within its dates
// (mirrors search_government_roles); the admin list flags anything else.
function holderIsCurrent(r: GovernmentRole) {
  if (!r.current_office_holder_name || !r.office_holder_verified_at || !r.office_holder_source_url) return false;
  const d = today();
  return (!r.valid_from || r.valid_from <= d) && (!r.valid_to || r.valid_to >= d);
}

// ── Data hooks ─────────────────────────────────────────────────────────────

function useGovernmentRoles() {
  return useQuery<GovernmentRole[]>({
    queryKey: ["admin-government-roles"],
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.from("government_role_registry").select("*").order("role_name");
      if (error) throw error;
      return (data ?? []) as GovernmentRole[];
    },
  });
}

function useUpsertRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Partial<GovernmentRole> & { role_name: string; authority_id: string }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { id, ...rest } = row;
      const { error } = id
        ? await sb.from("government_role_registry").update(rest).eq("id", id)
        : await sb.from("government_role_registry").insert(rest);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-government-roles"] }),
  });
}

function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.from("government_role_registry").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-government-roles"] }),
  });
}

function useHolderHistory(roleId: string | null) {
  return useQuery<HolderHistoryRow[]>({
    queryKey: ["admin-government-role-history", roleId],
    enabled: !!roleId,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb
        .from("government_role_holder_history")
        .select("id, office_holder_name, source_url, valid_from, valid_to, ended_at, end_reason")
        .eq("government_role_id", roleId!)
        .order("ended_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as HolderHistoryRow[];
    },
  });
}

function useSetHolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      roleId: string;
      name: string | null;
      sourceUrl: string | null;
      validFrom: string | null;
      validTo: string | null;
      reason: "replaced" | "corrected";
    }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.rpc("admin_set_government_role_holder", {
        p_role_id: args.roleId,
        p_holder_name: args.name,
        p_source_url: args.sourceUrl,
        p_valid_from: args.validFrom,
        p_valid_to: args.validTo,
        p_reason: args.reason,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-government-roles"] });
      qc.invalidateQueries({ queryKey: ["admin-government-role-history", vars.roleId] });
    },
  });
}

// ── Shared bits ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-slate-200 p-5 w-full max-w-lg shadow-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label: text, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-600 mb-1 block">
        {text} {hint && <span className="text-slate-400 font-normal">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function SimpleSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o} className="text-xs capitalize">{label(o)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Create / edit a role ───────────────────────────────────────────────────

function RoleFormDialog({
  editing,
  authorities,
  roles,
  onClose,
}: {
  editing: GovernmentRole | "new";
  authorities: RoleAuthority[];
  roles: GovernmentRole[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const upsert = useUpsertRole();
  const initial = editing === "new" ? null : editing;

  const [roleName, setRoleName] = React.useState(initial?.role_name ?? "");
  const [authorityId, setAuthorityId] = React.useState(initial?.authority_id ?? authorities[0]?.id ?? "");
  const authority = authorities.find((a) => a.id === authorityId) ?? null;
  const [level, setLevel] = React.useState<GovernmentLevel>(initial?.government_level ?? authority?.jurisdiction_level ?? "local");
  const [domain, setDomain] = React.useState<Domain>(initial?.domain ?? authority?.domain ?? "other");
  const [roleType, setRoleType] = React.useState<RoleType>(initial?.role_type ?? "administrative");
  const [status, setStatus] = React.useState<VerificationStatus>(initial?.verification_status ?? "verified");
  const [regionIds, setRegionIds] = React.useState<string[]>(
    initial ? (initial.region_id ? [initial.region_id] : []) : authority?.region_id ? [authority.region_id] : []
  );
  const [parentId, setParentId] = React.useState<string>(initial?.parent_role_id ?? "none");

  // New roles inherit level, domain and region from the institution they belong to.
  const onAuthorityChange = (id: string) => {
    setAuthorityId(id);
    if (initial) return;
    const a = authorities.find((x) => x.id === id);
    if (a) {
      setLevel(a.jurisdiction_level);
      setDomain(a.domain);
      setRegionIds(a.region_id ? [a.region_id] : []);
    }
  };

  const parentOptions = roles.filter((r) => r.id !== initial?.id);

  async function handleSave() {
    if (!roleName.trim()) return toast({ title: "Role name is required", variant: "destructive" });
    if (!authorityId) return toast({ title: "Choose the responsible institution", variant: "destructive" });
    try {
      await upsert.mutateAsync({
        id: initial?.id,
        role_name: roleName.trim(),
        authority_id: authorityId,
        government_level: level,
        domain,
        role_type: roleType,
        verification_status: status,
        region_id: regionIds[0] ?? null,
        parent_role_id: parentId === "none" ? null : parentId,
      });
      toast({ title: initial ? "Role updated" : "Role created" });
      onClose();
    } catch (err: any) {
      const duplicate = String(err?.message ?? "").includes("government_role_registry_unique_role");
      toast({
        title: "Save failed",
        description: duplicate ? "This institution already has a role with that name in that region." : err?.message,
        variant: "destructive",
      });
    }
  }

  return (
    <Modal title={initial ? "Edit Government Role" : "New Government Role"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Role / designation">
          <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Municipal Commissioner" />
        </Field>
        <Field label="Responsible institution">
          <Select value={authorityId} onValueChange={onAuthorityChange}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Choose an institution" /></SelectTrigger>
            <SelectContent>
              {authorities.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Government level"><SimpleSelect<GovernmentLevel> value={level} options={LEVELS} onChange={setLevel} /></Field>
          <Field label="Domain"><SimpleSelect<Domain> value={domain} options={DOMAINS} onChange={setDomain} /></Field>
          <Field label="Role type"><SimpleSelect<RoleType> value={roleType} options={ROLE_TYPES} onChange={setRoleType} /></Field>
          <Field label="Status"><SimpleSelect<VerificationStatus> value={status} options={STATUSES} onChange={setStatus} /></Field>
        </div>
        <Field label="Region" hint="optional">
          <RegionMultiSelect value={regionIds} onChange={(ids) => setRegionIds(ids.slice(-1))} placeholder="Select region" />
        </Field>
        <Field label="Reports to" hint="optional parent role">
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">None</SelectItem>
              {parentOptions.map((r) => (
                <SelectItem key={r.id} value={r.id} className="text-xs">{r.role_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <p className="text-[11px] text-slate-400">
          Only verified roles are visible outside the admin area. The office-holder is set separately, from the role
          list, and needs an official source.
        </p>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={upsert.isPending}>
          {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : initial ? "Save" : "Create"}
        </Button>
      </div>
    </Modal>
  );
}

// ── Office-holder dialog ───────────────────────────────────────────────────

function OfficeHolderDialog({ role, onClose }: { role: GovernmentRole; onClose: () => void }) {
  const { toast } = useToast();
  const setHolder = useSetHolder();
  const { data: history = [], isLoading: historyLoading } = useHolderHistory(role.id);

  const [name, setName] = React.useState(role.current_office_holder_name ?? "");
  const [sourceUrl, setSourceUrl] = React.useState(role.office_holder_source_url ?? "");
  const [validFrom, setValidFrom] = React.useState(role.valid_from ?? "");
  const [validTo, setValidTo] = React.useState(role.valid_to ?? "");
  const [reason, setReason] = React.useState<"replaced" | "corrected">("replaced");

  const samePerson =
    !!role.current_office_holder_name &&
    name.trim().toLowerCase() === role.current_office_holder_name.trim().toLowerCase();

  async function save(clear = false) {
    if (!clear) {
      if (!name.trim()) return toast({ title: "Enter the office-holder's name, or use Clear", variant: "destructive" });
      if (!/^https?:\/\//i.test(sourceUrl.trim()))
        return toast({ title: "An official source URL (https://…) is required", variant: "destructive" });
    }
    try {
      await setHolder.mutateAsync({
        roleId: role.id,
        name: clear ? null : name.trim(),
        sourceUrl: clear ? null : sourceUrl.trim(),
        validFrom: clear ? null : validFrom || null,
        validTo: clear ? null : validTo || null,
        reason,
      });
      toast({ title: clear ? "Office-holder cleared" : samePerson ? "Office-holder re-verified" : "Office-holder saved" });
      onClose();
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Modal title={`Office-holder — ${role.role_name}`} onClose={onClose}>
      <p className="text-[11px] text-slate-500 mb-3">
        The role is the identity; the person is optional, time-bounded metadata. A name is shown publicly only while it
        is verified from an official source and within its dates. Changing the holder keeps the previous one in the
        history below.
      </p>
      <div className="space-y-3">
        <Field label="Current office-holder">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name as on the official source" />
        </Field>
        <Field label="Official source URL">
          <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="In office from" hint="optional">
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label="In office until" hint="optional">
            <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </Field>
        </div>
        {role.current_office_holder_name && !samePerson && name.trim() && (
          <Field label="What changed?">
            <Select value={reason} onValueChange={(v) => setReason(v as "replaced" | "corrected")}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="replaced" className="text-xs">A new person took the office</SelectItem>
                <SelectItem value="corrected" className="text-xs">The stored name was wrong</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      <div className="flex justify-between gap-2 mt-5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => save(true)}
          disabled={setHolder.isPending || !role.current_office_holder_name}
        >
          Clear holder
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => save(false)} disabled={setHolder.isPending}>
            {setHolder.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : samePerson ? "Re-verify" : "Save"}
          </Button>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-3">
        <p className="text-xs font-medium text-slate-600 mb-2">Previous office-holders</p>
        {historyLoading ? (
          <p className="text-[11px] text-slate-400">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-[11px] text-slate-400">None recorded.</p>
        ) : (
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={h.id} className="text-[11px] text-slate-600 flex items-center justify-between gap-2">
                <span className="truncate">
                  {h.office_holder_name}
                  <span className="text-slate-400">
                    {" "}· {h.valid_from ?? "?"} – {h.valid_to ?? "?"} · {label(h.end_reason)}{" "}
                    {new Date(h.ended_at).toLocaleDateString()}
                  </span>
                </span>
                {h.source_url && (
                  <a href={h.source_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-700 shrink-0">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────

export function GovernmentRolesPanel({ authorities }: { authorities: RoleAuthority[] }) {
  const { toast } = useToast();
  const { data: roles = [], isLoading, error } = useGovernmentRoles();
  const deleteRole = useDeleteRole();
  const [editing, setEditing] = React.useState<GovernmentRole | "new" | null>(null);
  const [holderRole, setHolderRole] = React.useState<GovernmentRole | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [authorityFilter, setAuthorityFilter] = React.useState<string>("all");
  const [search, setSearch] = React.useState("");

  const authorityName = React.useMemo(() => new Map(authorities.map((a) => [a.id, a.name])), [authorities]);
  const roleName = React.useMemo(() => new Map(roles.map((r) => [r.id, r.role_name])), [roles]);

  const term = search.trim().toLowerCase();
  const visible = roles.filter(
    (r) =>
      (authorityFilter === "all" || r.authority_id === authorityFilter) &&
      (!term ||
        r.role_name.toLowerCase().includes(term) ||
        (r.current_office_holder_name ?? "").toLowerCase().includes(term) ||
        (authorityName.get(r.authority_id) ?? "").toLowerCase().includes(term))
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Government Roles</h2>
          <p className="text-[11px] text-slate-400">
            Stable offices linked to an institution. The office, not the person, is the identity.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setEditing("new")}
          className="gap-1.5"
          disabled={authorities.length === 0}
          title={authorities.length === 0 ? "Add an institution in Registry & Assignments first" : undefined}
        >
          <Plus className="h-3.5 w-3.5" /> Add role
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search roles, holders, institutions…" className="pl-8 h-9 text-xs" />
        </div>
        <Select value={authorityFilter} onValueChange={setAuthorityFilter}>
          <SelectTrigger className="h-9 text-xs w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All institutions</SelectItem>
            {authorities.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p className="text-xs text-red-600">Could not load roles: {(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-slate-400">
          {roles.length === 0 ? "No government roles yet." : "No roles match this filter."}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
          {visible.map((r) => {
            const current = holderIsCurrent(r);
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-800 truncate">
                    {r.role_name}
                    <span className="font-normal text-slate-400"> · {authorityName.get(r.authority_id) ?? "Unknown institution"}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    <span className={`text-[10px] rounded-full border px-1.5 py-0.5 capitalize ${STATUS_STYLES[r.verification_status]}`}>
                      {r.verification_status}
                    </span>
                    <Badge variant="outline" className="text-[10px] capitalize">{r.government_level}</Badge>
                    <Badge variant="secondary" className="text-[10px] capitalize">{r.domain}</Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{label(r.role_type)}</Badge>
                    {r.parent_role_id && (
                      <span className="text-[10px] text-slate-400">reports to {roleName.get(r.parent_role_id) ?? "—"}</span>
                    )}
                  </div>
                  <p className="text-[11px] mt-1 text-slate-500">
                    {r.current_office_holder_name ? (
                      <>
                        Held by <span className="font-medium text-slate-700">{r.current_office_holder_name}</span>
                        {r.office_holder_verified_at && (
                          <span className="text-slate-400"> · verified {new Date(r.office_holder_verified_at).toLocaleDateString()}</span>
                        )}
                        {!current && <span className="text-amber-600"> · not shown publicly (outside its dates)</span>}
                      </>
                    ) : (
                      <span className="text-slate-400">No verified office-holder</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setHolderRole(r)} className="text-slate-400 hover:text-slate-700 p-1" title="Office-holder">
                    <UserRound className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setEditing(r)} className="text-slate-400 hover:text-slate-700 p-1" title="Edit role">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {confirmDeleteId === r.id ? (
                    <button
                      onClick={async () => {
                        try {
                          await deleteRole.mutateAsync(r.id);
                          toast({ title: "Role deleted" });
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
                    <button onClick={() => setConfirmDeleteId(r.id)} className="text-slate-400 hover:text-red-600 p-1" title="Delete role">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <RoleFormDialog
          key={editing === "new" ? "new" : editing.id}
          editing={editing}
          authorities={authorities}
          roles={roles}
          onClose={() => setEditing(null)}
        />
      )}
      {holderRole && <OfficeHolderDialog key={holderRole.id} role={holderRole} onClose={() => setHolderRole(null)} />}
    </div>
  );
}
