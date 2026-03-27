// src/hooks/useUnreadNotificationCount.ts
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabaseClient';

interface UseUnreadNotificationCountResult {
  count: number;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useUnreadNotificationCount(
  enabled: boolean = true
): UseUnreadNotificationCountResult {
  const result = useQuery<number, Error>({
    queryKey: ['unread-notification-count'],
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // poll every 60s for badge freshness
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase client not available');

      const { data, error } = await sb.rpc('get_unread_notification_count');

      if (error) throw error;

      return (data as number) ?? 0;
    },
  });

  return {
    count: result.data ?? 0,
    isLoading: result.isLoading,
    isError: result.isError,
    error: result.error,
    refetch: result.refetch,
  };
}
