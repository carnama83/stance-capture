import i18n from "@/lib/i18n";
/**
 * Epic C - Feed & Discovery Types
 * Matches actual database schema with correct lifecycle states
 */

// Question lifecycle states (matches database enum)
export type QuestionState = 'new' | 'active' | 'dormant' | 'archived';

export interface FeedQuestion {
  question_id: string;
  topic_id: string;
  question: string;
  summary: string | null;
  tags: string[];
  state: QuestionState;
  published_at: string;
  is_trending: boolean;
  trending_score: number;
  user_has_answered: boolean;
  topic_title: string;
  topic_tags: string[];
  relevance_score: number;
  response_count: number;
}

export interface SearchResult {
  question_id: string;
  topic_id: string;
  question: string;
  summary: string | null;
  tags: string[];
  state: string;
  published_at: string;
  topic_title: string;
  relevance_rank: number;
  response_count: number;
}

export interface FeedFilters {
  tags: string[];
  regions: string[];
  state: QuestionState[];
  showAnswered: boolean;
}

export const STATE_LABELS: Record<QuestionState, { 
  labelKey: string; 
  color: string; 
  icon: string;
  descriptionKey: string;
}> = {
  new: {
    labelKey: 'questionState.new',
    color: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: '🆕',
    descriptionKey: 'questionState.newDescription',
  },
  active: {
    labelKey: 'questionState.active',
    color: 'bg-green-100 text-green-800 border-green-200',
    icon: '✅',
    descriptionKey: 'questionState.activeDescription',
  },
  dormant: {
    labelKey: 'questionState.dormant',
    color: 'bg-gray-100 text-gray-800 border-gray-200',
    icon: '💤',
    descriptionKey: 'questionState.dormantDescription',
  },
  archived: {
    labelKey: 'questionState.archived',
    color: 'bg-gray-50 text-gray-600 border-gray-200',
    icon: '📦',
    descriptionKey: 'questionState.archivedDescriptionFeed',
  },
};

// Helper function to calculate time ago
export function formatTimeAgo(publishedAt: string): string {
  const now = new Date();
  const published = new Date(publishedAt);
  const hours = Math.floor((now.getTime() - published.getTime()) / (1000 * 60 * 60));
  
  if (hours < 1) return i18n.t('timeAgo.justNow');
  if (hours < 24) return i18n.t('timeAgo.hours', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return i18n.t('timeAgo.days', { n: days });
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return i18n.t('timeAgo.weeks', { n: weeks });
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
