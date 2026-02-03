// src/components/FollowTopicButton.tsx
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

interface FollowTopicButtonProps {
  topicId: string;
  size?: "sm" | "md";
}

export function FollowTopicButton({
  topicId,
  size = "sm",
}: FollowTopicButtonProps) {
  const [isFollowing, setIsFollowing] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  // --- Load initial follow state
  useEffect(() => {
    let isMounted = true;

    async function load() {
      const { data, error } = await supabase.rpc(
        "topic_is_following",
        { p_topic_id: topicId }
      );

      if (!isMounted) return;

      if (error) {
        console.error("topic_is_following error", error);
        setIsFollowing(false);
        return;
      }

      setIsFollowing(Boolean(data));
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [topicId]);

  async function handleToggle() {
    if (isFollowing === null) return;

    setLoading(true);

    const rpcName = isFollowing ? "topic_unfollow" : "topic_follow";

    const { error } = await supabase.rpc(rpcName, {
      p_topic_id: topicId,
    });

    if (error) {
      console.error(`${rpcName} error`, error);
      toast({
        title: "Action failed",
        description: "Please try again.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    setIsFollowing(!isFollowing);
    setLoading(false);
  }

  // --- While loading initial state, render nothing (avoids flicker)
  if (isFollowing === null) return null;

  return (
    <Button
      size={size}
      variant={isFollowing ? "secondary" : "default"}
      onClick={handleToggle}
      disabled={loading}
    >
      {isFollowing ? "Following" : "Follow"}
    </Button>
  );
}
