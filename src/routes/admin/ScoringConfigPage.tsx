// src/routes/admin/ScoringConfigPage.tsx
// Admin page for controlling all scoring configuration from the UI.
// Reads/writes to app_config_trending table via Supabase.

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { Save, RotateCcw, AlertTriangle, CheckCircle, Info, ChevronDown, ChevronUp } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConfigRow = {
  key: string;
  value: number;
  description: string | null;
};

type ConfigMap = Record<string, number>;

// ─── Config schema — defines all editable fields, grouped into sections ───────

type FieldDef = {
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  format: "decimal" | "integer" | "toggle";
  warning?: string;
};

type SectionDef = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  accent: string;
  fields: FieldDef[];
};

const SECTIONS: SectionDef[] = [
  {
    id: "impact_gate",
    title: "Impact Gate",
    subtitle: "Controls which AI-scored questions are eligible for the homepage feed",
    icon: "🎯",
    accent: "#6366f1",
    fields: [
      {
        key: "impact_gate_enabled",
        label: "Gate Enabled",
        description: "When OFF, all questions appear regardless of AI score. Turn OFF temporarily if the pipeline is down.",
        min: 0, max: 1, step: 1,
        format: "toggle",
        warning: "Disabling shows unscored questions to all users",
      },
      {
        key: "impact_gate_min_score",
        label: "Minimum Composite Score",
        description: "Questions must score at or above this threshold to appear in the primary feed. Range 1–10.",
        min: 1, max: 10, step: 0.5,
        format: "decimal",
        warning: "Raising above 8.0 may significantly reduce feed volume",
      },
    ],
  },
  {
    id: "trend_weights",
    title: "Trend Score Weights",
    subtitle: "How stance momentum, topic momentum, and lifecycle contribute to the final trend score",
    icon: "⚖️",
    accent: "#0ea5e9",
    fields: [
      {
        key: "stance_weight",
        label: "Stance Weight",
        description: "Contribution of overall stance momentum (24h + 7d combined) to trend score.",
        min: 0, max: 1, step: 0.05,
        format: "decimal",
      },
      {
        key: "topic_weight",
        label: "Topic Momentum Weight",
        description: "Contribution of media/topic activity in the past 24h to trend score.",
        min: 0, max: 1, step: 0.05,
        format: "decimal",
      },
      {
        key: "lifecycle_weight",
        label: "Lifecycle Weight",
        description: "Contribution of question age and phase (new/active/dormant) to trend score.",
        min: 0, max: 1, step: 0.05,
        format: "decimal",
      },
    ],
  },
  {
    id: "stance_momentum",
    title: "Stance Momentum",
    subtitle: "Weights and caps for how user stance activity is measured",
    icon: "📊",
    accent: "#10b981",
    fields: [
      {
        key: "stance_24h_weight",
        label: "24h Stance Weight",
        description: "How much the last 24h of stance activity contributes within the stance momentum component.",
        min: 0, max: 1, step: 0.05,
        format: "decimal",
      },
      {
        key: "stance_7d_weight",
        label: "7-day Stance Weight",
        description: "How much the last 7 days of stance activity contributes within the stance momentum component.",
        min: 0, max: 1, step: 0.05,
        format: "decimal",
      },
      {
        key: "stance_u24h_cap",
        label: "Unique Users 24h Cap",
        description: "Number of unique users in 24h that equals a full (1.0) stance momentum signal.",
        min: 1, max: 10000, step: 10,
        format: "integer",
      },
      {
        key: "stance_u7d_cap",
        label: "Unique Users 7d Cap",
        description: "Number of unique users in 7 days that equals a full (1.0) stance momentum signal.",
        min: 1, max: 100000, step: 100,
        format: "integer",
      },
      {
        key: "stance_v6h_cap",
        label: "Velocity 6h Cap",
        description: "Stance velocity in the last 6 hours that equals a full gaining signal.",
        min: 1, max: 1000, step: 5,
        format: "integer",
      },
    ],
  },
  {
    id: "topic_momentum",
    title: "Topic Momentum",
    subtitle: "How media volume translates to topic momentum score",
    icon: "📰",
    accent: "#f59e0b",
    fields: [
      {
        key: "topic_news_v24h_cap",
        label: "News Volume 24h Cap",
        description: "Number of articles in 24h that equals a full (1.0) topic momentum signal.",
        min: 1, max: 1000, step: 5,
        format: "integer",
      },
    ],
  },
  {
    id: "micro_signals",
    title: "Micro Signals",
    subtitle: "Thresholds that determine the trend label shown on each question (Breaking / Gaining / Stable)",
    icon: "🔔",
    accent: "#ec4899",
    fields: [
      {
        key: "breaking_topic_threshold",
        label: "Breaking: Topic Threshold",
        description: "Topic momentum must exceed this to be labelled 'breaking'.",
        min: 0, max: 1, step: 0.05,
        format: "decimal",
      },
      {
        key: "breaking_stance_low_threshold",
        label: "Breaking: Stance Low Threshold",
        description: "Stance momentum must be BELOW this for a 'breaking' label (new topic, little stance yet).",
        min: 0, max: 1, step: 0.05,
        format: "decimal",
      },
      {
        key: "gaining_velocity_threshold",
        label: "Gaining: Velocity Threshold",
        description: "6h velocity ratio must exceed this to be labelled 'gaining'.",
        min: 0, max: 1, step: 0.05,
        format: "decimal",
      },
      {
        key: "stable_7d_threshold",
        label: "Stable: 7d Stance Threshold",
        description: "Stance 7d momentum must exceed this to be labelled 'stable'.",
        min: 0, max: 1, step: 0.05,
        format: "decimal",
      },
    ],
  },
  {
    id: "lifecycle",
    title: "Lifecycle & Age",
    subtitle: "How question age affects its ranking position",
    icon: "⏳",
    accent: "#8b5cf6",
    fields: [
      {
        key: "new_days",
        label: "New Question Window (days)",
        description: "Questions published within this many days receive full (1.0) recency boost.",
        min: 1, max: 30, step: 1,
        format: "integer",
      },
      {
        key: "stale_days",
        label: "Stale Question Threshold (days)",
        description: "Questions older than this receive a 0.4 recency penalty.",
        min: 7, max: 365, step: 1,
        format: "integer",
      },
      {
        key: "min_score_floor",
        label: "Minimum Trend Score Floor",
        description: "Questions with a trend score below this are excluded from the feed entirely.",
        min: 0, max: 1, step: 0.01,
        format: "decimal",
      },
    ],
  },
  {
    id: "expectation_signal",
    title: "Epic R — Expectation Signal Thresholds",
    subtitle: "Controls when a question's expectation distribution is shown to users as a signal",
    icon: "📢",
    accent: "#0ea5e9",
    fields: [
      {
        key: "expectation_threshold_pct",
        label: "Agreement Threshold (%)",
        description: "Minimum % agreement on a single expectation type, within a region, for the signal to be shown (M-R03, BR-R02).",
        min: 0, max: 100, step: 1,
        format: "integer",
      },
      {
        key: "expectation_min_respondents",
        label: "Minimum Respondents",
        description: "Minimum unique respondents in a region before a signal is eligible to display, regardless of agreement %.",
        min: 1, max: 10000, step: 1,
        format: "integer",
      },
      {
        key: "expectation_persistence_hours",
        label: "Persistence Window (hours)",
        description: "Minimum time span between a question's first and last expectation response before the signal is eligible — filters out early, short-lived spikes.",
        min: 1, max: 720, step: 1,
        format: "integer",
      },
    ],
  },
];

