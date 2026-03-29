// src/components/notifications/NotificationListItem.tsx
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, TrendingUp, BookOpen } from 'lucide-react';
import { type UserNotification, type NotificationType } from '@/hooks/notificationTypes';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabaseClient';

function NotificationIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case 'topic_follow':
      return <TrendingUp className="h-4 w-4 text-blue-500 shrink-0" />;
    case 'stance_change':
      return <Bell className="h-4 w-4 text-amber-500 shrink-0" />;
    case 'weekly_digest':
      return <BookOpen className="h-4 w-4 text-violet-500 shrink-0" />;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// S2: track click-through for alert-to-action conversion metric
async function markClicked(notificationId: string) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    await sb
      .from('user_notifications')
      .update({ clicked_at: new Date().toISOString() })
      .eq('id', notificationId);
  } catch {
    // Non-critical — silently ignore
  }
}

interface NotificationListItemProps {
  notification: UserNotification;
  onRead: (id: string) => void;
  onClose: () => void;
}

export function NotificationListItem({
  notification,
  onRead,
  onClose,
}: NotificationListItemProps) {
  const navigate = useNavigate();

  const handleClick = async () => {
    if (!notification.isRead) {
      onRead(notification.id);
    }
    await markClicked(notification.id);
    if (notification.href) {
      onClose();
      navigate(notification.href);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full text-left flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:bg-accent',
        !notification.isRead && 'bg-blue-50/60 dark:bg-blue-950/20',
        notification.href ? 'cursor-pointer' : 'cursor-default',
      )}
    >
      {/* Unread dot */}
      <span className="mt-1 shrink-0 w-2">
        {!notification.isRead && (
          <span className="block w-2 h-2 rounded-full bg-blue-500" />
        )}
      </span>

      {/* Icon */}
      <span className="mt-0.5">
        <NotificationIcon type={notification.notificationType} />
      </span>

      {/* Content */}
      <span className="flex-1 min-w-0 space-y-0.5">
        <span
          className={cn(
            'block text-sm leading-snug',
            !notification.isRead ? 'font-medium text-foreground' : 'font-normal text-foreground',
          )}
        >
          {notification.title}
        </span>
        {notification.body && (
          <span className="block text-xs text-muted-foreground leading-snug line-clamp-2">
            {notification.body}
          </span>
        )}
        <span className="block text-xs text-muted-foreground/70">
          {timeAgo(notification.createdAt)}
        </span>
      </span>
    </button>
  );
}
