// src/components/question/EditQuestionWordingPanel.tsx
//
// Sep 2026 — improve a live question's wording before anyone answers it.
// Used on the proposer's proposal page and on the admin live-question page.
// The person says what to add or change, the question-edit edge function
// suggests a revision (safety- and framing-checked), and the person approves
// it. The browser never sends wording of its own: "Update question" applies
// the stored suggestion by id. Once anyone has answered, the panel shows a
// locked note instead (the database enforces the same rule).

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Lock, PencilLine, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type Mode = "proposer" | "admin";

type Version = {
  question: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  context_summary: string | null;
};

type Suggestion = Version & {
  id: string;
  notes: string | null;
  warning: string | null;
};

type Status = { editable: boolean; answer_count: number; reason: string | null };

const KNOWN_ERRORS = new Set([
  "QUESTION_LOCKED", "QUESTION_CHANGED", "SUGGESTION_EXPIRED", "SUGGESTION_NOT_PENDING", "CHANGE_TOO_SHORT",
  "CHANGE_TOO_LONG", "TOO_MANY_SUGGESTIONS", "NEEDS_CHANGES", "UNSAFE", "CANNOT_REVISE", "NO_CHANGE",
  "LANGUAGE_NOT_SUPPORTED", "FORBIDDEN", "NO_BACKGROUND",
]);

