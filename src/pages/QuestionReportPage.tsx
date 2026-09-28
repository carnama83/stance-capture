// src/pages/QuestionReportPage.tsx
// Epic Report — R2: the deterministic Question Insight Report (/q/:id/report).
//
// Everything on this page comes from get_question_insight_report(), which
// computes every number in SQL. This page only formats: it never counts,
// averages or rounds anything itself, so the report can never disagree with
// the database (or, later, with what the AI was shown).
//
// The only AI-written text here is the stored description of what each
// position stands for (question_stance_definitions), and it is labelled as
// such. There is no AI summary of responses yet — that is R4.
//
// "Download PDF" is the browser's print dialog, like PublicBriefPage:
// Devanagari renders correctly and the SVG chart stays sharp, which jsPDF /
// html2canvas do not manage.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabaseClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useTopicLabels } from "@/hooks/useTopicLabels";
import { usePlaceLabels } from "@/hooks/usePlaceLabels";
import { formatDate, formatNumber, formatPercent, languageDisplayName } from "@/lib/intlFormat";
import { buildStanceLabels, getStanceColorHex } from "@/lib/stanceColors";
import type { QuestionInsightReport, StanceScore } from "@/types/questionReport";

const SCORES: StanceScore[] = [-2, -1, 0, 1, 2];

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

class ReportNotAvailable extends Error {}

async function fetchQuestionReport(questionId: string, languageCode: string): Promise<QuestionInsightReport> {
  const sb = getSupabase();
  if (!sb) throw new Error("no client");
  const { data, error } = await sb.rpc("get_question_insight_report", {
    p_question_id: questionId,
    p_language: languageCode,
  });
  if (error) {
    if (error.code === "42501" || /report_not_available/.test(error.message)) throw new ReportNotAvailable();
    throw error;
  }
  return data as QuestionInsightReport;
}

