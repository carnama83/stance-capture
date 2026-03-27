// src/hooks/useMyNotifications.ts
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabaseClient';
import {
  type UserNotification,
  type RawUserNotification,
  mapNotification,
} from './notificationTypes';

export type { UserNotification };

interface UseMyNotificationsArgs {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
  enabled?: boolean;
}

interface UseMyNotificationsResult {
  data: UserNotification[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useMyNotifications(
  args: UseMyNotificationsArgs = {}
): UseMyNotificationsResult {
  const { limit = 20, offset = 0, unreadOnly = false, enabled = true } = args;

  const result = useQuery<UserNotification[], Error>({
    queryKey: ['my-notifications', limit, offset, unreadOnly],
    enabled,
    staleTime: 30 * 1000, // 30 seconds — inbox should feel fresh
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase client not available');

      const { data, error } = await sb.rpc('get_my_notifications', {
        p_limit: limit,
        p_offset: offset,
        p_unread_only: unreadOnly,
      });

      if (error) throw error;

      return ((data as RawUserNotification[]) ?? []).map(mapNotification);
    },
  });

  return {
    data: result.data ?? [],
    isLoading: result.isLoading,
    isError: result.isError,
    error: result.error,
    refetch: result.refetch,
  };
}
