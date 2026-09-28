// src/pages/ReportsPage.tsx
// Epic Report — R5: find a question and open its Community Insight Report.
//
// Lists exactly the questions whose report the viewer can open
// (list_reportable_questions reuses can_view_question_report and the question
// page's own response count), with search, topic and place filters and a sort.
// Reports are per question; this page only helps people find one.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { FileBarChart2, Loader2, Search } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { getSupabase } from "@/lib/supabaseClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useTopicLabels } from "@/hooks/useTopicLabels";
import { usePlaceLabels } from "@/hooks/usePlaceLabels";
import { formatDate, formatNumber } from "@/lib/intlFormat";

const PAGE_SIZE = 20;
type Sort = "recent" | "responses" | "newest" | "trending";

interface ReportRow {
  question_id: string;
  question_text: string;
  text_language: string;
  topic_id: string | null;
  topic_title: string | null;
  location_label: string | null;
  created_by_type: "admin" | "community";
  published_at: string | null;
  closed_at: string | null;
  responses: number;
  last_response_at: string | null;
  total_count: number;
}

interface ReportFilters {
  topics: { id: string; title: string; count: number }[];
  locations: { label: string; count: number }[];
}

function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);
  React.useEffect(() => {
    if (!sb) return;
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);
  return session;
}

async function fetchReportableQuestions(args: {
  search: string;
  topicId: string;
  location: string;
  sort: Sort;
  languageCode: string;
  page: number;
}): Promise<ReportRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.rpc("list_reportable_questions", {
    p_search: args.search || null,
    p_topic_id: args.topicId || null,
    p_location: args.location || null,
    p_sort: args.sort,
    p_language: args.languageCode,
    p_limit: PAGE_SIZE,
    p_offset: args.page * PAGE_SIZE,
  });
  if (error) throw error;
  return (data ?? []) as ReportRow[];
}

export default function ReportsPage() {
  const { t } = useTranslation();
  const session = useSupabaseSession();
  const userId = session?.user?.id ?? null;
  const { languageCode, isLoading: languageLoading } = useLanguage(userId);
  const { topicLabel } = useTopicLabels(languageCode);
  const { placeLabel } = usePlaceLabels(languageCode);

  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [topicId, setTopicId] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [sort, setSort] = React.useState<Sort>("recent");
  const [page, setPage] = React.useState(0);

  // Search as you type, without a request per keystroke.
  React.useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);
  React.useEffect(() => setPage(0), [search, topicId, location, sort, languageCode]);

  const { data: filters } = useQuery({
    queryKey: ["report-filters", userId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return { topics: [], locations: [] } as ReportFilters;
      const { data, error } = await sb.rpc("list_report_filters");
      if (error) throw error;
      return data as ReportFilters;
    },
  });

  const { data: rows = [], isLoading, isFetching, isError } = useQuery({
    queryKey: ["reportable-questions", search, topicId, location, sort, languageCode, page, userId],
    enabled: !languageLoading,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: () => fetchReportableQuestions({ search, topicId, location, sort, languageCode, page }),
  });
  const total = rows[0]?.total_count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const n = (v: number) => formatNumber(v, languageCode);

  const topicOptions = React.useMemo(
    () =>
      (filters?.topics ?? [])
        .map((tp) => ({ id: tp.id, label: topicLabel(tp.id, tp.title) }))
        .sort((a, b) => a.label.localeCompare(b.label, languageCode)),
    [filters, topicLabel, languageCode],
  );

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start gap-3">
          <FileBarChart2 className="h-6 w-6 text-slate-500 mt-0.5 shrink-0" />
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{t("reports.title")}</h1>
            <p className="mt-1 text-sm text-slate-600">{t("reports.intro")}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <label className="relative block">
            <span className="sr-only">{t("reports.searchLabel")}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("reports.searchPlaceholder")}
              className="w-full rounded-md border border-slate-300 bg-white py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </label>
          <select
            aria-label={t("reports.topicLabel")}
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
          >
            <option value="">{t("reports.allTopics")}</option>
            {topicOptions.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.label}
              </option>
            ))}
          </select>
          <select
            aria-label={t("reports.placeLabel")}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
          >
            <option value="">{t("reports.allPlaces")}</option>
            {(filters?.locations ?? []).map((l) => (
              <option key={l.label} value={l.label}>
                {placeLabel(l.label)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("reports.sortLabel")}
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
          >
            <option value="recent">{t("reports.sort.recent")}</option>
            <option value="responses">{t("reports.sort.responses")}</option>
            <option value="newest">{t("reports.sort.newest")}</option>
            <option value="trending">{t("reports.sort.trending")}</option>
          </select>
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 min-h-[1.25rem]">
          {!isLoading && !isError && <span>{t("reports.count", { count: total, formatted: n(total) })}</span>}
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>

        {isLoading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : isError ? (
          <p className="py-10 text-center text-sm text-slate-600">{t("reports.loadError")}</p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-600">
            {search || topicId || location ? t("reports.noMatches") : t("reports.none")}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {rows.map((r) => (
              <li key={r.question_id}>
                <Link
                  to={`/q/${r.question_id}/report`}
                  className="block px-4 py-3.5 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                >
                  <p className="text-sm font-medium text-slate-900 leading-snug line-clamp-3" lang={r.text_language}>
                    {r.question_text}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">
                      {t("report.responses", { count: r.responses, formatted: n(r.responses) })}
                    </span>
                    {r.last_response_at && (
                      <span>{t("report.lastResponse", { date: formatDate(r.last_response_at, languageCode, { dateStyle: "medium" }) })}</span>
                    )}
                    {r.topic_title && <span>{topicLabel(r.topic_id, r.topic_title)}</span>}
                    {r.location_label && <span>{placeLabel(r.location_label)}</span>}
                    <span>{r.created_by_type === "community" ? t("report.askedByCommunity") : t("report.askedByEditorial")}</span>
                    {r.closed_at && <span className="text-amber-700">{t("reports.closed")}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40"
            >
              {t("reports.previous")}
            </button>
            <span className="text-xs text-slate-500">
              {t("reports.pageOf", { page: n(page + 1), pages: n(pages) })}
            </span>
            <button
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40"
            >
              {t("reports.next")}
            </button>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
