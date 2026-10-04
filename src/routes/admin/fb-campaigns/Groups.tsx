// src/routes/admin/fb-campaigns/Groups.tsx
// Reviewed directory of city Facebook groups (PDD v1.2 §6, §12).
//
// There is no Groups API (retired April 2024): an admin finds a group on
// Facebook, joins it there, reads its rules, and records it here. "Find groups"
// only builds search phrases and opens Facebook search; nothing is scraped.

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, ExternalLink, Search, BadgeCheck } from "lucide-react";
import { useIdentities } from "./Identities";
import {
  Group, Lean, LinkPolicy, Membership, PageHeader, Modal, Field, Pill, Loading, ErrorBox,
  inputCls, btnPrimary, btnSecondary, insertRow, updateRows, errMsg, fmtDate, currentUserId,
  LEAN_LABEL, LINK_POLICY_LABEL, MEMBERSHIP_LABEL, LANGS,
} from "./shared";

interface LocationRow { id: string; name: string; type: string; parent_name?: string | null }
interface TopicRow { id: string; title: string }

export function useGroups() {
  return useQuery<Group[]>({
    queryKey: ["fb-groups"],
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_group_directory")
        .select("*, locations(name, type)")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Group[];
    },
  });
}

function useTopics(ids: string[]) {
  return useQuery<TopicRow[]>({
    queryKey: ["fb-topics-by-id", [...ids].sort().join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("topics").select("id, title").in("id", ids);
      if (error) throw error;
      return (data ?? []) as TopicRow[];
    },
  });
}

