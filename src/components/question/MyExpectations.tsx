// src/components/question/MyExpectations.tsx
// Epic R — R-02: "Your expectation" (R-FR-21, BR-R14).
//
// Lets a signed-in user review, change or withdraw their expectation set for
// a question at any time — not only in the one-shot post-stance prompt. Reads
// the user's own question_expectations rows (RLS: owner SELECT) so the server,
// not this device's localStorage, is the source of truth across devices.
//
// Every write goes through set_my_question_expectations(), which replaces the
// set in one transaction and appends a private revision row. An empty set is
// a withdrawal: the rows leave the aggregates immediately, the history stays.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";
import {
  EXPECTATION_LABEL_KEYS,
  ExpectationOptionGrid,
  getExpectationOptions,
  isExpectationPromptHandled,
  type ExpectationType,
} from "@/components/question/ExpectationPrompt";

const PROMPT_HANDLED_KEY_PREFIX = "sc_expectation_handled_";

/** Replace the caller's expectation set for a question ([] = withdraw). Throws on failure. */
export async function saveMyExpectations(questionId: string, types: string[]): Promise<string[]> {
  const jwt = getJwt();
  if (!jwt) throw new Error("not_signed_in");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_my_question_expectations`, {
    method: "POST",
    headers: supabaseHeaders(jwt),
    body: JSON.stringify({ p_question_id: questionId, p_types: types }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
  try {
    localStorage.setItem(`${PROMPT_HANDLED_KEY_PREFIX}${questionId}`, "1");
  } catch {
    /* the server set is authoritative; the flag only suppresses the prompt */
  }
  return (body ?? []) as string[];
}

// Keyed by user as well as question: React Query is not cleared on sign-out, so a
// question-only key would show the previous account's set after a switch (cf. F-06).
export function useMyExpectations(questionId: string, userId: string | null) {
  return useQuery<string[]>({
    queryKey: ["my-expectations", userId, questionId],
    enabled: !!userId && !!questionId,
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb
        .from("question_expectations")
        .select("expectation_type")
        .eq("question_id", questionId);
      if (error) throw error;
      return (data ?? []).map((r: { expectation_type: string }) => r.expectation_type).sort();
    },
  });
}

export function MyExpectations({
  questionId,
  isIncident,
  userId,
  hasStance,
  promptPending,
}: {
  questionId: string;
  isIncident?: boolean;
  userId: string | null;
  hasStance: boolean;
  /** The post-stance prompt was just triggered and this device hasn't handled it yet. */
  promptPending: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: current = [], isSuccess } = useMyExpectations(questionId, userId);
  const [editing, setEditing] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<ExpectationType>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setEditing(false);
    setError(null);
  }, [questionId]);

  if (!userId || !isSuccess) return null;
  // Let the post-stance prompt ask first; afterwards this control takes over.
  if (current.length === 0 && (promptPending && !isExpectationPromptHandled(questionId))) return null;
  // BR-R01: nothing to add before a stance (withdrawing stays possible).
  if (current.length === 0 && !hasStance) return null;

  const options = getExpectationOptions(isIncident, current);
  const unchanged =
    selected.size === current.length && current.every((c) => selected.has(c as ExpectationType));

  function startEdit() {
    setSelected(new Set(current as ExpectationType[]));
    setError(null);
    setEditing(true);
  }

  function toggle(type: ExpectationType) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function save(types: string[]) {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveMyExpectations(questionId, types);
      qc.setQueryData(["my-expectations", userId, questionId], [...saved].sort());
      qc.invalidateQueries({ queryKey: ["expectation-signal", questionId] });
      setEditing(false);
    } catch (err: any) {
      console.error("[MyExpectations] save failed", err);
      setError(
        /stance/i.test(err?.message ?? "")
          ? t("myExpectations.needsStance")
          : t("myExpectations.couldNotSave")
      );
    } finally {
      setSaving(false);
    }
  }

  const label = (type: string) =>
    EXPECTATION_LABEL_KEYS[type] ? t(EXPECTATION_LABEL_KEYS[type]) : type;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 mt-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-xs font-medium text-slate-700">{t("myExpectations.title")}</p>
        {!editing && (
          <div className="flex items-center gap-3">
            {current.length > 0 && (
              <button
                type="button"
                onClick={() => save([])}
                disabled={saving}
                className="text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2 disabled:opacity-40"
              >
                {t("myExpectations.withdraw")}
              </button>
            )}
            <button
              type="button"
              onClick={startEdit}
              disabled={saving}
              className="text-[11px] font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 disabled:opacity-40"
            >
              {current.length > 0 ? t("myExpectations.edit") : t("myExpectations.add")}
            </button>
          </div>
        )}
      </div>

      {!editing ? (
        current.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {current.map((type) => (
              <span key={type} className="text-[10px] rounded-full bg-slate-100 text-slate-700 px-2 py-0.5">
                {label(type)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">{t("myExpectations.none")}</p>
        )
      ) : (
        <>
          <p className="text-[11px] text-slate-400 mb-2">{t("expectationPrompt.optionalSeparateFromYourStance")}</p>
          <ExpectationOptionGrid options={options} selected={selected} onToggle={toggle} disabled={saving} />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2"
            >
              {t("myExpectations.cancel")}
            </button>
            <button
              type="button"
              onClick={() => save(Array.from(selected))}
              disabled={saving || unchanged}
              className="text-xs font-medium rounded-lg px-3 py-1.5 bg-slate-900 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
            >
              {saving ? t("stance.saving") : t("myExpectations.save")}
            </button>
          </div>
        </>
      )}

      {error && <p className="text-[11px] text-rose-600 mt-2">{error}</p>}
    </div>
  );
}
