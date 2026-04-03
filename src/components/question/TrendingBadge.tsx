import { Badge } from '@/components/ui/badge';
import { Flame, Zap, TrendingUp } from 'lucide-react';

// S3: signal type — matches classifySignal in WhyIsTrendingPanel.
// At the feed card level we derive this from trending_score alone;
// the full classification (with velocity + media surge) is in the detail panel.
export type TrendingSignalType = 'media-driven' | 'organic' | 'polarising' | 'steady';

interface TrendingBadgeProps {
  trendingScore?: number;
  showScore?: boolean;
  // Optional: explicit signal from WhyIsTrendingPanel or derived from score
  signalType?: TrendingSignalType;
  className?: string;
}

const SIGNAL_CONFIG: Record<TrendingSignalType, {
  label: string;
  Icon: React.ElementType;
  badgeClass: string;
}> = {
  'media-driven': { label: 'Media spike',  Icon: Zap,        badgeClass: 'bg-amber-500 hover:bg-amber-600 border-0' },
  'organic':      { label: 'Organic',      Icon: TrendingUp, badgeClass: 'bg-emerald-600 hover:bg-emerald-700 border-0' },
  'polarising':   { label: 'Polarising',   Icon: Flame,      badgeClass: 'bg-red-500 hover:bg-red-600 border-0' },
  'steady':       { label: 'Trending',     Icon: Flame,      badgeClass: 'bg-orange-500 hover:bg-orange-600 border-0' },
};

// Derive signal from score when explicit signalType is not provided
function deriveSignal(score?: number): TrendingSignalType {
  if (!score) return 'steady';
  if (score >= 70) return 'organic';
  if (score >= 40) return 'steady';
  return 'steady';
}

export function TrendingBadge({ 
  trendingScore, 
  showScore = false,
  signalType,
  className = '',
}: TrendingBadgeProps) {
  const resolved = signalType ?? deriveSignal(trendingScore);
  const { label, Icon, badgeClass } = SIGNAL_CONFIG[resolved];

  return (
    <Badge 
      variant="destructive" 
      className={`${badgeClass} ${className}`}
    >
      <Icon className="w-3 h-3 mr-1" />
      {label}
      {showScore && trendingScore && (
        <span className="ml-1 text-xs opacity-90">
          ({Math.round(trendingScore)})
        </span>
      )}
    </Badge>
  );
}
