// src/pages/SettingsNotifications.tsx
// UPDATED (Epic L — per-scope notification granularity):
//   Added "Per-topic notifications" section at the bottom.
//   Shows all followed topics. Each has a mute toggle.
//   Calls set_topic_notification_pref RPC (from l_notification_topic_prefs
//   migration) — optimistically updates UI, syncs to DB.
//   Absence of a row = notifications on. Row with muted=true = silenced.

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyNotificationPreferences, useUpsertNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { type DigestFrequency } from "@/hooks/notificationTypes";
import { useToast } from "@/hooks/use-toast";
import { getSupabase } from "@/lib/supabaseClient";
import { Loader2, BellOff, Bell } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? "AM" : "PM";
  const h = i % 12 === 0 ? 12 : i % 12;
  return { value: i, label: `${h}:00 ${ampm}` };
});

const TIMEZONES = [
  "America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
  "America/Anchorage","Pacific/Honolulu","Europe/London","Europe/Paris",
  "Europe/Berlin","Asia/Dubai","Asia/Kolkata","Asia/Singapore",
  "Asia/Tokyo","Australia/Sydney","Pacific/Auckland",
];

function SectionCard({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, description, checked, onChange, disabled }: {
  label: string; description?: string; checked: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <div className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500 mt-0.5">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          "relative shrink-0 mt-0.5 inline-flex h-5 w-9 items-center rounded-full transition-colors",
          checked ? "bg-blue-500" : "bg-slate-200",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <span className={[
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        ].join(" ")} />
      </button>
    </label>
  );
}

function SelectField({ label, value, onChange, options, disabled }: {
  label: string; value: string | number;
  onChange: (v: string) => void;
  options: Array<{ value: string | number; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── L: Per-topic granularity ──────────────────────────────────────────────────

type FollowedTopic = { topic_id: string; topic_title: string };
type MutedMap = Record<string, boolean>;

function useFollowedTopics() {
  return useQuery<FollowedTopic[]>({
    queryKey: ["followed-topics-notif"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase client not available");
      // L-08: this used to drop `error`, so a failed query rendered as "you haven't
      // followed any topics yet" — indistinguishable from the genuine empty state.
      const { data, error } = await sb
        .from("user_topic_follows")
        .select("topic_id, topics(id, title)")
        .order("followed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        topic_id:    r.topic_id,
        topic_title: r.topics?.title ?? r.topic_id,
      }));
    },
  });
}

function useMutedTopics() {
  return useQuery<MutedMap>({
    queryKey: ["muted-topic-prefs"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase client not available");
      // L-08: same swallowed-error shape as useFollowedTopics — a failure here silently
      // showed every topic as unmuted.
      const { data, error } = await sb
        .from("notification_topic_prefs")
        .select("topic_id")
        .eq("muted", true);
      if (error) throw error;
      const map: MutedMap = {};
      for (const r of data ?? []) map[(r as any).topic_id] = true;
      return map;
    },
  });
}

function useSetTopicMute() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ topicId, muted }: { topicId: string; muted: boolean }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.rpc("set_topic_notification_pref", {
        p_topic_id: topicId,
        p_muted:    muted,
      });
      if (error) throw error;
    },
    onMutate: async ({ topicId, muted }) => {
      await qc.cancelQueries({ queryKey: ["muted-topic-prefs"] });
      const prev = qc.getQueryData<MutedMap>(["muted-topic-prefs"]) ?? {};
      qc.setQueryData<MutedMap>(["muted-topic-prefs"], { ...prev, [topicId]: muted });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["muted-topic-prefs"], ctx.prev);
      toast({ title: t("settingsNotif.failedToSave"), variant: "destructive" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["muted-topic-prefs"] }),
  });
}

