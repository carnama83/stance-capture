// src/routes/admin/fb-campaigns/Queue.tsx
// Posting queue (PDD v1.2 §6, §12). Due and upcoming tasks across campaigns.
//
// Copy content / Open group never change a task's status (AC07). Only Claim,
// Record post URL, Submitted for approval, Rejected and Skip do, through
// admin_social_job_action. Status is admin-reported, not Facebook-verified.
// Tasks more than 60 minutes overdue are marked missed by cron and are not
// re-issued in a burst; a post made late can still be recorded.

import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, Hand, Undo2, Link2, Send, SkipForward, XCircle } from "lucide-react";
import {
  Job, PageHeader, Pill, Loading, ErrorBox, jobTone, btnPrimary, btnSecondary, rpc, errMsg, fmtLocal, useAsk,
} from "./shared";

type Range = "due" | "today" | "open";

function useQueue(range: Range) {
  return useQuery<Job[]>({
    queryKey: ["fb-queue", range],
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const horizon = range === "due" ? 60 * 60_000 : range === "today" ? 24 * 3600_000 : 30 * 86400_000;
      const { data, error } = await (supabase as any)
        .from("social_campaign_jobs")
        .select("*, social_group_directory(name, url, requires_post_approval), social_posting_identities(label, kind), social_campaigns!inner(name, status, timezone)")
        .in("status", ["scheduled", "claimed", "submitted", "missed"])
        .in("social_campaigns.status", ["active", "paused"])
        .lte("scheduled_at", new Date(Date.now() + horizon).toISOString())
        .gte("scheduled_at", new Date(Date.now() - 3 * 86400_000).toISOString())
        .order("scheduled_at")
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Job[];
    },
  });
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function JobCard({ j }: { j: Job }) {
  const qc = useQueryClient();
  const [ask, dialog] = useAsk();
  const { toast } = useToast();
  const tz = j.social_campaigns?.timezone ?? "Asia/Kolkata";
  const overdue = (j.status === "scheduled" || j.status === "claimed") && new Date(j.scheduled_at).getTime() < Date.now();
  const paused = j.social_campaigns?.status === "paused";

  const act = useMutation({
    mutationFn: async (action: string) => {
      let url: string | null = null;
      let note: string | null = null;
      if (action === "posted") {
        url = await ask({ title: "Record the post", label: "Facebook post URL", placeholder: "https://www.facebook.com/groups/…/posts/…", required: true, confirmLabel: "Record" });
        if (!url) return;
      }
      if (action === "skip") {
        note = await ask({ title: "Skip this task", label: "Why is it being skipped?", required: true, confirmLabel: "Skip" });
        if (!note) return;
      }
      if (action === "rejected") {
        note = await ask({ title: "Rejected by the group admins", label: "Note (optional)", confirmLabel: "Record rejection" });
        if (note === null) return;
      }
      await rpc("admin_social_job_action", { p_job_id: j.id, p_action: action, p_url: url, p_note: note });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fb-queue"] }),
    onError: (e) => toast({ title: "Could not update task", description: errMsg(e), variant: "destructive" }),
  });

  const doCopy = async (text: string, what: string) => {
    toast({ title: (await copy(text)) ? `${what} copied` : "Copy failed: select the text manually" });
  };

  const openUrl = j.destination_kind === "group"
    ? j.social_group_directory?.url
    : "https://business.facebook.com/latest/composer";

  return (
    <div className={`rounded-xl border bg-white p-4 space-y-3 ${overdue ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-900">
              {j.destination_kind === "page" ? "Stance Capture Page" : j.social_group_directory?.name}
            </span>
            <Pill tone={jobTone(j.status)}>{j.status}</Pill>
            {overdue && <Pill tone="amber">Overdue</Pill>}
            {paused && <Pill tone="amber">Campaign paused</Pill>}
            {j.destination_kind === "group" && j.social_group_directory?.requires_post_approval && <Pill>Needs group approval</Pill>}
          </div>
          <p className="text-xs text-slate-500">
            {fmtLocal(j.scheduled_at, tz)} · {j.language_code}
            {j.social_posting_identities ? ` · post as ${j.social_posting_identities.label}` : ""}
            {" · "}
            <Link to={`/admin/fb-campaigns/${j.campaign_id}`} className="hover:underline">{j.social_campaigns?.name}</Link>
          </p>
        </div>
      </div>

      <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 font-sans">{j.caption_snapshot}</pre>
      {j.link_mode === "comment" && j.link_url && (
        <p className="text-xs text-slate-600">
          This group allows links only in comments: post the text, then add <span className="font-mono">{j.link_url}</span> as the first comment.
        </p>
      )}
      {j.link_mode === "none" && <p className="text-xs text-amber-700">Text-only: this group does not allow links. Visits from it will not be tracked.</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={() => doCopy(j.caption_snapshot, "Caption")}><Copy className="h-3.5 w-3.5" /> Copy content</button>
        {j.link_mode === "comment" && j.link_url && (
          <button type="button" className={btnSecondary} onClick={() => doCopy(j.link_url!, "Link")}><Link2 className="h-3.5 w-3.5" /> Copy link</button>
        )}
        {openUrl && (
          <a href={openUrl} target="_blank" rel="noopener noreferrer" className={btnSecondary}>
            <ExternalLink className="h-3.5 w-3.5" /> {j.destination_kind === "group" ? "Open group" : "Open Business Suite"}
          </a>
        )}
        <span className="flex-1" />
        {j.status === "scheduled" && !paused && (
          <button type="button" className={btnSecondary} disabled={act.isPending} onClick={() => act.mutate("claim")}><Hand className="h-3.5 w-3.5" /> Claim</button>
        )}
        {j.status === "claimed" && (
          <button type="button" className={btnSecondary} disabled={act.isPending} onClick={() => act.mutate("release")}><Undo2 className="h-3.5 w-3.5" /> Release</button>
        )}
        {(j.status === "scheduled" || j.status === "claimed" || j.status === "missed") && j.destination_kind === "group" && j.social_group_directory?.requires_post_approval && (
          <button type="button" className={btnSecondary} disabled={act.isPending} onClick={() => act.mutate("submitted")}><Send className="h-3.5 w-3.5" /> Submitted for approval</button>
        )}
        {j.status === "submitted" && (
          <button type="button" className={btnSecondary} disabled={act.isPending} onClick={() => act.mutate("rejected")}><XCircle className="h-3.5 w-3.5" /> Rejected</button>
        )}
        {(j.status === "scheduled" || j.status === "claimed" || j.status === "missed") && (
          <button type="button" className={btnSecondary} disabled={act.isPending} onClick={() => act.mutate("skip")}><SkipForward className="h-3.5 w-3.5" /> Skip</button>
        )}
        {j.status !== "posted" && (
          <button type="button" className={btnPrimary} disabled={act.isPending} onClick={() => act.mutate("posted")}><Link2 className="h-3.5 w-3.5" /> Record post URL</button>
        )}
      </div>
      {dialog}
    </div>
  );
}

export default function FbQueuePage() {
  const [range, setRange] = React.useState<Range>("today");
  const { data, isLoading, isError, error } = useQueue(range);
  const tab = (r: Range, label: string) => (
    <button type="button" onClick={() => setRange(r)}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${range === r ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Posting queue"
        sub="Post each task on Facebook yourself, then record the post URL. Copying or opening a group does not mark a task as posted. Keep to the identity limits: posting the same link across many groups quickly is a common trigger for Facebook spam restrictions."
      />
      <div className="flex gap-2">
        {tab("due", "Due now")}
        {tab("today", "Next 24 hours")}
        {tab("open", "All open")}
      </div>
      {isLoading && <Loading />}
      {isError && <ErrorBox>{errMsg(error)}</ErrorBox>}
      <div className="space-y-3">
        {(data ?? []).map((j) => <JobCard key={j.id} j={j} />)}
        {data && data.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">Nothing in this window.</div>
        )}
      </div>
    </div>
  );
}
