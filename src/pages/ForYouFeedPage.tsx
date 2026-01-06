// src/pages/ForYouFeedPage.tsx
import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import PageLayout from "@/components/PageLayout";
import { Loader2, Sparkles } from "lucide-react";

type ForYouQuestion = {
  id: string;
  question: string;
  summary?: string | null;
  topic_title?: string | null;
  topic_id?: string | null;
  published_at?: string | null;
};

type ForYouFeed = {
  questions: ForYouQuestion[];
  count: number;
};

async function getForYouFeed(limit: number = 20): Promise<ForYouFeed> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .rpc("get_for_you_feed", { p_limit: limit })
    .single();

  if (error) {
    console.error("For You feed error:", error);
    throw error;
  }

  return data as ForYouFeed;
}

export default function ForYouFeedPage() {
  const { data, isLoading, isError, error } = useQuery<ForYouFeed>({
    queryKey: ["for-you-feed"],
    queryFn: () => getForYouFeed(20),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-slate-900">For You</h1>
        </div>
        <p className="text-sm text-slate-600">
          Questions tailored to your interests and location
        </p>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            <span className="ml-2 text-sm text-slate-600">
              Loading your feed...
            </span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">
              Failed to load feed: {(error as Error).message}
            </p>
          </div>
        )}

        {/* Feed */}
        {!isLoading && !isError && data && (
          <div className="space-y-4">
            {data.questions && data.questions.length > 0 ? (
              <div className="space-y-3">
                {data.questions.map((question) => (
                  <Link
                    key={question.id}
                    to={`/q/${question.id}`}
                    className="block rounded-lg border border-slate-200 p-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="space-y-2">
                      <h3 className="font-semibold text-slate-900">
                        {question.question}
                      </h3>
                      {question.summary && (
                        <p className="text-sm text-slate-600 line-clamp-2">
                          {question.summary}
                        </p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        {question.topic_title && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                            {question.topic_title}
                          </span>
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
            ) : (
              <div className="text-center py-12 space-y-4">
                <p className="text-slate-600">
                  No personalized questions yet.
                </p>
                <p className="text-sm text-slate-500">
                  Follow some topics or answer questions in your area to get personalized recommendations.
                </p>
                <div className="flex gap-3 justify-center">
                  <Link
                    to="/topics"
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors"
                  >
                    Explore Topics
                  </Link>
                  <Link
                    to="/"
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 transition-colors"
                  >
                    Browse All Questions
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