function TopicNotificationsSection() {
  const { t } = useTranslation();
  const { data: topics, isLoading, isError, refetch } = useFollowedTopics();
  const { data: mutedMap = {}, isError: mutedError } = useMutedTopics();
  const { mutate: setMute, isPending } = useSetTopicMute();

  if (isLoading) return (
    <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("settingsNotif.loadingFollowedTopics")}
    </div>
  );

  // L-08: a failed load must not masquerade as "no followed topics".
  if (isError || mutedError) return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
      <p className="text-xs text-amber-800">
        {t("settingsNotif.couldnTLoadYourTopic")}{" "}
        <button
          type="button"
          onClick={() => refetch()}
          className="underline font-medium hover:text-amber-900"
        >
          {t("settingsNotif.tryAgain")}
        </button>
      </p>
    </div>
  );

  if (!topics?.length) return (
    <p className="text-xs text-slate-400 py-2">
      <Trans
        i18nKey="settingsNotif.noFollowedTopics"
        components={{ a: <a href="/#/topics" className="text-blue-500 hover:underline" /> }}
      />
    </p>
  );

  const mutedCount = Object.values(mutedMap).filter(Boolean).length;

  return (
    <div className="space-y-3">
      {mutedCount > 0 && (
        <p className="text-xs text-slate-500">
          {t("settingsNotif.mutedCount", { count: mutedCount })}
        </p>
      )}
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
        {topics.map((topic) => {
          const isMuted = mutedMap[topic.topic_id] === true;
          return (
            <div
              key={topic.topic_id}
              className={`flex items-center justify-between gap-4 px-4 py-3 ${isMuted ? "bg-slate-50" : "bg-white"}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isMuted
                  ? <BellOff className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  : <Bell    className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                }
                <span className={`text-sm truncate ${isMuted ? "text-slate-400 line-through" : "text-slate-800"}`}>
                  {topic.topic_title}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!isMuted}
                aria-label={t(
                  isMuted ? "settingsNotif.unmuteTopicAria" : "settingsNotif.muteTopicAria",
                  { topic: topic.topic_title }
                )}
                disabled={isPending}
                onClick={() => setMute({ topicId: topic.topic_id, muted: !isMuted })}
                className={[
                  "relative shrink-0 inline-flex h-5 w-9 items-center rounded-full transition-colors",
                  !isMuted ? "bg-blue-500" : "bg-slate-200",
                  isPending ? "opacity-50 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span className={[
                  "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                  !isMuted ? "translate-x-4" : "translate-x-0.5",
                ].join(" ")} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsNotifications() {
  const { t } = useTranslation();
  const { data: prefs, isLoading } = useMyNotificationPreferences();
  const { savePreferences, isPending } = useUpsertNotificationPreferences();
  const { toast } = useToast();

  const [stanceChange, setStanceChange]     = React.useState(true);
  const [weeklyDigest, setWeeklyDigest]     = React.useState(true);
  const [topicFollow, setTopicFollow]       = React.useState(true);
  const [reminder, setReminder]             = React.useState(true);
  const [newLocalTopic, setNewLocalTopic]   = React.useState(true);
  const [inapEnabled, setInapEnabled]       = React.useState(true);
  const [emailEnabled, setEmailEnabled]     = React.useState(false);
  const [digestFrequency, setDigestFrequency] = React.useState<DigestFrequency>("weekly");
  const [digestDay, setDigestDay]   = React.useState(1);
  const [digestHour, setDigestHour] = React.useState(9);
  const [timezone, setTimezone]     = React.useState("America/New_York");
  const [quietEnabled, setQuietEnabled] = React.useState(false);
  const [quietStart, setQuietStart] = React.useState(22);
  const [quietEnd, setQuietEnd]     = React.useState(8);

  React.useEffect(() => {
    if (!prefs) return;
    setStanceChange(prefs.stanceChangeEnabled);
    setWeeklyDigest(prefs.weeklyDigestEnabled);
    setTopicFollow(prefs.topicFollowEnabled);
    setReminder(prefs.reminderEnabled);
    setNewLocalTopic(prefs.newLocalTopicEnabled);
    setInapEnabled(prefs.inapEnabled);
    setEmailEnabled(prefs.emailEnabled);
    setDigestFrequency(prefs.digestFrequency);
    setDigestDay(prefs.digestDayOfWeek);
    setDigestHour(prefs.digestHourLocal);
    setTimezone(prefs.timezone);
    setQuietEnabled(prefs.quietHoursStart != null);
    if (prefs.quietHoursStart != null) setQuietStart(prefs.quietHoursStart);
    if (prefs.quietHoursEnd   != null) setQuietEnd(prefs.quietHoursEnd);
  }, [prefs]);

  const handleSave = async () => {
    try {
      await savePreferences({
        stanceChangeEnabled:  stanceChange,
        weeklyDigestEnabled:  weeklyDigest,
        topicFollowEnabled:   topicFollow,
        reminderEnabled:      reminder,
        newLocalTopicEnabled: newLocalTopic,
        inapEnabled,
        emailEnabled,
        digestFrequency,
        digestDayOfWeek: digestDay,
        digestHourLocal: digestHour,
        timezone,
        quietHoursStart: quietEnabled ? quietStart : -1 as unknown as null,
        quietHoursEnd:   quietEnabled ? quietEnd   : -1 as unknown as null,
      });
      toast({ title: t("settingsNotif.preferencesSaved") });
    } catch {
      toast({ title: t("settingsNotif.failedToSavePreferences"), variant: "destructive" });
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t("settingsNotif.notifications")}</h2>
        <p className="text-sm text-slate-500 mt-1">{t("settingsNotif.controlWhatUpdatesYouReceive")}</p>
      </div>

      <SectionCard title={t("settingsNotif.alertTypes")} description={t("settingsNotif.chooseWhichActivityTriggersA")}>
        <div className="space-y-4">
          <Toggle label={t("settingsNotif.stanceShiftAlerts")}
            description={t("settingsNotif.whenCommunitySentimentShiftsMaterially")}
            checked={stanceChange} onChange={setStanceChange} disabled={isPending} />
          <Toggle label={t("settingsNotif.topicActivity")}
            description={t("settingsNotif.whenATopicYouFollow")}
            checked={topicFollow} onChange={setTopicFollow} disabled={isPending} />
          <Toggle label={t("settingsNotif.weeklyDigest")}
            description={t("settingsNotif.aWeeklySummaryOfFollowed")}
            checked={weeklyDigest} onChange={setWeeklyDigest} disabled={isPending} />
          <Toggle label={t("settingsNotif.stanceReminders")}
            description={t("settingsNotif.aPoliteNudgeToRevisit")}
            checked={reminder} onChange={setReminder} disabled={isPending} />
          <Toggle label={t("settingsNotif.newLocalTopics")}
            description={t("settingsNotif.whenNewTopicsGoLive")}
            checked={newLocalTopic} onChange={setNewLocalTopic} disabled={isPending} />
        </div>
      </SectionCard>

      <SectionCard title={t("settingsNotif.deliveryChannels")} description={t("settingsNotif.chooseHowYouReceiveNotifications")}>
        <div className="space-y-4">
          <Toggle label={t("settingsNotif.inApp")}
            description={t("settingsNotif.notificationsAppearInTheBell")}
            checked={inapEnabled} onChange={setInapEnabled} disabled={isPending} />
          <Toggle label={t("auth.emailLabel")}
            description={t("settingsNotif.receiveDigestAndAlertEmails")}
            checked={emailEnabled} onChange={setEmailEnabled} disabled={true} />
          {emailEnabled && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
              {t("settingsNotif.emailDeliveryIsNotYet")}
            </p>
          )}
        </div>
      </SectionCard>

      {/* L-09: this whole block used to be gated on `weeklyDigest`, which meant the
          Frequency selector — whose options include "Daily" and "Off" — was unreachable
          unless Weekly digest was already on. The frequency control cannot live inside
          one of its own options, so the section now always renders. */}
      {(
        <SectionCard title={t("settingsNotif.digestSchedule")} description={t("settingsNotif.chooseWhenYourDigestIs")}>
          <div className="grid sm:grid-cols-2 gap-4">
            <SelectField label={t("settingsNotif.frequency")} value={digestFrequency}
              onChange={(v) => setDigestFrequency(v as DigestFrequency)}
              options={[{value:"weekly",label:t("settingsNotif.weekly")},{value:"daily",label:t("settingsNotif.daily")},{value:"off",label:t("settingsNotif.off")}]}
              disabled={isPending} />
            {digestFrequency === "weekly" && (
              <SelectField label={t("settingsNotif.day")} value={digestDay}
                onChange={(v) => setDigestDay(Number(v))}
                options={DAYS.map((d,i) => ({value:i,label:d}))}
                disabled={isPending} />
            )}
            <SelectField label={t("settingsNotif.time")} value={digestHour}
              onChange={(v) => setDigestHour(Number(v))}
              options={HOURS.map((h) => ({value:h.value,label:h.label}))}
              disabled={isPending} />
            <SelectField label={t("settingsNotif.timezone")} value={timezone}
              onChange={setTimezone}
              options={TIMEZONES.map((tz) => ({value:tz,label:tz}))}
              disabled={isPending} />
          </div>
        </SectionCard>
      )}

      <SectionCard title={t("settingsNotif.quietHours")} description={t("settingsNotif.pauseAllNotificationsDuringA")}>
        <Toggle label={t("settingsNotif.enableQuietHours")}
          description={t("settingsNotif.noNotificationsWillBeSent")}
          checked={quietEnabled} onChange={setQuietEnabled} disabled={isPending} />
        {quietEnabled && (
          <div className="grid sm:grid-cols-2 gap-4 mt-2">
            <SelectField label={t("settingsNotif.start")} value={quietStart}
              onChange={(v) => setQuietStart(Number(v))}
              options={HOURS.map((h) => ({value:h.value,label:h.label}))}
              disabled={isPending} />
            <SelectField label={t("settingsNotif.end")} value={quietEnd}
              onChange={(v) => setQuietEnd(Number(v))}
              options={HOURS.map((h) => ({value:h.value,label:h.label}))}
              disabled={isPending} />
          </div>
        )}
        {quietEnabled && quietStart === quietEnd && (
          <p className="text-xs text-amber-600">{t("settingsNotif.startAndEndTimeAre")}</p>
        )}
      </SectionCard>

      {/* L: Per-topic notification muting */}
      <SectionCard
        title={t("settingsNotif.perTopicNotifications")}
        description={t("settingsNotif.muteAlertsForSpecificFollowed")}
      >
        <TopicNotificationsSection />
      </SectionCard>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("settingsNotif.savePreferences")}
        </button>
      </div>
    </div>
  );
}
