// src/pages/SearchResultsPage.tsx
import * as React from "react";
import { localeFor } from "@/lib/intlFormat";
import i18n from "@/lib/i18n";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import PageLayout from "@/components/PageLayout";
import { Loader2, Search, X, MessageSquare, Layers } from "lucide-react";
import { QuestionPhaseBadge } from "@/components/question/QuestionPhaseBadge";
import { useTranslation, Trans } from "react-i18next";

type SearchQuestion = {
  id: string;
  question: string;
  question_highlight?: string;
  summary?: string | null;
  topic_title?: string | null;
  topic_id?: string | null;
  published_at?: string | null;
  phase?: string | null;
  rank: number;
};

type SearchTopic = {
  id: string;
  title: string;
  summary?: string | null;
  question_count: number;
  updated_at?: string | null;
  rank: number;
};

type SearchResults = {
  questions: SearchQuestion[];
  topics: SearchTopic[];
  total_questions: number;
  total_topics: number;
  query: string;
};

async function searchContent(
  query: string,
  limit: number = 20,
  offset: number = 0
): Promise<SearchResults> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .rpc("search_content", {
      p_query: query,
      p_limit: limit,
      p_offset: offset,
    })
    .single();

  if (error) {
    console.error("Search error:", error);
    throw error;
  }

  return data as SearchResults;
}

export default function SearchResultsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get("q") || "";

  const [inputValue, setInputValue] = React.useState(query);

  React.useEffect(() => {
    setInputValue(query);
  }, [query]);

  const { data, isLoading, isError, error } = useQuery<SearchResults>({
    queryKey: ["search", query],
    queryFn: () => searchContent(query),
    enabled: query.length >= 2,
    staleTime: 60_000,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = inputValue.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const handleClear = () => {
    setInputValue("");
    navigate("/search");
  };

  const hasResults = data && (data.questions.length > 0 || data.topics.length > 0);
  const noResults = data && data.questions.length === 0 && data.topics.length === 0;

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto py-8 px-4 space-y-8">

        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">{t("search.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("search.subtitle")}
          </p>
        </div>

        {/* Search Input */}
        <form onSubmit={handleSubmit} className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={t("search.placeholder")}
            autoFocus={!query}
            className="w-full pl-11 pr-24 py-3 text-sm border border-border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {inputValue && (
              <button
                type="button"
                onClick={handleClear}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={t("stance.clear")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t("search.button")}
            </button>
          </div>
        </form>

        {/* Empty prompt */}
        {!query && (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t("search.prompt")}</p>
          </div>
        )}

        {/* Loading */}
        {query && isLoading && (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t("search.searchingFor", { query })}</span>
          </div>
        )}

        {/* Error */}
        {query && isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">
              {t("search.failed", { msg: (error as Error).message })}
            </p>
          </div>
        )}

        {/* Results */}
        {query && !isLoading && !isError && hasResults && (
          <div className="space-y-8">

            {/* Summary line */}
            <p className="text-xs text-muted-foreground">
              <Trans
                i18nKey="search.resultSummary"
                values={{ questions: data.total_questions, topics: data.total_topics, query }}
                components={{ q: <span className="font-medium text-foreground" /> }}
              />
            </p>

            {/* Questions */}
            {data.questions.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                    {t("search.questions")}
                  </h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {data.total_questions}
                  </span>
                </div>
                <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                  {data.questions.map((q) => (
                    <Link
                      key={q.id}
                      to={`/q/${q.id}`}
                      className="flex flex-col gap-2 p-4 bg-card hover:bg-accent transition-colors"
                    >
                      <p
                        className="text-sm font-medium text-foreground leading-snug"
                        dangerouslySetInnerHTML={{
                          __html: q.question_highlight || q.question,
                        }}
                      />
                      {q.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {q.summary}
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {q.topic_title && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            <Layers className="h-3 w-3" />
                            {q.topic_title}
                          </span>
                        )}
                        {q.phase && q.phase !== "initial" && (
                          <QuestionPhaseBadge phase={q.phase} size="sm" />
                        )}
                        {q.published_at && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(q.published_at).toLocaleDateString(localeFor(i18n.language), {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Topics */}
            {data.topics.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                    {t("search.topics")}
                  </h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {data.total_topics}
                  </span>
                </div>
                <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                  {data.topics.map((topic) => (
                    <Link
                      key={topic.id}
                      to={`/topics/${topic.id}`}
                      className="flex items-start justify-between gap-4 p-4 bg-card hover:bg-accent transition-colors"
                    >
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {topic.title}
                        </p>
                        {topic.summary && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {topic.summary}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full whitespace-nowrap">
                        {t("search.questionCount", { count: topic.question_count })}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* No results */}
        {query && !isLoading && !isError && noResults && (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-foreground">{t("search.noResults", { query })}</p>
            <p className="text-sm mt-1">{t("search.tryDifferent")}</p>
          </div>
        )}

      </div>
    </PageLayout>
  );
}
