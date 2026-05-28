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

      // Epic EL-6: Election silence gate — check before ANY write
      // Calls check_election_silence(question_id) which returns HTTP 451
      // if the election is in SILENCE or POLLING state.
      // Non-election questions return { allowed: true } immediately.
      try {
        const { data: silenceCheck } = await supabase.rpc('check_election_silence', {
          p_question_id: questionId,
        });
        if (silenceCheck && silenceCheck.allowed === false) {
          if (silenceCheck.http_code === 451) {
            throw new Error(
              silenceCheck.message ??
              'Stance submission is suspended during the electoral silence period.'
            );
          }
          if (silenceCheck.http_code === 423) {
            throw new Error(
              silenceCheck.message ??
              'This election has not yet opened for stance submission.'
            );
          }
        }
      } catch (e: any) {
        // Re-throw silence errors directly; swallow RPC-not-found errors
        // (non-election questions on pre-EL instances won't have the RPC)
        if (e.message?.includes('silence') || e.message?.includes('electoral') || e.message?.includes('polling')) {
          throw e;
        }
        // Otherwise: RPC missing or network error — allow submission to proceed
        console.warn('EL-6 silence check unavailable, proceeding:', e.message);
      }

      // 1. Submit the stance via the canonical RPC (matches set_question_stance in DB)
      const { error: stanceError } = await supabase
        .from('question_stances')
        .upsert(
          {
            user_id: userId,
            question_id: questionId,
            score: stanceValue,          // ← DB column is 'score', not 'stance_value'
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

      const isSilence =
        error.message?.includes('silence') ||
        error.message?.includes('electoral') ||
        error.message?.includes('polling');

      toast({
        title: isSilence ? 'Submission paused' : 'Failed to submit stance',
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
