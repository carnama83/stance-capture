/**
 * Epic C - Personalized Feed Component (CORRECTED VERSION)
 * Shows questions tailored to user's location and followed topics
 */

import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabaseClient'; // Match your project's import
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { STATE_LABELS, formatTimeAgo, type FeedQuestion } from '@/types/feedTypes';
import { MessageSquare, TrendingUp } from 'lucide-react';

export function PersonalizedFeed() {
  // Get current user - using same pattern as QuestionDetailPage
  const supabase = getSupabase();
  
  const { data: sessionData } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });
  
  const userId = sessionData?.session?.user?.id;
  
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
        console.error('Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }
      
      console.log('✅ Personalized feed data:', data);
      return data as FeedQuestion[];
    },
    enabled: !!userId && !!supabase,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1, // Only retry once
  });
  
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
  
  if (!userId) {
    return (
      <Card className="p-8 text-center">
        <p className="text-gray-600 mb-4">
          Sign in to see your personalized feed
        </p>
        <p className="text-sm text-gray-500">
          Your feed will show questions based on your location and topics you follow
        </p>
      </Card>
    );
  }
  
  if (!questions || questions.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-gray-600 mb-4">
          No questions match your preferences yet.
        </p>
        <p className="text-sm text-gray-500">
          Try following some topics or check back later!
        </p>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4">
      {questions.map((question) => (
        <QuestionFeedCard key={question.question_id} question={question} />
      ))}
    </div>
  );
}

function QuestionFeedCard({ question }: { question: FeedQuestion }) {
  const stateConfig = STATE_LABELS[question.state];
  
  return (
    <Link to={`/q/${question.question_id}`}>
      <Card className={`p-6 hover:shadow-lg transition-all duration-200 cursor-pointer ${
        question.user_has_answered ? 'bg-gray-50 border-gray-300' : 'bg-white'
      }`}>
        
        {/* Header with badges */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {question.state === 'new' && (
            <span className={`px-2 py-1 text-xs font-semibold rounded border ${stateConfig.color}`}>
              {stateConfig.icon} {stateConfig.label}
            </span>
          )}
          
          {question.is_trending && (
            <span className="flex items-center gap-1 text-orange-600 text-sm font-medium px-2 py-1 bg-orange-50 rounded border border-orange-200">
              <TrendingUp className="h-4 w-4" />
              Trending
            </span>
          )}
          
          {question.user_has_answered && (
            <span className="text-xs text-gray-600 bg-green-50 px-2 py-1 rounded border border-green-200">
              ✓ Answered
            </span>
          )}
          
          <span className="text-xs text-gray-500 ml-auto">
            {formatTimeAgo(question.published_at)}
          </span>
        </div>
        
        {/* Topic */}
        <div className="text-sm text-gray-600 mb-2">
          📁 {question.topic_title}
        </div>
        
        {/* Question */}
        <h3 className="text-lg font-semibold mb-2 text-gray-900 hover:text-blue-600 transition-colors">
          {question.question}
        </h3>
        
        {/* Summary */}
        {question.summary && (
          <p className="text-sm text-gray-700 mb-3 line-clamp-2">
            {question.summary}
          </p>
        )}
        
        {/* Footer */}
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-4 w-4" />
            {question.response_count} {question.response_count === 1 ? 'response' : 'responses'}
          </span>
          
          {question.tags && question.tags.length > 0 && (
            <div className="flex gap-1 ml-auto">
              {question.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="bg-gray-100 px-2 py-0.5 rounded text-xs">
                  {tag}
                </span>
              ))}
              {question.tags.length > 3 && (
                <span className="text-xs text-gray-500">
                  +{question.tags.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
