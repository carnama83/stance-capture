// src/pages/SettingsNotifications.tsx
import * as React from "react";
import { useMyNotificationPreferences, useUpsertNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { type DigestFrequency } from "@/hooks/notificationTypes";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? "AM" : "PM";
  const h = i % 12 === 0 ? 12 : i % 12;
  return { value: i, label: `${h}:00 ${ampm}` };
});

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Paris",
  "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore",
  "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
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
          "relative shrink-0 mt-0.5 inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  options: Array<{ value: string | number; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export default function SettingsNotifications() {
  const { data: prefs, isLoading } = useMyNotificationPreferences();
  const { savePreferences, isPending } = useUpsertNotificationPreferences();
  const { toast } = useToast();

  // Alert type toggles
  const [stanceChange, setStanceChange] = React.useState(true);
  const [weeklyDigest, setWeeklyDigest] = React.useState(true);
  const [topicFollow, setTopicFollow] = React.useState(true);
  const [reminder, setReminder] = React.useState(true);
  const [newLocalTopic, setNewLocalTopic] = React.useState(true);

  // Channel toggles
  const [inapEnabled, setInapEnabled] = React.useState(true);
  const [emailEnabled, setEmailEnabled] = React.useState(false);

  // Digest schedule
  const [digestFrequency, setDigestFrequency] = React.useState<DigestFrequency>("weekly");
  const [digestDay, setDigestDay] = React.useState(1);
  const [digestHour, setDigestHour] = React.useState(9);
  const [timezone, setTimezone] = React.useState("America/New_York");

  // Quiet hours
  const [quietEnabled, setQuietEnabled] = React.useState(false);
  const [quietStart, setQuietStart] = React.useState(22);
  const [quietEnd, setQuietEnd] = React.useState(8);

  // Sync from loaded prefs
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
    if (prefs.quietHoursEnd != null) setQuietEnd(prefs.quietHoursEnd);
  }, [prefs]);

  const handleSave = async () => {
    try {
      await savePreferences({
        stanceChangeEnabled: stanceChange,
        weeklyDigestEnabled: weeklyDigest,
        topicFollowEnabled: topicFollow,
        reminderEnabled: reminder,
        newLocalTopicEnabled: newLocalTopic,
        inapEnabled,
        emailEnabled,
        digestFrequency,
        digestDayOfWeek: digestDay,
        digestHourLocal: digestHour,
        timezone,
        // Pass -1 to clear quiet hours, actual values to set, null to keep unchanged
        quietHoursStart: quietEnabled ? quietStart : -1 as unknown as null,
        quietHoursEnd: quietEnabled ? quietEnd : -1 as unknown as null,
      });
      toast({ title: "Preferences saved." });
    } catch {
      toast({ title: "Failed to save preferences.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
        <p className="text-sm text-slate-500 mt-1">Control what updates you receive and how.</p>
      </div>

      {/* Alert types */}
      <SectionCard title="Alert types" description="Choose which activity triggers a notification.">
        <div className="space-y-4">
          <Toggle label="Stance shift alerts"
            description="When community sentiment shifts materially on a question you answered."
            checked={stanceChange} onChange={setStanceChange} disabled={isPending} />
          <Toggle label="Topic activity"
            description="When a topic you follow is surging or gaining momentum."
            checked={topicFollow} onChange={setTopicFollow} disabled={isPending} />
          <Toggle label="Weekly digest"
            description="A weekly summary of followed topics and answered question shifts."
            checked={weeklyDigest} onChange={setWeeklyDigest} disabled={isPending} />
          <Toggle label="Stance reminders"
            description="A polite nudge to revisit your stance when notable news hits a followed topic."
            checked={reminder} onChange={setReminder} disabled={isPending} />
          <Toggle label="New local topics"
            description="When new topics go live in your selected location."
            checked={newLocalTopic} onChange={setNewLocalTopic} disabled={isPending} />
        </div>
      </SectionCard>

      {/* Delivery channels */}
      <SectionCard title="Delivery channels" description="Choose how you receive notifications.">
        <div className="space-y-4">
          <Toggle label="In-app"
            description="Notifications appear in the bell icon in the top bar."
            checked={inapEnabled} onChange={setInapEnabled} disabled={isPending} />
          <Toggle label="Email"
            description="Receive digest and alert emails. (Coming soon)"
            checked={emailEnabled} onChange={setEmailEnabled} disabled={true} />
          {emailEnabled && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
              Email delivery is not yet active. Your preference will be saved and applied when email is enabled.
            </p>
          )}
        </div>
      </SectionCard>

      {/* Digest schedule */}
      {weeklyDigest && (
        <SectionCard title="Digest schedule" description="Choose when your digest is delivered.">
          <div className="grid sm:grid-cols-2 gap-4">
            <SelectField label="Frequency" value={digestFrequency}
              onChange={(v) => setDigestFrequency(v as DigestFrequency)}
              options={[
                { value: "weekly", label: "Weekly" },
                { value: "daily", label: "Daily" },
                { value: "off", label: "Off" },
              ]}
              disabled={isPending}
            />
            {digestFrequency === "weekly" && (
              <SelectField label="Day" value={digestDay}
                onChange={(v) => setDigestDay(Number(v))}
                options={DAYS.map((d, i) => ({ value: i, label: d }))}
                disabled={isPending}
              />
            )}
            <SelectField label="Time" value={digestHour}
              onChange={(v) => setDigestHour(Number(v))}
              options={HOURS.map((h) => ({ value: h.value, label: h.label }))}
              disabled={isPending}
            />
            <SelectField label="Timezone" value={timezone}
              onChange={setTimezone}
              options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
              disabled={isPending}
            />
          </div>
        </SectionCard>
      )}

      {/* Quiet hours */}
      <SectionCard title="Quiet hours" description="Pause all notifications during a set window.">
        <Toggle label="Enable quiet hours"
          description="No notifications will be sent during this window."
          checked={quietEnabled} onChange={setQuietEnabled} disabled={isPending} />
        {quietEnabled && (
          <div className="grid sm:grid-cols-2 gap-4 mt-2">
            <SelectField label="Start" value={quietStart}
              onChange={(v) => setQuietStart(Number(v))}
              options={HOURS.map((h) => ({ value: h.value, label: h.label }))}
              disabled={isPending}
            />
            <SelectField label="End" value={quietEnd}
              onChange={(v) => setQuietEnd(Number(v))}
              options={HOURS.map((h) => ({ value: h.value, label: h.label }))}
              disabled={isPending}
            />
          </div>
        )}
        {quietEnabled && quietStart === quietEnd && (
          <p className="text-xs text-amber-600">Start and end time are the same — quiet hours will have no effect.</p>
        )}
      </SectionCard>

      {/* Save */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save preferences
        </button>
      </div>
    </div>
  );
}
