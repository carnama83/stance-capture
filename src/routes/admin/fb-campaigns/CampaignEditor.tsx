// src/routes/admin/fb-campaigns/CampaignEditor.tsx
// One campaign: settings, matched groups, neutral caption variants, schedule
// preview, activation / re-plan, lifecycle, and results.
//
// Activation is blocked server-side (admin_plan_social_campaign) until every
// caption variant has a recorded neutrality check (AC11), no two group tasks
// within 24h share caption text (AC13), and a lean-skewed group selection has
// been acknowledged (PDD §4). Edits only replace future unclaimed tasks.

import * as React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Sparkles, Plus, Check, X, Archive, Eye, Rocket, Pause, Play, Ban, RefreshCw, AlertTriangle, Save,
} from "lucide-react";
import { useIdentities } from "./Identities";
import CampaignResults from "./Results";
import {
  Campaign, CaptionVariant, PlanResult, Pill, Field, Loading, ErrorBox, FbNav, campaignTone,
  inputCls, btnPrimary, btnSecondary, btnDanger, rpc, insertRow, updateRows, deleteRows, callEdge,
  errMsg, siteOrigin, useAsk, LEAN_LABEL, LANGS,
} from "./shared";

interface MatchRow {
  group_id: string;
  name: string;
  url: string;
  location_name: string;
  lean: "general" | "interest" | "partisan";
  link_policy: string;
  membership_status: string;
  language_codes: string[];
  match_tier: number;
  eligible: boolean;
  excluded_reason: string | null;
  reasons: string[];
}

interface SelectedGroup {
  group_id: string;
  match_tier: number | null;
  partisan_override_reason: string | null;
}

const PURPOSE_LABEL: Record<CaptionVariant["purpose"], string> = {
  invitation: "Opening invitation",
  context: "Issue context",
  reminder: "Participation reminder",
  closing: "Closing reminder",
};

