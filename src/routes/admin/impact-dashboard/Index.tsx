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
import { Loader2 } from "lucide-react"; // NEW IMPORT

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
      queryClient.invalidateQueries({ queryKey: ["impact-dashboard"] });
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
  // NEW: Bootstrap Epic P (One-click setup)
  // =============================
  const [isBootstrapping, setIsBootstrapping] = React.useState(false);

  const handleBootstrap = async () => {
    setIsBootstrapping(true);
    try {
      const { data: result, error } = await supabase.rpc('bootstrap_epic_p_data');
      
      if (error) throw error;
      
      toast({
        title: "✅ Epic P Bootstrapped!",
        description: `Scored ${result.questions_scored} questions, updated ${result.visibility_rules_updated} visibility rules, curated ${result.curated_questions} questions.`,
      });
      
      await refetch();
    } catch (err: any) {
      toast({
        title: "Bootstrap Failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsBootstrapping(false);
    }
  };

  // =============================
  // UPDATED: Score All Questions (uses new RPC)
  // =============================
  const [isRescoring, setIsRescoring] = React.useState(false);

  const handleRescoreAllQuestions = async () => {
    if (!data || data.length === 0) return;
    setIsRescoring(true);
    try {
      // Get all question IDs from the view
      const questionIds = data
        .map((row) => row.question_id)
        .filter((id): id is string => !!id);

      if (questionIds.length === 0) {
        toast({
          title: "Nothing to re-score",
          description: "No questions found in current view.",
        });
        return;
      }

      // Call NEW batch scoring function
      const { data: result, error } = await supabase.rpc(
        'calculate_question_impact_scores_batch',
        { p_question_ids: questionIds }
      );

      if (error) throw error;

      toast({
        title: "Re-scoring Complete!",
        description: `Scored ${result.total_processed} questions successfully.`,
      });

      await refetch();
    } catch (err: any) {
      toast({
        title: "Error re-scoring",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsRescoring(false);
    }
  };

  // =============================
  // NEW: Apply Visibility Rules
  // =============================
  const [isApplyingVisibility, setIsApplyingVisibility] = React.useState(false);

  const handleApplyVisibility = async () => {
    setIsApplyingVisibility(true);
    try {
      const { data: result, error } = await supabase.rpc('update_visibility_rules');
      
      if (error) throw error;
      
      const updatedCount = result?.length || 0;
      
      toast({
        title: "Visibility Rules Applied!",
        description: `Updated ${updatedCount} questions based on their scores.`,
      });
      
      await refetch();
    } catch (err: any) {
      toast({
        title: "Failed to Apply Rules",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsApplyingVisibility(false);
    }
  };

  // =============================
  // NEW: Re-score Single Question
  // =============================
  const [rescoringQuestion, setRescoringQuestion] = React.useState<string | null>(null);

  const handleRescoreSingle = async (questionId: string | null) => {
    if (!questionId) return;
    setRescoringQuestion(questionId);
    try {
      const { data: result, error } = await supabase.rpc(
        'calculate_question_impact_score',
        { p_question_id: questionId }
      );
      
      if (error) throw error;
      
      toast({
        title: "Question Re-scored!",
        description: `New composite score: ${result.composite_score}`,
      });
      
      await refetch();
    } catch (err: any) {
      toast({
        title: "Re-score Failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRescoringQuestion(null);
    }
  };

  // -----------------------------
  // Render
  // -----------------------------
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Impact Dashboard</CardTitle>
            <CardDescription>
              Review AI impact scores, stance potential, and visibility for
              candidate questions.
            </CardDescription>
          </div>
          
          {/* UPDATED: Button Group */}
          <div className="flex flex-row items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              Refresh
            </Button>
            
            {/* NEW: Bootstrap Button (Only show if no data yet) */}
            {(!data || data.length === 0) && (
              <Button
                variant="default"
                size="sm"
                onClick={handleBootstrap}
                disabled={isBootstrapping}
                className="bg-green-600 hover:bg-green-700"
              >
                {isBootstrapping ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Bootstrapping...
                  </>
                ) : (
                  <>🚀 Bootstrap Epic P</>
                )}
              </Button>
            )}
            
            {/* UPDATED: Score All Questions */}
            <Button
              variant="default"
              size="sm"
              onClick={handleRescoreAllQuestions}
              disabled={isRescoring || !data || data.length === 0}
            >
              {isRescoring ? "Scoring…" : "Score All Questions"}
            </Button>
            
            {/* NEW: Apply Visibility Rules */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleApplyVisibility}
              disabled={isApplyingVisibility || !data || data.length === 0}
            >
              {isApplyingVisibility ? "Applying..." : "Apply Visibility Rules"}
            </Button>
          </div>
        </CardHeader>
        
        <CardContent>
          {isLoading && (
            <p className="text-sm text-muted-foreground">
              Loading impact data…
            </p>
          )}
          {isError && (
            <p className="text-sm text-destructive">
              Error loading data: {(error as any)?.message ?? "Unknown error"}
            </p>
          )}
          {!isLoading && !isError && (!data || data.length === 0) && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No questions found. Click "Bootstrap Epic P" to score all questions and set up Epic P data.
              </p>
            </div>
          )}

          {!isLoading && !isError && data && data.length > 0 && (
            <ScrollArea className="max-h-[70vh] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[320px]">Question</TableHead>
                    <TableHead>Topic</TableHead>
                    <TableHead className="text-center">Scores</TableHead>
                    <TableHead>Visibility</TableHead>
                    <TableHead className="w-[220px]">Explanation</TableHead>
                    <TableHead className="w-[160px]">Last Updated</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead> {/* NEW COLUMN */}
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

                        {/* NEW: Actions Column */}
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRescoreSingle(row.question_id)}
                            disabled={rescoringQuestion === row.question_id}
                            title="Re-score this question"
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
