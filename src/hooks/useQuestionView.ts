/**
 * Epic C - Question View Tracking Hook (FIXED)
 * Automatically tracks when users view questions and for how long
 * Matches your project's session handling pattern
 */

import { useEffect } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { useQuery } from '@tanstack/react-query';

export function useQuestionView(questionId: string | undefined) {
  const supabase = getSupabase();
  
  // Use the same session pattern as QuestionDetailPage
  const { data: sessionData } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  useEffect(() => {
    // Get userId from the session data structure
    const userId = sessionData?.session?.user?.id;
    
    // Don't track if no question ID or no user
    if (!questionId || !userId || !supabase) return;

    const startTime = Date.now();
    let tracked = false;

    // Track view on mount (fire and forget - don't await)
    const trackInitialView = async () => {
      try {
        await supabase.from('question_view_events').insert({
          user_id: userId,
          question_id: questionId,
          viewed_at: new Date().toISOString(),
        });
        tracked = true;
      } catch (error) {
        console.error('Failed to track question view:', error);
      }
    };

    trackInitialView();

    // Track duration on unmount
    return () => {
      if (!tracked || !userId) return;
      
      const duration = Math.floor((Date.now() - startTime) / 1000);
      
      // Only track duration if viewed for more than 2 seconds
      if (duration > 2) {
        // Fire and forget - don't await
        supabase.from('question_view_events').insert({
          user_id: userId,
          question_id: questionId,
          viewed_at: new Date().toISOString(),
          duration_seconds: duration,
        }).catch(err => {
          console.error('Failed to track question view duration:', err);
        });
      }
    };
  }, [questionId, sessionData?.session?.user?.id, supabase]);
}
