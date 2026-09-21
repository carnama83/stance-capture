// src/pages/SettingsPrivacy.tsx
// Epic L — Privacy & Visibility settings page.
// Route: /settings/privacy
// Covers:
//   L1a: Display identity (anonymous random ID vs username)
//   L1c: Comment visibility (follows display mode vs always anonymous)
//   W5:  Social stance ingestion opt-out
//   AA5: WhatsApp Flow message opt-out
//
// RETIRED (Epic L defect L-03, Sep 2026) — product decision:
//   L1b: Stance visibility (aggregate_only vs public)
//   L1d: Profile visibility (private vs public)
// Both settings were collected here but governed NOTHING: the product has no
// public profile surface at all — no /u/:username route, and src/pages/Profile.tsx
// is orphaned and self-only. Repo-wide, user_privacy is read by exactly one
// consumer (the x-reply-ingestion Edge Function) and only for allow_social_ingestion.
// So the UI was telling users "Other users can view your profile page" and "your
// individual stance is visible to other users" when neither was true in either
// direction — a promise with no mechanism behind it.
//
// The columns user_privacy.stance_visibility and .profile_visibility are DELIBERATELY
// LEFT IN PLACE, still defaulting to the conservative values (aggregate_only / private).
// Nothing is destroyed, no migration is needed, and if a public profile is built later
// the settings can be reinstated here — but enforcement must then live server-side in
// the RPC/RLS layer, never in this component, or the data leaks over the API anyway.
// update_my_privacy_settings still accepts both params; this page now always sends null
// for them.

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
// Shield / Eye were the icons for the retired Stance visibility and Profile page
// sections (L-03) and are no longer used.
import { Loader2, MessageSquare, User, Share2, MessageCircleOff } from "lucide-react";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_PROJECT_REF, getJwt, supabaseHeaders } from "@/lib/env";
import { useTranslation, Trans } from "react-i18next";

// ── Types ──────────────────────────────────────────────────────────────────────

type PrivacySettings = {
  display_mode:             "anonymous" | "username";
  stance_visibility:        "aggregate_only" | "public";
  comment_visibility:       "display_mode" | "always_anonymous";
  profile_visibility:       "private" | "public";
  allow_social_ingestion:   boolean; // W5
  whatsapp_flow_enabled:    boolean; // AA5
};

// ── Fetch / save hooks ─────────────────────────────────────────────────────────

function usePrivacySettings() {
  return useQuery<PrivacySettings>({
    queryKey: ["privacy-settings"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_privacy_settings");
      if (error) throw error;

      // Epic L defect L-06 (Sep 2026): whatsapp_flow_enabled lives on profiles, NOT on
      // user_privacy, so get_my_privacy_settings() (which returns the user_privacy
      // rowtype) can never supply it. It used to be hardcoded to true ahead of the
      // spread, which therefore could not override it — so the toggle rendered
      // "Enabled" on every load even for a user who had opted out. Read it from its
      // actual home instead.
      let whatsappEnabled = true;
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user) {
        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select("whatsapp_flow_enabled")
          .eq("user_id", auth.user.id)
          .maybeSingle();
        if (profErr) throw profErr;
        if (prof?.whatsapp_flow_enabled != null) {
          whatsappEnabled = Boolean(prof.whatsapp_flow_enabled);
        }
      }

      return {
        allow_social_ingestion: true,
        ...(data as PrivacySettings),
        // Must come AFTER the spread — the RPC row has no such column.
        whatsapp_flow_enabled: whatsappEnabled,
      };
    },
  });
}

function useSavePrivacy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PrivacySettings>) => {
      const { data, error } = await supabase.rpc("update_my_privacy_settings", {
        p_display_mode:           patch.display_mode           ?? null,
        p_stance_visibility:      patch.stance_visibility      ?? null,
        p_comment_visibility:     patch.comment_visibility     ?? null,
        p_profile_visibility:     patch.profile_visibility     ?? null,
        p_allow_social_ingestion: patch.allow_social_ingestion ?? null,
      });
      if (error) throw error;
      // L-06: the RPC returns the user_privacy row, which carries no whatsapp_flow_enabled.
      // Hardcoding it to true here reset the toggle in the cache after every unrelated
      // privacy save. Carry the currently-known value forward instead.
      const prev = queryClient.getQueryData<PrivacySettings>(["privacy-settings"]);
      return {
        allow_social_ingestion: true,
        ...(data as PrivacySettings),
        whatsapp_flow_enabled: prev?.whatsapp_flow_enabled ?? true,
      };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["privacy-settings"], updated);
    },
  });
}

