// src/components/notifications/NotificationsPanel.tsx
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, CheckCheck, Settings } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useMyNotifications } from "@/hooks/useMyNotifications";
import { useMarkNotificationRead, useMarkAllNotificationsRead } from "@/hooks/useMarkNotificationRead";
import { NotificationListItem } from "./NotificationListItem";
import { WeeklyDigestCard } from "./WeeklyDigestCard";

interface NotificationsPanelProps {
  onClose: () => void;
}

export function NotificationsPanel({ onClose }: NotificationsPanelProps) {
  const navigate = useNavigate();
  const { data: notifications, isLoading, isError } = useMyNotifications({ limit: 15 });
  const { markRead } = useMarkNotificationRead();
  const { markAllRead, isPending: isMarkingAll } = useMarkAllNotificationsRead();

  // When a digest notification is clicked, show the digest inline
  const [showDigest, setShowDigest] = React.useState(false);

  const hasUnread = notifications.some((n) => !n.isRead);

  const handleItemClick = (id: string, type: string, href: string | null) => {
    markRead(id);
    if (type === "weekly_digest") {
      setShowDigest(true);
      return;
    }
    if (href) {
      onClose();
      navigate(href);
    }
  };

  // Digest view — replaces the list
  if (showDigest) {
    return (
      <div style={{ width: 360, maxWidth: "100vw" }}>
        <WeeklyDigestCard onClose={() => setShowDigest(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ width: 360, maxWidth: "100vw" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Notifications</span>
        <div className="flex items-center gap-1">
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
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => { onClose(); navigate("/settings/notifications"); }}
            aria-label="Notification settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
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
          <div className="px-6 py-10 text-center space-y-3">
            <p className="text-sm font-medium text-foreground">You're all caught up.</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Follow topics to get activity updates, or answer more questions to receive stance shift alerts.
            </p>
            <button
              type="button"
              onClick={() => { onClose(); navigate("/topics"); }}
              className="text-xs text-blue-600 hover:underline font-medium"
            >
              Browse topics →
            </button>
          </div>
        )}

        {!isLoading && !isError && notifications.length > 0 && (
          <div className="divide-y divide-border">
            {notifications.map((notification) => (
              <NotificationListItem
                key={notification.id}
                notification={notification}
                onRead={(id) => handleItemClick(id, notification.notificationType, notification.href)}
                onClose={onClose}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
