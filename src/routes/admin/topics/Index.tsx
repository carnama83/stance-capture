// src/routes/admin/topics/Index.tsx

import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AdminTopicMergePanel } from "@/components/admin/AdminTopicMergePanel";

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

export default function AdminTopicsPage() {
  const supabase = React.useMemo(createSupabase, []);
  const [rows, setRows] = React.useState<TopicRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("topics")
        .select(
          `
          id,
          title,
          summary,
          tags,
          tier,
          location_label,
          created_at,
          parent_topic_id
        `
        )
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) {
        console.error("Failed to load topics", error);
        setRows([]);
        return;
      }

      let items = (data ?? []) as TopicRow[];

      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        items = items.filter((t) => {
          const hay = [
            t.title ?? "",
            t.location_label ?? "",
            (t.tags ?? []).join(" "),
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(needle);
        });
      }

      setRows(items);
    } finally {
      setLoading(false);
    }
  }, [supabase, search]);

  React.useEffect(() => {
    load();
  }, [load]);

  const canonicalMap = React.useMemo(() => {
    const map = new Map<string, TopicRow>();
    for (const row of rows) {
      map.set(row.id, row);
    }
    return map;
  }, [rows]);

  const getCanonical = (row: TopicRow): TopicRow | null => {
    let current: TopicRow | null = row;
    let hops = 0;
    while (current && current.parent_topic_id) {
      hops++;
      if (hops > 8) break;
      const next = canonicalMap.get(current.parent_topic_id);
      if (!next) break;
      current = next;
    }
    return current;
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base font-semibold">
            Topics (Admin)
          </CardTitle>
          <p className="text-xs text-slate-500 mt-1 max-w-xl">
            Clean up near-duplicate topics by merging them into a canonical
            topic. Merged topics will redirect users to the canonical topic on
            the Topic Detail page.
          </p>
        </div>
        <div className="flex items-center gap-2 mt-2 sm:mt-0">
          <Input
            placeholder="Filter by title, location, tags…"
            className="h-8 w-56"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && !loading && (
          <p className="text-xs text-slate-500">
            No topics found. Once topics are generated and published, they’ll
            appear here.
          </p>
        )}

        {rows.length > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 text-[11px] font-medium text-slate-500 border-b pb-1">
              <div>Topic</div>
              <div>Location / Tier</div>
              <div>Status</div>
              <div className="text-right">Actions</div>
            </div>

            <div className="space-y-1.5">
              {rows.map((row) => {
                const canonical = getCanonical(row);
                const isMerged = !!row.parent_topic_id;
                const isCanonical =
                  !row.parent_topic_id &&
                  !rows.some((r) => r.parent_topic_id === row.id);

                return (
                  <div
                    key={row.id}
                    className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center text-xs py-1 border-b last:border-b-0"
                  >
                    {/* Topic */}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">
                        {row.title}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {row.summary}
                      </div>
                      {row.tags && row.tags.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {row.tags.slice(0, 3).map((tag) => (
                            <Badge
                              key={tag}
                              variant="outline"
                              className="text-[10px] px-1 py-0"
                            >
                              {tag}
                            </Badge>
                          ))}
                          {row.tags.length > 3 && (
                            <span className="text-[10px] text-slate-400">
                              +{row.tags.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Location / Tier */}
                    <div className="text-[11px] text-slate-600">
                      {row.location_label && (
                        <div>{row.location_label}</div>
                      )}
                      {row.tier && (
                        <div className="uppercase tracking-wide text-[10px] text-slate-500">
                          {row.tier}
                        </div>
                      )}
                      {row.created_at && (
                        <div className="text-[10px] text-slate-400">
                          {new Date(row.created_at).toLocaleDateString(
                            undefined,
                            { dateStyle: "medium" }
                          )}
                        </div>
                      )}
                    </div>

                    {/* Status */}
                    <div className="flex flex-col gap-0.5 text-[11px]">
                      {isMerged && canonical && (
                        <>
                          <Badge
                            variant="outline"
                            className="px-1 py-0 text-[10px] border-amber-500 text-amber-700"
                          >
                            Merged
                          </Badge>
                          <span className="text-slate-500 truncate">
                            → {canonical.title}
                          </span>
                        </>
                      )}
                      {isCanonical && (
                        <Badge
                          variant="outline"
                          className="px-1 py-0 text-[10px] border-emerald-500 text-emerald-700"
                        >
                          Canonical
                        </Badge>
                      )}
                      {!isMerged && !isCanonical && (
                        <span className="text-slate-500">
                          Potential canonical (has children)
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end">
                      <AdminTopicMergePanel
                        topic={row}
                        allTopics={rows}
                        onMerged={load}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loading && (
          <p className="text-xs text-slate-500">Loading topics…</p>
        )}
      </CardContent>
    </Card>
  );
}