async function callEdit(payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/question-edit`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body?.ok === true, body };
}

function VersionBlock({ title, v, highlight }: { title: string; v: Version; highlight?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`rounded-md border p-3 space-y-2 ${highlight ? "border-indigo-300 bg-indigo-50/60" : "border-slate-200 bg-slate-50"}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${highlight ? "text-indigo-700" : "text-slate-500"}`}>{title}</p>
      <p className="text-sm text-slate-900 leading-snug">{v.question}</p>
      {(v.slider_low_label || v.slider_high_label) && (
        <p className="text-xs text-slate-600">
          <span className="font-medium">{t("questionEdit.scaleEnds")}:</span>{" "}
          {v.slider_low_label ?? t("ugq.opposeDefault")} ↔ {v.slider_high_label ?? t("ugq.supportDefault")}
        </p>
      )}
      {v.context_summary && (
        <div>
          <p className="text-[11px] font-medium text-slate-500">{t("questionEdit.background")}</p>
          <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">{v.context_summary}</p>
        </div>
      )}
    </div>
  );
}

export function EditQuestionWordingPanel({
  questionId, mode, onApplied,
}: { questionId: string; mode: Mode; onApplied?: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [open, setOpen] = React.useState(false);
  const [change, setChange] = React.useState("");
  const [busy, setBusy] = React.useState<null | "suggest" | "apply">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState<Version | null>(null);
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null);
  const [applied, setApplied] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    const { body } = await callEdit({ action: "status", question_id: questionId });
    if (body?.ok) setStatus({ editable: !!body.editable, answer_count: Number(body.answer_count ?? 0), reason: body.reason ?? null });
  }, [questionId]);

  React.useEffect(() => { loadStatus(); }, [loadStatus]);

  function explain(body: { error?: string; message?: string }) {
    const code = body?.error ?? "";
    if (KNOWN_ERRORS.has(code)) {
      const base = t(`questionEdit.errors.${code}`);
      // NEEDS_CHANGES / UNSAFE / CANNOT_REVISE carry the checker's own reason,
      // which only exists in English; show it after the translated sentence.
      return ["NEEDS_CHANGES", "UNSAFE", "CANNOT_REVISE"].includes(code) && body.message
        ? `${base} ${body.message}` : base;
    }
    return t("questionEdit.errors.generic");
  }

  async function suggest(useBackground: boolean) {
    setBusy("suggest"); setError(null); setSuggestion(null);
    try {
      const { ok, body } = await callEdit({
        action: "suggest", question_id: questionId, change_request: change.trim(), use_background: useBackground,
      });
      if (!ok) {
        setError(explain(body));
        if (body?.error === "QUESTION_LOCKED") loadStatus();
        return;
      }
      setCurrent(body.current);
      setSuggestion(body.suggestion);
    } catch {
      setError(t("questionEdit.errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!suggestion) return;
    setBusy("apply"); setError(null);
    try {
      const { ok, body } = await callEdit({ action: "apply", suggestion_id: suggestion.id });
      if (!ok) {
        setError(explain(body));
        if (body?.error === "QUESTION_LOCKED") loadStatus();
        return;
      }
      setApplied(true); setOpen(false); setSuggestion(null); setChange("");
      onApplied?.();
      loadStatus();
    } catch {
      setError(t("questionEdit.errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    if (suggestion) callEdit({ action: "discard", suggestion_id: suggestion.id }).catch(() => {});
    setSuggestion(null); setError(null);
  }

  if (!status) return null;

  if (!status.editable) {
    // Only worth saying when the lock is the reason; nothing to show a
    // visitor with no edit rights.
    if (status.reason === "QUESTION_LOCKED") {
      return (
        <p className="text-xs text-slate-500 flex items-start gap-1.5">
          <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {t("questionEdit.locked")}
        </p>
      );
    }
    if (status.reason === "LANGUAGE_NOT_SUPPORTED") {
      return <p className="text-xs text-slate-500">{t("questionEdit.errors.LANGUAGE_NOT_SUPPORTED")}</p>;
    }
    return null;
  }

  return (
    <div className="space-y-3">
      {applied && (
        <p className="text-xs text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" /> {t("questionEdit.applied")}
        </p>
      )}

      {!open ? (
        <Button size="sm" variant="outline" onClick={() => { setOpen(true); setApplied(false); }}>
          <PencilLine className="h-3.5 w-3.5 mr-1.5" /> {t("questionEdit.editButton")}
        </Button>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-xs text-slate-600">{t("questionEdit.intro")}</p>

          {!suggestion && (
            <>
              <label className="block text-xs font-medium text-slate-700" htmlFor={`qe-change-${questionId}`}>
                {t("questionEdit.changeLabel")}
              </label>
              <Textarea
                id={`qe-change-${questionId}`}
                value={change}
                onChange={(e) => setChange(e.target.value)}
                placeholder={t("questionEdit.changePlaceholder")}
                rows={3}
                maxLength={500}
                className="text-sm resize-none"
                disabled={!!busy}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => suggest(false)} disabled={!!busy || change.trim().length < 5}>
                  {busy === "suggest"
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> {t("questionEdit.suggesting")}</>
                    : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> {t("questionEdit.suggest")}</>}
                </Button>
                {mode === "admin" && (
                  <Button size="sm" variant="outline" onClick={() => suggest(true)} disabled={!!busy}>
                    {t("questionEdit.useBackground")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }} disabled={!!busy}>
                  {t("questionEdit.cancel")}
                </Button>
              </div>
            </>
          )}

          {suggestion && current && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <VersionBlock title={t("questionEdit.current")} v={current} />
                <VersionBlock title={t("questionEdit.suggested")} v={suggestion} highlight />
              </div>
              {suggestion.notes && (
                <p className="text-xs text-slate-600">
                  <span className="font-medium">{t("questionEdit.whatChanged")}:</span> {suggestion.notes}
                </p>
              )}
              {suggestion.warning && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span><span className="font-medium">{t("questionEdit.adminWarning")}</span> {suggestion.warning}</span>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={apply} disabled={!!busy}>
                  {busy === "apply"
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> {t("questionEdit.applying")}</>
                    : t("questionEdit.apply")}
                </Button>
                <Button size="sm" variant="outline" onClick={reset} disabled={!!busy}>
                  {t("questionEdit.tryAgain")}
                </Button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default EditQuestionWordingPanel;
