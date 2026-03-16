/**
 * Epic C - Personalized Feed Component (PHASE-AWARE VERSION)
 * Shows questions tailored to user's location and followed topics
 * ✨ NOW WITH: Phase-aware re-exposure tracking + QuestionPhaseBadge component
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
import { QuestionPhaseBadge } from '@/components/question/QuestionPhaseBadge'; // ✨ NEW IMPORT
import { QuestionCoverImage } from '@/components/question/QuestionCoverImage';

// ✨ Extended type with phase information (already has phase and is_new_phase)
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
  phase: string;  // ✅ Already present
  is_new_phase: boolean;  // ✅ Already present
  cover_image_url?: string | null;
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
  
  // ✨ Mutation to record question views
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
  
  // ✨ Record views for all questions in viewport
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
          <Card className="p-6 hover:shadow-lg transition-shadow overflow-hidden">
            <QuestionCoverImage
              imageUrl={q.cover_image_url}
              tags={q.tags ?? q.topic_tags}
              variant="banner"
              bannerHeight={90}
            />
            {/* ✨ UPDATED: Header with badges - New layout */}
            <div className="flex items-start justify-between gap-3 mb-3">
              {/* Left: Title and topic */}
              <div className="flex-1 min-w-0">
                {/* Topic title */}
                <div className="text-xs text-slate-500 mb-1">
                  {q.topic_title}
                </div>
                
                {/* Question */}
                <h3 className="text-lg font-semibold text-slate-900 mb-2">
                  {q.question}
                </h3>
              </div>
              
              {/* ✨ NEW: Right-aligned badges column */}
              <div className="flex flex-col gap-1.5 items-end shrink-0">
                {/* ✨ NEW: Phase Badge using QuestionPhaseBadge component */}
                {q.phase && q.phase !== 'initial' && (
                  <QuestionPhaseBadge phase={q.phase} size="sm" />
                )}
                
                {/* ✨ NEW: New Phase Badge (special highlight) */}
                {q.is_new_phase && (
                  <Badge variant="default" className="bg-blue-600 text-xs">
                    <Sparkles className="h-3 w-3 mr-1" />
                    New Update
                  </Badge>
                )}
                
                {/* State Badge */}
                {q.state === 'new' && (
                  <Badge variant="secondary" className="text-xs">
                    🆕 New
                  </Badge>
                )}
                
                {/* Trending Badge */}
                {q.is_trending && (
                  <Badge variant="outline" className="border-orange-300 text-orange-700 text-xs">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    Trending
                  </Badge>
                )}
              </div>
            </div>
            
            {/* Summary */}
            {q.summary && (
              <p className="text-sm text-slate-600 mb-4 line-clamp-2">
                {q.summary}
              </p>
            )}
            
            {/* Tags */}
            {q.tags && q.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {q.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            
            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {q.response_count} {q.response_count === 1 ? 'stance recorded' : 'stances recorded'}
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
