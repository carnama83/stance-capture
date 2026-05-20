// src/components/TopicMuteButton.tsx
// M-I05 (partial): Mute/unmute topic notifications directly from TopicDetailPage.
// Reads current mute state from notification_topic_prefs on mount.
// Calls set_topic_notification_pref RPC to toggle.
// Only renders for authenticated users.

import * as React from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabaseClient";
import { toast } from "@/components/ui/use-toast";

interface TopicMuteButtonProps {
  topicId: string;
}

export function TopicMuteButton({ topicId }: TopicMuteButtonProps) {
  // null = loading, true = muted, false = not muted, "unauthed" = no session
  const [state, setState] = React.useState<boolean | null | "unauthed">(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      const sb = getSupabase();
      if (!sb) return;

      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        if (!cancelled) setState("unauthed");
        return;
      }

      const { data, error } = await sb
        .from("notification_topic_prefs")
        .select("muted")
        .eq("topic_id", topicId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("TopicMuteButton: failed to load pref", error);
        setState(false);
        return;
      }

      // Absence of row = not muted
      setState(data?.muted === true);
    }

    load();
    return () => { cancelled = true; };
  }, [topicId]);

  async function handleToggle() {
    if (state === null || state === "unauthed" || saving) return;

    const nextMuted = !state;
    setSaving(true);

    const sb = getSupabase();
    if (!sb) { setSaving(false); return; }

    const { error } = await sb.rpc("set_topic_notification_pref", {
      p_topic_id: topicId,
      p_muted: nextMuted,
    });

    setSaving(false);

    if (error) {
      console.error("TopicMuteButton: set_topic_notification_pref failed", error);
      toast({
        title: "Couldn't update notification preference",
        description: "Please try again.",
        variant: "destructive",
      });
      return;
    }

    setState(nextMuted);
    toast({
      title: nextMuted
        ? "Topic notifications muted"
        : "Topic notifications unmuted",
    });
  }

  // Don't render for unauthenticated users or while loading session
  if (state === "unauthed" || state === null) return null;

  const isMuted = state === true;

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={saving}
      aria-label={isMuted ? "Unmute topic notifications" : "Mute topic notifications"}
      title={isMuted ? "Unmute notifications for this topic" : "Mute notifications for this topic"}
      className={[
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        isMuted
          ? "border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
      ].join(" ")}
    >
      {saving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isMuted ? (
        <BellOff className="h-3.5 w-3.5" />
      ) : (
        <Bell className="h-3.5 w-3.5" />
      )}
      {isMuted ? "Muted" : "Notify"}
    </button>
  );
}
