// src/components/notifications/NotificationListItem.tsx
//
// S2 FIX: Enhanced rendering for stance_change notification subtypes.
// The notify-stance-changes edge function stores metadata.eventKind for each
// notification: 'community_shift' | 'regional_shift' | 'region_divergence'.
// Previously all three rendered identically (Bell icon, same amber colour).
// Now each subtype has a distinct icon, colour, and subtitle line showing
// the key numbers from metadata (delta, regionLabel, etc.)
//
// Also: 'reminder' and 'new_local_topic' types now have distinct icons
// instead of falling through to the generic Bell.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, TrendingUp, BookOpen, MapPin, Globe,
  RefreshCcw, Newspaper, AlertCircle, Lightbulb,
} from "lucide-react";
import { type UserNotification, type NotificationType } from "@/hooks/notificationTypes";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/lib/supabaseClient";

// ── Icon selection ────────────────────────────────────────────────────────────

type EventKind = "community_shift" | "regional_shift" | "region_divergence" | string;

function NotificationIcon({
  type,
  eventKind,
}: {
  type: NotificationType;
  eventKind?: EventKind;
}) {
  if (type === "stance_change") {
    switch (eventKind) {
      case "community_shift":
        return <Globe className="h-4 w-4 text-amber-500 shrink-0" />;
      case "regional_shift":
        return <MapPin className="h-4 w-4 text-orange-500 shrink-0" />;
      case "region_divergence":
        return <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />;
      default:
        return <Bell className="h-4 w-4 text-amber-500 shrink-0" />;
    }
  }
  switch (type) {
    case "topic_follow":
      return <TrendingUp className="h-4 w-4 text-blue-500 shrink-0" />;
    case "weekly_digest":
      return <BookOpen className="h-4 w-4 text-violet-500 shrink-0" />;
    case "reminder":
      return <RefreshCcw className="h-4 w-4 text-emerald-500 shrink-0" />;
    case "new_local_topic":
      return <Newspaper className="h-4 w-4 text-sky-500 shrink-0" />;
    case "ugq_submitted":
    case "ugq_published":
    case "ugq_rejected":
    case "ugq_milestone":
    case "ugq_flagged":
    case "ugq_unflagged":
      return <Lightbulb className="h-4 w-4 text-amber-500 shrink-0" />;
    default:
      return <Bell className="h-4 w-4 text-slate-400 shrink-0" />;
  }
}

// ── Subtitle line from metadata ────────────────────────────────────────────────
// Surfaces the key numbers stored in metadata so the user can understand
// the alert without clicking through.

function StanceChangeSubtitle({
  eventKind,
  metadata,
}: {
  eventKind?: EventKind;
  metadata: Record<string, unknown>;
}) {
  if (eventKind === "community_shift") {
    const delta = typeof metadata.delta === "number" ? metadata.delta.toFixed(1) : null;
    const scope = metadata.regionScope === "global" ? "Globally" : String(metadata.regionKey ?? "");
    if (!delta) return null;
    return (
      <span className="block text-xs text-amber-600/80 mt-0.5">
        {scope} opinion shifted by {delta} points
      </span>
    );
  }

  if (eventKind === "regional_shift") {
    const region = metadata.regionKey as string | undefined;
    const delta = typeof metadata.delta === "number" ? metadata.delta.toFixed(1) : null;
    if (!delta) return null;
    return (
      <span className="block text-xs text-orange-600/80 mt-0.5">
        {region ? `${region}: ` : ""}Opinion shifted by {delta} points in your area
      </span>
    );
  }

  if (eventKind === "region_divergence") {
    const region = metadata.regionLabel as string | undefined;
    const regional = typeof metadata.regionalAvg === "number" ? metadata.regionalAvg.toFixed(1) : null;
    const global_ = typeof metadata.globalAvg === "number" ? metadata.globalAvg.toFixed(1) : null;
    if (!regional || !global_) return null;
    return (
      <span className="block text-xs text-red-500/80 mt-0.5">
        {region ? `${region}` : "Your area"}: {regional} vs national: {global_}
      </span>
    );
  }

  return null;
}

// ── Time helper ────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Click tracking ─────────────────────────────────────────────────────────────

async function markClicked(notificationId: string) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    await sb
      .from("user_notifications")
      .update({ clicked_at: new Date().toISOString() })
      .eq("id", notificationId);
  } catch {
    // Non-critical — silently ignore
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

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

  // Extract eventKind from metadata for stance_change subtypes
  const eventKind = notification.notificationType === "stance_change"
    ? (notification.metadata?.eventKind as EventKind | undefined)
    : undefined;

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
        "w-full text-left flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:bg-accent",
        !notification.isRead && "bg-blue-50/60 dark:bg-blue-950/20",
        notification.href ? "cursor-pointer" : "cursor-default",
      )}
    >
      {/* Unread dot */}
      <span className="mt-1 shrink-0 w-2">
        {!notification.isRead && (
          <span className="block w-2 h-2 rounded-full bg-blue-500" />
        )}
      </span>

      {/* Icon — now subtype-aware */}
      <span className="mt-0.5">
        <NotificationIcon type={notification.notificationType} eventKind={eventKind} />
      </span>

      {/* Content */}
      <span className="flex-1 min-w-0 space-y-0.5">
        <span
          className={cn(
            "block text-sm leading-snug",
            !notification.isRead ? "font-medium text-foreground" : "font-normal text-foreground",
          )}
        >
          {notification.title}
        </span>

        {/* S2: Subtype-specific metadata line for stance_change notifications */}
        {notification.notificationType === "stance_change" && eventKind && (
          <StanceChangeSubtitle eventKind={eventKind} metadata={notification.metadata} />
        )}

        {/* Standard body for other notification types */}
        {notification.body && notification.notificationType !== "stance_change" && (
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
