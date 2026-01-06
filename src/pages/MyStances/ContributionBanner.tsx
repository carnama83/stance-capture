// src/pages/MyStances/ContributionBanner.tsx
import * as React from "react";
import { X } from "lucide-react";
import { useContributionAcknowledgement } from "@/hooks/useContributionAcknowledgement";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Inline banner version - shows on the My Stances page
 * This is less intrusive than a toast and fits the Epic Q tone better
 */
export default function ContributionBanner() {
  const { acknowledgement, dismiss } = useContributionAcknowledgement();

  if (!acknowledgement || !acknowledgement.should_show) {
    return null;
  }

  return (
    <Alert className="mb-4 border-slate-200 bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <AlertDescription className="text-sm text-slate-800 flex-1">
          <div className="font-medium mb-0.5">
            {acknowledgement.message}
          </div>
          {acknowledgement.secondary_text && (
            <div className="text-xs text-slate-600 mt-1">
              {acknowledgement.secondary_text}
            </div>
          )}
        </AlertDescription>
        <button
          onClick={() => dismiss()}
          className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors -mt-0.5"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </Alert>
  );
}
