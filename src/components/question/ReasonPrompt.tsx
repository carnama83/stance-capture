// src/components/question/ReasonPrompt.tsx
//
// Epic Report R3 — "Why did you choose this?", shown right under the slider
// once an answer is saved, for signed-in and anonymous respondents alike
// (WhatsApp link visitors land on the question page, so they get it too).
//
// One tap is enough: 3-4 reasons for the side the respondent chose, plus an
// optional one-line "why?". Never blocks the answer, which is already saved.
//
// Hidden once handled for the CURRENT side (saved or "Not now"): moving to the
// other side of the scale asks again, since the old reason no longer counts.
// Signed-in users also hide it when their account already has a reason for
// this side (answered on another device).

import * as React from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabaseClient";
import { fetchReasonOptions, sideOf, submitStanceReason, type ReasonSide } from "@/lib/stanceReasons";

const MAX_TEXT = 280;
const MAX_OPTIONS = 4;
const handledKey = (questionId: string) => `sc_reason_handled_${questionId}`;

function readHandled(questionId: string): string | null {
  try {
    return localStorage.getItem(handledKey(questionId));
  } catch {
    return null;
  }
}

// QuestionDetailPage renders StanceCard twice (mobile and desktop layouts),
// so two prompts exist at once; this event keeps them in step.
const HANDLED_EVENT = "sc-reason-handled";

function markHandled(questionId: string, side: ReasonSide) {
  try {
    localStorage.setItem(handledKey(questionId), side);
  } catch {
    /* storage blocked: the prompt may reappear on reload, which is harmless */
  }
  window.dispatchEvent(new CustomEvent(HANDLED_EVENT, { detail: { questionId, side } }));
}

export default function ReasonPrompt({
  questionId,
  score,
  isAuthed,
  userId,
  languageCode,
}: {
  questionId: string;
  score: number;
  isAuthed: boolean;
  userId: string | null;
  languageCode: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const side = sideOf(score);
  const [handledSide, setHandledSide] = React.useState<string | null>(() => readHandled(questionId));
  const [selected, setSelected] = React.useState<string[]>([]);
  const [text, setText] = React.useState("");
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");

  React.useEffect(() => {
    const onHandled = (e: Event) => {
      const d = (e as CustomEvent<{ questionId: string; side: string }>).detail;
      if (d?.questionId === questionId) setHandledSide(d.side);
    };
    window.addEventListener(HANDLED_EVENT, onHandled);
    return () => window.removeEventListener(HANDLED_EVENT, onHandled);
  }, [questionId]);

  const { data: accountReasonSide, isLoading: accountLoading } = useQuery({
    queryKey: ["my-stance-reason", questionId, userId],
    enabled: isAuthed && !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data } = await sb
        .from("question_stance_reasons")
        .select("score_at_time")
        .eq("question_id", questionId)
        .maybeSingle<{ score_at_time: number }>();
      return data ? sideOf(data.score_at_time) : null;
    },
  });

  const alreadyAnswered = handledSide === side || (isAuthed && accountReasonSide === side);
  const visible = state === "saved" || (!alreadyAnswered && !(isAuthed && accountLoading));

  const { data: options = [], isLoading: optionsLoading, isError: optionsError } = useQuery({
    queryKey: ["reason-options", questionId, languageCode],
    enabled: visible && state !== "saved",
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: () => fetchReasonOptions(questionId, languageCode),
  });
  const sideOptions = options.filter((o) => o.side === side).sort((a, b) => a.position - b.position);

  if (!visible) return null;

  if (state === "saved") {
    return (
      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-center gap-2">
        <Check className="h-4 w-4 shrink-0" /> {t("reasonPrompt.thanks")}
      </div>
    );
  }

  // No options could be loaded: offer only the free-text box rather than
  // nothing, but not an empty card while loading.
  if (optionsLoading) return null;

  const toggle = (key: string) =>
    setSelected((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= MAX_OPTIONS ? cur : [...cur, key],
    );
  const canSave = (selected.length > 0 || text.trim().length > 0) && state !== "saving";

  const save = async () => {
    setState("saving");
    try {
      await submitStanceReason({ questionId, optionKeys: selected, text, languageCode, isAuthed });
      markHandled(questionId, side);
      setHandledSide(side);
      setState("saved");
      queryClient.invalidateQueries({ queryKey: ["my-stance-reason", questionId] });
      queryClient.invalidateQueries({ queryKey: ["question-insight-report", questionId] });
    } catch {
      setState("error");
    }
  };

  const skip = () => {
    markHandled(questionId, side);
    setHandledSide(side);
  };

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3" role="group" aria-label={t("reasonPrompt.title")}>
      <p className="text-sm font-medium text-slate-800">{t("reasonPrompt.title")}</p>
      <p className="text-xs text-slate-500 mt-0.5">{t("reasonPrompt.subtitle")}</p>

      {!optionsError && sideOptions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {sideOptions.map((o) => {
            const on = selected.includes(o.key);
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => toggle(o.key)}
                aria-pressed={on}
                lang={o.language_code}
                className={
                  "rounded-full border px-3 py-1.5 text-xs text-left transition-colors " +
                  (on
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-500")
                }
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      <label className="mt-3 block">
        <span className="sr-only">{t("reasonPrompt.textLabel")}</span>
        <input
          type="text"
          value={text}
          maxLength={MAX_TEXT}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("reasonPrompt.placeholder")}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      </label>

      <p className="mt-1.5 text-[11px] text-slate-400">{t("reasonPrompt.privacy")}</p>
      {state === "error" && <p className="mt-1.5 text-xs text-red-600">{t("reasonPrompt.error")}</p>}

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button type="button" onClick={skip} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800">
          {t("reasonPrompt.notNow")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("reasonPrompt.save")}
        </button>
      </div>
    </div>
  );
}
