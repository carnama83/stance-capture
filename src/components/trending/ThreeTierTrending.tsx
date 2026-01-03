// components/trending/ThreeTierTrending.tsx
// 3-Tier Trending Topics: Local, National, Global

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { Flame, MapPin, Flag, Globe } from "lucide-react";

type Session = import("@supabase/supabase-js").Session;

interface TrendingTopic {
  tier: 'local' | 'national' | 'global';
  tier_label: string;
  topic_id: string;
  title: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  trending_score: number;
  activity_7d: number;
}

interface TrendingSection {
  tier: 'local' | 'national' | 'global';
  label: string;
  icon: React.ReactNode;
  emoji: string;
  topics: TrendingTopic[];
}

// Session hook
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

export function ThreeTierTrending() {
  const session = useSupabaseSession();
  const supabase = React.useMemo(getSupabase, []);
  const userId = session?.user?.id;

  const { data: topics, isLoading, error } = useQuery<TrendingTopic[]>({
    queryKey: ['three-tier-trending', userId],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase not initialized');

      const { data, error } = await supabase.rpc('get_three_tier_trending_topics', {
        p_user_id: userId || null,
        p_limit_per_tier: 5
      });

      if (error) {
        console.error('Error fetching trending topics:', error);
        throw error;
      }

      return (data || []) as TrendingTopic[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!supabase,
  });

  // Group topics by tier
  const sections = React.useMemo(() => {
    if (!topics || topics.length === 0) return [];

    const grouped: Record<string, TrendingTopic[]> = {
      local: [],
      national: [],
      global: [],
    };

    topics.forEach(topic => {
      if (grouped[topic.tier]) {
        grouped[topic.tier].push(topic);
      }
    });

    const result: TrendingSection[] = [];

    // Local section
    if (grouped.local.length > 0) {
      result.push({
        tier: 'local',
        label: `In Your Area${grouped.local[0].tier_label ? ` (${grouped.local[0].tier_label})` : ''}`,
        icon: <MapPin className="w-5 h-5" />,
        emoji: '📍',
        topics: grouped.local,
      });
    }

    // National section
    if (grouped.national.length > 0) {
      result.push({
        tier: 'national',
        label: `In ${grouped.national[0].tier_label || 'Your Country'}`,
        icon: <Flag className="w-5 h-5" />,
        emoji: getCountryEmoji(grouped.national[0].tier_label),
        topics: grouped.national,
      });
    }

    // Global section
    if (grouped.global.length > 0) {
      result.push({
        tier: 'global',
        label: 'Around the World',
        icon: <Globe className="w-5 h-5" />,
        emoji: '🌍',
        topics: grouped.global,
      });
    }

    return result;
  }, [topics]);

  if (isLoading) {
    return (
      <div className="rounded-lg border p-6 bg-white">
        <div className="flex items-center gap-2 mb-4">
          <Flame className="w-5 h-5 text-orange-500" />
          <h2 className="text-xl font-semibold">Trending Now</h2>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-slate-200 rounded w-3/4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2"></div>
          <div className="h-4 bg-slate-200 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
        <p className="text-sm text-orange-800">
          Unable to load trending topics right now.
        </p>
      </div>
    );
  }

  if (!topics || topics.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <Flame className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-600">
          No trending topics yet. Check back soon!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Flame className="w-5 h-5 text-orange-500" />
        <h2 className="text-xl font-semibold text-slate-900">Trending Now</h2>
      </div>

      {/* Sections */}
      {sections.map((section) => (
        <TrendingSection key={section.tier} section={section} />
      ))}

      {/* Show message if user not logged in and only seeing global */}
      {!userId && sections.length === 1 && sections[0].tier === 'global' && (
        <div className="text-center pt-2 border-t border-slate-200">
          <p className="text-xs text-slate-500">
            <Link to="/signup" className="text-blue-600 hover:underline">
              Sign up
            </Link>{' '}
            to see trending topics in your area
          </p>
        </div>
      )}
    </div>
  );
}

// Trending Section Component
function TrendingSection({ section }: { section: TrendingSection }) {
  return (
    <div className="space-y-3">
      {/* Section Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
        <span className="text-lg" role="img" aria-label={section.tier}>
          {section.emoji}
        </span>
        <h3 className="font-semibold text-slate-900 text-sm">
          {section.label}
        </h3>
        <span className="text-xs text-slate-500">
          ({section.topics.length})
        </span>
      </div>

      {/* Topics */}
      <div className="space-y-2">
        {section.topics.map((topic) => (
          <TrendingTopicCard key={topic.topic_id} topic={topic} />
        ))}
      </div>
    </div>
  );
}

// Trending Topic Card
function TrendingTopicCard({ topic }: { topic: TrendingTopic }) {
  return (
    <Link
      to={`/topics/${topic.topic_id}`}
      className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-orange-400 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="font-medium text-slate-900 text-sm mb-1 line-clamp-2">
            {topic.title}
          </div>

          {/* Summary */}
          {topic.summary && (
            <p className="text-xs text-slate-600 line-clamp-1 mb-2">
              {topic.summary}
            </p>
          )}

          {/* Tags */}
          {topic.tags && topic.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {topic.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Trending Score */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1 text-orange-600">
            <Flame className="w-3 h-3" />
            <span className="text-xs font-semibold">
              {Math.round(topic.trending_score)}
            </span>
          </div>
          {topic.activity_7d > 0 && (
            <span className="text-xs text-slate-500">
              {topic.activity_7d} this week
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// Helper: Get country emoji
function getCountryEmoji(countryName: string | null): string {
  if (!countryName) return '🏳️';

  const countryMap: Record<string, string> = {
    'United States': '🇺🇸',
    'USA': '🇺🇸',
    'India': '🇮🇳',
    'United Kingdom': '🇬🇧',
    'UK': '🇬🇧',
    'Canada': '🇨🇦',
    'Australia': '🇦🇺',
    'Germany': '🇩🇪',
    'France': '🇫🇷',
    'Japan': '🇯🇵',
    'China': '🇨🇳',
    'Brazil': '🇧🇷',
    'Mexico': '🇲🇽',
    'Spain': '🇪🇸',
    'Italy': '🇮🇹',
  };

  return countryMap[countryName] || '🏳️';
}
