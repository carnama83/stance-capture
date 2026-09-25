// src/components/question/ExpectationSignalBlock.tsx
// Epic R — M-R03: Expectation signal display on QuestionDetailPage (R-FR-10).
//
// Reads get_expectation_signal() for the user's region. Renders nothing
// (BR-R02) unless signal_crossed=true — showing a signal below threshold
// would amplify a weak/unrepresentative expectation, which is the core
// credibility guardrail the doc calls out repeatedly. The RPC returns the
// per-type breakdown only once the threshold is crossed (Epic R R-01).
//
// Self-contained (fetches its own data), mirrors AuthorityBlock/
// IncidentSummaryCard's pattern. Not gated on whether the current user has
// answered — per doc §6.2, this sits in the same "Expectation & Authority
// Section" as AuthorityBlock, which also isn't stance-gated. BR-R01 governs
// the CAPTURE prompt (post-stance only), not this display.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { fetchUserRegionId } from "@/lib/userRegion";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";
import { BarChart3, Megaphone, Check } from "lucide-react";
import { EXPECTATION_LABEL_KEYS } from "@/components/question/ExpectationPrompt";

type Session = import("@supabase/supabase-js").Session;

// No shared session hook exists in this codebase — every file that needs
// the current session defines its own onAuthStateChange listener (20+
// files do this, including QuestionDetailPage.tsx). Matching that
// convention here rather than introducing a new shared hook.
function useLocalSession() {
  const [session, setSession] = React.useState<Session | null>(null);
  React.useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, []);
  return session;
}

interface SummaryRow {
  expectation_type: string;
  response_count: number;
  pct_of_respondents: number;
}

interface SignalData {
  signalCrossed: boolean;
  breakdown: SummaryRow[];
  totalRespondents: number;
  dominantType: string | null;
  regionName: string | null;
}

function useExpectationSignal(questionId: string, regionId: string | null, regionResolved: boolean) {
  return useQuery<SignalData>({
    queryKey: ["expectation-signal", questionId, regionId],
    enabled: !!questionId && regionResolved,
    staleTime: 30_000,
    queryFn: async () => {
      const empty: SignalData = {
        signalCrossed: false,
        breakdown: [],
        totalRespondents: 0,
        dominantType: null,
        regionName: null,
      };
      const sb = getSupabase();
      if (!sb) return empty;

      // Epic R R-01: the aggregate views are closed to browser roles (small
      // cells exposed individual selections). This RPC returns NULL unless the
      // signal has crossed threshold, so below-threshold data never leaves
      // the database. regionId null = the no-location bucket.
      const { data: signal, error: signalErr } = await sb.rpc("get_expectation_signal", {
        p_question_id: questionId,
        p_region_id: regionId,
      });
      if (signalErr) {
        console.error("[ExpectationSignalBlock] signal fetch failed", signalErr);
        return empty;
      }
      const s = signal as {
        signal_crossed?: boolean;
        total_respondents?: number;
        dominant_expectation_type?: string | null;
        breakdown?: SummaryRow[];
      } | null;
      if (!s?.signal_crossed) return empty;

      let regionName: string | null = null;
      if (regionId) {
        const { data: loc } = await sb.from("locations").select("name").eq("id", regionId).maybeSingle();
        regionName = loc?.name ?? null;
      }

      return {
        signalCrossed: true,
        breakdown: s.breakdown ?? [],
        totalRespondents: s.total_respondents ?? 0,
        dominantType: s.dominant_expectation_type ?? null,
        regionName,
      };
    },
  });
}

const OPTIN_DISMISS_KEY_PREFIX = "collective_optin_dismissed_";

// Epic R — M-R05: collective action opt-in (R5, US-R09/US-R10).
// Rendered below the signal bars, only when signal_crossed=true AND
// regionId is a real, named region — not the no-location bucket. US-R09's
// copy ("People in your region overwhelmingly expect action") doesn't read
// coherently for an unnamed bucket, so this gates on regionId even though
// the underlying signal could theoretically cross threshold there too.
// This is a product-consistency call, not something the doc states
// explicitly.
//
// Also gated on being signed in: collective_action_optins.user_id is
// NOT NULL (BR-R05 needs a stable identity for "one opt-in per user per
// question"), so an anonymous visitor has no way to opt in at all — they
// still see the signal bars above, just not this CTA.
//
// Write path omits user_id entirely, relying on the column's
// DEFAULT auth.uid() (see BUGFIX_user_id_default.sql) — same fix that was
// needed for M-R01's expectation writes, applied correctly here from the
// start rather than retroactively.
//
// Epic R R-06: the component starts from the user's actual opt-in (RLS
// allows reading your own row), so someone who already opted in sees the
// "included" state with a Withdraw action instead of being asked again. A
// duplicate insert (409) is treated as success, and failures are shown
// rather than swallowed.
function useMyOptIn(questionId: string, userId: string) {
  return useQuery<boolean>({
    // Keyed by user: the query cache survives sign-out (cf. F-06).
    queryKey: ["my-optin", userId, questionId],
    enabled: !!questionId && !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return false;
      const { data, error } = await sb
        .from("collective_action_optins")
        .select("id")
        .eq("question_id", questionId)
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });
}

