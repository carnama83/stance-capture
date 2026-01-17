// src/hooks/useStanceSubmission.ts
// Custom hook for submitting stances with Epic C phase tracking

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabaseClient';
import { useToast } from '@/hooks/use-toast';

interface UseStanceSubmissionOptions {
  questionId: string;
  onSuccess?: () => void;
}

interface StanceSubmissionResult {
  submitStance: (stanceValue: number) => Promise<void>;
  isSubmitting: boolean;
  error: Error | null;
}

/**
 * Hook for submitting question stances with Epic C phase tracking
 * 
 * @example
 * const { submitStance, isSubmitting } = useStanceSubmission({
 *   questionId: 'abc-123',
 *   onSuccess: () => console.log('Stance saved!')
 * });
 * 
 * // Use in QuestionStanceSlider
 * <QuestionStanceSlider
 *   onSubmit={submitStance}
 *   disabled={isSubmitting}
 * />
 */
export function useStanceSubmission({
  questionId,
  onSuccess,
}: UseStanceSubmissionOptions): StanceSubmissionResult {
  const supabase = getSupabase();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (stanceValue: number) => {
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      // Get current user
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;

      if (!userId) {
        throw new Error('You must be logged in to submit a stance');
      }

      // 1. Submit the stance
      const { error: stanceError } = await supabase
        .from('question_stances')
        .upsert(
          {
            user_id: userId,
            question_id: questionId,
            stance_value: stanceValue,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id,question_id',
          }
        );

      if (stanceError) {
        throw stanceError;
      }

      // 2. ✨ EPIC C: Record that user answered this question (for phase tracking)
      // This updates user_topic_interactions with the current phase
      const { error: phaseError } = await supabase.rpc('record_question_answer', {
        p_user_id: userId,
        p_question_id: questionId,
      });

      if (phaseError) {
        // Log but don't fail - stance was saved successfully
        console.error('Failed to record question answer for phase tracking:', phaseError);
      }

      return { userId, stanceValue };
    },

    onSuccess: () => {
      toast({
        title: 'Stance submitted',
        description: 'Your response has been recorded.',
      });

      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['question', questionId] });
      queryClient.invalidateQueries({ queryKey: ['my-stances'] });
      queryClient.invalidateQueries({ queryKey: ['personalized-feed'] }); // ✨ NEW for Epic C
      
      // Call optional success callback
      onSuccess?.();
    },

    onError: (error: Error) => {
      console.error('Stance submission error:', error);
      
      toast({
        title: 'Failed to submit stance',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    submitStance: mutation.mutateAsync,
    isSubmitting: mutation.isPending,
    error: mutation.error,
  };
}
