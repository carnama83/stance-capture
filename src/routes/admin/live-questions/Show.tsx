import * as React from "react";
import { useParams, Link } from "react-router-dom";
import { createSupabase } from "@/lib/createSupabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

type QuestionStatus = "active" | "archived";

type QuestionDetail = {
  id: string;
  question_draft_id: string | null;
  topic_draft_id: string | null;
  news_item_id: string | null;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  status: QuestionStatus;
  created_at: string;
  published_at: string;
  question_drafts?: {
    id: string;
    question: string | null;
    summary: string | null;
    tags: string[] | null;
    location_label: string | null;
    status: string | null;
  } | null;
  topic_drafts?: {
    id: string;
    title: string | null;
    summary: string | null;
    tags: string[] | null;
    location_label: string | null;
    status: string | null;
  } | null;
  news_items?: {
    id: string;
    title: string | null;
    summary: string | null;
    url: string | null;
    published_at: string | null;
  } | null;
};

export default function AdminLiveQuestionShowPage() {
  const { id } = useParams();
  const supabase = React.useMemo(createSupabase, []);
  const [loading, setLoading] = React.useState(true);
  const [row, setRow] = React.useState<QuestionDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("questions")
        .select(
          `
          id,
          question_draft_id,
          topic_draft_id,
          news_item_id,
          question,
          summary,
          tags,
          location_label,
          status,
          created_at,
          published_at,
          question_drafts (
            id,
            question,
            summary,
            tags,
            location_label,
            status
          ),
          topic_drafts (
            id,
            title,
            summary,
            tags,
            location_label,
            status
          ),
          news_items (
            id,
            title,
            summary,
            url,
            published_at
          )
        `,
        )
        .eq("id", id)
        .single();

      if (error) {
        console.error("Failed to load question detail:", error);
        setError(error.message);
        setRow(null);
      } else {
        setRow(data as QuestionDetail);
      }
      setLoading(false);
    })();
  }, [id, supabase]);

  if (!id) {
    return (
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Live Question</CardTitle>
        </CardHeader>
        <CardContent>Missing question id.</CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Live Question</CardTitle>
        </CardHeader>
        <CardContent>Loading…</CardContent>
      </Card>
    );
  }

  if (error || !row) {
    return (
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Live Question</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-red-600">
            Failed to load question: {error ?? "Unknown error"}
          </div>
          <Button asChild variant="outline">
            <Link to="/admin/live-questions">Back to Live Questions</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const createdAt = row.created_at
    ? new Date(row.created_at).toLocaleString()
    : "—";
  const publishedAt = row.published_at
    ? new Date(row.published_at).toLocaleString()
    : "—";

  const news = row.news_items ?? null;

  return (
    <Card className="max-w-4xl mx-auto space-y-4">
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <CardTitle className="flex items-center gap-2">
            <Badge
              variant={row.status === "active" ? "default" : "secondary"}
            >
              {row.status === "active" ? "Active" : "Archived"}
            </Badge>
            <span>Live Question</span>
          </CardTitle>
          <div className="text-xs text-muted-foreground space-x-3">
            <span>Created: {createdAt}</span>
            <span>Published: {publishedAt}</span>
            {row.location_label && <span>· {row.location_label}</span>}
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/live-questions">Back to list</Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Question
          </h2>
          <p className="text-lg font-semibold whitespace-pre-wrap">
            {row.question}
          </p>
          {row.tags && row.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {row.tags.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {row.summary && (
            <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
              {row.summary}
            </p>
          )}
        </section>

        {row.topic_drafts && (
          <section className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Source Topic Draft
            </h2>
            <div className="text-sm">
              <div className="font-medium">
                {row.topic_drafts.title ?? "(untitled topic)"}
              </div>
              {row.topic_drafts.summary && (
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {row.topic_drafts.summary}
                </p>
              )}
            </div>
          </section>
        )}

        {row.question_drafts && (
          <section className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Source Question Draft
            </h2>
            <div className="text-sm">
              <div className="font-medium">
                {row.question_drafts.question ?? "(question draft)"}
              </div>
              {row.question_drafts.summary && (
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {row.question_drafts.summary}
                </p>
              )}
            </div>
          </section>
        )}

        {news && (
          <section className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Related News Article
            </h2>
            <div className="text-sm space-y-1">
              <div className="font-medium">
                {news.title ?? "(no title)"}
              </div>
              {news.published_at && (
                <div className="text-xs text-muted-foreground">
                  Published:{" "}
                  {new Date(news.published_at).toLocaleString()}
                </div>
              )}
              {news.summary && (
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {news.summary}
                </p>
              )}
              {news.url && (
                <a
                  href={news.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 underline mt-1"
                >
                  View article <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </section>
        )}

        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-muted-foreground">
            IDs
          </h2>
          <div className="text-xs text-muted-foreground space-y-1 break-all">
            <div>Question id: {row.id}</div>
            {row.question_draft_id && (
              <div>Question draft id: {row.question_draft_id}</div>
            )}
            {row.topic_draft_id && (
              <div>Topic draft id: {row.topic_draft_id}</div>
            )}
            {row.news_item_id && (
              <div>News item id: {row.news_item_id}</div>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
