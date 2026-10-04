// src/routes/admin/fb-campaigns/shared.tsx
// Facebook Campaign Manager (PDD v1.2, Phase 1: manual). Shared types, data
// helpers and small UI pieces for the fb-campaigns admin screens.
//
// Reads use the SDK (admin RLS). Writes use raw fetch with the JWT read from
// storage (getJwt) to avoid the supabase-js auth lock, matching the other admin
// pages. Admin screens stay English regardless of the viewer's UI language.

import * as React from "react";
import { NavLink } from "react-router-dom";
import { X } from "lucide-react";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Lean = "general" | "interest" | "partisan";
export type LinkPolicy = "allowed" | "link_in_comment" | "no_links" | "admin_approval" | "unknown";
export type Membership = "not_joined" | "requested" | "member" | "left" | "banned";
export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "cancelled";
export type JobStatus = "scheduled" | "claimed" | "submitted" | "posted" | "skipped" | "missed" | "cancelled";

export interface Identity {
  id: string;
  label: string;
  kind: "page" | "profile";
  profile_url: string | null;
  active: boolean;
  daily_group_post_cap: number;
  min_gap_minutes: number;
  restricted_at: string | null;
  restriction_note: string | null;
  notes: string | null;
}

export interface Group {
  id: string;
  name: string;
  url: string;
  location_id: string;
  language_codes: string[];
  topic_ids: string[];
  lean: Lean;
  link_policy: LinkPolicy;
  membership_status: Membership;
  requires_post_approval: boolean;
  allowed_identity_ids: string[];
  rules_reviewed: boolean;
  rules_notes: string | null;
  posting_cap_per_campaign: number;
  member_count_approx: number | null;
  last_verified_at: string | null;
  enabled: boolean;
  notes: string | null;
  locations?: { name: string; type: string } | null;
}

export interface Campaign {
  id: string;
  question_id: string;
  location_id: string | null;
  name: string;
  status: CampaignStatus;
  timezone: string;
  start_date: string;
  duration_days: number;
  daily_slots: string[];
  language_codes: string[];
  include_page: boolean;
  page_identity_id: string | null;
  page_posts_per_day: number;
  group_posts_per_group: number;
  plan_version: number;
  balance_acknowledged_at: string | null;
  activated_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  questions?: { question: string } | null;
  locations?: { name: string; type: string } | null;
}

export interface CaptionVariant {
  id: string;
  campaign_id: string;
  language_code: string;
  label: string;
  purpose: "invitation" | "context" | "reminder" | "closing";
  body: string;
  ai_draft: string | null;
  ai_model: string | null;
  status: "draft" | "approved" | "retired";
  neutrality_result: "pass" | "fail" | null;
  neutrality_notes: string | null;
  neutrality_checked_at: string | null;
}

export interface Job {
  id: string;
  campaign_id: string;
  plan_version: number;
  destination_kind: "page" | "group";
  group_id: string | null;
  identity_id: string | null;
  language_code: string;
  caption_snapshot: string;
  link_mode: "inline" | "comment" | "none";
  link_url: string | null;
  scheduled_at: string;
  status: JobStatus;
  posted_url: string | null;
  skip_reason: string | null;
  claimed_by: string | null;
  social_group_directory?: { name: string; url: string; requires_post_approval: boolean } | null;
  social_posting_identities?: { label: string; kind: string } | null;
  social_campaigns?: { name: string; status: CampaignStatus; timezone: string } | null;
}

export interface PlanWarning {
  code: string;
  message: string;
  blocking: boolean;
  group_id?: string;
  lang?: string;
}

export interface PlanResult {
  campaign_id: string;
  committed: boolean;
  blocking: boolean;
  plan_version: number;
  timezone: string;
  counts: {
    windows_total: number;
    windows_upcoming: number;
    page_posts: number;
    group_tasks: number;
    unplaced: number;
    kept_jobs: number;
  };
  warnings: PlanWarning[];
  jobs: Array<{
    destination_kind: "page" | "group";
    group_id: string | null;
    group_name: string | null;
    identity_label: string | null;
    language_code: string;
    scheduled_at: string;
    local_time: string;
    variant_label: string | null;
    link_mode: string;
    caption_snapshot: string;
  }>;
}

// ─── Writes (raw fetch) ───────────────────────────────────────────────────────

async function parse(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.message || body?.error || `HTTP ${res.status}`;
    throw new Error(String(msg).replace(/^[A-Z_]+: /, (m) => m));
  }
  return body;
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify(args),
  });
  return parse(res) as Promise<T>;
}

