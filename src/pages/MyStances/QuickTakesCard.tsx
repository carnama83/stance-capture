// src/pages/MyStances/QuickTakesCard.tsx
// Phase 2a — Q4: Three personalized unanswered questions from topics the user
// has already engaged with. Uses get_for_you_feed (excludes answered, prioritizes
// followed topics and user region). Non-pressuring, fully skippable.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";

type ForYouQuestion = {
  id: string;
  question: string;
  summary?: string | null;
  topic_title?: string | null;
  topic_id?: string | null;
};

type ForYouFeed = {
  questions: ForYouQuestion[];
  count: number;
};

export default function QuickTakesCard() {
  const sb = React.useMemo(getSupabase, []);
  const [skipped, setSkipped] = React.useState(false);
  const [answeredIds, setAnsweredIds] = React.useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<ForYouFeed>({
    queryKey: ["quick-takes"],
    enabled: !!sb && !skipped,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("Supabase not available");
      // Match exactly how ForYouFeedPage calls it — p_limit only, .single()
      const { data, error } = await supabase
        .rpc("get_for_you_feed", { p_limit: 3 })
        .single();
      if (error) throw error;
      return data as ForYouFeed;
    },
  });

  const questions = (data?.questions ?? []).slice(0, 3);

  const markAnswered = (id: string) => {
    setAnsweredIds((prev) => new Set([...prev, id]));
  };

  const allDone = questions.length > 0 && questions.every((q) => answeredIds.has(q.id));

  if (skipped) return null;

  return (
    <Card className="mb-3">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold text-slate-900">
              Today's 3 quick takes
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 mt-0.5">
              Optional. Takes less than a minute.
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={() => setSkipped(true)}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors whitespace-nowrap mt-0.5"
          >
            Skip for now
          </button>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {isLoading && (
          <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading questions…
          </div>
        )}

        {!isLoading && questions.length === 0 && (
          <p className="text-xs text-slate-500 py-2">
            No new questions right now — check back later.
          </p>
        )}

        {!isLoading && allDone && (
          <p className="text-xs text-slate-600 py-2">
            Thanks. You can come back anytime.
          </p>
        )}

        {!isLoading && !allDone && questions.length > 0 && (
          <ol className="space-y-2">
            {questions.map((q, idx) => {
              const done = answeredIds.has(q.id);
              return (
                <li key={q.id} className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-[11px] font-medium text-slate-400 w-4 shrink-0">
                    {idx + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    {q.topic_title && (
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-0.5">
                        {q.topic_title}
                      </p>
                    )}
                    <Link
                      to={`/q/${q.id}`}
                      onClick={() => markAnswered(q.id)}
                      className={[
                        "text-sm leading-snug hover:underline transition-colors",
                        done
                          ? "text-slate-400 line-through"
                          : "text-slate-900 font-medium",
                      ].join(" ")}
                    >
                      {q.question}
                    </Link>
                    {q.summary && !done && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                        {q.summary}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
