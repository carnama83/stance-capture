import { useActiveQuestions } from '@/hooks/useQuestionLifecycle';
import { QuestionCard } from './QuestionCard';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from "react-i18next";

interface ActiveQuestionsFeedProps {
  limit?: number;
  className?: string;
}

export function ActiveQuestionsFeed({ 
  limit = 20,
  className = '',
}: ActiveQuestionsFeedProps) {
  const { t } = useTranslation();
  const { data: questions, isLoading, error } = useActiveQuestions(limit);
  
  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-gray-600">{t("activeQuestionsFeed.loadingQuestions")}</span>
      </div>
    );
  }
  
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {t("activeQuestionsFeed.failedToLoadQuestions")} {error.message}
        </AlertDescription>
      </Alert>
    );
  }
  
  if (!questions || questions.length === 0) {
    return (
      <div className="text-center p-12 bg-gray-50 rounded-lg">
        <p className="text-gray-600 text-lg mb-2">{t("activeQuestionsFeed.noActiveQuestionsRightNow")}</p>
        <p className="text-sm text-gray-500">{t("activeQuestionsFeed.checkBackSoonForNew")}</p>
      </div>
    );
  }
  
  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">
          {t("activeQuestionsFeed.activeQuestions")}
        </h2>
        <span className="text-sm text-gray-500">
          {t("activeQuestionsFeed.questionCount", { count: questions.length })}
        </span>
      </div>
      
      <div className="space-y-3">
        {questions.map((question) => (
          <QuestionCard key={question.id} question={question} />
        ))}
      </div>
    </div>
  );
}
