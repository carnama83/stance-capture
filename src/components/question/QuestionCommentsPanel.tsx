// src/components/question/QuestionCommentsPanel.tsx

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabase } from "@/lib/createSupabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { getSentimentColorHex } from "@/lib/stanceColors";

type QuestionCommentsPanelProps = {
  questionId: string;
};

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

type CommentNode = QuestionCommentRow & {
  children: CommentNode[];
};

// Thread-level sentiment row (matches your table)
type ThreadSentimentRow = {
  question_id: string;
  avg_score: number | null;
  mood_label: string | null;
  mood_score: number | null;
  comment_count: number | null;
  last_run_at: string | null;
};

function buildCommentTree(rows: QuestionCommentRow[]): CommentNode[] {
  const map = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];

  for (const row of rows) {
    map.set(row.id, { ...row, children: [] });
  }

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

export function QuestionCommentsPanel({ questionId }: QuestionCommentsPanelProps) {
  const supabase = React.useMemo(createSupabase, []);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [sessionUserId, setSessionUserId] = React.useState<string | null>(null);
  const [newComment, setNewComment] = React.useState("");
  const [posting, setPosting] = React.useState(false);

  // Fire-and-forget helpers to trigger Edge Functions for sentiment
  const runSentimentWorkers = React.useCallback(
    (commentId: string, body: string) => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

      if (!supabaseUrl) {
        console.warn(
          "[QuestionCommentsPanel] VITE_SUPABASE_URL is not set; skipping sentiment workers."
        );
        return;
      }

      const commentPayload = {
        comment_id: commentId,
        body,
        question_id: questionId,
      };

      (async () => {
        // Per-comment sentiment
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/comment-sentiment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(commentPayload),
          });

          if (!res.ok) {
            console.warn(
              "[QuestionCommentsPanel] comment-sentiment returned non-200",
              res.status
            );
          }
        } catch (err) {
          console.warn(
            "[QuestionCommentsPanel] comment-sentiment call failed",
            err
          );
        }

        // Thread-level sentiment summary
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/thread-sentiment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question_id: questionId }),
          });

          if (!res.ok) {
            console.warn(
              "[QuestionCommentsPanel] thread-sentiment returned non-200",
              res.status
            );
          }
        } catch (err) {
          console.warn(
            "[QuestionCommentsPanel] thread-sentiment call failed",
            err
          );
        }
      })();
    },
    [questionId]
  );

  // Load current user (for gating commenting)
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (cancelled) return;
      if (error || !data?.user) {
        setSessionUserId(null);
      } else {
        setSessionUserId(data.user.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Load comments for this question
  const commentsQuery = useQuery({
    queryKey: ["question-comments", questionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_question_comments", {
        p_question_id: questionId,
      });

      if (error) {
        console.error("list_question_comments error", error);
        throw error;
      }

      return (data ?? []) as QuestionCommentRow[];
    },
  });

  // Load thread-level sentiment summary
  const threadSentimentQuery = useQuery({
    enabled: !!questionId,
    queryKey: ["question-thread-sentiment", questionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("question_comment_sentiment")
        .select("*")
        .eq("question_id", questionId)
        .maybeSingle();

      if (error) {
        // PGRST116 is "Results contain 0 rows"
        // For that case, we just treat it as "no sentiment yet"
        // @ts-ignore - PostgREST error shape
        if (error.code !== "PGRST116") {
          console.error("question_comment_sentiment query error", error);
          throw error;
        }
      }

      return (data ?? null) as ThreadSentimentRow | null;
    },
    staleTime: 30_000,
  });

  const createCommentMutation = useMutation({
    mutationFn: async (args: { body: string; parentId: string | null }) => {
      const { body, parentId } = args;
      const { data, error } = await supabase.rpc("create_question_comment", {
        p_question_id: questionId,
        p_parent_comment_id: parentId,
        p_body: body,
      });

      if (error) {
        console.error("create_question_comment error", error);
        throw error;
      }

      return data as QuestionCommentRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["question-comments", questionId],
      });
      queryClient.invalidateQueries({
        queryKey: ["question-thread-sentiment", questionId],
      });
    },
  });

  const handlePostTopLevel = async () => {
    if (!sessionUserId) {
      toast({
        title: "Sign in to comment",
        description: "You need to be logged in to post a comment.",
        variant: "destructive",
      });
      return;
    }

    const body = newComment.trim();
    if (!body) return;

    try {
      setPosting(true);
      const saved = await createCommentMutation.mutateAsync({
        body,
        parentId: null,
      });
      setNewComment("");

      // Kick off sentiment workers for this new top-level comment
      if (saved?.id) {
        runSentimentWorkers(saved.id, body);
      }
    } catch (err: any) {
      toast({
        title: "Could not post comment",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPosting(false);
    }
  };

  const nodes: CommentNode[] = React.useMemo(
    () => buildCommentTree(commentsQuery.data ?? []),
    [commentsQuery.data]
  );

  const sentiment = threadSentimentQuery.data;
  const moodLabel = sentiment?.mood_label ?? "No mood yet";

  const trendingColor = getSentimentColorHex(
    sentiment?.mood_score ?? sentiment?.avg_score ?? null
  );

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">
          Comments
        </CardTitle>
        <p className="mt-1 text-xs text-slate-500">
          Share your reasoning, questions, or concerns. Your stance slider captures your position;
          comments capture your thinking.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Discussion mood summary */}
        <div className="rounded-md border bg-slate-50 px-3 py-2 text-[11px] flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-semibold text-slate-900">
                Discussion mood
              </span>

              {threadSentimentQuery.isLoading && (
                <span className="text-[11px] text-slate-500">
                  Analyzing comments…
                </span>
              )}

              {!threadSentimentQuery.isLoading && !sentiment && (
                <span className="text-[11px] text-slate-500">
                  No sentiment summary yet. Add a few comments to see the overall mood.
                </span>
              )}

              {!threadSentimentQuery.isLoading && sentiment && (
                <span className="text-[11px] text-slate-700 flex items-center gap-2">
                  <span className="font-medium">Trending</span>
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: trendingColor }}
                  />
                  {sentiment.comment_count != null &&
                    sentiment.comment_count > 0 && (
                      <span className="text-[10px] text-slate-500">
                        {moodLabel && (
                          <>
                            {moodLabel}
                            {" · "}
                          </>
                        )}
                        Based on {sentiment.comment_count} comment
                        {sentiment.comment_count === 1 ? "" : "s"}
                      </span>
                    )}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Top-level composer */}
        <div className="space-y-2">
          <Textarea
            placeholder={
              sessionUserId
                ? "Add a comment..."
                : "Sign in to add a comment."
            }
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            disabled={!sessionUserId || posting}
            rows={3}
            className="text-sm"
          />
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-slate-400">
              Be constructive and respectful. Comments may be used in aggregate to understand
              discussion sentiment.
            </span>
            <Button
              size="sm"
              onClick={handlePostTopLevel}
              disabled={!sessionUserId || posting || !newComment.trim()}
            >
              {posting ? "Posting…" : "Post comment"}
            </Button>
          </div>
        </div>

        {/* Comments list */}
        <div className="border-t pt-3 mt-2">
          {commentsQuery.isLoading && (
            <p className="text-xs text-slate-500">Loading comments…</p>
          )}

          {!commentsQuery.isLoading && nodes.length === 0 && (
            <p className="text-xs text-slate-500">
              No comments yet. Be the first to share your thoughts.
            </p>
          )}

          {nodes.length > 0 && (
            <div className="space-y-3">
              {nodes.map((node) => (
                <CommentThread
                  key={node.id}
                  node={node}
                  depth={0}
                  onReply={async (body) => {
                    if (!sessionUserId) {
                      toast({
                        title: "Sign in to comment",
                        description:
                          "You need to be logged in to reply to comments.",
                        variant: "destructive",
                      });
                      return;
                    }
                    const trimmed = body.trim();
                    if (!trimmed) return;
                    try {
                      const saved = await createCommentMutation.mutateAsync({
                        body: trimmed,
                        parentId: node.id,
                      });

                      // Kick off sentiment workers for this reply
                      if (saved?.id) {
                        runSentimentWorkers(saved.id, trimmed);
                      }
                    } catch (err: any) {
                      toast({
                        title: "Could not post reply",
                        description:
                          err?.message ?? "Please try again.",
                        variant: "destructive",
                      });
                    }
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

type CommentThreadProps = {
  node: CommentNode;
  depth: number;
  onReply: (body: string) => Promise<void> | void;
};

function CommentThread({ node, depth, onReply }: CommentThreadProps) {
  const [isReplying, setIsReplying] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

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

  const created = node.created_at ? new Date(node.created_at) : null;

  const maxDepth = 3;
  const canReply = depth < maxDepth;

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Avatar className="h-7 w-7">
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
            <span className="font-medium text-slate-800">
              {node.user_display ?? "Someone"}
            </span>
            {created && (
              <span>
                {created.toLocaleDateString(undefined, {
                  dateStyle: "medium",
                })}{" "}
                ·{" "}
                {created.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-sm text-slate-800 whitespace-pre-wrap">
            {node.body}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
            {canReply && (
              <button
                type="button"
                className="hover:underline"
                onClick={() => setIsReplying((v) => !v)}
              >
                {isReplying ? "Cancel" : "Reply"}
              </button>
            )}
          </div>
          {isReplying && canReply && (
            <div className="mt-2 space-y-2">
              <Textarea
                rows={2}
                className="text-xs"
                placeholder="Write a reply..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={submitting}
              />
              <div className="flex items-center gap-2 justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsReplying(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmitReply}
                  disabled={submitting || !replyText.trim()}
                >
                  {submitting ? "Replying…" : "Reply"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {node.children.length > 0 && (
        <div className="mt-2 ml-6 border-l pl-4 space-y-3">
          {node.children.map((child) => (
            <CommentThread
              key={child.id}
              node={child}
              depth={depth + 1}
              onReply={onReply}
            />
          ))}
        </div>
      )}
    </div>
  );
}
