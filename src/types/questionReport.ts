// src/types/questionReport.ts
//
// Epic Report — the payload of get_question_insight_report(p_question_id,
// p_language). Every number here is computed in SQL; the UI only formats it.

export type StanceScore = -2 | -1 | 0 | 1 | 2;

export interface QuestionInsightReport {
  questionId: string;
  language: string;
  requestedLanguage: string;
  fallbackLanguage: boolean;
  generatedAt: string;
  question: {
    text: string | null;
    summary: string | null;
    context: string | null;
    lowLabel: string | null;
    highLabel: string | null;
    location: string | null;
    topic: string | null;
    topicId: string | null;
    createdByType: "admin" | "community";
    createdAt: string | null;
    closedAt: string | null;
    currentRenditionId: string | null;
  };
  responseSummary: {
    total: number;
    signedIn: number;
    anonymous: number;
    distribution: { score: StanceScore; count: number; percentage: number }[];
    mean: number | null;
    median: number | null;
    lean: { low: number; neutral: number; high: number };
    strength: "early" | "emerging" | "established";
    firstResponseAt: string | null;
    lastResponseAt: string | null;
  };
  stanceDefinitions:
    | { score: StanceScore; label: string | null; aiTip: string; interpretation: string }[]
    | null;
  renditions: {
    renditionId: string | null;
    language: string | null;
    type: "original" | "translated" | null;
    version: number | null;
    publishedAt: string | null;
    responses: number;
  }[];
  changes: {
    at: string;
    kind: "wording" | "scale" | "context";
    wordingChanged: boolean;
    scaleChanged: boolean;
    contextChanged: boolean;
    fromRenditionId: string;
    toRenditionId: string;
    responsesBefore: number;
  }[];
  preResponseEdits: number;
  republishesWithoutChange: number;
  trend: {
    bucket: "sequence" | "day" | "week";
    points: {
      key: string;
      responses: number;
      cumulative: number;
      fromResponse: number;
      toResponse: number;
      from: string;
      to: string;
      bucketMean: number | null;
      cumulativeMean: number | null;
    }[];
  };
  channels: { source: string; count: number }[];
  geography: { region: string; count: number; mean: number | null }[] | null;
  // Epic Report R3 — respondents' own reasons (optional, so a subset).
  reasons: {
    totalWithReasons: number;
    freeText: number;
    sides: {
      side: "high" | "neutral" | "low";
      respondents: number;
      options: { key: string; label: string; count: number }[];
      quotes: string[];
    }[];
  } | null;
}

// Epic Report R4 — response of the question-report-insights edge function.
export interface ReportInsightsResponse {
  status: "ok" | "below_minimum" | "hidden" | "generating" | "unavailable";
  snapshot_id?: string;
  generated_at?: string;
  response_count?: number;
  language_code?: string;
  stale?: boolean;
  minimum?: number;
  insights?: {
    headline: string;
    whatPeopleAreVotingFor: string;
    whyTheyMayFeelThisWay: string;
    otherPerspectives: string;
    trendSummary: string;
    whatPeopleAppearToWant: string;
    desiredOutcomes: string[];
    caveats: string[];
  } | null;
}
