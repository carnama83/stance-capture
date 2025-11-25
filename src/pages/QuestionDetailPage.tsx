// src/pages/QuestionDetailPage.tsx — User-facing question detail (/q/:id)
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";

type LiveQuestion = {
  id: string;
  question: string;
  summary?: string | null;
  tags?: string[] | null;
  location_label?: string | null;
  published_at?: string | null;
  status?: string | null;
};

async function fetchQuestionById(id: string): Promise<LiveQuestion | null> {
  const sb = getSupabase();

  // Read from the same view backing your homepage feed
  const { data, error } = await sb
    .from("v_live_questions")
    .select(
      "id, question, summary, tags, location_label, published_at, status"
    )
    .eq("id", id)
    .limit(1);

  if (error) {
    console.error("Failed to load question detail", error);
    throw error;
  }

  const row = (data ?? [])[0] as LiveQuestion | undefined;
  if (!row) return null;

  // Optional: ignore non-active questions
  if (row.status && row.status !== "active") {
    return null;
  }

  return row;
}

export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    data: question,
    isLoading,
    isError,
    error,
  } = useQuery({
    enabled: !!id,
    queryKey: ["question-detail", id],
    queryFn: () => fetchQuestionById(id as string),
    staleTime: 60_000,
  });

  const handleBack = () => {
    // Try browser back first; if it lands somewhere odd,
    // users still have the link below back to the homepage.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  let content: React.ReactNode;

  if (isLoading) {
    content = (
      <div className="rounded-lg border p-4 animate-pulse space-y-3">
        <div className="h-5 w-3/4 bg-slate-200 rounded" />
        <div className="h-4 w-full bg-slate-200 rounded" />
        <div className="h-4 w-2/3 bg-slate-200 rounded" />
        <div className="flex gap-2 mt-2">
          <div className="h-5 w-16 bg-slate-200 rounded-full" />
          <div className="h-5 w-20 bg-slate-200 rounded-full" />
        </div>
      </div>
    );
  } else if (isError) {
    content = (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <div className="font-medium mb-1">Something went wrong</div>
        <div>
          {(error as Error)?.message ??
            "We couldn’t load this question. Please try again."}
        </div>
      </div>
    );
  } else if (!question) {
    content = (
      <div className="rounded-lg border p-4 text-sm text-slate-700">
        <div className="font-medium mb-1">Question not found</div>
        <p className="mb-2">
          This question may have been removed or is no longer live.
        </p>
        <Link to="/" className="text-slate-900 underline text-sm">
          ← Back to homepage
        </Link>
      </div>
    );
  } else {
    content = (
      <article className="rounded-lg border p-4 space-y-4">
        {/* Header: question + meta */}
        <header className="space-y-2">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">
            {question.question}
          </h1>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {question.location_label && (
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 bg-slate-50">
                {question.location_label}
              </span>
            )}
            {question.published_at && (
              <span>
                Published{" "}
                {new Date(question.published_at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            )}
            {question.status && (
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 bg-emerald-50 text-emerald-700">
                {question.status === "active" ? "Live" : question.status}
              </span>
            )}
          </div>
        </header>

        {/* Summary */}
        {question.summary && (
          <section>
            <h2 className="text-sm font-medium text-slate-900 mb-1">
              Why this matters
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">
              {question.summary}
            </p>
          </section>
        )}

        {/* Tags */}
        {question.tags && question.tags.length > 0 && (
          <section className="space-y-1">
            <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Tags
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {question.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Placeholder for future stance capture */}
        <section className="border-t pt-4 mt-2">
          <h2 className="text-sm font-medium text-slate-900 mb-2">
            Your stance
          </h2>
          <p className="text-xs text-slate-600 mb-3">
            Soon you&apos;ll be able to record your stance here and see how
            people in your city, state, and country feel about this question.
          </p>
          <div className="inline-flex gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-xs text-slate-500 bg-slate-50 cursor-not-allowed"
              disabled
            >
              Agree (coming soon)
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-xs text-slate-500 bg-slate-50 cursor-not-allowed"
              disabled
            >
              Neutral (coming soon)
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-xs text-slate-500 bg-slate-50 cursor-not-allowed"
              disabled
            >
              Disagree (coming soon)
            </button>
          </div>
        </section>

        {/* Back link */}
        <footer className="pt-2">
          <button
            type="button"
            onClick={handleBack}
            className="text-sm text-slate-900 underline"
          >
            ← Back
          </button>
        </footer>
      </article>
    );
  }

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto py-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold text-slate-900">
            Question detail
          </h1>
          <Link to="/" className="text-xs text-slate-600 hover:underline">
            ← Back to homepage
          </Link>
        </div>
        {content}
      </div>
    </PageLayout>
  );
}
