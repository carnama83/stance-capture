
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QuestionCard } from './QuestionCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface FeedQuestion {
  question_id: string;
  topic_id: string;
  title: string;
  text: string;
  phase: string;
  state: string;
  published_at: string;
  is_trending: boolean;
  engagement_score: number;
  user_has_answered: boolean;
  topic_title: string;
  topic_tags: string[];
  relevance_score: number;
}

export function PersonalizedFeed() {
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: async () => supabase.auth.getSession(),
  });

  const { data: questions, isLoading, error } = useQuery({
    queryKey: ['personalized-feed', session?.data.session?.user.id],
    queryFn: async () => {
      if (!session?.data.session?.user.id) return [];
      
      const { data, error } = await supabase.rpc('get_personalized_feed', {
        p_user_id: session.data.session.user.id,
        p_limit: 20,
        p_offset: 0,
      });

      if (error) throw error;
      return data as FeedQuestion[];
    },
    enabled: !!session?.data.session?.user.id,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Failed to load your personalized feed. Please try again.
        </AlertDescription>
      </Alert>
    );
  }

  if (!questions || questions.length === 0) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          No new questions for you right now
        </h3>
        <p className="text-gray-600">
          Check back later or explore topics to follow.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Your Feed</h2>
        <span className="text-sm text-gray-500">
          {questions.length} questions
        </span>
      </div>

      <div className="space-y-4">
        {questions.map((question) => (
          <QuestionCard
            key={question.question_id}
            question={question}
            showTopicTitle={true}
            showPhaseIndicator={true}
          />
        ))}
      </div>
    </div>
  );
}
