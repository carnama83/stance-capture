// src/hooks/useStanceSubmission.ts
// Custom hook for submitting stances with Epic C phase tracking

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { getCampaignAttribution } from '@/lib/campaignAttribution';

interface UseStanceSubmissionOptions {
  questionId: string;
  /**
   * PR 2a — the exact rendition whose wording the respondent read.
   *
   * Required. It comes from the localized RPC that produced the question text
   * on screen and is recorded verbatim. Do NOT fall back to "whatever is
   * published" if it is missing: that fabricates a measurement against wording
   * the respondent may never have seen. If it is absent, the question is not
   * answerable and the caller should not offer a slider.
   */
  renditionId: string;
  onSuccess?: () => void;
  /**
   * Called when the server rejects the write because the rendition was
   * invalidated. The caller MUST discard the selected score and re-render the
   * current wording: a score is inseparable from the rendition it was chosen
   * against and is never transferred to different wording.
   */
  onRenditionInvalidated?: () => void;
}

interface StanceSubmissionResult {
  submitStance: (stanceValue: number) => Promise<unknown>;
  isSubmitting: boolean;
  error: Error | null;
}

/** Server error contract from set_question_stance(uuid, integer, uuid). */
const RENDITION_INVALIDATED = 'RENDITION_INVALIDATED';

export function useStanceSubmission({
  questionId,
  renditionId,
  onSuccess,
  onRenditionInvalidated,
}: UseStanceSubmissionOptions): StanceSubmissionResult {
  const supabase = getSupabase();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (stanceValue: number) => {
      if (!supabase) {
        throw new Error('Supabase client not available');
      }
      if (!renditionId) {
        throw new Error(
          'No rendition for this question — refusing to record a stance without provenance.'
        );
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;

      if (!userId) {
        throw new Error('You must be logged in to submit a stance');
      }

      // Epic EL-6: Election silence gate — check before ANY write
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
        if (e.message?.includes('silence') || e.message?.includes('electoral') || e.message?.includes('polling')) {
          throw e;
        }
        console.warn('EL-6 silence check unavailable, proceeding:', e.message);
      }

      // 1. Submit through the canonical RPC.
      //
      // This previously upserted question_stances directly, which omitted
      // rendition_id entirely — a NOT NULL column — so it would have failed
      // with 23502 had anything called it, and would have recorded a
      // measurement with no provenance had it succeeded. The RPC validates the
      // supplied rendition and never resolves one of its own.
      const { error: stanceError } = await supabase.rpc('set_question_stance', {
        p_question_id: questionId,
        p_score: stanceValue,
        p_rendition_id: renditionId,
      });

      if (stanceError) {
        throw stanceError;
      }

      // 2. Epic Y campaign attribution.
      //
      // Applied as a follow-up patch rather than folded into the RPC: the RPC's
      // job is the measurement and its provenance, and widening its signature
      // for marketing metadata would put two unrelated concerns in one
      // contract. The stance is already durably recorded if this fails.
      const attributedCampaignId = getCampaignAttribution(questionId);
      if (attributedCampaignId) {
        const { error: attrError } = await supabase
          .from('question_stances')
          .update({ campaign_id: attributedCampaignId, source: 'campaign' })
          .eq('user_id', userId)
          .eq('question_id', questionId);
        if (attrError) {
          console.error('Campaign attribution patch failed (stance was saved):', attrError);
        }
      }

      // 3. ✨ EPIC C: Record that user answered this question (for phase tracking)
      const { error: phaseError } = await supabase.rpc('record_question_answer', {
        p_user_id: userId,
        p_question_id: questionId,
      });

      if (phaseError) {
        // Log but don't fail - stance was saved successfully
        console.error('Failed to record question answer for phase tracking:', phaseError);
      }

      return { userId, stanceValue, renditionId };
    },

    onSuccess: () => {
      toast({
        title: 'Stance submitted',
        description: 'Your response has been recorded.',
      });

      queryClient.invalidateQueries({ queryKey: ['question', questionId] });
      queryClient.invalidateQueries({ queryKey: ['my-stances'] });
      queryClient.invalidateQueries({ queryKey: ['personalized-feed'] });

      onSuccess?.();
    },

    onError: (error: any) => {
      console.error('Stance submission error:', error);

      // The rendition was withdrawn as defective between render and submit.
      // The score is NOT saved and must NOT be carried over to the replacement
      // wording — the respondent has to read the new version and answer again.
      const isInvalidated =
        error?.code === '23514' && String(error?.message ?? '').includes(RENDITION_INVALIDATED);

      if (isInvalidated) {
        toast({
          title: 'A newer version of this question is available',
          description: 'Please read it and give your stance again.',
        });
        onRenditionInvalidated?.();
        return;
      }

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
    error: mutation.error as Error | null,
  };
}
