import { Link } from 'react-router-dom';
import type { QuestionWithLifecycle } from '@/types/questionLifecycleTypes';
import { 
  QuestionStateBadge 
} from './QuestionStateBadge';
import { TrendingBadge } from './TrendingBadge';
import { QuestionCoverImage } from './QuestionCoverImage';
import { formatAgeDays, calculateAgeDays } from '@/types/questionLifecycleTypes';
import { Badge } from '@/components/ui/badge';
import { MessageSquare } from 'lucide-react';
import { ShareButton } from '@/components/share/ShareButton';

interface QuestionCardProps {
  question: QuestionWithLifecycle & {
    cover_image_url?: string | null;
  };
  showEngagement?: boolean;
  showCover?: boolean;
  className?: string;
}

export function QuestionCard({ 
  question, 
  showEngagement = true,
  showCover = true,
  className = '',
}: QuestionCardProps) {
  const ageDays = calculateAgeDays(question.published_at);
  
  return (
    <Link 
      to={`/q/${question.id}`}
      className={`
        block border rounded-lg overflow-hidden bg-white 
        hover:shadow-md hover:border-blue-300
        transition-all duration-200
        ${className}
      `}
    >
      {showCover && (
        <QuestionCoverImage
          imageUrl={question.cover_image_url}
          tags={question.tags}
          variant="banner"
          bannerHeight={100}
        />
      )}

      <div className="p-4">
      {/* Header with badges */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex flex-wrap gap-2">
          <QuestionStateBadge state={question.state} size="sm" />
          
          {question.is_trending && (
            <TrendingBadge
              trendingScore={question.trending_score}
              responsesTotal={question.engagement?.responses_total}
            />
          )}
          
          {question.is_featured && (
            <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-xs">
              ⭐ Featured
            </Badge>
          )}
          
          {question.is_resolved && (
            <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
              ✅ Resolved
            </Badge>
          )}
        </div>
        
        <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
          {formatAgeDays(ageDays)}
        </span>
      </div>
      
      {/* Question text */}
      <h3 className="text-lg font-semibold mb-2 text-gray-900 hover:text-blue-600">
        {question.question}
      </h3>
      
      {/* Summary */}
      {question.summary && (
        <p className="text-sm text-gray-600 mb-3 line-clamp-2">
          {question.summary}
        </p>
      )}
      
      {/* Location label */}
      {question.location_label && (
        <div className="text-xs text-gray-500 mb-3">
          📍 {question.location_label}
        </div>
      )}
      
      {/* Engagement stats */}
      {showEngagement && question.engagement && (
        <div className="flex items-center gap-4 text-sm text-gray-500 border-t pt-2">
          <div className="flex items-center gap-1">
            <MessageSquare className="w-4 h-4" />
            <span>{question.engagement.responses_total} {question.engagement.responses_total === 1 ? "stance recorded" : "stances recorded"}</span>
          </div>
          
          {question.engagement.response_rate_24h > 0 && (
            <div>
              <span className="font-medium text-blue-600">
                {Math.round(question.engagement.response_rate_24h)}
              </span>
              <span className="ml-1">today</span>
            </div>
          )}

          <div className="ml-auto">
            <ShareButton
              questionId={question.id}
              questionText={question.question}
              questionSummary={question.summary}
              compact
            />
          </div>
        </div>
      )}
      
      {/* Resolution summary */}
      {question.is_resolved && question.resolution_summary && (
        <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded text-sm">
          <span className="font-semibold text-green-800">Resolved: </span>
          <span className="text-green-700">{question.resolution_summary}</span>
        </div>
      )}
      </div>
    </Link>
  );
}
