// src/pages/SettingsNotifications.tsx
import * as React from "react";
import { useMyNotificationPreferences, useUpsertNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? "AM" : "PM";
  const h = i % 12 === 0 ? 12 : i % 12;
  return { value: i, label: `${h}:00 ${ampm}` };
});

// Common IANA timezones
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function SectionCard({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
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
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer group">
      <div className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && (
          <span className="block text-xs text-slate-500 mt-0.5">{description}</span>
        )}
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
        <span
          className={[
            "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
    </label>
  );
}

export default function SettingsNotifications() {
  const { data: prefs, isLoading } = useMyNotificationPreferences();
  const { savePreferences, isPending } = useUpsertNotificationPreferences();
  const { toast } = useToast();

  // Local form state — initialised from loaded prefs
  const [stanceChange, setStanceChange] = React.useState(true);
  const [weeklyDigest, setWeeklyDigest] = React.useState(true);
  const [topicFollow, setTopicFollow] = React.useState(true);
  const [digestDay, setDigestDay] = React.useState(1);
  const [digestHour, setDigestHour] = React.useState(9);
  const [timezone, setTimezone] = React.useState("America/New_York");

  // Sync prefs into local state once loaded
  React.useEffect(() => {
    if (!prefs) return;
    setStanceChange(prefs.stanceChangeEnabled);
    setWeeklyDigest(prefs.weeklyDigestEnabled);
    setTopicFollow(prefs.topicFollowEnabled);
    setDigestDay(prefs.digestDayOfWeek);
    setDigestHour(prefs.digestHourLocal);
    setTimezone(prefs.timezone);
  }, [prefs]);

  const handleSave = async () => {
    try {
      await savePreferences({
        stanceChangeEnabled: stanceChange,
        weeklyDigestEnabled: weeklyDigest,
        topicFollowEnabled: topicFollow,
        digestDayOfWeek: digestDay,
        digestHourLocal: digestHour,
        timezone,
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
        <p className="text-sm text-slate-500 mt-1">
          Control what updates you receive and when.
        </p>
      </div>

      {/* Alert toggles */}
      <SectionCard
        title="Alert types"
        description="Choose which activity triggers a notification."
      >
        <div className="space-y-4">
          <Toggle
            label="Stance shift alerts"
            description="Notify me when community sentiment shifts on a question I answered."
            checked={stanceChange}
            onChange={setStanceChange}
            disabled={isPending}
          />
          <Toggle
            label="Topic activity alerts"
            description="Notify me when a topic I follow is surging or has new activity."
            checked={topicFollow}
            onChange={setTopicFollow}
            disabled={isPending}
          />
          <Toggle
            label="Weekly digest"
            description="Receive a weekly summary of followed topics and answered question shifts."
            checked={weeklyDigest}
            onChange={setWeeklyDigest}
            disabled={isPending}
          />
        </div>
      </SectionCard>

      {/* Digest schedule — only shown when weekly digest is enabled */}
      {weeklyDigest && (
        <SectionCard
          title="Digest schedule"
          description="Choose when your weekly digest is delivered."
        >
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">Day</label>
              <select
                value={digestDay}
                onChange={(e) => setDigestDay(Number(e.target.value))}
                disabled={isPending}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {DAYS.map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">Time</label>
              <select
                value={digestHour}
                onChange={(e) => setDigestHour(Number(e.target.value))}
                disabled={isPending}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={isPending}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
        </SectionCard>
      )}

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
