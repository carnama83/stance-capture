// src/hooks/useCognitiveState.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CognitiveProfile {
  overall_orientation: {
    mean_stance: number;
    median_stance: number;
    stance_variance: number;
    total_questions: number;
    active_topics: number;
  };
  topic_profiles: {
    [topicId: string]: {
      topic_id: string;
      topic_name: string;
      mean_stance: number;
      median_stance: number;
      question_count: number;
      consistency_score: number;
      last_updated: string;
      stance_distribution: {
        strong_disagree: number;
        disagree: number;
        neutral: number;
        agree: number;
        strong_agree: number;
      };
    };
  };
  stance_distribution: {
    strong_disagree: number;
    disagree: number;
    neutral: number;
    agree: number;
    strong_agree: number;
  };
  engagement_patterns: {
    first_stance_at: string;
    last_stance_at: string;
    questions_per_week: number;
  };
  computed_at: string;
  evaluation_period_days: number;
}

export interface CognitiveState {
  id: string;
  user_id: string;
  evaluated_at: string;
  evaluation_period_start: string;
  evaluation_period_end: string;
  cognitive_profile: CognitiveProfile;
  overall_mean_stance: number;
  overall_median_stance: number;
  stance_consistency_score: number;
  total_questions_answered: number;
  active_topic_count: number;
  prior_state_id: string | null;
  state_status: 'current' | 'historical' | 'computing';
  created_at: string;
}

/**
 * Hook to fetch current cognitive state for authenticated user
 */
export function useCognitiveState() {
  return useQuery({
    queryKey: ['cognitive-state', 'current'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('user_cognitive_states')
        .select('*')
        .eq('user_id', user.id)
        .eq('state_status', 'current')
        .order('evaluated_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data as CognitiveState | null;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch cognitive state history
 */
export function useCognitiveStateHistory(limit = 10) {
  return useQuery({
    queryKey: ['cognitive-state', 'history', limit],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('user_cognitive_states')
        .select('*')
        .eq('user_id', user.id)
        .order('evaluated_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data as CognitiveState[];
    },
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Hook to manually trigger cognitive state calculation
 */
export function useCalculateCognitiveState() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (evaluationPeriodDays = 90) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.rpc('calculate_cognitive_state', {
        p_user_id: user.id,
        p_evaluation_period_days: evaluationPeriodDays,
      });

      if (error) throw error;

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive-state'] });
    },
  });
}

/**
 * Hook to check if cognitive state needs recalculation
 */
export function useShouldRecalculateCognitiveState() {
  return useQuery({
    queryKey: ['cognitive-state', 'should-recalculate'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { data, error } = await supabase.rpc('should_recalculate_cognitive_state', {
        p_user_id: user.id,
      });

      if (error) throw error;

      return data as boolean;
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Helper function to format stance value for display
 */
export function formatStanceValue(value: number): string {
  if (value >= 1.5) return 'Strongly Agree';
  if (value >= 0.5) return 'Agree';
  if (value >= -0.5) return 'Neutral';
  if (value >= -1.5) return 'Disagree';
  return 'Strongly Disagree';
}

/**
 * Helper function to get stance color
 */
export function getStanceColor(value: number): string {
  if (value >= 1.5) return 'text-green-600';
  if (value >= 0.5) return 'text-green-500';
  if (value >= -0.5) return 'text-gray-500';
  if (value >= -1.5) return 'text-red-500';
  return 'text-red-600';
}

/**
 * Helper function to get topic profile from cognitive state
 */
export function getTopicProfile(state: CognitiveState | null, topicId: string) {
  if (!state) return null;
  return state.cognitive_profile.topic_profiles[topicId] || null;
}
