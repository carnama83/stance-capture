// src/hooks/useTailoredFeed.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient"; // adjust path if different

export interface LiveQuestion {
  id: string;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  published_at: string; // ISO string
  status: string;
}

interface UseTailoredFeedOptions {
  limit?: number;
  userId?: string | null; // pass your authed user id if available
}

async function fetchTailoredFeed({
  limit = 20,
  userId,
}: UseTailoredFeedOptions): Promise<LiveQuestion[]> {
  // Logged-in user → use RPC get_tailored_feed
  if (userId) {
    const { data, error } = await supabase.rpc("get_tailored_feed", {
      p_user_id: userId,
      p_limit: limit,
    });

    if (error) {
      console.error("get_tailored_feed error", error);
      throw error;
    }

    // RPC returns rows from v_live_questions
    return (data ?? []) as LiveQuestion[];
  }

  // Anonymous user → simple latest from v_live_questions
  const { data, error } = await supabase
    .from("v_live_questions")
    .select("id, question, summary, tags, location_label, published_at, status")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("v_live_questions fetch error", error);
    throw error;
  }

  return (data ?? []) as LiveQuestion[];
}

export function useTailoredFeed(options: UseTailoredFeedOptions = {}) {
  const { limit = 20, userId } = options;

  const query = useQuery<LiveQuestion[], Error>({
    queryKey: ["tailored-feed", { limit, userId: userId ?? null }],
    queryFn: () => fetchTailoredFeed({ limit, userId }),
    staleTime: 60_000, // 1 minute
  });

  return {
    questions: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
