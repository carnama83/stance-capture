// src/pages/QuestionDetailPage.tsx
import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";

type Question = {
  id: string;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  published_at: string | null;
  status: string | null;
  news_item_id?: string | null; // adjust name if your FK column is different
};

type NewsItem = {
  id: string;
  title: string;
  url: string | null;
  source_name: string | null;
  published_at: string | null;
};

async function fetchQuestionWithNews(id: string) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not initialized");

  // 1) Load the question (public read via questions_public_read)
  const { data: q, error: qErr } = await sb
    .from("questions")
    .select(
      "id, question, summary, tags, location_label, published_at, status, news_item_id"
    )
    .eq("id", id)
    .single();

  if (qErr) throw qErr;
  const question = q as Question;

  // 2) Try to load linked news item, if we have a FK
  let news: NewsItem | null = null;
  if (question.news_item_id) {
    const { data: n, error: nErr } = await sb
      .from("news_items")
      .select("id, title, url, source_name, published_at")
      .eq("id", question.news_item_id)
      .single();

    if (!nErr && n) {
      news = n as NewsItem;
    }
    // If there *is* an error (e.g., RLS), we just skip showing the article.
  }

  return { question, news };
}

export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["question-detail", id],
    enabled: !!id,
    queryFn: () => fetchQuestionWithNews(id as string),
  });

  const actions = (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
    >
      ← Back
    </button>
  );

  return (
    <PageLayout rightSlot={actions}>
      <div className="max-w-3xl mx-auto py-6">
        {isLoading && (
          <div className="text-sm text-slate-600">Loading question…</div>
        )}

        {isError && (
          <div className="text-sm text-red-600">
            Could not load this question: {(error as Error)?.message}
          </div>
        )}

        {!isLoading && !isError && !data && (
          <div className="text-sm text-slate-600">
            Question not found or not available.
          </div>
        )}

        {data && (
          <>
            {/* Question header */}
            <header className="mb-6">
              <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                Question
              </p>
              <h1 className="text-2xl font-semibold">{data.question.question}</h1>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                {data.question.location_label && (
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5">
                    {data.question.location_label}
                  </span>
                )}
                {data.question.published_at && (
                  <span>
                    Published{" "}
                    {new Date(data.question.published_at).toLocaleString(
                      undefined,
                      { dateStyle: "medium", timeStyle: "short" }
                    )}
                  </span>
                )}
                {data.question.status && (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5">
                    {data.question.status}
                  </span>
                )}
              </div>
            </header>

            {/* Summary */}
            {data.question.summary && (
              <section className="mb-6">
                <h2 className="text-sm font-medium mb-1">Summary</h2>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {data.question.summary}
                </p>
              </section>
            )}

            {/* Tags */}
            {data.question.tags && data.question.tags.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-medium mb-1">Tags</h2>
                <div className="flex flex-wrap gap-2">
                  {data.question.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-slate-50 border px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Linked news item */}
            <section className="mb-6">
              <h2 className="text-sm font-medium mb-2">Related news</h2>
              {data.news ? (
                <div className="rounded-lg border bg-white px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <div className="text-sm font-semibold">
                      {data.news.url ? (
                        <a
                          href={data.news.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {data.news.title}
                        </a>
                      ) : (
                        data.news.title
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      {data.news.source_name && (
                        <span>{data.news.source_name}</span>
                      )}
                      {data.news.published_at && (
                        <span className="ml-2">
                          {new Date(
                            data.news.published_at
                          ).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {data.news.url && (
                      <div className="mt-1 text-xs">
                        <a
                          href={data.news.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-700 underline"
                        >
                          View full article
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Linked source article is not available.
                </p>
              )}
            </section>

            {/* Placeholder for future stance UI */}
            <section className="mt-8 border-t pt-4">
              <h2 className="text-sm font-medium mb-2">Your stance</h2>
              <p className="text-xs text-slate-500">
                In a future epic, this is where you’ll record your stance and
                compare with your region.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-slate-600">
                <span>Coming soon</span>
              </div>
            </section>

            {/* Link back to home */}
            <div className="mt-8 text-xs">
              <Link to="/" className="text-slate-700 underline">
                ← Back to home
              </Link>
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}
