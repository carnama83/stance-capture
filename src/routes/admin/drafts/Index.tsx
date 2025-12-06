// src/routes/admin/question-drafts/Index.tsx

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useSupabaseClient } from "@supabase/auth-helpers-react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";

import {
  Loader2,
  Eye,
  Send,
  CheckCircle2,
  XCircle,
  Filter,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

type AdminQuestionDraft = {
  id: string;
  topic_draft_id: string;
  topic_id: string | null;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  status: string; // 'draft' | 'approved' | 'rejected' | etc.
  ai_version: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;

  // From topic_drafts join
  topic_title: string | null;
  topic_summary: string | null;
  topic_tags: string[] | null;
  topic_location_label: string | null;
  topic_status: string | null;
  topic_news_item_id: string | null;

  // From news_items join
  news_title: string | null;
  news_url: string | null;
  news_published_at: string | null;
};

type QuestionDraftDetail = {
  draft: {
    id: string;
    question: string;
    summary: string | null;
    tags: string[] | null;
    location_label: string | null;
    status: string;
    topic_draft_id: string;
    topic_id: string | null;
  };
  topic: {
    id: string;
    title: string;
    summary: string | null;
    tags: string[] | null;
    location_label: string | null;
    status: string;
    news_item_id: string | null;
  } | null;
  news: {
    id: string;
    title: string;
    url: string;
    summary: string | null;
    published_at: string | null;
  } | null;
};

const PAGE_SIZE = 25;

type StatusFilter = "all" | "draft" | "approved" | "rejected";

export default function QuestionDraftsAdminPage() {
  const supabase = useSupabaseClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("draft");
  const [page, setPage] = React.useState(1);

  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewDraftId, setPreviewDraftId] = React.useState<string | null>(
    null
  );

  const [confirmSinglePublishOpen, setConfirmSinglePublishOpen] =
    React.useState(false);
  const [confirmBulkPublishOpen, setConfirmBulkPublishOpen] =
    React.useState(false);

  // Edit fields in preview dialog
  const [editSummary, setEditSummary] = React.useState("");
  const [editTags, setEditTags] = React.useState("");
  const [editLocation, setEditLocation] = React.useState("");

  const queryKey = ["admin-question-drafts", statusFilter, page];

  const {
    data: drafts,
    isLoading,
    isError,
    error,
  } = useQuery<AdminQuestionDraft[], Error>({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_list_question_drafts",
        {
          p_status: statusFilter === "all" ? null : statusFilter,
          p_limit: PAGE_SIZE,
          p_offset: (page - 1) * PAGE_SIZE,
        }
      );
      if (error) throw error;
      return (data ?? []) as AdminQuestionDraft[];
    },
  });

  const {
    data: detail,
    isLoading: isDetailLoading,
    isError: isDetailError,
    error: detailError,
    refetch: refetchDetail,
  } = useQuery<QuestionDraftDetail, Error>({
    queryKey: ["admin-question-draft-detail", previewDraftId],
    enabled: !!previewDraftId && previewOpen,
    queryFn: async () => {
      if (!previewDraftId) throw new Error("No draft id");
      const { data, error } = await supabase.rpc(
        "admin_get_question_draft_detail",
        { p_draft_id: previewDraftId }
      );
      if (error) throw error;
      return data as QuestionDraftDetail;
    },
  });

  const resetPreviewState = () => {
    setPreviewOpen(false);
    setPreviewDraftId(null);
    setConfirmSinglePublishOpen(false);
    setEditSummary("");
    setEditTags("");
    setEditLocation("");
  };

  React.useEffect(() => {
    if (detail?.draft && previewOpen) {
      setEditSummary(detail.draft.summary ?? "");
      setEditTags(detail.draft.tags?.join(", ") ?? "");
      setEditLocation(detail.draft.location_label ?? "");
    }
  }, [detail, previewOpen]);

  const invalidateList = () => {
    queryClient.invalidateQueries({ queryKey });
  };

  const updateDraftMutation = useMutation({
    mutationFn: async () => {
      if (!detail?.draft) throw new Error("No draft to update");
      const tagsArray =
        editTags.trim().length > 0
          ? editTags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : null;

      const { data, error } = await supabase.rpc(
        "admin_update_question_draft",
        {
          p_draft_id: detail.draft.id,
          p_summary: editSummary.trim().length ? editSummary.trim() : null,
          p_tags: tagsArray,
          p_location_label: editLocation.trim().length
            ? editLocation.trim()
            : null,
        }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Draft updated",
        description: "Summary, tags, and location have been saved.",
      });
      invalidateList();
      if (previewDraftId) {
        refetchDetail();
      }
    },
    onError: (err: any) => {
      toast({
        title: "Update failed",
        description: err.message ?? "Could not update draft.",
        variant: "destructive",
      });
    },
  });

  const setStatusMutation = useMutation({
    mutationFn: async (status: "draft" | "approved" | "rejected") => {
      if (!detail?.draft) throw new Error("No draft to update status");
      const { data, error } = await supabase.rpc(
        "admin_set_question_draft_status",
        {
          p_draft_id: detail.draft.id,
          p_status: status,
        }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_, status) => {
      const statusLabel =
        status === "approved"
          ? "Draft approved"
          : status === "rejected"
          ? "Draft rejected"
          : "Status updated";

      toast({
        title: statusLabel,
      });
      invalidateList();
      if (previewDraftId) {
        refetchDetail();
      }
    },
    onError: (err: any) => {
      toast({
        title: "Status update failed",
        description: err.message ?? "Could not update draft status.",
        variant: "destructive",
      });
    },
  });

  const publishSingleMutation = useMutation({
    mutationFn: async () => {
      if (!detail?.draft) throw new Error("No draft to publish");
      const { data, error } = await supabase.rpc(
        "admin_publish_question_draft",
        {
          p_draft_id: detail.draft.id,
        }
      );
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (question) => {
      resetPreviewState();
      invalidateList();

      toast({
        title: "Question published",
        description: "The draft has been published to the live feed.",
        action: (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/questions/${question.id}`)}
          >
            View question
          </Button>
        ),
      });
    },
    onError: (err: any) => {
      toast({
        title: "Publish failed",
        description: err.message ?? "Could not publish this draft.",
        variant: "destructive",
      });
    },
  });

  const bulkPublishMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc(
        "admin_publish_question_drafts_bulk",
        { p_draft_ids: ids }
      );
      if (error) throw error;
      // data is setof questions; treat as array
      return (data ?? []) as { id: string }[];
    },
    onSuccess: (questions) => {
      setSelectedIds([]);
      setConfirmBulkPublishOpen(false);
      invalidateList();

      const count = questions.length;
      const last = questions[questions.length - 1];

      toast({
        title: "Bulk publish complete",
        description: `Published ${count} question${
          count === 1 ? "" : "s"
        } from selected drafts.`,
        action:
          last && last.id ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/questions/${last.id}`)}
            >
              View latest
            </Button>
          ) : undefined,
      });
    },
    onError: (err: any) => {
      setConfirmBulkPublishOpen(false);
      toast({
        title: "Bulk publish failed",
        description:
          err.message ??
          "Some drafts may not have been published. Check statuses and try again.",
        variant: "destructive",
      });
    },
  });

  const onToggleSelectAll = () => {
    if (!drafts || drafts.length === 0) return;

    // Only allow bulk publish of approved drafts
    const approvedIds = drafts
      .filter((d) => d.status === "approved")
      .map((d) => d.id);

    if (approvedIds.length === 0) {
      setSelectedIds([]);
      return;
    }

    if (selectedIds.length === approvedIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(approvedIds);
    }
  };

  const onToggleSelect = (id: string, status: string) => {
    if (status !== "approved") return; // only approved drafts participate in bulk
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const openPreview = (id: string) => {
    setPreviewDraftId(id);
    setPreviewOpen(true);
  };

  const currentStatusBadge = (status: string) => {
    const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs";
    if (status === "approved")
      return (
        <span className={`${base} bg-emerald-100 text-emerald-800`}>
          <CheckCircle2 className="h-3 w-3" />
          Approved
        </span>
      );
    if (status === "rejected")
      return (
        <span className={`${base} bg-red-100 text-red-800`}>
          <XCircle className="h-3 w-3" />
          Rejected
        </span>
      );
    return (
      <span className={`${base} bg-sky-100 text-sky-800`}>
        <Filter className="h-3 w-3" />
        Draft
      </span>
    );
  };

  const selectedApprovedCount = selectedIds.length;
  const hasNextPage =
    drafts && drafts.length === PAGE_SIZE; // simple heuristic

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Question Drafts
          </h1>
          <p className="text-sm text-muted-foreground">
            Review, edit, approve, and publish AI-generated question drafts into
            live questions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Status filter */}
          <div className="inline-flex rounded-full border bg-background p-1 text-xs">
            {(["draft", "approved", "rejected", "all"] as StatusFilter[]).map(
              (opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    setStatusFilter(opt);
                    setPage(1);
                    setSelectedIds([]);
                  }}
                  className={`rounded-full px-3 py-1 transition ${
                    statusFilter === opt
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {opt === "all"
                    ? "All"
                    : opt.charAt(0).toUpperCase() + opt.slice(1)}
                </button>
              )
            )}
          </div>

          {/* Bulk publish button */}
          <Button
            variant="outline"
            size="sm"
            disabled={
              selectedApprovedCount === 0 || bulkPublishMutation.isPending
            }
            onClick={() => setConfirmBulkPublishOpen(true)}
          >
            {bulkPublishMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Publish selected ({selectedApprovedCount})
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="min-w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-left">
              <th className="px-4 py-3">
                <Checkbox
                  aria-label="Select all"
                  checked={
                    drafts &&
                    drafts.length > 0 &&
                    drafts
                      .filter((d) => d.status === "approved")
                      .every((d) => selectedIds.includes(d.id))
                  }
                  onCheckedChange={onToggleSelectAll}
                />
              </th>
              <th className="px-4 py-3">Question</th>
              <th className="px-4 py-3">Topic</th>
              <th className="px-4 py-3">News</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading drafts…</span>
                  </div>
                </td>
              </tr>
            )}

            {isError && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center">
                  <div className="text-sm text-destructive">
                    Failed to load drafts: {error?.message}
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && !isError && drafts && drafts.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center">
                  <div className="text-sm text-muted-foreground">
                    No drafts found for this filter.
                  </div>
                </td>
              </tr>
            )}

            {!isLoading &&
              !isError &&
              drafts &&
              drafts.map((d) => {
                const isSelected = selectedIds.includes(d.id);
                const isApproved = d.status === "approved";

                return (
                  <tr
                    key={d.id}
                    className="border-b last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3 align-top">
                      <Checkbox
                        aria-label="Select draft"
                        checked={isSelected}
                        disabled={!isApproved}
                        onCheckedChange={() => onToggleSelect(d.id, d.status)}
                      />
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="max-w-md text-sm font-medium">
                        {d.question}
                      </div>
                      {d.summary && (
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {d.summary}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="text-sm">
                        {d.topic_title ?? "Untitled topic"}
                      </div>
                      {d.topic_status && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Topic: {d.topic_status}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 align-top">
                      {d.news_title ? (
                        <div className="space-y-1">
                          <div className="line-clamp-1 text-sm">
                            {d.news_title}
                          </div>
                          {d.news_url && (
                            <a
                              href={d.news_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                            >
                              Source
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="text-xs text-muted-foreground">
                        {d.location_label ?? d.topic_location_label ?? "—"}
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="flex max-w-[160px] flex-wrap gap-1">
                        {d.tags?.length ? (
                          d.tags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            No tags
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top">
                      {currentStatusBadge(d.status)}
                    </td>

                    <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                      {new Date(d.created_at).toLocaleString()}
                    </td>

                    <td className="px-4 py-3 align-top text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openPreview(d.id)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Preview
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          disabled={publishSingleMutation.isPending}
                          onClick={() => {
                            openPreview(d.id);
                            setConfirmSinglePublishOpen(false);
                          }}
                        >
                          <Send className="mr-2 h-4 w-4" />
                          Publish
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>
          Page {page}
          {drafts && drafts.length === 0 ? "" : " · " + PAGE_SIZE + " per page"}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={page === 1 || isLoading}
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              setSelectedIds([]);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={!hasNextPage || isLoading}
            onClick={() => {
              setPage((p) => p + 1);
              setSelectedIds([]);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Preview + edit + approve/publish dialog */}
      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetPreviewState();
          } else if (previewDraftId) {
            refetchDetail();
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Preview question draft</DialogTitle>
            <DialogDescription>
              Review and optionally tweak the metadata before approving and
              publishing this question live.
            </DialogDescription>
          </DialogHeader>

          {isDetailLoading && (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading draft…
            </div>
          )}

          {isDetailError && (
            <div className="py-6 text-sm text-destructive">
              Failed to load draft: {detailError?.message}
            </div>
          )}

          {!isDetailLoading && detail && (
            <div className="space-y-6">
              {/* Question block */}
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Question
                </div>
                <div className="mt-1 rounded-md border bg-muted/40 p-3 text-sm">
                  {detail.draft.question}
                </div>
              </div>

              {/* Topic + news */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Topic
                  </div>
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    <div className="font-medium">
                      {detail.topic?.title ?? "Untitled topic"}
                    </div>
                    {detail.topic?.summary && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {detail.topic.summary}
                      </div>
                    )}
                    {detail.topic?.tags?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {detail.topic.tags.map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Source article
                  </div>
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    {detail.news ? (
                      <>
                        <div className="font-medium">
                          {detail.news.title}
                        </div>
                        {detail.news.published_at && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {new Date(
                              detail.news.published_at
                            ).toLocaleString()}
                          </div>
                        )}
                        {detail.news.url && (
                          <a
                            href={detail.news.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                          >
                            Open article
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No linked article.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Location */}
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Location label
                </div>
                <Input
                  className="mt-1"
                  placeholder="e.g. Mahwah, NJ · Bergen County"
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  This controls the location badge users see on the question
                  card.
                </p>
              </div>

              {/* Summary */}
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Summary
                </div>
                <Textarea
                  className="mt-1"
                  rows={3}
                  placeholder="Short description shown on question cards."
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                />
              </div>

              {/* Tags */}
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Tags
                </div>
                <Input
                  className="mt-1"
                  placeholder="Comma-separated tags, e.g. local, zoning, schools"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  These are used for topic / tag fallback and clustering. Leave
                  blank to clear tags.
                </p>
              </div>

              {/* Status pill */}
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Current status:</span>
                  {currentStatusBadge(detail.draft.status)}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={setStatusMutation.isPending}
                    onClick={() => setStatusMutation.mutate("draft")}
                  >
                    {setStatusMutation.isPending &&
                    setStatusMutation.variables === "draft" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Mark draft
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={setStatusMutation.isPending}
                    onClick={() => setStatusMutation.mutate("rejected")}
                  >
                    {setStatusMutation.isPending &&
                    setStatusMutation.variables === "rejected" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Reject
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={setStatusMutation.isPending}
                    onClick={() => setStatusMutation.mutate("approved")}
                  >
                    {setStatusMutation.isPending &&
                    setStatusMutation.variables === "approved" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Approve
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="mt-4 flex items-center justify-between gap-2">
            <Button variant="outline" onClick={resetPreviewState}>
              Close
            </Button>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={
                  updateDraftMutation.isPending || isDetailLoading || !detail
                }
                onClick={() => updateDraftMutation.mutate()}
              >
                {updateDraftMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save changes
              </Button>

              <Button
                disabled={
                  !detail ||
                  detail.draft.status !== "approved" ||
                  publishSingleMutation.isPending
                }
                onClick={() => setConfirmSinglePublishOpen(true)}
              >
                {publishSingleMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Publish question
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm single publish */}
      <AlertDialog
        open={confirmSinglePublishOpen}
        onOpenChange={(open) => setConfirmSinglePublishOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish this question?</AlertDialogTitle>
            <AlertDialogDescription>
              This will publish the approved draft as a live question visible on
              the homepage, topic detail page, and question detail page. You can
              still edit the live question later from the Questions admin page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={publishSingleMutation.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={publishSingleMutation.isPending}
              onClick={() => publishSingleMutation.mutate()}
            >
              {publishSingleMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm bulk publish */}
      <AlertDialog
        open={confirmBulkPublishOpen}
        onOpenChange={(open) => setConfirmBulkPublishOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Publish {selectedApprovedCount} approved draft
              {selectedApprovedCount === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will publish all selected approved drafts using their current
              summary, tags, and location label. Drafts must be approved before
              they can be published.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={bulkPublishMutation.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                selectedApprovedCount === 0 || bulkPublishMutation.isPending
              }
              onClick={() =>
                bulkPublishMutation.mutate([...selectedIds])
              }
            >
              {bulkPublishMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Publish all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
