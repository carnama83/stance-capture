// src/components/notifications/NotificationsPanel.tsx
import * as React from 'react';
import { Loader2, CheckCheck } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useMyNotifications } from '@/hooks/useMyNotifications';
import { useMarkNotificationRead, useMarkAllNotificationsRead } from '@/hooks/useMarkNotificationRead';
import { NotificationListItem } from './NotificationListItem';

interface NotificationsPanelProps {
  onClose: () => void;
}

export function NotificationsPanel({ onClose }: NotificationsPanelProps) {
  const { data: notifications, isLoading, isError } = useMyNotifications({ limit: 15 });
  const { markRead }    = useMarkNotificationRead();
  const { markAllRead, isPending: isMarkingAll } = useMarkAllNotificationsRead();

  const hasUnread = notifications.some((n) => !n.isRead);

  return (
    <div className="flex flex-col" style={{ width: 360, maxWidth: '100vw' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Notifications</span>
        {hasUnread && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => markAllRead()}
            disabled={isMarkingAll}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </Button>
        )}
      </div>

      {/* Body */}
      <ScrollArea className="max-h-[480px]">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Couldn't load notifications.
          </div>
        )}

        {!isLoading && !isError && notifications.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-foreground">You're all caught up.</p>
            <p className="mt-1 text-xs text-muted-foreground">No new notifications right now.</p>
          </div>
        )}

        {!isLoading && !isError && notifications.length > 0 && (
          <div className="divide-y divide-border">
            {notifications.map((notification) => (
              <NotificationListItem
                key={notification.id}
                notification={notification}
                onRead={markRead}
                onClose={onClose}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