// All keys that should exist — used to detect missing config rows
const ALL_KEYS = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatValue(value: number, format: FieldDef["format"]): string {
  if (format === "toggle") return value >= 1 ? "Enabled" : "Disabled";
  if (format === "integer") return Math.round(value).toString();
  return value.toFixed(2);
}

function getDefaultValue(key: string): number {
  const defaults: Record<string, number> = {
    impact_gate_enabled: 1,
    impact_gate_min_score: 7.0,
    stance_weight: 0.65,
    topic_weight: 0.25,
    lifecycle_weight: 0.10,
    stance_24h_weight: 0.7,
    stance_7d_weight: 0.3,
    stance_u24h_cap: 100,
    stance_u7d_cap: 1000,
    stance_v6h_cap: 20,
    topic_news_v24h_cap: 50,
    breaking_topic_threshold: 0.7,
    breaking_stance_low_threshold: 0.2,
    gaining_velocity_threshold: 0.6,
    stable_7d_threshold: 0.5,
    new_days: 7,
    stale_days: 60,
    min_score_floor: 0.0,
    // Epic R — M-R03. Matches the COALESCE fallbacks baked into the
    // region_expectation_strength SQL view (§7.3 defaults: 65/100/72) —
    // keep these two in sync if either changes.
    expectation_threshold_pct: 65,
    expectation_min_respondents: 100,
    expectation_persistence_hours: 72,
  };
  return defaults[key] ?? 0;
}

