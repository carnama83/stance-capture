// src/hooks/useMyLatestWeeklyDigest.ts
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabaseClient';
import {
  type LatestWeeklyDigest,
  type RawWeeklyDigest,
  mapWeeklyDigest,
} from './notificationTypes';

export type { LatestWeeklyDigest };

interface UseMyLatestWeeklyDigestResult {
  data: LatestWeeklyDigest | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useMyLatestWeeklyDigest(
  enabled: boolean = true
): UseMyLatestWeeklyDigestResult {
  const result = useQuery<LatestWeeklyDigest | null, Error>({
    queryKey: ['my-latest-weekly-digest'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase client not available');

      const { data, error } = await sb.rpc('get_my_latest_weekly_digest');

      if (error) throw error;

      // RPC returns an array (returns table); take the first row or null
      const rows = data as RawWeeklyDigest[] | null;
      if (!rows || rows.length === 0) return null;

      return mapWeeklyDigest(rows[0]);
    },
  });

  return {
    data: result.data ?? null,
    isLoading: result.isLoading,
    isError: result.isError,
    error: result.error,
    refetch: result.refetch,
  };
}
