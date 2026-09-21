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
import ConnectedAccountsSection from "@/auth/ConnectedAccountsSection";
import { useTranslation, Trans } from "react-i18next";

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
  const { t } = useTranslation();
  const { data: request, isLoading } = useDeletionRequest();
  const { mutate: requestDeletion, isPending: requesting, reset: resetRequest } = useRequestDeletion();
  const { mutate: cancelDeletion, isPending: cancelling, reset: resetCancel } = useCancelDeletion();
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
        toast({ title: t("settingsAccount.deletionRequestSubmittedYouHave") });
      },
      onError: () => toast({ title: t("settingsAccount.failedToSubmitRequest"), variant: "destructive" }),
    });
  };

  const handleCancel = () => {
    cancelDeletion(undefined, {
      onSuccess: () => {
        resetRequest();
        resetCancel();
        setConfirmOpen(false);
        setConfirmText("");
        toast({ title: t("settingsAccount.deletionRequestCancelledYourAccount") });
      },
      onError: () => toast({ title: t("settingsAccount.failedToCancelRequest"), variant: "destructive" }),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("common.loading")}
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
                {t("settingsAccount.accountDeletionScheduled")}
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                <Trans
                  i18nKey="settingsAccount.deletionScheduledDetail"
                  values={{
                    requested: formatDate(request.requested_at),
                    execute: formatDate(request.execute_after),
                    days: daysUntil(request.execute_after),
                  }}
                  components={{ b: <span className="font-medium" /> }}
                />
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
            {t("settingsAccount.cancelDeletionRequest")}
          </button>
        </div>
      ) : (
        // No active request
        <>
          <p className="text-xs text-slate-600 leading-relaxed">
            {t("settingsAccount.deletingYourAccountPermanentlyRemoves")}
          </p>
          <ul className="text-xs text-slate-500 space-y-1 pl-4 list-disc">
            <li>{t("settingsAccount.profileAndUsernameAreImmediately")}</li>
            <li>{t("settingsAccount.stancesAreRemovedFromCommunity")}</li>
            <li>{t("settingsAccount.allPersonalDataIsPermanently")}</li>
            <li>{t("settingsAccount.thisActionCannotBeUndone")}</li>
          </ul>

          {!confirmOpen ? (
            <button
              type="button"
              onClick={() => { resetRequest(); setConfirmOpen(true); }}
              className="flex items-center gap-2 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("settingsAccount.requestAccountDeletion")}
            </button>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-xs font-medium text-red-900">
                <Trans
                  i18nKey="settingsAccount.typeDeleteToConfirm"
                  components={{ code: <span className="font-mono font-bold" /> }}
                />
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
                  {t("auth.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleRequest}
                  disabled={confirmText !== "DELETE" || requesting}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {requesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  {t("settingsAccount.requestDeletion")}
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
  const { t } = useTranslation();
  const { data: logs, isLoading } = useConsentLogs();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("settingsAccount.loadingConsentLogs")}
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        {t("settingsAccount.noConsentEventsRecordedYet")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        {t("settingsAccount.theseAreTheDataProcessing")}
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
                {log.granted ? t("settingsAccount.consentGranted") : t("settingsAccount.consentWithdrawn")}
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
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t("settingsAccount.accountData")}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {t("settingsAccount.manageYourAccountReviewConsent")}
        </p>
      </div>

      {/* V4: Connected social accounts */}
      <Section
        title={t("settingsAccount.connectedSocialAccounts")}
        description={t("settingsAccount.signInFasterUsingGoogle")}
      >
        <ConnectedAccountsSection />
      </Section>

      {/* N3: Data export — delegates to My Stances which has the full export UI */}
      <Section
        title={t("settingsAccount.exportYourData")}
        description={t("settingsAccount.downloadACopyOfYour")}
      >
        <div className="flex items-start gap-3">
          <p className="text-xs text-slate-600 leading-relaxed flex-1">
            {t("settingsAccount.yourDataExportIncludesAll")}
          </p>
          <Link
            to="/me/stances"
            className="flex items-center gap-2 shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            {t("settingsAccount.goToMyStances")}
          </Link>
        </div>
        <p className="text-[11px] text-slate-400">
          {t("settingsAccount.theExportOptionIsIn")}
        </p>
      </Section>

      {/* N2: Consent logs */}
      <Section
        title={t("settingsAccount.consentHistory")}
        description={t("settingsAccount.aTransparentLogOfWhat")}
      >
        <ConsentLogsSection />
      </Section>

      {/* N1: Account deletion */}
      <Section
        title={t("settingsAccount.deleteAccount")}
        description={t("settingsAccount.permanentlyDeleteYourAccountAnd")}
      >
        <DeletionSection />
      </Section>
    </div>
  );
}
