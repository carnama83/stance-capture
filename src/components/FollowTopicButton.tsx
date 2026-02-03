// src/components/FollowTopicButton.tsx
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
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

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const sb = getSupabase();
      if (!sb) return;

      const { data, error } = await sb.rpc("topic_is_following", {
        p_topic_id: topicId,
      });

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
    const sb = getSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }

    const rpcName = isFollowing ? "topic_unfollow" : "topic_follow";

    const { error } = await sb.rpc(rpcName, {
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
