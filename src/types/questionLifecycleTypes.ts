/**
 * Question Lifecycle System - TypeScript Types (CORRECTED)
 * 
 * Updated to match your actual schema:
 * - admin_users uses user_id (not id)
 * - questions has both status and state fields
 * - Uses existing question_stances table
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export const QUESTION_STATES = {
  NEW: 'new',
  ACTIVE: 'active',
  DORMANT: 'dormant',
  ARCHIVED: 'archived',
} as const;

export type QuestionState = typeof QUESTION_STATES[keyof typeof QUESTION_STATES];

// State display configuration
export const STATE_CONFIG: Record<QuestionState, {
  label: string;
  color: string;
  bgColor: string;
  icon: string;
  description: string;
}> = {
  [QUESTION_STATES.NEW]: {
    label: 'New',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    icon: '🆕',
    description: 'Posted in the last 24 hours',
  },
  [QUESTION_STATES.ACTIVE]: {
    label: 'Active',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    icon: '✅',
    description: 'Currently receiving responses',
  },
  [QUESTION_STATES.DORMANT]: {
    label: 'Dormant',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    icon: '💤',
    description: 'Low engagement, may archive soon',
  },
  [QUESTION_STATES.ARCHIVED]: {
    label: 'Archived',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    icon: '📦',
    description: 'No longer accepting new responses',
  },
};

// ============================================================================
// DATABASE TYPES (matching your actual Supabase schema)
// ============================================================================

export interface QuestionEngagementMetrics {
  question_id: string;
  responses_last_24h: number;
  responses_last_7d: number;
  responses_total: number;
  response_rate_24h: number;
  response_rate_7d: number;
  trending_detected_at: string | null;
  trending_peak_rate: number;
  last_major_update: string | null;
  update_count: number;
  created_at: string;
  updated_at: string;
}

export interface QuestionStateHistory {
  id: string;
  question_id: string;
  old_state: QuestionState | null;
  new_state: QuestionState;
  reason: string;
  response_count: number | null;
  response_rate: number | null;
  age_days: number | null;
  created_at: string;
  created_by: string | null; // References admin_users.user_id
}

export interface QuestionLifecycleConfig {
  id: string;
  topic_category: string | null;
  region_tier: string | null;
  new_duration: number;
  active_max_age: number;
  dormant_max_age: number;
  force_archive_age: number;
  active_threshold: number;
  trending_threshold: number;
  dormant_threshold: number;
  allow_resurrection: boolean;
  resurrection_max_age: number;
  auto_archive_on_resolution: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// EXTENDED QUESTION TYPE (with lifecycle fields)
// ============================================================================

export interface QuestionWithLifecycle {
  id: string;
  question_draft_id: string | null;
  topic_draft_id: string | null;
  news_item_id: string | null;
  question: string;
  summary: string | null;
  tags: string[];
  location_label: string | null;
  
  // OLD field (kept for backward compatibility)
  status: 'active' | 'archived';
  
  // NEW lifecycle fields
  state: QuestionState;
  state_changed_at: string;
  
  // Flags
  is_trending: boolean;
  is_featured: boolean;
  is_resolved: boolean;
  
  // Trending info
  trending_since: string | null;
  trending_score: number;
  
  // Resolution info
  resolved_at: string | null;
  resolution_summary: string | null;
  
  // Archive info
  archived_at: string | null;
  archive_reason: string | null;
  
  // Featured info
  featured_at: string | null;
  featured_by: string | null; // References admin_users.user_id
  featured_reason: string | null;
  
  // Timestamps
  published_at: string;
  created_at: string;
  created_by: string | null;
  
  // Relations (optional, loaded via joins)
  engagement?: QuestionEngagementMetrics;
  state_history?: QuestionStateHistory[];
}

// ============================================================================
// VIEW MODELS (for UI components)
// ============================================================================

export interface QuestionCard {
  id: string;
  question: string;
  summary: string | null;
  state: QuestionState;
  is_trending: boolean;
  is_featured: boolean;
  is_resolved: boolean;
  published_at: string;
  age_days: number;
  response_count: number;
  response_rate: number;
}

export interface EngagementStats {
  responses_today: number;
  responses_this_week: number;
  responses_total: number;
  response_rate_daily: number;
  is_trending: boolean;
  trending_since: string | null;
}

export interface LifecycleSummary {
  id: string;
  question: string;
  state: QuestionState;
  state_changed_at: string;
  is_trending: boolean;
  is_featured: boolean;
  is_resolved: boolean;
  published_at: string;
  age_days: number;
  response_rate_24h: number;
  response_rate_7d: number;
  responses_total: number;
  trending_since: string | null;
  trending_score: number;
  archived_at: string | null;
  archive_reason: string | null;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface StateUpdateResponse {
  question_id: string;
  old_state: QuestionState;
  new_state: QuestionState;
  changed: boolean;
}

export interface TrendingQuestion {
  question_id: string;
  question: string;
  state: QuestionState;
  trending_score: number;
  trending_since: string;
  response_rate_24h: number;
  responses_total: number;
}

// ============================================================================
// FILTER & QUERY TYPES
// ============================================================================

export interface QuestionFilters {
  states?: QuestionState[];
  is_trending?: boolean;
  is_featured?: boolean;
  is_resolved?: boolean;
  min_age_days?: number;
  max_age_days?: number;
  min_response_rate?: number;
}

export interface QuestionSortOptions {
  by: 'published_at' | 'response_rate' | 'trending_score' | 'state_changed_at';
  direction: 'asc' | 'desc';
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const ACTIVE_STATES: QuestionState[] = [
  QUESTION_STATES.NEW,
  QUESTION_STATES.ACTIVE,
];

export const ALL_STATES: QuestionState[] = Object.values(QUESTION_STATES);

export const DEFAULT_TRENDING_THRESHOLD = 50; // responses per day
export const DEFAULT_ACTIVE_THRESHOLD = 10; // responses per day

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isQuestionState(value: unknown): value is QuestionState {
  return typeof value === 'string' && Object.values(QUESTION_STATES).includes(value as QuestionState);
}

export function isActiveState(state: QuestionState): boolean {
  return ACTIVE_STATES.includes(state);
}

export function canReceiveResponses(state: QuestionState): boolean {
  return state !== QUESTION_STATES.ARCHIVED;
}

export function isArchived(question: Pick<QuestionWithLifecycle, 'state' | 'archived_at'>): boolean {
  return question.state === QUESTION_STATES.ARCHIVED && question.archived_at !== null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function getStateBadgeProps(state: QuestionState) {
  return STATE_CONFIG[state];
}

export function calculateAgeDays(publishedAt: string): number {
  const now = new Date();
  const published = new Date(publishedAt);
  const diffMs = now.getTime() - published.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

export function formatAgeDays(days: number): string {
  if (days < 1) {
    const hours = Math.floor(days * 24);
    return `${hours}h ago`;
  } else if (days < 7) {
    return `${Math.floor(days)}d ago`;
  } else if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  } else {
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
}

export function shouldShowTrendingBadge(question: Pick<QuestionWithLifecycle, 'is_trending' | 'state'>): boolean {
  return question.is_trending && isActiveState(question.state);
}

export function getStateDescription(state: QuestionState, ageDays?: number): string {
  const config = STATE_CONFIG[state];
  if (ageDays !== undefined) {
    return `${config.description} (${formatAgeDays(ageDays)})`;
  }
  return config.description;
}
