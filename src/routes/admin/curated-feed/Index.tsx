// src/routes/admin/curated-feed/Index.tsx
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

interface HighImpactQuestion {
  question_id: string;
  question_text: string;
  composite_score: number;
  impact_score: number;
  stance_potential_score: number;
  visibility: string;
}

export default function AdminCuratedFeedPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const supabase = React.useMemo(getSupabase, []);
  const [selectedQuestions, setSelectedQuestions] = React.useState<string[]>([]);

  // Fetch high-impact questions
  const { data: questions, isLoading, refetch } = useQuery<HighImpactQuestion[]>({
    queryKey: ['high-impact-questions'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_high_impact_questions', {
        p_min_score: 7.0,
        p_limit: 20
      });
      
      if (error) {
        console.error("get_high_impact_questions error:", error);
        throw error;
      }
      
      return (data ?? []) as HighImpactQuestion[];
    },
  });

  // Check current curated set
  const { data: currentSet } = useQuery({
    queryKey: ['current-curated-set'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('daily_curated_questions')
        .select('question_ids')
        .eq('date', today)
        .single();
      
      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
        console.error("Error checking current set:", error);
      }
      
      return data?.question_ids || null;
    },
  });

  // Publish curated set
  const publishMutation = useMutation({
    mutationFn: async (questionIds: string[]) => {
      const today = new Date().toISOString().split('T')[0];
      
      const { data, error } = await supabase.rpc('publish_curated_set', {
        p_date: today,
        p_question_ids: questionIds,
      });
      
      if (error) {
        console.error("publish_curated_set error:", error);
        throw error;
      }
      
      return data;
    },
    onSuccess: () => {
      toast({
        title: "✅ Curated Set Published!",
        description: `Published ${selectedQuestions.length} questions for today.`,
      });
      setSelectedQuestions([]);
      queryClient.invalidateQueries({ queryKey: ['current-curated-set'] });
      queryClient.invalidateQueries({ queryKey: ['daily-curated-questions'] });
    },
    onError: (err: any) => {
      toast({
        title: "Publish Failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Toggle question selection
  const toggleQuestion = (id: string) => {
    if (selectedQuestions.includes(id)) {
      setSelectedQuestions(prev => prev.filter(qid => qid !== id));
    } else if (selectedQuestions.length < 10) {
      setSelectedQuestions(prev => [...prev, id]);
    } else {
      toast({
        title: "Selection Limit Reached",
        description: "You can select up to 10 questions for the curated set.",
        variant: "destructive",
      });
    }
  };

  // Auto-select top 7 questions
  const handleAutoSelect = () => {
    if (!questions || questions.length === 0) return;
    const top7 = questions.slice(0, 7).map(q => q.question_id);
    setSelectedQuestions(top7);
    toast({
      title: "Auto-Selected",
      description: "Selected top 7 questions by composite score.",
    });
  };

  // Load current set into selection
  React.useEffect(() => {
    if (currentSet && currentSet.length > 0 && selectedQuestions.length === 0) {
      setSelectedQuestions(currentSet);
    }
  }, [currentSet]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Curated Feed Manager</CardTitle>
              <CardDescription>
                Select 5-10 high-impact questions to publish as today's curated set.
                {currentSet && (
                  <span className="block mt-1 text-green-600">
                    ✓ Today already has a curated set ({currentSet.length} questions)
                  </span>
                )}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              {isLoading ? "Loading..." : "Refresh"}
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAutoSelect}
              disabled={!questions || questions.length === 0}
            >
              Auto-Select Top 7
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedQuestions([])}
              disabled={selectedQuestions.length === 0}
            >
              Clear Selection
            </Button>
          </div>

          {/* Questions List */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && (!questions || questions.length === 0) && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No high-impact questions found. Run scoring in the Impact Dashboard first.
            </div>
          )}

          {!isLoading && questions && questions.length > 0 && (
            <ScrollArea className="h-[60vh] border rounded-md p-4">
              <div className="space-y-2">
                {questions.map((q) => {
                  const isSelected = selectedQuestions.includes(q.question_id);
                  const canSelect = isSelected || selectedQuestions.length < 10;
                  
                  return (
                    <div
                      key={q.question_id}
                      className={`
                        flex items-start gap-3 p-3 border rounded-lg
                        transition-colors cursor-pointer
                        ${isSelected ? 'bg-blue-50 border-blue-300' : 'hover:bg-accent'}
                        ${!canSelect && !isSelected ? 'opacity-50' : ''}
                      `}
                      onClick={() => canSelect && toggleQuestion(q.question_id)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleQuestion(q.question_id)}
                        disabled={!canSelect && !isSelected}
                      />
                      
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-tight">
                          {q.question_text}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                          <Badge variant="default" className="text-[10px]">
                            Composite: {q.composite_score.toFixed(1)}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            Impact: {q.impact_score?.toFixed(1) ?? "—"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            Stance: {q.stance_potential_score?.toFixed(1) ?? "—"}
                          </Badge>
                          <Badge
                            variant={
                              q.visibility === 'visible' 
                                ? 'default' 
                                : 'secondary'
                            }
                            className="text-[10px]"
                          >
                            {q.visibility}
                          </Badge>
                        </div>
                      </div>
                      
                      {isSelected && (
                        <div className="text-xs font-medium text-blue-600">
                          #{selectedQuestions.indexOf(q.question_id) + 1}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          {/* Publish Section */}
          <div className="flex justify-between items-center pt-4 border-t">
            <div className="space-y-1">
              <div className="text-sm font-medium">
                Selected: {selectedQuestions.length} / 10
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedQuestions.length < 5 && "Select at least 5 questions to publish"}
                {selectedQuestions.length >= 5 && selectedQuestions.length <= 10 && "Ready to publish!"}
              </div>
            </div>
            
            <Button
              onClick={() => publishMutation.mutate(selectedQuestions)}
              disabled={
                selectedQuestions.length < 5 || 
                selectedQuestions.length > 10 ||
                publishMutation.isPending
              }
              size="lg"
            >
              {publishMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>📰 Publish Today's Curated Set</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
