/**
 * Epic C - Topic Following Hook
 * Handles follow/unfollow operations for topics
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Check if user is following a topic
 */
export function useIsFollowing(topicId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['is-following', topicId, userId],
    queryFn: async () => {
      if (!topicId || !userId) return false;
      
      const { data, error } = await supabase
        .rpc('is_following_topic', {
          p_user_id: userId,
          p_topic_id: topicId,
        });
      
      if (error) throw error;
      return data as boolean;
    },
    enabled: !!topicId && !!userId,
  });
}

/**
 * Follow a topic
 */
export function useFollowTopic() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      userId, 
      topicId 
    }: { 
      userId: string; 
      topicId: string;
    }) => {
      const { error } = await supabase.rpc('follow_topic', {
        p_user_id: userId,
        p_topic_id: topicId,
      });
      
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      // Invalidate follow status
      queryClient.invalidateQueries({ 
        queryKey: ['is-following', variables.topicId] 
      });
      // Invalidate personalized feed (will show more from this topic)
      queryClient.invalidateQueries({ 
        queryKey: ['personalized-feed'] 
      });
    },
  });
}

/**
 * Unfollow a topic
 */
export function useUnfollowTopic() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      userId, 
      topicId 
    }: { 
      userId: string; 
      topicId: string;
    }) => {
      const { error } = await supabase.rpc('unfollow_topic', {
        p_user_id: userId,
        p_topic_id: topicId,
      });
      
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      // Invalidate follow status
      queryClient.invalidateQueries({ 
        queryKey: ['is-following', variables.topicId] 
      });
      // Invalidate personalized feed (will show fewer from this topic)
      queryClient.invalidateQueries({ 
        queryKey: ['personalized-feed'] 
      });
    },
  });
}

/**
 * Combined hook for follow/unfollow toggle
 */
export function useToggleFollow(topicId: string, userId: string | undefined) {
  const { data: isFollowing } = useIsFollowing(topicId, userId);
  const followMutation = useFollowTopic();
  const unfollowMutation = useUnfollowTopic();
  
  const toggle = async () => {
    if (!userId) return;
    
    if (isFollowing) {
      await unfollowMutation.mutateAsync({ userId, topicId });
    } else {
      await followMutation.mutateAsync({ userId, topicId });
    }
  };
  
  return {
    isFollowing: isFollowing ?? false,
    toggle,
    isLoading: followMutation.isPending || unfollowMutation.isPending,
  };
}
