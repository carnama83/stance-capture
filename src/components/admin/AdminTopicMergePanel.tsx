// src/components/admin/AdminTopicMergePanel.tsx

import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

type TopicRow = {
  id: string;
  title: string;
  summary: string | null;
  tier: string;
  location_label: string | null;
  tags: string[] | null;
  parent_topic_id: string | null;
  created_at: string;
};

export function AdminTopicMergePanel() {
  const supabase = React.useMemo(createSupabase, []);
  const { toast } = useToast();

  const [topics, setTopics] = React.useState<TopicRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [sourceId, setSourceId] = React.useState<string | null>(null);
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [merging, setMerging] = React.useState(false);
  const [targetSearch, setTargetSearch] = React.useState("");

  // Load topics
  const loadTopics = React.useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("topics")
      .select(
        `
        id,
        title,
        summary,
        tier,
        location_label,
        tags,
        parent_topic_id,
        created_at
      `
      )
      .order("created_at", { ascending: false })
      .limit(300);

    setLoading(false);

    if (error) {
      console.error("Failed to load topics:", error);
      toast({
        title: "Failed to load topics",
        description: error.message,
        variant: "destructive",
      });
      setTopics([]);
      return;
    }

    setTopics((data ?? []) as TopicRow[]);
  }, [supabase, toast]);

  React.useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  // Filter main list by top-level search
  const filteredTopics = React.useMemo(() => {
    if (!search.trim()) return topics;
    const q = search.toLowerCase();
    return topics.filter((t) => {
      const fields = [
        t.title,
        t.summary || "",
        t.location_label || "",
        ...(t.tags ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return fields.includes(q);
    });
  }, [topics, search]);

  const source = topics.find((t) => t.id === sourceId) || null;

  // Candidates for target (inside dialog) — exclude source, filter by targetSearch
  const targetCandidates = React.useMemo(() => {
    const base = topics.filter((t) => !source || t.id !== source.id);
    if (!targetSearch.trim()) return base.slice(0, 50);

    const q = targetSearch.toLowerCase();
    return base
      .filter((t) => {
        const fields = [
          t.title,
          t.summary || "",
          t.location_label || "",
          t.tier || "",
          ...(t.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();
        return fields.includes(q);
      })
      .slice(0, 50);
  }, [topics, source, targetSearch]);

  const target = topics.find((t) => t.id === targetId) || null;

  const openMergeDialogFor = (topicId: string) => {
    const topic = topics.find((t) => t.id === topicId) || null;
    if (!topic) return;

    if (topic.parent_topic_id) {
      toast({
        title: "Already merged",
        description:
          "This topic is already merged into another topic and cannot be merged again.",
        variant: "destructive",
      });
      return;
    }

    setSourceId(topicId);
    setTargetId(null);
    setTargetSearch("");
    setDialogOpen(true);
  };

  const handleDialogOpenChange = (next: boolean) => {
    setDialogOpen(next);
    if (!next) {
      setSourceId(null);
      setTargetId(null);
      setTargetSearch("");
      setMerging(false);
    }
  };

  const handleMerge = async () => {
    if (!sourceId || !targetId) {
      toast({
        title: "Missing selection",
        description: "Pick both a source and a target topic.",
        variant: "destructive",
      });
      return;
    }
    if (sourceId === targetId) {
      toast({
        title: "Invalid merge",
        description: "Source and target must be different topics.",
        variant: "destructive",
      });
      return;
    }

    const src = topics.find((t) => t.id === sourceId) || null;
    const tgt = topics.find((t) => t.id === targetId) || null;

    // Extra guard for the admin
    const confirmed = window.confirm(
      `Merge "${src?.title ?? "source"}" into "${tgt?.title ?? "target"}"? This will treat the target as canonical going forward.`
    );
    if (!confirmed) return;

    setMerging(true);
    const { error } = await supabase.rpc("admin_merge_topics", {
      p_source_topic_id: sourceId,
      p_target_topic_id: targetId,
    });
    setMerging(false);

    if (error) {
      console.error("admin_merge_topics error:", error);
      toast({
        title: "Merge failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Topics merged",
      description:
        "Source topic is now merged into the canonical target. Topic Detail and Trending will use the target going forward.",
    });

    handleDialogOpenChange(false);
    loadTopics();
  };

  return (
    <div className="space-y-4">
      {/* Header + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Topic dedupe / merge</h2>
          <p className="text-xs text-muted-foreground max-w-xl">
            Use this tool to merge near-duplicate topics. The source topic
            becomes an alias of the target; canonical topics appear in
            Trending and Topic Detail, and questions are treated as belonging
            to the canonical topic.
          </p>
        </div>

        <Input
          className="w-72"
          placeholder="Search topics by title, tags, location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Topic list */}
      <div className="border rounded-lg max-h-[420px] overflow-auto text-sm">
        {loading && (
          <div className="p-4 text-muted-foreground">
            Loading topics…
          </div>
        )}

        {!loading && filteredTopics.length === 0 && (
          <div className="p-4 text-muted-foreground">
            No topics match this search.
          </div>
        )}

        {!loading &&
          filteredTopics.map((t) => (
            <div
              key={t.id}
              className="flex items-start justify-between gap-3 border-b px-3 py-2 last:border-0 hover:bg-muted/40"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge
                    variant="outline"
                    className="uppercase tracking-wide"
                  >
                    {t.tier}
                  </Badge>
                  {t.location_label && (
                    <span className="truncate max-w-[160px]">
                      {t.location_label}
                    </span>
                  )}
                  {t.parent_topic_id && (
                    <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                      merged into {t.parent_topic_id.slice(0, 8)}…
                    </span>
                  )}
                  <span>
                    {new Date(t.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="font-medium text-sm truncate">
                  {t.title}
                </div>
                {t.summary && (
                  <div className="text-xs text-muted-foreground line-clamp-2">
                    {t.summary}
                  </div>
                )}
                {t.tags && t.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {t.tags.slice(0, 4).map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-[10px]"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {t.tags.length > 4 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{t.tags.length - 4} more
                      </span>
                    )}
                  </div>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => openMergeDialogFor(t.id)}
                disabled={!!t.parent_topic_id}
              >
                {t.parent_topic_id ? "Merged" : "Merge…"}
              </Button>
            </div>
          ))}
      </div>

      {/* Merge dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Merge topic into another</DialogTitle>
            <DialogDescription className="text-xs">
              The source topic will become an alias of the target topic.
              Users will see the target as canonical in Topic Detail and
              Trending, and questions will be effectively grouped under the
              canonical topic.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Source */}
            <div className="border rounded-md p-3 text-sm bg-muted/40">
              <Label className="text-xs uppercase text-muted-foreground">
                Source topic (will be merged)
              </Label>
              {source ? (
                <div className="mt-1 space-y-1">
                  <div className="font-medium">{source.title}</div>
                  {source.location_label && (
                    <div className="text-xs text-muted-foreground">
                      {source.location_label} · {source.tier}
                    </div>
                  )}
                  {source.summary && (
                    <div className="text-xs text-muted-foreground line-clamp-3">
                      {source.summary}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-1 text-xs text-muted-foreground">
                  Click “Merge…” on a topic in the list to choose a source.
                </div>
              )}
            </div>

            {/* Target selector */}
            <div className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">
                Target topic (canonical)
              </Label>

              <Input
                className="h-8 text-xs"
                placeholder="Search target topics by title, location, tags…"
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
              />

              <div className="max-h-48 overflow-auto border rounded-md mt-1">
                {targetCandidates.length === 0 && (
                  <div className="p-2 text-[11px] text-muted-foreground">
                    No matching target topics.
                  </div>
                )}
                {targetCandidates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTargetId(t.id)}
                    className={[
                      "w-full text-left px-2 py-1.5 text-[11px] border-b last:border-b-0 hover:bg-muted/60",
                      targetId === t.id ? "bg-muted" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="font-medium text-slate-900 truncate">
                      {t.title}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {t.location_label || "No location"} · {t.tier}
                    </div>
                  </button>
                ))}
              </div>

              {target && (
                <p className="text-xs text-muted-foreground mt-1">
                  Canonical topic will be{" "}
                  <span className="font-medium">{target.title}</span>.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleDialogOpenChange(false)}
              disabled={merging}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={!sourceId || !targetId || merging}
            >
              {merging ? "Merging…" : "Merge topics"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
