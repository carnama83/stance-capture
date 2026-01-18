/**
 * Epic C - Personalized Feed Component (PHASE-AWARE VERSION)
 * Shows questions tailored to user's location and followed topics
 * ✨ NOW WITH: Phase-aware re-exposure tracking
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, TrendingUp, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { QuestionPhaseBadge } from '@/components/question/QuestionPhaseBadge';

// ✨ NEW: Extended type with phase information
interface FeedQuestion {
  question_id: string;
  topic_id: string;
  question: string;
  summary: string | null;
  tags: string[] | null;
  state: string;
  published_at: string;
  is_trending: boolean;
  trending_score: number;
  user_has_answered: boolean;
  topic_title: string;
  topic_tags: string[] | null;
  relevance_score: number;
  response_count: number;
  phase: string;  // ✨ NEW
  is_new_phase: boolean;  // ✨ NEW
}

export function PersonalizedFeed() {
  const supabase = getSupabase();
  const queryClient = useQueryClient();
  
  const { data: sessionData } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });
  
  const userId = sessionData?.session?.user?.id;
  
  // ✨ NEW: Mutation to record question views
  const recordViewMutation = useMutation({
    mutationFn: async (questionId: string) => {
      if (!userId || !supabase) return;
      
      const { error } = await supabase.rpc('record_question_view', {
        p_user_id: userId,
        p_question_id: questionId,
      });
      
      if (error) {
        console.error('Failed to record question view:', error);
      }
    },
  });
  
  // Fetch personalized feed
  const { data: questions, isLoading, error } = useQuery<FeedQuestion[]>({
    queryKey: ['personalized-feed', userId],
    queryFn: async () => {
      if (!userId || !supabase) {
        console.log('⚠️ No userId or supabase client');
        return [];
      }
      
      console.log('🔍 Fetching personalized feed for user:', userId);
      
      const { data, error } = await supabase.rpc('get_personalized_feed', {
        p_user_id: userId,
        p_limit: 20,
        p_offset: 0,
      });
      
      if (error) {
        console.error('❌ Personalized feed RPC error:', error);
        throw error;
      }
      
      console.log('✅ Personalized feed data:', data);
      return data as FeedQuestion[];
    },
    enabled: !!userId && !!supabase,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
  
  // ✨ NEW: Record views for all questions in viewport
  useEffect(() => {
    if (!questions || questions.length === 0) return;
    
    // Record view for all questions after a short delay
    // (allows user to actually see them)
    const timer = setTimeout(() => {
      questions.forEach((q) => {
        recordViewMutation.mutate(q.question_id);
      });
    }, 2000); // 2 second delay
    
    return () => clearTimeout(timer);
  }, [questions]);
  
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-6">
            <Skeleton className="h-6 w-3/4 mb-2" />
            <Skeleton className="h-4 w-full mb-4" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
        ))}
      </div>
    );
  }
  
  if (error) {
    console.error('Error in PersonalizedFeed:', error);
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Failed to load your personalized feed. 
          {error instanceof Error && (
            <div className="mt-2 text-xs">
              Error: {error.message}
            </div>
          )}
          <div className="mt-2">
            <button 
              onClick={() => window.location.reload()} 
              className="text-sm underline"
            >
              Try refreshing the page
            </button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  
  if (!questions || questions.length === 0) {
    return (
      <Card className="p-12 text-center">
        <div className="text-slate-400 mb-4">
          <MessageSquare className="h-12 w-12 mx-auto mb-2" />
        </div>
        <h3 className="text-lg font-medium text-slate-700 mb-2">
          No questions available
        </h3>
        <p className="text-sm text-slate-500">
          Check back later for new questions tailored to your interests.
        </p>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4">
      {questions.map((q) => (
        <Link 
          key={q.question_id} 
          to={`/q/${q.question_id}`}
          className="block"
        >
          <Card className="p-6 hover:shadow-lg transition-shadow">
            {/* Header with badges */}
            <div className="flex items-start gap-2 mb-3">
              <div className="flex-1">
                {/* Topic title */}
                <div className="text-xs text-slate-500 mb-1">
                  {q.topic_title}
                </div>
                
                {/* Badges */}
                <div className="flex flex-wrap gap-2 mb-2">
                  {/* ✨ NEW: New Phase Badge */}
                  {q.is_new_phase && (
                    <Badge variant="default" className="bg-blue-600">
                      <Sparkles className="h-3 w-3 mr-1" />
                      New {q.phase !== 'initial' ? q.phase.charAt(0).toUpperCase() + q.phase.slice(1) : 'Question'}
                    </Badge>
                  )}
                  
                  {/* State Badge */}
                  {q.state === 'new' && (
                    <Badge variant="secondary">
                      🆕 New
                    </Badge>
                  )}
                  
                  {/* Trending Badge */}
                  {q.is_trending && (
                    <Badge variant="outline" className="border-orange-300 text-orange-700">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      Trending
                    </Badge>
                  )}
                  
                  {/* ✨ NEW: Phase Badge (if not initial) */}
                  {q.phase !== 'initial' && (
                    <PhaseBadge phase={q.phase} />
                  )}
                </div>
              </div>
            </div>
            
            {/* Question */}
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {q.question}
            </h3>
            
            {/* Summary */}
            {q.summary && (
              <p className="text-sm text-slate-600 mb-4 line-clamp-2">
                {q.summary}
              </p>
            )}
            
            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {q.response_count} {q.response_count === 1 ? 'response' : 'responses'}
                </span>
                {q.user_has_answered && (
                  <span className="text-blue-600">✓ You answered</span>
                )}
              </div>
              <span>
                {formatTimeAgo(q.published_at)}
              </span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

// ✨ NEW: Phase Badge Component
function PhaseBadge({ phase }: { phase: string }) {
  const config: Record<string, { label: string; color: string; icon: string }> = {
    update: { 
      label: 'Update', 
      color: 'bg-blue-100 text-blue-800 border-blue-300',
      icon: '🔄'
    },
    resolution: { 
      label: 'Resolution', 
      color: 'bg-green-100 text-green-800 border-green-300',
      icon: '✅'
    },
    follow_up: { 
      label: 'Follow-up', 
      color: 'bg-purple-100 text-purple-800 border-purple-300',
      icon: '↩️'
    },
  };
  
  const badge = config[phase];
  if (!badge) return null;
  
  return (
    <Badge variant="outline" className={badge.color}>
      {badge.icon} {badge.label}
    </Badge>
  );
}

// Helper function
function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString();
}
