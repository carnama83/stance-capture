// src/components/cognitive/CognitiveStateViewer.tsx
import React from 'react';
import { useCognitiveState, formatStanceValue, getStanceColor } from '@/hooks/useCognitiveState';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Brain, TrendingUp, Target, BarChart3 } from 'lucide-react';

export function CognitiveStateViewer() {
  const { data: cognitiveState, isLoading, error } = useCognitiveState();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Error loading cognitive state: {error.message || 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  if (!cognitiveState) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            No Cognitive State Yet
          </CardTitle>
          <CardDescription>
            Answer at least 3 questions to see your cognitive profile.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { cognitive_profile } = cognitiveState;

  return (
    <div className="space-y-6">
      {/* Overall Cognitive Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Your Cognitive Profile
          </CardTitle>
          <CardDescription>
            Based on {cognitive_profile.overall_orientation.total_questions} questions across{' '}
            {cognitive_profile.overall_orientation.active_topics} topics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Overall Stance */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Average Stance</span>
              </div>
              <div className="text-right">
                <span className={`font-bold ${getStanceColor(cognitive_profile.overall_orientation.mean_stance)}`}>
                  {cognitive_profile.overall_orientation.mean_stance.toFixed(2)}
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  {formatStanceValue(cognitive_profile.overall_orientation.mean_stance)}
                </span>
              </div>
            </div>
            <Progress 
              value={((cognitive_profile.overall_orientation.mean_stance + 2) / 4) * 100} 
              className="h-2"
            />
          </div>

          {/* Consistency Score */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Consistency Score</span>
              </div>
              <span className="font-bold">
                {(cognitive_profile.overall_orientation.stance_variance * 100).toFixed(0)}%
              </span>
            </div>
            <Progress 
              value={cognitive_profile.overall_orientation.stance_variance * 100} 
              className="h-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              How consistent your stances are across topics
            </p>
          </div>

          {/* Engagement Stats */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div>
              <p className="text-xs text-muted-foreground">Questions Answered</p>
              <p className="text-2xl font-bold">{cognitive_profile.overall_orientation.total_questions}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active Topics</p>
              <p className="text-2xl font-bold">{cognitive_profile.overall_orientation.active_topics}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Questions per Week</p>
              <p className="text-2xl font-bold">
                {cognitive_profile.engagement_patterns.questions_per_week.toFixed(1)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Median Stance</p>
              <p className={`text-2xl font-bold ${getStanceColor(cognitive_profile.overall_orientation.median_stance)}`}>
                {cognitive_profile.overall_orientation.median_stance.toFixed(2)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Topic Breakdown */}
      {Object.keys(cognitive_profile.topic_profiles).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Topic Breakdown
            </CardTitle>
            <CardDescription>
              Your stance distribution across different topics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(cognitive_profile.topic_profiles).map(([topicId, profile]) => (
                <div key={topicId} className="border-b pb-4 last:border-b-0 last:pb-0">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h4 className="font-medium">{profile.topic_name}</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {profile.question_count} questions • {(profile.consistency_score * 100).toFixed(0)}% consistent
                      </p>
                    </div>
                    <Badge variant="secondary" className="ml-4">
                      <span className={getStanceColor(profile.mean_stance)}>
                        {profile.mean_stance > 0 ? '+' : ''}{profile.mean_stance.toFixed(2)}
                      </span>
                    </Badge>
                  </div>
                  
                  <Progress 
                    value={((profile.mean_stance + 2) / 4) * 100} 
                    className="h-1.5 mb-2"
                  />
                  
                  {/* Mini stance distribution */}
                  <div className="flex gap-2 text-xs">
                    {profile.stance_distribution.strong_disagree > 0 && (
                      <span className="text-muted-foreground">
                        --: {profile.stance_distribution.strong_disagree}
                      </span>
                    )}
                    {profile.stance_distribution.disagree > 0 && (
                      <span className="text-muted-foreground">
                        -: {profile.stance_distribution.disagree}
                      </span>
                    )}
                    {profile.stance_distribution.neutral > 0 && (
                      <span className="text-muted-foreground">
                        0: {profile.stance_distribution.neutral}
                      </span>
                    )}
                    {profile.stance_distribution.agree > 0 && (
                      <span className="text-muted-foreground">
                        +: {profile.stance_distribution.agree}
                      </span>
                    )}
                    {profile.stance_distribution.strong_agree > 0 && (
                      <span className="text-muted-foreground">
                        ++: {profile.stance_distribution.strong_agree}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stance Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Overall Stance Distribution</CardTitle>
          <CardDescription>
            How your responses are distributed across the spectrum
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(cognitive_profile.stance_distribution).map(([key, count]) => {
              const total = cognitive_profile.overall_orientation.total_questions;
              const percentage = (count / total) * 100;
              
              return (
                <div key={key} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="capitalize font-medium">
                      {key.replace('_', ' ')}
                    </span>
                    <span className="text-muted-foreground">
                      {count} ({percentage.toFixed(0)}%)
                    </span>
                  </div>
                  <Progress value={percentage} className="h-2" />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Metadata */}
      <div className="text-xs text-muted-foreground text-center">
        Last calculated: {new Date(cognitiveState.evaluated_at).toLocaleString()}
        {' • '}
        Based on {cognitive_profile.evaluation_period_days} days of activity
      </div>
    </div>
  );
}
