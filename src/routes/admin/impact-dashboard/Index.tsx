// src/routes/admin/impact-dashboard/Index.tsx
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Star, Trash2, TrendingUp, ShieldOff, RefreshCw } from "lucide-react";

type QuestionVisibilityEnum =
  | "visible"
  | "suppressed"
  | "archived"
  | "manual_only";

interface QuestionImpactRow {
  question_id: string | null;
  question_text: string | null;
  question_summary: string | null;
  question_tags: string[] | null;
  question_location_label: string | null;
  question_status: string | null;
  question_published_at: string | null;

  topic_id: string | null;
  topic_title: string | null;
  topic_summary: string | null;
  topic_tier: string | null;
  topic_location_label: string | null;
  topic_tags: string[] | null;
  cluster_id: string | null;

  impact_score: number | null;
  stance_potential_score: number | null;
  cluster_density_score: number | null;
  region_relevance_score: number | null;
  engagement_prediction_score: number | null;
  composite_score: number | null;
  impact_explanation: string | null;
  scores_updated_at: string | null;

  visibility: QuestionVisibilityEnum | null;
  visibility_reason: string | null;
  last_evaluated_at: string | null;
  is_featured: boolean | null;
}

const visibilityOptions: QuestionVisibilityEnum[] = [
  "visible",
  "suppressed",
  "archived",
  "manual_only",
];

const visibilityLabels: Record<QuestionVisibilityEnum, string> = {
  visible: "Visible",
  suppressed: "Suppressed",
  archived: "Archived",
  manual_only: "Manual only",
};

const visibilityBadgeVariant: Record<
  QuestionVisibilityEnum,
  "default" | "secondary" | "destructive" | "outline"
> = {
  visible: "default",
  suppressed: "destructive",
  archived: "secondary",
  manual_only: "outline",
};

const compositeColor = (score: number | null | undefined): string => {
  if (score == null) return "";
  if (score >= 8) return "text-green-600";
  if (score >= 6) return "text-amber-500";
  if (score >= 4) return "text-orange-500";
  return "text-red-500";
};

// ── P: Feed Hygiene Panel ──────────────────────────────────────────────────────
// Shows auto-suppressed/archived questions and lets admin run or preview hygiene.

type HygieneResult = {
  ran_at: string;
  dry_run: boolean;
  suppressed: number;
  archived: number;
  boosted: number;
  rules: {
    suppress_after_hours: number;
    archive_after_days: number;
    min_composite_score: number;
    low_engagement_threshold: number;
  };
};

type HygieneRow = {
  question_id: string;
  question: string;
  published_at: string | null;
  is_trending: boolean;
  trending_score: number | null;
  visibility: string;
  reason: string | null;
  last_evaluated_at: string;
  responses_total: number | null;
  composite_score: number | null;
};

