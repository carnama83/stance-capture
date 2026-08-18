// src/components/question/ExpectationPrompt.tsx
// Epic R — M-R01: Expectation Capture (R1)
// Epic R — M-R07: Incident Accountability branch (R8, US-R13)
//
// Shown after a user submits their stance for the first time on a question.
// Default copy: "What do you think should happen next?" — optional
// multi-select, strictly post-stance (BR-R01). For content_type='incident'
// questions, branches to a 7-option accountability-level prompt instead
// (US-R13) — different copy, different option set, same table.
//
// Both vocabularies write into question_expectations.expectation_type —
// see the M-R07 migration comment on that column for why (reuses M-R03's
// aggregation/ledger/opt-in pipeline instead of forking a second one).
// Selections are stored independently of stance score and must never feed
// back into it.
//
// Dismiss persistence uses localStorage (not sessionStorage, unlike
// PostStanceSharePrompt) — per US-R01/M-R01, once a user selects+confirms or
// explicitly skips, this must not be asked again for this question, even in
// a future session. Mirrors the ${prefix}_${questionId} key pattern used in
// PostStanceSharePrompt.tsx and TradeoffExplorer.tsx.

import * as React from "react";
import {
  Search,
  Banknote,
  FileText,
  Eye,
  Wrench,
  ShieldCheck,
  Scale,
  Ban,
  HelpCircle,
  Gavel,
  UserX,
  ArrowRightLeft,
} from "lucide-react";

export type ExpectationType =
  // original 9 — general/policy/election questions
  | "investigation"
  | "compensation"
  | "policy_reform"
  | "transparency"
  | "infrastructure_fix"
  | "accountability"
  | "legal_action"
  | "no_action"
  | "unsure"
  // incident-specific accountability levels (US-R13) — content_type='incident' only
  | "criminal_prosecution"
  | "departmental_suspension"
  | "independent_investigation"
  | "compensation_only"
  | "administrative_transfer"
  | "no_accountability_expected";

const EXPECTATION_TYPES: { type: ExpectationType; label: string; icon: React.ElementType }[] = [
  { type: "investigation", label: "Investigation", icon: Search },
  { type: "compensation", label: "Compensation", icon: Banknote },
  { type: "policy_reform", label: "Policy reform", icon: FileText },
  { type: "transparency", label: "Transparency", icon: Eye },
  { type: "infrastructure_fix", label: "Infrastructure fix", icon: Wrench },
  { type: "accountability", label: "Accountability", icon: ShieldCheck },
  { type: "legal_action", label: "Legal action", icon: Scale },
  { type: "no_action", label: "No action needed", icon: Ban },
  { type: "unsure", label: "Unsure", icon: HelpCircle },
];

// US-R13 — shown instead of EXPECTATION_TYPES when content_type='incident'.
const ACCOUNTABILITY_LEVELS: { type: ExpectationType; label: string; icon: React.ElementType }[] = [
  { type: "criminal_prosecution", label: "Criminal prosecution", icon: Gavel },
  { type: "departmental_suspension", label: "Departmental suspension", icon: UserX },
  { type: "independent_investigation", label: "Independent investigation", icon: Search },
  { type: "compensation_only", label: "Compensation only", icon: Banknote },
  { type: "administrative_transfer", label: "Administrative transfer", icon: ArrowRightLeft },
  { type: "no_accountability_expected", label: "No accountability expected", icon: Ban },
  { type: "unsure", label: "Unsure", icon: HelpCircle },
];

// Epic R — M-R03: shared slug→label lookup for both vocabularies, so the
// signal display block (ExpectationSignalBlock) shows the exact same
// wording used here rather than maintaining a second, driftable copy.
export const EXPECTATION_LABELS: Record<string, string> = Object.fromEntries(
  [...EXPECTATION_TYPES, ...ACCOUNTABILITY_LEVELS].map((o) => [o.type, o.label])
);

const DISMISS_KEY_PREFIX = "sc_expectation_handled_";

interface ExpectationPromptProps {
  questionId: string;
  isIncident?: boolean;
  onConfirm: (types: ExpectationType[]) => void;
  onSkip: () => void;
}

export function ExpectationPrompt({ questionId, isIncident, onConfirm, onSkip }: ExpectationPromptProps) {
  const [visible, setVisible] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<ExpectationType>>(new Set());
  const [submitting, setSubmitting] = React.useState(false);

  const options = isIncident ? ACCOUNTABILITY_LEVELS : EXPECTATION_TYPES;

  React.useEffect(() => {
    // Self-gate: even if the parent renders this component (e.g. right after
    // a fresh stance submit), don't show it again if this question was
    // already handled (confirmed or skipped) in a prior visit.
    let handled = false;
    try {
      handled = !!localStorage.getItem(`${DISMISS_KEY_PREFIX}${questionId}`);
    } catch {
      /* localStorage unavailable — fail open, show the prompt */
    }
    setVisible(!handled);
    setSelected(new Set());
  }, [questionId]);

  function markHandled() {
    try {
      localStorage.setItem(`${DISMISS_KEY_PREFIX}${questionId}`, "1");
    } catch {
      /* fail silently — worst case the prompt reappears next visit */
    }
  }

  function toggle(type: ExpectationType) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function handleSkip() {
    markHandled();
    setVisible(false);
    onSkip();
  }

  async function handleConfirm() {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    markHandled();
    setVisible(false);
    onConfirm(Array.from(selected));
  }

  if (!visible) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 mt-3">
      <p className="text-xs font-medium text-slate-700 mb-0.5">
        {isIncident
          ? "This is a civic incident. What level of accountability do you expect?"
          : "What do you think should happen next?"}
      </p>
      <p className="text-[11px] text-slate-400 mb-3">
        Optional — separate from your stance. Select as many as apply.
      </p>

      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {options.map(({ type, label, icon: Icon }) => {
          const isSelected = selected.has(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggle(type)}
              disabled={submitting}
              aria-pressed={isSelected}
              className={[
                "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors",
                isSelected
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              <span className="text-[10px] leading-tight font-medium">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className="text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={selected.size === 0 || submitting}
          className="text-xs font-medium rounded-lg px-3 py-1.5 bg-slate-900 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
        >
          {submitting ? "Saving…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
