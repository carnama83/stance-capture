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
// PostStanceSharePrompt.tsx and TradeoffExplorer.tsx. Dismissing the prompt
// does not lock the user out: MyExpectations ("Your expectation") lets them
// add, edit or withdraw later, from server state (Epic R R-02).

import * as React from "react";
import { useTranslation } from "react-i18next";
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

const EXPECTATION_TYPES: { type: ExpectationType; labelKey: string; icon: React.ElementType }[] = [
  { type: "investigation", labelKey: "expectationPrompt.investigation", icon: Search },
  { type: "compensation", labelKey: "expectationPrompt.compensation", icon: Banknote },
  { type: "policy_reform", labelKey: "expectationPrompt.policyReform", icon: FileText },
  { type: "transparency", labelKey: "expectationPrompt.transparency", icon: Eye },
  { type: "infrastructure_fix", labelKey: "expectationPrompt.infrastructureFix", icon: Wrench },
  { type: "accountability", labelKey: "expectationPrompt.accountability", icon: ShieldCheck },
  { type: "legal_action", labelKey: "expectationPrompt.legalAction", icon: Scale },
  { type: "no_action", labelKey: "expectationPrompt.noActionNeeded", icon: Ban },
  { type: "unsure", labelKey: "expectationPrompt.unsure", icon: HelpCircle },
];

// US-R13 — shown instead of EXPECTATION_TYPES when content_type='incident'.
const ACCOUNTABILITY_LEVELS: { type: ExpectationType; labelKey: string; icon: React.ElementType }[] = [
  { type: "criminal_prosecution", labelKey: "expectationPrompt.criminalProsecution", icon: Gavel },
  { type: "departmental_suspension", labelKey: "expectationPrompt.departmentalSuspension", icon: UserX },
  { type: "independent_investigation", labelKey: "expectationPrompt.independentInvestigation", icon: Search },
  { type: "compensation_only", labelKey: "expectationPrompt.compensationOnly", icon: Banknote },
  { type: "administrative_transfer", labelKey: "expectationPrompt.administrativeTransfer", icon: ArrowRightLeft },
  { type: "no_accountability_expected", labelKey: "expectationPrompt.noAccountabilityExpected", icon: Ban },
  { type: "unsure", labelKey: "expectationPrompt.unsure", icon: HelpCircle },
];

// Epic R — M-R03: shared slug→label lookup for both vocabularies, so the
// signal display block (ExpectationSignalBlock) shows the exact same
// wording used here rather than maintaining a second, driftable copy.
export const EXPECTATION_LABEL_KEYS: Record<string, string> = Object.fromEntries(
  [...EXPECTATION_TYPES, ...ACCOUNTABILITY_LEVELS].map((o) => [o.type, o.labelKey])
);

const DISMISS_KEY_PREFIX = "sc_expectation_handled_";

/** True once this device has confirmed or skipped the post-stance prompt for the question. */
export function isExpectationPromptHandled(questionId: string): boolean {
  try {
    return !!localStorage.getItem(`${DISMISS_KEY_PREFIX}${questionId}`);
  } catch {
    return false;
  }
}

/**
 * The option list for a question. `extra` keeps any already-saved type that
 * isn't in the current vocabulary (e.g. the question became an incident after
 * the user answered), so it can still be seen and deselected.
 */
export function getExpectationOptions(isIncident?: boolean, extra: string[] = []) {
  const base = isIncident ? ACCOUNTABILITY_LEVELS : EXPECTATION_TYPES;
  const all = [...EXPECTATION_TYPES, ...ACCOUNTABILITY_LEVELS];
  const missing = extra
    .filter((t) => !base.some((o) => o.type === t))
    .map((t) => all.find((o) => o.type === t))
    .filter((o): o is (typeof all)[number] => !!o);
  return [...base, ...missing];
}

// Epic R R-02: shared by the post-stance prompt and the "Your expectation" editor.
export function ExpectationOptionGrid({
  options,
  selected,
  onToggle,
  disabled,
}: {
  options: ReturnType<typeof getExpectationOptions>;
  selected: Set<ExpectationType>;
  onToggle: (type: ExpectationType) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-3 gap-1.5 mb-3">
      {options.map(({ type, labelKey, icon: Icon }) => {
        const isSelected = selected.has(type);
        return (
          <button
            key={type}
            type="button"
            onClick={() => onToggle(type)}
            disabled={disabled}
            aria-pressed={isSelected}
            className={[
              "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors",
              isSelected
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" />
            <span className="text-[10px] leading-tight font-medium">{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

interface ExpectationPromptProps {
  questionId: string;
  isIncident?: boolean;
  /** Epic R R-02: the server already holds a set for this user (e.g. from another device). */
  hasServerExpectations?: boolean;
  onConfirm: (types: ExpectationType[]) => void;
  onSkip: () => void;
}

export function ExpectationPrompt({ questionId, isIncident, hasServerExpectations, onConfirm, onSkip }: ExpectationPromptProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<ExpectationType>>(new Set());
  const [submitting, setSubmitting] = React.useState(false);

  const options = getExpectationOptions(isIncident);

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
    // Epic R R-05: not marked handled here — saveMyExpectations() sets the
    // flag only once the server has the selection, so a failed save doesn't
    // suppress the prompt for good.
    setVisible(false);
    onConfirm(Array.from(selected));
  }

  // Server state wins over this device's flag: a set saved elsewhere means the
  // question has been answered, so the "Your expectation" control takes over.
  if (!visible || hasServerExpectations) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 mt-3">
      <p className="text-xs font-medium text-slate-700 mb-0.5">
        {isIncident
          ? t("expectationPrompt.thisIsACivicIncident")
          : t("expectationPrompt.whatDoYouThinkShould")}
      </p>
      <p className="text-[11px] text-slate-400 mb-3">
        {t("expectationPrompt.optionalSeparateFromYourStance")}
      </p>

      <ExpectationOptionGrid options={options} selected={selected} onToggle={toggle} disabled={submitting} />

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className="text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2"
        >
          {t("quickTakes.skip")}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={selected.size === 0 || submitting}
          className="text-xs font-medium rounded-lg px-3 py-1.5 bg-slate-900 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
        >
          {submitting ? t("stance.saving") : t("expectationPrompt.confirm")}
        </button>
      </div>
    </div>
  );
}
