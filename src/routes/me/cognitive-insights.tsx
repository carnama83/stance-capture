// src/routes/me/cognitive-insights.tsx
import React from 'react';
import { CognitiveStateViewer } from '@/components/cognitive/CognitiveStateViewer';
import { useCalculateCognitiveState, useShouldRecalculateCognitiveState } from '@/hooks/useCognitiveState';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCw, Info } from 'lucide-react';
import { useTranslation } from "react-i18next";

export default function CognitiveInsightsPage() {
  const { t } = useTranslation();
  const { mutate: calculateState, isPending } = useCalculateCognitiveState();
  const { data: shouldRecalculate } = useShouldRecalculateCognitiveState();

  return (
    <div className="container mx-auto py-8 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">{t("cognitiveinsights.yourCognitiveInsights")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("cognitiveinsights.understandingYourStancePatternsAnd")}
          </p>
        </div>
        <Button
          onClick={() => calculateState()}
          disabled={isPending}
          variant="outline"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? 'animate-spin' : ''}`} />
          {t("cognitiveinsights.recalculate")}
        </Button>
      </div>

      {/* Recalculation Notice */}
      {shouldRecalculate && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            {t("cognitiveinsights.yourCognitiveProfileCanBe")}
            <Button
              variant="link"
              className="ml-2 p-0 h-auto"
              onClick={() => calculateState()}
              disabled={isPending}
            >
              {t("cognitiveinsights.updateNow")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Info Box */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>{t("cognitiveinsights.whatIsACognitiveProfile")}</strong>
          <br />
          {t("cognitiveinsights.yourCognitiveProfileIsAutomatically")}
        </AlertDescription>
      </Alert>

      {/* Main Viewer */}
      <CognitiveStateViewer />
    </div>
  );
}
