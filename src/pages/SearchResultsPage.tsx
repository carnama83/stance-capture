// src/pages/SearchResultsPage.tsx
import * as React from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import PageLayout from "@/components/PageLayout";
import { SearchBar } from "@/components/search/SearchBar";
import { Loader2 } from "lucide-react";
import { QuestionPhaseBadge } from "@/components/question/QuestionPhaseBadge";

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
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";

  const { data, isLoading, isError, error } = useQuery<SearchResults>({
    queryKey: ["search", query],
    queryFn: () => searchContent(query),
    enabled: !!query,
    staleTime: 60_000,
  });

  const handleSearch = (newQuery: string) => {
    window.location.href = `/search?q=${encodeURIComponent(newQuery)}`;
  };

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto py-6 space-y-6">
        {/* Search Bar */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-900">Search</h1>
          <SearchBar
            onSearch={handleSearch}
            placeholder="Search questions and topics..."
            autoFocus={!query}
          />
        </div>

        {/* Results */}
        {!query && (
          <div className="text-center py-12 text-slate-500">
            <p>Enter a search term to find questions and topics.</p>
          </div>
        )}

        {query && isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            <span className="ml-2 text-sm text-slate-600">Searching...</span>
          </div>
        )}

        {query && isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">
              Search failed: {(error as Error).message}
            </p>
          </div>
        )}

        {query && !isLoading && !isError && data && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="text-sm text-slate-600">
              Found {data.total_questions} question
              {data.total_questions !== 1 ? "s" : ""} and {data.total_topics}{" "}
              topic{data.total_topics !== 1 ? "s" : ""} for &quot;{query}&quot;
            </div>

            {/* Topics */}
            {data.topics && data.topics.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-slate-900">Topics</h2>
                <div className="space-y-2">
                  {data.topics.map((topic) => (
                    <Link
                      key={topic.id}
                      to={`/topics/${topic.id}`}
                      className="block rounded-lg border border-slate-200 p-4 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-slate-900 mb-1">
                            {topic.title}
                          </h3>
                          {topic.summary && (
                            <p className="text-sm text-slate-600 line-clamp-2">
                              {topic.summary}
                            </p>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 shrink-0">
                          {topic.question_count} question
                          {topic.question_count !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Questions */}
            {data.questions && data.questions.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  Questions
                </h2>
                <div className="space-y-2">
                  {data.questions.map((question) => (
                    <Link
                      key={question.id}
                      to={`/q/${question.id}`}
                      className="block rounded-lg border border-slate-200 p-4 hover:bg-slate-50 transition-colors"
                    >
                      <div className="space-y-2">
                        <h3
                          className="font-semibold text-slate-900"
                          dangerouslySetInnerHTML={{
                            __html:
                              question.question_highlight || question.question,
                          }}
                        />
                        {question.summary && (
                          <p className="text-sm text-slate-600 line-clamp-2">
                            {question.summary}
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          {question.topic_title && (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">
                              {question.topic_title}
                            </span>
                          )}
                          {question.phase && question.phase !== "initial" && (
                            <QuestionPhaseBadge phase={question.phase} size="sm" />
                          )}
                          {question.published_at && (
                            <span>
                              {new Date(
                                question.published_at
                              ).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* No Results */}
            {data.questions.length === 0 && data.topics.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                <p>No results found for &quot;{query}&quot;</p>
                <p className="text-sm mt-2">Try different keywords or check your spelling.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
