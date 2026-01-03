import { Badge } from '@/components/ui/badge';
import { Flame } from 'lucide-react';

interface TrendingBadgeProps {
  trendingScore?: number;
  showScore?: boolean;
  className?: string;
}

export function TrendingBadge({ 
  trendingScore, 
  showScore = false,
  className = '',
}: TrendingBadgeProps) {
  return (
    <Badge 
      variant="destructive" 
      className={`bg-orange-500 hover:bg-orange-600 ${className}`}
    >
      <Flame className="w-3 h-3 mr-1" />
      Trending
      {showScore && trendingScore && (
        <span className="ml-1 text-xs opacity-90">
          ({Math.round(trendingScore)}/day)
        </span>
      )}
    </Badge>
  );
}
