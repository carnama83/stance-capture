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
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

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

export default function AdminImpactDashboardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const supabase = React.useMemo(getSupabase, []);

  // -----------------------------
  // Data: Questions + Impact + Visibility
  // -----------------------------
  const { data, isLoading, isError, error, refetch } =
    useQuery<QuestionImpactRow[]>({
      queryKey: ["impact-dashboard", "v_question_impact_admin"],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("v_question_impact_admin")
          .select("*")
          .order("composite_score", { ascending: false })
          .limit(100);

        if (error) {
          console.error("Error loading v_question_impact_admin:", error);
          throw error;
        }
        return (data ?? []) as QuestionImpactRow[];
      },
      // FIX 1: Disable caching to always get fresh data
      staleTime: 0,
      gcTime: 0,
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

  // =============================
  // Bootstrap Epic P (One-click setup with GPT-4)
  // =============================
  const [isBootstrapping, setIsBootstrapping] = React.useState(false);

  const handleBootstrap = async () => {
    setIsBootstrapping(true);
    try {
      // Get all question IDs
      const questionIds = data
        ?.map((row) => row.question_id)
        .filter((id): id is string => !!id) || [];
      
      if (questionIds.length === 0) {
        toast({
          title: "No Questions Found",
          description: "Add questions first, then bootstrap.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "🚀 Bootstrapping with GPT-4...",
        description: `Scoring ${questionIds.length} questions, please wait...`,
      });

      // Step 1: Score all with AI
      let scoredCount = 0;
      for (const qid of questionIds) {
        try {
          await supabase.functions.invoke('ai-score-question', {
            body: { question_id: qid }
          });
          scoredCount++;
        } catch (err) {
          console.error(`Failed to score ${qid}:`, err);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Step 2: Apply visibility rules
      const { data: visibilityResult } = await supabase.rpc('update_visibility_rules');
      const visibilityCount = visibilityResult?.length || 0;

      toast({
        title: "✅ Bootstrap Complete!",
        description: `Scored ${scoredCount} questions, applied ${visibilityCount} visibility rules.`,
      });

      // FIX 3: Force refetch after bootstrap
      await refetch();

    } catch (err: any) {
      toast({
        title: "Bootstrap Failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsBootstrapping(false);
    }
  };

  // =============================
  // Re-score Single Question
  // =============================
  const [rescoringQuestion, setRescoringQuestion] = React.useState<string | null>(null);

// ALTERNATIVE FIX: Optimistic Update Approach
// This updates the UI immediately while the database syncs in the background

const handleRescoreSingle = async (questionId: string | null) => {
  if (!questionId) return;
  
  setRescoringQuestion(questionId);
  try {
    // Call the Edge Function
    const { data: result, error } = await supabase.functions.invoke('ai-score-question', {
      body: { question_id: questionId }
    });

    if (error) {
      console.error('Edge Function error:', error);
      throw error;
    }

    console.log('Edge Function response:', result);
    
    const compositeScore = result?.composite_score || 'N/A';
    
    toast({
      title: "✅ Question Scored by GPT-4!",
      description: `New composite score: ${compositeScore}`,
    });

    // OPTIMISTIC UPDATE: Update the cache immediately with the new scores
    queryClient.setQueryData<QuestionImpactRow[]>(
      ["impact-dashboard", "v_question_impact_admin"], 
      (oldData) => {
        if (!oldData) return oldData;
        
        return oldData.map(row => {
          if (row.question_id === questionId) {
            // Update this specific row with the new scores
            return {
              ...row,
              composite_score: result.composite_score,
              impact_score: result.impact_score,
              stance_potential_score: result.stance_potential_score,
              cluster_density_score: result.cluster_density_score,
              region_relevance_score: result.region_relevance_score,
              engagement_prediction_score: result.engagement_prediction_score,
              impact_explanation: result.explanation,
              scores_updated_at: new Date().toISOString()
            };
          }
          return row;
        });
      }
    );

    // Then invalidate and refetch in the background to confirm
    setTimeout(async () => {
      await queryClient.invalidateQueries({ 
        queryKey: ["impact-dashboard", "v_question_impact_admin"] 
      });
    }, 1000);

  } catch (err: any) {
    console.error("Scoring error:", err);
    toast({
      title: "Scoring Failed",
      description: err?.message || "Unknown error",
      variant: "destructive",
    });
    
    // Rollback the optimistic update on error
    await queryClient.invalidateQueries({ 
      queryKey: ["impact-dashboard", "v_question_impact_admin"] 
    });
  } finally {
    setRescoringQuestion(null);
  }
};

// BENEFIT: User sees the scores update INSTANTLY
// Then we verify with the database 1 second later
// This feels much more responsive!


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
          <div className="flex gap-2 mt-4">
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
            >
              {isBootstrapping ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Score All Questions
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
    </div>
  );
}