function CollectiveActionOptIn({
  questionId,
  regionId,
  userId,
}: {
  questionId: string;
  regionId: string;
  userId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: optedIn, isSuccess: optInKnown } = useMyOptIn(questionId, userId);
  const [visible, setVisible] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let dismissed = false;
    try {
      dismissed = !!sessionStorage.getItem(`${OPTIN_DISMISS_KEY_PREFIX}${questionId}`);
    } catch {
      /* sessionStorage unavailable — fail open, show the prompt */
    }
    setVisible(!dismissed);
    setError(false);
  }, [questionId]);

  function dismiss() {
    try {
      sessionStorage.setItem(`${OPTIN_DISMISS_KEY_PREFIX}${questionId}`, "1");
    } catch {
      /* fail silently — worst case it reappears next session */
    }
    setVisible(false);
  }

  async function handleOptIn() {
    if (submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/collective_action_optins`, {
        method: "POST",
        headers: supabaseHeaders(getJwt()),
        body: JSON.stringify([{ question_id: questionId, region_id: regionId }]),
      });
      // 409 = the unique (user_id, question_id) row already exists: already opted in.
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      qc.setQueryData(["my-optin", userId, questionId], true);
    } catch (err) {
      console.error("[CollectiveActionOptIn] opt-in failed", err);
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw() {
    if (submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      // RLS limits the delete to the caller's own row.
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/collective_action_optins?question_id=eq.${questionId}`,
        { method: "DELETE", headers: supabaseHeaders(getJwt(), { Prefer: "return=representation" }) }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      qc.setQueryData(["my-optin", userId, questionId], false);
    } catch (err) {
      console.error("[CollectiveActionOptIn] withdraw failed", err);
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (!optInKnown) return null;

  const errorLine = error ? (
    <p className="text-[11px] text-rose-600 mt-1.5">{t("expectationSignalBlock.couldNotUpdate")}</p>
  ) : null;

  // Already opted in: show that, whatever this session's "Not now" said.
  if (optedIn) {
    return (
      <div className="mt-2 pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <Check className="h-3 w-3 text-green-600" />
            {t("expectationSignalBlock.yourResponseIsIncludedAnonymously")}
          </span>
          <button
            onClick={handleWithdraw}
            disabled={submitting}
            className="text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2 disabled:opacity-50"
          >
            {t("expectationSignalBlock.withdraw")}
          </button>
        </div>
        {errorLine}
      </div>
    );
  }

  if (!visible) return null;

  return (
    <div className="mt-2 pt-2 border-t border-slate-100">
      <div className="flex items-start gap-1.5 mb-2">
        <Megaphone className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
        <p className="text-[11px] text-slate-600">
          {t("expectationSignalBlock.peopleInYourRegionOverwhelmingly")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleOptIn}
          disabled={submitting}
          className="text-[11px] font-medium rounded-lg px-2.5 py-1 bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          {submitting ? t("stance.saving") : t("expectationSignalBlock.yesIncludeMyResponseAnonymously")}
        </button>
        <Link
          to={`/ledger/${questionId}/${regionId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-medium rounded-lg px-2.5 py-1 border border-slate-200 text-slate-600 hover:border-slate-300 transition-colors"
        >
          {t("expectationSignalBlock.viewSummaryOnly")}
        </Link>
        <button
          onClick={dismiss}
          className="text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2 px-1"
        >
          {t("ugq.notNow")}
        </button>
      </div>
      {errorLine}
    </div>
  );
}

export function ExpectationSignalBlock({ questionId }: { questionId: string }) {
  const { t } = useTranslation();
  const session = useLocalSession();
  const userId = session?.user?.id ?? null;

  const [regionId, setRegionId] = React.useState<string | null>(null);
  const [regionResolved, setRegionResolved] = React.useState(false);

  React.useEffect(() => {
    setRegionResolved(false);
    if (!userId) {
      // Signed-out visitors have no location_settings row — evaluate the
      // no-location (region_id IS NULL) bucket rather than blocking on auth.
      setRegionId(null);
      setRegionResolved(true);
      return;
    }
    fetchUserRegionId(userId).then((id) => {
      setRegionId(id);
      setRegionResolved(true);
    });
  }, [userId]);

  const { data } = useExpectationSignal(questionId, regionId, regionResolved);

  if (!data?.signalCrossed || data.breakdown.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 mb-3">
      <div className="flex items-center gap-1.5 mb-2">
        <BarChart3 className="h-3.5 w-3.5 text-slate-500" />
        <p className="text-xs font-medium text-slate-700">
          {data.regionName
            ? t("expectationSignalBlock.whatRegionExpects", { region: data.regionName })
            : t("expectationSignalBlock.whatRespondentsExpect")}
        </p>
      </div>

      <div className="space-y-1.5">
        {data.breakdown.map((row) => {
          const isDominant = row.expectation_type === data.dominantType;
          const labelKey = EXPECTATION_LABEL_KEYS[row.expectation_type];
          const label = labelKey ? t(labelKey) : row.expectation_type;
          const pct = row.pct_of_respondents ?? 0;
          return (
            <div key={row.expectation_type}>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className={isDominant ? "font-semibold text-slate-800" : "text-slate-500"}>
                  {label}
                </span>
                <span className={isDominant ? "font-semibold text-slate-800" : "text-slate-400"}>
                  {pct}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={isDominant ? "h-full bg-slate-900" : "h-full bg-slate-300"}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-400 mt-2">
        {t("expectationSignalBlock.basedOnRespondents", { count: data.totalRespondents })}
      </p>

      {userId && regionId && (
        <CollectiveActionOptIn questionId={questionId} regionId={regionId} userId={userId} />
      )}
    </div>
  );
}
