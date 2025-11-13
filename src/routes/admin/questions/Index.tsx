import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type QuestionRow = {
  id: string;
  topic_id?: string | null;
  question_text: string;
  created_at?: string | null;
  status?: string | null;
};

export default function AdminQuestionsPage() {
  const sb = React.useMemo(getSupabase, []);
  const [rows, setRows] = React.useState<QuestionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await sb
          .from("ai_question_drafts")
          .select("id, topic_id, question_text, created_at, status")
          .order("created_at", { ascending: false })
          .limit(25);
        if (error) throw error;
        if (!cancelled) setRows(data as QuestionRow[]);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load questions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sb]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">AI Question Drafts</h1>
        <Button size="sm" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">
          {error}
        </div>
      )}

      <div className="grid gap-3">
        {rows.map((q) => (
          <Card key={q.id} className="p-4">
            <div className="font-medium">{q.question_text}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {q.status ?? "pending"} ·{" "}
              {q.created_at ? new Date(q.created_at).toLocaleString() : "—"}
            </div>
          </Card>
        ))}

        {!loading && rows.length === 0 && (
          <div className="text-sm text-muted-foreground">No questions yet.</div>
        )}
      </div>
    </div>
  );
}
