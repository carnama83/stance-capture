/**
 * Question Lifecycle System - React Hooks (CORRECTED)
 * 
 * Updated to match your actual schema:
 * - Uses public schema explicitly
 * - Handles both status and state fields
 * - admin_users uses user_id
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  QuestionState,
  QuestionWithLifecycle,
  QuestionFilters,
  QuestionSortOptions,
  EngagementStats,
  TrendingQuestion,
  LifecycleSummary,
} from '@/types/questionLifecycleTypes';

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Fetch questions by state(s)
 */
export function useQuestionsByState(
  states: QuestionState | QuestionState[],
  options?: {
    limit?: number;
    sortBy?: QuestionSortOptions;
  }
) {
  const stateArray = Array.isArray(states) ? states : [states];
  
  return useQuery({
    queryKey: ['questions', 'by-state', stateArray, options],
    queryFn: async () => {
      let query = supabase
        .from('questions')
        .select(`
          *,
          engagement:question_engagement_metrics(*)
        `)
        .in('state', stateArray);
      
      // Apply sorting
      if (options?.sortBy) {
        query = query.order(options.sortBy.by, { 
          ascending: options.sortBy.direction === 'asc' 
        });
      } else {
        // Default: newest first
        query = query.order('published_at', { ascending: false });
      }
      
      // Apply limit
      if (options?.limit) {
        query = query.limit(options.limit);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data as unknown as QuestionWithLifecycle[];
    },
  });
}

/**
 * Fetch active questions (NEW + ACTIVE states)
 */
export function useActiveQuestions(limit = 20) {
  return useQuestionsByState(['new', 'active'], { limit });
}

/**
 * Fetch new questions (last 24h)
 */
export function useNewQuestions(limit = 10) {
  return useQuestionsByState('new', { limit });
}

/**
 * Fetch trending questions
 */
export function useTrendingQuestions(limit = 10) {
  return useQuery({
    queryKey: ['questions', 'trending', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_trending_questions_v3', {  // ✅ NEW
  p_user_id: null,
  p_location_tier: 'global',
  p_limit: limit,
});
      
      if (error) throw error;
      return data as TrendingQuestion[];
    },
    // Refetch more frequently for trending
    refetchInterval: 60000, // Every minute
  });
}

/**
 * Fetch featured questions
 */
export function useFeaturedQuestions(limit = 5) {
  return useQuery({
    queryKey: ['questions', 'featured', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('is_featured', true)
        .order('featured_at', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      return data as unknown as QuestionWithLifecycle[];
    },
  });
}

/**
 * Fetch questions with advanced filters
 */
export function useFilteredQuestions(filters: QuestionFilters, options?: {
  limit?: number;
  sortBy?: QuestionSortOptions;
}) {
  return useQuery({
    queryKey: ['questions', 'filtered', filters, options],
    queryFn: async () => {
      let query = supabase
        .from('question_lifecycle_summary')
        .select('*');
      
      // Apply filters
      if (filters.states && filters.states.length > 0) {
        query = query.in('state', filters.states);
      }
      
      if (filters.is_trending !== undefined) {
        query = query.eq('is_trending', filters.is_trending);
      }
      
      if (filters.is_featured !== undefined) {
        query = query.eq('is_featured', filters.is_featured);
      }
      
      if (filters.is_resolved !== undefined) {
        query = query.eq('is_resolved', filters.is_resolved);
      }
      
      if (filters.min_age_days !== undefined) {
        query = query.gte('age_days', filters.min_age_days);
      }
      
      if (filters.max_age_days !== undefined) {
        query = query.lte('age_days', filters.max_age_days);
      }
      
      if (filters.min_response_rate !== undefined) {
        query = query.gte('response_rate_24h', filters.min_response_rate);
      }
      
      // Apply sorting
      if (options?.sortBy) {
        query = query.order(options.sortBy.by, { 
          ascending: options.sortBy.direction === 'asc' 
        });
      }
      
      // Apply limit
      if (options?.limit) {
        query = query.limit(options.limit);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data as LifecycleSummary[];
    },
  });
}

/**
 * Fetch engagement stats for a specific question
 */
export function useEngagementStats(questionId: string) {
  return useQuery({
    queryKey: ['engagement-stats', questionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_engagement_stats', {
          p_question_id: questionId,
        })
        .single();
      
      if (error) throw error;
      return data as EngagementStats;
    },
    enabled: !!questionId,
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

/**
 * Fetch state history for a question
 */
export function useQuestionStateHistory(questionId: string) {
  return useQuery({
    queryKey: ['state-history', questionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('question_state_history')
        .select('*')
        .eq('question_id', questionId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!questionId,
  });
}

/**
 * Fetch single question with lifecycle data
 */
export function useQuestionWithLifecycle(questionId: string) {
  return useQuery({
    queryKey: ['question', 'lifecycle', questionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('questions')
        .select(`
          *,
          engagement:question_engagement_metrics(*)
        `)
        .eq('id', questionId)
        .single();
      
      if (error) throw error;
      return data as unknown as QuestionWithLifecycle;
    },
    enabled: !!questionId,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Manually update question state (admin only)
 */
export function useUpdateQuestionState() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      questionId,
      reason = 'manual_update',
    }: {
      questionId: string;
      reason?: string;
    }) => {
      const { data, error } = await supabase
        .rpc('update_question_state', {
          p_question_id: questionId,
          p_reason: reason,
        });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      // Invalidate queries
      queryClient.invalidateQueries({ 
        queryKey: ['question', 'lifecycle', variables.questionId] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ['questions'] 
      });
    },
  });
}

/**
 * Archive question manually (admin only)
 */
export function useArchiveQuestion() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      questionId,
      reason,
      adminUserId, // Note: This is user_id from admin_users table
    }: {
      questionId: string;
      reason: string;
      adminUserId?: string;
    }) => {
      const { data, error } = await supabase
        .rpc('manually_archive_question', {
          p_question_id: questionId,
          p_reason: reason,
          p_admin_id: adminUserId,
        });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ['question', 'lifecycle', variables.questionId] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ['questions'] 
      });
    },
  });
}

