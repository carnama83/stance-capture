// src/pages/EmbedPage.tsx
// Epic T — T1: Hosted Embed Page
//
// A minimal, iframe-compatible page at /embed/:questionId
// No AppTopBar, no navigation — pure question + stance slider + community bar.
//
// URL params:
//   theme: light | dark | auto (default: light)
//   cta:   custom CTA text (URL-encoded)
//   ref:   publisher identifier for analytics

import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { CommunityStanceBar } from "@/components/question/CommunityStanceBar";
import { Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_PROJECT_REF, getJwt } from "@/lib/env";

// ─── Types ────────────────────────────────────────────────────────────────────

type Theme = "light" | "dark" | "auto";

interface EmbedQuestion {
  id: string;
  question: string;
  summary: string | null;
  state: string;
  tags: string[];
  slider_low_label: string | null;
  slider_high_label: string | null;
}

interface CommunityStats {
  pct_agree: number;
  pct_disagree: number;
  pct_neutral: number;
  total_responses: number;
  avg_score: number;
  embedded_count: number;
  total_count: number;
}

// ─── Device fingerprint ───────────────────────────────────────────────────────
// Lightweight, privacy-respecting fingerprint for deduplication only.

async function getDeviceFingerprint(): Promise<string> {
  const key = "sc_embed_fp_v1";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  // Generate a stable random ID for this device/browser
  const fp = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(key, fp);
  return fp;
}

// ─── Stance scale ─────────────────────────────────────────────────────────────

const STANCE_LABELS: Record<number, { short: string; color: string }> = {
  [-2]: { short: "Strongly disagree", color: "#dc2626" },
  [-1]: { short: "Disagree", color: "#f97316" },
  [0]:  { short: "Neutral", color: "#64748b" },
  [1]:  { short: "Agree", color: "#22c55e" },
  [2]:  { short: "Strongly agree", color: "#16a34a" },
};

// ─── Stance slider (lightweight, no Radix dependency issues in embed) ─────────

function EmbedSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const steps = [-2, -1, 0, 1, 2];
  const label = STANCE_LABELS[value];

  return (
    <div className="space-y-3">
      {/* Track with step buttons */}
      <div className="relative">
        <div className="flex items-center justify-between gap-1">
          {steps.map((step) => {
            const isSelected = step === value;
            const stepLabel = STANCE_LABELS[step];
            return (
              <button
                key={step}
                type="button"
                disabled={disabled}
                onClick={() => onChange(step)}
                className={[
                  "flex-1 h-10 rounded-lg text-xs font-semibold transition-all border-2",
                  isSelected
                    ? "text-white border-transparent shadow-md scale-105"
                    : "bg-white border-slate-200 text-slate-500 hover:border-slate-300",
                  disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
                style={isSelected ? { backgroundColor: stepLabel.color, borderColor: stepLabel.color } : {}}
                aria-pressed={isSelected}
                aria-label={stepLabel.short}
              >
                {step === -2 ? "SD" : step === -1 ? "D" : step === 0 ? "N" : step === 1 ? "A" : "SA"}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-between text-[11px] text-slate-400 px-0.5">
        <span>Strongly disagree</span>
        <span style={{ color: label.color }} className="font-medium">{label.short}</span>
        <span>Strongly agree</span>
      </div>
    </div>
  );
}

// ─── Community bar wrapper ────────────────────────────────────────────────────

function EmbedCommunityBar({
  stats,
  lowLabel,
  highLabel,
}: {
  stats: CommunityStats | null;
  lowLabel?: string | null;
  highLabel?: string | null;
}) {
  if (!stats) return null;

  const totalCount = stats.total_count ?? 0;
  const pctAgree = stats.pct_agree ?? 0;
  const pctDisagree = stats.pct_disagree ?? 0;
  const pctNeutral = stats.pct_neutral ?? (100 - pctAgree - pctDisagree);

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">
        Community stance · {totalCount.toLocaleString()} {totalCount === 1 ? "response" : "responses"}
      </p>
      <CommunityStanceBar
        responses={totalCount}
        supportPct={pctAgree}
        opposePct={pctDisagree}
        neutralPct={pctNeutral}
        compact
        lowLabel={lowLabel ?? null}
        highLabel={highLabel ?? null}
      />
    </div>
  );
}

// ─── Main embed page ──────────────────────────────────────────────────────────

export default function EmbedPage() {
  const { questionId } = useParams<{ questionId: string }>();
  const [searchParams] = useSearchParams();
  const theme = (searchParams.get("theme") ?? "light") as Theme;
  const ctaText = searchParams.get("cta") ?? "Join Stance Capture to track how your thinking evolves";
  const publisherRef = searchParams.get("ref") ?? null;

  const sb = React.useMemo(getSupabase, []);

  const [question, setQuestion] = React.useState<EmbedQuestion | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [selectedStance, setSelectedStance] = React.useState<number>(0);
  const [hasInteracted, setHasInteracted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [communityStats, setCommunityStats] = React.useState<CommunityStats | null>(null);

  // Auth state
  const [authUser, setAuthUser] = React.useState<{ display: string } | null>(null);

  // Apply theme to root
  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else if (theme === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.matches) root.classList.add("dark");
    }
  }, [theme]);

  // Load question
  React.useEffect(() => {
    if (!questionId || !sb) return;

    sb.from("questions")
      .select("id, question, summary, state, tags, slider_low_label, slider_high_label")
      .eq("id", questionId)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data) { setError("Question not found."); setLoading(false); return; }
        setQuestion(data as EmbedQuestion);
        setLoading(false);
      });
  }, [questionId, sb]);

  // Load community stats
  React.useEffect(() => {
    if (!questionId || !sb) return;
    sb.rpc("get_embed_community_stats", { p_question_id: questionId })
      .then(({ data }) => { if (data) setCommunityStats(data as any); });
  }, [questionId, sb]);

  // Check auth session
  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setAuthUser({ display: session.user.email ?? "Signed in" });
      }
    });
  }, [sb]);

  // Notify parent window of content height changes (for auto-resize)
  React.useEffect(() => {
    const notify = () => {
      window.parent.postMessage(
        { type: "sc:resize", height: document.body.scrollHeight },
        "*"
      );
    };
    const observer = new ResizeObserver(notify);
    observer.observe(document.body);
    notify();
    return () => observer.disconnect();
  }, [submitted, loading]);

  async function handleSubmit() {
    if (!questionId || !hasInteracted) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const fp = await getDeviceFingerprint();
      const supabaseUrl = SUPABASE_URL;
      const anonKey = SUPABASE_ANON_KEY;

      // Get session token if available
      let authHeader = `Bearer ${anonKey}`;
      if (sb) {
        const { data: { session } } = await sb.auth.getSession();
        if (session?.access_token) authHeader = `Bearer ${session.access_token}`;
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/embed-submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
          "apikey": anonKey,
        },
        body: JSON.stringify({
          question_id: questionId,
          stance_value: selectedStance,
          device_fingerprint: fp,
          publisher_ref: publisherRef,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.error_code === "DUPLICATE") {
          setSubmitted(true); // Already answered — show confirmed state
          return;
        }
        throw new Error(data.message ?? "Submission failed");
      }

      if (data.community_stats) setCommunityStats(data.community_stats as any);
      setSubmitted(true);

      // Notify parent
      window.parent.postMessage(
        { type: "sc:stance_submitted", questionId, stanceValue: selectedStance },
        "*"
      );
    } catch (e: any) {
      setSubmitError(e?.message ?? "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isDark = theme === "dark" || (theme === "auto" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const bgClass = isDark ? "bg-gray-900 text-white" : "bg-white text-slate-900";
  const borderClass = isDark ? "border-gray-700" : "border-slate-200";

  if (loading) {
    return (
      <div className={`min-h-[200px] flex items-center justify-center ${bgClass}`}>
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !question) {
    return (
      <div className={`p-4 text-center text-sm text-slate-400 ${bgClass}`}>
        {error ?? "Question not available."}
      </div>
    );
  }

  return (
    <div className={`p-4 font-sans text-sm ${bgClass}`} style={{ minHeight: 260 }}>
      {/* Brand header */}
      <div className="flex items-center justify-between mb-3">
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-400" : "text-slate-400"}`}>
          Stance Capture
        </span>
        {authUser && (
          <span className="text-[11px] text-blue-500">✓ Signed in</span>
        )}
      </div>

      {/* Question text */}
      <p className={`text-base font-semibold leading-snug mb-4 ${isDark ? "text-white" : "text-slate-900"}`}>
        {question.question}
      </p>

      {/* Summary */}
      {question.summary && !submitted && (
        <p className={`text-xs mb-3 leading-relaxed ${isDark ? "text-slate-300" : "text-slate-500"}`}>
          {question.summary}
        </p>
      )}

      {/* Pre-submit state */}
      {!submitted ? (
        <div className="space-y-4">
          <EmbedSlider
            value={selectedStance}
            onChange={(v) => { setSelectedStance(v); setHasInteracted(true); }}
            disabled={submitting}
          />

          {submitError && (
            <p className="text-xs text-red-500">{submitError}</p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !hasInteracted}
            className={[
              "w-full py-2.5 rounded-lg text-sm font-semibold transition-all",
              hasInteracted && !submitting
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-100 text-slate-400 cursor-not-allowed",
            ].join(" ")}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
              </span>
            ) : (
              "Submit stance"
            )}
          </button>
        </div>
      ) : (
        // Post-submit state
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
            <span>Stance recorded — {STANCE_LABELS[selectedStance]?.short}</span>
          </div>

          <EmbedCommunityBar
            stats={communityStats}
            lowLabel={question?.slider_low_label ?? null}
            highLabel={question?.slider_high_label ?? null}
          />

          {/* CTA */}
          {!authUser && (
            <a
              href={`${window.location.origin}/#/signup`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors"
              onClick={() => window.parent.postMessage({ type: "sc:signup_clicked" }, "*")}
            >
              <span>{ctaText}</span>
              <ExternalLink className="h-3 w-3 shrink-0 ml-2" />
            </a>
          )}
        </div>
      )}

      {/* Branding footer */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
        <span className="text-[10px] text-slate-300">Powered by</span>
        <a
          href={`${window.location.origin}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-blue-400 hover:text-blue-600 font-medium"
        >
          Stance Capture
        </a>
      </div>
    </div>
  );
}
