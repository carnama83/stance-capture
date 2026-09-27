// src/types/communityStance.ts
//
// Phase 2 — Normalized frontend model for Community Stance bar.
//
// This is the ONE shared shape used by:
//   - Hero (useHeroController distribution state)
//   - QuestionDetailPage community stance block
//
// DB field mapping (from question_stance_stats_region):
//   total_responses  → responses
//   pct_agree        → supportPct    ← IMPORTANT: agree = support in UI language
//   pct_disagree     → opposePct     ← IMPORTANT: disagree = oppose in UI language
//   pct_neutral      → neutralPct
//   avg_score        → avgScore
//   updated_at       → updatedAt
//   region_label     → regionLabel   (display value, e.g. "Global")
//   region_scope     → regionScope   (stored value, e.g. "global")
//   region_key       → regionKey     (stored value, e.g. "global")
//
// NEVER use pct_agree/pct_disagree field names in UI rendering code.
// Always go through this normalized shape so labels stay consistent.

export type CommunityStanceData = {
  questionId: string;
  regionScope: string;   // stored DB value — e.g. "global"
  regionKey: string;     // stored DB value — e.g. "global"
  regionLabel: string;   // display label  — e.g. "Global"
  responses: number;
  supportPct: number | null;   // pct_agree from DB
  opposePct: number | null;    // pct_disagree from DB
  neutralPct: number | null;   // pct_neutral from DB
  avgScore: number | null;
  updatedAt: string;
  // Sep 2026: the global bar also counts anonymous (held, not yet signed-up)
  // answers, drawn lighter. Absent for regional rows, which stay verified-only.
  verifiedCount?: number;
  anonymousCount?: number;
  /** Share (0..1) of each bucket that is anonymous. */
  anonymousShare?: { oppose: number; neutral: number; support: number };
};

// ── get_question_community_stats (global bar incl. anonymous answers) ──

type RawBucket = { verified: number; anonymous: number };
export type RawCommunityStatsRpc = {
  total: number;
  verified: number;
  anonymous: number;
  oppose: RawBucket;
  neutral: RawBucket;
  support: RawBucket;
  avg_score: number | null;
};

export function mapCommunityStatsRpc(
  questionId: string,
  raw: RawCommunityStatsRpc,
): CommunityStanceData {
  const total = raw.total || 0;
  const n = (b: RawBucket) => (b?.verified ?? 0) + (b?.anonymous ?? 0);
  const pct = (b: RawBucket) => (total > 0 ? (n(b) * 100) / total : 0);
  const share = (b: RawBucket) => (n(b) > 0 ? (b.anonymous ?? 0) / n(b) : 0);
  return {
    questionId,
    regionScope: COMMUNITY_STANCE_GLOBAL_SCOPE,
    regionKey:   COMMUNITY_STANCE_GLOBAL_KEY,
    regionLabel: COMMUNITY_STANCE_GLOBAL_LABEL,
    responses:   total,
    supportPct:  pct(raw.support),
    opposePct:   pct(raw.oppose),
    neutralPct:  pct(raw.neutral),
    avgScore:    raw.avg_score == null ? null : Number(raw.avg_score),
    updatedAt:   new Date().toISOString(),
    verifiedCount:  raw.verified ?? 0,
    anonymousCount: raw.anonymous ?? 0,
    anonymousShare: {
      oppose:  share(raw.oppose),
      neutral: share(raw.neutral),
      support: share(raw.support),
    },
  };
}

// ── Helper: map a raw question_stance_stats_region row to CommunityStanceData ──
//
// Use this wherever you read from the aggregate table so the mapping
// is defined in exactly one place.

export type RawStanceStatsRegionRow = {
  question_id: string;
  region_scope: string;
  region_key: string;
  region_label: string;
  total_responses: number;
  pct_agree: number | null;
  pct_disagree: number | null;
  pct_neutral: number | null;
  avg_score: number | null;
  updated_at: string;
};

export function mapToCommunityStanceData(
  row: RawStanceStatsRegionRow
): CommunityStanceData {
  return {
    questionId:  row.question_id,
    regionScope: row.region_scope,
    regionKey:   row.region_key,
    regionLabel: row.region_label,
    responses:   row.total_responses,
    supportPct:  row.pct_agree,      // agree → support
    opposePct:   row.pct_disagree,   // disagree → oppose
    neutralPct:  row.pct_neutral,
    avgScore:    row.avg_score,
    updatedAt:   row.updated_at,
  };
}

// ── Global row constants ──
// Use these when querying question_stance_stats_region for the main bar.
// The fetcher must filter by STORED values (lowercase), not display label.

export const COMMUNITY_STANCE_GLOBAL_SCOPE = "global" as const;
export const COMMUNITY_STANCE_GLOBAL_KEY   = "global" as const;
export const COMMUNITY_STANCE_GLOBAL_LABEL = "Global" as const;
