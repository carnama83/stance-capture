// src/pages/MyStancesPage.tsx
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";

type Session = import("@supabase/supabase-js").Session;

type StanceRow = {
  question_id: string;
  score: number;
  updated_at: string;
};

type QuestionMeta = {
  id: string;
  question: string;
  summary?: string | null;
  tags?: string[] | null;
  location_label?: string | null;
  published_at?: string | null;
  status?: string | null;
};

type MyStanceItem = {
  question_id: string;
  score: number;
  updated_at: string;
  question: string;
  summary?: string | null;
  tags?: string[] | null;
  location_label?: string | null;
  published_at?: string | null;
  status?: string | null;
};

// Reuse the same stance labels as elsewhere
const STANCE_LABEL: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  [0]: "Neutral",
  [1]: "Agree",
  [2]: "Strongly agree",
};

function stancePillClasses(score: number) {
  switch (score) {
    case -2:
    case -1:
      return "bg-red-50 text-red-800 border-red-200";
    case 0:
      return "bg-slate-50 text-slate-800 border-slate-200";
    case 1:
    case 2:
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    default:
      return "bg-slate-50 text-slate-800 border-slate-200";
  }
}

// ---------- Session hook (same pattern as Index.tsx) ----------
function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  return session;
}

// ---------- Data fetcher ----------
async function fetchMyStances(): Promise<MyStanceItem[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  // 1) Get all stances for the current user (RLS ensures it's only "me")
  const { data: stanceRows, error: stanceError } = await sb
    .from("question_stances")
    .select("question_id, score, updated_at")
    .order("updated_at", { ascending: false });

  if (stanceError) {
    console.error("Failed to load my stances", stanceError);
    throw stanceError;
  }

  const stances = (stanceRows ?? []) as StanceRow[];
  if (!stances.length) return [];

  const questionIds = Array.from(
    new Set(stances.map((s) => s.question_id))
  );

  // 2) Fetch question metadata
  const { data: qRows, error: qError } = await sb
    .from("v_live_questions")
    .select(
      "id, question, summary, tags, location_label, published_at, status"
    )
    .in("id", questionIds);

  if (qError) {
    console.error("Failed to load question metadata for stances", qError);
    throw qError;
  }

  const questions = (qRows ?? []) as QuestionMeta[];
  const byId = new Map<string, QuestionMeta>();
  questions.forEach((q) => byId.set(q.id, q));

  // 3) Join stances with their questions, filter any that no longer exist
  const joined: MyStanceItem[] = stances
    .map((s) => {
      const meta = byId.get(s.question_id);
      if (!meta) return null;
      return {
        question_id: s.question_id,
        score: s.score,
        updated_at: s.updated_at,
        question: meta.question,
        summary: meta.summary,
        tags: meta.tags,
        location_label: meta.location_label,
        published_at: meta.published_at,
        status: meta.status,
      };
    })
    .filter((x): x is MyStanceItem => x !== null);

  return joined;
}

async function clearStance(questionId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { error } = await sb.rpc("set_question_stance", {
    p_question_id: questionId,
    p_score: null,
  });

  if (error) {
    console.error("Failed to clear stance", error);
    throw error;
  }
}

// ---------- Page ----------
export default function MyStancesPage() {
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const isAuthed = !!session;
  const queryClient = useQueryClient();

  // If not logged in, gently push to login
  React.useEffect(() => {
    if (!isAuthed) {
      const returnTo = "#/me/stances";
      sessionStorage.setItem("return_to", returnTo);
      navigate("/login");
    }
  }, [isAuthed, navigate]);

  const {
    data: items,
    isLoading,
    isError,
    error,
  } = useQuery({
    enabled: isAuthed,
    queryKey: ["my-stances"],
    queryFn: fetchMyStances,
    staleTime: 60_000,
  });

  const clearMutation = useMutation({
    mutationKey: ["clear-stance"],
    mutationFn: (questionId: string) => clearStance(questionId),
    onSuccess: (_data, questionId) => {
      // Remove this entry from the cached list
      queryClient.setQueryData<MyStanceItem[] | undefined>(
        ["my-stances"],
        (old) =>
          (old ?? []).filter((item) => item.question_id !== questionId)
      );
      // Homepage "your stance" + stats will update via triggers + refetch eventually
    },
  });

  const actions = (
    <button
      className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
      onClick={() => navigate("/")}
    >
      Back to home
    </button>
  );

  return (
    <PageLayout rightSlot={actions}>
      <div className="max-w-3xl mx-auto py-4 space-y-4">
        <header className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              My stances
            </h1>
            <p className="text-xs text-slate-600">
              All questions where you&apos;ve recorded a stance.
            </p>
          </div>
        </header>

        {!isAuthed && (
          <div className="rounded-lg border p-4 text-sm text-slate-700">
            Redirecting to login…
          </div>
        )}

        {isAuthed && (
          <section className="rounded-lg border p-3">
            {isLoading && (
              <div className="text-xs text-slate-500">Loading…</div>
            )}

            {isError && (
              <div className="text-xs text-red-600">
                Could not load your stances: {(error as Error)?.message}
              </div>
            )}

            {!isLoading && !isError && (items?.length ?? 0) === 0 && (
              <div className="text-xs text-slate-500">
                You haven&apos;t taken a stance on any questions yet. Visit the
                homepage to get started.
              </div>
            )}

            {items && items.length > 0 && (
              <div className="space-y-3">
                {items.map((item) => {
                  const label = STANCE_LABEL[item.score] ?? item.score;
                  const pillClasses = stancePillClasses(item.score);

                  return (
                    <div
                      key={item.question_id}
                      className="rounded-lg border px-3 py-2 flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">
                            <Link
                              to={`/q/${item.question_id}`}
                              className="hover:underline"
                            >
                              {item.question}
                            </Link>
                          </div>
                          {item.summary && (
                            <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                              {item.summary}
                            </p>
                          )}
                          <div className="mt-1 text-[11px] text-slate-500">
                            Last updated{" "}
                            {new Date(item.updated_at).toLocaleString(
                              undefined,
                              {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          {item.location_label && (
                            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                              {item.location_label}
                            </span>
                          )}
                          {item.published_at && (
                            <span className="text-[10px] text-slate-500">
                              Published{" "}
                              {new Date(
                                item.published_at
                              ).toLocaleDateString(undefined, {
                                dateStyle: "medium",
                              })}
                            </span>
                          )}
                          <span
                            className={
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] mt-1 " +
                              pillClasses
                            }
                          >
                            Your stance: {label}
                          </span>
                        </div>
                      </div>

                      {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {item.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-full bg-slate-50 border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between mt-1">
                        <Link
                          to={`/q/${item.question_id}`}
                          className="text-xs text-slate-900 underline"
                        >
                          View question
                        </Link>
                        <button
                          type="button"
                          onClick={() =>
                            clearMutation.mutate(item.question_id)
                          }
                          disabled={clearMutation.isPending}
                          className="text-[11px] text-slate-500 underline"
                        >
                          {clearMutation.isPending
                            ? "Clearing…"
                            : "Clear stance"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </PageLayout>
  );
}
