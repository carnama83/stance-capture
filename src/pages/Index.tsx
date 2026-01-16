// src/pages/Index.tsx
// FINAL VERSION - Epic C Integration Complete
// - Authenticated users: PersonalizedFeed (smart, relevance-based)
// - Anonymous users: ThreeTierQuestionsFeed (regional curation)

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";
import { PersonalizedFeed } from "@/components/feed/PersonalizedFeed";
import { ThreeTierQuestionsFeed } from "@/components/question/ThreeTierQuestionsFeed";
import { ThreeTierTrending } from "@/components/trending/ThreeTierTrending";

// ---------- Types ----------
type Session = import("@supabase/supabase-js").Session;

type Topic = {
  id: string;
  title: string;
  summary?: string | null;
  tags?: string[] | null;
  updated_at?: string | null;
  tier?: "city" | "county" | "state" | "country" | "global" | null;
  location_label?: string | null;
  trending_score?: number | null;
  activity_7d?: number | null;
};

type RegionRow = {
  user_id: string;
  city_label: string | null;
  county_label: string | null;
  state_label: string | null;
  country_label: string | null;
};

// ---------- Session hook ----------
function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  return session;
}

// ---------- Source aliasing ----------
const SOURCE_ALIAS: Record<string, string> = {
  topic_region_trends: "topic_region_trends_v",
  topics_trending: "vw_topics_trending",
};

// ---------- Generic fetch utility ----------
async function fetchFromSource<T>(
  sb: ReturnType<typeof getSupabase> | null,
  options: {
    sourceCandidates: string[];
    defaultSource: string;
    select: string;
    filters?: Record<string, any>;
    order?: { column: string; ascending: boolean }[];
    limit?: number;
  }
): Promise<T[]> {
  if (!sb) {
    console.warn("No supabase client; returning empty array.");
    return [];
  }

  let lastError: any = null;

  for (const srcCandidate of options.sourceCandidates) {
    const actualSource = SOURCE_ALIAS[srcCandidate] ?? srcCandidate;
    try {
      let query = sb.from(actualSource).select(options.select);

      if (options.filters) {
        for (const [key, value] of Object.entries(options.filters)) {
          query = query.eq(key, value);
        }
      }
      if (options.order) {
        for (const o of options.order) {
          query = query.order(o.column, { ascending: o.ascending });
        }
      }
      if (options.limit != null) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;
      if (!error && data) {
        return data as T[];
      }
      lastError = error;
    } catch (err) {
      lastError = err;
    }
  }

  console.error(
    `Failed to fetch from all sources for "${options.defaultSource}". Last error:`,
    lastError
  );
  return [];
}

// ---------- Trending topics ----------
async function fetchTrendingTopics(
  sb: ReturnType<typeof getSupabase> | null,
  opts: { personalized: boolean; userId: string | null }
): Promise<Topic[]> {
  const baseSelect =
    "id, title, summary, tags, updated_at, tier, location_label, trending_score, activity_7d";

  if (opts.personalized && opts.userId && sb) {
    try {
      const { data, error } = await sb.rpc("get_personalized_trending_topics", {
        p_user_id: opts.userId,
        p_limit: 5,
      });
      if (!error && data) {
        return data as Topic[];
      }
    } catch {
      // Fallback to global
    }
  }

  return fetchFromSource<Topic>(sb, {
    sourceCandidates: ["vw_topics_trending", "topics_trending"],
    defaultSource: "vw_topics_trending",
    select: baseSelect,
    order: [
      { column: "trending_score", ascending: false },
      { column: "updated_at", ascending: false },
    ],
    limit: 5,
  });
}

