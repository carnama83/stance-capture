// src/routes/admin/fb-campaigns/Identities.tsx
// Who posts: the Stance Capture Page and the named people whose profiles post
// in groups. Labels only; no Facebook credentials are ever stored (PDD §3).
// Recording a Facebook warning pauses every group task for that identity (§5).

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, ShieldAlert, ShieldCheck, Pencil } from "lucide-react";
import {
  Identity, PageHeader, Modal, Field, Pill, Loading, ErrorBox,
  inputCls, btnPrimary, btnSecondary, insertRow, updateRows, errMsg, fmtDate, useAsk,
} from "./shared";

export function useIdentities() {
  return useQuery<Identity[]>({
    queryKey: ["fb-identities"],
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_posting_identities").select("*").order("kind").order("label");
      if (error) throw error;
      return (data ?? []) as Identity[];
    },
  });
}

function IdentityModal({ identity, onClose }: { identity: Identity | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [label, setLabel] = React.useState(identity?.label ?? "");
  const [kind, setKind] = React.useState<Identity["kind"]>(identity?.kind ?? "profile");
  const [url, setUrl] = React.useState(identity?.profile_url ?? "");
  const [cap, setCap] = React.useState(String(identity?.daily_group_post_cap ?? 5));
  const [gap, setGap] = React.useState(String(identity?.min_gap_minutes ?? 30));
  const [active, setActive] = React.useState(identity?.active ?? true);
  const [notes, setNotes] = React.useState(identity?.notes ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        label: label.trim(), kind, profile_url: url.trim() || null,
        daily_group_post_cap: Number(cap), min_gap_minutes: Number(gap), active, notes: notes.trim() || null,
      };
      if (identity) await updateRows("social_posting_identities", `id=eq.${identity.id}`, row);
      else await insertRow("social_posting_identities", row);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-identities"] }); onClose(); },
    onError: (e) => toast({ title: "Could not save", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Modal
      title={identity ? "Edit identity" : "New posting identity"}
      onClose={onClose}
      footer={<>
        <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={!label.trim() || save.isPending} onClick={() => save.mutate()}>Save</button>
      </>}
    >
      <Field label="Label" hint="e.g. 'Stance Capture Page' or the person's first name.">
        <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Kind">
        <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as Identity["kind"])}>
          <option value="page">Facebook Page</option>
          <option value="profile">Personal profile</option>
        </select>
      </Field>
      <Field label="Profile or Page URL (optional)">
        <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.facebook.com/…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Group posts per day" hint="Across all campaigns. Proposed default 5.">
          <input type="number" min={1} max={20} className={inputCls} value={cap} onChange={(e) => setCap(e.target.value)} />
        </Field>
        <Field label="Minimum gap (minutes)" hint="Between two group posts. Default 30.">
          <input type="number" min={0} max={720} className={inputCls} value={gap} onChange={(e) => setGap(e.target.value)} />
        </Field>
      </div>
      <p className="text-[11px] text-slate-400">These are operating guardrails, not guarantees against Facebook restrictions.</p>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
      </label>
      <Field label="Notes">
        <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}

export default function FbIdentitiesPage() {
  const [ask, dialog] = useAsk();
  const { data, isLoading, isError } = useIdentities();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<Identity | null | "new">(null);

  const restrict = useMutation({
    mutationFn: async ({ i, on }: { i: Identity; on: boolean }) => {
      let note: string | null = null;
      if (on) {
        note = await ask({ title: `Record a restriction for ${i.label}`, message: "All group tasks for this identity pause until the restriction is cleared.", label: "What did Facebook say?", required: true });
        if (note === null) return;
      }
      await updateRows("social_posting_identities", `id=eq.${i.id}`, {
        restricted_at: on ? new Date().toISOString() : null,
        restriction_note: on ? note || "restriction recorded" : null,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fb-identities"] }),
    onError: (e) => toast({ title: "Could not update", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Posting identities"
        sub="The Page and the people who post in groups. Limits apply across every campaign. No Facebook passwords or tokens are stored here."
        action={<button type="button" className={btnPrimary} onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" /> New identity</button>}
      />
      {isLoading && <Loading />}
      {isError && <ErrorBox>Failed to load identities.</ErrorBox>}
      <div className="space-y-2">
        {(data ?? []).map((i) => (
          <div key={i.id} className="rounded-xl border border-slate-200 bg-white p-4 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-slate-900">{i.label}</span>
                <Pill>{i.kind === "page" ? "Page" : "Profile"}</Pill>
                {!i.active && <Pill tone="amber">Inactive</Pill>}
                {i.restricted_at && <Pill tone="red">Restricted since {fmtDate(i.restricted_at)}</Pill>}
              </div>
              <p className="text-xs text-slate-500">
                Up to {i.daily_group_post_cap} group posts a day, at least {i.min_gap_minutes} minutes apart.
              </p>
              {i.restriction_note && <p className="text-xs text-red-600">{i.restriction_note}</p>}
            </div>
            <div className="flex gap-2 shrink-0">
              {i.restricted_at ? (
                <button type="button" className={btnSecondary} onClick={() => restrict.mutate({ i, on: false })}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Clear restriction
                </button>
              ) : (
                <button type="button" className={btnSecondary} onClick={() => restrict.mutate({ i, on: true })}>
                  <ShieldAlert className="h-3.5 w-3.5" /> Record restriction
                </button>
              )}
              <button type="button" className={btnSecondary} onClick={() => setEditing(i)}><Pencil className="h-3.5 w-3.5" /> Edit</button>
            </div>
          </div>
        ))}
        {data && data.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
            No identities yet. Add the Page and at least one person who will post in groups.
          </div>
        )}
      </div>
      {dialog}
      {editing && <IdentityModal identity={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
