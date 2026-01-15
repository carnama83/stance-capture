import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useTopicFollow(topicId: string) {
  const queryClient = useQueryClient();

  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: () => supabase.auth.getSession(),
  });

  const userId = session?.data.session?.user.id;

  const { data: isFollowing } = useQuery({
    queryKey: ['topic-follow', topicId, userId],
    queryFn: async () => {
      if (!userId) return false;
      
      const { data } = await supabase
        .from('user_follows')
        .select('id')
        .eq('user_id', userId)
        .eq('follow_type', 'topic')
        .eq('follow_id', topicId)
        .single();
      
      return !!data;
    },
    enabled: !!userId,
  });

  const followMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not authenticated');
      
      const { error } = await supabase.rpc('follow_topic', {
        p_user_id: userId,
        p_topic_id: topicId,
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topic-follow', topicId] });
      queryClient.invalidateQueries({ queryKey: ['personalized-feed'] });
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not authenticated');
      
      const { error } = await supabase.rpc('unfollow_topic', {
        p_user_id: userId,
        p_topic_id: topicId,
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topic-follow', topicId] });
      queryClient.invalidateQueries({ queryKey: ['personalized-feed'] });
    },
  });

  return {
    isFollowing: !!isFollowing,
    follow: followMutation.mutate,
    unfollow: unfollowMutation.mutate,
    isLoading: followMutation.isPending || unfollowMutation.isPending,
  };
}