function useCampaign(id: string) {
  return useQuery<Campaign>({
    queryKey: ["fb-campaign", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_campaigns").select("*, questions(question)").eq("id", id).single();
      if (error) throw error;
      return data as Campaign;
    },
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsSection({ c, editable }: { c: Campaign; editable: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: identities } = useIdentities();
  const [name, setName] = React.useState(c.name);
  const [start, setStart] = React.useState(c.start_date);
  const [days, setDays] = React.useState(String(c.duration_days));
  const [slots, setSlots] = React.useState(c.daily_slots.map((s) => s.slice(0, 5)).join(", "));
  const [langs, setLangs] = React.useState<string[]>(c.language_codes);
  const [includePage, setIncludePage] = React.useState(c.include_page);
  const [pageIdentity, setPageIdentity] = React.useState(c.page_identity_id ?? "");
  const [pagePerDay, setPagePerDay] = React.useState(String(c.page_posts_per_day));
  const [perGroup, setPerGroup] = React.useState(String(c.group_posts_per_group));

  const slotList = slots.split(/[,\s]+/).filter(Boolean);
  const slotsOk = slotList.length >= 1 && slotList.length <= 6 && slotList.every((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s));

  const save = useMutation({
    mutationFn: () => updateRows("social_campaigns", `id=eq.${c.id}`, {
      name: name.trim(), start_date: start, duration_days: Number(days), daily_slots: slotList, language_codes: langs,
      include_page: includePage, page_identity_id: includePage && pageIdentity ? pageIdentity : null,
      page_posts_per_day: Number(pagePerDay), group_posts_per_group: Number(perGroup),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fb-campaign", c.id] });
      toast({ title: "Settings saved", description: c.status === "draft" ? "Preview the schedule to see the effect." : "Re-plan to apply them to future tasks." });
    },
    onError: (e) => toast({ title: "Could not save", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <h2 className="text-sm font-semibold text-slate-900">Settings</h2>
      <fieldset disabled={!editable} className="space-y-4">
        <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Start date"><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Days"><input type="number" min={1} max={30} className={inputCls} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
          <Field label="Daily slots (Asia/Kolkata)" hint={slotsOk ? undefined : "HH:MM, comma separated, 1 to 6."}>
            <input className={inputCls} value={slots} onChange={(e) => setSlots(e.target.value)} />
          </Field>
          <Field label="Posts per group"><input type="number" min={1} max={7} className={inputCls} value={perGroup} onChange={(e) => setPerGroup(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-4 items-end">
          <Field label="Languages">
            <div className="flex gap-3 pt-1">
              {LANGS.map((l) => (
                <label key={l.code} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={langs.includes(l.code)}
                    onChange={() => setLangs(langs.includes(l.code) ? langs.filter((x) => x !== l.code) : [...langs, l.code])} />
                  {l.label}
                </label>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-600 pb-1">
            <input type="checkbox" checked={includePage} onChange={(e) => setIncludePage(e.target.checked)} /> Post on the Page
          </label>
          <Field label="Page identity">
            <select className={inputCls} disabled={!includePage} value={pageIdentity} onChange={(e) => setPageIdentity(e.target.value)}>
              <option value="">—</option>
              {(identities ?? []).filter((i) => i.kind === "page").map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </Field>
          <Field label="Page posts per day">
            <input type="number" min={0} max={6} disabled={!includePage} className={`${inputCls} w-24`} value={pagePerDay} onChange={(e) => setPagePerDay(e.target.value)} />
          </Field>
        </div>
        {Number(pagePerDay) > 1 && includePage && (
          <p className="text-[11px] text-amber-600">More than one Page post a day tends to reduce reach per post.</p>
        )}
        {editable && (
          <button type="button" className={btnSecondary} disabled={!slotsOk || langs.length === 0 || save.isPending} onClick={() => save.mutate()}>
            <Save className="h-3.5 w-3.5" /> Save settings
          </button>
        )}
      </fieldset>
    </section>
  );
}

// ─── Groups ───────────────────────────────────────────────────────────────────

function GroupsSection({ c, editable }: { c: Campaign; editable: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [ask, dialog] = useAsk();
  const matches = useQuery<MatchRow[]>({
    queryKey: ["fb-match", c.question_id],
    queryFn: () => rpc<MatchRow[]>("admin_match_social_groups", { p_question_id: c.question_id }),
  });
  const selected = useQuery<SelectedGroup[]>({
    queryKey: ["fb-campaign-groups", c.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_campaign_groups").select("group_id, match_tier, partisan_override_reason").eq("campaign_id", c.id);
      if (error) throw error;
      return data ?? [];
    },
  });
  const sel = new Map((selected.data ?? []).map((s) => [s.group_id, s]));

  const toggle = useMutation({
    mutationFn: async (m: MatchRow) => {
      if (sel.has(m.group_id)) {
        await deleteRows("social_campaign_groups", `campaign_id=eq.${c.id}&group_id=eq.${m.group_id}`);
        return;
      }
      let reason: string | null = null;
      if (m.lean === "partisan") {
        reason = await ask({
          title: `Include ${m.name}?`,
          message: "This group is partisan or advocacy and is excluded by default. The reason is recorded with the campaign.",
          label: "Reason for including it", required: true, confirmLabel: "Include",
        });
        if (!reason) return;
      }
      await insertRow("social_campaign_groups", {
        campaign_id: c.id, group_id: m.group_id, match_tier: m.match_tier, partisan_override_reason: reason,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fb-campaign-groups", c.id] }),
    onError: (e) => toast({ title: "Could not update groups", description: errMsg(e), variant: "destructive" }),
  });

  const rows = matches.data ?? [];
  const chosen = rows.filter((r) => sel.has(r.group_id));
  const skewed = chosen.filter((r) => r.lean !== "general").length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Groups</h2>
        <Link to="/admin/fb-campaigns/groups" className="text-xs text-blue-600 hover:underline">Manage directory</Link>
      </div>
      <p className="text-xs text-slate-500">
        Suggested by city first, then topic and language. Ineligible groups show why. Partisan groups need a recorded override.
      </p>
      {chosen.length > 0 && skewed / chosen.length > 0.5 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {skewed} of {chosen.length} selected groups are interest-specific or partisan. Topic-matched groups can over-represent one side; you will be asked to acknowledge this before activating.
        </div>
      )}
      {matches.isLoading && <Loading />}
      {matches.isError && <ErrorBox>{errMsg(matches.error)}</ErrorBox>}
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rows.map((m) => {
          const on = sel.has(m.group_id);
          // Partisan is the only exclusion an admin can override from here.
          const canAdd = m.eligible || m.excluded_reason === "partisan (override required)";
          return (
            <div key={m.group_id} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-900 hover:underline">{m.name}</a>
                  <Pill tone={m.match_tier === 1 ? "green" : m.match_tier === 2 ? "blue" : "slate"}>Tier {m.match_tier}</Pill>
                  <Pill tone={m.lean === "general" ? "slate" : m.lean === "interest" ? "amber" : "red"}>{LEAN_LABEL[m.lean]}</Pill>
                  {m.excluded_reason && <Pill tone="amber">{m.excluded_reason}</Pill>}
                  {on && sel.get(m.group_id)?.partisan_override_reason && <Pill tone="red">Override: {sel.get(m.group_id)?.partisan_override_reason}</Pill>}
                </div>
                <p className="text-[11px] text-slate-400">{m.reasons.join(" · ")}</p>
              </div>
              {editable && (on || canAdd) && (
                <button type="button" className={on ? btnSecondary : btnPrimary} disabled={toggle.isPending} onClick={() => toggle.mutate(m)}>
                  {on ? <><X className="h-3.5 w-3.5" /> Remove</> : <><Plus className="h-3.5 w-3.5" /> Add</>}
                </button>
              )}
            </div>
          );
        })}
        {!matches.isLoading && rows.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-slate-400">No registered groups in or near this question's city.</div>
        )}
      </div>
      {dialog}
    </section>
  );
}

// ─── Captions ─────────────────────────────────────────────────────────────────

function VariantCard({ v, editable }: { v: CaptionVariant; editable: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [ask, dialog] = useAsk();
  const [body, setBody] = React.useState(v.body);
  React.useEffect(() => setBody(v.body), [v.body]);
  const dirty = body.trim() !== v.body.trim();
  const refresh = () => qc.invalidateQueries({ queryKey: ["fb-variants", v.campaign_id] });
  const onErr = (e: unknown) => toast({ title: "Could not update caption", description: errMsg(e), variant: "destructive" });

  const saveBody = useMutation({
    mutationFn: () => updateRows("social_campaign_caption_variants", `id=eq.${v.id}`, { body: body.trim() }),
    onSuccess: refresh, onError: onErr,
  });
  const check = useMutation({
    mutationFn: async (result: "pass" | "fail") => {
      let notes: string | null = null;
      if (result === "fail") {
        notes = await ask({ title: `Mark ${v.label} not neutral`, label: "What makes it non-neutral?", required: true });
        if (notes === null) return;
      }
      await rpc("admin_set_caption_neutrality", { p_variant_id: v.id, p_result: result, p_notes: notes });
    },
    onSuccess: refresh, onError: onErr,
  });
  const retire = useMutation({
    mutationFn: () => updateRows("social_campaign_caption_variants", `id=eq.${v.id}`, { status: "retired" }),
    onSuccess: refresh, onError: onErr,
  });

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${v.status === "approved" ? "border-emerald-200" : v.neutrality_result === "fail" ? "border-red-200" : "border-slate-200"}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-700">{v.label}</span>
        <Pill>{PURPOSE_LABEL[v.purpose]}</Pill>
        {v.status === "approved" && <Pill tone="green">Neutral · approved</Pill>}
        {v.neutrality_result === "fail" && <Pill tone="red">Not neutral</Pill>}
        {v.status === "draft" && !v.neutrality_checked_at && <Pill tone="amber">Neutrality not checked</Pill>}
        {v.ai_model && <span className="text-[10px] text-slate-400">AI draft ({v.ai_model})</span>}
      </div>
      <textarea className={inputCls} rows={4} value={body} disabled={!editable} onChange={(e) => setBody(e.target.value)} />
      {v.neutrality_notes && <p className="text-[11px] text-red-600">{v.neutrality_notes}</p>}
      {editable && (
        <div className="flex flex-wrap gap-2">
          {dirty && (
            <button type="button" className={btnSecondary} disabled={saveBody.isPending || body.trim().length < 10} onClick={() => saveBody.mutate()}>
              <Save className="h-3.5 w-3.5" /> Save edit (resets the check)
            </button>
          )}
          {!dirty && (
            <>
              <button type="button" className={btnSecondary} disabled={check.isPending} onClick={() => check.mutate("pass")}
                title="It describes the issue and invites a stance without framing a side as right, implying a majority, or urging a direction.">
                <Check className="h-3.5 w-3.5" /> Neutral
              </button>
              <button type="button" className={btnSecondary} disabled={check.isPending} onClick={() => check.mutate("fail")}>
                <X className="h-3.5 w-3.5" /> Not neutral
              </button>
            </>
          )}
          <button type="button" className={btnSecondary} disabled={retire.isPending} onClick={() => retire.mutate()}>
            <Archive className="h-3.5 w-3.5" /> Retire
          </button>
        </div>
      )}
      {dialog}
    </div>
  );
}

function CaptionsSection({ c, editable }: { c: Campaign; editable: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showRetired, setShowRetired] = React.useState(false);
  const variants = useQuery<CaptionVariant[]>({
    queryKey: ["fb-variants", c.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_campaign_caption_variants").select("*").eq("campaign_id", c.id).order("language_code").order("label");
      if (error) throw error;
      return data ?? [];
    },
  });

  const draft = useMutation({
    mutationFn: () => callEdge("admin-draft-social-captions", { campaign_id: c.id, count_per_language: 4 }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["fb-variants", c.id] });
      const failed = Object.entries(r?.results ?? {}).filter(([, v]: any) => !v.ok);
      if (failed.length) toast({ title: "Some languages failed", description: failed.map(([l, v]: any) => `${l}: ${v.error}`).join("; "), variant: "destructive" });
      else toast({ title: "Drafts added", description: "Edit each one and record the neutrality check." });
    },
    onError: (e) => toast({ title: "Drafting failed", description: errMsg(e), variant: "destructive" }),
  });

  const addManual = useMutation({
    mutationFn: async (lang: string) => {
      const n = (variants.data ?? []).filter((v) => v.language_code === lang).length + 1;
      await insertRow("social_campaign_caption_variants", {
        campaign_id: c.id, language_code: lang, label: `${lang.toUpperCase()}-M${n}`, purpose: "invitation",
        body: "Write a neutral invitation to share a stance on this question.",
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fb-variants", c.id] }),
    onError: (e) => toast({ title: "Could not add", description: errMsg(e), variant: "destructive" }),
  });

  const list = (variants.data ?? []).filter((v) => showRetired || v.status !== "retired");

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-900">Caption variants</h2>
        {editable && (
          <div className="flex gap-2">
            <button type="button" className={btnPrimary} disabled={draft.isPending} onClick={() => draft.mutate()}>
              <Sparkles className="h-3.5 w-3.5" /> {draft.isPending ? "Drafting…" : "Draft with AI"}
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Captions describe the issue and invite a stance. They must not frame one position as correct, imply a majority, urge a direction, or suggest the question closes.
        The tracked link is added automatically. Each group task gets a different variant, so add enough to cover your groups.
      </p>
      {variants.isLoading && <Loading />}
      {c.language_codes.map((lang) => (
        <div key={lang} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{LANGS.find((l) => l.code === lang)?.label ?? lang}</h3>
            {editable && (
              <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => addManual.mutate(lang)}>+ Add manually</button>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {list.filter((v) => v.language_code === lang).map((v) => <VariantCard key={v.id} v={v} editable={editable && v.status !== "retired"} />)}
          </div>
        </div>
      ))}
      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired
      </label>
    </section>
  );
}

// ─── Schedule preview + activation ────────────────────────────────────────────

function ScheduleSection({ c }: { c: Campaign }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [plan, setPlan] = React.useState<PlanResult | null>(null);
  const [ack, setAck] = React.useState(false);
  const canPlan = c.status === "draft" || c.status === "active" || c.status === "paused";

  const preview = useMutation({
    mutationFn: () => rpc<PlanResult>("admin_plan_social_campaign", {
      p_campaign_id: c.id, p_commit: false, p_site_origin: siteOrigin(), p_acknowledge_balance: ack,
    }),
    onSuccess: setPlan,
    onError: (e) => toast({ title: "Preview failed", description: errMsg(e), variant: "destructive" }),
  });
  const commit = useMutation({
    mutationFn: () => rpc<PlanResult>("admin_plan_social_campaign", {
      p_campaign_id: c.id, p_commit: true, p_site_origin: siteOrigin(), p_acknowledge_balance: ack,
    }),
    onSuccess: (r) => {
      setPlan(r);
      if (r.committed) {
        toast({ title: c.status === "draft" ? "Campaign activated" : "Schedule updated", description: `${r.counts.page_posts} Page posts, ${r.counts.group_tasks} group tasks.` });
        qc.invalidateQueries({ queryKey: ["fb-campaign", c.id] });
        qc.invalidateQueries({ queryKey: ["fb-campaign-jobs", c.id] });
        qc.invalidateQueries({ queryKey: ["fb-queue"] });
      } else {
        toast({ title: "Not activated", description: "Resolve the blocking warnings first.", variant: "destructive" });
      }
    },
    onError: (e) => toast({ title: "Activation failed", description: errMsg(e), variant: "destructive" }),
  });

  const needsAck = plan?.warnings.some((w) => w.code === "balance_skew" && w.blocking);
  // The balance warning is the one blocker the admin clears here (by acknowledging).
  const onlyAckBlocks = !!plan && plan.warnings.filter((w) => w.blocking).every((w) => w.code === "balance_skew");
  const canCommit = !!plan && !commit.isPending && (!plan.blocking || (onlyAckBlocks && ack));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-900">Schedule</h2>
        {canPlan && (
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} disabled={preview.isPending} onClick={() => preview.mutate()}>
              <Eye className="h-3.5 w-3.5" /> Preview
            </button>
            <button type="button" className={btnPrimary} disabled={!canCommit} onClick={() => commit.mutate()}>
              {c.status === "draft" ? <><Rocket className="h-3.5 w-3.5" /> Activate</> : <><RefreshCw className="h-3.5 w-3.5" /> Re-plan future tasks</>}
            </button>
          </div>
        )}
      </div>
      {!plan && <p className="text-xs text-slate-500">Preview shows the exact Page posts and group tasks activation would create, and any conflicts.</p>}
      {plan && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              ["Windows", `${plan.counts.windows_upcoming}/${plan.counts.windows_total}`],
              ["Page posts", plan.counts.page_posts],
              ["Group tasks", plan.counts.group_tasks],
              ["Unplaced", plan.counts.unplaced],
              ["Kept (done or claimed)", plan.counts.kept_jobs],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">{k}</div>
                <div className="text-sm font-semibold text-slate-900">{v}</div>
              </div>
            ))}
          </div>
          {plan.warnings.length > 0 && (
            <ul className="space-y-1">
              {plan.warnings.map((w, i) => (
                <li key={i} className={`flex items-start gap-2 text-xs ${w.blocking ? "text-red-700" : "text-amber-700"}`}>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w.message}{w.blocking ? " (blocks activation)" : ""}
                </li>
              ))}
            </ul>
          )}
          {needsAck && (
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I acknowledge the group selection leans toward interest-specific or partisan groups.
            </label>
          )}
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-[28rem] overflow-y-auto">
            {plan.jobs.map((j, i) => (
              <details key={i} className="px-3 py-2">
                <summary className="flex items-center gap-2 text-xs cursor-pointer">
                  <span className="w-32 shrink-0 text-slate-700">{j.local_time}</span>
                  <Pill tone={j.destination_kind === "page" ? "blue" : "slate"}>{j.destination_kind === "page" ? "Page" : j.group_name}</Pill>
                  <span className="text-slate-400">{j.language_code} · {j.variant_label}{j.identity_label ? ` · ${j.identity_label}` : ""}{j.link_mode !== "inline" ? ` · link ${j.link_mode}` : ""}</span>
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-600 font-sans">{j.caption_snapshot}</pre>
              </details>
            ))}
            {plan.jobs.length === 0 && <div className="px-3 py-4 text-center text-xs text-slate-400">No new tasks.</div>}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FbCampaignEditorPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [ask, dialog] = useAsk();
  const { data: c, isLoading, isError, error } = useCampaign(id);

  const lifecycle = useMutation({
    mutationFn: async (action: "pause" | "resume" | "cancel") => {
      let reason: string | null = null;
      if (action === "cancel") {
        reason = await ask({
          title: "Cancel this campaign?", message: "Remaining tasks are removed. Posts already made on Facebook are unaffected.",
          label: "Reason", required: true, confirmLabel: "Cancel campaign",
        });
        if (reason === null) return;
      }
      if (action === "pause" && await ask({
        title: "Pause this campaign?", message: "No new tasks are released while paused. On resume, tasks more than 60 minutes overdue are skipped, not posted in a burst.",
        confirmOnly: true, confirmLabel: "Pause",
      }) === null) return;
      await rpc("admin_set_social_campaign_status", { p_campaign_id: id, p_action: action, p_reason: reason });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fb-campaign", id] });
      qc.invalidateQueries({ queryKey: ["fb-campaign-jobs", id] });
      qc.invalidateQueries({ queryKey: ["fb-queue"] });
    },
    onError: (e) => toast({ title: "Could not update campaign", description: errMsg(e), variant: "destructive" }),
  });

  if (isLoading) return <Loading />;
  if (isError || !c) return <ErrorBox>{errMsg(error) || "Campaign not found."}</ErrorBox>;
  const editable = c.status === "draft" || c.status === "active" || c.status === "paused";

  return (
    <div className="space-y-5">
      <FbNav />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Link to="/admin/fb-campaigns" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-3.5 w-3.5" /> Campaigns
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-semibold text-slate-900">{c.name}</h1>
            <Pill tone={campaignTone(c.status)}>{c.status}</Pill>
            {c.plan_version > 0 && <Pill>plan v{c.plan_version}</Pill>}
          </div>
          <p className="text-xs text-slate-500 max-w-3xl">{c.questions?.question}</p>
        </div>
        <div className="flex gap-2">
          {c.status === "active" && <button type="button" className={btnSecondary} onClick={() => lifecycle.mutate("pause")}><Pause className="h-3.5 w-3.5" /> Pause</button>}
          {c.status === "paused" && <button type="button" className={btnSecondary} onClick={() => lifecycle.mutate("resume")}><Play className="h-3.5 w-3.5" /> Resume</button>}
          {(c.status === "active" || c.status === "paused" || c.status === "draft") && (
            <button type="button" className={btnDanger} onClick={() => lifecycle.mutate("cancel")}><Ban className="h-3.5 w-3.5" /> Cancel</button>
          )}
        </div>
      </div>

      <SettingsSection c={c} editable={editable} />
      <GroupsSection c={c} editable={editable} />
      <CaptionsSection c={c} editable={editable} />
      <ScheduleSection c={c} />
      {c.status !== "draft" && <CampaignResults c={c} />}
      {dialog}
    </div>
  );
}
