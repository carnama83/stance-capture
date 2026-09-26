// src/pages/PublicBriefPage.tsx
// Epic R — M-R06: printable authority brief (/brief/:briefId)
//
// The page an admin sends to an institution through its official channel
// (decided 26 Sep 2026: the platform never contacts an institution itself; the
// admin delivers and records the delivery). Link-only: the id is a random uuid,
// nothing lists briefs, and get_authority_brief() returns approved or delivered
// briefs only — never a draft. Not indexed. The brief text itself is the
// approved AI draft, in the language it was generated in; the page chrome is
// localized like the ledger page.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { localeFor } from "@/lib/intlFormat";
import i18n from "@/lib/i18n";
import { useLanguage } from "@/hooks/useLanguage";
import { Loader2, Printer } from "lucide-react";

interface BriefData {
  id: string;
  question_id: string;
  region_id: string | null;
  question_text: string;
  region_name: string | null;
  authority_name: string;
  brief_text: string;
  approved_at: string | null;
  ledger_published: boolean;
}

function useBrief(briefId: string) {
  return useQuery<BriefData | null>({
    queryKey: ["public-brief", briefId],
    enabled: !!briefId,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data, error } = await sb.rpc("get_authority_brief", { p_brief_id: briefId });
      if (error) return null;
      return ((data ?? []) as BriefData[])[0] ?? null;
    },
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(localeFor(i18n.language), { dateStyle: "long" });
}

export default function PublicBriefPage() {
  const { t } = useTranslation();
  const { briefId } = useParams<{ briefId: string }>();
  useLanguage(null);
  const { data: brief, isLoading } = useBrief(briefId ?? "");

  // Link-only: keep it out of search indexes.
  React.useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-slate-600">{t("publicBrief.notAvailable")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 print:bg-white print:py-0">
      <div className="max-w-2xl mx-auto">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-10 shadow-sm print:border-0 print:shadow-none print:p-0">
          <div className="flex items-start justify-between gap-4 mb-6">
            <p className="text-[11px] font-medium tracking-wide uppercase text-slate-400">
              {t("publicBrief.title")}
            </p>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 print:hidden"
            >
              <Printer className="h-3.5 w-3.5" /> {t("publicBrief.print")}
            </button>
          </div>

          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm mb-6">
            <dt className="text-slate-500">{t("publicBrief.to")}</dt>
            <dd className="text-slate-900 font-medium">{brief.authority_name}</dd>
            {brief.region_name && (
              <>
                <dt className="text-slate-500">{t("publicBrief.region")}</dt>
                <dd className="text-slate-800">{brief.region_name}</dd>
              </>
            )}
            <dt className="text-slate-500">{t("publicBrief.date")}</dt>
            <dd className="text-slate-800">{formatDate(brief.approved_at)}</dd>
            <dt className="text-slate-500">{t("publicBrief.question")}</dt>
            <dd className="text-slate-800">{brief.question_text}</dd>
          </dl>

          <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-line border-t border-slate-100 pt-6 mb-6">
            {brief.brief_text}
          </div>

          <div className="border-t border-slate-100 pt-4 text-xs text-slate-500 space-y-1">
            <p>{t("publicBrief.aboutThis")}</p>
            {brief.ledger_published && brief.region_id && (
              <p>
                {t("publicBrief.ledgerLink")}{" "}
                <Link
                  to={`/ledger/${brief.question_id}/${brief.region_id}`}
                  className="underline underline-offset-2 text-slate-700 print:no-underline"
                >
                  {`${window.location.origin}/#/ledger/${brief.question_id}/${brief.region_id}`}
                </Link>
              </p>
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-slate-400 mt-4 print:mt-8">
          {t("publicLedger.dataCollectedByStanceCapture")}
        </p>
      </div>
    </div>
  );
}