/**
 * Mark question as resolved (Epic R integration)
 */
export function useMarkQuestionResolved() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      questionId,
      resolutionSummary,
    }: {
      questionId: string;
      resolutionSummary?: string;
    }) => {
      const { data, error } = await supabase
        .rpc('mark_question_resolved', {
          p_question_id: questionId,
          p_resolution_summary: resolutionSummary,
        });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ['question', 'lifecycle', variables.questionId] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ['questions'] 
      });
    },
  });
}

/**
 * Record major update to question
 */
export function useRecordMajorUpdate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      questionId,
      updateReason = 'content_updated',
    }: {
      questionId: string;
      updateReason?: string;
    }) => {
      const { data, error } = await supabase
        .rpc('record_major_update', {
          p_question_id: questionId,
          p_update_reason: updateReason,
        });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ['question', 'lifecycle', variables.questionId] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ['questions'] 
      });
    },
  });
}

/**
 * Toggle featured status (admin only)
 */
export function useToggleFeatured() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      questionId,
      isFeatured,
      featuredByUserId, // Note: This is user_id from admin_users table
      featuredReason,
    }: {
      questionId: string;
      isFeatured: boolean;
      featuredByUserId?: string;
      featuredReason?: string;
    }) => {
      const { data, error } = await supabase
        .from('questions')
        .update({
          is_featured: isFeatured,
          featured_at: isFeatured ? new Date().toISOString() : null,
          featured_by: isFeatured ? featuredByUserId : null,
          featured_reason: isFeatured ? featuredReason : null,
        })
        .eq('id', questionId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ['question', 'lifecycle', variables.questionId] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ['questions', 'featured'] 
      });
    },
  });
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Subscribe to real-time state changes for a question
 */
export function useQuestionStateSubscription(questionId: string) {
  const queryClient = useQueryClient();
  
  useEffect(() => {
    if (!questionId) return;
    
    const channel = supabase
      .channel(`question-${questionId}-state`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'questions',
          filter: `id=eq.${questionId}`,
        },
        () => {
          // Invalidate queries when state changes
          queryClient.invalidateQueries({ 
            queryKey: ['question', 'lifecycle', questionId] 
          });
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [questionId, queryClient]);
}

/**
 * Get lifecycle config
 */
export function useLifecycleConfig() {
  return useQuery({
    queryKey: ['lifecycle-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('question_lifecycle_config')
        .select('*')
        .is('topic_category', null)
        .is('region_tier', null)
        .single();
      
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Batch update all question states (admin only - for testing)
 */
export function useBatchUpdateStates() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .rpc('update_all_question_states');
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Invalidate all question queries
      queryClient.invalidateQueries({ 
        queryKey: ['questions'] 
      });
    },
  });
}

/**
 * Manually trigger trending detection (admin only - for testing)
 */
export function useUpdateTrendingFlags() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .rpc('update_trending_flags');
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ['questions'] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ['questions', 'trending'] 
      });
    },
  });
}
