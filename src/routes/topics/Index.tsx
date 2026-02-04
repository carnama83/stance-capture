// src/routes/topics/Index.tsx
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import PageLayout from "@/components/PageLayout";
import { FollowTopicButton } from "@/components/FollowTopicButton";

type Session = import("@supabase/supabase-js").Session;

type TopicBase = {
  id: string;
  title: string;
  summary?: string | null;
  tags?: string[] | null;
  tier?: string | null;
  location_label?: string | null;
  created_at?: string | null; // topics has created_at
  parent_topic_id?: string | null; // for canonical filter
};

type TopicTrendingRow = {
  id: string;
  title: string;
  summary?: string | null;
  tags?: string[] | null;
  updated_at?: string | null; // from topic_region_trends
  tier?: string | null;
  location_label?: string | null;
  trending_score?: number | null;
  activity_7d?: number | null;
  location_id?: string | null;
};

type TopicCardModel = {
  id: string;
  title: string;
  summary?: string | null;
  tags?: string[] | null;
  tier?: string | null;
  location_label?: string | null;
  // UI timestamp (we normalize created_at/updated_at into this)
  updated_at?: string | null;
  // Optional trending fields
  trending_score?: number | null;
  activity_7d?: number | null;
  // source label (debug)
  _source?: "trending" | "all" | "following";
};

function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  return session;
}

function formatDateShort(iso?: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return null;
  }
}

function trendLabel(score?: number | null, activity?: number | null) {
  const s = score ?? 0;
  const a = activity ?? 0;
  if (a >= 20 || s >= 80) return "Very hot";
  if (a >= 10 || s >= 50) return "Heating up";
  if (a >= 3 || s >= 20) return "Some activity";
  return "Quiet";
}

type TabKey = "trending" | "all" | "following";

