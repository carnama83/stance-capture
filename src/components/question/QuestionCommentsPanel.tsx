// src/components/question/QuestionCommentsPanel.tsx
// Epic G — Discussion & Civility
// G1: threaded comments (existing, preserved)
// G2: upvote/downvote reactions + Most Helpful / Latest sorting (new)
// G3: civility warning via OpenAI moderation before posting (new)
// G4: report button with reason selection (new)

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";
import { getSentimentColorHex } from "@/lib/stanceColors";
import { ThumbsUp, ThumbsDown, Flag, AlertTriangle } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type QuestionCommentRow = {
  id: string;
  question_id: string;
  parent_id: string | null;
  user_id: string;
  user_display: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  profile_random_id: string | null;
  profile_username: string | null;
  profile_display_handle_mode: string | null;
  profile_avatar_url: string | null;
};

type CommentNode = QuestionCommentRow & { children: CommentNode[] };

type ReactionRow = {
  comment_id: string;
  up_count: number;
  down_count: number;
  my_reaction: string | null;
};

type ThreadSentimentRow = {
  question_id: string;
  avg_sentiment: number | null;
  sentiment_variance: number | null;
  comment_count: number | null;
  summary_text: string | null;
  model: string | null;
  last_run_at: string | null;
};

type SortMode = "latest" | "helpful";

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildCommentTree(rows: QuestionCommentRow[]): CommentNode[] {
  const map = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];
  for (const row of rows) map.set(row.id, { ...row, children: [] });
  for (const row of rows) {
    const node = map.get(row.id)!;
    if (row.parent_id && map.has(row.parent_id)) {
      map.get(row.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function describeMood(avg: number | null | undefined): string {
  if (avg == null || Number.isNaN(avg)) return "No mood yet";
  if (avg <= -0.3) return "Mostly critical";
  if (avg < 0.3) return "Mixed / divided";
  return "Mostly supportive";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

// G3: Call OpenAI moderation API via our Edge Function proxy
// Returns true if the text is flagged as potentially harmful
async function checkCivility(text: string, commentId?: string, userId?: string): Promise<boolean> {
  try {
    const sb = getSupabase();
    if (!sb) return false;
    const { data, error } = await sb.functions.invoke("check-comment-civility", {
      body: { text, comment_id: commentId ?? null, user_id: userId ?? null },
    });
    if (error) return false;
    return data?.flagged === true;
  } catch {
    return false; // fail open — don't block posting if check fails
  }
}

const REPORT_REASONS = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "other", label: "Other" },
];

// ── ReportModal ────────────────────────────────────────────────────────────────

function ReportModal({
  commentId,
  onClose,
}: {
  commentId: string;
  onClose: () => void;
}) {
  const sb = getSupabase()!;
  const { toast } = useToast();
  const [reason, setReason] = React.useState("spam");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { error } = await sb.rpc("report_comment", {
        p_comment_id: commentId,
        p_reason: reason,
      });
      if (error) throw error;
      setDone(true);
      setTimeout(onClose, 2000);
    } catch {
      toast({ title: "Could not submit report. Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-5 w-80 space-y-4">
        {done ? (
          <div className="text-center space-y-2">
            <p className="text-sm font-medium text-slate-900">Report submitted</p>
            <p className="text-xs text-slate-500">Thank you. Our team will review this comment.</p>
          </div>
        ) : (
          <>
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-0.5">Report comment</p>
              <p className="text-xs text-slate-500">Why are you reporting this comment?</p>
            </div>
            <div className="space-y-2">
              {REPORT_REASONS.map((r) => (
                <label key={r.value} className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="accent-slate-900"
                  />
                  <span className="text-sm text-slate-700">{r.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button size="sm" variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit report"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── CommentThread ──────────────────────────────────────────────────────────────

type CommentThreadProps = {
  node: CommentNode;
  depth: number;
  reactions: Record<string, ReactionRow>;
  sessionUserId: string | null;
  onReply: (body: string) => Promise<void>;
  onReact: (commentId: string, reaction: "up" | "down") => Promise<void>;
};

function CommentThread({
  node,
  depth,
  reactions,
  sessionUserId,
  onReply,
  onReact,
}: CommentThreadProps) {
  const [isReplying, setIsReplying] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [reportingId, setReportingId] = React.useState<string | null>(null);

  const maxDepth = 3;
  const canReply = depth < maxDepth;
  const r = reactions[node.id];

  const handleSubmitReply = async () => {
    const body = replyText.trim();
    if (!body) return;
    setSubmitting(true);
    try {
      await onReply(body);
      setReplyText("");
      setIsReplying(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      {reportingId && (
        <ReportModal commentId={reportingId} onClose={() => setReportingId(null)} />
      )}

      <div className="flex items-start gap-2">
        <Avatar className="h-7 w-7 flex-shrink-0">
          {node.profile_avatar_url ? (
            <AvatarImage src={node.profile_avatar_url} alt={node.user_display ?? ""} />
          ) : (
            <AvatarFallback className="text-[10px]">
              {getInitials(node.user_display)}
            </AvatarFallback>
          )}
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="font-medium text-slate-800">{node.user_display ?? "Someone"}</span>
            <span>{timeAgo(node.created_at)}</span>
          </div>

          <div className="mt-0.5 text-sm text-slate-800 whitespace-pre-wrap leading-snug">
            {node.body}
          </div>

          {/* G2: Reactions + actions row */}
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500">
            {/* Upvote */}
            <button
              type="button"
              onClick={() => sessionUserId && onReact(node.id, "up")}
              className={[
                "flex items-center gap-1 hover:text-slate-900 transition-colors",
                r?.my_reaction === "up" ? "text-emerald-600 font-medium" : "",
                !sessionUserId ? "opacity-50 cursor-default" : "",
              ].join(" ")}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              <span>{r?.up_count ?? 0}</span>
            </button>

            {/* Downvote */}
            <button
              type="button"
              onClick={() => sessionUserId && onReact(node.id, "down")}
              className={[
                "flex items-center gap-1 hover:text-slate-900 transition-colors",
                r?.my_reaction === "down" ? "text-red-500 font-medium" : "",
                !sessionUserId ? "opacity-50 cursor-default" : "",
              ].join(" ")}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              <span>{r?.down_count ?? 0}</span>
            </button>

            {/* Reply */}
            {canReply && (
              <button
                type="button"
                className="hover:text-slate-900 transition-colors"
                onClick={() => setIsReplying((v) => !v)}
              >
                {isReplying ? "Cancel" : "Reply"}
              </button>
            )}

            {/* G4: Report */}
            {sessionUserId && (
              <button
                type="button"
                className="flex items-center gap-1 hover:text-red-500 transition-colors ml-auto"
                onClick={() => setReportingId(node.id)}
                aria-label="Report comment"
              >
                <Flag className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Reply composer */}
          {isReplying && canReply && (
            <div className="mt-2 space-y-2">
              <Textarea
                rows={2}
                className="text-xs"
                placeholder="Write a reply…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={submitting}
              />
              <div className="flex items-center gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setIsReplying(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSubmitReply} disabled={submitting || !replyText.trim()}>
                  {submitting ? "Replying…" : "Reply"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Nested children */}
      {node.children.length > 0 && (
        <div className="mt-2 ml-6 border-l pl-4 space-y-3">
          {node.children.map((child) => (
            <CommentThread
              key={child.id}
              node={child}
              depth={depth + 1}
              reactions={reactions}
              sessionUserId={sessionUserId}
              onReply={onReply}
              onReact={onReact}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── QuestionCommentsPanel ──────────────────────────────────────────────────────

export function QuestionCommentsPanel({ questionId }: { questionId: string }) {
  const sb = getSupabase()!;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [sessionUserId, setSessionUserId] = React.useState<string | null>(null);
  const [newComment, setNewComment] = React.useState("");
  const [posting, setPosting] = React.useState(false);
  const [sortMode, setSortMode] = React.useState<SortMode>("latest");
  // G3: civility warning state
  const [civilityWarning, setCivilityWarning] = React.useState(false);
  const [checkingCivility, setCheckingCivility] = React.useState(false);

  // Sentiment workers (fire-and-forget — preserved from original)
  const runSentimentWorkers = React.useCallback((commentId: string, body: string) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!supabaseUrl) return;
    const payload = { comment_id: commentId, body, question_id: questionId };
    void fetch(`${supabaseUrl}/functions/v1/comment-sentiment`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }).catch(() => {});
    void fetch(`${supabaseUrl}/functions/v1/thread-sentiment`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question_id: questionId }),
    }).catch(() => {});
  }, [questionId]);

  React.useEffect(() => {
    sb.auth.getUser().then(({ data }) => setSessionUserId(data?.user?.id ?? null));
  }, [sb]);

  // Comments query
  const commentsQuery = useQuery({
    queryKey: ["question-comments", questionId],
    queryFn: async () => {
      const { data, error } = await sb.rpc("list_question_comments", { p_question_id: questionId });
      if (error) throw error;
      return (data ?? []) as QuestionCommentRow[];
    },
  });

  // Thread sentiment
  const threadSentimentQuery = useQuery({
    enabled: !!questionId,
    queryKey: ["question-thread-sentiment", questionId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("question_comment_sentiment")
        .select("*")
        .eq("question_id", questionId)
        .maybeSingle();
      if (error && (error as any).code !== "PGRST116") throw error;
      return (data ?? null) as ThreadSentimentRow | null;
    },
    staleTime: 30_000,
  });

  // G2: Reactions query
  const allCommentIds = React.useMemo(
    () => (commentsQuery.data ?? []).map((c) => c.id),
    [commentsQuery.data],
  );

  const reactionsQuery = useQuery({
    queryKey: ["comment-reactions", questionId, allCommentIds.join(",")],
    enabled: allCommentIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("get_comment_reactions", { p_comment_ids: allCommentIds });
      if (error) throw error;
      const map: Record<string, ReactionRow> = {};
      for (const row of (data ?? []) as ReactionRow[]) map[row.comment_id] = row;
      return map;
    },
  });

  const reactions = reactionsQuery.data ?? {};

  // G2: React mutation
  const reactMutation = useMutation({
    mutationFn: async ({ commentId, reaction }: { commentId: string; reaction: "up" | "down" }) => {
      const { data, error } = await sb.rpc("upsert_comment_reaction", {
        p_comment_id: commentId,
        p_reaction: reaction,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comment-reactions", questionId] });
    },
  });

  // Create comment mutation
  const createCommentMutation = useMutation({
    mutationFn: async ({ body, parentId }: { body: string; parentId: string | null }) => {
      const { data, error } = await sb.rpc("create_question_comment", {
        p_question_id: questionId,
        p_parent_comment_id: parentId,
        p_body: body,
      });
      if (error) throw error;
      return data as QuestionCommentRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["question-comments", questionId] });
      queryClient.invalidateQueries({ queryKey: ["question-thread-sentiment", questionId] });
    },
  });

  // G3: Post with civility check
  const handlePostTopLevel = async () => {
    if (!sessionUserId) {
      toast({ title: "Sign in to comment", variant: "destructive" });
      return;
    }
    const body = newComment.trim();
    if (!body) return;

    // If warning already shown, allow posting anyway (user confirmed)
    if (!civilityWarning) {
      setCheckingCivility(true);
      const flagged = await checkCivility(body);
      setCheckingCivility(false);
      if (flagged) {
        setCivilityWarning(true);
        return; // show warning, don't post yet
      }
    }

    // Post
    setCivilityWarning(false);
    setPosting(true);
    try {
      const saved = await createCommentMutation.mutateAsync({ body, parentId: null });
      setNewComment("");
      if (saved?.id) {
        runSentimentWorkers(saved.id, body);
        // H2: fire background toxicity score write with the real comment_id
        checkCivility(body, saved.id, sessionUserId ?? undefined);
      }
    } catch (err: any) {
      toast({ title: "Could not post comment", description: err?.message ?? "Please try again.", variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  // Build and sort tree
  const rawNodes = React.useMemo(
    () => buildCommentTree(commentsQuery.data ?? []),
    [commentsQuery.data],
  );

  const sortedNodes = React.useMemo(() => {
    if (sortMode === "helpful") {
      return [...rawNodes].sort((a, b) => {
        const aScore = (reactions[a.id]?.up_count ?? 0) - (reactions[a.id]?.down_count ?? 0);
        const bScore = (reactions[b.id]?.up_count ?? 0) - (reactions[b.id]?.down_count ?? 0);
        return bScore - aScore;
      });
    }
    return [...rawNodes].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [rawNodes, sortMode, reactions]);

  const sentiment = threadSentimentQuery.data;
  const avg = sentiment?.avg_sentiment ?? null;
  const trendingColor = getSentimentColorHex(avg);

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Comments</CardTitle>
        <p className="mt-1 text-xs text-slate-500">
          Share your reasoning, questions, or concerns. Your stance slider captures your position;
          comments capture your thinking.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Discussion mood */}
        {(sentiment || threadSentimentQuery.isLoading) && (
          <div className="rounded-md border bg-slate-50 px-3 py-2 text-[11px] flex items-center gap-2">
            <span className="font-semibold text-slate-900">Discussion mood</span>
            {threadSentimentQuery.isLoading ? (
              <span className="text-slate-500">Analyzing…</span>
            ) : sentiment ? (
              <>
                <span className="inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: trendingColor }} />
                <span className="text-slate-600">{describeMood(avg)}</span>
                {sentiment.comment_count != null && sentiment.comment_count > 0 && (
                  <span className="text-slate-400">· {sentiment.comment_count} comment{sentiment.comment_count === 1 ? "" : "s"}</span>
                )}
              </>
            ) : null}
          </div>
        )}

        {/* Composer */}
        <div className="space-y-2">
          <Textarea
            placeholder={sessionUserId ? "Add a comment…" : "Sign in to add a comment."}
            value={newComment}
            onChange={(e) => { setNewComment(e.target.value); setCivilityWarning(false); }}
            disabled={!sessionUserId || posting || checkingCivility}
            rows={3}
            className="text-sm"
          />

          {/* G3: Civility warning */}
          {civilityWarning && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-medium text-amber-800">
                  Your comment may contain language that could be seen as harmful.
                </p>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  Please review and edit it, or post anyway if you believe it's appropriate.
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="text-[11px] text-slate-400">
              Be constructive and respectful.
            </span>
            <div className="flex items-center gap-2">
              {civilityWarning && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setCivilityWarning(false); setPosting(false); void handlePostTopLevel(); }}
                  disabled={posting}
                  className="text-amber-700 border-amber-300"
                >
                  Post anyway
                </Button>
              )}
              <Button
                size="sm"
                onClick={handlePostTopLevel}
                disabled={!sessionUserId || posting || checkingCivility || !newComment.trim()}
              >
                {checkingCivility ? "Checking…" : posting ? "Posting…" : civilityWarning ? "Edit comment" : "Post comment"}
              </Button>
            </div>
          </div>
        </div>

        {/* G2: Sort controls */}
        {sortedNodes.length > 1 && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 border-t pt-3">
            <span>Sort:</span>
            {(["latest", "helpful"] as SortMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSortMode(m)}
                className={[
                  "capitalize transition-colors",
                  sortMode === m ? "font-medium text-slate-900" : "hover:text-slate-700",
                ].join(" ")}
              >
                {m === "latest" ? "Latest" : "Most Helpful"}
              </button>
            ))}
          </div>
        )}

        {/* Comments list */}
        <div className={sortedNodes.length > 1 ? "" : "border-t pt-3 mt-2"}>
          {commentsQuery.isLoading && <p className="text-xs text-slate-500">Loading comments…</p>}
          {!commentsQuery.isLoading && sortedNodes.length === 0 && (
            <p className="text-xs text-slate-500">No comments yet. Be the first to share your thoughts.</p>
          )}
          {sortedNodes.length > 0 && (
            <div className="space-y-4">
              {sortedNodes.map((node) => (
                <CommentThread
                  key={node.id}
                  node={node}
                  depth={0}
                  reactions={reactions}
                  sessionUserId={sessionUserId}
                  onReply={async (body) => {
                    if (!sessionUserId) { toast({ title: "Sign in to reply", variant: "destructive" }); return; }
                    const saved = await createCommentMutation.mutateAsync({ body, parentId: node.id });
                    if (saved?.id) runSentimentWorkers(saved.id, body);
                  }}
                  onReact={async (commentId, reaction) => {
                    await reactMutation.mutateAsync({ commentId, reaction });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
