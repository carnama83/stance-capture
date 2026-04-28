// src/routes/admin/topics/Index.tsx
//
// Admin: Topics / Parent Themes page
//
// Sections:
//   1. Pending Themes        — auto-proposed themes awaiting admin approval/rejection
//                              (status = 'pending', created by classify-parent-topics function)
//   2. Approved Parent Themes — approved root topics with child counts
//                              (status = 'approved', parent_topic_id IS NULL, has children)
//   3. Orphan Topics          — root topics with no children yet
//                              (parent_topic_id IS NULL, no children assigned)
//
// Actions:
//   - Approve pending theme  → UPDATE topics SET status = 'approved'
//   - Reject pending theme   → UPDATE topics SET status = 'archived'
//   - Create parent topic    → INSERT topics (status='approved', parent_topic_id=null, sources=[{type:'manual'}])
//   - Assign micro-topic to parent → UPDATE topics SET parent_topic_id = <id>
//   - Remove parent assignment     → UPDATE topics SET parent_topic_id = null
//   - Archive approved theme  → UPDATE topics SET status = 'archived'
//
// Schema columns used:
//   topics: id, title, description, summary, tags, tier, location_label,
//           status (pending|approved|archived), parent_topic_id, sources, created_at
//
// Patches:
//   v2: Added status column support (pending/approved/archived)
//   v2: Added description column support
//   v2: Added Pending Themes section with approve/reject actions
//   v2: Added Archive action on approved themes
//   v2: Removed classify-topic-drafts button (superseded by classify-parent-topics pipeline step)
//   v2: CreateParentTopicForm now explicitly sets status='approved'
//   v2: Fixed duplicate tag key warning (key={tag} → key={`${tag}-${i}`})

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { RefreshCw, Loader2, CheckCircle2, XCircle, Archive, ChevronDown, ChevronRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TopicStatus = "pending" | "approved" | "archived";

type TopicRow = {
  id: string;
  title: string;
  description: string | null;
  summary: string | null;
  tags: string[] | null;
  tier: string | null;
  location_label: string | null;
  status: TopicStatus;
  parent_topic_id: string | null;
  sources: any;
  created_at: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sourceTypeLabel(sources: any): string {
  if (!sources) return "unknown";
  const arr = Array.isArray(sources) ? sources : [];
  const type = arr[0]?.type ?? "unknown";
  if (type === "auto_generated") return "Auto-proposed";
  if (type === "manual") return "Manual";
  if (type === "news_item") return "News";
  return type;
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  const colors: Record<string, string> = {
    global:  "bg-blue-50 text-blue-700 border-blue-200",
    country: "bg-violet-50 text-violet-700 border-violet-200",
    state:   "bg-indigo-50 text-indigo-700 border-indigo-200",
    county:  "bg-slate-50 text-slate-600 border-slate-200",
    city:    "bg-slate-50 text-slate-600 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium border uppercase tracking-wide ${colors[tier] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
      {tier}
    </span>
  );
}

// ─── Pending Theme Card ───────────────────────────────────────────────────────

function PendingThemeCard({
  row,
  onAction,
}: {
  row: TopicRow;
  onAction: () => void;
}) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  const handleApprove = async () => {
    if (!window.confirm(`Approve theme "${row.title}"?\n\nIt will become available as a classification target for future topic drafts.`)) return;
    setApproving(true);
    const { error } = await supabase
      .from("topics")
      .update({ status: "approved" })
      .eq("id", row.id);
    setApproving(false);
    if (error) {
      toast({ title: "Approve failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Theme approved ✅", description: `"${row.title}" is now active.` });
    onAction();
  };

  const handleReject = async () => {
    if (!window.confirm(`Reject and archive "${row.title}"?\n\nIt will be archived and won't appear again.`)) return;
    setRejecting(true);
    const { error } = await supabase
      .from("topics")
      .update({ status: "archived" })
      .eq("id", row.id);
    setRejecting(false);
    if (error) {
      toast({ title: "Reject failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Theme rejected", description: `"${row.title}" has been archived.` });
    onAction();
  };

  const triggerDraftId = Array.isArray(row.sources) ? row.sources[0]?.trigger_draft : null;

  return (
    <div className="border border-amber-200 rounded-lg bg-amber-50/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-slate-900 truncate">{row.title}</span>
            <TierBadge tier={row.tier} />
            {row.location_label && (
              <span className="text-xs text-slate-500">{row.location_label}</span>
            )}
            <span className="inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-300">
              Auto-proposed
            </span>
          </div>
          {row.description && (
            <p className="text-xs text-slate-600 line-clamp-2">{row.description}</p>
          )}
          {row.tags && row.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {row.tags.slice(0, 5).map((tag, i) => (
                <Badge key={`${tag}-${i}`} variant="outline" className="text-[10px] px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
              {row.tags.length > 5 && (
                <span className="text-[10px] text-slate-400">+{row.tags.length - 5}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={approving || rejecting}
              className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
            >
              {approving
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReject}
              disabled={approving || rejecting}
              className="h-8 border-rose-200 text-rose-600 hover:bg-rose-50 text-xs"
            >
              {rejecting
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <XCircle className="h-3 w-3 mr-1" />}
              Reject
            </Button>
          </div>
          {row.created_at && (
            <span className="text-[10px] text-slate-400">
              {new Date(row.created_at).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {triggerDraftId && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Triggered by draft: <code className="ml-1 font-mono">{triggerDraftId.slice(0, 8)}…</code>
        </button>
      )}
      {expanded && triggerDraftId && (
        <div className="text-[10px] font-mono text-slate-400 bg-white border rounded px-2 py-1 break-all">
          {triggerDraftId}
        </div>
      )}
    </div>
  );
}

// ─── Create Parent Topic Form ─────────────────────────────────────────────────

function CreateParentTopicForm({ onCreated }: { onCreated: () => void }) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [tier, setTier] = React.useState<string>("global");
  const [locationLabel, setLocationLabel] = React.useState("");
  const [tags, setTags] = React.useState("");

  const reset = () => {
    setTitle(""); setDescription(""); setTier("global");
    setLocationLabel(""); setTags("");
  };

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (trimmed.length < 8) {
      toast({ title: "Title too short", description: "Minimum 8 characters.", variant: "destructive" });
      return;
    }
    if (trimmed.length > 200) {
      toast({ title: "Title too long", description: "Maximum 200 characters.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const tagArray = tags.split(",").map((t) => t.trim()).filter(Boolean);

    const { error } = await supabase.from("topics").insert({
      title:          trimmed,
      description:    description.trim() || null,
      tier,
      location_label: locationLabel.trim() || null,
      tags:           tagArray.length > 0 ? tagArray : [],
      status:         "approved",
      sources:        [{ type: "manual", label: "Admin-created parent theme" }],
      parent_topic_id: null,
      lang:           "en",
      published_at:   new Date().toISOString(),
    });
    setSaving(false);

    if (error) {
      console.error("Failed to create parent topic", error);
      toast({ title: "Failed to create", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Parent theme created ✅", description: `"${trimmed}" is approved and active.` });
    setOpen(false);
    reset();
    onCreated();
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="bg-slate-900 hover:bg-slate-700 text-white">
        + Create theme
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create parent theme</DialogTitle>
            <DialogDescription className="text-xs">
              Broad categories like "Political Violence &amp; Public Safety — United States" or
              "Immigration Policy — Europe". Theme-level, not event-level.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pt-title" className="text-xs">
                Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="pt-title"
                placeholder="e.g. Gun Violence — United States"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
              />
              <p className="text-[10px] text-slate-400">{title.trim().length}/200 · min 8 chars</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pt-desc" className="text-xs">
                Description <span className="text-slate-400">(optional)</span>
              </Label>
              <Textarea
                id="pt-desc"
                rows={2}
                placeholder="What stories does this theme cover?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="text-xs resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pt-tier" className="text-xs">Tier <span className="text-red-500">*</span></Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger id="pt-tier" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global</SelectItem>
                    <SelectItem value="country">Country</SelectItem>
                    <SelectItem value="state">State</SelectItem>
                    <SelectItem value="county">County</SelectItem>
                    <SelectItem value="city">City</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pt-location" className="text-xs">
                  Location <span className="text-slate-400">(optional)</span>
                </Label>
                <Input
                  id="pt-location"
                  placeholder="e.g. United States"
                  value={locationLabel}
                  onChange={(e) => setLocationLabel(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pt-tags" className="text-xs">
                Tags <span className="text-slate-400">(comma-separated)</span>
              </Label>
              <Input
                id="pt-tags"
                placeholder="e.g. gun control, mass shooting, firearms"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving || title.trim().length < 8}>
              {saving ? "Creating…" : "Create theme"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Assign to Parent Dialog ──────────────────────────────────────────────────

function AssignParentDialog({
  topic,
  parentTopics,
  onAssigned,
}: {
  topic: TopicRow;
  parentTopics: TopicRow[];
  onAssigned: () => void;
}) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [targetId, setTargetId] = React.useState<string>("");
  const [targetSearch, setTargetSearch] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const filtered = React.useMemo(() => {
    if (!targetSearch.trim()) return parentTopics;
    const q = targetSearch.toLowerCase();
    return parentTopics.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.location_label ?? "").toLowerCase().includes(q)
    );
  }, [parentTopics, targetSearch]);

  const handleAssign = async () => {
    if (!targetId) return;
    const target = parentTopics.find((p) => p.id === targetId);
    const confirmed = window.confirm(
      `Assign "${topic.title}" under "${target?.title ?? targetId}"?\n\nReversible via "Remove parent" action.`
    );
    if (!confirmed) return;

    setSaving(true);
    const { error } = await supabase
      .from("topics")
      .update({ parent_topic_id: targetId })
      .eq("id", topic.id);
    setSaving(false);

    if (error) {
      toast({ title: "Assignment failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Assigned ✅", description: `"${topic.title}" → "${target?.title}".` });
    setOpen(false);
    setTargetId("");
    setTargetSearch("");
    onAssigned();
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="text-[11px] h-7 px-2"
        onClick={() => setOpen(true)}
      >
        Assign parent…
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setTargetId(""); setTargetSearch(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign to parent theme</DialogTitle>
            <DialogDescription className="text-xs">
              Choose an approved parent theme for this topic.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-md border bg-slate-50 p-3 text-sm">
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Assigning</p>
              <p className="font-medium text-slate-900 truncate">{topic.title}</p>
              {topic.location_label && (
                <p className="text-xs text-slate-500 mt-0.5">{topic.location_label}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase text-slate-500">Select parent theme</Label>
              <Input
                className="h-8 text-xs"
                placeholder="Search themes…"
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
              />
              <div className="max-h-48 overflow-auto border rounded-md">
                {filtered.length === 0 && (
                  <p className="p-3 text-[11px] text-slate-400">
                    No approved themes yet. Create one or approve a pending theme first.
                  </p>
                )}
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setTargetId(p.id)}
                    className={[
                      "w-full text-left px-3 py-2 text-[11px] border-b last:border-0 hover:bg-slate-50 transition-colors",
                      targetId === p.id ? "bg-violet-50 border-l-2 border-l-violet-400" : "",
                    ].join(" ")}
                  >
                    <p className="font-medium text-slate-900 truncate">{p.title}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {p.tier?.toUpperCase()}{p.location_label ? ` · ${p.location_label}` : ""}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAssign} disabled={!targetId || saving}>
              {saving ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Remove Parent Button ─────────────────────────────────────────────────────

function RemoveParentButton({ topic, onRemoved }: { topic: TopicRow; onRemoved: () => void }) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);

  const handleRemove = async () => {
    if (!window.confirm(`Remove parent assignment from "${topic.title}"? It will become an orphan.`)) return;
    setSaving(true);
    const { error } = await supabase
      .from("topics")
      .update({ parent_topic_id: null })
      .eq("id", topic.id);
    setSaving(false);
    if (error) {
      toast({ title: "Failed to remove parent", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Parent removed", description: `"${topic.title}" is now unassigned.` });
    onRemoved();
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-[11px] h-7 px-2 text-slate-400 hover:text-red-600"
      onClick={handleRemove}
      disabled={saving}
    >
      {saving ? "Removing…" : "Remove parent"}
    </Button>
  );
}

// ─── Archive Button ───────────────────────────────────────────────────────────

function ArchiveThemeButton({ topic, onArchived }: { topic: TopicRow; onArchived: () => void }) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);

  const handleArchive = async () => {
    if (!window.confirm(`Archive theme "${topic.title}"?\n\nIt will no longer appear as a classification target. Children will remain assigned.`)) return;
    setSaving(true);
    const { error } = await supabase
      .from("topics")
      .update({ status: "archived" })
      .eq("id", topic.id);
    setSaving(false);
    if (error) {
      toast({ title: "Archive failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Theme archived", description: `"${topic.title}" has been archived.` });
    onArchived();
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-[11px] h-7 px-2 text-slate-400 hover:text-amber-600"
      onClick={handleArchive}
      disabled={saving}
      title="Archive this theme"
    >
      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
    </Button>
  );
}

// ─── Topic Row Item ───────────────────────────────────────────────────────────

function TopicRowItem({
  row,
  isChild,
  availableParents,
  allRows,
  onAction,
  childCount,
}: {
  row: TopicRow;
  isChild: boolean;
  availableParents: TopicRow[];
  allRows: TopicRow[];
  onAction: () => void;
  childCount?: number;
}) {
  const isParent = !row.parent_topic_id && allRows.some((r) => r.parent_topic_id === row.id);
  const isOrphan = !row.parent_topic_id && !isParent;

  return (
    <div
      className={[
        "grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-3 items-start text-xs py-2.5 px-3 border-b last:border-b-0",
        isChild  ? "pl-8 bg-slate-50/60" : "",
        isParent ? "bg-violet-50/20" : "",
      ].join(" ")}
    >
      {/* Title + tags */}
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isParent && <span className="text-[10px]">📁</span>}
          {isChild  && <span className="text-slate-300 text-[10px] shrink-0">└</span>}
          <span className={["font-medium truncate", isParent ? "text-violet-900" : "text-slate-800"].join(" ")}>
            {row.title}
          </span>
          {isParent && childCount !== undefined && (
            <span className="text-[10px] text-slate-400 shrink-0">{childCount} children</span>
          )}
        </div>
        {row.description && (
          <p className="text-[11px] text-slate-500 truncate pl-4">{row.description}</p>
        )}
        {!row.description && row.summary && (
          <p className="text-[11px] text-slate-500 truncate pl-4">{row.summary}</p>
        )}
        {row.tags && row.tags.length > 0 && (
          <div className="pl-4 flex flex-wrap gap-1 mt-0.5">
            {row.tags.slice(0, 4).map((tag, i) => (
              <Badge key={`${tag}-${i}`} variant="outline" className="text-[10px] px-1 py-0">{tag}</Badge>
            ))}
            {row.tags.length > 4 && (
              <span className="text-[10px] text-slate-400">+{row.tags.length - 4}</span>
            )}
          </div>
        )}
      </div>

      {/* Location / Tier / Date */}
      <div className="text-[11px] text-slate-500 space-y-0.5">
        {row.location_label && <div className="truncate">{row.location_label}</div>}
        <TierBadge tier={row.tier} />
        {row.created_at && (
          <div className="text-[10px] text-slate-400">
            {new Date(row.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        {isParent && (
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-300 text-violet-700 shrink-0">
              Theme
            </Badge>
            <ArchiveThemeButton topic={row} onArchived={onAction} />
          </div>
        )}
        {isOrphan && (
          <AssignParentDialog topic={row} parentTopics={availableParents} onAssigned={onAction} />
        )}
        {isChild && (
          <div className="flex gap-1 items-center">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-700">
              Assigned
            </Badge>
            <RemoveParentButton topic={row} onRemoved={onAction} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminTopicsPage() {
  const supabase = React.useMemo(() => getSupabase()!, []);
  const { toast } = useToast();
  const [rows, setRows] = React.useState<TopicRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("topics")
        .select("id, title, description, summary, tags, tier, location_label, status, parent_topic_id, sources, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        console.error("Failed to load topics", error);
        toast({ title: "Failed to load topics", description: error.message, variant: "destructive" });
        setRows([]);
        return;
      }
      setRows((data ?? []) as TopicRow[]);
    } finally {
      setLoading(false);
    }
  }, [supabase, toast]);

  React.useEffect(() => { load(); }, [load]);

  // Search filter — applied to all sections
  const filtered = React.useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      [r.title, r.location_label ?? "", r.description ?? "", ...(r.tags ?? [])].join(" ").toLowerCase().includes(q)
    );
  }, [rows, search]);

  // ── Derived groupings ──────────────────────────────────────────────────────

  const pendingThemes = React.useMemo(
    () => filtered.filter((r) => r.status === "pending" && !r.parent_topic_id),
    [filtered]
  );

  const approvedParents = React.useMemo(
    () => filtered.filter((r) => r.status === "approved" && !r.parent_topic_id),
    [filtered]
  );

  const childrenByParent = React.useMemo(() => {
    const map = new Map<string, TopicRow[]>();
    for (const r of filtered) {
      if (r.parent_topic_id) {
        const arr = map.get(r.parent_topic_id) ?? [];
        arr.push(r);
        map.set(r.parent_topic_id, arr);
      }
    }
    return map;
  }, [filtered]);

  // Parent topics with at least one child
  const parentTopicsWithChildren = React.useMemo(
    () => approvedParents.filter((r) => (childrenByParent.get(r.id)?.length ?? 0) > 0),
    [approvedParents, childrenByParent]
  );

  // Orphans: approved root topics with no children
  const orphans = React.useMemo(
    () => approvedParents.filter((r) => (childrenByParent.get(r.id)?.length ?? 0) === 0),
    [approvedParents, childrenByParent]
  );

  const archivedThemes = React.useMemo(
    () => filtered.filter((r) => r.status === "archived" && !r.parent_topic_id),
    [filtered]
  );

  // For assign dialog: only approved root topics
  const availableParents = React.useMemo(
    () => rows.filter((r) => r.status === "approved" && !r.parent_topic_id),
    [rows]
  );

  // Stats
  const totalAssigned = rows.filter((r) => !!r.parent_topic_id).length;
  const totalOrphans  = rows.filter((r) => r.status === "approved" && !r.parent_topic_id && !rows.some((c) => c.parent_topic_id === r.id)).length;
  const totalPending  = rows.filter((r) => r.status === "pending").length;

  return (
    <Card className="mt-4">
      <CardHeader className="space-y-3 pb-3">

        {/* Row 1: Title + actions */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">Parent Themes</CardTitle>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              Broad theme categories that topic drafts are classified into.
              Auto-proposed themes require approval before becoming classification targets.
            </p>
            <div className="flex gap-4 mt-2 text-[11px] text-slate-500">
              {totalPending > 0 && (
                <span className="font-semibold text-amber-600">
                  ⚠ {totalPending} pending approval
                </span>
              )}
              <span><strong className="text-slate-700">{parentTopicsWithChildren.length}</strong> active themes</span>
              <span><strong className="text-slate-700">{totalAssigned}</strong> topics assigned</span>
              <span className={totalOrphans > 0 ? "text-amber-600 font-medium" : ""}>
                <strong>{totalOrphans}</strong> unassigned
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CreateParentTopicForm onCreated={load} />
            <Input
              placeholder="Filter themes…"
              className="h-8 w-44 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-8">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

      </CardHeader>

      <CardContent className="space-y-6">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        )}

        {/* ── 1. Pending themes ── */}
        {pendingThemes.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-amber-600">
                Pending approval ({pendingThemes.length})
              </h3>
              <span className="text-[10px] text-slate-400">— auto-proposed by classify-parent-topics</span>
            </div>
            <div className="space-y-2">
              {pendingThemes.map((row) => (
                <PendingThemeCard key={row.id} row={row} onAction={load} />
              ))}
            </div>
          </div>
        )}

        {/* ── 2. Approved parent themes with children ── */}
        {parentTopicsWithChildren.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Active themes ({parentTopicsWithChildren.length})
            </h3>
            <div className="border rounded-lg overflow-hidden">
              {parentTopicsWithChildren.map((parent) => {
                const children = childrenByParent.get(parent.id) ?? [];
                return (
                  <React.Fragment key={parent.id}>
                    <TopicRowItem
                      row={parent}
                      isChild={false}
                      availableParents={availableParents}
                      allRows={rows}
                      onAction={load}
                      childCount={children.length}
                    />
                    {children.map((child) => (
                      <TopicRowItem
                        key={child.id}
                        row={child}
                        isChild
                        availableParents={availableParents}
                        allRows={rows}
                        onAction={load}
                      />
                    ))}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 3. Orphan root topics ── */}
        {orphans.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-amber-500">
              Unassigned topics ({orphans.length})
              <span className="ml-2 font-normal text-slate-400 normal-case tracking-normal">
                — no children yet; assign micro-topics under these or they will remain unused
              </span>
            </h3>
            <div className="border rounded-lg overflow-hidden">
              {orphans.map((row) => (
                <TopicRowItem
                  key={row.id}
                  row={row}
                  isChild={false}
                  availableParents={availableParents}
                  allRows={rows}
                  onAction={load}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── 4. Archived themes (collapsed by default) ── */}
        {archivedThemes.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-300 hover:text-slate-500"
            >
              {showArchived ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Archived ({archivedThemes.length})
            </button>
            {showArchived && (
              <div className="border rounded-lg overflow-hidden opacity-60">
                {archivedThemes.map((row) => (
                  <TopicRowItem
                    key={row.id}
                    row={row}
                    isChild={false}
                    availableParents={availableParents}
                    allRows={rows}
                    onAction={load}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && rows.length === 0 && (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm text-slate-500">No themes yet.</p>
            <p className="text-xs text-slate-400">
              Run "5. Classify Parents" on the Topic Drafts page to auto-generate themes,
              or create one manually above.
            </p>
          </div>
        )}

        {!loading && rows.length > 0 && pendingThemes.length === 0 &&
          parentTopicsWithChildren.length === 0 && orphans.length === 0 && archivedThemes.length === 0 && (
          <p className="text-xs text-slate-400 py-4">
            No themes match your search. Clear the filter to see all.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
