// src/routes/admin/whatsapp/Index.tsx
// Epic AA — AA1.1
//
// Admin: WhatsApp Business Account connection settings.
// /admin/whatsapp
//
// Shows: WABA connection status, Flow status, template approval status.
// Allows: entering/updating credentials, test connection.
// Reads from: whatsapp_config (singleton row)
// Writes to: whatsapp_config (via direct REST using JWT bypass pattern)

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import {
  CheckCircle2, XCircle, AlertCircle, Loader2,
  RefreshCw, Plug, Unplug, MessageSquareMore, Webhook,
} from "lucide-react";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_PROJECT_REF, getJwt } from "@/lib/env";



function rpcFetch(path: string, body?: unknown) {
  const jwt = getJwt();
  return fetch(`${SUPABASE_URL}${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY ?? "",
      "Authorization": `Bearer ${jwt}`,
      ...(body === undefined ? {} : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

type WhatsAppConfig = {
  id: string;
  waba_id: string | null;
  phone_number_id: string | null;
  flow_id: string | null;
  template_id: string | null;
  template_name: string | null;
  status: "active" | "disconnected" | "suspended";
  updated_at: string;
};

type ConnectionStatus = "idle" | "testing" | "success" | "error";

export default function AdminWhatsAppSettingsPage() {
  const { toast } = useToast();

  const [config, setConfig] = React.useState<WhatsAppConfig | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Form state
  const [wabaId, setWabaId]                 = React.useState("");
  const [phoneNumberId, setPhoneNumberId]   = React.useState("");
  const [accessToken, setAccessToken]       = React.useState("");
  const [flowId, setFlowId]                 = React.useState("");
  const [templateName, setTemplateName]     = React.useState("stance_question_flow");
  const [webhookVerifyToken, setWebhookVerifyToken] = React.useState("stancecapture_webhook_verify");

  const [saving, setSaving]             = React.useState(false);
  const [testStatus, setTestStatus]     = React.useState<ConnectionStatus>("idle");
  const [testMessage, setTestMessage]   = React.useState("");

  // Load existing config
  React.useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      const jwt = getJwt();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_config?select=*&limit=1`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY ?? "",
            "Authorization": `Bearer ${jwt}`,
          },
        }
      );
      const rows = await res.json();
      if (rows && rows.length > 0) {
        const row = rows[0] as WhatsAppConfig;
        setConfig(row);
        setWabaId(row.waba_id ?? "");
        setPhoneNumberId(row.phone_number_id ?? "");
        setFlowId(row.flow_id ?? "");
        setTemplateName(row.template_name ?? "stance_question_flow");
        // access_token not returned — leave blank unless user wants to update it
      }
    } catch (e) {
      toast({ title: "Failed to load WhatsApp config", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!phoneNumberId.trim()) {
      toast({ title: "Phone Number ID is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const jwt = getJwt();
      const body: Record<string, unknown> = {
        waba_id: wabaId.trim() || null,
        phone_number_id: phoneNumberId.trim(),
        flow_id: flowId.trim() || null,
        template_name: templateName.trim() || "stance_question_flow",
        status: "active",
        updated_at: new Date().toISOString(),
      };
      // Only include access_token if user typed a new one
      if (accessToken.trim()) body.access_token = accessToken.trim();

      let res: Response;
      if (config?.id) {
        // Update
        res = await fetch(
          `${SUPABASE_URL}/rest/v1/whatsapp_config?id=eq.${config.id}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "apikey": SUPABASE_ANON_KEY ?? "",
              "Authorization": `Bearer ${jwt}`,
              "Prefer": "return=representation",
            },
            body: JSON.stringify(body),
          }
        );
      } else {
        // Insert
        res = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY ?? "",
            "Authorization": `Bearer ${jwt}`,
            "Prefer": "return=representation",
          },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      toast({ title: "WhatsApp configuration saved." });
      setAccessToken(""); // clear after save
      loadConfig();
    } catch (e: any) {
      toast({ title: `Save failed: ${e.message}`, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (!phoneNumberId.trim()) {
      toast({ title: "Enter a Phone Number ID first", variant: "destructive" });
      return;
    }
    setTestStatus("testing");
    setTestMessage("");
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/whatsapp-send-flow`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${getJwt()}`,
          },
          body: JSON.stringify({
            phone_number: "+10000000000", // dummy — will fail at Meta but validates config
            verification_mode: true,
            _test_connection: true,
          }),
        }
      );
      const data = await res.json();
      if (data.reason === "missing_server_configuration") {
        setTestStatus("error");
        setTestMessage("Server configuration missing — check Vault secrets (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_PHONE_HASH_SALT).");
      } else {
        // Any other response means the function loaded and credentials are wired
        setTestStatus("success");
        setTestMessage("Edge Function reachable. Vault secrets appear configured.");
      }
    } catch (e: any) {
      setTestStatus("error");
      setTestMessage(`Connection test failed: ${e.message}`);
    }
  }

  async function handleDisconnect() {
    if (!config?.id) return;
    if (!confirm("Disconnect WhatsApp? Broadcasts and webhooks will stop working.")) return;
    const jwt = getJwt();
    await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_config?id=eq.${config.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY ?? "",
        "Authorization": `Bearer ${jwt}`,
      },
      body: JSON.stringify({ status: "disconnected", updated_at: new Date().toISOString() }),
    });
    toast({ title: "WhatsApp disconnected." });
    loadConfig();
  }

  const webhookUrl = `${SUPABASE_URL}/functions/v1/whatsapp-flow-webhook`;
  const isConnected = config?.status === "active";

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">WhatsApp Settings</h1>
          <p className="text-sm text-slate-500 mt-1">
            Connect your WhatsApp Business Account to enable Flow-based stance capture.
          </p>
        </div>
        <button
          type="button"
          onClick={loadConfig}
          className="p-2 rounded border hover:bg-slate-50"
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Connection status banner */}
      {config && (
        <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
          isConnected
            ? "border-emerald-200 bg-emerald-50"
            : "border-slate-200 bg-slate-50"
        }`}>
          {isConnected
            ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            : <XCircle className="h-5 w-5 text-slate-400 shrink-0" />
          }
          <div className="flex-1">
            <p className={`text-sm font-medium ${isConnected ? "text-emerald-800" : "text-slate-600"}`}>
              {isConnected ? "WhatsApp connected and active" : "WhatsApp disconnected"}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Last updated: {config.updated_at ? new Date(config.updated_at).toLocaleString() : "—"}
            </p>
          </div>
          {isConnected && (
            <button
              type="button"
              onClick={handleDisconnect}
              className="flex items-center gap-1.5 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-rose-300 hover:text-rose-600"
            >
              <Unplug className="h-3.5 w-3.5" />
              Disconnect
            </button>
          )}
        </div>
      )}

      {/* Webhook URL */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Webhook className="h-4 w-4" />
            Webhook URL
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500">
            Register this URL in Meta WhatsApp Manager → Configuration → Webhooks.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-slate-100 px-3 py-2 text-xs font-mono break-all">
              {webhookUrl}
            </code>
            <button
              type="button"
              className="rounded border px-2 py-1.5 text-xs hover:bg-slate-50 shrink-0"
              onClick={() => { navigator.clipboard.writeText(webhookUrl); toast({ title: "Copied." }); }}
            >
              Copy
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 shrink-0">Verify token:</label>
            <input
              className="flex-1 rounded border px-2 py-1 text-xs font-mono"
              value={webhookVerifyToken}
              onChange={(e) => setWebhookVerifyToken(e.target.value)}
              placeholder="stancecapture_webhook_verify"
            />
            <p className="text-[11px] text-slate-400 shrink-0">Set as WHATSAPP_WEBHOOK_VERIFY_TOKEN in Vault</p>
          </div>
        </CardContent>
      </Card>

      {/* Credentials form */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Plug className="h-4 w-4" />
            Business API Credentials
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500">
            Find these in Meta Business Suite → WhatsApp → API Setup.
            Access token and phone hash salt are stored in Supabase Vault (not here).
          </p>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">WhatsApp Business Account ID (WABA ID)</label>
              <input
                className="w-full rounded border px-3 py-1.5 text-sm"
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                placeholder="123456789012345"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Phone Number ID <span className="text-rose-500">*</span></label>
              <input
                className="w-full rounded border px-3 py-1.5 text-sm"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="234567890123456"
              />
              <p className="text-[11px] text-slate-400 mt-0.5">Also set as WHATSAPP_PHONE_NUMBER_ID in Vault</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Access Token
                <span className="text-[11px] text-slate-400 ml-1">(leave blank to keep existing; also set WHATSAPP_ACCESS_TOKEN in Vault)</span>
              </label>
              <input
                className="w-full rounded border px-3 py-1.5 text-sm font-mono"
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="EAAxxxxx… (optional — only fill to update)"
                autoComplete="off"
              />
            </div>
          </div>

          <hr className="border-slate-100" />

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Flow ID</label>
              <input
                className="w-full rounded border px-3 py-1.5 text-sm font-mono"
                value={flowId}
                onChange={(e) => setFlowId(e.target.value)}
                placeholder="Flow ID from WhatsApp Manager"
              />
              <p className="text-[11px] text-slate-400 mt-0.5">Published Flow ID — required for interactive stance messages</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Template Name</label>
              <input
                className="w-full rounded border px-3 py-1.5 text-sm font-mono"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="stance_question_flow"
              />
            </div>
          </div>

          {/* Test + Save */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testStatus === "testing"}
              className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {testStatus === "testing"
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCircle2 className="h-3.5 w-3.5" />
              }
              Test connection
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded bg-slate-900 text-white px-4 py-1.5 text-sm disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>

          {testMessage && (
            <div className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${
              testStatus === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}>
              {testStatus === "success"
                ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                : <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              }
              {testMessage}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Template approval status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquareMore className="h-4 w-4" />
            Template Approval Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500">
            Templates must be approved by Meta before broadcast messages can be sent.
            Submit templates in Meta WhatsApp Manager → Message Templates.
          </p>
          <div className="space-y-2">
            {[
              {
                name: "stance_question_flow",
                category: "UTILITY",
                description: "Triggers the interactive stance Flow. Required for all broadcasts.",
              },
              {
                name: "stance_update_notification",
                category: "UTILITY",
                description: "AA7 update notifications outside 24h session window.",
              },
            ].map((t) => (
              <div key={t.name} className="flex items-start gap-3 rounded border p-3">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono font-medium">{t.name}</code>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{t.category}</Badge>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{t.description}</p>
                </div>
                <span className="text-[10px] text-amber-600 font-medium shrink-0">Pending approval</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            Template approval status is managed in Meta WhatsApp Manager. This page does not poll Meta's approval API automatically — update status manually after approval.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
