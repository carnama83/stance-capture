// src/components/FollowTopicButton.tsx
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { Check, Plus, Loader2 } from "lucide-react";

interface FollowTopicButtonProps {
  topicId: string;
  variant?: "default" | "compact";
  className?: string;
}

async function getFollowedTopics() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb.rpc("get_followed_topics").single();

  if (error) throw error;
  return data;
}

async function followTopic(topicId: string) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .rpc("follow_topic", { p_topic_id: topicId })
    .single();

  if (error) throw error;
  return data;
}

async function unfollowTopic(topicId: string) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .rpc("unfollow_topic", { p_topic_id: topicId })
    .single();

  if (error) throw error;
  return data;
}

export function FollowTopicButton({
  topicId,
  variant = "default",
  className = "",
}: FollowTopicButtonProps) {
  const queryClient = useQueryClient();

  // Check if topic is followed
  const { data: followedData } = useQuery({
    queryKey: ["followed-topics"],
    queryFn: getFollowedTopics,
    staleTime: 60_000,
  });

  const isFollowing = React.useMemo(() => {
    if (!followedData?.followed_topics) return false;
    return followedData.followed_topics.some(
      (t: { topic_id: string }) => t.topic_id === topicId
    );
  }, [followedData, topicId]);

  // Follow mutation
  const followMutation = useMutation({
    mutationFn: () => followTopic(topicId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followed-topics"] });
      queryClient.invalidateQueries({ queryKey: ["for-you-feed"] });
    },
  });

  // Unfollow mutation
  const unfollowMutation = useMutation({
    mutationFn: () => unfollowTopic(topicId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followed-topics"] });
      queryClient.invalidateQueries({ queryKey: ["for-you-feed"] });
    },
  });

  const handleClick = () => {
    if (isFollowing) {
      unfollowMutation.mutate();
    } else {
      followMutation.mutate();
    }
  };

  const isLoading = followMutation.isPending || unfollowMutation.isPending;

  if (variant === "compact") {
    return (
      <button
        onClick={handleClick}
        disabled={isLoading}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          isFollowing
            ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        } disabled:opacity-50 ${className}`}
      >
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isFollowing ? (
          <Check className="h-3 w-3" />
        ) : (
          <Plus className="h-3 w-3" />
        )}
        {isFollowing ? "Following" : "Follow"}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        isFollowing
          ? "bg-blue-600 text-white hover:bg-blue-700"
          : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
      } disabled:opacity-50 ${className}`}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isFollowing ? (
        <Check className="h-4 w-4" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
      {isFollowing ? "Following" : "Follow Topic"}
    </button>
  );
}
