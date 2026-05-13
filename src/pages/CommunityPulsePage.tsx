// src/pages/CommunityPulsePage.tsx
// Epic F — Community Pulse & Aggregation
// F1: Aggregated stance dashboard with region selector (pre-populated from user region)
// F2: Macro trends trendline chart with confidence bands
// F3: Regional comparison + demographic breakdown

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import PageLayout from "@/components/PageLayout";
import {
  BarChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Area, ComposedChart, Legend,
} from "recharts";
import { Loader2, TrendingUp, Users, MapPin, BarChart3, AlertCircle, GitCompare } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RegionScope = "city" | "county" | "state" | "country" | "global";

interface PulseRow {
  question_id: string;
  question_text: string;
  topic_title: string;
  total_responses: number;
  pct_support: number | null;
  pct_neutral: number | null;
  pct_oppose: number | null;
  avg_score: number | null;
  updated_at: string;
  macro_total_responses: number;
  macro_avg_support: number | null;
  macro_avg_neutral: number | null;
  macro_avg_oppose: number | null;
  macro_avg_score: number | null;
  macro_last_updated: string | null;
}

interface TrendPoint {
  snapshot_date: string;
  total_responses: number;
  avg_score: number | null;
  pct_support: number | null;
  pct_neutral: number | null;
  pct_oppose: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
  is_low_sample: boolean;
}

interface RegionRow {
  region_scope: string;
  region_key: string;
  region_label: string;
  total_responses: number;
  pct_support: number | null;
  pct_neutral: number | null;
  pct_oppose: number | null;
  avg_score: number | null;
  updated_at: string;
}