// Signed, locale-aware score on the −2..+2 scale, e.g. "+0.78".
function formatScore(value: number | null | undefined, lang: string): string {
  if (value == null) return "—";
  return formatNumber(value, lang, { signDisplay: "exceptZero", maximumFractionDigits: 2 });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 pt-6 mt-6 break-inside-avoid">
      <h2 className="text-sm font-semibold text-slate-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}

// ---------- Trend chart ----------

function TrendChart({ report, lang }: { report: QuestionInsightReport; lang: string }) {
  const { t } = useTranslation();
  const points = report.trend.points;
  // A narrow viewBox keeps the labels legible when the chart shrinks to a
  // phone's width; max-width stops it growing oversized on desktop.
  const W = 440;
  const H = 236;
  const left = 34;
  const right = 10;
  const top = 12;
  const plotH = 150;
  const volTop = top + plotH + 30;
  const volH = 30;
  const n = Math.max(points.length, 1);
  const colW = (W - left - right) / n;
  const x = (i: number) => left + (i + 0.5) * colW;
  const y = (v: number) => top + ((2 - v) / 4) * plotH;
  const maxVol = Math.max(1, ...points.map((p) => p.responses));

  // Place a change marker at the response after which it happened, inside the
  // group that response belongs to.
  const markerX = (responsesBefore: number) => {
    const next = responsesBefore + 1;
    const i = points.findIndex((p) => next >= p.fromResponse && next <= p.toResponse);
    if (i < 0) return W - right;
    const p = points[i];
    const frac = (next - p.fromResponse) / Math.max(1, p.toResponse - p.fromResponse + 1);
    return left + (i + frac) * colW;
  };

  const running = points
    .map((p, i) => (p.cumulativeMean == null ? null : `${x(i)},${y(p.cumulativeMean)}`))
    .filter(Boolean)
    .join(" ");

  const pointLabel = (p: (typeof points)[number]) => {
    if (report.trend.bucket === "sequence") return t("report.trend.seqRange", { from: p.fromResponse, to: p.toResponse });
    if (report.trend.bucket === "week") return t("report.trend.weekOf", { date: formatDate(p.key, lang, { dateStyle: "medium" }) });
    return formatDate(p.key, lang, { dateStyle: "medium" });
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-[560px] h-auto"
      role="img"
      aria-label={t("report.trend.chartLabel")}
    >
      {SCORES.map((s) => (
        <g key={s}>
          <line
            x1={left}
            x2={W - right}
            y1={y(s)}
            y2={y(s)}
            stroke={s === 0 ? "#94a3b8" : "#e2e8f0"}
            strokeWidth={1}
          />
          <text x={left - 6} y={y(s) + 4} fontSize={12} textAnchor="end" fill="#64748b">
            {formatScore(s, lang)}
          </text>
        </g>
      ))}

      {report.changes.map((c, i) => {
        const mx = markerX(c.responsesBefore);
        return (
          <g key={c.toRenditionId}>
            <line x1={mx} x2={mx} y1={top} y2={top + plotH} stroke="#6366f1" strokeDasharray="4 3" strokeWidth={1.25} />
            <circle cx={mx} cy={top + 9} r={9} fill="#6366f1" />
            <text x={mx} y={top + 13} fontSize={11} fontWeight={700} textAnchor="middle" fill="#fff">
              {i + 1}
            </text>
          </g>
        );
      })}

      {running && <polyline points={running} fill="none" stroke="#334155" strokeWidth={2} />}

      {points.map((p, i) => (
        <g key={p.key}>
          {p.bucketMean != null && (
            <circle
              cx={x(i)}
              cy={y(p.bucketMean)}
              r={6}
              fill={getStanceColorHex(Math.round(p.bucketMean))}
              stroke="#fff"
              strokeWidth={1.5}
            >
              <title>{`${pointLabel(p)}: ${formatScore(p.bucketMean, lang)}`}</title>
            </circle>
          )}
          <rect
            x={x(i) - Math.min(14, colW * 0.3)}
            y={volTop + volH - (p.responses / maxVol) * volH}
            width={Math.min(28, colW * 0.6)}
            height={(p.responses / maxVol) * volH}
            fill="#cbd5e1"
          >
            <title>{t("report.responses", { count: p.responses, formatted: formatNumber(p.responses, lang) })}</title>
          </rect>
          <text x={x(i)} y={top + plotH + 18} fontSize={points.length > 6 ? 10 : 12} textAnchor="middle" fill="#64748b">
            {pointLabel(p)}
          </text>
        </g>
      ))}

    </svg>
  );
}

// ---------- Page ----------

export default function QuestionReportPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const questionId = id ?? "";
  const session = useSupabaseSession();
  const userId = session?.user?.id ?? null;
  const { languageCode, isLoading: languageLoading } = useLanguage(userId);
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const { topicLabel } = useTopicLabels(languageCode);
  const { placeLabel } = usePlaceLabels(languageCode);

  // This page has no AppTopBar, and AppTopBar's useUiLanguage is the only
  // thing that sets i18next's language — so without this, a report opened
  // directly from a link renders Hindi question text inside English chrome.
  // Chrome follows the same resolved language as the content (device choice,
  // then ?lang=, then profile). AppTopBar re-syncs it on the next page.
  React.useEffect(() => {
    if (languageLoading) return;
    if (i18n.language !== languageCode) i18n.changeLanguage(languageCode);
    document.documentElement.lang = languageCode;
  }, [languageCode, languageLoading, i18n]);

  // Not listed anywhere yet, and UGQ reports will later be proposer-only.
  React.useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  const { data: report, isLoading, error } = useQuery({
    enabled: !!questionId && !languageLoading,
    queryKey: ["question-insight-report", questionId, languageCode, userId],
    queryFn: () => fetchQuestionReport(questionId, languageCode),
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof ReportNotAvailable) && count < 2,
  });

  // Position descriptions are generated on first read of a rendition. If this
  // report is that first read, ask once and refetch; the rest of the report
  // does not wait for it.
  const renditionId = report?.question.currentRenditionId ?? null;
  const needsDefinitions = !!report && !report.stanceDefinitions && !!renditionId;
  const { isFetching: definitionsLoading } = useQuery({
    enabled: needsDefinitions,
    queryKey: ["stance-definitions-generate", renditionId],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { error: fnError } = await sb.functions.invoke("generate-stance-definitions", {
        body: { rendition_id: renditionId },
      });
      if (!fnError) {
        await queryClient.invalidateQueries({ queryKey: ["question-insight-report", questionId] });
      }
      return null;
    },
  });

  const lang = report?.language ?? languageCode;
  const uiLang = languageCode;

  if (isLoading || languageLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <p className="text-sm text-slate-600">
          {error instanceof ReportNotAvailable ? t("report.notAvailable") : t("report.loadError")}
        </p>
        {questionId && (
          <Link to={`/q/${questionId}`} className="text-sm text-slate-800 underline underline-offset-2">
            {t("report.backToQuestion")}
          </Link>
        )}
      </div>
    );
  }

  const q = report.question;
  const rs = report.responseSummary;
  const labels = buildStanceLabels(
    q.lowLabel,
    q.highLabel,
    { neutral: t("stance.neutral"), leanOppose: t("stance.leanOppose"), leanSupport: t("stance.leanSupport") },
    lang,
  );
  const n = (v: number) => formatNumber(v, uiLang);
  const maxCount = Math.max(1, ...rs.distribution.map((d) => d.count));
  const pctTotal = rs.distribution.reduce((a, d) => a + d.percentage, 0);
  const definitions = new Map((report.stanceDefinitions ?? []).map((d) => [d.score, d]));
  const trendPoints = report.trend.points.filter((p) => p.bucketMean != null);
  const firstPoint = trendPoints[0];
  const lastPoint = trendPoints[trendPoints.length - 1];
  const trendDelta =
    firstPoint && lastPoint && firstPoint !== lastPoint ? (lastPoint.bucketMean ?? 0) - (firstPoint.bucketMean ?? 0) : null;
  const renditionsWithResponses = report.renditions.filter((r) => r.renditionId).length;
  const channelLabel = (source: string) =>
    source === "native" || source === "web_forward" ? t(`report.who.channel.${source}`) : t("report.who.channel.other");

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 print:bg-white print:p-0">
      <style>{`@media print { @page { margin: 16mm; } }`}</style>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4 print:hidden">
          <Link
            to={`/q/${report.questionId}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" /> {t("report.backToQuestion")}
          </Link>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-100"
          >
            <Download className="h-4 w-4" /> {t("report.downloadPdf")}
          </button>
        </div>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 md:p-10 shadow-sm print:border-0 print:shadow-none print:p-0">
          {/* Header */}
          <p className="text-[11px] font-medium tracking-wide uppercase text-slate-400">{t("report.title")}</p>
          <h1 className="mt-2 text-lg md:text-xl font-semibold text-slate-900 leading-snug">{q.text}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="font-medium text-slate-800">{t("report.responses", { count: rs.total, formatted: n(rs.total) })}</span>
            <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-amber-800">
              {t(`report.strength.${rs.strength}`)}
            </span>
            {rs.lastResponseAt && (
              <span>{t("report.lastResponse", { date: formatDate(rs.lastResponseAt, uiLang, { dateStyle: "medium" }) })}</span>
            )}
            <span>{q.createdByType === "community" ? t("report.askedByCommunity") : t("report.askedByEditorial")}</span>
            {q.topic && <span>{topicLabel(q.topicId, q.topic)}</span>}
            {q.location && <span>{placeLabel(q.location)}</span>}
          </div>
          {q.closedAt && (
            <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">
              {t("report.closedOn", { date: formatDate(q.closedAt, uiLang, { dateStyle: "long" }) })}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">{t(`report.strengthHint.${rs.strength}`)}</p>

          {/* Question & context */}
          <Section title={t("report.sections.question")}>
            {report.fallbackLanguage && report.language !== uiLang && (
              <p className="mb-3 text-xs text-slate-500">
                {t("report.fallbackLanguage", { language: languageDisplayName(uiLang, report.language) })}
              </p>
            )}
            {q.summary && <p className="text-sm text-slate-700 leading-relaxed mb-2">{q.summary}</p>}
            {q.context ? (
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{q.context}</p>
            ) : (
              !q.summary && <p className="text-sm text-slate-500">{t("report.noContext")}</p>
            )}
          </Section>

          {/* Snapshot */}
          <Section title={t("report.sections.snapshot")}>
            <p className="text-sm text-slate-800 leading-relaxed">
              {t("report.snapshot.lean", {
                high: n(rs.lean.high),
                low: n(rs.lean.low),
                neutral: n(rs.lean.neutral),
                total: n(rs.total),
                highLabel: labels[2],
                lowLabel: labels[-2],
              })}
            </p>
            {rs.mean != null && (
              <div className="mt-4 break-inside-avoid">
                <div className="relative h-2 rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-emerald-400">
                  <div
                    className="absolute -top-1.5 h-5 w-1.5 -ml-[3px] rounded bg-slate-900"
                    style={{ left: `${((rs.mean + 2) / 4) * 100}%` }}
                    aria-hidden
                  />
                </div>
                <div className="mt-1.5 flex justify-between gap-4 text-[11px] text-slate-500">
                  <span className="max-w-[40%]">{labels[-2]}</span>
                  <span className="max-w-[40%] text-right">{labels[2]}</span>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  {t("report.snapshot.average")}: <strong>{formatScore(rs.mean, uiLang)}</strong>
                  {"  ·  "}
                  {t("report.snapshot.median")}: <strong>{formatScore(rs.median, uiLang)}</strong>
                  {"  ·  "}
                  {t("report.snapshot.scale")}
                </p>
              </div>
            )}
          </Section>

          {/* Distribution */}
          <Section title={t("report.sections.distribution")}>
            <div className="space-y-2.5">
              {[...rs.distribution].reverse().map((d) => (
                <div key={d.score} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 break-inside-avoid">
                  <div className="text-xs text-slate-700 mb-1 truncate">
                    <span className="font-mono text-slate-400 mr-1.5">{formatScore(d.score, uiLang)}</span>
                    {labels[d.score]}
                  </div>
                  <div className="text-xs text-slate-600 text-right tabular-nums">
                    {n(d.count)} · {formatPercent(d.percentage, uiLang)}
                  </div>
                  <div className="col-span-2 h-2.5 rounded bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${(d.count / maxCount) * 100}%`,
                        backgroundColor: getStanceColorHex(d.score),
                        printColorAdjust: "exact",
                        WebkitPrintColorAdjust: "exact",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {t("report.distribution.signedInAnon", { signedIn: n(rs.signedIn), anonymous: n(rs.anonymous) })}
            </p>
            {pctTotal !== 100 && rs.total > 0 && <p className="mt-1 text-xs text-slate-400">{t("report.distribution.rounding")}</p>}
          </Section>

          {/* What each position stands for */}
          <Section title={t("report.sections.positions")}>
            <p className="text-xs text-slate-500 mb-3">{t("report.positions.intro")}</p>
            {report.stanceDefinitions ? (
              <dl className="space-y-3">
                {[...SCORES].reverse().map((s) => (
                  <div key={s} className="break-inside-avoid">
                    <dt className="text-xs font-medium text-slate-800">
                      <span
                        className="inline-block h-2 w-2 rounded-full mr-1.5 align-middle"
                        style={{ backgroundColor: getStanceColorHex(s), printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
                      />
                      {formatScore(s, uiLang)} · {labels[s]}
                    </dt>
                    <dd className="mt-0.5 text-sm text-slate-700 leading-relaxed">{definitions.get(s)?.interpretation}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-slate-500">
                {definitionsLoading ? t("report.positions.pending") : t("report.positions.unavailable")}
              </p>
            )}
          </Section>

          {/* Trend */}
          <Section title={t("report.sections.trend")}>
            {trendPoints.length >= 2 ? (
              <>
                <TrendChart report={report} lang={uiLang} />
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 bg-slate-700" /> {t("report.trend.legendRunning")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-slate-500" /> {t("report.trend.legendGroup")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-3 bg-slate-300" /> {t("report.trend.legendVolume")}
                  </span>
                  <span>
                    {formatScore(2, uiLang)} = {labels[2]} · {formatScore(-2, uiLang)} = {labels[-2]}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-800 leading-relaxed">
                  {t("report.trend.summary", {
                    from1: n(firstPoint.fromResponse),
                    to1: n(firstPoint.toResponse),
                    a: formatScore(firstPoint.bucketMean, uiLang),
                    from2: n(lastPoint.fromResponse),
                    to2: n(lastPoint.toResponse),
                    b: formatScore(lastPoint.bucketMean, uiLang),
                  })}{" "}
                  {trendDelta != null && trendDelta >= 0.5
                    ? t("report.trend.towards", { label: labels[2] })
                    : trendDelta != null && trendDelta <= -0.5
                      ? t("report.trend.towards", { label: labels[-2] })
                      : t("report.trend.steady")}
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">{t("report.trend.tooFew")}</p>
            )}
            {rs.strength === "early" && (
              <p className="mt-2 text-xs text-slate-500">{t("report.trend.earlyCaveat", { count: rs.total, formatted: n(rs.total) })}</p>
            )}
            {report.changes.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-slate-800 mb-1.5">{t("report.trend.changesTitle")}</h3>
                <ol className="space-y-1 text-xs text-slate-700">
                  {report.changes.map((c, i) => (
                    <li key={c.toRenditionId} className="flex gap-2">
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[9px] font-bold text-white print:[print-color-adjust:exact]">
                        {i + 1}
                      </span>
                      <span>
                        {t(`report.trend.change.${c.kind}`)} · {formatDate(c.at, uiLang, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                        {t("report.trend.changeAfter", { n: n(c.responsesBefore) })}
                      </span>
                    </li>
                  ))}
                </ol>
                {report.changes.some((c) => c.kind === "scale") && (
                  <p className="mt-1.5 text-xs text-slate-500">{t("report.trend.scaleCaveat")}</p>
                )}
              </div>
            )}
          </Section>

          {/* Who responded */}
          <Section title={t("report.sections.who")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-800 mb-1.5">{t("report.who.channelsTitle")}</h3>
                <ul className="space-y-1 text-sm text-slate-700">
                  {report.channels.map((c) => (
                    <li key={c.source} className="flex justify-between gap-3">
                      <span>{channelLabel(c.source)}</span>
                      <span className="tabular-nums">{n(c.count)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-3 text-slate-500">
                    <span>{t("report.who.signedIn")}</span>
                    <span className="tabular-nums">{n(rs.signedIn)}</span>
                  </li>
                  <li className="flex justify-between gap-3 text-slate-500">
                    <span>{t("report.who.anonymous")}</span>
                    <span className="tabular-nums">{n(rs.anonymous)}</span>
                  </li>
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-800 mb-1.5">{t("report.who.geographyTitle")}</h3>
                {report.geography ? (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {report.geography.map((g) => (
                      <li key={g.region} className="flex justify-between gap-3">
                        <span>{g.region === "Other" ? t("report.who.geographyOther") : g.region}</span>
                        <span className="tabular-nums">
                          {n(g.count)}
                          {g.mean != null && (
                            <span className="text-slate-400"> · {t("report.who.geoAverage", { value: formatScore(g.mean, uiLang) })}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">{t("report.who.geographyNone")}</p>
                )}
              </div>
            </div>
          </Section>

          {/* Methodology */}
          <Section title={t("report.sections.method")}>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 leading-relaxed">
              <li>{t("report.method.sample")}</li>
              <li>{t("report.method.counts", { total: n(rs.total), signedIn: n(rs.signedIn), anonymous: n(rs.anonymous) })}</li>
              <li>{t("report.method.scale", { low: labels[-2], high: labels[2] })}</li>
              {renditionsWithResponses > 1 && <li>{t("report.method.versions", { count: renditionsWithResponses })}</li>}
              {report.preResponseEdits > 0 && <li>{t("report.method.preEdits", { count: report.preResponseEdits })}</li>}
              <li>{report.changes.length > 0 ? t("report.method.changes") : t("report.method.noChanges")}</li>
              {report.republishesWithoutChange > 0 && (
                <li>{t("report.method.republish", { count: report.republishesWithoutChange })}</li>
              )}
              <li>{t("report.method.trendGroups")}</li>
              <li>{t("report.method.positionsAi")}</li>
              <li>{t("report.method.noAi")}</li>
            </ul>
          </Section>

          <div className="border-t border-slate-100 mt-6 pt-4 text-[11px] text-slate-400 flex flex-wrap justify-between gap-2">
            <span>{t("report.footer")}</span>
            <span>{t("report.generatedAt", { date: formatDate(report.generatedAt, uiLang, { dateStyle: "medium", timeStyle: "short" }) })}</span>
            <span className="hidden print:inline">{`${window.location.origin}/#/q/${report.questionId}/report`}</span>
          </div>
        </article>
      </div>
    </div>
  );
}
