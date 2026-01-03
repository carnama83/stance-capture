// components/question/ThreeTierQuestionsFeed.tsx
// 3-Tier Regional Curated Feed Component with IP Geolocation + Lifecycle Features
// Enhanced with state badges, trending indicators, and engagement metrics

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { QuestionStateBadge } from "./QuestionStateBadge";
import { TrendingBadge } from "./TrendingBadge";
import { MessageSquare } from "lucide-react";
import { formatAgeDays, calculateAgeDays } from "@/types/questionLifecycleTypes";
import type { QuestionState } from "@/types/questionLifecycleTypes";

type Session = import("@supabase/supabase-js").Session;

interface ThreeTierQuestion {
  tier: 'local' | 'national' | 'global';
  tier_label: string;
  question_id: string;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  composite_score: number;
  tier_position: number;
  // Lifecycle fields
  state?: QuestionState;
  is_trending?: boolean;
  is_featured?: boolean;
  is_resolved?: boolean;
  trending_score?: number;
  published_at?: string;
  // Engagement metrics
  responses_total?: number;
  response_rate_24h?: number;
}

interface TierSection {
  tier: 'local' | 'national' | 'global';
  label: string;
  emoji: string;
  questions: ThreeTierQuestion[];
}

interface IPLocationData {
  country: string | null;
  country_code: string | null;
  city: string | null;
  region: string | null;
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

// IP Geolocation hook (for anonymous users)
function useIPLocation() {
  return useQuery<IPLocationData>({
    queryKey: ['ip-location'],
    queryFn: async () => {
      try {
        // Using ipapi.co (free tier: 30,000 requests/month)
        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) throw new Error('IP lookup failed');
        
        const data = await response.json();
        
        return {
          country: data.country_name || null,
          country_code: data.country_code || null,
          city: data.city || null,
          region: data.region || null,
        };
      } catch (error) {
        console.error('IP geolocation failed:', error);
        return {
          country: null,
          country_code: null,
          city: null,
          region: null,
        };
      }
    },
    staleTime: 24 * 60 * 60 * 1000, // Cache for 24 hours
    cacheTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}

export function ThreeTierQuestionsFeed() {
  const session = useSupabaseSession();
  const supabase = React.useMemo(getSupabase, []);
  const userId = session?.user?.id;
  
  // Get IP location for anonymous users
  const { data: ipLocation } = useIPLocation();

  const { data, isLoading, error } = useQuery<ThreeTierQuestion[]>({
    queryKey: ['three-tier-feed', userId, ipLocation?.country],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase not initialized');
      
      // Determine parameters based on auth status
      let params: any = {};
      
      if (userId) {
        // Logged-in user: Use their saved location
        params = {
          p_user_id: userId,
          p_date: new Date().toISOString().split('T')[0]
        };
      } else if (ipLocation?.country) {
        // Anonymous user with detected location: Use IP country
        params = {
          p_user_id: null,
          p_date: new Date().toISOString().split('T')[0],
          p_ip_country: ipLocation.country
        };
      }
      
      const { data, error } = await supabase.rpc('get_three_tier_curated_feed_v2', params);
      
      if (error) {
        console.error('Error fetching three-tier feed:', error);
        throw error;
      }
      
      // Fetch lifecycle data for these questions
      const questionIds = (data || []).map((q: any) => q.question_id);
      
      if (questionIds.length > 0) {
        const { data: lifecycleData, error: lifecycleError } = await supabase
          .from('questions')
          .select(`
            id,
            state,
            is_trending,
            is_featured,
            is_resolved,
            trending_score,
            published_at,
            engagement:question_engagement_metrics(
              responses_total,
              response_rate_24h
            )
          `)
          .in('id', questionIds);
        
        if (!lifecycleError && lifecycleData) {
          // Merge lifecycle data with feed data
          const lifecycleMap = new Map(
            lifecycleData.map((item: any) => [
              item.id,
              {
                state: item.state,
                is_trending: item.is_trending,
                is_featured: item.is_featured,
                is_resolved: item.is_resolved,
                trending_score: item.trending_score,
                published_at: item.published_at,
                responses_total: item.engagement?.[0]?.responses_total || 0,
                response_rate_24h: item.engagement?.[0]?.response_rate_24h || 0,
              }
            ])
          );
          
          return (data || []).map((q: any) => ({
            ...q,
            ...(lifecycleMap.get(q.question_id) || {})
          })) as ThreeTierQuestion[];
        }
      }
      
      return (data || []) as ThreeTierQuestion[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!supabase,
  });

  // Group questions by tier
  const sections = React.useMemo(() => {
    if (!data || data.length === 0) return [];
    
    const grouped: Record<string, ThreeTierQuestion[]> = {
      local: [],
      national: [],
      global: [],
    };
    
    data.forEach(q => {
      if (grouped[q.tier]) {
        grouped[q.tier].push(q);
      }
    });
    
    const result: TierSection[] = [];
    
    if (grouped.local.length > 0) {
      result.push({
        tier: 'local',
        label: grouped.local[0].tier_label || 'Local',
        emoji: '📍',
        questions: grouped.local,
      });
    }
    
    if (grouped.national.length > 0) {
      result.push({
        tier: 'national',
        label: grouped.national[0].tier_label || 'National',
        emoji: getCountryEmoji(grouped.national[0].tier_label),
        questions: grouped.national,
      });
    }
    
    if (grouped.global.length > 0) {
      result.push({
        tier: 'global',
        label: 'Global',
        emoji: '🌍',
        questions: grouped.global,
      });
    }
    
    return result;
  }, [data]);

  // Count trending questions
  const trendingCount = React.useMemo(() => {
    return data?.filter(q => q.is_trending).length || 0;
  }, [data]);

  if (isLoading) {
    return (
      <div className="rounded-lg border p-6 bg-white">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded w-1/3"></div>
          <div className="h-4 bg-slate-200 rounded w-2/3"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-800">
          Failed to load curated questions. Please try refreshing.
        </p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <p className="text-sm text-slate-600">
          No questions available yet. Check back soon!
        </p>
      </div>
    );
  }

  const totalQuestions = data.length;
  
  // Show location detection notice for anonymous users
  const showIPNotice = !userId && ipLocation?.country;

  return (
    <div className="space-y-6">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Today's Questions
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {totalQuestions} curated questions across {sections.length} region{sections.length !== 1 ? 's' : ''}
            {trendingCount > 0 && (
              <span className="ml-2 text-orange-600 font-medium">
                • {trendingCount} trending 🔥
              </span>
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900">{totalQuestions}</div>
          <div className="text-xs text-slate-600">questions</div>
        </div>
      </div>

      {/* IP Location Notice */}
      {showIPNotice && (
        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="text-blue-600">📍</span>
            <div className="flex-1">
              <p className="text-blue-900">
                Showing questions for <strong>{ipLocation.country}</strong> based on your location.
              </p>
              <p className="text-blue-700 text-xs mt-1">
                <Link to="/signup" className="underline font-medium">Sign up</Link> to customize your feed and track your stances over time.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tier Sections */}
      {sections.map((section) => (
        <section key={section.tier} className="space-y-3">
          {/* Tier Header */}
          <div className="flex items-center gap-3 pb-2 border-b border-slate-200">
            <span className="text-2xl" role="img" aria-label={section.tier}>
              {section.emoji}
            </span>
            <div>
              <h3 className="font-semibold text-slate-900">
                {section.label}
              </h3>
              <p className="text-xs text-slate-600">
                {section.questions.length} question{section.questions.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* Questions */}
          <div className="space-y-3">
            {section.questions.map((q) => (
              <QuestionCard key={q.question_id} question={q} />
            ))}
          </div>
        </section>
      ))}

      {/* Footer */}
      <div className="text-center pt-4 border-t border-slate-200">
        <p className="text-xs text-slate-500">
          Questions refreshed daily at 6:00 AM
        </p>
      </div>
    </div>
  );
}

// Enhanced Question Card Component with Lifecycle Features
function QuestionCard({ question }: { question: ThreeTierQuestion }) {
  const ageDays = question.published_at ? calculateAgeDays(question.published_at) : null;
  
  return (
    <Link
      to={`/q/${question.question_id}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-900 hover:shadow-sm transition-all"
    >
      {/* Top Row: Badges */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-2">
          {/* State Badge */}
          {question.state && (
            <QuestionStateBadge state={question.state} size="sm" />
          )}
          
          {/* Trending Badge */}
          {question.is_trending && (
            <TrendingBadge trendingScore={question.trending_score} />
          )}
          
          {/* Featured Badge */}
          {question.is_featured && (
            <span className="inline-flex items-center rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-xs font-medium">
              ⭐ Featured
            </span>
          )}
          
          {/* Resolved Badge */}
          {question.is_resolved && (
            <span className="inline-flex items-center rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">
              ✅ Resolved
            </span>
          )}
        </div>

        {/* Age + Score */}
        <div className="flex flex-col items-end gap-1">
          {ageDays !== null && (
            <span className="text-xs text-slate-500">
              {formatAgeDays(ageDays)}
            </span>
          )}
          <div
            className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${
              question.composite_score >= 8
                ? 'bg-green-100 text-green-800'
                : question.composite_score >= 6
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-800'
            }`}
          >
            {question.composite_score.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Question Text */}
      <div className="font-medium text-slate-900 mb-2">
        {question.question}
      </div>

      {/* Summary */}
      {question.summary && (
        <p className="text-sm text-slate-600 line-clamp-2 mb-2">
          {question.summary}
        </p>
      )}

      {/* Bottom Row: Tags + Engagement */}
      <div className="flex items-center justify-between gap-3">
        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 flex-1">
          {question.tags && question.tags.length > 0 && (
            <>
              {question.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-600"
                >
                  #{tag}
                </span>
              ))}
            </>
          )}
          
          {/* Location Label */}
          {question.location_label && (
            <span className="text-xs text-slate-500">
              📍 {question.location_label}
            </span>
          )}
        </div>

        {/* Engagement Stats */}
        {(question.responses_total !== undefined && question.responses_total > 0) && (
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              <span>{question.responses_total}</span>
            </div>
            
            {question.response_rate_24h !== undefined && question.response_rate_24h > 0 && (
              <div className="text-blue-600 font-medium">
                +{Math.round(question.response_rate_24h)} today
              </div>
            )}
          </div>
        )}
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