// ── AA5: WhatsApp opt-out — direct profile update ─────────────────────────────
// whatsapp_flow_enabled is stored on profiles, not in the privacy settings RPC.
// We update it directly and also write to whatsapp_optouts via Edge Function.

function useSaveWhatsAppOptOut() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return async (enabled: boolean, onOptimisticUpdate: (enabled: boolean) => void) => {
    // Optimistic update
    onOptimisticUpdate(enabled);

    try {
      // 1. Update profiles.whatsapp_flow_enabled
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ whatsapp_flow_enabled: enabled })
        .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "");

      if (profileError) throw profileError;

      // 2. Maintain whatsapp_optouts via the Edge Function.
      //
      // Epic L defect L-02 (Sep 2026): this call used to send only a Content-Type header.
      // whatsapp-manage-optout is deployed with verify_jwt=true, so the Supabase platform
      // gateway rejected it with 401 UNAUTHORIZED_NO_AUTH_HEADER before the function body
      // ever ran. Worse, the response was never inspected and the surrounding catch only
      // fires on network errors, so the user was shown a success toast every time while
      // whatsapp_optouts was never updated — the opt-out was left half-applied (the
      // profiles flag flipped, the opt-out record did not).
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/whatsapp-manage-optout`,
        {
          method: "POST",
          headers: supabaseHeaders(getJwt()),
          body: JSON.stringify({ action: enabled ? "opt_in" : "opt_out" }),
        }
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `whatsapp-manage-optout failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`
        );
      }

      queryClient.invalidateQueries({ queryKey: ["privacy-settings"] });
      toast({ title: enabled ? "WhatsApp messages re-enabled." : "WhatsApp messages disabled." });
    } catch (err: any) {
      // L-02: this path was previously unreachable for a failed Edge Function call,
      // because the response status was never checked. Log the reason so a gateway
      // rejection is diagnosable rather than silent.
      console.error("SettingsPrivacy: WhatsApp opt-out update failed", err);
      // Revert optimistic update on error
      onOptimisticUpdate(!enabled);
      toast({
        title: t("settingsPrivacy.failedToUpdateWhatsappSetting"),
        variant: "destructive",
      });
    }
  };
}

// ── UI primitives ──────────────────────────────────────────────────────────────

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-slate-50 rounded-lg shrink-0">
          <Icon className="h-4 w-4 text-slate-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// Epic L defect L-10 (Sep 2026, found by browser testing): every radio took its
// name from the OPTION value, so grouping was by option rather than by control. Two
// sections here use the same option values ("on" / "off") — Social stance ingestion
// and WhatsApp messages — so their radios collided into one native radio group and
// selecting an option in one visually CLEARED the other. Observed live: with
// allow_social_ingestion=true and whatsapp_flow_enabled=true, both wanted the "on"
// radio, the browser allowed only one, and the Social stance ingestion section
// rendered with NEITHER option selected while the stored value was "Allow".
// Each group now gets its own stable name.
function RadioGroup<T extends string>({
  name,
  value,
  onChange,
  options,
  disabled,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; description: string }>;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={[
            "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
            value === opt.value
              ? "border-slate-900 bg-slate-50"
              : "border-slate-200 hover:border-slate-300",
            disabled ? "opacity-50 cursor-not-allowed" : "",
          ].join(" ")}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => !disabled && onChange(opt.value)}
            className="mt-0.5 accent-slate-900"
            disabled={disabled}
          />
          <div>
            <p className="text-sm font-medium text-slate-900">{opt.label}</p>
            <p className="text-xs text-slate-500 mt-0.5">{opt.description}</p>
          </div>
        </label>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPrivacy() {
  const { t } = useTranslation();
  const { data: prefs, isLoading } = usePrivacySettings();
  const { mutate: save, isPending } = useSavePrivacy();
  const { toast } = useToast();
  const saveWhatsAppOptOut = useSaveWhatsAppOptOut();

  // Local state mirrors server — updates optimistically
  const [local, setLocal] = React.useState<PrivacySettings | null>(null);

  React.useEffect(() => {
    if (prefs && !local) setLocal(prefs);
  }, [prefs]);

  const handleChange = (patch: Partial<PrivacySettings>) => {
    const updated = { ...local!, ...patch };
    setLocal(updated);
    save(patch, {
      onSuccess: () => toast({ title: t("settingsPrivacy.privacySettingsSaved") }),
      onError: () => {
        setLocal(local);
        toast({ title: t("settingsPrivacy.failedToSavePleaseTry"), variant: "destructive" });
      },
    });
  };

  const handleWhatsAppToggle = (enabled: boolean) => {
    saveWhatsAppOptOut(enabled, (optimisticValue) => {
      setLocal((prev) => prev ? { ...prev, whatsapp_flow_enabled: optimisticValue } : prev);
    });
  };

  if (isLoading || !local) {
    return (
      <div className="flex items-center gap-2 py-16 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">{t("settingsPrivacy.loadingPrivacySettings")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t("settingsPrivacy.privacyVisibility")}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {t("settingsPrivacy.controlHowYouAppearOn")}
        </p>
      </div>

      {/* L1a: Display identity */}
      <SectionCard
        icon={User}
        title={t("settingsPrivacy.displayIdentity")}
        description={t("settingsPrivacy.howYourNameAppearsOn")}
      >
        <RadioGroup
          name="display-identity"
          value={local.display_mode}
          onChange={(v) => handleChange({ display_mode: v })}
          disabled={isPending}
          options={[
            {
              value: "anonymous",
              label: t("settingsPrivacy.anonymousRecommended"),
              description: t("settingsPrivacy.youAppearAsARandom"),
            },
            {
              value: "username",
              label: t("settingsPrivacy.username"),
              description: t("settingsPrivacy.yourUsernameIsShownOn"),
            },
          ]}
        />
        <p className="text-[11px] text-slate-400 pt-1">
          {t("settingsPrivacy.thisAlsoControlsHowYour")}
        </p>
      </SectionCard>

      {/* L1b: Stance visibility — RETIRED, see the L-03 note above. */}

      {/* L1c: Comment visibility */}
      <SectionCard
        icon={MessageSquare}
        title={t("settingsPrivacy.commentIdentity")}
        description={t("settingsPrivacy.howYourIdentityAppearsSpecifically")}
      >
        <RadioGroup
          name="comment-identity"
          value={local.comment_visibility}
          onChange={(v) => handleChange({ comment_visibility: v })}
          disabled={isPending}
          options={[
            {
              value: "display_mode",
              label: t("settingsPrivacy.followDisplayIdentitySetting"),
              description: t("settingsPrivacy.usesWhateverYouChoseAbove"),
            },
            {
              value: "always_anonymous",
              label: t("settingsPrivacy.alwaysAnonymousOnComments"),
              description: t("settingsPrivacy.evenIfYourDisplayIdentity"),
            },
          ]}
        />
      </SectionCard>

      {/* L1d: Profile visibility — RETIRED, see the L-03 note above. */}

      {/* W5: Social stance ingestion */}
      <SectionCard
        icon={Share2}
        title={t("settingsPrivacy.socialStanceIngestion")}
        description={t("settingsPrivacy.whetherRepliesYouPostOn")}
      >
        <RadioGroup
          name="social-ingestion"
          value={local.allow_social_ingestion ? "on" : "off"}
          onChange={(v) => handleChange({ allow_social_ingestion: v === "on" })}
          disabled={isPending}
          options={[
            {
              value: "on",
              label: t("settingsPrivacy.allowDefault"),
              description: t("settingsPrivacy.ifYouReplyToA"),
            },
            {
              value: "off",
              label: t("settingsPrivacy.doNotAttributeMyX"),
              description: t("settingsPrivacy.repliesYouMakeOnX"),
            },
          ]}
        />
        <p className="text-[11px] text-slate-400 pt-1">
          <Trans
            i18nKey="settingsPrivacy.manageXAccount"
            components={{ a: <a href="/settings/account" className="underline hover:text-slate-600" /> }}
          />
          .
        </p>
      </SectionCard>

      {/* AA5: WhatsApp messages */}
      <SectionCard
        icon={MessageCircleOff}
        title={t("settingsPrivacy.whatsappMessages")}
        description={t("settingsPrivacy.whetherYouReceiveStanceCapture")}
      >
        <RadioGroup
          name="whatsapp-messages"
          value={local.whatsapp_flow_enabled ? "on" : "off"}
          onChange={(v) => handleWhatsAppToggle(v === "on")}
          disabled={isPending}
          options={[
            {
              value: "on",
              label: t("settingsPrivacy.enabledDefault"),
              description: t("settingsPrivacy.youMayReceiveStanceQuestions"),
            },
            {
              value: "off",
              label: t("settingsPrivacy.disableWhatsappMessages"),
              description: t("settingsPrivacy.youWillNoLongerReceive"),
            },
          ]}
        />
        <p className="text-[11px] text-slate-400 pt-1">
          <Trans
            i18nKey="settingsPrivacy.optOutStop"
            components={{ code: <span className="font-mono" /> }}
          />
        </p>
      </SectionCard>

      {/* Info footer */}
      <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-500 leading-relaxed">
          {t("settingsPrivacy.yourStanceDataIsAlways")}
        </p>
      </div>
    </div>
  );
}
