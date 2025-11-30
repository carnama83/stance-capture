// src/components/admin/AdminTrendingDebugPanel.tsx
import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Button } from "@/components/ui/button";

type TopicRow = {
  id: string;
  title: string;
  tier: string | null;
  location_label: string | null;
  published_at: string | null;
};

type TrendingRow = {
  id: string;
  title: string;
  tier: string | null;
  location_label: string | null;
  trending_score: number | null;
  activity_7d: number | null;
  updated_at: string | null;
};

export function AdminTrendingDebugPanel() {
  const supabase = React.useMemo(createSupabase, []);
  const [topics, setTopics] = React.useState<TopicRow[]>([]);
  const [trending, setTrending] = React.useState<TrendingRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      // Latest topics
      const { data: tData, error: tErr } = await supabase
        .from("topics")
        .select("id,title,tier,location_label,published_at")
        .order("published_at", { ascending: false })
        .limit(10);

      if (tErr) throw tErr;

      // Top trending topics (view)
      const { data: vData, error: vErr } = await supabase
        .from("vw_topics_trending")
        .select(
          "id,title,tier,location_label,trending_score,activity_7d,updated_at",
        )
        .limit(10);

      if (vErr) throw vErr;

      setTopics((tData ?? []) as TopicRow[]);
      setTrending((vData ?? []) as TrendingRow[]);
    } catch (err: any) {
      console.error("AdminTrendingDebugPanel error", err);
      setErrorMsg(err.message ?? "Failed to load debug data");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mt-8 border-t pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Trending Debug (topics & vw_topics_trending)
        </h2>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {errorMsg && (
        <div className="rounded bg-red-50 p-2 text-xs text-red-600">
          {errorMsg}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Latest topics */}
        <div>
          <div className="text-xs font-medium mb-1">Latest topics</div>
          <div className="overflow-x-auto border rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-1 text-left">Title</th>
                  <th className="px-2 py-1 text-left">Tier</th>
                  <th className="px-2 py-1 text-left">Location</th>
                  <th className="px-2 py-1 text-left">Published</th>
                </tr>
              </thead>
              <tbody>
                {topics.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="px-2 py-1">{t.title}</td>
                    <td className="px-2 py-1">{t.tier ?? "-"}</td>
                    <td className="px-2 py-1">{t.location_label ?? "-"}</td>
                    <td className="px-2 py-1">
                      {t.published_at
                        ? new Date(t.published_at).toLocaleString()
                        : "-"}
                    </td>
                  </tr>
                ))}
                {!topics.length && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-2 py-3 text-center text-[11px] text-muted-foreground"
                    >
                      No topics found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trending topics */}
        <div>
          <div className="text-xs font-medium mb-1">Trending topics</div>
          <div className="overflow-x-auto border rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-1 text-left">Title</th>
                  <th className="px-2 py-1 text-left">Tier</th>
                  <th className="px-2 py-1 text-left">Location</th>
                  <th className="px-2 py-1 text-right">Score</th>
                  <th className="px-2 py-1 text-right">Activity_7d</th>
                  <th className="px-2 py-1 text-left">Updated</th>
                </tr>
              </thead>
              <tbody>
                {trending.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="px-2 py-1">{t.title}</td>
                    <td className="px-2 py-1">{t.tier ?? "-"}</td>
                    <td className="px-2 py-1">{t.location_label ?? "-"}</td>
                    <td className="px-2 py-1 text-right">
                      {t.trending_score != null
                        ? t.trending_score.toFixed(1)
                        : "-"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {t.activity_7d ?? "-"}
                    </td>
                    <td className="px-2 py-1">
                      {t.updated_at
                        ? new Date(t.updated_at).toLocaleString()
                        : "-"}
                    </td>
                  </tr>
                ))}
                {!trending.length && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-2 py-3 text-center text-[11px] text-muted-foreground"
                    >
                      No trending rows found. Try answering questions &
                      running refresh_topic_region_trends().
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
