// src/routes/me/cognitive-insights.tsx
import React from 'react';
import { CognitiveStateViewer } from '@/components/cognitive/CognitiveStateViewer';
import { useCalculateCognitiveState, useShouldRecalculateCognitiveState } from '@/hooks/useCognitiveState';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCw, Info } from 'lucide-react';

export default function CognitiveInsightsPage() {
  const { mutate: calculateState, isPending } = useCalculateCognitiveState();
  const { data: shouldRecalculate } = useShouldRecalculateCognitiveState();

  return (
    <div className="container mx-auto py-8 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Your Cognitive Insights</h1>
          <p className="text-muted-foreground mt-1">
            Understanding your stance patterns and engagement
          </p>
        </div>
        <Button
          onClick={() => calculateState()}
          disabled={isPending}
          variant="outline"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? 'animate-spin' : ''}`} />
          Recalculate
        </Button>
      </div>

      {/* Recalculation Notice */}
      {shouldRecalculate && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Your cognitive profile can be updated based on your recent activity.
            <Button
              variant="link"
              className="ml-2 p-0 h-auto"
              onClick={() => calculateState()}
              disabled={isPending}
            >
              Update now
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Info Box */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>What is a Cognitive Profile?</strong>
          <br />
          Your cognitive profile is automatically calculated from your responses to questions.
          It shows your overall stance patterns, consistency across topics, and engagement trends.
          This helps you understand your own thinking and see how it evolves over time.
        </AlertDescription>
      </Alert>

      {/* Main Viewer */}
      <CognitiveStateViewer />
    </div>
  );
}
