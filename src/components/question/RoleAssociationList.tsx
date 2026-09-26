// src/components/question/RoleAssociationList.tsx
// Epic R — M-R10: aggregate "which office respondents associated with an
// action" lines (US-R19, US-R22, BR-R10, BR-R11).
//
// Shared by ExpectationSignalBlock (live, via get_expectation_role_signal) and
// PublicLedgerPage (frozen expectation_ledgers.role_summary). Both sources are
// aggregate-only and already gated server-side (signal crossed; offices chosen
// by at least expectation_role_min_taggers people). Wording is a neutral
// measurement — no call to contact or pressure anyone — and the office-holder
// is secondary text, present only when verified and current.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { EXPECTATION_LABEL_KEYS } from "@/components/question/ExpectationPrompt";

export interface RoleAssociation {
  expectation_type: string;
  government_role_id: string;
  role_name: string;
  authority_name: string;
  tagger_count: number;
  pct_of_expectation_respondents: number | null;
  current_office_holder_name: string | null;
}

export function RoleAssociationList({ entries, title }: { entries: RoleAssociation[]; title: string }) {
  const { t } = useTranslation();
  if (!entries || entries.length === 0) return null;
  const label = (type: string) => (EXPECTATION_LABEL_KEYS[type] ? t(EXPECTATION_LABEL_KEYS[type]) : type);

  return (
    <div className="mt-3 border-t border-slate-100 pt-2">
      <p className="text-[11px] font-medium text-slate-600 mb-1.5">{title}</p>
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={`${e.expectation_type}:${e.government_role_id}`} className="text-[11px] text-slate-600">
            {t("expectationRoles.associationLine", {
              pct: e.pct_of_expectation_respondents ?? 0,
              action: label(e.expectation_type),
              role: e.role_name,
            })}
            <span className="text-slate-400"> · {e.authority_name}</span>
            {e.current_office_holder_name && (
              <span className="text-slate-400">
                {" "}· {t("expectationRoles.currentlyHeldBy", { name: e.current_office_holder_name })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
