// src/components/question/InlineQuestionStanceEditor.tsx

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { getStanceColorHex } from "@/lib/stanceColors";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

type Session = import("@supabase/supabase-js").Session;

type Props = {
  questionId: string;
  // optional: if you already know user's stance from parent, you can pass it
  initialScore?: number | null;
  className?: string;
};

type QuestionStanceRow = {
  score: number | null;
};

const STANCE_LABELS: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  0: "Neutral",
  1: "Agree",
  2: "Strongly agree",
};

const STANCE_VALUES = [-2, -1, 0, 1, 2] as const;

export function InlineQuestionStanceEditor({
  questionId,
  initialScore = null,
  className,
}: Props) {
  const sb = React.useMemo(getSupabase, []);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [session, setSession] = React.useState<Session | null>(null);

  // --- auth session (lightweight) ---
  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  const isAuthed = !!session?.user;

  // --- current stance (from DB, with optional initialScore hint) ---
  const stanceQuery = useQuery<QuestionStanceRow | null>({
    enabled: isAuthed && !!questionId,
    queryKey: ["my-stance-inline", questionId],
    queryFn: async () => {
      if (!sb) throw new Error("Supabase not ready");
      const { data, error } = await sb
        .from("question_stances")
        .select("score")
        .eq("question_id", questionId)
        .maybeSingle();

      if (error) throw error;

      return { score: data?.score ?? null };
    },
    // seed with initialScore if provided
    initialData:
      initialScore !== undefined
        ? { score: initialScore }
        : undefined,
  });

  const currentScore = stanceQuery.data?.score ?? null;

  // --- mutation: set / clear stance ---
  const mutation = useMutation({
    mutationKey: ["set-stance-inline", questionId],
    mutationFn: async (newScore: number | null) => {
      if (!sb) throw new Error("Supabase not ready");
      if (!session?.user) throw new Error("You need to be logged in");

      const { data, error } = await sb.rpc("set_question_stance", {
        p_question_id: questionId,
        p_score: newScore,
      });

      if (error) throw error;

      return (data as number | null) ?? newScore;
    },
    onSuccess: (newScore) => {
      // keep local cache in sync
      queryClient.setQueryData(["my-stance-inline", questionId], {
        score: newScore,
      });
      // also bump any full stats queries
      queryClient.invalidateQueries({
        queryKey: ["question-stats", questionId],
      });

      toast({
        title:
          newScore === null || newScore === undefined
            ? "Stance cleared"
            : "Stance updated",
        description:
          newScore === null || newScore === undefined
            ? "You’ve removed your stance on this question."
            : "Your stance has been recorded.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Couldn’t update your stance",
        description:
          error?.message ??
          "Something went wrong while saving. Please try again.",
      });
    },
  });

  const handleClick = (value: number) => {
    if (!isAuthed) {
      // you can also navigate to login here if you like
      toast({
        title: "Log in to answer",
        description:
          "Create an account or log in to record your stance on this question.",
      });
      return;
    }

    // Clicking the same value again will clear your stance (toggle)
    const next =
      currentScore === value ? null : (value as number | null);

    mutation.mutate(next);
  };

  const disabled = mutation.isPending;

  if (!isAuthed) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-1 text-[11px] text-slate-500",
          className
        )}
      >
        <span>Want to record your stance?</span>
        <span className="underline">Log in</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 text-[11px]",
        className
      )}
    >
      <span className="text-slate-500">Your stance:</span>
      {STANCE_VALUES.map((v) => {
        const isActive = currentScore === v;
        const color = getStanceColorHex(v);

        return (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => handleClick(v)}
            className={cn(
              "px-2 py-0.5 rounded-full border text-[10px] leading-none transition",
              isActive
                ? "text-white border-transparent"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
            style={isActive ? { backgroundColor: color } : undefined}
          >
            {v === -2 && "SD"}
            {v === -1 && "D"}
            {v === 0 && "N"}
            {v === 1 && "A"}
            {v === 2 && "SA"}
          </button>
        );
      })}

      {currentScore !== null && !disabled && (
        <button
          type="button"
          onClick={() => mutation.mutate(null)}
          className="ml-1 text-[10px] text-slate-500 underline"
        >
          Clear
        </button>
      )}

      {mutation.isPending && (
        <span className="text-[10px] text-slate-400 ml-1">
          Saving…
        </span>
      )}
    </div>
  );
}
