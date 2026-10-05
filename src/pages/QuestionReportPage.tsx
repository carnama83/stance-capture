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
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft, Download, Loader2, Languages, MessageCircle, ShieldCheck, SlidersHorizontal, TrendingUp, Newspaper,
} from "lucide-react";
import { getSupabase } from "@/lib/supabaseClient";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StanceLogo, stanceLogoDataUri } from "@/components/brand/StanceLogo";
import { useLanguage } from "@/hooks/useLanguage";
import { useTopicLabels } from "@/hooks/useTopicLabels";
import { usePlaceLabels } from "@/hooks/usePlaceLabels";
import { formatDate, formatNumber, formatPercent, languageDisplayName } from "@/lib/intlFormat";
import { buildStanceLabels, getStanceColorHex } from "@/lib/stanceColors";
import type { QuestionInsightReport, ReportInsightsResponse, StanceScore } from "@/types/questionReport";

const SCORES: StanceScore[] = [-2, -1, 0, 1, 2];

// The logo's colours (StanceLogo / favicon.svg), used for the report's accents.
const BRAND = { indigo: "#6366F1", violet: "#8B5CF6", pink: "#EC4899", ink: "#312E81" } as const;
const BRAND_GRADIENT = `linear-gradient(90deg, ${BRAND.indigo}, ${BRAND.violet} 55%, ${BRAND.pink})`;
const SECTION_ACCENTS = [BRAND.indigo, BRAND.violet, BRAND.pink];
const SITE_URL = "https://www.stancecapture.com";
// Keep colours when the print dialog's "Background graphics" is off.
const EXACT = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as const;
const PDF_TIP_KEY = "sc.report.pdfTipDismissed";

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
class PrintNotAvailable extends Error {}

interface ReportPrint {
  id: string;
  questionId: string;
  language: string;
  createdAt: string;
  responseCount: number;
  lastResponseAt: string | null;
  report: QuestionInsightReport;
  insights: Record<string, unknown> | null;
  insightsLanguage: string | null;
  insightsGeneratedAt: string | null;
}

async function fetchReportPrint(printId: string): Promise<ReportPrint> {
  const sb = getSupabase();
  if (!sb) throw new Error("no client");
  const { data, error } = await sb.rpc("get_report_print", { p_print_id: printId });
  if (error) {
    if (error.code === "42501" || /print_not_available/.test(error.message)) throw new PrintNotAvailable();
    throw error;
  }
  return data as ReportPrint;
}

// The AI summary as it was stored with the print (snake_case, as generated).
function frozenInsights(p: ReportPrint): ReportInsightsResponse {
  const i = p.insights as Record<string, any> | null;
  if (!i) return { status: "unavailable" };
  return {
    status: "ok",
    language_code: p.insightsLanguage ?? undefined,
    generated_at: p.insightsGeneratedAt ?? undefined,
    response_count: p.responseCount,
    insights: {
      headline: i.headline,
      whatPeopleAreVotingFor: i.what_people_are_voting_for,
      whyTheyMayFeelThisWay: i.why_they_may_feel_this_way,
      otherPerspectives: i.other_perspectives,
      trendSummary: i.trend_summary,
      whatPeopleAppearToWant: i.what_people_appear_to_want,
      desiredOutcomes: i.desired_outcomes ?? [],
      caveats: i.caveats ?? [],
    },
  };
}

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

function SectionTitle({ title, accent }: { title: string; accent: string }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold mb-3 break-after-avoid" style={{ color: BRAND.ink }}>
      <span className="inline-block h-4 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent, ...EXACT }} />
      {title}
    </h2>
  );
}

function Section({ title, accent = 0, children }: { title: string; accent?: number; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 pt-6 mt-6">
      <SectionTitle title={title} accent={SECTION_ACCENTS[accent % SECTION_ACCENTS.length]} />
      {children}
    </section>
  );
}

// ---------- Key figures + sparkline ----------

type TrendPoint = QuestionInsightReport["trend"]["points"][number];

// Group averages as a small line, for the key-figure tile and every printed
// page's header. Points are the SQL group means; nothing is recomputed.
function sparklineSvg(points: TrendPoint[], w: number, h: number, gradientId: string): string {
  const pts = points.filter((p) => p.bucketMean != null);
  if (pts.length < 2) return "";
  const pad = 3;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + ((2 - v) / 4) * (h - pad * 2);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.bucketMean as number).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${BRAND.indigo}"/><stop offset=".55" stop-color="${BRAND.violet}"/><stop offset="1" stop-color="${BRAND.pink}"/></linearGradient></defs>
<line x1="${pad}" x2="${w - pad}" y1="${y(0)}" y2="${y(0)}" stroke="#e2e8f0" stroke-width="1"/>
<polyline points="${line}" fill="none" stroke="url(#${gradientId})" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="${x(pts.length - 1)}" cy="${y(last.bucketMean as number)}" r="3" fill="${getStanceColorHex(Math.round(last.bucketMean as number))}" stroke="#fff" stroke-width="1"/>`;
}

function sparklineDataUri(points: TrendPoint[], w: number, h: number): string | null {
  const body = sparklineSvg(points, w, h, "s");
  if (!body) return null;
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  )}`;
}

