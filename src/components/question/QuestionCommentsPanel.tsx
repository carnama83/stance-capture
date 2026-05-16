// src/components/question/QuestionCommentsPanel.tsx
// Epic G — Discussion & Civility
// G1: threaded comments (existing, preserved)
// G2: upvote/downvote reactions + Most Helpful / Latest sorting (new)
// G3: civility warning via OpenAI moderation before posting (new)
// G4: report button with reason selection (new)
// M-G01: inline comment edit with update_comment() RPC (new)
// M-G02: soft-delete with tombstone render via delete_comment() RPC (new)
// M-G03: URL highlighting in composers (contenteditable) + linkified body render (new)
// M-G05: cursor-based pagination — root comments paged, replies always full (new)

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";
import { getSentimentColorHex } from "@/lib/stanceColors";
import { ThumbsUp, ThumbsDown, Flag, AlertTriangle, Pencil, Trash2, Loader2 } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

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

// Cursor state for root comment pagination
type PageCursor = {
  created_at: string;
  id: string;
} | null;

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

// ── URL regex ─────────────────────────────────────────────────────────────────
// Matches http(s):// URLs and bare www. URLs. Used in both the body renderer
// and the contenteditable highlighter.

const URL_RE = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[^\s<>"']{2,}/g;

// ── M-G03: linkifyText — render comment body with clickable links ──────────────
// Splits plain text on URL_RE and returns an array of React nodes.
// Non-URL segments are plain strings; URL segments become <a> tags.

function linkifyText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const url = m[0];
    const href = url.startsWith("http") ? url : `https://${url}`;
    nodes.push(
      <a
        key={m.index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline underline-offset-2 break-all hover:text-blue-800"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>,
    );
    last = m.index + url.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// ── M-G03: RichCommentInput — contenteditable with inline URL highlighting ────
// Behaves like a textarea but highlights URLs blue as the user types or pastes.
// Stores raw plain text internally; exposes it via the `inputRef` handle.
//
// Key implementation notes:
//   - innerText is used to read/write plain text — avoids HTML injection risks.
//   - Caret position is saved before re-render and restored after, using a
//     TreeWalker over text nodes. This is the only reliable cross-browser method.
//   - URL_RE is re-instantiated (lastIndex reset) on each highlight call to
//     avoid stateful regex bugs in the closure.
//   - paste event: strip HTML from clipboard, insert plain text, then highlight.
//   - disabled state: contentEditable="false" + visual opacity.

export type RichCommentInputHandle = {
  /** Returns the current plain-text content. */
  getText: () => string;
  /** Clears the editor. */
  clear: () => void;
  /** Sets editor content to the given plain text and re-highlights. */
  setText: (text: string) => void;
  focus: () => void;
};

type RichCommentInputProps = {
  placeholder?: string;
  initialValue?: string;
  disabled?: boolean;
  minHeight?: number;
  className?: string;
  /** Called on every content change with the current plain-text value. */
  onChange?: (text: string) => void;
};

const RichCommentInput = React.forwardRef<RichCommentInputHandle, RichCommentInputProps>(
  function RichCommentInput(
    { placeholder = "Add a comment…", initialValue = "", disabled = false, minHeight = 72, className = "", onChange },
    ref,
  ) {
    const divRef = React.useRef<HTMLDivElement>(null);
    // Track whether we're mid-highlight to avoid recursive input events
    const highlighting = React.useRef(false);

    // ── Caret helpers ──────────────────────────────────────────────────────────

    function getCaretOffset(el: HTMLDivElement): number {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return 0;
      const range = sel.getRangeAt(0).cloneRange();
      range.selectNodeContents(el);
      range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
      return range.toString().length;
    }

    function setCaretOffset(el: HTMLDivElement, offset: number): void {
      const sel = window.getSelection();
      if (!sel) return;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let remaining = offset;
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (remaining <= node.length) {
          const range = document.createRange();
          range.setStart(node, remaining);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        remaining -= node.length;
      }
      // Fallback: place caret at end
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // ── Highlight ──────────────────────────────────────────────────────────────

    function highlight(el: HTMLDivElement): void {
      if (highlighting.current) return;
      highlighting.current = true;

      const offset = getCaretOffset(el);
      const text = el.innerText;

      // Build new child nodes
      const fragment = document.createDocumentFragment();
      let last = 0;
      const re = new RegExp(URL_RE.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) {
          fragment.appendChild(document.createTextNode(text.slice(last, m.index)));
        }
        const span = document.createElement("span");
        span.className = "url-highlight";
        span.style.cssText =
          "color:#2563eb;text-decoration:underline;text-underline-offset:2px;word-break:break-all;";
        span.textContent = m[0];
        fragment.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(last)));
      }

      el.innerHTML = "";
      el.appendChild(fragment);
      setCaretOffset(el, offset);

      highlighting.current = false;
    }

    // ── Imperative handle ──────────────────────────────────────────────────────

    React.useImperativeHandle(ref, () => ({
      getText: () => divRef.current?.innerText ?? "",
      clear: () => {
        if (!divRef.current) return;
        divRef.current.innerText = "";
        onChange?.("");
      },
      setText: (text: string) => {
        if (!divRef.current) return;
        divRef.current.innerText = text;
        highlight(divRef.current);
        onChange?.(text);
      },
      focus: () => divRef.current?.focus(),
    }));

    // ── Mount: set initial value and highlight ─────────────────────────────────

    React.useEffect(() => {
      if (divRef.current && initialValue) {
        divRef.current.innerText = initialValue;
        highlight(divRef.current);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // intentionally only on mount

    // ── Event handlers ─────────────────────────────────────────────────────────

    function handleInput() {
      if (!divRef.current || highlighting.current) return;
      highlight(divRef.current);
      onChange?.(divRef.current.innerText);
    }

    function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
      e.preventDefault();
      // Strip HTML from clipboard, insert as plain text
      const plain = e.clipboardData.getData("text/plain");
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      sel.deleteFromDocument();
      sel.getRangeAt(0).insertNode(document.createTextNode(plain));
      sel.collapseToEnd();
      if (divRef.current) {
        highlight(divRef.current);
        onChange?.(divRef.current.innerText);
      }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
      // Prevent Enter from inserting a <div> (default contenteditable behaviour).
      // Single Enter creates a newline via the browser's default insertText —
      // that is the desired behaviour for multi-line comments.
      // If Enter-to-submit is needed in future, add that logic here.
      if (e.key === "Enter" && !e.shiftKey) {
        // Allow default — browser inserts a newline text node, not a <div>
      }
    }

    return (
      <div
        ref={divRef}
        contentEditable={disabled ? "false" : "true"}
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder}
        aria-disabled={disabled}
        spellCheck
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        style={{ minHeight }}
        className={[
          "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "leading-relaxed whitespace-pre-wrap break-words outline-none",
          "focus:ring-1 focus:ring-ring focus:border-ring",
          disabled ? "opacity-50 cursor-not-allowed" : "",
          // Placeholder via CSS — shown when div is empty
          "empty:before:content-[attr(aria-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />
    );
  },
);

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildCommentTree(rows: QuestionCommentRow[]): CommentNode[] {
  const map = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];
  for (const row of rows) map.set(row.id, { ...row, children: [] });
  for (const row of rows) {
    const node = map.get(row.id)!;
    if (row.parent_id && map.has(row.parent_id)) {
      map.get(row.parent_id)!.children.push(node);
    } else if (!row.parent_id) {
      roots.push(node);
    }
    // Replies whose parent isn't in the map (edge case) are silently dropped
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

// ── DeleteConfirmInline ────────────────────────────────────────────────────────
// Inline confirm strip — no modal, renders beneath the comment body.

function DeleteConfirmInline({
  onConfirm,
  onCancel,
  deleting,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-600">
      <span>Delete this comment?</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={deleting}
        className="font-medium text-red-600 hover:text-red-700 transition-colors disabled:opacity-50"
      >
        {deleting ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={deleting}
        className="hover:text-slate-900 transition-colors"
      >
        Cancel
      </button>
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
  // M-G01
  onEdit: (commentId: string, newBody: string) => Promise<void>;
  // M-G02
  onDelete: (commentId: string) => Promise<void>;
};

function CommentThread({
  node,
  depth,
  reactions,
  sessionUserId,
  onReply,
  onReact,
  onEdit,
  onDelete,
}: CommentThreadProps) {
  const [isReplying, setIsReplying] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [reportingId, setReportingId] = React.useState<string | null>(null);

  // M-G01: edit state
  const editInputRef = React.useRef<RichCommentInputHandle>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editDirty, setEditDirty] = React.useState(false);
  const [savingEdit, setSavingEdit] = React.useState(false);

  // M-G02: delete confirm state
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const maxDepth = 3;
  const canReply = depth < maxDepth;
  const isOwn = sessionUserId !== null && node.user_id === sessionUserId;
  // M-G02: tombstone — deleted comments show placeholder, no actions
  const isDeleted = node.is_deleted;
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

  // M-G01: open edit mode — seed RichCommentInput with current body
  const handleOpenEdit = () => {
    setIsEditing(true);
    setEditDirty(false);
    setIsReplying(false);
    setConfirmingDelete(false);
  };

  // M-G01: save edit
  const handleSaveEdit = async () => {
    const trimmed = (editInputRef.current?.getText() ?? "").trim();
    if (!trimmed || trimmed === node.body) {
      setIsEditing(false);
      return;
    }
    setSavingEdit(true);
    try {
      await onEdit(node.id, trimmed);
      setIsEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  // M-G02: confirm delete
  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(node.id);
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div className="space-y-2">
      {reportingId && (
        <ReportModal commentId={reportingId} onClose={() => setReportingId(null)} />
      )}

      <div className="flex items-start gap-2">
        {/* Avatar — kept even for tombstone so indentation holds */}
        <Avatar className="h-7 w-7 flex-shrink-0">
          {!isDeleted && node.profile_avatar_url ? (
            <AvatarImage src={node.profile_avatar_url} alt={node.user_display ?? ""} />
          ) : (
            <AvatarFallback className="text-[10px] bg-slate-100 text-slate-400">
              {isDeleted ? "·" : getInitials(node.user_display)}
            </AvatarFallback>
          )}
        </Avatar>

        <div className="flex-1 min-w-0">
          {/* M-G02: tombstone — no author, no actions, just placeholder */}
          {isDeleted ? (
            <p className="text-[11px] text-slate-400 italic">[deleted]</p>
          ) : (
            <>
              {/* Header: display name + timestamp + edited indicator */}
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="font-medium text-slate-800">{node.user_display ?? "Someone"}</span>
                <span>{timeAgo(node.created_at)}</span>
                {/* M-G01: edited_at indicator */}
                {node.edited_at && (
                  <span className="text-slate-400 italic">· edited {timeAgo(node.edited_at)}</span>
                )}
              </div>

              {/* M-G01: edit composer (RichCommentInput) replaces body when active */}
              {isEditing ? (
                <div className="mt-1 space-y-2">
                  <RichCommentInput
                    ref={editInputRef}
                    initialValue={node.body}
                    disabled={savingEdit}
                    minHeight={60}
                    onChange={(text) =>
                      setEditDirty(text.trim() !== node.body && text.trim().length > 0)
                    }
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditing(false)}
                      disabled={savingEdit}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveEdit}
                      disabled={savingEdit || !editDirty}
                    >
                      {savingEdit ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                /* M-G03: linkified body render */
                <div className="mt-0.5 text-sm text-slate-800 whitespace-pre-wrap leading-snug break-words">
                  {linkifyText(node.body)}
                </div>
              )}

              {/* M-G02: inline delete confirm strip */}
              {confirmingDelete && !isEditing && (
                <DeleteConfirmInline
                  onConfirm={handleConfirmDelete}
                  onCancel={() => setConfirmingDelete(false)}
                  deleting={deleting}
                />
              )}

              {/* G2: Reactions + actions row — hidden while editing or confirming delete */}
              {!isEditing && !confirmingDelete && (
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

                  {/* M-G01: Edit — own comments only */}
                  {isOwn && (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-slate-900 transition-colors"
                      onClick={handleOpenEdit}
                      aria-label="Edit comment"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}

                  {/* M-G02: Delete — own comments only */}
                  {isOwn && (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-red-500 transition-colors"
                      onClick={() => {
                        setConfirmingDelete(true);
                        setIsReplying(false);
                        setIsEditing(false);
                      }}
                      aria-label="Delete comment"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}

                  {/* G4: Report — other users' comments only */}
                  {sessionUserId && !isOwn && (
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
              )}

              {/* Reply composer — Textarea (short replies, URLs rare) */}
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
            </>
          )}
        </div>
      </div>

      {/* Nested children — always rendered, even under tombstone, to preserve threading */}
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
              onEdit={onEdit}
              onDelete={onDelete}
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
  const [posting, setPosting] = React.useState(false);
  const [sortMode, setSortMode] = React.useState<SortMode>("latest");
  // G3: civility warning state
  const [civilityWarning, setCivilityWarning] = React.useState(false);
  const [checkingCivility, setCheckingCivility] = React.useState(false);

  // M-G03: ref for the top-level composer RichCommentInput
  const newCommentRef = React.useRef<RichCommentInputHandle>(null);
  // Track whether the top-level composer has content (for button disabled state)
  const [newCommentHasContent, setNewCommentHasContent] = React.useState(false);

  // M-G05: accumulated root pages + cursor state
  const [allRoots, setAllRoots] = React.useState<QuestionCommentRow[]>([]);
  const [cursor, setCursor] = React.useState<PageCursor>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);

  // Sentiment workers (fire-and-forget — preserved from original)
  const runSentimentWorkers = React.useCallback((commentId: string, body: string) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!supabaseUrl) return;
    const payload = { comment_id: commentId, body, question_id: questionId };
    void fetch(`${supabaseUrl}/functions/v1/comment-sentiment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
    void fetch(`${supabaseUrl}/functions/v1/thread-sentiment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId }),
    }).catch(() => {});
  }, [questionId]);

  React.useEffect(() => {
    sb.auth.getUser().then(({ data }) => setSessionUserId(data?.user?.id ?? null));
  }, [sb]);

  // M-G05: fetch first page of root comments on mount / when questionId changes
  const rootsQuery = useQuery({
    queryKey: ["question-comments-roots", questionId],
    queryFn: async () => {
      const { data, error } = await sb.rpc("list_root_comments_page", {
        p_question_id: questionId,
        p_limit: PAGE_SIZE,
        p_before_created_at: null,
        p_before_id: null,
      });
      if (error) throw error;
      return (data ?? []) as QuestionCommentRow[];
    },
    staleTime: 0, // always refetch after mutations
  });

  // When first page loads, initialise allRoots and cursor
  React.useEffect(() => {
    if (!rootsQuery.data) return;
    const page = rootsQuery.data;
    setAllRoots(page);
    setHasMore(page.length === PAGE_SIZE);
    if (page.length > 0) {
      const last = page[page.length - 1];
      setCursor({ created_at: last.created_at, id: last.id });
    } else {
      setCursor(null);
    }
  }, [rootsQuery.data]);

  // M-G05: derive root IDs for the replies query
  const rootIds = React.useMemo(() => allRoots.map((r) => r.id), [allRoots]);

  // M-G05: fetch all replies for loaded roots (re-fetches automatically when rootIds changes)
  const repliesQuery = useQuery({
    queryKey: ["question-comments-replies", questionId, rootIds.join(",")],
    enabled: rootIds.length > 0,
    queryFn: async () => {
      const { data, error } = await sb.rpc("list_replies_for_roots", {
        p_question_id: questionId,
        p_root_ids: rootIds,
      });
      if (error) throw error;
      return (data ?? []) as QuestionCommentRow[];
    },
    staleTime: 30_000,
  });

  // M-G05: merge roots + replies into flat list for tree builder
  const allComments = React.useMemo((): QuestionCommentRow[] => {
    const replies = repliesQuery.data ?? [];
    // Roots are already newest-first from the RPC; tree builder needs all rows flat
    return [...allRoots, ...replies];
  }, [allRoots, repliesQuery.data]);

  // M-G05: load next page of root comments
  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data, error } = await sb.rpc("list_root_comments_page", {
        p_question_id: questionId,
        p_limit: PAGE_SIZE,
        p_before_created_at: cursor.created_at,
        p_before_id: cursor.id,
      });
      if (error) throw error;
      const page = (data ?? []) as QuestionCommentRow[];
      setAllRoots((prev) => {
        // Deduplicate by id in case of concurrent posts
        const existingIds = new Set(prev.map((r) => r.id));
        const fresh = page.filter((r) => !existingIds.has(r.id));
        return [...prev, ...fresh];
      });
      setHasMore(page.length === PAGE_SIZE);
      if (page.length > 0) {
        const last = page[page.length - 1];
        setCursor({ created_at: last.created_at, id: last.id });
      }
    } catch (err: any) {
      toast({
        title: "Could not load more comments",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingMore(false);
    }
  };

  // M-G05: reset pagination when mutations invalidate the roots query
  // Called after create and delete — resets to page 1 so the new/removed
  // comment is immediately reflected at the top of the list.
  const resetPagination = React.useCallback(() => {
    setAllRoots([]);
    setCursor(null);
    setHasMore(false);
    queryClient.invalidateQueries({ queryKey: ["question-comments-roots", questionId] });
    queryClient.invalidateQueries({ queryKey: ["question-comments-replies", questionId] });
  }, [queryClient, questionId]);

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

  // All comment IDs (roots + replies) for reactions batch fetch
  const allCommentIds = React.useMemo(
    () => allComments.map((c) => c.id),
    [allComments],
  );

  // M-G06: Realtime subscription — invalidate reactions when any reaction changes
  // for a comment currently in view. comment_reactions has no question_id column
  // so we subscribe unfiltered and check the payload comment_id against the
  // current allCommentIds set. removeChannel only — never realtime.disconnect().
  React.useEffect(() => {
    if (!sb || allCommentIds.length === 0) return;

    const commentIdSet = new Set(allCommentIds);

    const channel = sb
      .channel(`comment-reactions-${questionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "comment_reactions",
        },
        (payload) => {
          // Extract comment_id from whichever record is available
          const record = (payload.new ?? payload.old) as { comment_id?: string } | null;
          if (!record?.comment_id) return;
          // Only invalidate if the reaction belongs to a comment we're showing
          if (!commentIdSet.has(record.comment_id)) return;
          queryClient.invalidateQueries({ queryKey: ["comment-reactions", questionId] });
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`[comments:realtime] ${status} qId=${questionId.slice(0, 8)}`);
        }
      });

    return () => {
      // removeChannel only — do NOT call sb.realtime.disconnect() here.
      // disconnect() destroys the singleton client's WebSocket transport,
      // breaking subsequent subscriptions on the same client instance.
      sb.removeChannel(channel);
    };
  // Resubscribe when the set of visible comment IDs changes (new page loaded)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, questionId, allCommentIds.join(",")]);

  // G2: Reactions query
  const reactionsQuery = useQuery({
    queryKey: ["comment-reactions", questionId, allCommentIds.join(",")],
    enabled: allCommentIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("get_comment_reactions", {
        p_comment_ids: allCommentIds,
      });
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
      // Reset pagination so the new comment appears at top of page 1
      resetPagination();
      queryClient.invalidateQueries({ queryKey: ["question-thread-sentiment", questionId] });
    },
  });

  // M-G01: Edit comment mutation
  const editCommentMutation = useMutation({
    mutationFn: async ({ commentId, body }: { commentId: string; body: string }) => {
      const { data, error } = await sb.rpc("update_comment", {
        p_comment_id: commentId,
        p_body: body,
      });
      if (error) throw error;
      return data as QuestionCommentRow;
    },
    onSuccess: () => {
      // Edit doesn't change pagination order — only invalidate replies
      queryClient.invalidateQueries({ queryKey: ["question-comments-replies", questionId] });
    },
    onError: (err: any) => {
      toast({
        title: "Could not save edit",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  // M-G02: Delete comment mutation
  const deleteCommentMutation = useMutation({
    mutationFn: async ({ commentId }: { commentId: string }) => {
      const { error } = await sb.rpc("delete_comment", {
        p_comment_id: commentId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      resetPagination();
      queryClient.invalidateQueries({ queryKey: ["question-thread-sentiment", questionId] });
    },
    onError: (err: any) => {
      toast({
        title: "Could not delete comment",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  // G3: Post with civility check
  const handlePostTopLevel = async () => {
    if (!sessionUserId) {
      toast({ title: "Sign in to comment", variant: "destructive" });
      return;
    }
    const body = (newCommentRef.current?.getText() ?? "").trim();
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
      newCommentRef.current?.clear();
      setNewCommentHasContent(false);
      if (saved?.id) {
        runSentimentWorkers(saved.id, body);
        // H2: fire background toxicity score write with the real comment_id
        checkCivility(body, saved.id, sessionUserId ?? undefined);
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

  // Build tree from merged flat list — logic unchanged from original
  const rawNodes = React.useMemo(
    () => buildCommentTree(allComments),
    [allComments],
  );

  // Sort root nodes only (children retain insertion order from replies RPC)
  const sortedNodes = React.useMemo(() => {
    if (sortMode === "helpful") {
      return [...rawNodes].sort((a, b) => {
        const aScore = (reactions[a.id]?.up_count ?? 0) - (reactions[a.id]?.down_count ?? 0);
        const bScore = (reactions[b.id]?.up_count ?? 0) - (reactions[b.id]?.down_count ?? 0);
        return bScore - aScore;
      });
    }
    // Latest: roots already newest-first from the RPC — no re-sort needed
    return rawNodes;
  }, [rawNodes, sortMode, reactions]);

  const sentiment = threadSentimentQuery.data;
  const avg = sentiment?.avg_sentiment ?? null;
  const trendingColor = getSentimentColorHex(avg);
  const isInitialLoading = rootsQuery.isLoading;

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
                <span
                  className="inline-flex h-2 w-2 rounded-full"
                  style={{ backgroundColor: trendingColor }}
                />
                <span className="text-slate-600">{describeMood(avg)}</span>
                {sentiment.comment_count != null && sentiment.comment_count > 0 && (
                  <span className="text-slate-400">
                    · {sentiment.comment_count} comment{sentiment.comment_count === 1 ? "" : "s"}
                  </span>
                )}
              </>
            ) : null}
          </div>
        )}

        {/* M-G03: Top-level composer — RichCommentInput */}
        <div className="space-y-2">
          <RichCommentInput
            ref={newCommentRef}
            placeholder={sessionUserId ? "Add a comment…" : "Sign in to add a comment."}
            disabled={!sessionUserId || posting || checkingCivility}
            minHeight={72}
            onChange={(text) => {
              setNewCommentHasContent(text.trim().length > 0);
              if (civilityWarning) setCivilityWarning(false);
            }}
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
                  onClick={() => {
                    setCivilityWarning(false);
                    setPosting(false);
                    void handlePostTopLevel();
                  }}
                  disabled={posting}
                  className="text-amber-700 border-amber-300"
                >
                  Post anyway
                </Button>
              )}
              <Button
                size="sm"
                onClick={handlePostTopLevel}
                disabled={!sessionUserId || posting || checkingCivility || !newCommentHasContent}
              >
                {checkingCivility
                  ? "Checking…"
                  : posting
                  ? "Posting…"
                  : civilityWarning
                  ? "Edit comment"
                  : "Post comment"}
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
          {isInitialLoading && (
            <p className="text-xs text-slate-500">Loading comments…</p>
          )}
          {!isInitialLoading && sortedNodes.length === 0 && (
            <p className="text-xs text-slate-500">
              No comments yet. Be the first to share your thoughts.
            </p>
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
                    if (!sessionUserId) {
                      toast({ title: "Sign in to reply", variant: "destructive" });
                      return;
                    }
                    const saved = await createCommentMutation.mutateAsync({
                      body,
                      parentId: node.id,
                    });
                    if (saved?.id) runSentimentWorkers(saved.id, body);
                  }}
                  onReact={async (commentId, reaction) => {
                    await reactMutation.mutateAsync({ commentId, reaction });
                  }}
                  onEdit={async (commentId, newBody) => {
                    await editCommentMutation.mutateAsync({ commentId, body: newBody });
                  }}
                  onDelete={async (commentId) => {
                    await deleteCommentMutation.mutateAsync({ commentId });
                  }}
                />
              ))}
            </div>
          )}

          {/* M-G05: Show more button */}
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                size="sm"
                variant="outline"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-xs text-slate-600"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading…
                  </span>
                ) : (
                  "Show more comments"
                )}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
