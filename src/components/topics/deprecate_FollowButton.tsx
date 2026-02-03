/**
 * Epic C - Follow Button Component
 * Allows users to follow/unfollow topics
 */

import { Button } from '@/components/ui/button';
import { useFollowTopic, useUnfollowTopic, useIsFollowing } from '@/hooks/useTopicFollow';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Heart, HeartOff, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface FollowButtonProps {
  topicId: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  showLabel?: boolean;
}

export function FollowButton({ 
  topicId, 
  variant = 'outline',
  size = 'default',
  showLabel = true,
}: FollowButtonProps) {
  const { toast } = useToast();
  
  // Get current user
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: () => supabase.auth.getSession(),
  });
  
  const userId = session?.data.session?.user.id;
  
  // Check if following
  const { data: isFollowing, isLoading: isCheckingFollow } = useIsFollowing(topicId, userId);
  
  // Mutations
  const followMutation = useFollowTopic();
  const unfollowMutation = useUnfollowTopic();
  
  const isLoading = isCheckingFollow || followMutation.isPending || unfollowMutation.isPending;
  
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigation if button is inside a link
    e.stopPropagation();
    
    if (!userId) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to follow topics',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      if (isFollowing) {
        await unfollowMutation.mutateAsync({ userId, topicId });
        toast({
          title: 'Unfollowed',
          description: 'You will see fewer questions from this topic',
        });
      } else {
        await followMutation.mutateAsync({ userId, topicId });
        toast({
          title: 'Following!',
          description: 'You will see more questions from this topic in your feed',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update following status',
        variant: 'destructive',
      });
    }
  };
  
  // Don't show button if user is not logged in
  if (!userId) return null;
  
  return (
    <Button
      variant={isFollowing ? 'default' : variant}
      size={size}
      onClick={handleClick}
      disabled={isLoading}
      className="gap-2"
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isFollowing ? (
        <>
          <Heart className="h-4 w-4 fill-current" />
          {showLabel && 'Following'}
        </>
      ) : (
        <>
          <HeartOff className="h-4 w-4" />
          {showLabel && 'Follow'}
        </>
      )}
    </Button>
  );
}
