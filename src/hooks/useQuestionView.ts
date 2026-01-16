import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

export function useQuestionView(questionId: string) {
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: () => supabase.auth.getSession(),
  });

  useEffect(() => {
    const userId = session?.data.session?.user.id;
    if (!questionId || !userId) return;

    const startTime = Date.now();

    // Track view on mount
    supabase.from('question_view_events').insert({
      user_id: userId,
      question_id: questionId,
      viewed_at: new Date().toISOString(),
    });

    // Track duration on unmount
    return () => {
      const duration = Math.floor((Date.now() - startTime) / 1000);
      if (duration > 2) { // Only track if viewed for more than 2 seconds
        supabase.from('question_view_events').insert({
          user_id: userId,
          question_id: questionId,
          viewed_at: new Date().toISOString(),
          duration_seconds: duration,
        });
      }
    };
  }, [questionId, session?.data.session?.user.id]);
}
