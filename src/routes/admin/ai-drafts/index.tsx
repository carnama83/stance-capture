import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

type FreshnessRow = {
  last_ingest_queue: string | null;
  last_topic_cluster: string | null;
  last_ingest: string | null;
  last_cluster: string | null;
  last_generate: string | null;
};

type Stats = {
  newsCount: number | null;
  newsLast24h: number | null;
  topicDraftCount: number | null;
  topicDraftsLast24h: number | null;
  questionDraftCount: number | null;
  questionDraftsLast24h: number | null;
  liveQuestionCount: number | null;
  freshness: FreshnessRow | null;
};

export default function AdminAIDashboardPage() {
  const supabase = React.useMemo(createSupabase, []);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastRefreshMs, setLastRefreshMs] = React.useState<number | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = React.useState<string | null>(null);

  const loadStats = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    const started = performance.now();
    try {
      const now = new Date();
      const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      // Helper to get total + last24h counts from a table by created_at
      const countPair = async (table: string) => {
        const total = await supabase
          .from(table)
          .select("id", { count: "exact", head: true });

        const last24h = await supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .gte("created_at", since24h);

        return {
          total: total.error ? null : total.count ?? null,
          last24h: last24h.error ? null : last24h.count ?? null,
        };
      };

      const [news, topicDrafts, questionDrafts, liveQuestions, freshnessRes] =
        await Promise.all([
          countPair("news_items"),
          countPair("topic_drafts"),
          countPair("topic_question_drafts"),
          supabase
            .from("questions")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("pipeline_freshness")
            .select("*")
            .maybeSingle(),
        ]);

      const freshness: FreshnessRow | null =
        freshnessRes.error || !freshnessRes.data
          ? null
          : (freshnessRes.data as FreshnessRow);

      setStats({
        newsCount: news.total,
        newsLast24h: news.last24h,
        topicDraftCount: topicDrafts.total,
        topicDraftsLast24h: topicDrafts.last24h,
        questionDraftCount: questionDrafts.total,
        questionDraftsLast24h: questionDrafts.last24h,
        liveQuestionCount: liveQuestions.error
          ? null
          : liveQuestions.count ?? null,
        freshness,
      });

      const duration = Math.round(performance.now() - started);
      setLastRefreshMs(duration);
      setLastRefreshAt(new Date().toLocaleString());
    } catch (err: any) {
      console.error("Failed to load AI dashboard stats", err);
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => {
    loadStats();
  }, [loadStats]);

  const formatTs = (ts: string | null) =>
    ts ? new Date(ts).toLocaleString() : "—";

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">AI Pipeline Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            High-level view of ingestion → topics → questions, plus pipeline freshness.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadStats} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            {loading ? "Refreshing…" : "Refresh stats"}
            <RefreshCw className="ml-1 h-3 w-3" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Failed to load stats: {error}
        </div>
      )}

      {lastRefreshAt && (
        <p className="text-[11px] text-muted-foreground">
          Last refresh: {lastRefreshAt}
          {lastRefreshMs != null && ` • took ${lastRefreshMs} ms`}
        </p>
      )}

      {/* Top-level counts */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <MetricCard
          label="News items"
          total={stats?.newsCount}
          last24h={stats?.newsLast24h}
          hint="Raw articles in news_items"
        />
        <MetricCard
          label="Topic drafts"
          total={stats?.topicDraftCount}
          last24h={stats?.topicDraftsLast24h}
          hint="AI + pipeline-created topics awaiting review"
        />
        <MetricCard
          label="Question drafts"
          total={stats?.questionDraftCount}
          last24h={stats?.questionDraftsLast24h}
          hint="AI-generated stance questions for topics"
        />
        <MetricCard
          label="Live questions"
          total={stats?.liveQuestionCount}
          last24h={null}
          hint="Questions currently available to users"
        />
      </div>

      {/* Pipeline freshness */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pipeline freshness</CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {!stats?.freshness ? (
            <p className="text-muted-foreground">
              No freshness data yet. Run the pipeline at least once.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-2 gap-x-6">
              <FreshnessRowView
                label="Ingest (legacy queue)"
                value={formatTs(stats.freshness.last_ingest_queue)}
              />
              <FreshnessRowView
                label="Cluster (legacy topic_clusters)"
                value={formatTs(stats.freshness.last_topic_cluster)}
              />
              <FreshnessRowView
                label="Ingest (news_items)"
                value={formatTs(stats.freshness.last_ingest)}
              />
              <FreshnessRowView
                label="Cluster (topic_drafts)"
                value={formatTs(stats.freshness.last_cluster)}
              />
              <FreshnessRowView
                label="Generate (topic_question_drafts)"
                value={formatTs(stats.freshness.last_generate)}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard(props: {
  label: string;
  total: number | null | undefined;
  last24h: number | null | undefined;
  hint?: string;
}) {
  const { label, total, last24h, hint } = props;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold">
          {total == null ? "—" : total.toLocaleString()}
        </div>
        {typeof last24h === "number" && (
          <div className="text-xs text-muted-foreground">
            Last 24h:{" "}
            <span className="font-medium">
              {last24h.toLocaleString()}
            </span>
          </div>
        )}
        {hint && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {hint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FreshnessRowView(props: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{props.label}</span>
      <span className="text-xs font-medium">{props.value}</span>
    </div>
  );
}