function Sparkline({ points, className }: { points: TrendPoint[]; className?: string }) {
  const id = `scSpark${React.useId().replace(/:/g, "")}`;
  const body = sparklineSvg(points, 120, 36, id);
  if (!body) return null;
  return (
    <svg className={className} viewBox="0 0 120 36" aria-hidden="true" dangerouslySetInnerHTML={{ __html: body }} />
  );
}

function KeyFigures({
  report,
  labels,
  lang,
  trendText,
}: {
  report: QuestionInsightReport;
  labels: Record<number, string>;
  lang: string;
  trendText: string;
}) {
  const { t } = useTranslation();
  const rs = report.responseSummary;
  const n = (v: number) => formatNumber(v, lang);
  const tile = (accent: string, tint: string, label: string, children: React.ReactNode) => (
    <div
      className="rounded-xl border px-3.5 py-3 break-inside-avoid"
      style={{ borderColor: `${accent}55`, backgroundColor: tint, ...EXACT }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent }}>
        {label}
      </p>
      {children}
    </div>
  );
  const meanColor = rs.mean == null ? "#64748b" : getStanceColorHex(Math.round(rs.mean));
  return (
    <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4 print:grid-cols-4">
      {tile(
        BRAND.indigo,
        "#EEF2FF",
        t("report.kpi.responses"),
        <>
          <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: BRAND.ink }}>
            {n(rs.total)}
          </p>
          <p className="text-[11px] text-slate-600">{t(`report.strength.${rs.strength}`)}</p>
        </>,
      )}
      {tile(
        "#16A34A",
        "#F0FDF4",
        t("report.kpi.leanTitle"),
        <>
          <p className="mt-1 text-2xl font-bold tabular-nums text-green-700">
            {n(rs.lean.high)}
            <span className="text-sm font-medium text-slate-500"> / {n(rs.total)}</span>
          </p>
          <p className="text-[11px] leading-snug text-slate-600 line-clamp-3">{t("report.kpi.lean", { label: labels[2] })}</p>
        </>,
      )}
      {tile(
        BRAND.violet,
        "#F5F3FF",
        t("report.kpi.average"),
        <>
          <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: meanColor }}>
            {formatScore(rs.mean, lang)}
          </p>
          {rs.mean != null && (
            <div className="relative mt-1 h-1.5 rounded-full" style={{ background: "linear-gradient(90deg, #ef4444, #eab308 50%, #22c55e)", ...EXACT }}>
              <div
                className="absolute -top-1 h-3.5 w-1 -ml-0.5 rounded"
                style={{ left: `${((rs.mean + 2) / 4) * 100}%`, backgroundColor: BRAND.ink, ...EXACT }}
              />
            </div>
          )}
          <p className="mt-1 text-[11px] text-slate-600">{t("report.kpi.averageHint")}</p>
        </>,
      )}
      {tile(
        BRAND.pink,
        "#FDF2F8",
        t("report.kpi.trend"),
        <>
          <Sparkline points={report.trend.points} className="mt-1 h-9 w-full" />
          <p className="text-[11px] leading-snug text-slate-600 line-clamp-3">{trendText}</p>
        </>,
      )}
    </div>
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

  const runningPts = points
    .map((p, i) => (p.cumulativeMean == null ? null : ([x(i), y(p.cumulativeMean)] as const)))
    .filter((v): v is readonly [number, number] => v != null);
  const running = runningPts.map(([px, py]) => `${px},${py}`).join(" ");
  // Area between the running average and the neutral line.
  const runningArea =
    runningPts.length >= 2
      ? `${runningPts[0][0]},${y(0)} ${running} ${runningPts[runningPts.length - 1][0]},${y(0)}`
      : "";
  const gid = `scTrend${React.useId().replace(/:/g, "")}`;

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
      <defs>
        <linearGradient id={`${gid}line`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={BRAND.indigo} />
          <stop offset="0.55" stopColor={BRAND.violet} />
          <stop offset="1" stopColor={BRAND.pink} />
        </linearGradient>
        <linearGradient id={`${gid}vol`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={BRAND.violet} />
          <stop offset="1" stopColor="#C4B5FD" />
        </linearGradient>
      </defs>
      {/* Toward +2 tinted green, toward −2 tinted red, as on the stance scale */}
      <rect x={left} y={y(2)} width={W - left - right} height={y(0) - y(2)} fill="#22c55e" opacity={0.07} />
      <rect x={left} y={y(0)} width={W - left - right} height={y(-2) - y(0)} fill="#ef4444" opacity={0.07} />
      {SCORES.map((s) => (
        <g key={s}>
          <line
            x1={left}
            x2={W - right}
            y1={y(s)}
            y2={y(s)}
            stroke={s === 0 ? "#94a3b8" : "#e9e5f5"}
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
            <line x1={mx} x2={mx} y1={top} y2={top + plotH} stroke={BRAND.pink} strokeDasharray="4 3" strokeWidth={1.25} />
            <circle cx={mx} cy={top + 9} r={9} fill={BRAND.pink} />
            <text x={mx} y={top + 13} fontSize={11} fontWeight={700} textAnchor="middle" fill="#fff">
              {i + 1}
            </text>
          </g>
        );
      })}

      {runningArea && <polygon points={runningArea} fill={BRAND.violet} opacity={0.14} />}
      {running && (
        <polyline points={running} fill="none" stroke={`url(#${gid}line)`} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      )}

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
            fill={`url(#${gid}vol)`}
            rx={3}
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

// ---------- AI summary (R4) ----------
//
// Kept in ONE clearly labelled block rather than interleaved with the computed
// sections, so a reader can always tell model-written prose from figures the
// database calculated. The edge function has already validated it (no
// invented numbers, no population language, no unsupported attribution).

async function fetchReportInsights(questionId: string, languageCode: string): Promise<ReportInsightsResponse> {
  const sb = getSupabase();
  if (!sb) return { status: "unavailable" };
  const { data, error } = await sb.functions.invoke("question-report-insights", {
    body: { question_id: questionId, language_code: languageCode },
  });
  if (error) return { status: "unavailable" };
  return data as ReportInsightsResponse;
}

function AiSummary({
  questionId,
  languageCode,
  userId,
  enoughResponses,
  onLoaded,
  frozen,
}: {
  questionId: string;
  languageCode: string;
  userId: string | null;
  enoughResponses: boolean;
  onLoaded: (r: ReportInsightsResponse | undefined) => void;
  // Snapshot mode (R6): the summary stored with the print, never refetched.
  frozen?: ReportInsightsResponse;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const live = useQuery({
    queryKey: ["report-insights", questionId, languageCode, userId],
    enabled: enoughResponses && !frozen,
    staleTime: 5 * 60_000,
    queryFn: () => fetchReportInsights(questionId, languageCode),
    // Another request is generating it right now: look again shortly.
    refetchInterval: (q) => (q.state.data?.status === "generating" ? 5000 : false),
  });
  const data = frozen ?? live.data;
  const isLoading = frozen ? false : live.isLoading;
  React.useEffect(() => onLoaded(data), [data, onLoaded]);

  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin-me", userId],
    enabled: !!userId && !frozen,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return false;
      const { data: v } = await sb.rpc("is_admin_me");
      return v === true;
    },
  });
  const [toggling, setToggling] = React.useState(false);
  const setHidden = async (hidden: boolean) => {
    if (!data?.snapshot_id) return;
    setToggling(true);
    const sb = getSupabase();
    await sb?.rpc("admin_set_report_snapshot_hidden", { p_snapshot_id: data.snapshot_id, p_hidden: hidden });
    await queryClient.invalidateQueries({ queryKey: ["report-insights", questionId] });
    setToggling(false);
  };

  const body = (() => {
    if (!enoughResponses) return <p className="text-sm text-slate-500">{t("report.ai.belowMinimum")}</p>;
    if (isLoading || data?.status === "generating") {
      return (
        <p className="text-sm text-slate-500 inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("report.ai.preparing")}
        </p>
      );
    }
    if (data?.status === "hidden") {
      return isAdmin ? (
        <p className="text-sm text-slate-500">
          {t("report.ai.hiddenAdmin")}{" "}
          <button disabled={toggling} onClick={() => setHidden(false)} className="underline underline-offset-2 print:hidden">
            {t("report.ai.unhide")}
          </button>
        </p>
      ) : null;
    }
    if (data?.status !== "ok" || !data.insights) {
      return <p className="text-sm text-slate-500">{frozen ? t("report.print.noAi") : t("report.ai.unavailable")}</p>;
    }
    const ins = data.insights;
    const para = (title: string, text: string) => (
      <div className="break-inside-avoid">
        <h3 className="text-xs font-semibold" style={{ color: BRAND.violet }}>{title}</h3>
        <p className="mt-0.5 text-sm text-slate-700 leading-relaxed">{text}</p>
      </div>
    );
    return (
      <div className="space-y-3.5" lang={data.language_code}>
        <p className="text-sm font-medium text-slate-900 leading-relaxed">{ins.headline}</p>
        {para(t("report.ai.votingTitle"), ins.whatPeopleAreVotingFor)}
        {para(t("report.ai.whyTitle"), ins.whyTheyMayFeelThisWay)}
        {para(t("report.ai.othersTitle"), ins.otherPerspectives)}
        {para(t("report.ai.trendTitle"), ins.trendSummary)}
        <div className="break-inside-avoid">
          <h3 className="text-xs font-semibold" style={{ color: BRAND.pink }}>{t("report.ai.wantTitle")}</h3>
          <p className="mt-0.5 text-sm text-slate-700 leading-relaxed">{ins.whatPeopleAppearToWant}</p>
          {ins.desiredOutcomes.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {ins.desiredOutcomes.map((o) => (
                <li key={o} className="rounded-full border border-pink-200 bg-white px-2.5 py-0.5 text-xs text-pink-800">
                  {o}
                </li>
              ))}
            </ul>
          )}
        </div>
        {ins.caveats.length > 0 && (
          <ul className="list-disc pl-5 space-y-0.5 text-xs text-slate-500">
            {ins.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>
    );
  })();

  if (body === null) return null;
  const ok = data?.status === "ok";
  return (
    <section
      className="mt-6 rounded-2xl border border-violet-200 px-4 py-4 md:px-5"
      style={{ background: "linear-gradient(135deg, #EEF2FF, #F5F3FF 55%, #FDF2F8)", ...EXACT }}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: BRAND.ink }}>
          <span className="inline-block h-4 w-1.5 rounded-full" style={{ background: BRAND_GRADIENT, ...EXACT }} />
          {t("report.sections.ai")}
        </h2>
        <span className="rounded-full bg-white border border-violet-200 px-2 py-0.5 text-[10px] font-medium text-violet-700">
          {t("report.ai.badge")}
        </span>
        {ok && isAdmin && (
          <button
            disabled={toggling}
            onClick={() => setHidden(true)}
            className="ml-auto text-xs text-slate-500 underline underline-offset-2 print:hidden"
          >
            {t("report.ai.hide")}
          </button>
        )}
      </div>
      {body}
      {ok && data?.language_code && data.language_code !== languageCode && (
        <p className="mt-3 text-xs text-slate-500">
          {t("report.ai.fallbackLanguage", { language: languageDisplayName(languageCode, data.language_code) })}
        </p>
      )}
      {ok && (
        <p className="mt-3 text-[11px] text-slate-400">
          {t("report.ai.footer", {
            date: formatDate(data!.generated_at!, languageCode, { dateStyle: "medium" }),
            count: data!.response_count ?? 0,
            formatted: formatNumber(data!.response_count ?? 0, languageCode),
          })}
          {data?.stale ? ` ${t("report.ai.stale")}` : ""}
        </p>
      )}
    </section>
  );
}

