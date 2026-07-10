// src/routes/admin/campaigns/Index.tsx
// Epic Y — Y2: Campaign creation & launch.
//
// Create a draft campaign anchored to an ACTIVE, campaign-eligible question,
// then launch it. Launch calls create-meta-campaign (LinkedIn wiring lands with
// create-linkedin-campaign). Reads/writes the campaigns table (admin RLS);
// account selector uses the credentials-free ad_account_connections_safe view.

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SUPABASE_URL, SUPABASE_ANON_KEY, getJwt } from "@/lib/env";
import {
  Rocket, Loader2, Plus, X, CheckCircle2, XCircle, Clock, Pause,
  Ban, FileEdit, Facebook, Linkedin, DollarSign, MousePointerClick, Eye, Users2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = "meta" | "linkedin";
type CampaignStatus =
  | "draft" | "pending_review" | "active" | "paused"
  | "completed" | "cancelled" | "rejected";

interface Campaign {
  id: string;
  name: string;
  question_id: string;
  platform: Platform;
  ad_account_id: string | null;
  status: CampaignStatus;
  budget_type: "daily" | "total";
  budget_amount: number;
  start_date: string | null;
  end_date: string | null;
  platform_campaign_id: string | null;
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  stances_attributed: number;
  rejection_reason: string | null;
  created_at: string;
  questions?: { question: string } | null;
}

interface SafeAccount {
  id: string;
  platform: Platform;
  account_id: string;
  account_name: string | null;
  status: string;
}

interface EligibleQuestion {
  id: string;
  question: string;
}

// ─── Data hooks ───────────────────────────────────────────────────────────────

function useCampaigns() {
  return useQuery<Campaign[]>({
    queryKey: ["admin-campaigns"],
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*, questions(question)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Campaign[];
    },
  });
}

function useConnectedAccounts() {
  return useQuery<SafeAccount[]>({
    queryKey: ["admin-ad-accounts-safe"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_account_connections_safe")
        .select("id, platform, account_id, account_name, status")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SafeAccount[];
    },
  });
}

function useEligibleQuestions() {
  return useQuery<EligibleQuestion[]>({
    queryKey: ["admin-campaign-eligible-questions"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("questions")
        .select("id, question")
        .eq("state", "active")
        .eq("campaign_eligible", true)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as EligibleQuestion[];
    },
  });
}

async function callLaunch(platform: Platform, campaignId: string, activate: boolean) {
  const fn = platform === "meta" ? "create-meta-campaign" : "create-linkedin-campaign";
  const token = getJwt();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ campaign_id: campaignId, activate }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || data?.meta_error?.message || `HTTP ${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CampaignStatus }) {
  const map: Record<CampaignStatus, { icon: React.ReactNode; label: string; cls: string }> = {
    draft: { icon: <FileEdit className="h-3 w-3" />, label: "Draft", cls: "bg-slate-100 text-slate-600 border-slate-200" },
    pending_review: { icon: <Clock className="h-3 w-3" />, label: "Pending review", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    active: { icon: <CheckCircle2 className="h-3 w-3" />, label: "Active", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    paused: { icon: <Pause className="h-3 w-3" />, label: "Paused", cls: "bg-sky-50 text-sky-700 border-sky-200" },
    completed: { icon: <CheckCircle2 className="h-3 w-3" />, label: "Completed", cls: "bg-slate-100 text-slate-600 border-slate-200" },
    cancelled: { icon: <Ban className="h-3 w-3" />, label: "Cancelled", cls: "bg-slate-100 text-slate-500 border-slate-200" },
    rejected: { icon: <XCircle className="h-3 w-3" />, label: "Rejected", cls: "bg-red-50 text-red-700 border-red-200" },
  };
  const c = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${c.cls}`}>
      {c.icon}{c.label}
    </span>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className="text-slate-400">{icon}</span>
      <span className="font-medium text-slate-700">{value}</span>
      <span className="text-slate-400">{label}</span>
    </div>
  );
}

// ─── Launch dialog ────────────────────────────────────────────────────────────