// ─── Individual field components ──────────────────────────────────────────────

function ToggleField({
  field,
  value,
  isDirty,
  onChange,
}: {
  field: FieldDef;
  value: number;
  isDirty: boolean;
  onChange: (v: number) => void;
}) {
  const enabled = value >= 1;
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{field.label}</span>
          {isDirty && <span className="text-[10px] font-medium text-amber-500 uppercase tracking-wide">unsaved</span>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p>
        {field.warning && !enabled && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-600">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {field.warning}
          </div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(enabled ? 0 : 1)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
          enabled ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition duration-200 ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function SliderField({
  field,
  value,
  isDirty,
  onChange,
}: {
  field: FieldDef;
  value: number;
  isDirty: boolean;
  onChange: (v: number) => void;
}) {
  const pct = ((value - field.min) / (field.max - field.min)) * 100;

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{field.label}</span>
            {isDirty && <span className="text-[10px] font-medium text-amber-500 uppercase tracking-wide">unsaved</span>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p>
        </div>
        <div className="shrink-0 text-right">
          <input
            type="number"
            value={field.format === "integer" ? Math.round(value) : value}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.min(field.max, Math.max(field.min, v)));
            }}
            className="w-20 rounded border bg-background px-2 py-1 text-right text-sm font-mono font-medium focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--primary) ${pct}%, var(--muted) ${pct}%)`,
        }}
      />
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
        <span>{field.format === "integer" ? field.min : field.min.toFixed(2)}</span>
        <span>{field.format === "integer" ? field.max : field.max.toFixed(2)}</span>
      </div>
      {field.warning && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-600">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {field.warning}
        </div>
      )}
    </div>
  );
}

// ─── Section card ──────────────────────────────────────────────────────────────