// ---------- Branding (print) ----------
//
// Every printed page carries the Stance Capture header and footer through the
// @page margin boxes, which Chrome repeats on each page (with real page
// numbers) without touching the report's own layout. Page 1 is the cover,
// which is all branding already, so it keeps only the footer.

function cssString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

// The header carries the logo, the group-average sparkline and the title over
// a three-colour brand rule; the footer carries the site address, which PDF
// viewers turn into a link (margin boxes cannot hold a real <a>). Colours are
// kept even with "Background graphics" off; a dialog set to black and white
// still greys everything, hence the tip before printing.
function printPageCss(t: (key: string) => string, sparkUri: string | null): string {
  const font = `font-family: system-ui, "Segoe UI", "Noto Sans Devanagari", "Nirmala UI", sans-serif;`;
  const rule = (color: string) => `border-bottom: 2px solid ${color};`;
  const foot = `${font} font-size: 8pt; vertical-align: top; padding-top: 3mm; border-top: 1px solid #DDD6FE;`;
  return `@media print {
  /* Only html is white: a white body would be painted over the watermark. */
  html { background: #fff !important; }
  body { background: transparent !important; }
  *, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  @page {
    margin: 20mm 16mm 18mm;
    @top-left {
      content: url("${stanceLogoDataUri(16)}") "  " ${cssString(t("report.brand.name"))};
      ${font} font-size: 11pt; font-weight: 700; color: ${BRAND.indigo}; vertical-align: bottom; padding-bottom: 3mm; ${rule(BRAND.indigo)}
    }
    @top-center {
      content: ${sparkUri ? `url("${sparkUri}")` : '""'};
      vertical-align: bottom; padding-bottom: 2.5mm; ${rule(BRAND.violet)}
    }
    @top-right {
      content: ${cssString(t("report.title"))};
      ${font} font-size: 8.5pt; font-weight: 600; color: ${BRAND.pink}; vertical-align: bottom; padding-bottom: 3.5mm; ${rule(BRAND.pink)}
    }
    @bottom-left {
      content: ${cssString(`${t("report.brand.name")} · ${t("report.brand.tagline")}`)};
      ${foot} color: #94a3b8;
    }
    @bottom-center {
      content: ${cssString(SITE_URL)};
      ${foot} color: ${BRAND.indigo}; font-weight: 600;
    }
    @bottom-right {
      content: counter(page) " / " counter(pages);
      ${foot} color: ${BRAND.violet};
    }
  }
  @page :first {
    @top-left { content: none; border: 0; }
    @top-center { content: none; border: 0; }
    @top-right { content: none; border: 0; }
  }
}`;
}

