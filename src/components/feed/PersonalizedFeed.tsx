// src/components/feed/PersonalizedFeed.tsx
// FINAL VERSION - Epic C Personalized Feed
// Uses get_personalized_feed RPC and existing QuestionCard component
// Compatible with all QuestionCard features

import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabaseClient';
import { Alert, AlertDescription } from '@/components/ui/alert';
import * as React from 'react';
import { QuestionCard } from '@/components/question/QuestionCard';
import type { QuestionWithLifecycle } from '@/types/questionLifecycleTypes';

export function PersonalizedFeed() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<any>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
  }, [sb]);

  const userId = session?.user?.id;

  const { data: questions, isLoading, error } = useQuery({
    queryKey: ['personalized-feed', userId],
    queryFn: async () => {
      if (!userId || !sb) return [];
      
      const { data, error } = await sb.rpc('get_personalized_feed', {
        p_user_id: userId,
        p_limit: 20,
        p_offset: 0,
      });

      if (error) {
        console.error('Error fetching personalized feed:', error);
        throw error;
      }
      
      // Transform RPC response to match QuestionWithLifecycle interface
      const transformedQuestions: QuestionWithLifecycle[] = (data || []).map((item: any) => ({
        // Core question fields
        id: item.question_id,
        question: item.question_text,
        summary: item.summary || null,
        published_at: item.published_at,
        
        // Lifecycle fields (Epic C)
        state: item.state || 'active',
        phase: item.phase || 'initial',
        
        // Trending & featured flags
        is_trending: item.is_trending || false,
        trending_score: item.trending_score || null,
        is_featured: item.is_featured || false,
        is_resolved: item.is_resolved || false,
        resolution_summary: item.resolution_summary || null,
        
        // Location/geography
        location_label: item.location_label || null,
        tier: item.tier || null,
        
        // Topic information
        topic_id: item.topic_id,
        topic_title: item.topic_title || null,
        topic_tags: item.topic_tags || [],
        
        // Engagement data
        engagement: {
          responses_total: item.responses_total || 0,
          response_rate_24h: item.response_rate_24h || 0,
          response_rate_7d: item.response_rate_7d || 0,
        },
        
        // User interaction (Epic C)
        user_has_answered: item.user_has_answered || false,
        
        // Relevance score (Epic C - for debugging)
        relevance_score: item.relevance_score || 0,
      }));
      
      return transformedQuestions;
    },
    enabled: !!userId && !!sb,
    staleTime: 30_000, // Cache for 30 seconds
  });

  // Loading state - skeleton cards
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div 
            key={i} 
            className="h-32 bg-slate-100 animate-pulse rounded-lg border"
          />
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertDescription>
          Failed to load your personalized feed. Please try refreshing the page.
        </AlertDescription>
      </Alert>
    );
  }

  // Empty state
  if (!questions || questions.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg bg-slate-50">
        <div className="max-w-md mx-auto px-4">
          <h3 className="text-lg font-medium text-slate-900 mb-2">
            No new questions for you right now
          </h3>
          <p className="text-sm text-slate-600 mb-4">
            Check back later or explore topics to follow for more personalized content.
          </p>
          <a
            href="#/topics"
            className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition"
          >
            Explore topics
          </a>
        </div>
      </div>
    );
  }

  // Main feed display
  return (
    <div className="space-y-3">
      {/* Feed header with count */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-700">
          For You
        </h2>
        <span className="text-xs text-slate-500">
          {questions.length} question{questions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Render each question using your existing QuestionCard component */}
      <div className="space-y-3">
        {questions.map((question) => (
          <QuestionCard
            key={question.id}
            question={question}
            showEngagement={true}
          />
        ))}
      </div>

      {/* Load more indicator (if showing max results) */}
      {questions.length >= 20 && (
        <div className="text-center pt-4 pb-2">
          <p className="text-sm text-slate-500">
            Showing your top 20 personalized questions.{' '}
            <a href="#/topics" className="text-blue-600 hover:underline">
              Explore topics
            </a>{' '}
            to discover more.
          </p>
        </div>
      )}
    </div>
  );
}
