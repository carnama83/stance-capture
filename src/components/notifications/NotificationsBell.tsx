// src/components/notifications/NotificationsBell.tsx
import * as React from 'react';
import { Bell } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useUnreadNotificationCount } from '@/hooks/useUnreadNotificationCount';
import { NotificationsPanel } from './NotificationsPanel';

export function NotificationsBell() {
  const [open, setOpen] = React.useState(false);
  const { count } = useUnreadNotificationCount();

  // Cap badge display at 9+
  const badgeLabel = count > 9 ? '9+' : count > 0 ? String(count) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `${count} unread notifications` : 'Notifications'}
          className="relative flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-5 w-5" />
          {badgeLabel && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-500 text-white text-[10px] font-semibold leading-none">
              {badgeLabel}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="p-0 shadow-lg border border-border rounded-xl overflow-hidden"
        style={{ width: 'auto' }}
      >
        <NotificationsPanel onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