function LaunchDialog({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activate, setActivate] = React.useState(false);
  const launchMut = useMutation({
    mutationFn: () => callLaunch(campaign.platform, campaign.id, activate),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
      toast({
        title: activate ? "Submitted for review" : "Built (paused)",
        description: `Platform campaign ${data?.platform_campaign_id ?? "created"}.`,
      });
      onClose();
    },
    onError: (e: any) => toast({ title: "Launch failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Launch “{campaign.name}”</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer">
            <input type="radio" checked={!activate} onChange={() => setActivate(false)} className="mt-0.5" />
            <span>
              <span className="block text-xs font-semibold text-slate-800">Build paused (test)</span>
              <span className="block text-[11px] text-slate-500">Creates the campaign, ad set, creative and ad on the platform, all paused. No spend. Review in Ads Manager first.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer">
            <input type="radio" checked={activate} onChange={() => setActivate(true)} className="mt-0.5" />
            <span>
              <span className="block text-xs font-semibold text-slate-800">Submit for review (live)</span>
              <span className="block text-[11px] text-slate-500">Submits to the platform for approval. Once approved it begins delivering and spending budget.</span>
            </span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            type="button"
            onClick={() => launchMut.mutate()}
            disabled={launchMut.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {launchMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
            {activate ? "Submit for review" : "Build paused"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Campaign card ────────────────────────────────────────────────────────────

function CampaignCard({ c }: { c: Campaign }) {
  const [showLaunch, setShowLaunch] = React.useState(false);
  const launchable = c.status === "draft";
  const usd = (n: number) => `$${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {c.platform === "meta" ? <Facebook className="h-4 w-4 text-blue-600" /> : <Linkedin className="h-4 w-4 text-sky-700" />}
            <h3 className="text-sm font-semibold text-slate-900 truncate">{c.name}</h3>
            <StatusBadge status={c.status} />
          </div>
          {c.questions?.question && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{c.questions.question}</p>
          )}
          <p className="text-[11px] text-slate-400 mt-1">
            {usd(c.budget_amount)} {c.budget_type === "daily" ? "/ day" : "total"}
            {c.platform_campaign_id && <> · platform id <code className="font-mono">{c.platform_campaign_id}</code></>}
          </p>
        </div>
        {launchable && (
          <button
            type="button"
            onClick={() => setShowLaunch(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shrink-0"
          >
            <Rocket className="h-3 w-3" /> Launch
          </button>
        )}
      </div>

      {(c.status === "active" || c.status === "completed" || c.status === "paused") && (
        <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-slate-100">
          <Stat icon={<Eye className="h-3.5 w-3.5" />} label="impressions" value={c.total_impressions.toLocaleString()} />
          <Stat icon={<MousePointerClick className="h-3.5 w-3.5" />} label="clicks" value={c.total_clicks.toLocaleString()} />
          <Stat icon={<Users2 className="h-3.5 w-3.5" />} label="stances" value={c.stances_attributed.toLocaleString()} />
          <Stat icon={<DollarSign className="h-3.5 w-3.5" />} label="spent" value={usd(c.total_spend)} />
        </div>
      )}

      {c.status === "rejected" && c.rejection_reason && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">
          {c.rejection_reason}
        </div>
      )}

      {showLaunch && <LaunchDialog campaign={c} onClose={() => setShowLaunch(false)} />}
    </div>
  );
}

// ─── New campaign modal ───────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function NewCampaignModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: accounts } = useConnectedAccounts();
  const { data: questions } = useEligibleQuestions();

  const [name, setName] = React.useState("");
  const [platform, setPlatform] = React.useState<Platform>("meta");
  const [accountId, setAccountId] = React.useState("");
  const [questionId, setQuestionId] = React.useState("");
  const [budgetType, setBudgetType] = React.useState<"daily" | "total">("daily");
  const [budget, setBudget] = React.useState("5");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [countries, setCountries] = React.useState<string[]>(["IN"]);
  const [ageMin, setAgeMin] = React.useState("18");
  const [ageMax, setAgeMax] = React.useState("65");
  const [headline, setHeadline] = React.useState("");
  const [bodyCopy, setBodyCopy] = React.useState("");

  const platformAccounts = (accounts ?? []).filter((a) => a.platform === platform);

  function toggleCountry(code: string) {
    setCountries((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  const createMut = useMutation({
    mutationFn: async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id ?? null;
      const targeting: Record<string, unknown> = {
        countries,
        age_min: Number(ageMin) || 18,
        age_max: Number(ageMax) || 65,
      };
      const { error } = await supabase.from("campaigns").insert({
        name: name.trim(),
        question_id: questionId,
        platform,
        ad_account_id: accountId || null,
        status: "draft",
        budget_type: budgetType,
        budget_amount: Number(budget),
        start_date: startDate || null,
        end_date: endDate || null,
        targeting,
        creative_headline: headline.trim() || null,
        creative_body: bodyCopy.trim() || null,
        created_by: uid,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
      toast({ title: "Draft created", description: "Review and launch when ready." });
      onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't create campaign", description: e?.message, variant: "destructive" }),
  });

  const canSubmit =
    name.trim().length > 0 && questionId && accountId && Number(budget) >= 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">New campaign</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Campaign name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="UP civic push — July" className={inputCls} />
          </Field>

          {/* Platform */}
          <div className="grid grid-cols-2 gap-2">
            {(["meta", "linkedin"] as Platform[]).map((p) => (
              <button key={p} type="button" onClick={() => { setPlatform(p); setAccountId(""); }}
                className={["flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                  platform === p ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:text-slate-700"].join(" ")}>
                {p === "meta" ? <Facebook className="h-4 w-4 text-blue-600" /> : <Linkedin className="h-4 w-4 text-sky-700" />}
                {p === "meta" ? "Meta" : "LinkedIn"}
              </button>
            ))}
          </div>
          {platform === "linkedin" && (
            <p className="text-[11px] text-amber-600">LinkedIn launch isn’t wired yet — you can save a draft, but launch it once create-linkedin-campaign ships.</p>
          )}

          <Field label="Ad account" hint={platformAccounts.length === 0 ? "No active accounts for this platform. Connect one under Ad Accounts." : undefined}>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
              <option value="">Select an account…</option>
              {platformAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.account_name || a.account_id}</option>
              ))}
            </select>
          </Field>

          <Field label="Anchor question" hint="Only ACTIVE, campaign-eligible questions appear here.">
            <select value={questionId} onChange={(e) => setQuestionId(e.target.value)} className={inputCls}>
              <option value="">Select a question…</option>
              {(questions ?? []).map((q) => (
                <option key={q.id} value={q.id}>{q.question.length > 90 ? q.question.slice(0, 90) + "…" : q.question}</option>
              ))}
            </select>
          </Field>

          {/* Budget */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget type">
              <select value={budgetType} onChange={(e) => setBudgetType(e.target.value as "daily" | "total")} className={inputCls}>
                <option value="daily">Daily</option>
                <option value="total">Total (lifetime)</option>
              </select>
            </Field>
            <Field label="Amount (USD)" hint="Minimum $5.">
              <input type="number" min={5} step={1} value={budget} onChange={(e) => setBudget(e.target.value)} className={inputCls} />
            </Field>
          </div>

          {/* Schedule */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></Field>
            <Field label="End date" hint={budgetType === "total" ? "Required for total budget." : "Optional."}><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} /></Field>
          </div>

          {/* Targeting */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-600">Geography</span>
            <div className="flex flex-wrap gap-2">
              {[["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"]].map(([code, label]) => (
                <button key={code} type="button" onClick={() => toggleCountry(code)}
                  className={["rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    countries.includes(code) ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"].join(" ")}>
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Field label="Age min"><input type="number" min={13} max={65} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} className={inputCls} /></Field>
              <Field label="Age max"><input type="number" min={13} max={65} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} className={inputCls} /></Field>
            </div>
            <p className="text-[11px] text-slate-400">Civic campaigns run under Meta’s political ad category, which limits detailed-interest targeting — geo + age only.</p>
          </div>

          {/* Creative */}
          <Field label="Headline (optional)" hint="Defaults to the question text.">
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={40} className={inputCls} />
          </Field>
          <Field label="Body copy (optional)" hint="Defaults to the question summary. The question OG image is used automatically.">
            <textarea value={bodyCopy} onChange={(e) => setBodyCopy(e.target.value)} rows={3} className={inputCls} />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => createMut.mutate()} disabled={!canSubmit || createMut.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {createMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Create draft
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminCampaignsPage() {
  const { data: campaigns, isLoading, isError } = useCampaigns();
  const [showNew, setShowNew] = React.useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Campaigns</h1>
          <p className="text-xs text-slate-500 mt-1">
            Create a campaign anchored to a question, then launch it to Meta. Build paused to preview, or submit for review to go live.
          </p>
        </div>
        <button type="button" onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 shrink-0">
          <Plus className="h-3.5 w-3.5" /> New campaign
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-4"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      )}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">Failed to load campaigns.</div>
      )}
      {!isLoading && !isError && (
        <div className="space-y-3">
          {campaigns && campaigns.length > 0 ? (
            campaigns.map((c) => <CampaignCard key={c.id} c={c} />)
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
              <p className="text-sm text-slate-400">No campaigns yet.</p>
              <button type="button" onClick={() => setShowNew(true)} className="mt-3 text-xs font-medium text-blue-600 hover:underline">Create your first campaign</button>
            </div>
          )}
        </div>
      )}

      {showNew && <NewCampaignModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
