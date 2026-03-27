// src/hooks/notificationTypes.ts
// Shared types for Epic I — Notifications
// All DB snake_case fields are mapped to camelCase here.

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type NotificationType = 'stance_change' | 'weekly_digest' | 'topic_follow';

// ---------------------------------------------------------------------------
// Core notification row
// ---------------------------------------------------------------------------

export interface UserNotification {
  id: string;
  notificationType: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  topicId: string | null;
  questionId: string | null;
  digestId: string | null;
  metadata: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface NotificationPreferences {
  userId: string;
  stanceChangeEnabled: boolean;
  weeklyDigestEnabled: boolean;
  topicFollowEnabled: boolean;
  digestDayOfWeek: number;   // 0 = Sunday … 6 = Saturday
  digestHourLocal: number;   // 0–23
  timezone: string;
}

export type UpdateNotificationPreferencesInput = Partial<{
  stanceChangeEnabled: boolean;
  weeklyDigestEnabled: boolean;
  topicFollowEnabled: boolean;
  digestDayOfWeek: number;
  digestHourLocal: number;
  timezone: string;
}>;

// ---------------------------------------------------------------------------
// Weekly digest
// ---------------------------------------------------------------------------

export interface WeeklyDigestFollowedTopicUpdate {
  topicId: string;
  topicTitle: string;
  summary: string;
  href: string;
}

export interface WeeklyDigestAnsweredQuestionShift {
  questionId: string;
  questionTitle: string;
  summary: string;
  href: string;
}

export interface WeeklyDigestRecommendedQuestion {
  questionId: string;
  questionTitle: string;
  href: string;
}

export interface WeeklyDigestAlignmentNote {
  title: string;
  body: string;
}

export interface WeeklyDigestSummary {
  followedTopicUpdates: WeeklyDigestFollowedTopicUpdate[];
  answeredQuestionShifts: WeeklyDigestAnsweredQuestionShift[];
  recommendedQuestions: WeeklyDigestRecommendedQuestion[];
  alignmentNote: WeeklyDigestAlignmentNote | null;
}

export interface LatestWeeklyDigest {
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: WeeklyDigestSummary;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Raw DB row shapes (snake_case) — used only inside hooks for mapping
// ---------------------------------------------------------------------------

export interface RawUserNotification {
  id: string;
  notification_type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  topic_id: string | null;
  question_id: string | null;
  digest_id: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface RawNotificationPreferences {
  user_id: string;
  stance_change_enabled: boolean;
  weekly_digest_enabled: boolean;
  topic_follow_enabled: boolean;
  digest_day_of_week: number;
  digest_hour_local: number;
  timezone: string;
}

export interface RawWeeklyDigest {
  id: string;
  week_start: string;
  week_end: string;
  summary: {
    followed_topic_updates?: Array<{
      topic_id: string;
      topic_title: string;
      summary: string;
      href: string;
    }>;
    answered_question_shifts?: Array<{
      question_id: string;
      question_title: string;
      summary: string;
      href: string;
    }>;
    recommended_questions?: Array<{
      question_id: string;
      question_title: string;
      href: string;
    }>;
    alignment_note?: {
      title: string;
      body: string;
    } | null;
  };
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

export function mapNotification(raw: RawUserNotification): UserNotification {
  return {
    id: raw.id,
    notificationType: raw.notification_type,
    title: raw.title,
    body: raw.body,
    href: raw.href,
    topicId: raw.topic_id,
    questionId: raw.question_id,
    digestId: raw.digest_id,
    metadata: raw.metadata ?? {},
    isRead: raw.is_read,
    readAt: raw.read_at,
    createdAt: raw.created_at,
  };
}

export function mapPreferences(raw: RawNotificationPreferences): NotificationPreferences {
  return {
    userId: raw.user_id,
    stanceChangeEnabled: raw.stance_change_enabled,
    weeklyDigestEnabled: raw.weekly_digest_enabled,
    topicFollowEnabled: raw.topic_follow_enabled,
    digestDayOfWeek: raw.digest_day_of_week,
    digestHourLocal: raw.digest_hour_local,
    timezone: raw.timezone,
  };
}

export function mapWeeklyDigest(raw: RawWeeklyDigest): LatestWeeklyDigest {
  const s = raw.summary ?? {};
  return {
    id: raw.id,
    weekStart: raw.week_start,
    weekEnd: raw.week_end,
    createdAt: raw.created_at,
    summary: {
      followedTopicUpdates: (s.followed_topic_updates ?? []).map((t) => ({
        topicId: t.topic_id,
        topicTitle: t.topic_title,
        summary: t.summary,
        href: t.href,
      })),
      answeredQuestionShifts: (s.answered_question_shifts ?? []).map((q) => ({
        questionId: q.question_id,
        questionTitle: q.question_title,
        summary: q.summary,
        href: q.href,
      })),
      recommendedQuestions: (s.recommended_questions ?? []).map((q) => ({
        questionId: q.question_id,
        questionTitle: q.question_title,
        href: q.href,
      })),
      alignmentNote: s.alignment_note
        ? { title: s.alignment_note.title, body: s.alignment_note.body }
        : null,
    },
  };
}