interface DemoRow {
  dimension: string;
  dimension_value: string;
  total_responses: number;
  pct_support: number | null;
  pct_neutral: number | null;
  pct_oppose: number | null;
  avg_score: number | null;
  snapshot_date: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REGION_OPTIONS: Array<{ value: RegionScope; label: string }> = [
  { value: "global",  label: "Global" },
  { value: "country", label: "Country" },
  { value: "state",   label: "State" },
  { value: "county",  label: "County" },
  { value: "city",    label: "City" },
];

const TREND_DAYS_OPTIONS = [
  { value: 7,  label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

const GENDER_LABELS: Record<string, string> = {
  male:              "Male",
  female:            "Female",
  nonbinary:         "Non-binary",
  prefer_not_to_say: "Prefer not to say",
  self_described:    "Self-described",
};

const AGE_GROUP_LABELS: Record<string, string> = {
  "13-17": "13–17",
  "18-24": "18–24",
  "25-34": "25–34",
  "35-44": "35–44",
  "45-54": "45–54",
  "55-64": "55–64",
  "65+":   "65+",
};

// Canonical sort order for age bands so chart always renders youngest → oldest.
const AGE_GROUP_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

type DemoDimension = "gender" | "age_group";

const DIMENSION_OPTIONS: Array<{ value: DemoDimension; label: string }> = [
  { value: "gender",    label: "Gender" },
  { value: "age_group", label: "Age group" },
];

function fmt(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

function fmtScore(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function scoreColor(score: number | null): string {
  if (score == null) return "#94a3b8";
  if (score >= 0.5)  return "#10b981";
  if (score <= -0.5) return "#f43f5e";
  return "#94a3b8";
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, icon, children }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <span className="text-slate-500">{icon}</span>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// F1 — Aggregated Stance Dashboard
// ---------------------------------------------------------------------------

function AggregatedStanceSection({
  regionScope, regionKey,
}: { regionScope: RegionScope; regionKey: string }) {
  const { data, isLoading, isError } = useQuery<PulseRow[]>({
    queryKey: ["community-pulse", regionScope, regionKey],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_community_pulse", {
        p_region_scope: regionScope,
        p_region_key: regionKey,
        p_limit: 20,
      });
      if (error) throw error;
      return (data ?? []) as PulseRow[];
    },
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  if (isError || !data?.length) return <p className="text-sm text-slate-500 py-4">No data available for this region yet.</p>;

  const macro = data[0];

  // Build histogram data: count of questions per support bucket
  const buckets = [
    { label: "0–20%", count: data.filter(r => (r.pct_support ?? 0) < 20).length },
    { label: "20–40%", count: data.filter(r => (r.pct_support ?? 0) >= 20 && (r.pct_support ?? 0) < 40).length },
    { label: "40–60%", count: data.filter(r => (r.pct_support ?? 0) >= 40 && (r.pct_support ?? 0) < 60).length },
    { label: "60–80%", count: data.filter(r => (r.pct_support ?? 0) >= 60 && (r.pct_support ?? 0) < 80).length },
    { label: "80–100%", count: data.filter(r => (r.pct_support ?? 0) >= 80).length },
  ];

  return (
    <div className="space-y-5">
      {/* Macro totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total responses", value: fmtNum(macro.macro_total_responses) },
          { label: "Avg support", value: fmt(macro.macro_avg_support) },
          { label: "Avg oppose", value: fmt(macro.macro_avg_oppose) },
          { label: "Avg score", value: fmtScore(macro.macro_avg_score) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-slate-50 px-4 py-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
            <p className="text-lg font-semibold text-slate-900 mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {macro.macro_last_updated && (
        <p className="text-[10px] text-slate-400">
          Last updated: {new Date(macro.macro_last_updated).toLocaleString()}
        </p>
      )}

      {/* Support distribution histogram */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-2">Questions by support level</p>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={buckets} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v: number) => [`${v} questions`, "Count"]}
            />
            <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-question table */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-2">Questions ({data.length})</p>
        <div className="rounded-lg border border-slate-100 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-3 py-2 font-medium text-slate-600">Question</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-16">Support</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-16">Oppose</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-16">n</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={row.question_id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                  <td className="px-3 py-2 text-slate-800 max-w-xs">
                    <p className="truncate">{row.question_text}</p>
                    <p className="text-[10px] text-slate-400">{row.topic_title}</p>
                  </td>
                  <td className="px-3 py-2 text-right font-medium" style={{ color: "#10b981" }}>
                    {fmt(row.pct_support)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium" style={{ color: "#f43f5e" }}>
                    {fmt(row.pct_oppose)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {fmtNum(row.total_responses)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// F2 — Macro Trends
// ---------------------------------------------------------------------------

function MacroTrendsSection({
  regionScope, regionKey, days,
}: { regionScope: RegionScope; regionKey: string; days: number }) {
  const { data, isLoading, isError } = useQuery<TrendPoint[]>({
    queryKey: ["macro-trends", regionScope, regionKey, days],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_macro_trends", {
        p_region_scope: regionScope,
        p_region_key: regionKey,
        p_days: days,
        p_question_id: null,
      });
      if (error) throw error;
      return (data ?? []) as TrendPoint[];
    },
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  if (isError || !data?.length) return <p className="text-sm text-slate-500 py-4">No trend data available yet. Snapshots accumulate daily.</p>;

  const chartData = data.map((p) => ({
    date: fmtDate(p.snapshot_date),
    support: p.pct_support,
    oppose: p.pct_oppose,
    neutral: p.pct_neutral,
    avgScore: p.avg_score,
    confLow: p.confidence_low,
    confHigh: p.confidence_high,
    lowSample: p.is_low_sample === true || (p.is_low_sample as any) === "true",
    responses: p.total_responses,
  }));

  // % change vs baseline (first point)
  const first = data[0];
  const last  = data[data.length - 1];
  const supportDelta = first.pct_support != null && last.pct_support != null
    ? (last.pct_support - first.pct_support).toFixed(1)
    : null;

  return (
    <div className="space-y-4">
      {supportDelta !== null && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Support change over {days}d:</span>
          <span className={`font-semibold ${parseFloat(supportDelta) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {parseFloat(supportDelta) >= 0 ? "+" : ""}{supportDelta}%
          </span>
        </div>
      )}

      {/* Support / Oppose / Neutral over time */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-1">
          Support vs Opposition trend
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} unit="%" />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                // Use any series payload — all share the same data object
                const point = payload.find((e: any) =>
                  ["support", "oppose", "neutral"].includes(e.dataKey)
                )?.payload ?? payload[0]?.payload;
                const isLow = point?.lowSample === true || (point?.lowSample as any) === "true";
                return (
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 11 }}>
                    <p style={{ fontWeight: 500, marginBottom: 4, color: "#475569" }}>{label}</p>
                    {payload
                      .filter((e: any) => ["support", "oppose", "neutral"].includes(e.dataKey))
                      .map((e: any) => (
                        <p key={e.dataKey} style={{ color: e.stroke, margin: "2px 0" }}>
                          {e.name}: {Math.round(e.value)}%
                        </p>
                      ))}
                    {isLow && (
                      <p style={{ color: "#d97706", marginTop: 6, borderTop: "1px solid #fef3c7", paddingTop: 4 }}>
                        ⚠ Low sample — interpret with caution
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="support" stroke="#10b981" strokeWidth={2} dot={false} name="Support" />
            <Line type="monotone" dataKey="oppose"  stroke="#f43f5e" strokeWidth={2} dot={false} name="Oppose" />
            <Line type="monotone" dataKey="neutral" stroke="#94a3b8" strokeWidth={1.5} dot={false} name="Neutral" strokeDasharray="4 2" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Avg score with confidence band */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-1">
          Avg score over time
          <span className="ml-1 text-slate-400 font-normal">(shaded = confidence band)</span>
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} domain={[-2, 2]} />
            <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [v.toFixed(2), ""]} />
            <ReferenceLine y={0} stroke="#e2e8f0" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="confHigh"
              stroke="transparent"
              fill="#6366f1"
              fillOpacity={0.12}
              legendType="none"
            />
            <Area
              type="monotone"
              dataKey="confLow"
              stroke="transparent"
              fill="#ffffff"
              fillOpacity={1}
              legendType="none"
            />
            <Line
              type="monotone"
              dataKey="avgScore"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              name="Avg score"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {data.some((p) => p.is_low_sample === true || (p.is_low_sample as any) === "true") && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-600 bg-amber-50 rounded px-3 py-2">
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
          Some data points have fewer than 10 responses — treat those days with caution.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// F3 — Regional Comparison
// ---------------------------------------------------------------------------

function RegionalComparisonSection({ questionId }: { questionId: string | null }) {
  const { data, isLoading } = useQuery<RegionRow[]>({
    queryKey: ["regional-comparison", questionId],
    enabled: !!questionId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_regional_comparison", {
        p_question_id: questionId,
      });
      if (error) throw error;
      return (data ?? []) as RegionRow[];
    },
  });

  if (!questionId) return <p className="text-sm text-slate-500">Select a question above to see regional comparison.</p>;
  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>;
  if (!data?.length) return <p className="text-sm text-slate-500">No regional data available for this question.</p>;

  const chartData = data.map((r) => ({
    region: r.region_label,
    support: r.pct_support ?? 0,
    neutral: r.pct_neutral ?? 0,
    oppose:  r.pct_oppose  ?? 0,
    n:       r.total_responses,
  }));

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 60, left: 40, bottom: 0 }}>
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
          <YAxis type="category" dataKey="region" tick={{ fontSize: 10 }} width={60} />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(v: number, name: string) => [`${Math.round(v)}%`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="support" stackId="a" fill="#10b981" name="Support" />
          <Bar dataKey="neutral" stackId="a" fill="#94a3b8" name="Neutral" />
          <Bar dataKey="oppose"  stackId="a" fill="#f43f5e" name="Oppose" />
        </BarChart>
      </ResponsiveContainer>

      {/* Sample sizes */}
      <div className="flex flex-wrap gap-2">
        {data.map((r) => (
          <span key={r.region_key} className="text-[10px] text-slate-500 bg-slate-50 border rounded px-2 py-1">
            {r.region_label}: {fmtNum(r.total_responses)} responses
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// F3 — Demographic Breakdown
// ---------------------------------------------------------------------------

function DemographicSection({ questionId }: { questionId: string | null }) {
  const [dimension, setDimension] = React.useState<DemoDimension>("gender");

  const { data, isLoading } = useQuery<DemoRow[]>({
    queryKey: ["demographic-breakdown", questionId, dimension],
    enabled: !!questionId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_demographic_breakdown", {
        p_question_id: questionId,
        p_dimension: dimension,
      });
      if (error) throw error;
      return (data ?? []) as DemoRow[];
    },
  });

  // Dimension toggle — rendered regardless of loading/empty state so user
  // can switch while data is loading or absent.
  const toggle = (
    <div className="flex gap-1">
      {DIMENSION_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setDimension(opt.value)}
          className={[
            "px-2.5 py-1 rounded text-xs font-medium transition-colors",
            dimension === opt.value
              ? "bg-slate-900 text-white"
              : "border border-slate-200 text-slate-600 hover:bg-slate-50",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  if (!questionId) return (
    <div className="space-y-3">
      {toggle}
      <p className="text-sm text-slate-500">Select a question above to see demographic breakdown.</p>
    </div>
  );

  if (isLoading) return (
    <div className="space-y-3">
      {toggle}
      <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
    </div>
  );

  if (!data?.length) return (
    <div className="space-y-3">
      {toggle}
      <p className="text-sm text-slate-500">Demographic data not yet available (requires minimum 3 responses per group).</p>
    </div>
  );

  // For age_group: sort by canonical band order youngest → oldest.
  // For gender: use DB order (total_responses desc from RPC).
  const sortedData = dimension === "age_group"
    ? [...data].sort((a, b) => AGE_GROUP_ORDER.indexOf(a.dimension_value) - AGE_GROUP_ORDER.indexOf(b.dimension_value))
    : data;

  const labelMap = dimension === "age_group" ? AGE_GROUP_LABELS : GENDER_LABELS;
  const dimensionLabel = dimension === "age_group" ? "By age group" : "By gender";

  const chartData = sortedData.map((r) => ({
    group:   labelMap[r.dimension_value] ?? r.dimension_value,
    support: r.pct_support ?? 0,
    neutral: r.pct_neutral ?? 0,
    oppose:  r.pct_oppose  ?? 0,
    n:       r.total_responses,
  }));

  return (
    <div className="space-y-4">
      {toggle}
      <p className="text-[10px] text-slate-400">{dimensionLabel} — latest snapshot</p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis dataKey="group" tick={{ fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(v: number, name: string) => [`${Math.round(v)}%`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="support" stackId="a" fill="#10b981" name="Support" />
          <Bar dataKey="neutral" stackId="a" fill="#94a3b8" name="Neutral" />
          <Bar dataKey="oppose"  stackId="a" fill="#f43f5e" name="Oppose" />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-2">
        {sortedData.map((r) => (
          <span key={r.dimension_value} className="text-[10px] text-slate-500 bg-slate-50 border rounded px-2 py-1">
            {labelMap[r.dimension_value] ?? r.dimension_value}: n={r.total_responses}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// M-F03 — Compare Regions
// ---------------------------------------------------------------------------

interface CompareRegionsSectionProps {
  regionOptions: Array<{ value: RegionScope; label: string; key: string }>;
}

function CompareRegionsSection({ regionOptions }: CompareRegionsSectionProps) {
  const defaultA = regionOptions[0] ?? { value: "global" as RegionScope, label: "Global", key: "global" };
  const defaultB = regionOptions[1] ?? regionOptions[0] ?? { value: "global" as RegionScope, label: "Global", key: "global" };

  const [regionA, setRegionA] = React.useState(defaultA);
  const [regionB, setRegionB] = React.useState(defaultB);

  const SEL_CLS = "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400 w-full";

  const fetchPulse = async (scope: RegionScope, key: string) => {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase not available");
    const { data, error } = await sb.rpc("get_community_pulse", {
      p_region_scope: scope,
      p_region_key: key,
      p_limit: 20,
    });
    if (error) throw error;
    return (data ?? []) as PulseRow[];
  };

  const { data: dataA, isLoading: loadingA } = useQuery<PulseRow[]>({
    queryKey: ["compare-pulse-a", regionA.value, regionA.key],
    staleTime: 5 * 60_000,
    queryFn: () => fetchPulse(regionA.value, regionA.key),
  });

  const { data: dataB, isLoading: loadingB } = useQuery<PulseRow[]>({
    queryKey: ["compare-pulse-b", regionB.value, regionB.key],
    staleTime: 5 * 60_000,
    queryFn: () => fetchPulse(regionB.value, regionB.key),
  });

  const sameRegion = regionA.value === regionB.value && regionA.key === regionB.key;

  // Build a shared question list keyed on question_id, ordered by Region A response count.
  // Region B bars align to the same question order for easy visual comparison.
  const questionIds: string[] = React.useMemo(() => {
    if (!dataA?.length) return [];
    return dataA.map((r) => r.question_id);
  }, [dataA]);

  const buildChartData = (rows: PulseRow[] | undefined) => {
    if (!rows?.length || !questionIds.length) return [];
    const byId = new Map(rows.map((r) => [r.question_id, r]));
    return questionIds.map((id) => {
      const r = byId.get(id);
      return {
        label: (r?.question_text ?? "").slice(0, 30) + ((r?.question_text?.length ?? 0) > 30 ? "…" : ""),
        support: r?.pct_support ?? 0,
        neutral: r?.pct_neutral ?? 0,
        oppose:  r?.pct_oppose  ?? 0,
        n:       r?.total_responses ?? 0,
      };
    }).filter((d) => d.n > 0 || questionIds.length <= 5);
  };

  const chartA = buildChartData(dataA);
  const chartB = buildChartData(dataB);
  const chartHeight = Math.max(160, questionIds.length * 28 + 60);

  const MacroStats = ({ data }: { data: PulseRow[] | undefined }) => {
    if (!data?.length) return null;
    const m = data[0];
    return (
      <div className="flex gap-3 mb-3">
        {[
          { label: "Responses", value: fmtNum(m.macro_total_responses) },
          { label: "Avg support", value: fmt(m.macro_avg_support) },
          { label: "Avg oppose",  value: fmt(m.macro_avg_oppose) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-slate-50 px-3 py-2 flex-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">{value}</p>
          </div>
        ))}
      </div>
    );
  };

  const RegionChart = ({
    chartData,
    isLoading,
    label,
  }: {
    chartData: ReturnType<typeof buildChartData>;
    isLoading: boolean;
    label: string;
  }) => {
    if (isLoading) return (
      <div className="flex justify-center items-center" style={{ height: chartHeight }}>
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      </div>
    );
    if (!chartData.length) return (
      <p className="text-xs text-slate-500 py-4">No data available for {label}.</p>
    );
    return (
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 9 }}
            width={90}
            interval={0}
          />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(v: number, name: string) => [`${Math.round(v)}%`, name]}
          />
          <Bar dataKey="support" stackId="a" fill="#10b981" name="Support" />
          <Bar dataKey="neutral" stackId="a" fill="#94a3b8" name="Neutral" />
          <Bar dataKey="oppose"  stackId="a" fill="#f43f5e" name="Oppose" />
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="space-y-4">

      {/* Region selectors */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Region A</p>
          <select
            value={regionA.value}
            onChange={(e) => {
              const opt = regionOptions.find((o) => o.value === e.target.value);
              if (opt) setRegionA(opt);
            }}
            className={SEL_CLS}
          >
            {regionOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Region B</p>
          <select
            value={regionB.value}
            onChange={(e) => {
              const opt = regionOptions.find((o) => o.value === e.target.value);
              if (opt) setRegionB(opt);
            }}
            className={SEL_CLS}
          >
            {regionOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Same region warning */}
      {sameRegion && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-600 bg-amber-50 rounded px-3 py-2">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Select two different regions to compare.
        </div>
      )}

      {/* Side-by-side charts */}
      {!sameRegion && (
        <div className="grid grid-cols-2 gap-4">
          {/* Region A */}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">{regionA.label}</p>
            <MacroStats data={dataA} />
            <RegionChart chartData={chartA} isLoading={loadingA} label={regionA.label} />
          </div>

          {/* Region B */}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">{regionB.label}</p>
            <MacroStats data={dataB} />
            <RegionChart chartData={chartB} isLoading={loadingB} label={regionB.label} />
          </div>
        </div>
      )}

      {/* Legend — shared, shown once below both charts */}
      {!sameRegion && !loadingA && !loadingB && chartA.length > 0 && (
        <div className="flex gap-4 text-[10px] text-slate-500">
          {[
            { color: "#10b981", label: "Support" },
            { color: "#94a3b8", label: "Neutral" },
            { color: "#f43f5e", label: "Oppose" },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Insufficient options fallback */}
      {regionOptions.length < 2 && (
        <p className="text-xs text-slate-500">
          Set your location in your profile to unlock regional comparisons.
        </p>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CommunityPulsePage() {
  const [regionScope, setRegionScope] = React.useState<RegionScope>("global");
  const [regionKey, setRegionKey] = React.useState("global");
  const [trendDays, setTrendDays] = React.useState(30);
  const [selectedQuestionId, setSelectedQuestionId] = React.useState<string | null>(null);
  const [compareMode, setCompareMode] = React.useState(false);

  // Track current user ID to scope cached data per-user
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    // Set initial user on mount
    sb.auth.getUser().then(({ data: { user } }) => {
      const id = (!user || user.is_anonymous || !user.email) ? null : user.id;
      setCurrentUserId(id);
    });
    // Reset on every auth change
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      const id = (!user || user.is_anonymous || !user.email) ? null : user.id;
      setCurrentUserId(id);
      // Invalidate user-specific cached data so new user gets fresh region options
      queryClient.invalidateQueries({ queryKey: ["user-region-pulse"] });
      queryClient.invalidateQueries({ queryKey: ["community-pulse"] });
      queryClient.invalidateQueries({ queryKey: ["regional-comparison"] });
      queryClient.invalidateQueries({ queryKey: ["demographic-breakdown"] });
      queryClient.invalidateQueries({ queryKey: ["macro-trends"] });
      queryClient.invalidateQueries({ queryKey: ["compare-pulse-a"] });
      queryClient.invalidateQueries({ queryKey: ["compare-pulse-b"] });
      // Reset page-level selections so stale question/region from previous user is cleared
      setRegionScope("global");
      setRegionKey("global");
      setSelectedQuestionId(null);
      setCompareMode(false);
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  // F improvement: load user's actual region labels to power the region selector
  const { data: userRegion } = useQuery<{
    city_label: string | null;
    county_label: string | null;
    state_label: string | null;
    country_label: string | null;
  } | null>({
    queryKey: ["user-region-pulse", currentUserId],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data: { user } } = await sb.auth.getUser();
      // Exclude anonymous sessions — anon users have no region data
      if (!user || user.is_anonymous || !user.email) return null;
      const { data, error } = await sb
        .from("user_region_dimensions")
        .select("city_label, county_label, state_label, country_label")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });

  // Build region options dynamically from user's actual labels
  const regionOptions: Array<{ value: RegionScope; label: string; key: string }> = [
    { value: "global",  label: "Global",                              key: "global" },
    ...(userRegion?.country_label ? [{ value: "country" as RegionScope, label: userRegion.country_label, key: userRegion.country_label }] : []),
    ...(userRegion?.state_label   ? [{ value: "state"   as RegionScope, label: userRegion.state_label,   key: userRegion.state_label   }] : []),
    ...(userRegion?.county_label  ? [{ value: "county"  as RegionScope, label: userRegion.county_label,  key: userRegion.county_label  }] : []),
    ...(userRegion?.city_label    ? [{ value: "city"    as RegionScope, label: userRegion.city_label,    key: userRegion.city_label    }] : []),
  ];

  // Fetch pulse data to populate question selector for F3
  const { data: pulseData } = useQuery<PulseRow[]>({
    queryKey: ["community-pulse", currentUserId, regionScope, regionKey],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_community_pulse", {
        p_region_scope: regionScope,
        p_region_key: regionKey,
        p_limit: 20,
      });
      if (error) throw error;
      return (data ?? []) as PulseRow[];
    },
  });

  // Auto-select first question when data loads — scoped to currentUserId
  // so switching users resets the selection even if pulseData hasn't changed yet
  React.useEffect(() => {
    setSelectedQuestionId(null);
  }, [currentUserId]);

  React.useEffect(() => {
    if (pulseData?.length && !selectedQuestionId) {
      setSelectedQuestionId(pulseData[0].question_id);
    }
  }, [pulseData, currentUserId]);

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto py-6 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Community Pulse</h1>
            <p className="text-sm text-slate-500 mt-1">
              Explore how the community stands across questions, regions, and time.
            </p>
          </div>

          {/* Region selector */}
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs text-slate-600 font-medium">Region</label>
            <select
              value={regionScope}
              onChange={(e) => {
                const scope = e.target.value as RegionScope;
                const opt = regionOptions.find((o) => o.value === scope);
                setRegionScope(scope);
                setRegionKey(opt?.key ?? "global");
              }}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {regionOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* F1 — Aggregated Stance Dashboard + M-F03 Compare Regions mode */}
        <Section
          title="Stance Distribution"
          icon={<BarChart3 className="h-4 w-4" />}
        >
          {/* Mode toggle */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-slate-500">
              {compareMode ? "Comparing two regions side by side." : "Distribution across all questions in this region."}
            </p>
            <div className="flex gap-1">
              {[
                { mode: false, label: "View" },
                { mode: true,  label: "Compare" },
              ].map(({ mode, label }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setCompareMode(mode)}
                  className={[
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1",
                    compareMode === mode
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 text-slate-600 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {mode && <GitCompare className="h-3 w-3" />}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {compareMode
            ? <CompareRegionsSection regionOptions={regionOptions} />
            : <AggregatedStanceSection regionScope={regionScope} regionKey={regionKey} />
          }
        </Section>

        {/* F2 — Macro Trends */}
        <Section title="Macro Trends Over Time" icon={<TrendingUp className="h-4 w-4" />}>
          <div className="flex items-center gap-2 mb-4">
            <label className="text-xs text-slate-600">Window</label>
            <div className="flex gap-1">
              {TREND_DAYS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setTrendDays(o.value)}
                  className={[
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    trendDays === o.value
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 text-slate-600 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <MacroTrendsSection regionScope={regionScope} regionKey={regionKey} days={trendDays} />
        </Section>

        {/* F3 — Comparative Views */}
        <Section title="Comparative Views" icon={<MapPin className="h-4 w-4" />}>
          <div className="space-y-5">
            {/* Question selector */}
            {pulseData && pulseData.length > 0 && (
              <div className="flex items-start gap-2">
                <label className="text-xs text-slate-600 font-medium mt-2 shrink-0">Question</label>
                <select
                  value={selectedQuestionId ?? ""}
                  onChange={(e) => setSelectedQuestionId(e.target.value || null)}
                  className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Select a question…</option>
                  {pulseData.map((r) => (
                    <option key={r.question_id} value={r.question_id}>
                      {r.question_text.slice(0, 80)}{r.question_text.length > 80 ? "…" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Regional comparison */}
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <MapPin className="h-3 w-3" /> Regional breakdown
              </p>
              <RegionalComparisonSection questionId={selectedQuestionId} />
            </div>

            {/* Demographic breakdown */}
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <Users className="h-3 w-3" /> Demographics
              </p>
              <DemographicSection questionId={selectedQuestionId} />
            </div>
          </div>
        </Section>

      </div>
    </PageLayout>
  );
}
