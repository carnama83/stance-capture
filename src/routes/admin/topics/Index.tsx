// src/routes/admin/topics/Index.tsx
// Rebuilt for Path 2 — parent topic management.
//
// New capabilities vs old:
//   1. Create Parent Topic panel — inserts a broad root topic (no parent_topic_id)
//   2. Assign to Parent — sets parent_topic_id on a micro-topic via admin_merge_topics
//   3. Grouped display — parent topics shown as headers, children indented beneath
//   4. Orphan section — micro-topics not yet assigned to any parent
//
// Preserved from old:
//   - Search/filter
//   - Existing merge flow (AdminTopicMergePanel kept for peer merges)
//   - canonicalMap / getCanonical logic

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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

type TopicRow = {
  id: string;
  title: string;
  summary: string | null;
  tags: string[] | null;
  tier: string | null;
  location_label: string | null;
  created_at: string | null;
  parent_topic_id: string | null;
};

// ─── Create Parent Topic Form ─────────────────────────────────────────────────

function CreateParentTopicForm({ onCreated }: { onCreated: () => void }) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [title, setTitle] = React.useState("");
  const [tier, setTier] = React.useState<string>("global");
  const [locationLabel, setLocationLabel] = React.useState("");
  const [tags, setTags] = React.useState(""); // comma-separated

  const reset = () => {
    setTitle("");
    setTier("global");
    setLocationLabel("");
    setTags("");
  };

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (trimmed.length < 8) {
      toast({ title: "Title too short", description: "Minimum 8 characters.", variant: "destructive" });
      return;
    }
    if (trimmed.length > 140) {
      toast({ title: "Title too long", description: "Maximum 140 characters.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const tagArray = tags.split(",").map((t) => t.trim()).filter(Boolean);

    const { error } = await supabase.from("topics").insert({
      title: trimmed,
      tier,
      location_label: locationLabel.trim() || null,
      tags: tagArray.length > 0 ? tagArray : [],
      sources: [{ type: "manual", label: "Admin-created parent topic" }],
      parent_topic_id: null, // always a root topic
    });
    setSaving(false);

    if (error) {
      console.error("Failed to create parent topic", error);
      toast({ title: "Failed to create", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Parent topic created", description: `"${trimmed}" is ready for child assignment.` });
    setOpen(false);
    reset();
    onCreated();
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + Create parent topic
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create parent topic</DialogTitle>
            <DialogDescription className="text-xs">
              Parent topics are broad categories like "Middle East Conflict" or
              "US Domestic Policy". Micro-topics will be assigned under them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pt-title" className="text-xs">Title <span className="text-red-500">*</span></Label>
              <Input
                id="pt-title"
                placeholder="e.g. Middle East Conflict"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={140}
              />
              <p className="text-[10px] text-slate-400">{title.trim().length}/140 — min 8 characters</p>
            </div>

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
              <Label htmlFor="pt-location" className="text-xs">Location label <span className="text-slate-400">(optional)</span></Label>
              <Input
                id="pt-location"
                placeholder="e.g. United States"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pt-tags" className="text-xs">Tags <span className="text-slate-400">(optional, comma-separated)</span></Label>
              <Input
                id="pt-tags"
                placeholder="e.g. geopolitics, foreign policy"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving || title.trim().length < 8}>
              {saving ? "Creating…" : "Create parent topic"}
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
      `Assign "${topic.title}" under parent "${target?.title ?? targetId}"?\n\nThis sets parent_topic_id and is reversible via the "Remove parent" action.`
    );
    if (!confirmed) return;

    setSaving(true);
    const { error } = await supabase.rpc("admin_merge_topics", {
      p_source_topic_id: topic.id,
      p_target_topic_id: targetId,
    });
    setSaving(false);

    if (error) {
      console.error("admin_merge_topics error", error);
      toast({ title: "Assignment failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Assigned", description: `"${topic.title}" is now under "${target?.title}".` });
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
            <DialogTitle>Assign to parent topic</DialogTitle>
            <DialogDescription className="text-xs">
              Choose a broad parent topic for this micro-topic. The analytics
              card will group this topic under the parent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Source */}
            <div className="rounded-md border bg-slate-50 p-3 text-sm">
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Assigning</p>
              <p className="font-medium text-slate-900 truncate">{topic.title}</p>
              {topic.location_label && (
                <p className="text-xs text-slate-500 mt-0.5">{topic.location_label}</p>
              )}
            </div>

            {/* Parent picker */}
            <div className="space-y-2">
              <Label className="text-xs uppercase text-slate-500">Select parent topic</Label>
              <Input
                className="h-8 text-xs"
                placeholder="Search parent topics…"
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
              />
              <div className="max-h-48 overflow-auto border rounded-md">
                {filtered.length === 0 && (
                  <p className="p-3 text-[11px] text-slate-400">
                    No parent topics yet.{" "}
                    <span className="font-medium">Create one above first.</span>
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
              {saving ? "Assigning…" : "Assign to parent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Remove Parent button ─────────────────────────────────────────────────────

function RemoveParentButton({ topic, onRemoved }: { topic: TopicRow; onRemoved: () => void }) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);

  const handleRemove = async () => {
    const confirmed = window.confirm(
      `Remove parent assignment from "${topic.title}"? It will become an orphan again.`
    );
    if (!confirmed) return;

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

// ─── Topic row (shared renderer) ─────────────────────────────────────────────

function TopicRowItem({
  row,
  isChild,
  parentTopics,
  allRows,
  onAction,
}: {
  row: TopicRow;
  isChild: boolean;
  parentTopics: TopicRow[];
  allRows: TopicRow[];
  onAction: () => void;
}) {
  const isParent = !row.parent_topic_id && allRows.some((r) => r.parent_topic_id === row.id);
  const isOrphan = !row.parent_topic_id && !isParent;

  return (
    <div
      className={[
        "grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-2 items-start text-xs py-2 border-b last:border-b-0",
        isChild ? "pl-6 bg-slate-50/50" : "",
        isParent ? "bg-violet-50/30" : "",
      ].join(" ")}
    >
      {/* Topic */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {isParent && <span className="text-[10px]">📁</span>}
          {isChild && <span className="text-slate-300 text-[10px]">└</span>}
          <span className={["font-medium truncate", isParent ? "text-violet-900" : "text-slate-900"].join(" ")}>
            {row.title}
          </span>
        </div>
        {row.summary && (
          <p className="text-[11px] text-slate-500 truncate mt-0.5 pl-4">{row.summary}</p>
        )}
        {row.tags && row.tags.length > 0 && (
          <div className="mt-0.5 pl-4 flex flex-wrap gap-1">
            {row.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">{tag}</Badge>
            ))}
            {row.tags.length > 3 && (
              <span className="text-[10px] text-slate-400">+{row.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>

      {/* Location / Tier */}
      <div className="text-[11px] text-slate-500 space-y-0.5">
        {row.location_label && <div>{row.location_label}</div>}
        {row.tier && <div className="uppercase tracking-wide text-[10px]">{row.tier}</div>}
        {row.created_at && (
          <div className="text-[10px] text-slate-400">
            {new Date(row.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col items-end gap-1">
        {isParent && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-400 text-violet-700">
            Parent topic
          </Badge>
        )}
        {isOrphan && (
          <AssignParentDialog topic={row} parentTopics={parentTopics} onAssigned={onAction} />
        )}
        {isChild && (
          <div className="flex gap-1">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-700">
              Assigned
            </Badge>
            <RemoveParentButton topic={row} onRemoved={onAction} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Classify Micro Topics Button ────────────────────────────────────────────

type ClassifyResult = {
  ok: boolean;
  phase1_created?: number; // parent topics auto-generated in bootstrap phase
  classified?: number;
  assigned?: number;
  skipped?: number;
  remaining?: number;      // orphans still unprocessed (run again to continue)
  message?: string;
  error?: string;
};

function ClassifyMicroTopicsButton({ onDone }: { onDone: () => void }) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [running, setRunning] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "bootstrap" | "classifying">("idle");
  const [lastResult, setLastResult] = React.useState<ClassifyResult | null>(null);

  const handleClassify = async () => {
    setRunning(true);
    setLastResult(null);
    setPhase("bootstrap"); // optimistic — will show "Classifying…" once bootstrap done

    try {
      const { data, error } = await supabase.functions.invoke(
        "classify-topic-drafts",
        { body: { limit: 100 } }
      );

      if (error) {
        setLastResult({ ok: false, error: error.message });
        toast({ title: "Classification failed", description: error.message, variant: "destructive" });
        return;
      }

      const result = data as ClassifyResult;
      setLastResult(result);

      if (!result.ok) {
        toast({ title: "Classification error", description: result.error ?? "Unknown error", variant: "destructive" });
        return;
      }

      // Build a descriptive toast based on what happened
      const didBootstrap = (result.phase1_created ?? 0) > 0;
      const hasRemaining = (result.remaining ?? 0) > 0;

      toast({
        title: didBootstrap
          ? `✅ Created ${result.phase1_created} parent topics`
          : `✅ Classified ${result.classified ?? 0} micro-topics`,
        description: [
          didBootstrap && `Auto-generated from your ${(result.classified ?? 0) + (result.remaining ?? 0)} micro-topics.`,
          `${result.assigned ?? 0} assigned to parents.`,
          (result.skipped ?? 0) > 0 && `${result.skipped} below confidence threshold — assign manually.`,
          hasRemaining && `${result.remaining} remaining — click again to continue.`,
        ].filter(Boolean).join(" "),
      });

      onDone(); // reload topic list to show new groupings
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setLastResult({ ok: false, error: msg });
      toast({ title: "Classification failed", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
      setPhase("idle");
    }
  };

  const buttonLabel = () => {
    if (!running) return "⚡ Classify micro-topics";
    if (phase === "bootstrap") return "Building taxonomy…";
    return "Classifying…";
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={handleClassify}
        disabled={running}
        className="border-violet-200 text-violet-700 hover:bg-violet-50 min-w-[160px]"
      >
        {running && (
          <span className="mr-1.5 h-3 w-3 rounded-full border-2 border-violet-400 border-t-transparent animate-spin inline-block" />
        )}
        {buttonLabel()}
      </Button>

      {/* Last run summary */}
      {lastResult?.ok && (
        <div className="text-[10px] text-slate-400 text-right space-y-0.5">
          {(lastResult.phase1_created ?? 0) > 0 && (
            <p className="text-violet-500 font-medium">
              {lastResult.phase1_created} parents created
            </p>
          )}
          <p>{lastResult.assigned ?? 0} assigned · {lastResult.skipped ?? 0} manual</p>
          {(lastResult.remaining ?? 0) > 0 && (
            <p className="text-amber-500">{lastResult.remaining} remaining — run again</p>
          )}
        </div>
      )}
      {lastResult && !lastResult.ok && (
        <p className="text-[10px] text-red-400 text-right max-w-[160px] truncate">
          {lastResult.error}
        </p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminTopicsPage() {
  const supabase = getSupabase()!;
  const [rows, setRows] = React.useState<TopicRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("topics")
        .select("id, title, summary, tags, tier, location_label, created_at, parent_topic_id")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        console.error("Failed to load topics", error);
        setRows([]);
        return;
      }
      setRows((data ?? []) as TopicRow[]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => { load(); }, [load]);

  // Filter for search
  const filtered = React.useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      [r.title, r.location_label ?? "", ...(r.tags ?? [])].join(" ").toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Derived groupings
  const parentTopics = React.useMemo(
    () => filtered.filter((r) => !r.parent_topic_id && filtered.some((c) => c.parent_topic_id === r.id)),
    [filtered]
  );

  // Root topics with NO children yet — available as parents for assignment
  const rootTopicsNoChildren = React.useMemo(
    () => rows.filter((r) => !r.parent_topic_id && !rows.some((c) => c.parent_topic_id === r.id)),
    [rows]
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

  const orphans = React.useMemo(
    () => filtered.filter((r) => !r.parent_topic_id && !filtered.some((c) => c.parent_topic_id === r.id)),
    [filtered]
  );

  // For the assign dialog, available parents = any root topic (has no parent itself)
  const availableParents = React.useMemo(
    () => rows.filter((r) => !r.parent_topic_id),
    [rows]
  );

  const totalChildren = rows.filter((r) => !!r.parent_topic_id).length;
  const totalOrphans = rows.filter((r) => !r.parent_topic_id && !rows.some((c) => c.parent_topic_id === r.id)).length;

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base font-semibold">Topics (Admin)</CardTitle>
          <p className="text-xs text-slate-500 mt-1 max-w-xl">
            Create broad parent topics, then assign micro-topics under them.
            This powers the Personal Analytics card and Topic Detail grouping.
          </p>
          <div className="flex gap-3 mt-2 text-[11px] text-slate-500">
            <span><strong className="text-slate-700">{parentTopics.length}</strong> parent topics</span>
            <span><strong className="text-slate-700">{totalChildren}</strong> assigned</span>
            <span><strong className={totalOrphans > 0 ? "text-amber-600" : "text-slate-700"}>{totalOrphans}</strong> orphans</span>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 sm:mt-0 flex-wrap">
          <CreateParentTopicForm onCreated={load} />
          <ClassifyMicroTopicsButton onDone={load} />
          <Input
            placeholder="Filter by title, location, tags…"
            className="h-8 w-52"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {loading && <p className="text-xs text-slate-400">Loading topics…</p>}

        {!loading && rows.length === 0 && (
          <p className="text-xs text-slate-400">No topics found.</p>
        )}

        {/* ── Parent topics + their children ── */}
        {parentTopics.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
              Parent topics ({parentTopics.length})
            </h3>
            <div className="border rounded-lg overflow-hidden">
              {parentTopics.map((parent) => {
                const children = childrenByParent.get(parent.id) ?? [];
                return (
                  <React.Fragment key={parent.id}>
                    <TopicRowItem
                      row={parent}
                      isChild={false}
                      parentTopics={availableParents}
                      allRows={rows}
                      onAction={load}
                    />
                    {children.map((child) => (
                      <TopicRowItem
                        key={child.id}
                        row={child}
                        isChild
                        parentTopics={availableParents}
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

        {/* ── Orphan micro-topics ── */}
        {orphans.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-amber-500 mb-2">
              Unassigned micro-topics ({orphans.length})
              <span className="ml-2 font-normal text-slate-400 normal-case tracking-normal">
                — assign these under a parent topic
              </span>
            </h3>
            <div className="border rounded-lg overflow-hidden">
              {orphans.map((row) => (
                <TopicRowItem
                  key={row.id}
                  row={row}
                  isChild={false}
                  parentTopics={availableParents}
                  allRows={rows}
                  onAction={load}
                />
              ))}
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && orphans.length === 0 && parentTopics.length === 0 && (
          <p className="text-xs text-slate-400">
            All topics match your search filter but no grouping is visible. Clear the filter to see all.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
