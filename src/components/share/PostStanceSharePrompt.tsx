// src/components/share/PostStanceSharePrompt.tsx
// Epic W — Social Sharing (W1)
//
// Shown after a user submits their stance for the first time on a question.
// "Want to see what others think? Share this question."
// Dismissible, persists dismissal in sessionStorage per question.

import * as React from "react";
import { Share2, X } from "lucide-react";
import { ShareButton } from "./ShareButton";

interface PostStanceSharePromptProps {
  questionId: string;
  questionText: string;
  questionSummary?: string | null;
  onDismiss?: () => void;
  languageCode?: string;
}

export function PostStanceSharePrompt({
  questionId,
  questionText,
  questionSummary,
  onDismiss,
  languageCode,
}: PostStanceSharePromptProps) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // Only show if this question hasn't been dismissed this session
    const dismissed = sessionStorage.getItem(`share_prompt_dismissed_${questionId}`);
    if (!dismissed) setVisible(true);
  }, [questionId]);

  function dismiss() {
    sessionStorage.setItem(`share_prompt_dismissed_${questionId}`, "1");
    setVisible(false);
    onDismiss?.();
  }

  if (!visible) return null;

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 flex items-start gap-3 mt-4">
      <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
        <Share2 className="h-4 w-4 text-blue-600" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-blue-900">Want to see what others think?</p>
        <p className="text-xs text-blue-700 mt-0.5">
          Share this question and help grow the conversation.
        </p>
        <div className="mt-3">
          <ShareButton
            questionId={questionId}
            questionText={questionText}
            questionSummary={questionSummary}
            shareType="stance"
            languageCode={languageCode}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 p-1 rounded text-blue-400 hover:text-blue-600 hover:bg-blue-100 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
