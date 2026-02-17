// src/pages/Index.tsx
// HOMEPAGE V3 (Belief Radar layout) - CORRECTED VERSION
// - Logged OUT: Media vs Belief hero (inline stance), light Pulse + Participation, then "Add your voice"
// - Logged IN: Society Pulse, Media vs Belief, Where You Stand, Add your voice, Continuing, Reopened
//
// Uses new RPCs (already deployed):
// - get_society_pulse(p_region text, p_shift_threshold numeric default 0.08)
// - get_participation_stats(p_region text, p_window_hours int default 24)
// - get_media_surge_homepage(p_region text, p_window_hours int default 24, p_baseline_days int default 7, p_limit int default 5)
// - get_question_distribution(p_question_id uuid, p_region text, p_window_hours int default 168)
// - get_user_alignment_snapshot(p_region text, p_lookback_days int default 30)  [auth]
// - get_because_you_engaged(p_region text, p_limit int default 6)              [auth]
// - get_reopened_questions_for_user(p_region text, p_limit int default 3, ...) [auth]
//
// Reuses existing:
// - get_trending_questions_homepage (authed)
// - v_live_questions (anon fallback)
// - set_question_stance, record_question_view (authed stance capture)

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";

import PageLayout from "@/components/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSupabase } from "@/lib/supabaseClient";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";
import { useGlobalAndCountryIds } from "@/hooks/useLocationIds";

// ---------- Types ----------
type Session = import("@supabase/supabase-js").Session;

type RegionRow = {
  user_id: string;
  city_label: string | null;
  county_label: string | null;
  state_label: string | null;
  country_label: string | null;
  global_label: string | null;
};

type TrendingHomepageQuestionRow = {
  question_id: string;
  question_text: string;
  summary: string | null;
  tags: string[] | null;
  topic_id: string | null;
  topic_title: string | null;
  tier: string | null;
  location_label: string | null;
  user_has_answered: boolean | null;
  trend_micro_signal: string | null;
  trend_score: number | null;
  stance_momentum: number | null;
  topic_momentum: number | null;
};

type AnonQuestionRow = {
  id: string;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  published_at: string | null;
  status?: string | null;
};

type SocietyPulseRow = {
  region: string;
  rapid_shifts_count: number;
  polarized_count: number;
  reawakening_count: number;
  volatility_level: "Low" | "Medium" | "High" | string;
  top_shift_question_id: string | null;
  top_shift_question_text: string | null;
  generated_at: string;
};


type SocietyPulseEarlyStageChip = {
  label: string;
  value: number | null;
};

type SocietyPulseEarlyStageTopic = {
  topic_id: string;
  title: string;
};

type SocietyPulseEarlyStageRow = {
  mode: string; // 'early_stage'
  headline: string;
  description: string;
  chips: SocietyPulseEarlyStageChip[]; // jsonb array
  featured_topics: SocietyPulseEarlyStageTopic[]; // jsonb array
  topic_count: number;
};


type SocietalPulseOutput = {
  region_label: string;
  updated_at: string; // ISO timestamp (UTC)
  state: "STABLE" | "REAWAKENING" | "POLARIZING" | "ACCELERATING" | "FOCUSED";
  narrative: {
    title: string; // "Societal Pulse"
    sentence_1: string;
    sentence_2: string | null;
  };
  chips: Array<{
    topic_id: string;
    title: string;
    icon: "up" | "reawakening" | "polarized" | "steady";
    href: string;
  }>;
  micro_metrics: Array<{
    label: string;
    value: number | null;
  }>;
};


type ParticipationStatsRow = {
  region: string;
  stances_window: number;
  stances_7d: number;
  stances_60m: number;
  unique_users_window: number;
  generated_at: string;
};

type MediaSurgeRow = {
  cluster_id: string;
  cluster_title: string;
  articles_24h: number;
  outlets_24h: number;
  baseline_avg_daily_articles: number | null;
  surge_ratio: number | null;
  sample_title: string | null;
  sample_url: string | null;
  sample_published_at: string | null;
  generated_at?: string | null;
};

type QuestionDistributionRow = {
  question_id: string;
  region: string;
  responses: number;
  oppose_pct: number | null;
  neutral_pct: number | null;
  support_pct: number | null;
  avg_score: number | null;
  generated_at: string;
};

type AlignmentSnapshotRow = {
  user_id?: string;
  region: string;
  alignment_pct: number;
  minority_count: number;
  most_divergent_question_id: string | null;
  most_divergent_question_text: string | null;
  generated_at: string;
};

type BecauseYouRow = {
  question_id: string;
  question_text: string;
  topic_id: string | null;
  topic_title: string | null;
  reason: string | null;
  rank_score: number | null;
};

type ReopenedRow = {
  question_id: string;
  question_text: string;
  last_answered_at: string | null;
  public_shift_proxy: number | null;
  reason: string | null;
};

