import { Button } from '@/components/ui/button';
import { useTopicFollow } from '@/hooks/useTopicFollow';
import { Bell, BellOff } from 'lucide-react';

interface FollowButtonProps {
  topicId: string;
  variant?: 'default' | 'outline';
}

export function FollowButton({ topicId, variant = 'outline' }: FollowButtonProps) {
  const { isFollowing, follow, unfollow, isLoading } = useTopicFollow(topicId);

  return (
    <Button
      variant={variant}
      size="sm"
      onClick={() => isFollowing ? unfollow() : follow()}
      disabled={isLoading}
    >
      {isFollowing ? (
        <>
          <BellOff className="h-4 w-4 mr-2" />
          Following
        </>
      ) : (
        <>
          <Bell className="h-4 w-4 mr-2" />
          Follow
        </>
      )}
    </Button>
  );
}
