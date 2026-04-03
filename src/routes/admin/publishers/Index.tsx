// src/routes/admin/publishers/Index.tsx
// Epic T — Publisher approval queue for the admin panel.
//
// Shows all publisher applications (pending, approved, rejected).
// Admins can approve or reject applications. Approved publishers
// get their publisher_ref confirmed and can use the embed widget.
//
// Uses the existing `publishers` table which has:
//   id, name, domains[], contact_email, status (publisher_status enum),
//   publisher_ref, created_at, approved_at

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Globe,
  Mail,
  Copy,
  Loader2,
  ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type PublisherStatus = "pending" | "approved" | "rejected";

interface Publisher {
  id: string;
  name: string;
  domains: string[];
  contact_email: string;
  status: PublisherStatus;
  publisher_ref: string;
  created_at: string;
  approved_at: string | null;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function usePublishers(statusFilter: PublisherStatus | "all") {
  return useQuery<Publisher[]>({
    queryKey: ["admin-publishers", statusFilter],
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from("publishers")
        .select("*")
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Publisher[];
    },
  });
}

function useUpdatePublisherStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "approved" | "rejected";
    }) => {
      const updates: Partial<Publisher> = { status };
      if (status === "approved") {
        updates.approved_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("publishers")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-publishers"] });
    },
  });
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PublisherStatus }) {
  const config = {
    pending: {
      icon: <Clock className="h-3 w-3" />,
      label: "Pending",
      className: "bg-amber-50 text-amber-700 border-amber-200",
    },
    approved: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "Approved",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    rejected: {
      icon: <XCircle className="h-3 w-3" />,
      label: "Rejected",
      className: "bg-red-50 text-red-700 border-red-200",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${config.className}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

// ─── Publisher row ────────────────────────────────────────────────────────────

function PublisherRow({ pub }: { pub: Publisher }) {
  const { mutate: updateStatus, isPending } = useUpdatePublisherStatus();
  const { toast } = useToast();
  const [copiedRef, setCopiedRef] = React.useState(false);

  function handleApprove() {
    updateStatus(
      { id: pub.id, status: "approved" },
      {
        onSuccess: () =>
          toast({ title: `${pub.name} approved.` }),
        onError: (e: any) =>
          toast({
            title: "Update failed",
            description: e?.message,
            variant: "destructive",
          }),
      }
    );
  }

  function handleReject() {
    updateStatus(
      { id: pub.id, status: "rejected" },
      {
        onSuccess: () =>
          toast({ title: `${pub.name} rejected.` }),
        onError: (e: any) =>
          toast({
            title: "Update failed",
            description: e?.message,
            variant: "destructive",
          }),
      }
    );
  }

  async function copyRef() {
    await navigator.clipboard.writeText(pub.publisher_ref);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 1500);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900">{pub.name}</h3>
            <StatusBadge status={pub.status} />
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Applied {new Date(pub.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
            {pub.approved_at && (
              <> · Approved {new Date(pub.approved_at).toLocaleDateString(undefined, { dateStyle: "medium" })}</>
            )}
          </p>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {/* Domains */}
        <div className="flex items-start gap-2">
          <Globe className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            {pub.domains.map((d) => (
              <a
                key={d}
                href={d}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline truncate"
              >
                {d}
                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              </a>
            ))}
          </div>
        </div>

        {/* Contact email */}
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <a
            href={`mailto:${pub.contact_email}`}
            className="text-xs text-slate-600 hover:underline truncate"
          >
            {pub.contact_email}
          </a>
        </div>
      </div>

      {/* Publisher ref */}
      <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
        <code className="text-xs text-slate-600 font-mono flex-1 truncate">
          {pub.publisher_ref}
        </code>
        <button
          type="button"
          onClick={copyRef}
          className="text-xs text-slate-400 hover:text-slate-700 shrink-0 transition-colors"
          title="Copy publisher ref"
        >
          {copiedRef ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Action buttons — only show for pending */}
      {pub.status === "pending" && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleApprove}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            Approve
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:border-red-200 hover:text-red-600 disabled:opacity-50 transition-colors"
          >
            <XCircle className="h-3 w-3" />
            Reject
          </button>
        </div>
      )}

      {/* Re-open rejected */}
      {pub.status === "rejected" && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleApprove}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:border-emerald-200 hover:text-emerald-600 disabled:opacity-50 transition-colors"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            Approve anyway
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
      <p className="text-sm text-slate-400">
        {filter === "pending"
          ? "No pending applications."
          : filter === "approved"
          ? "No approved publishers yet."
          : "No publisher applications yet."}
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Filter = "pending" | "approved" | "rejected" | "all";

const FILTER_LABELS: { value: Filter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export default function AdminPublishersPage() {
  const [filter, setFilter] = React.useState<Filter>("pending");
  const { data: publishers, isLoading, isError } = usePublishers(filter);

  const pendingCount = (publishers ?? []).filter((p) => p.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Publishers</h1>
        <p className="text-xs text-slate-500 mt-1">
          Manage publisher embed applications. Approved publishers can use the embed widget on their sites.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {FILTER_LABELS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={[
              "px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              filter === value
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            {label}
            {value === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          Failed to load publishers. Check your database connection.
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {publishers && publishers.length > 0 ? (
            publishers.map((pub) => <PublisherRow key={pub.id} pub={pub} />)
          ) : (
            <EmptyState filter={filter} />
          )}
        </div>
      )}
    </div>
  );
}
