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
};

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