export function LocationPicker({ value, label, onChange }: {
  value: string | null; label: string | null; onChange: (id: string, label: string) => void;
}) {
  const [q, setQ] = React.useState("");
  const [rows, setRows] = React.useState<LocationRow[]>([]);
  React.useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      const { data } = await (supabase as any).from("locations")
        .select("id, name, type, parent:parent_id(name)")
        .in("type", ["city", "county", "state"])
        .ilike("name", `${q.trim()}%`).limit(12);
      if (!cancelled) setRows((data ?? []).map((r: any) => ({ id: r.id, name: r.name, type: r.type, parent_name: r.parent?.name })));
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [q]);
  return (
    <div className="space-y-1.5">
      {value && <div className="text-xs text-slate-700">Selected: <span className="font-medium">{label}</span></div>}
      <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a city, e.g. Pune" />
      {rows.length > 0 && (
        <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
          {rows.map((r) => (
            <button key={r.id} type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50"
              onClick={() => { onChange(r.id, `${r.name} (${r.type}${r.parent_name ? `, ${r.parent_name}` : ""})`); setQ(""); setRows([]); }}>
              {r.name} <span className="text-slate-400">{r.type}{r.parent_name ? ` · ${r.parent_name}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TopicPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { data: selected } = useTopics(value);
  const [q, setQ] = React.useState("");
  const [rows, setRows] = React.useState<TopicRow[]>([]);
  React.useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      const { data } = await (supabase as any).from("topics").select("id, title").ilike("title", `%${q.trim()}%`).limit(10);
      if (!cancelled) setRows(data ?? []);
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [q]);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {(selected ?? []).map((t) => (
          <button key={t.id} type="button" onClick={() => onChange(value.filter((v) => v !== t.id))}
            className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] text-blue-700">
            {t.title} ×
          </button>
        ))}
      </div>
      <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a topic tag" />
      {rows.length > 0 && (
        <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-40 overflow-y-auto">
          {rows.map((r) => (
            <button key={r.id} type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50"
              onClick={() => { if (!value.includes(r.id)) onChange([...value, r.id]); setQ(""); setRows([]); }}>
              {r.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupModal({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: identities } = useIdentities();
  const [name, setName] = React.useState(group?.name ?? "");
  const [url, setUrl] = React.useState(group?.url ?? "");
  const [locationId, setLocationId] = React.useState<string | null>(group?.location_id ?? null);
  const [locationLabel, setLocationLabel] = React.useState<string | null>(group?.locations ? `${group.locations.name} (${group.locations.type})` : null);
  const [langs, setLangs] = React.useState<string[]>(group?.language_codes ?? ["en"]);
  const [topics, setTopics] = React.useState<string[]>(group?.topic_ids ?? []);
  const [lean, setLean] = React.useState<Lean>(group?.lean ?? "general");
  const [linkPolicy, setLinkPolicy] = React.useState<LinkPolicy>(group?.link_policy ?? "unknown");
  const [membership, setMembership] = React.useState<Membership>(group?.membership_status ?? "not_joined");
  const [approval, setApproval] = React.useState(group?.requires_post_approval ?? false);
  const [allowed, setAllowed] = React.useState<string[]>(group?.allowed_identity_ids ?? []);
  const [rulesReviewed, setRulesReviewed] = React.useState(group?.rules_reviewed ?? false);
  const [rules, setRules] = React.useState(group?.rules_notes ?? "");
  const [cap, setCap] = React.useState(String(group?.posting_cap_per_campaign ?? 1));
  const [members, setMembers] = React.useState(group?.member_count_approx ? String(group.member_count_approx) : "");
  const [enabled, setEnabled] = React.useState(group?.enabled ?? true);
  const [verifiedNow, setVerifiedNow] = React.useState(!group);
  const [notes, setNotes] = React.useState(group?.notes ?? "");

  const urlOk = /^https:\/\/([a-z0-9-]+\.)?facebook\.com\/groups\//i.test(url.trim());

  const save = useMutation({
    mutationFn: async () => {
      const row: Record<string, unknown> = {
        name: name.trim(), url: url.trim(), location_id: locationId, language_codes: langs, topic_ids: topics,
        lean, link_policy: linkPolicy, membership_status: membership, requires_post_approval: approval,
        allowed_identity_ids: allowed, rules_reviewed: rulesReviewed, rules_notes: rules.trim() || null,
        posting_cap_per_campaign: Number(cap), member_count_approx: members ? Number(members) : null,
        enabled, notes: notes.trim() || null,
      };
      if (verifiedNow) {
        row.last_verified_at = new Date().toISOString();
        row.last_verified_by = currentUserId();
      }
      if (group) await updateRows("social_group_directory", `id=eq.${group.id}`, row);
      else await insertRow("social_group_directory", row);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-groups"] }); onClose(); },
    onError: (e) => toast({
      title: "Could not save group",
      description: /url_uniq/.test(errMsg(e)) ? "This group is already in the directory." : errMsg(e),
      variant: "destructive",
    }),
  });

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <Modal
      wide
      title={group ? `Edit ${group.name}` : "Register a group"}
      onClose={onClose}
      footer={<>
        <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary}
          disabled={!name.trim() || !urlOk || !locationId || langs.length === 0 || save.isPending}
          onClick={() => save.mutate()}>Save</button>
      </>}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Group name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Facebook URL" hint={url && !urlOk ? "Must be https://www.facebook.com/groups/…" : undefined}>
          <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.facebook.com/groups/…" />
        </Field>
        <Field label="City or region"><LocationPicker value={locationId} label={locationLabel} onChange={(id, l) => { setLocationId(id); setLocationLabel(l); }} /></Field>
        <Field label="Topic tags"><TopicPicker value={topics} onChange={setTopics} /></Field>
        <Field label="Languages used in the group">
          <div className="flex gap-3">
            {LANGS.map((l) => (
              <label key={l.code} className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={langs.includes(l.code)} onChange={() => setLangs(toggle(langs, l.code))} /> {l.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Lean (admin assessment)" hint="Partisan or advocacy groups are excluded by default and need a recorded override per campaign.">
          <select className={inputCls} value={lean} onChange={(e) => setLean(e.target.value as Lean)}>
            {(Object.keys(LEAN_LABEL) as Lean[]).map((k) => <option key={k} value={k}>{LEAN_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Link policy" hint="Groups that ban links get a text-only invitation, only if you confirm that is permitted.">
          <select className={inputCls} value={linkPolicy} onChange={(e) => setLinkPolicy(e.target.value as LinkPolicy)}>
            {(Object.keys(LINK_POLICY_LABEL) as LinkPolicy[]).map((k) => <option key={k} value={k}>{LINK_POLICY_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Membership">
          <select className={inputCls} value={membership} onChange={(e) => setMembership(e.target.value as Membership)}>
            {(Object.keys(MEMBERSHIP_LABEL) as Membership[]).map((k) => <option key={k} value={k}>{MEMBERSHIP_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Posts per campaign (cap)" hint="Suggested starting cap: 1. Confirm against the group's rules.">
          <input type="number" min={1} max={7} className={inputCls} value={cap} onChange={(e) => setCap(e.target.value)} />
        </Field>
        <Field label="Approximate members (optional)">
          <input type="number" min={0} className={inputCls} value={members} onChange={(e) => setMembers(e.target.value)} />
        </Field>
      </div>

      <Field label="Who may post here" hint="None ticked = any active personal profile.">
        <div className="flex flex-wrap gap-3">
          {(identities ?? []).map((i) => (
            <label key={i.id} className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={allowed.includes(i.id)} onChange={() => setAllowed(toggle(allowed, i.id))} />
              {i.label} <span className="text-slate-400">({i.kind})</span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Group rules (summary)">
        <textarea className={inputCls} rows={3} value={rules} onChange={(e) => setRules(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={rulesReviewed} onChange={(e) => setRulesReviewed(e.target.checked)} /> Rules reviewed</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> Posts need group-admin approval</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={verifiedNow} onChange={(e) => setVerifiedNow(e.target.checked)} /> I verified membership, rules and link policy today</label>
      </div>
      <Field label="Notes"><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}

function FindGroupsModal({ onClose }: { onClose: () => void }) {
  const [city, setCity] = React.useState("Pune");
  const [topic, setTopic] = React.useState("");
  const phrases = React.useMemo(() => {
    const c = city.trim();
    if (!c) return [];
    const t = topic.trim();
    const base = [`${c}`, `${c} citizens`, `${c} community`, `${c} residents`, `${c} news`];
    const topical = t ? [`${c} ${t}`, `${t} ${c}`, `${c} ${t} forum`] : [];
    return [...topical, ...base];
  }, [city, topic]);
  return (
    <Modal title="Find groups on Facebook" onClose={onClose}
      footer={<button type="button" className={btnSecondary} onClick={onClose}>Done</button>}>
      <p className="text-xs text-slate-500">
        Opens Facebook's own group search in a new tab. Join and review each group on Facebook, then register the ones that fit.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City"><input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        <Field label="Topic (optional)"><input className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. traffic" /></Field>
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {phrases.map((p) => (
          <a key={p} href={`https://www.facebook.com/search/groups/?q=${encodeURIComponent(p)}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
            {p} <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
          </a>
        ))}
      </div>
    </Modal>
  );
}

export default function FbGroupsPage() {
  const { data, isLoading, isError } = useGroups();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<Group | null | "new">(null);
  const [finding, setFinding] = React.useState(false);
  const [filter, setFilter] = React.useState("");

  const verify = useMutation({
    mutationFn: async (g: Group) => {
      await updateRows("social_group_directory", `id=eq.${g.id}`, {
        last_verified_at: new Date().toISOString(), last_verified_by: currentUserId(),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fb-groups"] }),
    onError: (e) => toast({ title: "Could not update", description: errMsg(e), variant: "destructive" }),
  });

  const rows = (data ?? []).filter((g) =>
    !filter.trim() || `${g.name} ${g.locations?.name ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader
        title="City groups"
        sub="Groups you have joined and reviewed on Facebook. A group is eligible for campaigns only when you are a member, its rules are reviewed, its link policy is known, and it is not partisan (unless overridden per campaign)."
        action={<div className="flex gap-2 shrink-0">
          <button type="button" className={btnSecondary} onClick={() => setFinding(true)}><Search className="h-3.5 w-3.5" /> Find groups</button>
          <button type="button" className={btnPrimary} onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" /> Register group</button>
        </div>}
      />
      <input className={`${inputCls} max-w-xs`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or city" />
      {isLoading && <Loading />}
      {isError && <ErrorBox>Failed to load groups.</ErrorBox>}
      <div className="space-y-2">
        {rows.map((g) => {
          const stale = !g.last_verified_at || Date.now() - new Date(g.last_verified_at).getTime() > 30 * 86400_000;
          return (
            <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-4 flex items-start justify-between gap-4">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={g.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-slate-900 hover:underline">{g.name}</a>
                  <span className="text-xs text-slate-400">{g.locations?.name}</span>
                  {!g.enabled && <Pill tone="amber">Disabled</Pill>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Pill tone={g.lean === "general" ? "slate" : g.lean === "interest" ? "amber" : "red"}>{LEAN_LABEL[g.lean]}</Pill>
                  <Pill tone={g.membership_status === "member" ? "green" : "amber"}>{MEMBERSHIP_LABEL[g.membership_status]}</Pill>
                  <Pill tone={g.link_policy === "unknown" ? "amber" : "slate"}>{LINK_POLICY_LABEL[g.link_policy]}</Pill>
                  {!g.rules_reviewed && <Pill tone="amber">Rules not reviewed</Pill>}
                  {g.requires_post_approval && <Pill>Posts need approval</Pill>}
                  <Pill>{g.language_codes.join(", ")}</Pill>
                  <Pill>Cap {g.posting_cap_per_campaign}/campaign</Pill>
                </div>
                <p className={`text-[11px] ${stale ? "text-amber-600" : "text-slate-400"}`}>Last verified {fmtDate(g.last_verified_at)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" className={btnSecondary} onClick={() => verify.mutate(g)} title="I checked membership, rules and link policy today">
                  <BadgeCheck className="h-3.5 w-3.5" /> Mark verified
                </button>
                <button type="button" className={btnSecondary} onClick={() => setEditing(g)}><Pencil className="h-3.5 w-3.5" /> Edit</button>
              </div>
            </div>
          );
        })}
        {data && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No groups yet.</div>
        )}
      </div>
      {editing && <GroupModal group={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {finding && <FindGroupsModal onClose={() => setFinding(false)} />}
    </div>
  );
}