export async function insertRow<T = unknown>(table: string, row: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: supabaseHeaders(getJwt(), { Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  const body = await parse(res);
  return (Array.isArray(body) ? body[0] : body) as T;
}

export async function updateRows(table: string, filter: string, patch: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: supabaseHeaders(getJwt(), { Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  await parse(res);
}

export async function deleteRows(table: string, filter: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: supabaseHeaders(getJwt(), { Prefer: "return=minimal" }),
  });
  await parse(res);
}

export async function callEdge<T = any>(fn: string, payload: Record<string, unknown>, timeoutMs = 90_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: supabaseHeaders(getJwt()),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

// The signed-in admin's id, read from the stored JWT (no auth-lock round trip).
export function currentUserId(): string | null {
  try {
    const payload = getJwt().split(".")[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).sub ?? null;
  } catch {
    return null;
  }
}

// Links in captions point at the site the admin is using (Dev, UAT or Prod).
export function siteOrigin(): string {
  return window.location.origin;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export const LEAN_LABEL: Record<Lean, string> = {
  general: "General",
  interest: "Interest-specific",
  partisan: "Partisan / advocacy",
};

export const LINK_POLICY_LABEL: Record<LinkPolicy, string> = {
  allowed: "Links allowed",
  link_in_comment: "Link in comment only",
  no_links: "No links",
  admin_approval: "Links need admin approval",
  unknown: "Unknown",
};

export const MEMBERSHIP_LABEL: Record<Membership, string> = {
  not_joined: "Not joined",
  requested: "Requested",
  member: "Member",
  left: "Left",
  banned: "Banned",
};

export const LANGS: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "mr", label: "Marathi" },
];

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtLocal(iso: string, tz = "Asia/Kolkata"): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: tz, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── UI bits ──────────────────────────────────────────────────────────────────

export const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200";
export const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50";
export const btnSecondary =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50";
export const btnDanger =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

const PILL: Record<string, string> = {
  slate: "bg-slate-100 text-slate-600 border-slate-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
};

export function Pill({ tone = "slate", children }: { tone?: keyof typeof PILL; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${PILL[tone]}`}>
      {children}
    </span>
  );
}

export function campaignTone(s: CampaignStatus): keyof typeof PILL {
  return s === "active" ? "green" : s === "paused" ? "amber" : s === "cancelled" ? "red" : s === "completed" ? "blue" : "slate";
}

export function jobTone(s: JobStatus): keyof typeof PILL {
  return s === "posted" ? "green" : s === "submitted" || s === "claimed" ? "blue" : s === "missed" ? "red" : s === "scheduled" ? "slate" : "amber";
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-xl flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">{footer}</div>}
      </div>
    </div>
  );
}

// In-app replacement for window.prompt / window.confirm. Usage:
//   const [ask, dialog] = useAsk();  ... {dialog}
//   const note = await ask({ title, label, required: true });  // null = cancelled
//   const ok = await ask({ title, confirmOnly: true });          // "" = confirmed
interface AskOpts {
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  confirmOnly?: boolean;
  confirmLabel?: string;
}

export function useAsk(): [(o: AskOpts) => Promise<string | null>, React.ReactNode] {
  const [state, setState] = React.useState<(AskOpts & { resolve: (v: string | null) => void }) | null>(null);
  const [value, setValue] = React.useState("");
  const ask = React.useCallback((o: AskOpts) => new Promise<string | null>((resolve) => {
    setValue("");
    setState({ ...o, resolve });
  }), []);
  const close = (v: string | null) => { state?.resolve(v); setState(null); };
  const dialog = state ? (
    <Modal title={state.title} onClose={() => close(null)}
      footer={<>
        <button type="button" className={btnSecondary} onClick={() => close(null)}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={!state.confirmOnly && state.required && !value.trim()}
          onClick={() => close(state.confirmOnly ? "" : value.trim())}>
          {state.confirmLabel ?? "OK"}
        </button>
      </>}>
      {state.message && <p className="text-xs text-slate-600">{state.message}</p>}
      {!state.confirmOnly && (
        <Field label={state.label ?? ""}>
          <textarea autoFocus className={inputCls} rows={2} value={value} placeholder={state.placeholder}
            onChange={(e) => setValue(e.target.value)} />
        </Field>
      )}
    </Modal>
  ) : null;
  return [ask, dialog];
}

// Sub-navigation shared by all fb-campaigns screens.
export function FbNav() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-xs font-medium ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`;
  return (
    <nav className="flex flex-wrap gap-1.5">
      <NavLink to="/admin/fb-campaigns" end className={cls}>Campaigns</NavLink>
      <NavLink to="/admin/fb-campaigns/queue" className={cls}>Posting queue</NavLink>
      <NavLink to="/admin/fb-campaigns/groups" className={cls}>City groups</NavLink>
      <NavLink to="/admin/fb-campaigns/identities" className={cls}>Posting identities</NavLink>
    </nav>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <FbNav />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">{sub}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

export function Loading() {
  return <div className="text-slate-400 text-sm py-4">Loading…</div>;
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{children}</div>;
}
