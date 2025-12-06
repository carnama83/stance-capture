import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

type DraftStatus = "draft" | "approved" | "rejected";

type AdminQuestionDraft = {
  draft_id: string;
  topic_draft_id: string | null;
  topic_id: string | null;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  status: DraftStatus;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;

  topic_title: string | null;
  topic_location_label: string | null;
  topic_status: string | null;

  news_title: string | null;
  news_url: string | null;
  news_published_at: string | null;
};

type Question = {
  id: string;
  question: string;
  summary: string | null;
  tags: string[];
  location_label: string | null;
  published_at: string;
  status: string;
};

type DraftDetail = AdminQuestionDraft;

const STATUS_FILTERS: { label: string; value: "all" | DraftStatus }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

export default function QuestionDraftsAdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<"all" | DraftStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [showBulkPublishConfirm, setShowBulkPublishConfirm] = useState(false);

  // === LIST QUERY ===
  const {
    data: drafts,
    isLoading,
    isError,
    error,
  } = useQuery<AdminQuestionDraft[], Error>({
    queryKey: ["admin_question_drafts", statusFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_list_question_drafts",
        {
          p_status: statusFilter === "all" ? null : statusFilter,
        }
      );
      if (error) throw error;
      return (data || []) as AdminQuestionDraft[];
    },
  });

  const filteredDrafts = useMemo(() => {
    if (!drafts) return [];
    if (!search.trim()) return drafts;

    const q = search.toLowerCase();
    return drafts.filter((d) => {
      const fields = [
        d.question,
        d.summary || "",
        d.location_label || "",
        d.topic_title || "",
        d.topic_location_label || "",
        d.news_title || "",
        d.news_url || "",
        ...(d.tags || []),
      ]
        .join(" ")
        .toLowerCase();

      return fields.includes(q);
    });
  }, [drafts, search]);

  const allVisibleSelected =
    filteredDrafts.length > 0 &&
    filteredDrafts.every((d) => selectedIds.includes(d.draft_id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filteredDrafts.map((d) => d.draft_id));
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.has(id)));
    } else {
      const visibleIds = filteredDrafts.map((d) => d.draft_id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleRowSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const openDraft = (id: string) => {
    setActiveDraftId(id);
  };

  const closeDraft = () => {
    setActiveDraftId(null);
  };

  // === DETAIL QUERY ===
  const {
    data: draftDetail,
    isLoading: isDetailLoading,
  } = useQuery<DraftDetail | null, Error>({
    queryKey: ["admin_question_draft_detail", activeDraftId],
    queryFn: async () => {
      if (!activeDraftId) return null;
      const { data, error } = await supabase.rpc(
        "admin_get_question_draft_detail",
        { p_draft_id: activeDraftId }
      );
      if (error) throw error;
      if (!data) return null;
      // assuming RPC returns a single row
      return data as DraftDetail;
    },
    enabled: !!activeDraftId,
  });

  // Local edit state for "edit before publish"
  const [editSummary, setEditSummary] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editLocationLabel, setEditLocationLabel] = useState("");

  // Reset edit fields whenever the detail changes
  React.useEffect(() => {
    if (draftDetail) {
      setEditSummary(draftDetail.summary || "");
      setEditTags((draftDetail.tags || []).join(", "));
      setEditLocationLabel(draftDetail.location_label || "");
    }
  }, [draftDetail]);

  // === MUTATIONS ===

  const updateDraftMutation = useMutation({
    mutationFn: async (vars: {
      draftId: string;
      summary: string;
      tags: string[];
      locationLabel: string | null;
    }) => {
      const { error } = await supabase.rpc("admin_update_question_draft", {
        p_draft_id: vars.draftId,
        p_summary: vars.summary || null,
        p_tags: vars.tags,
        p_location_label: vars.locationLabel,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_question_drafts"] });
      queryClient.invalidateQueries({
        queryKey: ["admin_question_draft_detail"],
      });
      toast({
        title: "Draft updated",
        description: "Summary, tags and location were saved.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Update failed",
        description: err?.message ?? "Error updating draft",
        variant: "destructive",
      });
    },
  });

  const setStatusMutation = useMutation({
    mutationFn: async (vars: { draftId: string; status: DraftStatus }) => {
      const { error } = await supabase.rpc("admin_set_question_draft_status", {
        p_draft_id: vars.draftId,
        p_status: vars.status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_question_drafts"] });
      queryClient.invalidateQueries({
        queryKey: ["admin_question_draft_detail"],
      });
      toast({
        title: "Status updated",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Status update failed",
        description: err?.message ?? "Error updating draft status",
        variant: "destructive",
      });
    },
  });

  const publishSingleMutation = useMutation({
    mutationFn: async (draftId: string): Promise<Question> => {
      const { data, error } = await supabase.rpc(
        "admin_publish_question_draft",
        { p_draft_id: draftId }
      );
      if (error) throw error;
      return data as Question;
    },
    onSuccess: (question) => {
      queryClient.invalidateQueries({ queryKey: ["admin_question_drafts"] });
      queryClient.invalidateQueries({
        queryKey: ["admin_question_draft_detail"],
      });
      toast({
        title: "Question published",
        description: (
          <div className="space-y-1">
            <div>{question.question}</div>
            <Link
              to={`/questions/${question.id}`}
              className="underline font-medium"
            >
              View live question
            </Link>
          </div>
        ) as any,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Publish failed",
        description: err?.message ?? "Error publishing question",
        variant: "destructive",
      });
    },
  });

  const bulkPublishMutation = useMutation({
    mutationFn: async (draftIds: string[]) => {
      if (draftIds.length === 0) return { success: 0, failed: 0 };

      // Prefer bulk RPC if you created it; fall back to per-draft loop.
      try {
        const { data, error } = await supabase.rpc(
          "admin_publish_question_drafts_bulk",
          { p_draft_ids: draftIds }
        );
        if (error) throw error;
        const questions = (data || []) as Question[];
        return { success: questions.length, failed: draftIds.length - questions.length };
      } catch {
        // Fallback: sequential publish
        let success = 0;
        let failed = 0;
        for (const id of draftIds) {
          const { error } = await supabase.rpc("admin_publish_question_draft", {
            p_draft_id: id,
          });
          if (error) {
            failed += 1;
          } else {
            success += 1;
          }
        }
        return { success, failed };
      }
    },
    onSuccess: ({ success, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["admin_question_drafts"] });
      toast({
        title: "Bulk publish complete",
        description: `${success} published, ${failed} failed.`,
        variant: failed ? "destructive" : "default",
      });
      setSelectedIds([]);
    },
    onError: (err: any) => {
      toast({
        title: "Bulk publish failed",
        description: err?.message ?? "Error publishing questions",
        variant: "destructive",
      });
    },
  });

  const handleSaveEdits = () => {
    if (!draftDetail) return;
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    updateDraftMutation.mutate({
      draftId: draftDetail.draft_id,
      summary: editSummary,
      tags,
      locationLabel: editLocationLabel || null,
    });
  };

  const handleSetStatus = (status: DraftStatus) => {
    if (!draftDetail) return;
    setStatusMutation.mutate({ draftId: draftDetail.draft_id, status });
  };

  const handlePublishSingle = () => {
    if (!draftDetail) return;
    publishSingleMutation.mutate(draftDetail.draft_id);
  };

  const handleBulkPublishConfirm = () => {
    setShowBulkPublishConfirm(true);
  };

  const confirmBulkPublish = () => {
    setShowBulkPublishConfirm(false);
    if (selectedIds.length === 0) return;
    bulkPublishMutation.mutate(selectedIds);
  };

  // === RENDER ===

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Question Drafts</h1>
          <p className="text-sm text-muted-foreground">
            Review, tweak, approve, and publish AI-generated questions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Search question, topic, tags, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Status:{" "}
                {
                  STATUS_FILTERS.find((f) => f.value === statusFilter)?.label ??
                  "All"
                }
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {STATUS_FILTERS.map((f) => (
                <DropdownMenuItem
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                >
                  {f.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            disabled={filteredDrafts.length === 0}
            onClick={toggleSelectAllVisible}
          >
            {allVisibleSelected ? "Unselect visible" : "Select visible"}
          </Button>

          <Button
            size="sm"
            disabled={selectedIds.length === 0 || bulkPublishMutation.isLoading}
            onClick={handleBulkPublishConfirm}
          >
            Bulk publish ({selectedIds.length})
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="flex items-center bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
          <div className="w-10 flex items-center">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
            />
          </div>
          <div className="flex-1">Question</div>
          <div className="w-40">Topic</div>
          <div className="w-40">News</div>
          <div className="w-28">Location</div>
          <div className="w-24">Status</div>
          <div className="w-32">Created</div>
          <div className="w-24 text-right">Actions</div>
        </div>

        {isLoading && (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        )}

        {isError && (
          <div className="p-4 text-sm text-destructive">
            Failed to load drafts: {error?.message}
          </div>
        )}

        {!isLoading && !isError && filteredDrafts.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No drafts found.
          </div>
        )}

        {!isLoading &&
          !isError &&
          filteredDrafts.map((d) => {
            const isSelected = selectedIds.includes(d.draft_id);
            return (
              <div
                key={d.draft_id}
                className={cn(
                  "flex items-center border-t px-3 py-2 text-sm hover:bg-muted/60 cursor-pointer",
                  isSelected && "bg-muted/80"
                )}
                onClick={(e) => {
                  // avoid row click when toggling checkbox or clicking button
                  const target = e.target as HTMLElement;
                  if (
                    target.closest("input[type=checkbox]") ||
                    target.closest("button")
                  ) {
                    return;
                  }
                  openDraft(d.draft_id);
                }}
              >
                <div className="w-10 flex items-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={isSelected}
                    onChange={() => toggleRowSelection(d.draft_id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                <div className="flex-1 pr-3">
                  <div className="font-medium line-clamp-1">{d.question}</div>
                  {d.summary && (
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {d.summary}
                    </div>
                  )}
                  {d.tags && d.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.tags.slice(0, 3).map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                      {d.tags.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{d.tags.length - 3} more
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="w-40 pr-3">
                  <div className="text-xs font-medium line-clamp-1">
                    {d.topic_title || "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground line-clamp-1">
                    {d.topic_location_label || ""}
                  </div>
                </div>

                <div className="w-40 pr-3">
                  <div className="text-xs line-clamp-1">
                    {d.news_title || "—"}
                  </div>
                  {d.news_url && (
                    <a
                      href={d.news_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-muted-foreground underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Source
                    </a>
                  )}
                </div>

                <div className="w-28 pr-3 text-xs">
                  {d.location_label || "—"}
                </div>

                <div className="w-24 pr-3">
                  <StatusPill status={d.status} />
                </div>

                <div className="w-32 pr-3 text-xs text-muted-foreground">
                  {new Date(d.created_at).toLocaleString()}
                </div>

                <div className="w-24 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDraft(d.draft_id);
                    }}
                  >
                    Review
                  </Button>
                </div>
              </div>
            );
          })}
      </div>

      {/* DETAIL DIALOG */}
      <Dialog open={!!activeDraftId} onOpenChange={(open) => !open && closeDraft()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review Question Draft</DialogTitle>
            <DialogDescription>
              Preview, tweak details, approve and publish this question.
            </DialogDescription>
          </DialogHeader>

          {isDetailLoading && (
            <div className="py-6 text-sm text-muted-foreground">
              Loading draft…
            </div>
          )}

          {!isDetailLoading && !draftDetail && (
            <div className="py-6 text-sm text-muted-foreground">
              Draft not found.
            </div>
          )}

          {!isDetailLoading && draftDetail && (
            <div className="space-y-5 py-2">
              {/* Top meta */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusPill status={draftDetail.status} />
                <span className="text-muted-foreground">
                  Created {new Date(draftDetail.created_at).toLocaleString()}
                </span>
                {draftDetail.topic_title && (
                  <Badge variant="outline">
                    Topic: {draftDetail.topic_title}
                  </Badge>
                )}
                {draftDetail.location_label && (
                  <Badge variant="outline">
                    Question location: {draftDetail.location_label}
                  </Badge>
                )}
              </div>

              {/* Question */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">
                  Question
                </div>
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  {draftDetail.question}
                </div>
              </div>

              {/* News preview */}
              {(draftDetail.news_title || draftDetail.news_url) && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">
                    Source article
                  </div>
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                    <div className="font-medium">
                      {draftDetail.news_title || "Untitled article"}
                    </div>
                    {draftDetail.news_url && (
                      <a
                        href={draftDetail.news_url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline text-muted-foreground"
                      >
                        Open article
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Editable fields */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Summary (optional)
                  </label>
                  <textarea
                    className="w-full rounded-md border px-3 py-2 text-sm min-h-[80px]"
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Tags (comma separated)
                  </label>
                  <Input
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="politics, election, economy"
                  />
                  <label className="text-xs font-semibold text-muted-foreground mt-2">
                    Location label (user-visible)
                  </label>
                  <Input
                    value={editLocationLabel}
                    onChange={(e) => setEditLocationLabel(e.target.value)}
                    placeholder="e.g., Mahwah, NJ or United States"
                  />
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t pt-4">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveEdits}
                    disabled={updateDraftMutation.isLoading}
                  >
                    Save edits
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={setStatusMutation.isLoading}
                      >
                        Set status
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() => handleSetStatus("draft")}
                      >
                        Mark as draft
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleSetStatus("approved")}
                      >
                        Mark as approved
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleSetStatus("rejected")}
                      >
                        Mark as rejected
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={closeDraft}
                    type="button"
                  >
                    Close
                  </Button>
                  <AlertDialog>
                    <AlertDialogTriggerButton
                      disabled={publishSingleMutation.isLoading}
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Publish this question?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This will create a live question from this draft. You
                          can still archive or edit the live question later, but
                          users may start answering it immediately.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handlePublishSingle}>
                          Publish
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* BULK PUBLISH CONFIRM */}
      <AlertDialog
        open={showBulkPublishConfirm}
        onOpenChange={setShowBulkPublishConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Publish {selectedIds.length} selected draft
              {selectedIds.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will publish all selected drafts as live questions. Make sure
              they are approved and edited as needed before continuing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBulkPublish}
              disabled={bulkPublishMutation.isLoading}
            >
              Publish {selectedIds.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusPill({ status }: { status: DraftStatus }) {
  const color =
    status === "approved"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : status === "rejected"
      ? "bg-red-100 text-red-800 border-red-200"
      : "bg-slate-100 text-slate-800 border-slate-200";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        color
      )}
    >
      {status}
    </span>
  );
}

// Tiny helper so we can use AlertDialog as a button
function AlertDialogTriggerButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { disabled?: boolean }
) {
  return (
    <AlertDialogTrigger asChild>
      <Button size="sm" {...props}>
        Publish
      </Button>
    </AlertDialogTrigger>
  );
}

// Re-export from shadcn since we used asChild pattern above
// (If your AlertDialogTrigger is exported elsewhere, adjust this import)
function AlertDialogTrigger(props: { asChild?: boolean; children: React.ReactNode }) {
  // This dummy is here just to make TS happy in this standalone file.
  // In your actual project, you should import { AlertDialogTrigger } from "@/components/ui/alert-dialog".
  return <>{props.children}</>;
}
