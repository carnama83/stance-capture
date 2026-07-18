// src/routes/admin/ad-accounts/Index.tsx
// Epic Y — Y1: Ad Account Management.
//
// Connect a Meta or LinkedIn ad account and run one-click health checks.
// Reads the credentials-free `ad_account_connections_safe` view (API tokens
// never reach the client). Connect/test go through the validate-ad-account
// edge function via the raw-fetch + getJwt() pattern used across the console.

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SUPABASE_URL, SUPABASE_ANON_KEY, getJwt } from "@/lib/env";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  PlugZap,
  Plug,
  Loader2,
  Plus,
  X,
  RefreshCw,
  Facebook,
  Linkedin,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = "meta" | "linkedin";
type AccountStatus = "active" | "token_expired" | "suspended" | "disconnected";

interface AdAccount {
  id: string;
  platform: Platform;
  account_id: string;
  account_name: string | null;
  status: AccountStatus;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Data hooks ───────────────────────────────────────────────────────────────

function useAdAccounts() {
  return useQuery<AdAccount[]>({
    queryKey: ["admin-ad-accounts"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_account_connections_safe")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AdAccount[];
    },
  });
}

async function callValidate(payload: Record<string, unknown>) {
  const token = getJwt(); // localStorage read — avoids the getSession() stall
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/validate-ad-account`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AccountStatus }) {
  const config: Record<AccountStatus, { icon: React.ReactNode; label: string; className: string }> = {
    active: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "Active",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    token_expired: {
      icon: <AlertTriangle className="h-3 w-3" />,
      label: "Token expired",
      className: "bg-amber-50 text-amber-700 border-amber-200",
    },
    suspended: {
      icon: <XCircle className="h-3 w-3" />,
      label: "Suspended",
      className: "bg-red-50 text-red-700 border-red-200",
    },
    disconnected: {
      icon: <Plug className="h-3 w-3" />,
      label: "Disconnected",
      className: "bg-slate-100 text-slate-600 border-slate-200",
    },
  };
  const c = config[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${c.className}`}>
      {c.icon}
      {c.label}
    </span>
  );
}

function PlatformIcon({ platform }: { platform: Platform }) {
  return platform === "meta" ? (
    <Facebook className="h-4 w-4 text-blue-600" />
  ) : (
    <Linkedin className="h-4 w-4 text-sky-700" />
  );
}

// ─── Account card ─────────────────────────────────────────────────────────────

function AccountCard({ acct }: { acct: AdAccount }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const testMut = useMutation({
    mutationFn: () => callValidate({ mode: "test", connection_id: acct.id }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      if (data?.ok) toast({ title: "Connection healthy", description: `${acct.account_name || acct.account_id} is active.` });
      else toast({ title: "Connection check failed", description: data?.reason || "See account status.", variant: "destructive" });
    },
    onError: (e: any) => toast({ title: "Test failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <PlatformIcon platform={acct.platform} />
            <h3 className="text-sm font-semibold text-slate-900 truncate">
              {acct.account_name || acct.account_id}
            </h3>
            <StatusBadge status={acct.status} />
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            <code className="font-mono">{acct.account_id}</code>
            {acct.last_sync_at && (
              <> · Last checked {new Date(acct.last_sync_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => testMut.mutate()}
          disabled={testMut.isPending}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-blue-200 hover:text-blue-700 disabled:opacity-50 transition-colors shrink-0"
        >
          {testMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Test connection
        </button>
      </div>
    </div>
  );
}

// ─── Connect modal ────────────────────────────────────────────────────────────

function ConnectModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [platform, setPlatform] = React.useState<Platform>("meta");
  const [accountId, setAccountId] = React.useState("");
  const [accountName, setAccountName] = React.useState("");
  const [businessId, setBusinessId] = React.useState("");
  const [metaToken, setMetaToken] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [liToken, setLiToken] = React.useState("");

  const connectMut = useMutation({
    mutationFn: () => {
      const base: Record<string, unknown> = {
        mode: "connect",
        platform,
        account_id: accountId.trim(),
        account_name: accountName.trim() || undefined,
      };
      if (platform === "meta") {
        if (businessId.trim()) base.business_id = businessId.trim();
        if (metaToken.trim()) base.access_token = metaToken.trim();
      } else {
        base.client_id = clientId.trim();
        base.client_secret = clientSecret.trim();
        base.access_token = liToken.trim();
      }
      return callValidate(base);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      toast({ title: "Account connected", description: "Credentials validated and saved." });
      onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't connect", description: e?.message, variant: "destructive" }),
  });

  const canSubmit =
    accountId.trim().length > 0 &&
    (platform === "meta" || (clientId.trim() && clientSecret.trim() && liToken.trim()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Connect ad account</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Platform toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(["meta", "linkedin"] as Platform[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={[
                  "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                  platform === p
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-500 hover:text-slate-700",
                ].join(" ")}
              >
                <PlatformIcon platform={p} />
                {p === "meta" ? "Meta" : "LinkedIn"}
              </button>
            ))}
          </div>

          <Field label={platform === "meta" ? "Ad account ID (act_… or numeric)" : "Ad account ID"}>
            <input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder={platform === "meta" ? "act_1040149128547845" : "512345678"}
              className={inputCls}
            />
          </Field>

          <Field label="Display name (optional)">
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Stance Capture" className={inputCls} />
          </Field>

          {platform === "meta" ? (
            <>
              <Field label="Business Manager ID (optional)">
                <input value={businessId} onChange={(e) => setBusinessId(e.target.value)} placeholder="1906277233389184" className={inputCls} />
              </Field>
              <Field label="Access token (optional)" hint="Leave blank to use the server system-user token.">
                <input value={metaToken} onChange={(e) => setMetaToken(e.target.value)} type="password" placeholder="Uses META_ADS_ACCESS_TOKEN" className={inputCls} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Client ID">
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Client secret">
                <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" className={inputCls} />
              </Field>
              <Field label="Access token">
                <input value={liToken} onChange={(e) => setLiToken(e.target.value)} type="password" className={inputCls} />
              </Field>
            </>
          )}

          <p className="text-[11px] text-slate-400">
            We validate the credentials against the platform before saving. Nothing is stored if validation fails.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => connectMut.mutate()}
            disabled={!canSubmit || connectMut.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {connectMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />}
            Validate & connect
          </button>
        </div>
      </div>
    </div>
  );
}

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminAdAccountsPage() {
  const { data: accounts, isLoading, isError } = useAdAccounts();
  const [showConnect, setShowConnect] = React.useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Ad Accounts</h1>
          <p className="text-xs text-slate-500 mt-1">
            Connect Meta and LinkedIn ad accounts, then run health checks. Credentials stay server-side and are never shown here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowConnect(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Connect account
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          Failed to load ad accounts. Check your database connection.
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {accounts && accounts.length > 0 ? (
            accounts.map((a) => <AccountCard key={a.id} acct={a} />)
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
              <p className="text-sm text-slate-400">No ad accounts connected yet.</p>
              <button
                type="button"
                onClick={() => setShowConnect(true)}
                className="mt-3 text-xs font-medium text-blue-600 hover:underline"
              >
                Connect your first account
              </button>
            </div>
          )}
        </div>
      )}

      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
    </div>
  );
}
