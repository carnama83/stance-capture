// src/pages/SettingsAccount.tsx
// Epic N — Security, Compliance & Account Control
// Route: /settings/account
// Covers:
//   N1: Self-serve account deletion with 14-day grace period
//   N2: Consent log viewer (what data was inferred and when)
//   N3: Data export (delegates to existing MyStancesPage export; links there)

import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Trash2, RotateCcw, Download, Shield, AlertTriangle, CheckCircle2, XCircle
} from "lucide-react";
import ConnectedAccountsSection from "@/components/auth/ConnectedAccountsSection";

// ── Types ──────────────────────────────────────────────────────────────────────

type DeletionRequest = {
  id: string;
  user_id: string;
  requested_at: string;
  execute_after: string;
  cancelled_at: string | null;
  executed_at: string | null;
  status: "pending" | "cancelled" | "executed";
};

type ConsentLog = {
  id: string;
  consent_key: string;
  granted: boolean;
  version: string | null;
  created_at: string;
};

// ── Hooks ──────────────────────────────────────────────────────────────────────

function useDeletionRequest() {
  return useQuery<DeletionRequest | null>({
    queryKey: ["deletion-request"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_deletion_request");
      if (error) throw error;
      return (data ?? null) as DeletionRequest | null;
    },
  });
}

function useRequestDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("request_account_deletion");
      if (error) throw error;
      return data as DeletionRequest;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deletion-request"] }),
  });
}

function useCancelDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("cancel_account_deletion");
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deletion-request"] }),
  });
}

function useConsentLogs() {
  return useQuery<ConsentLog[]>({
    queryKey: ["consent-logs"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_consent_logs");
      if (error) throw error;
      return (data ?? []) as ConsentLog[];
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    dateStyle: "long",
  });
}

function daysUntil(iso: string): number {
  return Math.max(
    0,
    Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000),
  );
}

function consentKeyLabel(key: string): string {
  const labels: Record<string, string> = {
    ip_region_inference: "IP-based region inference",
    analytics: "Analytics",
    marketing: "Marketing communications",
    terms_of_service: "Terms of service",
    privacy_policy: "Privacy policy",
  };
  return labels[key] ?? key.replace(/_/g, " ");
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

// ── N1: Deletion section ───────────────────────────────────────────────────────

function DeletionSection() {
  const { data: request, isLoading } = useDeletionRequest();
  const { mutate: requestDeletion, isPending: requesting } = useRequestDeletion();
  const { mutate: cancelDeletion, isPending: cancelling } = useCancelDeletion();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");

  const hasPending = request?.status === "pending";

  const handleRequest = () => {
    if (confirmText !== "DELETE") return;
    requestDeletion(undefined, {
      onSuccess: () => {
        setConfirmOpen(false);
        setConfirmText("");
        toast({ title: "Deletion request submitted. You have 14 days to cancel." });
      },
      onError: () => toast({ title: "Failed to submit request.", variant: "destructive" }),
    });
  };

  const handleCancel = () => {
    cancelDeletion(undefined, {
      onSuccess: () => toast({ title: "Deletion request cancelled. Your account is safe." }),
      onError: () => toast({ title: "Failed to cancel request.", variant: "destructive" }),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasPending ? (
        // Active deletion request — show status + cancel option
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-900">
                Account deletion scheduled
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Requested on {formatDate(request.requested_at)}. Your account and all data
                will be permanently deleted on{" "}
                <span className="font-medium">{formatDate(request.execute_after)}</span>{" "}
                ({daysUntil(request.execute_after)} days remaining).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 transition-colors disabled:opacity-50"
          >
            {cancelling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Cancel deletion request
          </button>
        </div>
      ) : (
        // No active request
        <>
          <p className="text-xs text-slate-600 leading-relaxed">
            Deleting your account permanently removes your profile, all stances,
            comments, and activity history. You have a 14-day grace period to
            change your mind after requesting deletion.
          </p>
          <ul className="text-xs text-slate-500 space-y-1 pl-4 list-disc">
            <li>Profile and username are immediately hidden</li>
            <li>Stances are removed from community aggregates after 14 days</li>
            <li>All personal data is permanently wiped after the grace period</li>
            <li>This action cannot be undone after the grace period</li>
          </ul>

          {!confirmOpen ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="flex items-center gap-2 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Request account deletion
            </button>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-xs font-medium text-red-900">
                Type <span className="font-mono font-bold">DELETE</span> to confirm
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-300"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setConfirmOpen(false); setConfirmText(""); }}
                  className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRequest}
                  disabled={confirmText !== "DELETE" || requesting}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {requesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Request deletion
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── N2: Consent log section ────────────────────────────────────────────────────

function ConsentLogsSection() {
  const { data: logs, isLoading } = useConsentLogs();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading consent logs…
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No consent events recorded yet. Logs appear here when you grant or
        withdraw consent for data processing activities.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        These are the data processing activities you have consented to or
        withdrawn consent from.
      </p>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
        {logs.map((log) => (
          <div
            key={log.id}
            className="flex items-center gap-3 px-4 py-3 bg-white"
          >
            {log.granted ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-red-400 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-800">
                {consentKeyLabel(log.consent_key)}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {log.granted ? "Consent granted" : "Consent withdrawn"}
                {log.version ? ` · v${log.version}` : ""}{" "}
                · {formatDate(log.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsAccount() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Account & Data</h2>
        <p className="text-sm text-slate-500 mt-1">
          Manage your account, review consent history, and export or delete your data.
        </p>
      </div>

      {/* V4: Connected social accounts */}
      <Section
        title="Connected social accounts"
        description="Sign in faster using Google, Facebook, or Apple."
      >
        <ConnectedAccountsSection />
      </Section>

      {/* N3: Data export — delegates to My Stances which has the full export UI */}
      <Section
        title="Export your data"
        description="Download a copy of your stances, history, and activity."
      >
        <div className="flex items-start gap-3">
          <p className="text-xs text-slate-600 leading-relaxed flex-1">
            Your data export includes all questions you've answered, your stance
            history, change log, and any rationale you've written. Available as
            CSV or JSON.
          </p>
          <Link
            to="/me/stances"
            className="flex items-center gap-2 shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Go to My Stances
          </Link>
        </div>
        <p className="text-[11px] text-slate-400">
          The export option is in the top-right of the My Stances page.
        </p>
      </Section>

      {/* N2: Consent logs */}
      <Section
        title="Consent history"
        description="A transparent log of what data processing you have consented to."
      >
        <ConsentLogsSection />
      </Section>

      {/* N1: Account deletion */}
      <Section
        title="Delete account"
        description="Permanently delete your account and all associated data."
      >
        <DeletionSection />
      </Section>
    </div>
  );
}
