// src/routes/admin/ai-drafts/index.tsx
import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AiDraftState = "draft" | "published" | "error" | string;

type AiQuestionDraft = {
  id: string;
  title: string;
  summary: string | null;
  tags: string[] | null;
  sources: string[] | null;
  lang: string | null;
  cluster_id: string | null;
  state: AiDraftState;
  created_at: string;
};

export default function AiDraftsPage() {
  const supabase = React.useMemo(createSupabase, []);
  const [rows, setRows] = React.useState<AiQuestionDraft[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [stateFilter, setStateFilter] = React.useState<"all" | AiDraftState>("draft");
  const [publishingId, setPublishingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("ai_question_drafts")
      .select("id,title,summary,tags,sources,lang,cluster_id,state,created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (stateFilter !== "all") {
      q = q.eq("state", stateFilter);
    }

    const { data, error } = await q;
    if (error) {
      console.error("Failed to load ai_question_drafts:", error);
      setRows([]);
      setLoading(false);
      return;
    }

    let items = (data ?? []) as AiQuestionDraft[];
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      items = items.filter((r) =>
        (r.title ?? "").toLowerCase().includes(needle),
      );
    }

    setRows(items);
    setLoading(false);
  }, [supabase, stateFilter, search]);

  React.useEffect(() => {
    load();
  }, [load]);

  const handlePublishTopic = async (draft: AiQuestionDraft) => {
    if (draft.state !== "draft") {
      alert("Only DRAFT AI entries can be published as topics.");
      return;
    }
    if (!confirm("Publish this AI draft as a Topic?")) return;

    setPublishingId(draft.id);
    try {
      const { data, error } = await supabase.rpc("admin_publish_draft", {
        p_draft_id: draft.id,
        p_region_ids: null, // later we can pass specific region ids
      });

      if (error) {
        console.error("admin_publish_draft error:", error);
        alert(error.message ?? "Failed to publish topic.");
        return;
      }

      alert(`Topic published. id=${data}`);
      load();
    } catch (err: any) {
      console.error("admin_publish_draft exception:", err);
      alert(err?.message ?? String(err));
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <Card className="max-w-6xl mx-auto">
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>AI Question Drafts (Topics)</CardTitle>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <select
            className="border rounded px-2 py-1 text-sm"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as "all" | AiDraftState)}
          >
            <option value="all">Any state</option>
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="error">error</option>
          </select>
          <Button variant="outline" size="sm" onClick={load}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No AI drafts found.
          </div>
        )}
        {rows.map((row) => (
          <div key={row.id} className="border rounded p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-xs text-muted-foreground space-x-2">
                  <span>State: {row.state}</span>
                  <span>
                    Created:{" "}
                    {row.created_at
                      ? new Date(row.created_at).toLocaleString()
                      : "—"}
                  </span>
                </div>
                <h3 className="text-base font-semibold break-words">
                  {row.title}
                </h3>
                {row.tags && row.tags.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Tags: {row.tags.join(", ")}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handlePublishTopic(row)}
                disabled={publishingId === row.id}
              >
                {publishingId === row.id ? "Publishing…" : "Publish Topic"}
              </Button>
            </div>
            {row.summary && (
              <p className="text-sm whitespace-pre-wrap">{row.summary}</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