function timeAgoHygiene(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function FeedHygienePanel() {
  const sb = React.useMemo(getSupabase, []);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [lastResult, setLastResult] = React.useState<HygieneResult | null>(null);
  const [running, setRunning] = React.useState(false);

  // Load auto-suppressed/archived questions from v_hygiene_suppressed view
  const { data: hygieneRows, isLoading } = useQuery<HygieneRow[]>({
    queryKey: ["admin-hygiene-rows"],
    staleTime: 2 * 60_000,
    queryFn: async () => {
      if (!sb) return [];
      const { data, error } = await sb
        .from("v_hygiene_suppressed")
        .select("*")
        .limit(50);
      if (error) return [];
      return (data ?? []) as HygieneRow[];
    },
  });

  async function runHygiene(dryRun: boolean) {
    if (!sb) return;
    setRunning(true);
    try {
      const { data, error } = await sb.rpc("apply_feed_hygiene", { p_dry_run: dryRun });
      if (error) throw error;
      setLastResult(data as HygieneResult);
      if (!dryRun) {
        queryClient.invalidateQueries({ queryKey: ["admin-hygiene-rows"] });
        queryClient.invalidateQueries({ queryKey: ["admin-impact-rows"] });
        toast({ title: `Hygiene run complete — ${(data as HygieneResult).suppressed} suppressed, ${(data as HygieneResult).archived} archived, ${(data as HygieneResult).boosted} boosted.` });
      }
    } catch (e: any) {
      toast({ title: "Hygiene run failed", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  const suppressedCount = hygieneRows?.filter(r => r.visibility === "suppressed").length ?? 0;
  const archivedCount = hygieneRows?.filter(r => r.visibility === "archived").length ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldOff className="h-4 w-4 text-slate-400" />
              Feed Hygiene
            </CardTitle>
            <CardDescription className="mt-0.5">
              Auto-suppresses old low-engagement questions and archives stale ones. Runs every 6h via pg_cron.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runHygiene(true)}
              disabled={running}
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Preview (dry run)
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => runHygiene(false)}
              disabled={running}
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Run now
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Last run result */}
        {lastResult && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm space-y-1">
            <p className="font-medium text-slate-700">
              {lastResult.dry_run ? "Dry run preview" : "Run complete"} ·{" "}
              <span className="font-normal text-slate-500">{new Date(lastResult.ran_at).toLocaleString()}</span>
            </p>
            <div className="flex items-center gap-6 text-xs">
              <span className="text-amber-600">{lastResult.suppressed} suppressed</span>
              <span className="text-red-600">{lastResult.archived} archived</span>
              <span className="text-emerald-600">{lastResult.boosted} boosted (trending restored)</span>
            </div>
            <div className="text-[11px] text-slate-400">
              Rules: suppress after {lastResult.rules.suppress_after_hours}h low-engagement ·
              archive after {lastResult.rules.archive_after_days}d ·
              min composite score {lastResult.rules.min_composite_score}
            </div>
          </div>
        )}

        {/* Counts */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border px-4 py-3 text-center">
            <p className="text-2xl font-semibold text-amber-600">{suppressedCount}</p>
            <p className="text-xs text-slate-500 mt-0.5">Auto-suppressed</p>
          </div>
          <div className="rounded-lg border px-4 py-3 text-center">
            <p className="text-2xl font-semibold text-red-500">{archivedCount}</p>
            <p className="text-xs text-slate-500 mt-0.5">Auto-archived</p>
          </div>
        </div>

        {/* Table of hygiene-affected questions */}
        {isLoading && (
          <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading hygiene log…
          </div>
        )}
        {!isLoading && hygieneRows && hygieneRows.length > 0 && (
          <ScrollArea className="h-64">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Question</TableHead>
                  <TableHead className="text-xs w-24">Status</TableHead>
                  <TableHead className="text-xs w-28">Age</TableHead>
                  <TableHead className="text-xs w-24">Responses</TableHead>
                  <TableHead className="text-xs w-32">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hygieneRows.map(row => (
                  <TableRow key={row.question_id}>
                    <TableCell className="text-xs max-w-xs">
                      <p className="line-clamp-2 text-slate-800">{row.question}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.visibility === "archived" ? "destructive" : "secondary"} className="text-[10px]">
                        {row.visibility}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {row.published_at ? timeAgoHygiene(row.published_at) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {row.responses_total ?? 0}
                    </TableCell>
                    <TableCell className="text-[10px] text-slate-400 max-w-[160px] line-clamp-2">
                      {row.reason ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
        {!isLoading && (!hygieneRows || hygieneRows.length === 0) && (
          <p className="text-xs text-slate-400 py-2">
            No questions auto-suppressed or archived yet. Run hygiene to evaluate.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminImpactDashboardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const supabase = React.useMemo(getSupabase, []);

  // -----------------------------
  // Data: Questions + Impact + Visibility
  // -----------------------------
const { data, isLoading, isError, error, refetch } = useQuery<QuestionImpactRow[]>({
  queryKey: ["impact-dashboard", "v_question_impact_admin"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("v_question_impact_admin")
      .select("*")
      .order("composite_score", { ascending: false, nullsFirst: false })  // ← ADD nullsFirst: false
      .order("question_published_at", { ascending: false })  // ← ADD secondary sort
      .limit(100);

    if (error) {
      console.error("Error loading v_question_impact_admin:", error);
      throw error;
    }
    return (data ?? []) as QuestionImpactRow[];
  },
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: true,  // ← ADD THIS
  refetchOnWindowFocus: false,  // ← ADD THIS (prevent unnecessary refetches)
});

  // -----------------------------
  // Mutation: Set question visibility
  // -----------------------------
  const setVisibilityMutation = useMutation({
    mutationFn: async (params: {
      question_id: string;
      visibility: QuestionVisibilityEnum;
    }) => {
      const { question_id, visibility } = params;
      const { data, error } = await supabase.rpc("set_question_visibility", {
        p_question_id: question_id,
        p_visibility: visibility,
        p_reason: `Set via Impact Dashboard (${visibility})`,
      });

      if (error) {
        console.error("set_question_visibility error:", error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Visibility updated",
        description: "Question visibility has been updated.",
      });
      // FIX 2: Force refetch instead of just invalidating
      refetch();
    },
    onError: (err: any) => {
      toast({
        title: "Error updating visibility",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  // P: Toggle is_featured
  const setFeaturedMutation = useMutation({
    mutationFn: async ({ question_id, featured }: { question_id: string; featured: boolean }) => {
      const { error } = await supabase
        .from("questions")
        .update({ is_featured: featured })
        .eq("id", question_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Featured status updated" });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error updating featured", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  // =============================
  // Bootstrap Epic P (One-click setup with GPT-4)
  // =============================
  const [isBootstrapping, setIsBootstrapping] = React.useState(false);
  const [scoringProgress, setScoringProgress] = React.useState({ current: 0, total: 0 });

  // Batch size per scoring run — keeps runs under ~60s and prevents timeouts.
  // Each question takes ~1-2s (API call + 300ms delay), so 30 ≈ 45s max.
  const SCORE_BATCH_SIZE = 30;

  const handleBootstrap = async () => {
    setIsBootstrapping(true);
    setScoringProgress({ current: 0, total: 0 });

    try {
      // ── Round-robin ordering ──────────────────────────────────────────────
      // Sort by scores_updated_at ASC NULLS FIRST so:
      //   1. Unscored questions are always processed first
      //   2. Oldest-scored questions come next
      //   3. Recently-scored questions are deferred to future runs
      // This ensures every question gets scored eventually instead of the
      // same top questions being re-scored on every run.
      const allRows = data
        ?.filter((row): row is typeof row & { question_id: string } => !!row.question_id)
        .slice() // don't mutate original
        .sort((a, b) => {
          // Unscored (null) always first
          if (!a.scores_updated_at && !b.scores_updated_at) return 0;
          if (!a.scores_updated_at) return -1;
          if (!b.scores_updated_at) return 1;
          // Oldest scored first
          return new Date(a.scores_updated_at).getTime() - new Date(b.scores_updated_at).getTime();
        }) || [];

      if (allRows.length === 0) {
        toast({
          title: "No Questions Found",
          description: "Add questions first, then score.",
          variant: "destructive",
        });
        return;
      }

      // Take only the first SCORE_BATCH_SIZE questions this run
      const batch = allRows.slice(0, SCORE_BATCH_SIZE);
      const unscoredInBatch = batch.filter(r => !r.scores_updated_at).length;
      const totalUnscored = allRows.filter(r => !r.scores_updated_at).length;

      setScoringProgress({ current: 0, total: batch.length });

      toast({
        title: "🚀 Starting AI Scoring...",
        description: `Scoring ${batch.length} of ${allRows.length} questions `
          + `(${unscoredInBatch} unscored, ${totalUnscored} total unscored). `
          + (allRows.length > SCORE_BATCH_SIZE ? `Run again to score remaining ${allRows.length - SCORE_BATCH_SIZE}.` : ''),
      });

      // Step 1: Score batch with AI
      let scoredCount = 0;
      let failedCount = 0;

      for (let i = 0; i < batch.length; i++) {
        const qid = batch[i].question_id;
        try {
          await supabase.functions.invoke('ai-score-question', {
            body: { question_id: qid }
          });
          scoredCount++;
          setScoringProgress({ current: i + 1, total: batch.length });
        } catch (err) {
          console.error(`Failed to score ${qid}:`, err);
          failedCount++;
        }
        // Delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      toast({
        title: "🎯 Scoring Complete",
        description: `Scored ${scoredCount}/${batch.length} questions`
          + (failedCount > 0 ? ` (${failedCount} failed)` : '')
          + `. Applying visibility rules...`,
      });

      // Step 2: Apply visibility rules
      const { data: visibilityResult } = await supabase.rpc('update_visibility_rules');
      const visibilityCount = visibilityResult?.length || 0;

      const remaining = allRows.length - SCORE_BATCH_SIZE;
      toast({
        title: "✅ Run Complete!",
        description: `Scored ${scoredCount} questions, applied ${visibilityCount} visibility rules.`
          + (remaining > 0 ? ` ${remaining} questions remain — run again to continue.` : ' All questions scored!'),
      });

      // Force refetch
      await queryClient.resetQueries({
        queryKey: ["impact-dashboard", "v_question_impact_admin"],
        exact: true
      });

    } catch (err: any) {
      toast({
        title: "Scoring Failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsBootstrapping(false);
      setScoringProgress({ current: 0, total: 0 });
    }
  };

  // =============================
  // Re-score Single Question
  // =============================
  const [rescoringQuestion, setRescoringQuestion] = React.useState<string | null>(null);

// DEBUG VERSION - Use this to see exactly what's happening
// Replace handleRescoreSingle with this temporarily:
const handleRescoreSingle = async (questionId: string | null) => {
  if (!questionId) return;
  
  setRescoringQuestion(questionId);
  try {
    const { data: result, error } = await supabase.functions.invoke('ai-score-question', {
      body: { question_id: questionId }
    });

    if (error) throw error;

    const compositeScore = result?.composite_score || result?.new_composite_score || 'N/A';
    
    toast({
      title: "✅ Question Scored by GPT-4!",
      description: `New composite score: ${compositeScore}`,
    });

    // Wait for database to commit
    await new Promise(resolve => setTimeout(resolve, 500));

    // CRITICAL FIX: Reset the entire query cache and force refetch
    await queryClient.resetQueries({ 
      queryKey: ["impact-dashboard", "v_question_impact_admin"],
      exact: true
    });

  } catch (err: any) {
    console.error("Scoring error:", err);
    toast({
      title: "Scoring Failed",
      description: err?.message || "Unknown error",
      variant: "destructive",
    });
  } finally {
    setRescoringQuestion(null);
  }
};

// EXPLANATION OF THE FIX:
// 
// Problem 1: ORDER BY composite_score DESC puts NULL values last
//   - When you first load the page, questions without scores are at the end
//   - When you score a question, it moves to the top, but the cache doesn't know this
//   - Solution: Add nullsFirst: false explicitly + secondary sort by published_at
//
// Problem 2: React Query cache wasn't invalidating properly
//   - refetch() doesn't always force a fresh query
//   - Solution: Use resetQueries() which completely clears the cache
//
// After this fix:
// 1. Questions will be sorted: high scores first, then by date
// 2. After scoring, the cache is completely cleared and refetched
// 3. The newly-scored question will appear at the top with its scores visible



  // =============================
  // Apply Visibility Rules
  // =============================
  const applyVisibilityRulesMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("update_visibility_rules");
      if (error) {
        console.error("update_visibility_rules error:", error);
        throw error;
      }
      return data;
    },
    onSuccess: (result) => {
      const count = result?.length || 0;
      toast({
        title: "Visibility rules applied",
        description: `Updated visibility for ${count} questions.`,
      });
      // FIX 5: Force refetch after visibility rules
      refetch();
    },
    onError: (err: any) => {
      toast({
        title: "Error applying visibility rules",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  // =============================
  // Refresh Handler
  // =============================
  const handleRefresh = async () => {
    // Invalidate cache first
    await queryClient.invalidateQueries({ 
      queryKey: ["impact-dashboard", "v_question_impact_admin"] 
    });
    // Then refetch
    await refetch();
    toast({
      title: "Refreshed",
      description: "Impact dashboard data has been refreshed.",
    });
  };

  // =============================
  // RENDER
  // =============================
  return (
    <div className="container mx-auto p-6 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Impact Dashboard</CardTitle>
          <CardDescription>
            Review AI impact scores, stance potential, and visibility for
            candidate questions.
          </CardDescription>
          <div className="flex flex-col gap-3 mt-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Refresh
              </Button>
              <Button
                onClick={handleBootstrap}
                disabled={isBootstrapping || isLoading}
                title={`Scores up to ${SCORE_BATCH_SIZE} questions per run, unscored first. Run multiple times to cover all questions.`}
              >
                {isBootstrapping ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {isBootstrapping
                  ? `Scoring... ${scoringProgress.current}/${scoringProgress.total}`
                  : (() => {
                      const unscored = data?.filter(r => !r.scores_updated_at).length ?? 0;
                      return unscored > 0
                        ? `Score Next ${Math.min(SCORE_BATCH_SIZE, unscored)} (${unscored} unscored)`
                        : `Re-score Next ${SCORE_BATCH_SIZE}`;
                    })()
                }
              </Button>
              <Button
                variant="secondary"
                onClick={() => applyVisibilityRulesMutation.mutate()}
                disabled={applyVisibilityRulesMutation.isPending || isLoading}
              >
                {applyVisibilityRulesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Apply Visibility Rules
              </Button>
            </div>
            
            {/* Progress bar for bulk scoring */}
            {isBootstrapping && scoringProgress.total > 0 && (
              <div className="bg-muted/50 p-4 rounded-lg border">
                <div className="flex items-center gap-3 mb-2">
                  <Progress 
                    value={(scoringProgress.current / scoringProgress.total) * 100} 
                    className="flex-1"
                  />
                  <span className="text-sm font-medium tabular-nums min-w-[80px] text-right">
                    {scoringProgress.current}/{scoringProgress.total}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Scoring questions with GPT-4... {Math.round((scoringProgress.current / scoringProgress.total) * 100)}% complete
                  {' '}(unscored first, oldest-scored next)
                </p>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="ml-2 text-muted-foreground">
                Loading impact data...
              </p>
            </div>
          )}

          {isError && (
            <div className="rounded-md bg-destructive/10 p-4 border border-destructive/20">
              <p className="text-sm text-destructive font-medium">
                Error loading data
              </p>
              <p className="text-xs text-destructive/80 mt-1">
                {error?.message ?? "Unknown error"}
              </p>
            </div>
          )}

          {!isLoading && !isError && data && data.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">
                No questions found. Generate some questions first.
              </p>
            </div>
          )}

          {!isLoading && !isError && data && data.length > 0 && (
            <ScrollArea className="h-[calc(100vh-300px)] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[320px]">Question</TableHead>
                    <TableHead>Topic</TableHead>
                    <TableHead className="text-center">Scores</TableHead>
                    <TableHead>Visibility</TableHead>
                    <TableHead className="w-[220px]">Explanation</TableHead>
                    <TableHead className="w-[160px]">Last Updated</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => {
                    const composite = row.composite_score ?? null;
                    const visibility: QuestionVisibilityEnum =
                      row.visibility ?? "visible";

                    return (
                      <TableRow
                        key={row.question_id ?? row.topic_id ?? Math.random()}
                      >
                        {/* Question */}
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <div className="font-medium line-clamp-2">
                              {row.question_text ||
                                "(draft / missing question text)"}
                            </div>
                            {row.question_summary && (
                              <div className="text-xs text-muted-foreground line-clamp-2">
                                {row.question_summary}
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {row.question_location_label && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {row.question_location_label}
                                </Badge>
                              )}
                              {row.question_tags?.slice(0, 3).map((tag) => (
                                <Badge
                                  key={tag}
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  #{tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </TableCell>

                        {/* Topic */}
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <div className="text-sm font-medium line-clamp-2">
                              {row.topic_title || "(no topic title)"}
                            </div>
                            {row.topic_summary && (
                              <div className="text-xs text-muted-foreground line-clamp-2">
                                {row.topic_summary}
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {row.topic_tier && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  Tier: {row.topic_tier}
                                </Badge>
                              )}
                              {row.topic_location_label && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {row.topic_location_label}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Scores */}
                        <TableCell>
                          <div className="flex flex-col text-xs items-start gap-0.5">
                            <div
                              className={cn(
                                "font-semibold",
                                compositeColor(composite)
                              )}
                            >
                              Composite:{" "}
                              {composite != null
                                ? composite.toFixed(2)
                                : "—"}
                            </div>
                            <div>Impact: {row.impact_score ?? "—"}</div>
                            <div>
                              Stance: {row.stance_potential_score ?? "—"}
                            </div>
                            <div>
                              Cluster: {row.cluster_density_score ?? "—"}
                            </div>
                            <div>
                              Region: {row.region_relevance_score ?? "—"}
                            </div>
                            <div>
                              Engagement:{" "}
                              {row.engagement_prediction_score ?? "—"}
                            </div>
                          </div>
                        </TableCell>

                        {/* Visibility */}
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Select
                              value={visibility}
                              onValueChange={(val) => {
                                const qid = row.question_id;
                                if (!qid) return;
                                setVisibilityMutation.mutate({
                                  question_id: qid,
                                  visibility: val as QuestionVisibilityEnum,
                                });
                              }}
                            >
                              <SelectTrigger className="h-8 w-[132px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {visibilityOptions.map((opt) => (
                                  <SelectItem key={opt} value={opt}>
                                    {visibilityLabels[opt]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Badge
                              variant={visibilityBadgeVariant[visibility]}
                              className="w-fit text-[10px]"
                            >
                              {visibilityLabels[visibility]}
                            </Badge>
                            {row.visibility_reason && (
                              <div className="text-[10px] text-muted-foreground line-clamp-2">
                                {row.visibility_reason}
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {/* Explanation */}
                        <TableCell>
                          <div className="text-xs text-muted-foreground line-clamp-4">
                            {row.impact_explanation || "—"}
                          </div>
                        </TableCell>

                        {/* Last Updated */}
                        <TableCell>
                          <div className="text-xs text-muted-foreground">
                            {row.scores_updated_at
                              ? new Date(
                                  row.scores_updated_at
                                ).toLocaleString()
                              : "—"}
                          </div>
                        </TableCell>

                        {/* Actions Column */}
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRescoreSingle(row.question_id)}
                              disabled={rescoringQuestion === row.question_id}
                              title="Re-score this question with GPT-4"
                            >
                              {rescoringQuestion === row.question_id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <span className="text-base">↻</span>
                              )}
                            </Button>
                            {/* P: Featured toggle */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => row.question_id && setFeaturedMutation.mutate({
                                question_id: row.question_id,
                                featured: !row.is_featured,
                              })}
                              disabled={setFeaturedMutation.isPending}
                              title={row.is_featured ? "Unfeature question" : "Feature question"}
                              className={row.is_featured ? "text-amber-500" : "text-slate-400"}
                            >
                              <Star className={`h-3.5 w-3.5 ${row.is_featured ? "fill-amber-500" : ""}`} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* ── P: Feed Hygiene Panel ─────────────────────────────────────────── */}
      <FeedHygienePanel />
    </div>
  );
}
