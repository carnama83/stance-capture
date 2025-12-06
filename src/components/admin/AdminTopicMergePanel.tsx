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
  const target = topics.find((t) => t.id === targetId) || null;

  const openMergeDialogFor = (topicId: string) => {
    setSourceId(topicId);
    setTargetId(null);
    setDialogOpen(true);
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

    // Quick extra guard for the user
    const confirmed = window.confirm(
      "Are you sure you want to merge the source topic into the target topic? This will treat the target as canonical going forward."
    );
    if (!confirmed) return;

    setMerging(true);
    const { error } = await supabase.rpc("admin_merge_topic", {
      p_source_topic_id: sourceId,
      p_target_topic_id: targetId,
    });
    setMerging(false);

    if (error) {
      console.error("admin_merge_topic error:", error);
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
        "Source topic is now merged into the canonical target. Trending and topic question lists will now treat the target as canonical.",
    });

    setDialogOpen(false);
    setSourceId(null);
    setTargetId(null);
    loadTopics();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Topic dedupe / merge</h2>
          <p className="text-xs text-muted-foreground max-w-xl">
            Use this tool to merge near-duplicate topics. The source topic becomes
            an alias of the target; canonical topics appear in Trending and Topic
            Detail, and questions are aggregated under the canonical topic.
          </p>
        </div>

        <Input
          className="w-72"
          placeholder="Search topics by title, tags, location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="border rounded-lg max-h-[420px] overflow-auto text-sm">
        {loading && (
          <div className="p-4 text-muted-foreground">Loading topics…</div>
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
                  <Badge variant="outline" className="uppercase tracking-wide">
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
                  <span>{new Date(t.created_at).toLocaleDateString()}</span>
                </div>
                <div className="font-medium text-sm truncate">{t.title}</div>
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
              >
                Merge…
              </Button>
            </div>
          ))}
      </div>

      {/* Merge dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Merge topic into another</DialogTitle>
            <DialogDescription>
              The source topic will become an alias of the target topic. Users will
              see the target topic as canonical in Trending and Topic Detail, and
              questions will be aggregated under the target.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="border rounded-md p-3 text-sm bg-muted/40">
              <Label className="text-xs uppercase text-muted-foreground">
                Source topic (will be merged)
              </Label>
              {source ? (
                <div className="mt-1 space-y-1">
                  <div className="font-medium">{source.title}</div>
                  {source.location_label && (
                    <div className="text-xs text-muted-foreground">
                      {source.location_label}
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
                  Click “Merge…” on a topic in the list to pick a source.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">
                Target topic (canonical)
              </Label>
              <select
                className="w-full border rounded-md px-2 py-1 text-sm"
                value={targetId ?? ""}
                onChange={(e) =>
                  setTargetId(e.target.value ? e.target.value : null)
                }
              >
                <option value="">Select target topic…</option>
                {topics
                  .filter((t) => !source || t.id !== source.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.location_label ? ` · ${t.location_label}` : ""}
                    </option>
                  ))}
              </select>
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
              onClick={() => setDialogOpen(false)}
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
