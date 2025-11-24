// src/components/home/LatestQuestionsSection.tsx
import { Link } from "react-router-dom";
import { useTailoredFeed } from "@/hooks/useTailoredFeed";
import { useAuth } from "@/auth/useAuth"; // or whatever hook you use for auth
import { formatDistanceToNow } from "date-fns";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card"; // shadcn card

export function LatestQuestionsSection() {
  const { user } = useAuth() ?? { user: null }; // adjust to your auth API
  const { questions, isLoading, isError, error } = useTailoredFeed({
    userId: user?.id ?? null,
    limit: 20,
  });

  if (isLoading) {
    return (
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Latest Questions</h2>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-lg bg-muted animate-pulse"
            />
          ))}
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-2">Latest Questions</h2>
        <p className="text-sm text-red-600">
          Something went wrong loading questions: {error?.message}
        </p>
      </section>
    );
  }

  if (!questions.length) {
    return (
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-2">Latest Questions</h2>
        <p className="text-sm text-muted-foreground">
          No questions are live yet. Once you publish questions from the
          admin area, they’ll appear here.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Latest Questions</h2>
        {/* In future you can add a link to /explore or /search here */}
      </div>

      <div className="space-y-4">
        {questions.map((q) => (
          <Card key={q.id} className="hover:border-primary/60 transition">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                <Link
                  to={`/questions/${q.id}`}
                  className="hover:underline"
                >
                  {q.question}
                </Link>
              </CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {q.location_label && (
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5">
                    {q.location_label}
                  </span>
                )}
                {q.published_at && (
                  <span>
                    {formatDistanceToNow(new Date(q.published_at), {
                      addSuffix: true,
                    })}
                  </span>
                )}
              </div>
            </CardHeader>
            {q.summary && (
              <CardContent className="pt-0 text-sm text-muted-foreground">
                <p className="line-clamp-3">{q.summary}</p>
              </CardContent>
            )}
            {q.tags && q.tags.length > 0 && (
              <CardContent className="pt-2 pb-3">
                <div className="flex flex-wrap gap-2">
                  {q.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