// ---------- Display name helper ----------
function displayName(session: Session | null): string {
  if (!session?.user?.email) return "there";
  const email = session.user.email;
  const atIdx = email.indexOf("@");
  if (atIdx > 0) {
    const local = email.slice(0, atIdx);
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return email;
}

// ---------- Hero CTA (anonymous users) ----------
function HeroCta({
  onLogin,
  onSignup,
}: {
  onLogin: () => void;
  onSignup: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-gradient-to-br from-slate-50 to-white shadow-sm">
      <div className="px-4 py-6 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Track your stance on what matters
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Compare your views with your city, state, and the world. See how your
          opinions evolve over time.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900"
            onClick={onSignup}
          >
            Sign up
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900"
            onClick={onLogin}
          >
            Log in
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- Hero welcome (authenticated users) ----------
function HeroWelcome({ name }: { name: string }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-gradient-to-br from-slate-50 to-white shadow-sm">
      <div className="px-4 py-5 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Welcome back, {name}!
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Take a stance on today's questions. Compare your views with your city,
          state, and the world.
        </p>
      </div>
    </section>
  );
}

// ---------- Main component ----------
export default function IndexPage() {
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const isAuthed = !!session;
  const sb = React.useMemo(getSupabase, []);

  const requireLogin = React.useCallback(() => {
    const returnTo = window.location.hash || "#/";
    sessionStorage.setItem("return_to", returnTo);
    navigate("/login");
  }, [navigate]);

  const trendingQuery = useQuery({
    queryKey: ["trending", isAuthed ? session?.user?.id : "anon"],
    queryFn: async () => {
      if (!sb)
        return fetchTrendingTopics(null, { personalized: false, userId: null });
      try {
        return await fetchTrendingTopics(sb, {
          personalized: isAuthed,
          userId: session?.user?.id ?? null,
        });
      } catch {
        return fetchTrendingTopics(null, { personalized: false, userId: null });
      }
    },
    staleTime: 60_000,
  });

  const userId = session?.user?.id ?? null;

  const {
    data: myRegion,
    isLoading: myRegionLoading,
  } = useQuery({
    enabled: !!userId,
    queryKey: ["my-region", userId],
    queryFn: async () => {
      if (!sb || !userId) return null;
      const { data, error } = await sb
        .from("user_region_dimensions")
        .select("user_id, city_label, county_label, state_label, country_label")
        .eq("user_id", userId)
        .maybeSingle<RegionRow>();
      if (error) {
        console.error("Failed to load user region dimensions", error);
        return null;
      }
      return data ?? null;
    },
    staleTime: 60_000,
  });

  const showLocationNudge =
    isAuthed &&
    !myRegionLoading &&
    myRegion &&
    !myRegion.city_label &&
    !myRegion.state_label &&
    !myRegion.country_label &&
    !myRegion.county_label;

  const actions = (
    <button
      className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
      onClick={() => navigate("/topics")}
      aria-label="Explore topics"
    >
      Explore topics
    </button>
  );

  return (
    <PageLayout rightSlot={actions}>
      {/* Hero Section */}
      {isAuthed ? (
        <HeroWelcome name={displayName(session)} />
      ) : (
        <HeroCta
          onLogin={() => navigate("/login")}
          onSignup={() => navigate("/signup")}
        />
      )}

      {/* Main Feed Section */}
      <section className="py-4">
        {/* Location Setup Nudge */}
        {showLocationNudge && (
          <div className="mb-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="text-slate-700">
              Set your location to compare your stance with people in your region.
            </span>
            <Link
              to="/settings/location"
              className="inline-flex items-center rounded bg-slate-900 text-white px-2 py-1 text-[11px]"
            >
              Set location
            </Link>
          </div>
        )}

        {/* 
          EPIC C INTEGRATION:
          - Authenticated users: PersonalizedFeed (smart, relevance-based)
          - Anonymous users: ThreeTierQuestionsFeed (regional curation)
        */}
        {isAuthed ? (
          <PersonalizedFeed />
        ) : (
          <ThreeTierQuestionsFeed />
        )}

        {/* Link to explore more topics */}
        <div className="text-center pt-6">
          <Link
            to="/topics"
            className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition"
          >
            <span>Explore all topics</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      {/* Trending Section */}
      <section className="py-4">
        <ThreeTierTrending />
      </section>
    </PageLayout>
  );
}
