// src/components/question/QuestionCommentsPanel.tsx

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabase } from "@/lib/createSupabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

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
      await createCommentMutation.mutateAsync({
        body,
        parentId: null,
      });
      setNewComment("");
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

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">
          Discussion
        </CardTitle>
        <p className="mt-1 text-xs text-slate-500">
          Share your reasoning, questions, or concerns. Your stance slider captures your position;
          comments capture your thinking.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
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
                      await createCommentMutation.mutateAsync({
                        body: trimmed,
                        parentId: node.id,
                      });
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

  const created = node.created_at
    ? new Date(node.created_at)
    : null;

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
            <div className="mt-2 space-y-1">
              <Textarea
                rows={2}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                className="text-xs"
                placeholder="Write a reply…"
                disabled={submitting}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setIsReplying(false);
                    setReplyText("");
                  }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  size="xs"
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
        <div
          className={cn(
            "mt-1 border-l pl-3 space-y-3",
            depth >= 1 && "ml-4",
            depth >= 2 && "ml-6"
          )}
        >
          {node.children.map((child) => (
            <CommentThread
              key={child.id}
              node={child}
              depth={depth + 1}
              onReply={async (body) => {
                await onReply(body);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
