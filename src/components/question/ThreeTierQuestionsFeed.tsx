// components/question/ThreeTierQuestionsFeed.tsx
// 3-Tier Regional Curated Feed Component
// Displays: LOCAL (3-5) + NATIONAL (4-6) + GLOBAL (5-7) = ~15 questions

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/AuthContext";

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
}

interface TierSection {
  tier: 'local' | 'national' | 'global';
  label: string;
  emoji: string;
  questions: ThreeTierQuestion[];
}

export function ThreeTierQuestionsFeed() {
  const { session } = useAuth();
  const supabase = React.useMemo(getSupabase, []);
  const userId = session?.user?.id;

  const { data, isLoading, error } = useQuery<ThreeTierQuestion[]>({
    queryKey: ['three-tier-feed', userId],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase not initialized');
      
      const { data, error } = await supabase.rpc('get_three_tier_curated_feed', {
        p_user_id: userId || null,
        p_date: new Date().toISOString().split('T')[0]
      });
      
      if (error) throw error;
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

  return (
    <div className="space-y-6">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Today's Questions
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {totalQuestions} curated questions across {sections.length} regions
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900">{totalQuestions}</div>
          <div className="text-xs text-slate-600">questions</div>
        </div>
      </div>

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

// Question Card Component
function QuestionCard({ question }: { question: ThreeTierQuestion }) {
  return (
    <Link
      to={`/q/${question.question_id}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-900 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
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

          {/* Tags */}
          {question.tags && question.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {question.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-600"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Score Badge */}
        <div className="flex flex-col items-end gap-1">
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
          {question.location_label && (
            <span className="text-xs text-slate-500">
              {question.location_label}
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
