// src/routes/admin/whatsapp/Index.tsx
// Epic AA — AA1.1, rebuilt as a read-only status view for defect AA-15 (Sep 2026).
//
// /admin/whatsapp
//
// WhatsApp's runtime configuration lives in Supabase Edge secrets. The previous
// version of this page saved credentials into whatsapp_config, which no
// function ever read, so Save/Disconnect had no effect. This page now shows
// what is actually in effect, via the admin-only whatsapp-status Edge
// Function: which secrets are set (never their values), the effective
// settings, and a live read-only check of the number, templates and Flow at
// Meta. It changes nothing.

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  KeyRound, SlidersHorizontal, Phone, MessageSquareMore, Workflow, Webhook,
} from "lucide-react";
import { SUPABASE_URL, SUPABASE_ANON_KEY, getJwt } from "@/lib/env";

type MetaResult<T> = { ok: true; data: T } | { ok: false; error: string };
type Status = {
  ok: boolean;
  reason?: string;
  checked_at: string;
  webhook_url: string;
  flow_endpoint_url: string;
  secrets: { name: string; purpose: string; required: boolean; set: boolean }[];
  settings: { name: string; value: string; source: "secret" | "default"; read_by: string }[];
  warnings: string[];
  meta: {
    phone_number: MetaResult<{
      display_phone_number?: string; verified_name?: string; quality_rating?: string;
      name_status?: string; code_verification_status?: string; messaging_limit_tier?: string;
    }>;
    templates: ({ ok: true; data: { name: string; status: string; language: string; category: string }[]; missing: string[];
      account_template_count: number; account_template_names: string[]; sending_number_in_account: boolean | null; phone_numbers_error: string | null })
      | { ok: false; error: string };
    flow: MetaResult<{ name?: string; status?: string; validation_errors?: unknown[] }>;
  };
};

function StatusBadge({ value }: { value?: string }) {
  const v = (value ?? "").toUpperCase();
  const good = ["APPROVED", "PUBLISHED", "GREEN", "VERIFIED", "CONNECTED"].includes(v);
  const bad = ["REJECTED", "DISABLED", "RED", "BLOCKED", "DEPRECATED", "FLAGGED"].includes(v);
  return (
    <Badge variant="outline" className={good ? "border-emerald-300 text-emerald-700" : bad ? "border-rose-300 text-rose-700" : "border-amber-300 text-amber-700"}>
      {value || "unknown"}
    </Badge>
  );
}

// This project does not narrow discriminated unions (strictNullChecks is off),
// so read a failed result's error without relying on the ok flag narrowing.
const errorOf = (r: unknown) => (r as { error?: string } | undefined)?.error ?? "unknown";

function MetaError({ error }: { error: string }) {
  return (
    <p className="flex items-start gap-2 text-xs text-rose-700">
      <XCircle className="h-4 w-4 shrink-0" /> {error}
    </p>
  );
}

