// src/components/question/ExpectationSignalBlock.tsx
// Epic R — M-R03: Expectation signal display on QuestionDetailPage (R-FR-10).
//
// Reads region_expectation_strength for the user's region. Renders nothing
// (BR-R02) unless signal_crossed=true — showing a signal below threshold
// would amplify a weak/unrepresentative expectation, which is the core
// credibility guardrail the doc calls out repeatedly. When crossed, pulls
// the full per-type breakdown from question_expectation_summary for the
// same (question_id, region_id) to render the bar chart.
//
// Self-contained (fetches its own data), mirrors AuthorityBlock/
// IncidentSummaryCard's pattern. Not gated on whether the current user has
// answered — per doc §6.2, this sits in the same "Expectation & Authority
// Section" as AuthorityBlock, which also isn't stance-gated. BR-R01 governs
// the CAPTURE prompt (post-stance only), not this display.

import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { fetchUserRegionId } from "@/lib/userRegion";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";
import { BarChart3, Megaphone, Check } from "lucide-react";
import { EXPECTATION_LABELS } from "@/components/question/ExpectationPrompt";

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

      let strengthQ = sb.from("region_expectation_strength").select("*").eq("question_id", questionId);
      strengthQ = regionId ? strengthQ.eq("region_id", regionId) : strengthQ.is("region_id", null);
      const { data: strengthRows, error: strengthErr } = await strengthQ.limit(1);
      if (strengthErr) {
        console.error("[ExpectationSignalBlock] strength fetch failed", strengthErr);
        return empty;
      }
      const strength = strengthRows?.[0];
      if (!strength?.signal_crossed) return empty;

      let summaryQ = sb.from("question_expectation_summary").select("*").eq("question_id", questionId);
      summaryQ = regionId ? summaryQ.eq("region_id", regionId) : summaryQ.is("region_id", null);
      const { data: summaryRows, error: summaryErr } = await summaryQ.order("pct_of_respondents", { ascending: false });
      if (summaryErr) {
        console.error("[ExpectationSignalBlock] summary fetch failed", summaryErr);
        return empty;
      }

      let regionName: string | null = null;
      if (regionId) {
        const { data: loc } = await sb.from("locations").select("name").eq("id", regionId).maybeSingle();
        regionName = loc?.name ?? null;
      }

      return {
        signalCrossed: true,
        breakdown: (summaryRows ?? []) as SummaryRow[],
        totalRespondents: strength.total_respondents ?? 0,
        dominantType: strength.dominant_expectation_type ?? null,
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
function CollectiveActionOptIn({
  questionId,
  regionId,
}: {
  questionId: string;
  regionId: string;
}) {
  const [visible, setVisible] = React.useState(false);
  const [choice, setChoice] = React.useState<"optedIn" | "viewSummary" | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    let dismissed = false;
    try {
      dismissed = !!sessionStorage.getItem(`${OPTIN_DISMISS_KEY_PREFIX}${questionId}`);
    } catch {
      /* sessionStorage unavailable — fail open, show the prompt */
    }
    setVisible(!dismissed);
    setChoice(null);
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
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/collective_action_optins`, {
        method: "POST",
        headers: supabaseHeaders(getJwt(), { Prefer: "resolution=ignore-duplicates" }),
        body: JSON.stringify([{ question_id: questionId, region_id: regionId }]),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      setChoice("optedIn");
    } catch (err) {
      console.error("[CollectiveActionOptIn] opt-in failed", err);
      // Non-blocking — this is a secondary civic signal, not a critical
      // action. Silently leave the prompt visible rather than showing an
      // error the person can't do anything about.
    } finally {
      setSubmitting(false);
    }
  }

  if (!visible) return null;

  if (choice === "optedIn") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-100">
        <Check className="h-3 w-3 text-green-600" />
        Your response is included, anonymously.
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-slate-100">
      <div className="flex items-start gap-1.5 mb-2">
        <Megaphone className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
        <p className="text-[11px] text-slate-600">
          People in your region overwhelmingly expect action. Would you like this expectation to be made visible?
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleOptIn}
          disabled={submitting}
          className="text-[11px] font-medium rounded-lg px-2.5 py-1 bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          {submitting ? "Saving…" : "Yes, include my response anonymously"}
        </button>
        <Link
          to={`/ledger/${questionId}/${regionId}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setChoice("viewSummary")}
          className="text-[11px] font-medium rounded-lg px-2.5 py-1 border border-slate-200 text-slate-600 hover:border-slate-300 transition-colors"
        >
          View summary only
        </Link>
        <button
          onClick={dismiss}
          className="text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2 px-1"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

export function ExpectationSignalBlock({ questionId }: { questionId: string }) {
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
          What {data.regionName ? `${data.regionName} respondents` : "respondents"} expect
        </p>
      </div>

      <div className="space-y-1.5">
        {data.breakdown.map((row) => {
          const isDominant = row.expectation_type === data.dominantType;
          const label = EXPECTATION_LABELS[row.expectation_type] ?? row.expectation_type;
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
        Based on {data.totalRespondents} respondent{data.totalRespondents === 1 ? "" : "s"}.
      </p>

      {userId && regionId && (
        <CollectiveActionOptIn questionId={questionId} regionId={regionId} />
      )}
    </div>
  );
}
