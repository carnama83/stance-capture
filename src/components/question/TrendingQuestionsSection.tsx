import { useTrendingQuestions } from '@/hooks/useQuestionLifecycle';
import { QuestionCard } from './QuestionCard';
import { Flame } from 'lucide-react';

interface TrendingQuestionsSectionProps {
  limit?: number;
  className?: string;
}

export function TrendingQuestionsSection({ 
  limit = 5,
  className = '',
}: TrendingQuestionsSectionProps) {
  const { data: trending, isLoading } = useTrendingQuestions(limit);
  
  // Don't show section if no trending questions
  if (!trending || trending.length === 0 || isLoading) {
    return null;
  }
  
  return (
    <div className={`mb-8 ${className}`}>
      {/* Section header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-2 text-orange-600">
          <Flame className="w-6 h-6" />
          <h2 className="text-2xl font-bold">Trending Now</h2>
        </div>
        <span className="text-sm text-gray-500">
          ({trending.length})
        </span>
      </div>
      
      {/* Horizontal scroll on mobile, grid on desktop */}
      <div className="
        flex gap-4 overflow-x-auto pb-4
        md:grid md:grid-cols-2 md:overflow-x-visible
        lg:grid-cols-3
      ">
        {trending.map((q) => (
          <div 
            key={q.question_id} 
            className="flex-shrink-0 w-80 md:w-auto"
          >
            <QuestionCard 
              question={q as any} 
              showEngagement 
            />
          </div>
        ))}
      </div>
    </div>
  );
}
