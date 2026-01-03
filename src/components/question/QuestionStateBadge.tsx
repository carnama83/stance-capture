import { Badge } from '@/components/ui/badge';
import { STATE_CONFIG, type QuestionState } from '@/types/questionLifecycleTypes';

interface QuestionStateBadgeProps {
  state: QuestionState;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function QuestionStateBadge({ 
  state, 
  showIcon = true,
  size = 'md',
  className = '',
}: QuestionStateBadgeProps) {
  const config = STATE_CONFIG[state];
  
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5',
  };
  
  return (
    <Badge 
      variant="secondary"
      className={`
        ${config.bgColor} 
        ${config.color} 
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {showIcon && <span className="mr-1">{config.icon}</span>}
      {config.label}
    </Badge>
  );
}