const COVER_FEATURES = [
  { key: "ask", Icon: Newspaper },
  { key: "scale", Icon: SlidersHorizontal },
  { key: "reasons", Icon: MessageCircle },
  { key: "change", Icon: TrendingUp },
  { key: "open", Icon: Languages },
  { key: "privacy", Icon: ShieldCheck },
] as const;

// Print-only first page: who we are and what we do, in plain words, then the
// question this report is about.
function ReportCover({
  questionText,
  responsesLabel,
  meta,
  preparedOn,
  keyFigures,
}: {
  questionText: string;
  responsesLabel: string;
  meta: string[];
  preparedOn: string;
  keyFigures: React.ReactNode;
}) {
  const { t } = useTranslation();
  const exact = EXACT;
  return (
    <section className="hidden print:block break-after-page">
      <div className="flex items-center gap-3">
        <StanceLogo className="h-12 w-12 shrink-0" />
        <div>
          <p className="text-2xl font-bold tracking-tight" style={{ color: BRAND.ink }}>{t("report.brand.name")}</p>
          <p className="text-sm text-slate-500">{t("report.brand.tagline")}</p>
        </div>
      </div>
      <div className="mt-4 h-1.5 w-full rounded-full" style={{ background: BRAND_GRADIENT, ...exact }} />

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: BRAND.pink }}>{t("report.title")}</p>
        <h1 className="mt-1.5 text-lg font-semibold leading-snug text-slate-900">{questionText}</h1>
        <p className="mt-3 text-sm text-slate-600">
          <span className="font-medium text-slate-800">{responsesLabel}</span>
          {meta.map((m) => (
            <span key={m}> · {m}</span>
          ))}
        </p>
        <p className="mt-1 text-xs text-slate-500">{preparedOn}</p>
        {keyFigures}
      </div>

      <div
        className="mt-4 rounded-xl border border-violet-200 px-5 py-3"
        style={{ background: "linear-gradient(120deg, #EEF2FF, #F5F3FF 55%, #FDF2F8)", ...exact }}
      >
        <h2 className="text-sm font-semibold text-indigo-900">{t("report.cover.aboutTitle")}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{t("report.cover.about")}</p>
      </div>

      <h2 className="mt-4 text-sm font-semibold" style={{ color: BRAND.ink }}>{t("report.cover.whatWeDo")}</h2>
      <ul className="mt-2.5 grid grid-cols-3 gap-x-5 gap-y-3">
        {COVER_FEATURES.map(({ key, Icon }, i) => (
          <li key={key} className="flex gap-3 break-inside-avoid">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
              style={{ backgroundColor: SECTION_ACCENTS[i % SECTION_ACCENTS.length], ...exact }}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{t(`report.cover.features.${key}Title`)}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{t(`report.cover.features.${key}`)}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 break-inside-avoid">
        <div className="border-t border-slate-200 pt-3">
          <p className="text-xs text-slate-600">
            {t("report.brand.visit")}{" "}
            <a href={SITE_URL} className="font-semibold underline underline-offset-2" style={{ color: BRAND.indigo }}>
              {t("report.brand.url")}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

// Print-only watermark: Chrome repeats a position: fixed element on every
// printed page. It sits behind the content (z-index -1), so the page wrapper
// and the article are transparent in print; tinted blocks such as the key
// figures and the AI panel cover it, as they would on paper.
function ReportWatermark() {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 hidden items-center justify-center print:flex"
      style={EXACT}
    >
      <div className="flex -rotate-[30deg] flex-col items-center gap-4 opacity-[0.07]">
        <StanceLogo className="h-40 w-40" />
        <span className="whitespace-nowrap text-6xl font-bold tracking-tight" style={{ color: BRAND.violet }}>
          {t("report.brand.name")}
        </span>
      </div>
    </div>
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
  const [aiInfo, setAiInfo] = React.useState<ReportInsightsResponse | undefined>(undefined);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // R6: ?print=<id> shows a frozen snapshot of the report (what a PDF shows).
  const printId = searchParams.get("print");
  const autoPrint = searchParams.get("autoprint") === "1";
  const [preparingPdf, setPreparingPdf] = React.useState(false);
  const [pdfError, setPdfError] = React.useState(false);
  // Shown before the print dialog: the dialog's colour setting is the one
  // thing the page cannot control, and black and white greys the whole PDF.
  const [pdfTipOpen, setPdfTipOpen] = React.useState(false);
  const [pdfTipDontShow, setPdfTipDontShow] = React.useState(false);
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

  const printQuery = useQuery({
    enabled: !!printId,
    queryKey: ["report-print", printId],
    queryFn: () => fetchReportPrint(printId as string),
    staleTime: Infinity,
    retry: (count, err) => !(err instanceof PrintNotAvailable) && count < 2,
  });
  const print = printQuery.data;

  const liveQuery = useQuery({
    enabled: !!questionId && !languageLoading && !printId,
    queryKey: ["question-insight-report", questionId, languageCode, userId],
    queryFn: () => fetchQuestionReport(questionId, languageCode),
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof ReportNotAvailable) && count < 2,
  });
  const report = printId ? print?.report : liveQuery.data;
  const isLoading = printId ? printQuery.isLoading : liveQuery.isLoading;
  const error = printId ? printQuery.error : liveQuery.error;

  // Opened from "Download PDF": print once the frozen copy has rendered, and
  // drop the flag so a reload or a shared link does not print again.
  // No cleanup that cancels the timer: removing the flag re-runs this effect,
  // and a clearTimeout there cancelled the print before it fired (seen on the
  // first Dev run). A ref makes it fire exactly once per snapshot.
  const autoPrinted = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!printId || !autoPrint || !print || autoPrinted.current === printId) return;
    autoPrinted.current = printId;
    const next = new URLSearchParams(searchParams);
    next.delete("autoprint");
    setSearchParams(next, { replace: true });
    window.setTimeout(() => window.print(), 400);
  }, [printId, autoPrint, print, searchParams, setSearchParams]);

  const requestPdf = () => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(PDF_TIP_KEY) === "1";
    } catch {
      // storage blocked: just show the tip
    }
    if (dismissed) void downloadPdf();
    else setPdfTipOpen(true);
  };
  const confirmPdfTip = () => {
    if (pdfTipDontShow) {
      try {
        window.localStorage.setItem(PDF_TIP_KEY, "1");
      } catch {
        // ignore
      }
    }
    setPdfTipOpen(false);
    // Let the dialog close before the print window opens over it.
    window.setTimeout(() => void downloadPdf(), 150);
  };

  const downloadPdf = async () => {
    if (printId) {
      window.print();
      return;
    }
    setPreparingPdf(true);
    setPdfError(false);
    try {
      const sb = getSupabase();
      if (!sb) throw new Error("no client");
      const { data, error: rpcError } = await sb.rpc("create_report_print", {
        p_question_id: questionId,
        p_language: languageCode,
        p_insights_snapshot_id: aiInfo?.status === "ok" ? aiInfo.snapshot_id ?? null : null,
      });
      if (rpcError || !data?.id) throw rpcError ?? new Error("no id");
      navigate(`/q/${questionId}/report?print=${data.id}&autoprint=1`);
    } catch {
      setPdfError(true);
    } finally {
      setPreparingPdf(false);
    }
  };

  // Position descriptions are generated on first read of a rendition. If this
  // report is that first read, ask once and refetch; the rest of the report
  // does not wait for it.
  const renditionId = report?.question.currentRenditionId ?? null;
  const needsDefinitions = !printId && !!report && !report.stanceDefinitions && !!renditionId;
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

  // "Save as PDF" names the file after the page title, so make the title
  // "Stance Capture - <question>": shortened at a word boundary, without
  // characters that are not allowed in file names.
  const questionTextForTitle = report?.question.text ?? null;
  React.useEffect(() => {
    if (!questionTextForTitle) return;
    const previous = document.title;
    let text = questionTextForTitle.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 90) text = `${text.slice(0, 90).replace(/\s+\S*$/, "")}…`;
    document.title = `${t("report.brand.name")} - ${text}`;
    return () => {
      document.title = previous;
    };
  }, [questionTextForTitle, t]);

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
          {error instanceof PrintNotAvailable
            ? t("report.print.notAvailable")
            : error instanceof ReportNotAvailable
              ? t("report.notAvailable")
              : t("report.loadError")}
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
  const trendText =
    trendPoints.length < 2
      ? t("report.kpi.trendTooFew")
      : trendDelta != null && trendDelta >= 0.5
        ? t("report.kpi.trendToward", { label: labels[2] })
        : trendDelta != null && trendDelta <= -0.5
          ? t("report.kpi.trendToward", { label: labels[-2] })
          : t("report.kpi.trendSteady");
  const keyFigures = <KeyFigures report={report} labels={labels} lang={uiLang} trendText={trendText} />;
  const channelLabel = (source: string) =>
    source === "native" || source === "web_forward" ? t(`report.who.channel.${source}`) : t("report.who.channel.other");

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 print:bg-transparent print:p-0">
      <ReportWatermark />
      <style>{printPageCss(t, sparklineDataUri(report.trend.points, 84, 20))}</style>
      <Dialog open={pdfTipOpen} onOpenChange={setPdfTipOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("report.pdfTip.title")}</DialogTitle>
            <DialogDescription>{t("report.pdfTip.body")}</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={pdfTipDontShow} onChange={(e) => setPdfTipDontShow(e.target.checked)} />
            {t("report.pdfTip.dontShow")}
          </label>
          <DialogFooter>
            <button
              onClick={confirmPdfTip}
              className="inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ background: BRAND_GRADIENT }}
            >
              <Download className="h-4 w-4" /> {t("report.pdfTip.continue")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4 print:hidden">
          <Link
            to={`/q/${report.questionId}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" /> {t("report.backToQuestion")}
          </Link>
          <button
            onClick={requestPdf}
            disabled={preparingPdf}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            style={{ background: BRAND_GRADIENT }}
          >
            {preparingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{" "}
            {preparingPdf ? t("report.print.preparing") : t("report.downloadPdf")}
          </button>
        </div>
        {pdfError && <p className="mb-3 text-xs text-red-600 print:hidden">{t("report.print.failed")}</p>}

        <ReportCover
          questionText={q.text}
          responsesLabel={t("report.responses", { count: rs.total, formatted: n(rs.total) })}
          meta={[q.topic ? topicLabel(q.topicId, q.topic) : null, q.location ? placeLabel(q.location) : null].filter(
            (m): m is string => !!m,
          )}
          preparedOn={t("report.cover.prepared", {
            date: formatDate(print?.createdAt ?? report.generatedAt, uiLang, { dateStyle: "long" }),
          })}
          keyFigures={keyFigures}
        />
        {print && (
          <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 print:mb-3 print:rounded-none print:border-x-0 print:border-t-0 print:bg-white print:px-0 print:text-xs">
            {t("report.print.banner", {
              date: formatDate(print.createdAt, uiLang, { dateStyle: "long", timeStyle: "short" }),
              count: print.responseCount,
              formatted: formatNumber(print.responseCount, uiLang),
            })}{" "}
            <Link to={`/q/${print.questionId}/report`} className="font-medium underline underline-offset-2 print:hidden">
              {t("report.print.liveLink")}
            </Link>
          </div>
        )}

        <article className="rounded-2xl border border-slate-200 bg-white p-5 md:p-10 shadow-sm print:border-0 print:bg-transparent print:shadow-none print:p-0">
          {/* Brand (on screen; in print the page header carries it) */}
          <div className="mb-6 flex items-center justify-between gap-3 border-b border-slate-100 pb-4 print:hidden">
            <div className="flex items-center gap-2">
              <StanceLogo className="h-7 w-7 shrink-0" />
              <span className="text-base font-bold" style={{ color: BRAND.ink }}>{t("report.brand.name")}</span>
            </div>
            <span className="text-xs text-slate-400">{t("report.brand.tagline")}</span>
          </div>
          <div className="-mt-6 mb-6 h-1 rounded-full print:hidden" style={{ background: BRAND_GRADIENT }} />

          {/* Header */}
          <p className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: BRAND.pink }}>{t("report.title")}</p>
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
          {/* In print the cover already shows these */}
          <div className="print:hidden">{keyFigures}</div>

          {/* Question & context */}
          <Section title={t("report.sections.question")} accent={1}>
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
          <Section title={t("report.sections.snapshot")} accent={2}>
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
            {rs.total > 0 && (
              <div className="mt-3 flex h-6 overflow-hidden rounded-lg text-[11px] font-semibold text-white break-inside-avoid" style={EXACT}>
                {[
                  { v: rs.lean.low, c: getStanceColorHex(-2) },
                  { v: rs.lean.neutral, c: getStanceColorHex(0) },
                  { v: rs.lean.high, c: getStanceColorHex(2) },
                ]
                  .filter((seg) => seg.v > 0)
                  .map((seg, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-center"
                      style={{ width: `${(seg.v / rs.total) * 100}%`, backgroundColor: seg.c, ...EXACT }}
                    >
                      {n(seg.v)}
                    </div>
                  ))}
              </div>
            )}
            {rs.mean != null && (
              <div className="mt-4 break-inside-avoid">
                <div
                  className="relative h-2 rounded-full"
                  style={{ background: "linear-gradient(90deg, #f87171, #fcd34d 50%, #34d399)", ...EXACT }}
                >
                  <div
                    className="absolute -top-1.5 h-5 w-1.5 -ml-[3px] rounded"
                    style={{ left: `${((rs.mean + 2) / 4) * 100}%`, backgroundColor: BRAND.ink, ...EXACT }}
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

          <AiSummary
            questionId={report.questionId}
            languageCode={uiLang}
            userId={userId}
            enoughResponses={rs.total >= 5}
            onLoaded={setAiInfo}
            frozen={print ? frozenInsights(print) : undefined}
          />

          {/* Distribution */}
          <Section title={t("report.sections.distribution")} accent={3}>
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

          {/* Why — respondents' own reasons (R3) */}
          <Section title={t("report.sections.reasons")} accent={4}>
            {!report.reasons || report.reasons.totalWithReasons === 0 ? (
              <p className="text-sm text-slate-500">{t("report.reasons.none")}</p>
            ) : (
              <>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {t("report.reasons.intro", { n: n(report.reasons.totalWithReasons), total: n(rs.total) })}
                </p>
                <div className="mt-4 space-y-5">
                  {report.reasons.sides
                    .filter((sd) => sd.respondents > 0)
                    .map((sd) => (
                      <div key={sd.side} className="break-inside-avoid">
                        <h3 className="text-xs font-semibold text-slate-800">
                          {sd.side === "neutral"
                            ? t("report.reasons.sideNeutral")
                            : t("report.reasons.sideToward", { label: sd.side === "high" ? labels[2] : labels[-2] })}
                          <span className="font-normal text-slate-500">
                            {" · "}
                            {t("report.reasons.respondents", { count: sd.respondents, formatted: n(sd.respondents) })}
                          </span>
                        </h3>
                        <ul className="mt-2 space-y-1.5">
                          {[...sd.options]
                            .sort((a, b) => b.count - a.count)
                            .map((o) => (
                              <li key={o.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-sm">
                                <span className={o.count ? "text-slate-700" : "text-slate-400"}>{o.label}</span>
                                <span className="text-xs text-slate-600 tabular-nums self-center">
                                  {t("report.reasons.countOf", { count: n(o.count), of: n(sd.respondents) })}
                                </span>
                                <span className="col-span-2 h-1.5 rounded bg-slate-100 overflow-hidden">
                                  <span
                                    className="block h-full rounded"
                                    style={{
                                      width: `${sd.respondents ? (o.count / sd.respondents) * 100 : 0}%`,
                                      backgroundColor: getStanceColorHex(sd.side === "high" ? 2 : sd.side === "low" ? -2 : 0),
                                      printColorAdjust: "exact",
                                      WebkitPrintColorAdjust: "exact",
                                    }}
                                  />
                                </span>
                              </li>
                            ))}
                        </ul>
                        {sd.quotes.length > 0 && (
                          <ul className="mt-3 space-y-1.5">
                            {sd.quotes.map((q, i) => (
                              <li key={i} className="border-l-2 border-violet-300 pl-3 text-sm italic text-slate-700">
                                “{q}”
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                </div>
                <p className="mt-4 text-xs text-slate-500">{t("report.reasons.note")}</p>
              </>
            )}
          </Section>

          {/* What each position stands for */}
          <Section title={t("report.sections.positions")} accent={5}>
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
          <Section title={t("report.sections.trend")} accent={6}>
            {trendPoints.length >= 2 ? (
              <>
                <TrendChart report={report} lang={uiLang} />
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-1 w-4 rounded" style={{ background: BRAND_GRADIENT, ...EXACT }} /> {t("report.trend.legendRunning")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: "linear-gradient(90deg, #ef4444, #eab308, #22c55e)", ...EXACT }} /> {t("report.trend.legendGroup")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: BRAND.violet, ...EXACT }} /> {t("report.trend.legendVolume")}
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
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: BRAND.pink, ...EXACT }}>
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
          <Section title={t("report.sections.who")} accent={7}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-800 mb-1.5">{t("report.who.channelsTitle")}</h3>
                <ul className="space-y-1 text-sm text-slate-700">
                  {report.channels.map((c) => (
                    <li key={c.source}>
                      <div className="flex justify-between gap-3">
                        <span>{channelLabel(c.source)}</span>
                        <span className="tabular-nums">{n(c.count)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded"
                          style={{ width: `${rs.total ? (c.count / rs.total) * 100 : 0}%`, background: BRAND_GRADIENT, ...EXACT }}
                        />
                      </div>
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
          <Section title={t("report.sections.method")} accent={8}>
            <div className="mb-3">
              <h3 className="text-xs font-semibold text-slate-800">{t("report.cover.howTitle")}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{t("report.cover.how")}</p>
            </div>
            <ul
              className="list-disc pl-8 pr-4 py-3 space-y-1.5 rounded-xl bg-violet-50/70 border border-violet-100 text-xs text-slate-600 leading-relaxed marker:text-violet-400"
              style={EXACT}
            >
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
              <li>{t("report.method.reasons")}</li>
              <li>{t("report.method.positionsAi")}</li>
              <li>
                {aiInfo?.status === "ok"
                  ? t("report.method.ai", { minimum: 5 })
                  : t("report.method.noAi")}
              </li>
            </ul>
          </Section>

          <div className="mt-6 h-1 rounded-full" style={{ background: BRAND_GRADIENT, ...EXACT }} />
          <div className="pt-4 text-[11px] text-slate-400 flex flex-wrap justify-between gap-2">
            <span>
              {t("report.footer")} ·{" "}
              <a href={SITE_URL} className="font-semibold underline underline-offset-2" style={{ color: BRAND.indigo }}>
                {t("report.brand.url")}
              </a>
            </span>
            <span>{t("report.generatedAt", { date: formatDate(report.generatedAt, uiLang, { dateStyle: "medium", timeStyle: "short" }) })}</span>
            {print && <span>{t("report.print.footer", { id: print.id.slice(0, 8) })}</span>}
            <span className="hidden print:inline">
              {print
                ? `${window.location.origin}/#/q/${report.questionId}/report?print=${print.id}`
                : `${window.location.origin}/#/q/${report.questionId}/report`}
            </span>
          </div>
        </article>
      </div>
    </div>
  );
}
