// src/routes/topics/Index.tsx
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { createSupabase } from "@/lib/createSupabase";

type Topic = {
  id: string;
  title: string;
  summary?: string | null;
  tags?: string[] | null;
  updated_at?: string | null;
  tier?: string | null;
  location_label?: string | null;
  activity_7d?: number | null;
};

export default function TopicsIndex() {
  const supabase = React.useMemo(createSupabase, []);
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["topics-index"],
    queryFn: async (): Promise<Topic[]> => {
      // Try preferred views first; fall back to base table if needed
      const trySources = [
        { table: "topics_with_counts", select: "id,title,summary,tags,updated_at,tier,location_label,activity_7d" },
        { table: "vw_topics", select: "id,title,summary,tags,updated_at,tier,location_label" },
        { table: "topics", select: "id,title,summary,tags,updated_at:published_at,tier,location_label" },
      ];
      for (const s of trySources) {
        const { data, error } = await supabase
          .from(s.table)
          .select(s.select)
          .order("updated_at", { ascending: false })
          .limit(30);
        if (!error && data) return data as Topic[];
      }
      return [];
    },
    staleTime: 60_000,
  });

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Explore Topics</h1>
        <button className="rounded border px-3 py-1.5 text-sm" onClick={() => navigate("/")}>
          ← Back to Home
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (data?.length ?? 0) === 0 ? (
        <div className="text-sm text-muted-foreground">No topics yet.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data!.map((t) => (
            <div key={t.id} className="rounded-lg border p-4">
              <div className="font-medium">{t.title}</div>
              {t.location_label && (
                <div className="text-[11px] text-slate-500 mt-0.5">{t.location_label}</div>
              )}
              <p className="text-sm text-slate-600 mt-1 line-clamp-3">{t.summary ?? ""}</p>
              <div className="mt-3">
                <button className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm">Take stance</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
