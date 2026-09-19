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
  // PR 2a: the exact rendition this row's `question` text came from. Travels
  // with the row to the stance write; never substituted if absent.
  rendition_id: string | null;
}

interface UseTailoredFeedOptions {
  limit?: number;
  userId?: string | null; // pass your authed user id if available
  languageCode?: string;
}

async function fetchTailoredFeed({
  limit = 20,
  userId,
  languageCode = "en",
}: UseTailoredFeedOptions): Promise<LiveQuestion[]> {
  // Logged-in user → use RPC get_tailored_feed
  if (userId) {
    const { data, error } = await supabase.rpc("get_tailored_feed", {
      p_user_id: userId,
      p_limit: limit,
      p_language_code: languageCode,
    });

    if (error) {
      console.error("get_tailored_feed error", error);
      throw error;
    }

    return (data ?? []) as LiveQuestion[];
  }

  // Anonymous user → the LOCALIZED latest feed.
  //
  // This used to select straight from v_live_questions. That view carries the
  // canonical English wording and no rendition at all, so anonymous readers got
  // English regardless of the language they had chosen, and any stance they
  // went on to record had no observed provenance to report. Both are fixed by
  // going through the same wording_for()-backed RPC the rest of the feeds use.
  const { data, error } = await supabase.rpc("get_live_questions_localized", {
    p_language_code: languageCode,
    p_limit: limit,
    p_offset: 0,
    p_region_label: "Global",
    p_exclude_country_label: null,
  });

  if (error) {
    console.error("get_live_questions_localized error", error);
    throw error;
  }

  return (data ?? []) as LiveQuestion[];
}

export function useTailoredFeed(options: UseTailoredFeedOptions = {}) {
  const { limit = 20, userId, languageCode = "en" } = options;

  const query = useQuery<LiveQuestion[], Error>({
    // languageCode is part of the key: the RPC returns localized wording, so
    // two languages are two different results and must not share a cache entry.
    queryKey: ["tailored-feed", { limit, userId: userId ?? null, languageCode }],
    queryFn: () => fetchTailoredFeed({ limit, userId, languageCode }),
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