export default function AdminWhatsAppStatusPage() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-status`, {
        headers: { Authorization: `Bearer ${getJwt()}`, apikey: SUPABASE_ANON_KEY ?? "" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        setStatus(null);
        setError(body?.reason === "forbidden" ? "Admin access is required to view WhatsApp status."
          : `Could not load WhatsApp status (${body?.reason ?? body?.message ?? `HTTP ${res.status}`}).`);
        return;
      }
      setStatus(body as Status);
    } catch (e: any) {
      setError(`Could not reach the status service: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const copy = (text: string) => { navigator.clipboard.writeText(text); toast({ title: "Copied." }); };
  const missingRequired = status?.secrets.filter((s) => s.required && !s.set) ?? [];
  const phone = status?.meta.phone_number;
  const reachable = !!status && missingRequired.length === 0 && phone?.ok === true;
  // Green only when reachable AND nothing needs attention; warnings keep it amber.
  const healthy = reachable && (status?.warnings.length ?? 0) === 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">WhatsApp Status</h1>
          <p className="text-sm text-slate-500 mt-1">
            Read-only. WhatsApp is configured through Supabase Edge secrets, not on this page;
            this shows what is actually in effect.
          </p>
        </div>
        <button type="button" onClick={load} className="p-2 rounded border hover:bg-slate-50" disabled={loading} title="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !status && (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</div>
      )}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <XCircle className="h-5 w-5 shrink-0" /> {error}
        </div>
      )}

      {status && (
        <>
          {/* Overall */}
          <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${healthy ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            {healthy ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /> : <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />}
            <div className="flex-1">
              <p className={`text-sm font-medium ${healthy ? "text-emerald-800" : "text-amber-800"}`}>
                {healthy ? "Configured, and the sending number is reachable at Meta"
                  : reachable ? `Sending number reachable at Meta, with ${status.warnings.length} warning${status.warnings.length === 1 ? "" : "s"}`
                  : "Needs attention"}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Checked {new Date(status.checked_at).toLocaleString()}</p>
            </div>
          </div>

          {status.warnings.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Warnings</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc pl-5 space-y-1 text-xs text-amber-900">
                  {status.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Sending number */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Phone className="h-4 w-4" /> Sending number (live from Meta)</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              {phone?.ok ? (
                <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
                  <dt className="text-slate-500">Number</dt><dd>{phone.data.display_phone_number ?? "—"}</dd>
                  <dt className="text-slate-500">Display name</dt><dd>{phone.data.verified_name ?? "—"} {phone.data.name_status && <StatusBadge value={phone.data.name_status} />}</dd>
                  <dt className="text-slate-500">Quality rating</dt><dd><StatusBadge value={phone.data.quality_rating} /></dd>
                  <dt className="text-slate-500">Messaging limit</dt><dd>{phone.data.messaging_limit_tier ?? "—"}</dd>
                  <dt className="text-slate-500">Verification</dt><dd>{phone.data.code_verification_status ?? "—"}</dd>
                </dl>
              ) : <MetaError error={errorOf(phone)} />}
            </CardContent>
          </Card>

          {/* Templates */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><MessageSquareMore className="h-4 w-4" /> Message templates (live from Meta)</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2">
              {status.meta.templates.ok ? (
                <>
                  <p className="text-slate-500">
                    Business account (WHATSAPP_WABA_ID) holds {status.meta.templates.account_template_count} template(s)
                    {status.meta.templates.account_template_count > 0 && <>: <span className="font-mono">{status.meta.templates.account_template_names.join(", ")}</span></>}.
                    {" "}Sending number in this account:{" "}
                    {status.meta.templates.sending_number_in_account === true ? "yes"
                      : status.meta.templates.sending_number_in_account === false ? <span className="text-rose-700">no — statuses below are for a different account</span>
                      : <span className="text-amber-700">could not check ({status.meta.templates.phone_numbers_error})</span>}
                  </p>
                  {status.meta.templates.data.map((t) => (
                    <div key={`${t.name}-${t.language}`} className="flex items-center justify-between gap-2 border-b last:border-0 py-1">
                      <span className="font-mono">{t.name} <span className="text-slate-400">({t.language}, {t.category})</span></span>
                      <StatusBadge value={t.status} />
                    </div>
                  ))}
                  {status.meta.templates.missing.map((n) => (
                    <div key={n} className="flex items-center justify-between gap-2 py-1">
                      <span className="font-mono">{n}</span>
                      <Badge variant="outline" className="border-rose-300 text-rose-700">not found</Badge>
                    </div>
                  ))}
                </>
              ) : <MetaError error={errorOf(status.meta.templates)} />}
            </CardContent>
          </Card>

          {/* Flow */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Workflow className="h-4 w-4" /> Flow (live from Meta)</CardTitle>
            </CardHeader>
            <CardContent className="text-xs">
              {status.meta.flow.ok ? (
                <div className="flex items-center justify-between gap-2">
                  <span>{status.meta.flow.data.name ?? "—"}</span>
                  <StatusBadge value={status.meta.flow.data.status} />
                </div>
              ) : <MetaError error={errorOf(status.meta.flow)} />}
            </CardContent>
          </Card>

          {/* Secrets */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><KeyRound className="h-4 w-4" /> Edge secrets</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              <p className="text-slate-500 pb-1">Only whether each secret is set is shown. Change them with <code>supabase secrets set</code>.</p>
              {status.secrets.map((s) => (
                <div key={s.name} className="flex items-start gap-2 py-0.5">
                  {s.set ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    : <XCircle className={`h-4 w-4 shrink-0 ${s.required ? "text-rose-600" : "text-slate-400"}`} />}
                  <div>
                    <span className="font-mono">{s.name}</span>
                    {!s.set && <span className={s.required ? "text-rose-700" : "text-slate-500"}> — not set{s.required ? " (required)" : ""}</span>}
                    <p className="text-slate-500">{s.purpose}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Settings */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> Effective settings</CardTitle>
            </CardHeader>
            <CardContent className="text-xs">
              <table className="w-full">
                <tbody>
                  {status.settings.map((s) => (
                    <tr key={s.name} className="border-b last:border-0">
                      <td className="py-1 pr-3 font-mono align-top">{s.name}</td>
                      <td className="py-1 pr-3 font-mono align-top">{s.value}</td>
                      <td className="py-1 align-top text-slate-500">{s.source === "default" ? "default (not set)" : "secret"} · {s.read_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Endpoints */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Webhook className="h-4 w-4" /> Endpoints to register with Meta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {[["Webhook (messages & receipts)", status.webhook_url], ["Flow data endpoint", status.flow_endpoint_url]].map(([label, url]) => (
                <div key={url}>
                  <p className="text-slate-500">{label}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-slate-100 px-3 py-2 font-mono break-all">{url}</code>
                    <button type="button" className="rounded border px-2 py-1.5 hover:bg-slate-50 shrink-0" onClick={() => copy(url)}>Copy</button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
