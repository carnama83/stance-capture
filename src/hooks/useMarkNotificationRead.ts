// src/hooks/useMarkNotificationRead.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabaseClient';

interface UseMarkNotificationReadResult {
  markRead: (notificationId: string) => Promise<boolean>;
  isPending: boolean;
}

export function useMarkNotificationRead(): UseMarkNotificationReadResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<boolean, Error, string>({
    mutationFn: async (notificationId: string) => {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase client not available');

      const { data, error } = await sb.rpc('mark_notification_read', {
        p_notification_id: notificationId,
      });

      if (error) throw error;

      return (data as boolean) ?? false;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-notification-count'] });
    },
  });

  return {
    markRead: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

// ---------------------------------------------------------------------------

interface UseMarkAllNotificationsReadResult {
  markAllRead: () => Promise<number>;
  isPending: boolean;
}

export function useMarkAllNotificationsRead(): UseMarkAllNotificationsReadResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<number, Error, void>({
    mutationFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase client not available');

      const { data, error } = await sb.rpc('mark_all_notifications_read');

      if (error) throw error;

      return (data as number) ?? 0;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-notification-count'] });
    },
  });

  return {
    markAllRead: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}