function SectionCard({
  section,
  values,
  dirtyKeys,
  onChange,
}: {
  section: SectionDef;
  values: ConfigMap;
  dirtyKeys: Set<string>;
  onChange: (key: string, value: number) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const hasDirty = section.fields.some((f) => dirtyKeys.has(f.key));

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl">{section.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">{section.title}</h3>
              {hasDirty && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Unsaved changes
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-1">{section.subtitle}</p>
          </div>
        </div>
        <div className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-5 border-t">
          {section.fields.map((field) => {
            const value = values[field.key] ?? getDefaultValue(field.key);
            const isDirty = dirtyKeys.has(field.key);
            return (
              <div key={field.key} className={`pt-4 ${isDirty ? "rounded-lg bg-amber-50/50 -mx-2 px-2 pb-2" : ""}`}>
                {field.format === "toggle" ? (
                  <ToggleField
                    field={field}
                    value={value}
                    isDirty={isDirty}
                    onChange={(v) => onChange(field.key, v)}
                  />
                ) : (
                  <SliderField
                    field={field}
                    value={value}
                    isDirty={isDirty}
                    onChange={(v) => onChange(field.key, v)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ScoringConfigPage() {
  const sb = React.useMemo(getSupabase, []);
  const qc = useQueryClient();

  const [localValues, setLocalValues] = React.useState<ConfigMap>({});
  const [savedValues, setSavedValues] = React.useState<ConfigMap>({});
  const [saveStatus, setSaveStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");

  // ── Fetch all config rows ──
  const { data: configRows, isLoading, isError } = useQuery({
    queryKey: ["admin-scoring-config"],
    queryFn: async () => {
      const { data, error } = await sb!
        .from("app_config_trending")
        .select("key, value, description")
        .order("key");
      if (error) throw error;
      return (data ?? []) as ConfigRow[];
    },
    staleTime: 10_000,
  });

  // Populate local state when data loads
  React.useEffect(() => {
    if (!configRows) return;
    const map: ConfigMap = {};
    for (const row of configRows) {
      map[row.key] = row.value;
    }
    // Fill in any missing keys with defaults
    for (const key of ALL_KEYS) {
      if (map[key] === undefined) map[key] = getDefaultValue(key);
    }
    setLocalValues(map);
    setSavedValues(map);
  }, [configRows]);

  // Dirty keys = what's changed from saved
  const dirtyKeys = React.useMemo(() => {
    const dirty = new Set<string>();
    for (const key of Object.keys(localValues)) {
      if (localValues[key] !== savedValues[key]) dirty.add(key);
    }
    return dirty;
  }, [localValues, savedValues]);

  const hasDirty = dirtyKeys.size > 0;

  // ── Save mutation ──
  const saveMutation = useMutation({
    mutationFn: async (updates: ConfigMap) => {
      const rows = Object.entries(updates).map(([key, value]) => ({
        key,
        value,
        description: configRows?.find((r) => r.key === key)?.description ?? null,
      }));

      const { error } = await sb!
        .from("app_config_trending")
        .upsert(rows, { onConflict: "key" });

      if (error) throw error;
    },
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      setSaveStatus("saved");
      setSavedValues({ ...localValues });
      qc.invalidateQueries({ queryKey: ["admin-scoring-config"] });
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
    onError: () => {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 4000);
    },
  });

  const handleChange = (key: string, value: number) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    // Only save dirty keys
    const updates: ConfigMap = {};
    for (const key of dirtyKeys) {
      updates[key] = localValues[key];
    }
    saveMutation.mutate(updates);
  };

  const handleReset = () => {
    setLocalValues({ ...savedValues });
  };

  // Missing config keys that aren't in DB yet
  const missingKeys = ALL_KEYS.filter(
    (k) => !configRows?.some((r) => r.key === k)
  );

  // ── Render ──
  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
        Failed to load scoring configuration. Check that <code>app_config_trending</code> table exists and is accessible.
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Scoring Configuration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Control how questions are scored, filtered, and ranked on the homepage feed.
            Changes take effect immediately after saving.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasDirty && (
            <button
              type="button"
              onClick={handleReset}
              disabled={saveMutation.isPending}
              className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted/50 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasDirty || saveMutation.isPending}
            className={`flex items-center gap-1.5 rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              hasDirty
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            }`}
          >
            {saveMutation.isPending ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Save {dirtyKeys.size > 0 ? `(${dirtyKeys.size})` : "changes"}
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Save status banner ── */}
      {saveStatus === "saved" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Configuration saved — homepage feed will reflect these changes immediately.
        </div>
      )}
      {saveStatus === "error" && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Failed to save. Check your connection and try again.
        </div>
      )}

      {/* ── Missing keys warning ── */}
      {missingKeys.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Missing config keys detected</div>
            <div className="mt-1 text-xs">
              These keys aren't in the database yet and are using default values:{" "}
              <code className="font-mono">{missingKeys.join(", ")}</code>.
              Run <code className="font-mono">config_keys.sql</code> to insert them.
            </div>
          </div>
        </div>
      )}

      {/* ── Dirty changes summary ── */}
      {hasDirty && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-sm font-medium text-amber-800 mb-2">
            {dirtyKeys.size} unsaved change{dirtyKeys.size !== 1 ? "s" : ""}
          </div>
          <div className="space-y-1">
            {Array.from(dirtyKeys).map((key) => {
              const field = SECTIONS.flatMap((s) => s.fields).find((f) => f.key === key);
              if (!field) return null;
              return (
                <div key={key} className="flex items-center justify-between text-xs text-amber-700">
                  <span>{field.label}</span>
                  <span className="font-mono">
                    {formatValue(savedValues[key] ?? getDefaultValue(key), field.format)}
                    {" → "}
                    <strong>{formatValue(localValues[key], field.format)}</strong>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Config sections ── */}
      {SECTIONS.map((section) => (
        <SectionCard
          key={section.id}
          section={section}
          values={localValues}
          dirtyKeys={dirtyKeys}
          onChange={handleChange}
        />
      ))}

      {/* ── Raw config table (read-only reference) ── */}
      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-muted-foreground hover:text-foreground select-none">
          View raw config table ({configRows?.length ?? 0} rows)
        </summary>
        <div className="border-t overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Key</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Saved</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Local</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Description</th>
              </tr>
            </thead>
            <tbody>
              {(configRows ?? []).map((row) => (
                <tr key={row.key} className={`border-t ${dirtyKeys.has(row.key) ? "bg-amber-50/60" : ""}`}>
                  <td className="px-4 py-2 font-mono text-foreground">{row.key}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{row.value}</td>
                  <td className={`px-4 py-2 text-right font-mono font-medium ${dirtyKeys.has(row.key) ? "text-amber-700" : "text-foreground"}`}>
                    {localValues[row.key] ?? row.value}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{row.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