// ---------- Session hook ----------
function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) =>
      setSession(s ?? null)
    );
    return () => sub.subscription?.unsubscribe();
  }, [sb]);

  return session;
}

// ---------- Display name helper ----------
function getDisplayHandle(
  profile:
    | { random_id: string; username: string | null; display_handle_mode: string }
    | null
    | undefined,
  session: Session | null
): string {
  if (!profile) {
    if (!session?.user?.email) return "there";
    const email = session.user.email;
    const atIdx = email.indexOf("@");
    if (atIdx > 0) {
      const local = email.slice(0, atIdx);
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
    return email;
  }
  if (profile.display_handle_mode === "username" && profile.username) {
    return profile.username;
  }
  return profile.random_id;
}

// ---------- UI helpers ----------
function formatPct(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)}%`;
}

function formatNum(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  if (v >= 1000) return `${Math.round((v / 1000) * 10) / 10}k`;
  return `${Math.round(v)}`;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {subtitle ? (
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

// ---------- Hero CTA ----------
function HeroCta({
  onLogin,
  onSignup,
}: {
  onLogin: () => void;
  onSignup: () => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/60 via-primary/50 to-indigo-500/55 shadow-lg">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_60%)]" />
      <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-white/10 blur-3xl" />

      <div className="relative px-5 py-8 sm:px-8 sm:py-10">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Track how society is thinking — in real time
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/85 sm:text-base">
          Take a stance in seconds. See where your region aligns — and where it
          shifts.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-primary shadow-sm transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/60"
            onClick={onSignup}
          >
            Get started free
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/40"
            onClick={onLogin}
          >
            Log in
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- Hero Welcome ----------
function HeroWelcome({ name }: { name: string }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/5 via-card to-card shadow-sm">
      <div className="pointer-events-none absolute -right-12 -top-12 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative px-5 py-6 sm:px-8 sm:py-7">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Welcome back, {name}!
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Here's what's shifting — and what you can signal next.
        </p>
      </div>
    </section>
  );
}

// ---------- Error Fallback Component ----------
function ErrorFallback({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600">
      {message}
    </div>
  );
}

// ---------- Cards ----------
function SocietyPulseCard({ pulse }: { pulse: SocietalPulseOutput | null }) {
  if (!pulse) return null;

  const chips = Array.isArray(pulse.chips) ? pulse.chips : [];
  const mm = Array.isArray(pulse.micro_metrics) ? pulse.micro_metrics : [];

  const iconGlyph = (icon: SocietalPulseOutput["chips"][number]["icon"]) => {
    switch (icon) {
      case "reawakening":
        return "↺";
      case "polarized":
        return "⇄";
      case "up":
        return "↑";
      default:
        return "→";
    }
  };

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            🌍 Society right now
          </div>

          <div className="mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {pulse.narrative?.title ?? "Societal Pulse"}
            </div>
            <div className="mt-1 text-sm text-foreground leading-relaxed">
              {pulse.narrative?.sentence_1}
              {pulse.narrative?.sentence_2 ? (
                <>
                  {" "}
                  <span className="text-muted-foreground">
                    {pulse.narrative.sentence_2}
                  </span>
                </>
              ) : null}
            </div>
          </div>

          {chips.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {chips.slice(0, 3).map((c) => (
                <Link
                  key={c.topic_id}
                  to={c.href || `/topics/${c.topic_id}`}
                  className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-muted/50"
                  title={c.title}
                >
                  <span className="text-muted-foreground">{iconGlyph(c.icon)}</span>
                  <span className="line-clamp-1 max-w-[200px]">{c.title}</span>
                </Link>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {mm.length > 0 ? (
              mm.slice(0, 3).map((m) => (
                <Pill key={m.label}>
                  {m.value == null ? (
                    <>{m.label}</>
                  ) : (
                    <>
                      {formatNum(m.value)} {m.label}
                    </>
                  )}
                </Pill>
              ))
            ) : (
              <>
                <Pill>— topics shifting rapidly</Pill>
                <Pill>— polarized</Pill>
                <Pill>— reawakening</Pill>
              </>
            )}
          </div>
        </div>

        <Link
          to="/topics"
          className="shrink-0 rounded border px-3 py-1.5 text-xs hover:bg-muted/50"
        >
          Explore shifting topics
        </Link>
      </div>
    </div>
  );
}

function ParticipationStrip({ stats }: { stats: ParticipationStatsRow | null }) {
  if (!stats) return null;
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">🌊 Live participation</div>
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <Pill>{formatNum(stats.stances_window)} signals (24h)</Pill>
          <Pill>{formatNum(stats.stances_7d)} signals (7d)</Pill>
          <Pill>{formatNum(stats.unique_users_window)} people (24h)</Pill>
        </div>
      </div>
    </div>
  );
}

function MediaSurgeCard({ media }: { media: MediaSurgeRow | null }) {
  if (!media) return null;
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            📰 Media surge
          </div>
          <div className="mt-1 text-sm text-foreground line-clamp-1">
            {media.cluster_title}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <Pill>{media.outlets_24h} outlets (24h)</Pill>
            <Pill>{media.articles_24h} articles (24h)</Pill>
            <Pill>
              surge{" "}
              {media.surge_ratio != null
                ? `${Math.round(media.surge_ratio * 10) / 10}×`
                : "—"}
            </Pill>
          </div>
        </div>

        {media.sample_url ? (
          <a
            href={media.sample_url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded border px-3 py-1.5 text-xs hover:bg-muted/50"
          >
            Read
          </a>
        ) : null}
      </div>

      {media.sample_title ? (
        <div className="mt-3 text-sm text-muted-foreground line-clamp-2">
          Sample: <span className="text-foreground">{media.sample_title}</span>
        </div>
      ) : null}
    </div>
  );
}

function WhereYouStandCard({ snap }: { snap: AlignmentSnapshotRow | null }) {
  if (!snap) return null;
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">
            🧭 Where you stand
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <Pill>Alignment: {formatPct(snap.alignment_pct)}</Pill>
            <Pill>{snap.minority_count} in minority</Pill>
          </div>
        </div>

        {snap.most_divergent_question_id ? (
          <Link
            to={`/q/${snap.most_divergent_question_id}`}
            className="rounded border px-3 py-1.5 text-xs hover:bg-muted/50"
          >
            Revisit
          </Link>
        ) : null}
      </div>

      {snap.most_divergent_question_text ? (
        <div className="mt-3 text-sm text-muted-foreground line-clamp-2">
          Most divergent:{" "}
          <span className="text-foreground">
            {snap.most_divergent_question_text}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function InstantFeedbackCard({
  dist,
  onClose,
  mode = "authed",
  userValue,
  onLogin,
}: {
  dist: QuestionDistributionRow | null;
  onClose: () => void;
  mode?: "authed" | "anon";
  userValue?: number | null;
  onLogin?: () => void;
}) {
  if (!dist) return null;

  const bucket =
    userValue == null
      ? null
      : userValue > 0.15
      ? "support"
      : userValue < -0.15
      ? "oppose"
      : "neutral";

  const alignedPct =
    bucket === "support"
      ? dist.support_pct
      : bucket === "oppose"
      ? dist.oppose_pct
      : bucket === "neutral"
      ? dist.neutral_pct
      : null;

  return (
    <div className="rounded-xl border bg-primary/5 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            {mode === "anon" ? "🎉 Instant reward" : "✅ Signal recorded"}
          </div>

          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <Pill>{formatNum(dist.responses)} responses</Pill>
            <Pill>Support {formatPct(dist.support_pct)}</Pill>
            <Pill>Neutral {formatPct(dist.neutral_pct)}</Pill>
            <Pill>Oppose {formatPct(dist.oppose_pct)}</Pill>
            {mode === "anon" && bucket ? (
              <Pill>You’re aligned with {formatPct(alignedPct)}</Pill>
            ) : null}
          </div>

          {mode === "anon" ? (
            <div className="mt-2 text-xs text-muted-foreground">
              Create an account to save your stance and track how it shifts over time.
            </div>
          ) : null}

          {mode === "anon" && onLogin ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
                onClick={onLogin}
              >
                Create account
              </button>
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-xs hover:bg-muted/50"
                onClick={onLogin}
              >
                Log in
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="shrink-0 rounded border px-3 py-1.5 text-xs hover:bg-muted/50"
          onClick={onClose}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ---------- Main ----------
export default function IndexPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSupabaseSession();
  const isAuthed = !!session;
  const sb = React.useMemo(getSupabase, []);

  const userId = session?.user?.id ?? null;

  const actions = (
    <div className="flex items-center gap-2">
      <button
        className="rounded border px-3 py-1.5 text-sm hover:bg-muted/50 flex items-center gap-2"
        onClick={() => navigate("/search")}
        aria-label="Search questions"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search</span>
      </button>
      <button
        className="rounded border px-3 py-1.5 text-sm hover:bg-muted/50"
        onClick={() => navigate("/topics")}
        aria-label="Explore topics"
      >
        Explore topics
      </button>
    </div>
  );

  // Profile (display handle)
  const { data: profile } = useQuery({
    enabled: !!userId,
    queryKey: ["profile", userId],
    queryFn: async () => {
      const logPulse = (
        source: "primary" | "early_stage" | "legacy",
        detail?: unknown
      ) => {
        // Helps debug which tier is active in production.
        try {
          // eslint-disable-next-line no-console
          console.info(`[home] societyPulse source=${source} region=${regionLabel}`, detail ?? "");
        } catch {
          /* no-op */
        }
      };


      if (!sb || !userId) return null;
      const { data, error } = await sb
        .from("profiles")
        .select("random_id, username, display_handle_mode")
        .eq("id", userId)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    staleTime: 60_000,
  });

  // Region dims
  const { data: myRegion } = useQuery({
    enabled: !!userId,
    queryKey: ["my-region", userId],
    queryFn: async () => {
      if (!sb || !userId) return null;
      const { data, error } = await sb
        .from("user_region_dimensions")
        .select(
          "user_id, city_label, county_label, state_label, country_label, global_label"
        )
        .eq("user_id", userId)
        .maybeSingle<RegionRow>();
      if (error) return null;
      return data ?? null;
    },
    staleTime: 60_000,
  });

  const countryLabel = myRegion?.country_label ?? null;
  const globalLabel = myRegion?.global_label ?? "Global";

  // Region tab state (Country tab only shown if we know a country)
  const hasCountry = !!countryLabel;
  const [regionTab, setRegionTab] = React.useState<"country" | "global">(
    hasCountry ? "country" : "global"
  );

  React.useEffect(() => {
    // If country becomes available later, prefer country tab.
    if (hasCountry) setRegionTab((t) => (t === "global" ? "country" : t));
    if (!hasCountry) setRegionTab("global");
  }, [hasCountry]);

  const regionLabel =
    regionTab === "country" && countryLabel ? countryLabel : globalLabel;

  // Location IDs (still used by existing trending RPC)
  const { globalId: GLOBAL_LOCATION_ID, countryId: COUNTRY_LOCATION_ID, isLoading: locationIdsLoading } =
    useGlobalAndCountryIds(countryLabel);

  // -------- New Homepage RPCs --------
  
  // Societal Pulse (topic-level) — new RPC with safe legacy fallback
  const societyPulseQuery = useQuery({
    enabled: !!sb,
    queryKey: ["home-societal-pulse", regionLabel],
    queryFn: async () => {
      // Primary (new) topic-level pulse
      const primary = await sb!.rpc("get_societal_pulse_homepage", {
        p_region_label: regionLabel,
        p_topic_pick_n: 25,
      });

      if (!primary.error && primary.data) {
        logPulse("primary");
        return primary.data as SocietalPulseOutput;
      }

      // Early-stage deterministic narrative (bootstrap mode)
      // Ensures we always show a premium 1–2 sentence pulse, even with low participation.
      const early = await sb!.rpc("get_society_pulse_early_stage", {
        p_region: regionLabel,
        p_top_n: 2,
        p_min_candidates: 3,
        p_w24h: 0.7,
        p_w7d: 0.3,
      });

      if (!early.error && Array.isArray(early.data) && early.data.length > 0) {
        const row = early.data[0] as SocietyPulseEarlyStageRow;

        const featured = Array.isArray(row.featured_topics) ? row.featured_topics : [];
        const chips = Array.isArray(row.chips) ? row.chips : [];

        const mapped: SocietalPulseOutput = {
          region_label: regionLabel,
          updated_at: new Date().toISOString(),
          state: "FOCUSED",
          narrative: {
            title: row.headline || "Societal Pulse",
            sentence_1:
              row.description ||
              "Signals are updating. Explore shifting topics to see where public sentiment is moving right now.",
            sentence_2: null,
          },
          chips: featured.slice(0, 3).map((t) => ({
            topic_id: String(t.topic_id),
            title: String(t.title ?? ""),
            icon: "up",
            href: `/topics/${String(t.topic_id)}`,
          })),
          micro_metrics:
            chips.length > 0
              ? chips.slice(0, 3).map((c) => ({
                  label: String(c.label),
                  value: c.value == null ? null : Number(c.value),
                }))
              : [{ label: "topics surfacing", value: Number(row.topic_count ?? 0) }],
        };

        logPulse("early_stage", {
          topic_count: row.topic_count,
          featured: featured.length,
        });

        return mapped;
      }

      // Fallback (legacy) — kept to avoid breaking the homepage if the RPC name differs across envs.
      // IMPORTANT: legacy has no chips; we keep this section topic-level by using an empty chips array.
      const legacy = await sb!.rpc("get_society_pulse", {
        p_region: regionLabel,
        p_shift_threshold: 0.08,
      });

      if (legacy.error) throw primary.error ?? early.error ?? legacy.error;

      const row =
        Array.isArray(legacy.data) && legacy.data.length > 0
          ? (legacy.data[0] as SocietyPulseRow)
          : null;

      if (!row) return null;

      const mapped: SocietalPulseOutput = {
        region_label: regionLabel,
        updated_at: row.generated_at ?? new Date().toISOString(),
        state: "FOCUSED",
        narrative: {
          title: "Societal Pulse",
          sentence_1:
            "Signals are updating. Explore shifting topics to see where public sentiment is moving right now.",
          sentence_2: null,
        },
        chips: [],
        micro_metrics: [
          { label: "topics shifting rapidly", value: Number(row.rapid_shifts_count ?? 0) },
          { label: "polarized", value: Number(row.polarized_count ?? 0) },
          { label: "reawakening", value: Number(row.reawakening_count ?? 0) },
        ],
      };

      logPulse("legacy", {
        rapid: (row as any).rapid_shifts_count,
        polarized: (row as any).polarized_count,
        reawakening: (row as any).reawakening_count,
      });

      return mapped;
    },
    staleTime: 30_000,
  });

  // PATCH 2 APPLIED: Defensive array check
  const participationQuery = useQuery({
    enabled: !!sb,
    queryKey: ["home-participation", regionLabel],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_participation_stats", {
        p_region: regionLabel,
        p_window_hours: 24,
      });
      if (error) throw error;
      const row = Array.isArray(data) && data.length > 0
        ? (data[0] as ParticipationStatsRow)
        : null;
      return row ?? null;
    },
    staleTime: 30_000,
  });

  // PATCH 2 APPLIED: Defensive array check
  const mediaSurgeQuery = useQuery({
    enabled: !!sb,
    queryKey: ["home-media-surge", regionLabel],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_media_surge_homepage", {
        p_region: regionLabel,
        p_window_hours: 24,
        p_baseline_days: 7,
        p_limit: 5,
      });
      if (error) throw error;
      const rows = (data ?? []) as MediaSurgeRow[];
      return rows.length > 0 ? rows[0] : null;
    },
    staleTime: 30_000,
  });

  // PATCH 2 APPLIED: Defensive array check
  const whereYouStandQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-where-you-stand", userId, regionLabel],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_user_alignment_snapshot", {
        p_region: regionLabel,
        p_lookback_days: 30,
      });
      if (error) throw error;
      const row = Array.isArray(data) && data.length > 0
        ? (data[0] as AlignmentSnapshotRow)
        : null;
      return row ?? null;
    },
    staleTime: 30_000,
  });

  const continuingQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-because-you", userId, regionLabel],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_because_you_engaged", {
        p_region: regionLabel,
        p_limit: 6,
      });
      if (error) throw error;
      return (data ?? []) as BecauseYouRow[];
    },
    staleTime: 30_000,
  });

  const reopenedQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-reopened", userId, regionLabel],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_reopened_questions_for_user", {
        p_region: regionLabel,
        p_limit: 3,
        p_min_shift: 1.0,
        p_min_age_days: 30,
      });
      if (error) throw error;
      return (data ?? []) as ReopenedRow[];
    },
    staleTime: 30_000,
  });

  // -------- Belief side (questions) --------
  const canTrendingNational =
    !!sb &&
    !!userId &&
    !!countryLabel &&
    !!COUNTRY_LOCATION_ID &&
    !locationIdsLoading;

  const canTrendingGlobal =
    !!sb && !!userId && !!GLOBAL_LOCATION_ID && !locationIdsLoading;

  const trendingQuestionsNationalQuery = useQuery({
    enabled: canTrendingNational,
    queryKey: [
      "home-trending-questions",
      "national",
      userId,
      countryLabel,
      COUNTRY_LOCATION_ID,
    ],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_trending_questions_homepage", {
        p_user_id: userId,
        p_region_scope: "national",
        p_region_key: countryLabel,
        p_location_id: COUNTRY_LOCATION_ID,
        p_limit: 10,
      });
      if (error) throw error;
      return (data ?? []) as TrendingHomepageQuestionRow[];
    },
    staleTime: 30_000,
  });

  const trendingQuestionsGlobalQuery = useQuery({
    enabled: canTrendingGlobal,
    queryKey: ["home-trending-questions", "global", userId, GLOBAL_LOCATION_ID],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_trending_questions_homepage", {
        p_user_id: userId,
        p_region_scope: "global",
        p_region_key: globalLabel,
        p_location_id: GLOBAL_LOCATION_ID,
        p_limit: 10,
      });
      if (error) throw error;
      return (data ?? []) as TrendingHomepageQuestionRow[];
    },
    staleTime: 30_000,
  });

  const anonTrendingQuery = useQuery({
    enabled: !!sb && !isAuthed,
    queryKey: ["home-questions-anon", regionLabel],
    queryFn: async () => {
      const q = sb!
        .from("v_live_questions")
        .select("id, question, summary, tags, location_label, published_at, status")
        .order("published_at", { ascending: false })
        .limit(10);

      // region filter (keep consistent with earlier rules)
      // - Global: all
      // - Country tab: {country, Global, NULL}
      if (regionLabel !== "Global") {
        const eligible = regionLabel === "United States"
          ? ["United States", "Global"]
          : [regionLabel];
        // postgrest "in" doesn't include null, so we OR in is null via or()
        q.or(`location_label.in.(${eligible.map((x) => `"${x}"`).join(",")}),location_label.is.null`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AnonQuestionRow[];
    },
    staleTime: 60_000,
  });

  const trendingQuestions =
    regionTab === "country"
      ? trendingQuestionsNationalQuery.data ?? []
      : trendingQuestionsGlobalQuery.data ?? [];

  const anonQuestions = anonTrendingQuery.data ?? [];

  const heroBeliefQuestionAuthed = trendingQuestions[0] ?? null;
  const addSignalAuthed = trendingQuestions.slice(1, 6);

  const heroBeliefQuestionAnon = anonQuestions[0] ?? null;
  const addSignalAnon = anonQuestions.slice(1, 6);

  // -------- Instant feedback after stance submit --------
  const [feedback, setFeedback] = React.useState<QuestionDistributionRow | null>(
    null
  );

  const [anonLastValue, setAnonLastValue] = React.useState<number | null>(null);

  const distributionQuery = useQuery({
    enabled: false, // manual refetch
    queryKey: ["home-distribution", feedback?.question_id ?? "none", regionLabel],
    queryFn: async () => feedback,
  });

  const fetchDistribution = React.useCallback(
    async (questionId: string) => {
      if (!sb) return;
      try {
        const { data, error } = await sb.rpc("get_question_distribution", {
          p_question_id: questionId,
          p_region: regionLabel,
          p_window_hours: 168,
        });
        if (error) throw error;
        const row = Array.isArray(data) && data.length > 0
          ? (data[0] as QuestionDistributionRow)
          : null;
        setFeedback(row);
      } catch (e) {
        // non-blocking
        console.warn("get_question_distribution failed", e);
      }
    },
    [sb, regionLabel]
  );

  const submitStance = React.useCallback(
    async (questionId: string, value: number) => {
      if (!sb) return;

      // If not logged in, force auth before allowing any answering.
      if (!userId) {
        const returnTo = window.location.hash || "#/";
        sessionStorage.setItem("return_to", returnTo);
        navigate("/login");
        return;
      }

      const { error } = await sb.rpc("set_question_stance", {
        p_question_id: questionId,
        p_score: value,
      });

      if (error) throw error;

      // Instant feedback (best-effort)
      fetchDistribution(questionId);

      // Refresh key homepage queries
      await Promise.allSettled([
        qc.invalidateQueries({ queryKey: ["home-where-you-stand", userId, regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-because-you", userId, regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-reopened", userId, regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-participation", regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-society-pulse", regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-media-surge", regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-trending-questions"] }),
      ]);
    },
    [sb, userId, qc, navigate, regionLabel, fetchDistribution]
  );

  // Logged-out users: keep UI briefly interactive so the mechanic is understood,
  // then redirect to login with a clear intent.
  const redirectToLogin = React.useCallback(
    (reason: "take_stances" | "generic" = "generic") => {
      const returnTo = window.location.hash || "#/";
      sessionStorage.setItem("return_to", returnTo);
      sessionStorage.setItem("login_reason", reason);
      navigate("/login");
    },
    [navigate]
  );

  // Record impressions for top questions (authed only, best-effort)
  React.useEffect(() => {
    if (!sb || !userId) return;
    const ids = trendingQuestions.slice(0, 5).map((x) => x.question_id);
    if (!ids.length) return;

    let cancelled = false;
    (async () => {
      for (const qid of ids) {
        if (cancelled) break;
        try {
          await sb.rpc("record_question_view", {
            p_user_id: userId,
            p_question_id: qid,
          });
        } catch {
          // non-blocking
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sb, userId, trendingQuestions]);

  const goToQuestion = (questionId: string) => navigate(`/q/${questionId}`);

  const hero = isAuthed ? (
    <HeroWelcome name={getDisplayHandle(profile, session)} />
  ) : (
    <HeroCta onLogin={() => navigate("/login")} onSignup={() => navigate("/signup")} />
  );

  const regionTabs = (
    <Tabs
      value={regionTab}
      onValueChange={(v) => setRegionTab(v as any)}
      className="w-full"
    >
      <TabsList>
        {hasCountry ? <TabsTrigger value="country">{countryLabel}</TabsTrigger> : null}
        <TabsTrigger value="global">Global</TabsTrigger>
      </TabsList>

      <TabsContent value={regionTab} className="mt-4 space-y-4">
        {isAuthed ? (
        <>
          {/* SECTION 2 — Instant Reward (authed) */}
          <InstantFeedbackCard dist={feedback} onClose={() => setFeedback(null)} />

          {/* SECTION 1/3 — Society + Media vs Belief (returning user) */}
          {societyPulseQuery.isError ? (
            <ErrorFallback message="Failed to load Society Pulse. Please refresh the page." />
          ) : (
            <SocietyPulseCard pulse={societyPulseQuery.data ?? null} />
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {mediaSurgeQuery.isError ? (
              <ErrorFallback message="Failed to load Media Surge. Please refresh the page." />
            ) : (
              <MediaSurgeCard media={mediaSurgeQuery.data ?? null} />
            )}

            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">⚖️ Add your signal</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    A high-momentum question — answer in seconds.
                  </div>
                </div>
                {heroBeliefQuestionAuthed ? (
                  <button
                    type="button"
                    className="shrink-0 rounded border px-3 py-1.5 text-xs hover:bg-muted/50"
                    onClick={() => goToQuestion(heroBeliefQuestionAuthed.question_id)}
                  >
                    Open
                  </button>
                ) : null}
              </div>

              <div className="mt-3">
                {heroBeliefQuestionAuthed ? (
                  <QuestionStanceSlider
                    questionId={heroBeliefQuestionAuthed.question_id}
                    questionText={heroBeliefQuestionAuthed.question_text}
                    summary={heroBeliefQuestionAuthed.summary}
                    initialValue={null}
                    onSubmit={(v) => submitStance(heroBeliefQuestionAuthed.question_id, v)}
                  />
                ) : (
                  <div className="rounded border bg-muted/30 p-3 text-sm text-muted-foreground">
                    No questions available yet. Try again in a few minutes.
                  </div>
                )}
              </div>
            </div>
          </div>

          {participationQuery.isError ? (
            <ErrorFallback message="Failed to load participation stats. Please refresh the page." />
          ) : (
            <ParticipationStrip stats={participationQuery.data ?? null} />
          )}

          <WhereYouStandCard snap={whereYouStandQuery.data ?? null} />
        </>
      ) : (
        <>
          {/* 🧭 VARIANT 1 — FIRST-TIME / ANON (Conversion-Oriented) */}

          {/* 🟥 SECTION 1 — 🔥 One Big Shifting Question */}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">🔥 One big shifting question</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Answer in seconds — see where society stands.
                </div>
              </div>
            </div>

            <div className="mt-3">
              {heroBeliefQuestionAnon ? (
                <div className="relative">
                  {/* Click question text -> open Question Detail (logged out is OK) */}
                  <Link
                    to={`/q/${heroBeliefQuestionAnon.id}`}
                    className="mb-3 block text-sm font-medium leading-snug text-foreground hover:underline"
                  >
                    {heroBeliefQuestionAnon.question}
                  </Link>

                  {/*
                    Slider stays interactive for logged-out users so they see the position + explainer change.
                    After they release the interaction, redirect to login to take a stance.
                  */}
                  <div
                    className="rounded-xl"
                    onPointerUpCapture={() => redirectToLogin("take_stances")}
                    onPointerCancelCapture={() => redirectToLogin("take_stances")}
                    onMouseUpCapture={() => redirectToLogin("take_stances")}
                    onTouchEndCapture={() => redirectToLogin("take_stances")}
                  >
                    <QuestionStanceSlider
                      questionId={heroBeliefQuestionAnon.id}
                      questionText={heroBeliefQuestionAnon.question}
                      summary={heroBeliefQuestionAnon.summary}
                      initialValue={null}
                      onSubmit={() => redirectToLogin("take_stances")}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded border bg-muted/30 p-3 text-sm text-muted-foreground">
                  No questions available yet. Try again in a few minutes.
                </div>
              )}
            </div>
          </div>

          {/* 🟧 SECTION 2 — Instant Reward (Post-Slide Reveal) */}
          <InstantFeedbackCard
            dist={feedback}
            onClose={() => {
              setFeedback(null);
              setAnonLastValue(null);
            }}
            mode="anon"
            userValue={anonLastValue}
            onLogin={() => {
              const returnTo = window.location.hash || "#/";
              sessionStorage.setItem("return_to", returnTo);
              navigate("/login");
            }}
          />

          {/* 🟦 SECTION 3 — 🌍 Society Right Now (Light) */}
          {societyPulseQuery.isError ? (
            <ErrorFallback message="Failed to load Society Pulse. Please refresh the page." />
          ) : (
            <SocietyPulseCard pulse={societyPulseQuery.data ?? null} />
          )}

          {/* 🟨 SECTION 4 — ⚖️ Add Your Voice / What’s moving fast */}
          {mediaSurgeQuery.isError ? (
            <ErrorFallback message="Failed to load Media Surge. Please refresh the page." />
          ) : (
            <MediaSurgeCard media={mediaSurgeQuery.data ?? null} />
          )}
        </>
      )}

{/* Add your voice */}
        <section className="space-y-3">
          <SectionHeader
            title="Add your voice"
            subtitle="A few high-momentum questions to shape the signal."
          />
          <div className="space-y-3">
            {isAuthed
              ? addSignalAuthed.map((q) => (
                  <div
                    key={q.question_id}
                    className="rounded-xl border bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to={`/q/${q.question_id}`}
                          className="font-semibold text-foreground line-clamp-2 hover:underline"
                        >
                          {q.question_text}
                        </Link>
                        {q.topic_title ? (
                          <div className="mt-1 text-xs text-muted-foreground line-clamp-1">
                            Topic: {q.topic_title}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          {q.trend_micro_signal ? (
                            <Pill>{q.trend_micro_signal.toUpperCase()}</Pill>
                          ) : null}
                          {q.user_has_answered ? <Pill>ANSWERED</Pill> : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded border px-3 py-1.5 text-xs hover:bg-muted/50"
                        onClick={() => goToQuestion(q.question_id)}
                      >
                        Open
                      </button>
                    </div>

                    <div className="mt-3">
                      <QuestionStanceSlider
                        questionId={q.question_id}
                        questionText={q.question_text}
                        summary={q.summary}
                        initialValue={null}
                        onSubmit={(v) => submitStance(q.question_id, v)}
                      />
                    </div>
                  </div>
                ))
              : addSignalAnon.map((q) => (
                  <div key={q.id} className="rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to={`/q/${q.id}`}
                          className="font-semibold text-foreground line-clamp-2 hover:underline"
                        >
                          {q.question}
                        </Link>
                        {q.summary ? (
                          <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                            {q.summary}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded border px-3 py-1.5 text-xs hover:bg-muted/50"
                        onClick={() => navigate("/login")}
                      >
                        Log in
                      </button>
                    </div>

                    <div
                      className="mt-3"
                      onPointerUpCapture={() => redirectToLogin("take_stances")}
                      onPointerCancelCapture={() => redirectToLogin("take_stances")}
                      onMouseUpCapture={() => redirectToLogin("take_stances")}
                      onTouchEndCapture={() => redirectToLogin("take_stances")}
                    >
                      <QuestionStanceSlider
                        questionId={q.id}
                        questionText={q.question}
                        summary={q.summary}
                        initialValue={null}
                        onSubmit={() => redirectToLogin("take_stances")}
                      />
                    </div>
                  </div>
                ))}
          </div>
        </section>

        {!isAuthed ? (
          <section className="space-y-3">
            <SectionHeader
              title="Social proof"
              subtitle="A quick sense of how many people are participating."
            />
            {participationQuery.isError ? (
              <ErrorFallback message="Failed to load participation stats. Please refresh the page." />
            ) : (
              <ParticipationStrip stats={participationQuery.data ?? null} />
            )}
          </section>
        ) : null}

        {/* Continuing conversation */}
        {isAuthed ? (
          <section className="space-y-3">
            <SectionHeader
              title="Continuing the conversation"
              subtitle="Recommended based on your recent signals."
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(continuingQuery.data ?? []).slice(0, 4).map((r) => (
                <div key={r.question_id} className="rounded-xl border bg-card p-4 shadow-sm">
                  <Link
                    to={`/q/${r.question_id}`}
                    className="font-semibold text-foreground line-clamp-2 hover:underline"
                  >
                    {r.question_text}
                  </Link>
                  {r.topic_title ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Topic: {r.topic_title}
                    </div>
                  ) : null}
                  {r.reason ? (
                    <div className="mt-2 text-xs text-muted-foreground line-clamp-2">
                      {r.reason}
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <button
                      type="button"
                      className="rounded border px-3 py-1.5 text-xs hover:bg-muted/50"
                      onClick={() => goToQuestion(r.question_id)}
                    >
                      Open
                    </button>
                  </div>
                </div>
              ))}
              {(!continuingQuery.data || continuingQuery.data.length === 0) ? (
                <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                  No recommendations yet — answer a few more questions to personalize this.
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Reopened */}
        {isAuthed ? (
          <section className="space-y-3">
            <SectionHeader
              title="Reopened questions"
              subtitle="Your past signals that may be worth revisiting."
            />
            <div className="space-y-3">
              {(reopenedQuery.data ?? []).map((r) => (
                <div key={r.question_id} className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      to={`/q/${r.question_id}`}
                      className="min-w-0 font-semibold text-foreground line-clamp-2 hover:underline"
                    >
                      {r.question_text}
                    </Link>
                    <button
                      type="button"
                      className="shrink-0 rounded border px-3 py-1.5 text-xs hover:bg-muted/50"
                      onClick={() => goToQuestion(r.question_id)}
                    >
                      Revisit
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {r.public_shift_proxy != null ? (
                      <Pill>shift proxy: {Math.round(r.public_shift_proxy * 10) / 10}</Pill>
                    ) : null}
                    {r.reason ? <Pill>{r.reason}</Pill> : null}
                  </div>
                </div>
              ))}
              {(!reopenedQuery.data || reopenedQuery.data.length === 0) ? (
                <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                  Nothing reopened yet — this appears after you've answered and time passes.
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </TabsContent>
    </Tabs>
  );

  return (
    <PageLayout rightSlot={actions}>
      {hero}

      <section className="py-4 space-y-4">
        {regionTabs}
      </section>
    </PageLayout>
  );
}