export default function TopicsIndex() {
  const supabase = getSupabase()!;
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const isAuthed = !!session;

  const [tab, setTab] = React.useState<TabKey>("trending");
  const [search, setSearch] = React.useState("");
  const [allCursor, setAllCursor] = React.useState<{ created_at: string; id: string } | null>(null);
  const [allItems, setAllItems] = React.useState<TopicCardModel[]>([]);
  const [allHasMore, setAllHasMore] = React.useState(true);
  const pageSize = 24;

  // --- Trending tab: uses your deployed RPC (canonical + region-aware)
  const trendingQ = useQuery({
    queryKey: ["topics-index", "trending"],
    enabled: tab === "trending",
    queryFn: async (): Promise<TopicCardModel[]> => {
      const { data, error } = await supabase.rpc("list_trending_topics_for_me", {
        p_limit: 60,
      });

      // If RPC doesn't exist or fails, fall back to empty
      if (error) {
        console.warn("list_trending_topics_for_me failed", error);
        return [];
      }

      const rows = (data ?? []) as TopicTrendingRow[];
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary ?? null,
        tags: r.tags ?? [],
        tier: r.tier ?? null,
        location_label: r.location_label ?? null,
        updated_at: r.updated_at ?? null,
        trending_score: r.trending_score ?? null,
        activity_7d: r.activity_7d ?? null,
        _source: "trending",
      }));
    },
    staleTime: 60_000,
  });

  // --- Following tab: user_topic_follows -> topics
  const followingQ = useQuery({
    queryKey: ["topics-index", "following", session?.user?.id ?? "anon"],
    enabled: tab === "following" && isAuthed,
    queryFn: async (): Promise<TopicCardModel[]> => {
      // Join via implicit FK: user_topic_follows(topic_id) -> topics(id)
      const { data, error } = await supabase
        .from("user_topic_follows")
        .select("topic_id, topics:topic_id(id,title,summary,tags,tier,location_label,created_at,parent_topic_id)")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        console.error("Failed to load followed topics", error);
        return [];
      }

      const rows = (data ?? []) as any[];
      const topics = rows
        .map((r) => r.topics as TopicBase | null)
        .filter(Boolean)
        // canonical only
        .filter((t: TopicBase) => !t.parent_topic_id);

      return topics.map((t) => ({
        id: t.id,
        title: t.title,
        summary: t.summary ?? null,
        tags: t.tags ?? [],
        tier: t.tier ?? null,
        location_label: t.location_label ?? null,
        updated_at: t.created_at ?? null, // normalize
        trending_score: null,
        activity_7d: null,
        _source: "following",
      }));
    },
    staleTime: 60_000,
  });

  // --- All tab: composite cursor pagination on topics.created_at + id
  const allPageQ = useQuery({
    queryKey: ["topics-index", "all", allCursor?.created_at ?? null, allCursor?.id ?? null],
    enabled: tab === "all" && allHasMore,
    queryFn: async (): Promise<{ items: TopicCardModel[]; nextCursor: { created_at: string; id: string } | null }> => {
      let q = supabase
        .from("topics")
        .select("id,title,summary,tags,tier,location_label,created_at,parent_topic_id")
        .is("parent_topic_id", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(pageSize);

      // Composite cursor: (created_at, id) descending
      if (allCursor) {
        // For DESC ordering, "next page" is strictly less than the last row
        q = q.or(
          `created_at.lt.${allCursor.created_at},and(created_at.eq.${allCursor.created_at},id.lt.${allCursor.id})`
        );
      }

      const { data, error } = await q;

      if (error) {
        console.error("Failed to load topics (all)", error);
        return { items: [], nextCursor: null };
      }

      const rows = (data ?? []) as TopicBase[];

      const items: TopicCardModel[] = rows.map((t) => ({
        id: t.id,
        title: t.title,
        summary: t.summary ?? null,
        tags: t.tags ?? [],
        tier: t.tier ?? null,
        location_label: t.location_label ?? null,
        updated_at: t.created_at ?? null, // normalize
        trending_score: null,
        activity_7d: null,
        _source: "all",
      }));

      const last = rows[rows.length - 1];
      const nextCursor =
        last?.created_at && last?.id && rows.length === pageSize
          ? { created_at: last.created_at, id: last.id }
          : null;

      return { items, nextCursor };
    },
    staleTime: 60_000,
  });

  // Append All-tab pages into local list
  React.useEffect(() => {
    if (tab !== "all") return;
    if (!allPageQ.data) return;

    const { items, nextCursor } = allPageQ.data;

    setAllItems((prev) => {
      const seen = new Set(prev.map((x) => x.id));
      const merged = [...prev];
      for (const it of items) {
        if (!seen.has(it.id)) merged.push(it);
      }
      return merged;
    });

    setAllCursor(nextCursor);
    setAllHasMore(!!nextCursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPageQ.data, tab]);

  // Reset All list when switching into All tab
  React.useEffect(() => {
    if (tab !== "all") return;
    setAllItems([]);
    setAllCursor(null);
    setAllHasMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const rawItems: TopicCardModel[] = React.useMemo(() => {
    if (tab === "trending") return trendingQ.data ?? [];
    if (tab === "following") return followingQ.data ?? [];
    return allItems;
  }, [tab, trendingQ.data, followingQ.data, allItems]);

  const filtered = React.useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rawItems;
    return rawItems.filter((t) => {
      const hay = `${t.title ?? ""} ${t.summary ?? ""} ${(t.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(s);
    });
  }, [rawItems, search]);

  const isLoading =
    (tab === "trending" && trendingQ.isLoading) ||
    (tab === "following" && followingQ.isLoading) ||
    (tab === "all" && allPageQ.isLoading && allItems.length === 0);

  const emptyState =
    !isLoading &&
    (tab === "following" && !isAuthed
      ? "Log in to see topics you follow."
      : filtered.length === 0
      ? tab === "trending"
        ? "No trending topics yet."
        : tab === "following"
        ? "You aren’t following any topics yet."
        : "No topics yet."
      : null);

  return (
    <PageLayout>
      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Explore Topics</h1>
            <p className="text-sm text-slate-600">
              Browse what’s happening, follow topics, and dive into the questions inside each topic.
            </p>
          </div>
          <button
            className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
            onClick={() => navigate("/")}
          >
            ← Back to Home
          </button>
        </div>

        {/* Tabs + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="inline-flex rounded-lg border bg-white overflow-hidden">
            <button
              className={`px-3 py-1.5 text-sm ${
                tab === "trending" ? "bg-slate-900 text-white" : "hover:bg-slate-50"
              }`}
              onClick={() => setTab("trending")}
              type="button"
            >
              Trending
            </button>
            <button
              className={`px-3 py-1.5 text-sm border-l ${
                tab === "all" ? "bg-slate-900 text-white" : "hover:bg-slate-50"
              }`}
              onClick={() => setTab("all")}
              type="button"
            >
              All
            </button>
            <button
              className={`px-3 py-1.5 text-sm border-l ${
                tab === "following" ? "bg-slate-900 text-white" : "hover:bg-slate-50"
              }`}
              onClick={() => setTab("following")}
              type="button"
              disabled={!isAuthed}
              title={!isAuthed ? "Log in to view followed topics" : undefined}
            >
              Following
            </button>
          </div>

          <div className="flex-1 sm:max-w-sm">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search topics…"
              className="w-full rounded-lg border px-3 py-2 text-sm bg-white"
            />
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : emptyState ? (
          <div className="text-sm text-slate-500">{emptyState}</div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((t) => {
                const dateText = formatDateShort(t.updated_at);
                const showTrending = tab === "trending";
                const score = t.trending_score ?? 0;
                const activity = t.activity_7d ?? 0;

                return (
                  <div key={t.id} className="rounded-lg border bg-white p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to={`/topics/${t.id}`}
                          className="font-semibold text-slate-900 hover:underline line-clamp-2"
                          title={t.title}
                        >
                          {t.title}
                        </Link>

                        {t.location_label && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {t.location_label}
                            {t.tier ? <span className="ml-1 text-slate-400">· {t.tier}</span> : null}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0">
                        <div className="scale-90 origin-top-right">
                          <FollowTopicButton topicId={t.id} />
                        </div>
                      </div>
                    </div>

                    {t.summary ? (
                      <p className="text-sm text-slate-600 line-clamp-3">{t.summary}</p>
                    ) : (
                      <p className="text-sm text-slate-400 italic">No summary yet.</p>
                    )}

                    {t.tags && t.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {t.tags.slice(0, 6).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700"
                          >
                            {tag}
                          </span>
                        ))}
                        {t.tags.length > 6 && (
                          <span className="text-[10px] text-slate-500">+{t.tags.length - 6}</span>
                        )}
                      </div>
                    )}

                    <div className="pt-2 border-t flex items-center justify-between gap-2">
                      <div className="text-[11px] text-slate-500">
                        {dateText ? <>Updated {dateText}</> : <>&nbsp;</>}
                      </div>

                      {showTrending && (
                        <div className="text-[11px] text-slate-700 flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 bg-slate-50">
                            {trendLabel(score, activity)}
                          </span>
                          <span className="tabular-nums">
                            {Math.round(score)} · {activity} / 7d
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="pt-2">
                      <Link
                        to={`/topics/${t.id}`}
                        className="inline-flex items-center justify-center w-full rounded bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-800"
                      >
                        View topic
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load more (All tab only) */}
            {tab === "all" && allHasMore && (
              <div className="pt-4 flex justify-center">
                <button
                  type="button"
                  className="rounded border px-4 py-2 text-sm hover:bg-slate-50"
                  onClick={() => {
                    // Trigger next page by re-enabling query key (cursor already updated)
                    // We simply "refetch" with current cursor.
                    allPageQ.refetch();
                  }}
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
}
