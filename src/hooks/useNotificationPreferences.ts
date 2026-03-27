// src/hooks/useNotificationPreferences.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabaseClient';
import {
  type NotificationPreferences,
  type UpdateNotificationPreferencesInput,
  type RawNotificationPreferences,
  mapPreferences,
} from './notificationTypes';

export type { NotificationPreferences, UpdateNotificationPreferencesInput };

// ---------------------------------------------------------------------------
// useMyNotificationPreferences
// ---------------------------------------------------------------------------

interface UseMyNotificationPreferencesResult {
  data: NotificationPreferences | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useMyNotificationPreferences(
  enabled: boolean = true
): UseMyNotificationPreferencesResult {
  const result = useQuery<NotificationPreferences | null, Error>({
    queryKey: ['my-notification-preferences'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase client not available');

      const { data, error } = await sb.rpc('get_my_notification_preferences');

      if (error) throw error;
      if (!data) return null;

      return mapPreferences(data as RawNotificationPreferences);
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

// ---------------------------------------------------------------------------
// useUpsertNotificationPreferences
// ---------------------------------------------------------------------------

interface UseUpsertNotificationPreferencesResult {
  savePreferences: (input: UpdateNotificationPreferencesInput) => Promise<NotificationPreferences>;
  isPending: boolean;
}

export function useUpsertNotificationPreferences(): UseUpsertNotificationPreferencesResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<NotificationPreferences, Error, UpdateNotificationPreferencesInput>({
    mutationFn: async (input) => {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase client not available');

      const { data, error } = await sb.rpc('upsert_my_notification_preferences', {
        p_stance_change_enabled:   input.stanceChangeEnabled   ?? null,
        p_weekly_digest_enabled:   input.weeklyDigestEnabled   ?? null,
        p_topic_follow_enabled:    input.topicFollowEnabled    ?? null,
        p_digest_day_of_week:      input.digestDayOfWeek       ?? null,
        p_digest_hour_local:       input.digestHourLocal       ?? null,
        p_timezone:                input.timezone              ?? null,
        p_email_enabled:           input.emailEnabled          ?? null,
        p_inapp_enabled:           input.inapEnabled           ?? null,
        p_digest_frequency:        input.digestFrequency       ?? null,
        // quiet hours: pass -1 to clear (mapped in RPC), null to leave unchanged
        p_quiet_hours_start:       input.quietHoursStart !== undefined ? input.quietHoursStart : null,
        p_quiet_hours_end:         input.quietHoursEnd   !== undefined ? input.quietHoursEnd   : null,
        p_reminder_enabled:        input.reminderEnabled        ?? null,
        p_new_local_topic_enabled: input.newLocalTopicEnabled   ?? null,
      });

      if (error) throw error;

      return mapPreferences(data as RawNotificationPreferences);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['my-notification-preferences'], updated);
    },
  });

  return {
    savePreferences: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}
