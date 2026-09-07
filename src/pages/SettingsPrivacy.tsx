// src/pages/SettingsPrivacy.tsx
// Epic L — Privacy & Visibility settings page.
// Route: /settings/privacy
// Covers:
//   L1a: Display identity (anonymous random ID vs username)
//   L1b: Stance visibility (aggregate only vs public)
//   L1c: Comment visibility (follows display mode vs always anonymous)
//   L1d: Profile visibility (private vs public)
//   W5:  Social stance ingestion opt-out
//   AA5: WhatsApp Flow message opt-out

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield, Eye, MessageSquare, User, Share2, MessageCircleOff, Smile } from "lucide-react";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_PROJECT_REF, getJwt } from "@/lib/env";
import { AvatarRenderer } from "@/components/ugq/avatarRenderer";
import {
  type AnonymousAvatarConfig,
  type HairStyle,
  SKIN_TONES,
  HAIR_COLORS,
  HAIR_STYLES,
  TOP_COLORS,
  randomAvatarConfig,
  parseAvatarConfig,
} from "@/components/ugq/avatarConfig";

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
      return {
        allow_social_ingestion: true,
        whatsapp_flow_enabled:  true,
        ...(data as PrivacySettings),
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
      return {
        allow_social_ingestion: true,
        whatsapp_flow_enabled:  true,
        ...(data as PrivacySettings),
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

      // 2. If opting out, write to whatsapp_optouts via Edge Function
      //    If opting in, update whatsapp_optouts.is_active = false
      if (!enabled) {
        // Call webhook function to process opt-out
        // We simulate a STOP message by calling the opt-out endpoint directly
        await fetch(
          `${SUPABASE_URL}/functions/v1/whatsapp-manage-optout`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "opt_out" }),
          }
        );
      } else {
        await fetch(
          `${SUPABASE_URL}/functions/v1/whatsapp-manage-optout`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "opt_in" }),
          }
        );
      }

      queryClient.invalidateQueries({ queryKey: ["privacy-settings"] });
      toast({ title: enabled ? "WhatsApp messages re-enabled." : "WhatsApp messages disabled." });
    } catch (err: any) {
      // Revert optimistic update on error
      onOptimisticUpdate(!enabled);
      toast({
        title: "Failed to update WhatsApp setting. Please try again.",
        variant: "destructive",
      });
    }
  };
}

// ── Anonymous avatar (anonymous-video feature, NEW) ─────────────────────────────
// Reads/writes profiles.anonymous_avatar_config directly, NOT through the
// get_my_privacy_settings/update_my_privacy_settings RPC above — that RPC
// backs display_mode/stance_visibility/etc., a separate, newer settings
// surface this app hasn't wired into video (or anywhere else) yet. The
// video feature deliberately keys off the LEGACY profiles.display_handle_mode
// field instead (same field AppTopBar/ProposerBadge/comments already read),
// so the avatar config that pairs with it lives on the same `profiles` row,
// read/written the same plain way.

function useAnonymousAvatarConfig() {
  return useQuery<AnonymousAvatarConfig | null>({
    queryKey: ["anonymous-avatar-config"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("anonymous_avatar_config")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return parseAvatarConfig(data?.anonymous_avatar_config);
    },
  });
}

function useSaveAnonymousAvatarConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: AnonymousAvatarConfig) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ anonymous_avatar_config: config })
        .eq("user_id", user.id);
      if (error) throw error;
      return config;
    },
    onSuccess: (config) => {
      queryClient.setQueryData(["anonymous-avatar-config"], config);
    },
  });
}

// Renders AvatarRenderer's own offscreen canvas into a small visible
// preview canvas each frame — same mirroring approach VideoRecorderPanel
// uses for its live recording preview, kept in sync here purely so this
// settings page doesn't need a second avatar-drawing implementation.
function AvatarPreviewCanvas({ config }: { config: AnonymousAvatarConfig }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const renderer = new AvatarRenderer(config);
    renderer.start();
    let raf: number;
    const mirror = () => {
      const el = canvasRef.current;
      if (el) {
        const ctx = el.getContext("2d");
        ctx?.drawImage(renderer.canvasElement, 0, 0, el.width, el.height);
      }
      raf = requestAnimationFrame(mirror);
    };
    mirror();
    return () => {
      renderer.stop();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.skinTone, config.hairColor, config.hairStyle, config.topColor]);

  return <canvas ref={canvasRef} width={160} height={120} className="rounded-md bg-slate-100" />;
}

function ColorSwatchPicker({
  options,
  value,
  onChange,
  label,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-600 mb-1">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`${label}: ${c}`}
            className={
              "h-7 w-7 rounded-full border-2 " +
              (value === c ? "border-slate-900" : "border-transparent")
            }
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

function AnonymousAvatarSection() {
  const { data: savedConfig, isLoading } = useAnonymousAvatarConfig();
  const { mutate: save, isPending } = useSaveAnonymousAvatarConfig();
  const { toast } = useToast();
  const [local, setLocal] = React.useState<AnonymousAvatarConfig | null>(null);

  React.useEffect(() => {
    if (!isLoading && !local) setLocal(savedConfig ?? randomAvatarConfig());
  }, [isLoading, savedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !local) {
    return (
      <div className="flex items-center gap-2 py-4 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading your avatar…</span>
      </div>
    );
  }

  const update = (patch: Partial<AnonymousAvatarConfig>) =>
    setLocal((prev) => (prev ? { ...prev, ...patch } : prev));

  const handleSave = () => {
    save(local, {
      onSuccess: () => toast({ title: "Avatar saved." }),
      onError: () => toast({ title: "Failed to save. Please try again.", variant: "destructive" }),
    });
  };

  return (
    <SectionCard
      icon={Smile}
      title="Anonymous avatar"
      description="What stands in for your face and voice on videos you record while anonymous."
    >
      <div className="flex items-start gap-4">
        <AvatarPreviewCanvas config={local} />
        <div className="flex-1 space-y-3">
          <ColorSwatchPicker label="Skin tone" options={SKIN_TONES} value={local.skinTone} onChange={(v) => update({ skinTone: v })} />
          <ColorSwatchPicker label="Hair color" options={HAIR_COLORS} value={local.hairColor} onChange={(v) => update({ hairColor: v })} />
          <div>
            <p className="text-xs font-medium text-slate-600 mb-1">Hair style</p>
            <div className="flex flex-wrap gap-2">
              {HAIR_STYLES.map((style: HairStyle) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => update({ hairStyle: style })}
                  className={
                    "rounded-md border px-2.5 py-1 text-xs capitalize " +
                    (local.hairStyle === style ? "border-slate-900 bg-slate-50" : "border-slate-200")
                  }
                >
                  {style}
                </button>
              ))}
            </div>
          </div>
          <ColorSwatchPicker label="Top color" options={TOP_COLORS} value={local.topColor} onChange={(v) => update({ topColor: v })} />
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save avatar"}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 pt-1">
        Used only on videos you record while anonymous, in place of your real face and voice.
        Changing it only affects videos you record after this — a video you already recorded
        keeps whatever avatar it was made with.
      </p>
    </SectionCard>
  );
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

function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
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
            name={opt.value}
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
      onSuccess: () => toast({ title: "Privacy settings saved." }),
      onError: () => {
        setLocal(local);
        toast({ title: "Failed to save. Please try again.", variant: "destructive" });
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
        <span className="text-sm">Loading privacy settings…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Privacy & Visibility</h2>
        <p className="text-sm text-slate-500 mt-1">
          Control how you appear on Stance Capture. All defaults are set to maximum privacy.
        </p>
      </div>

      {/* L1a: Display identity */}
      <SectionCard
        icon={User}
        title="Display identity"
        description="How your name appears on comments and public-facing activity."
      >
        <RadioGroup
          value={local.display_mode}
          onChange={(v) => handleChange({ display_mode: v })}
          disabled={isPending}
          options={[
            {
              value: "anonymous",
              label: "Anonymous (recommended)",
              description:
                "You appear as a random ID (e.g. User #A4F2). Your identity is never revealed.",
            },
            {
              value: "username",
              label: "Username",
              description:
                "Your username is shown on comments and replies. Requires a username set in Profile settings.",
            },
          ]}
        />
        <p className="text-[11px] text-slate-400 pt-1">
          This also controls how your name appears in comment threads.
        </p>
      </SectionCard>

      {/* Anonymous-video feature, NEW */}
      <AnonymousAvatarSection />

      {/* L1b: Stance visibility */}
      <SectionCard
        icon={Shield}
        title="Stance visibility"
        description="Whether others can see your individual stance on questions."
      >
        <RadioGroup
          value={local.stance_visibility}
          onChange={(v) => handleChange({ stance_visibility: v })}
          disabled={isPending}
          options={[
            {
              value: "aggregate_only",
              label: "Aggregate only (recommended)",
              description:
                "Your stance contributes to community statistics but cannot be viewed individually by anyone.",
            },
            {
              value: "public",
              label: "Public",
              description:
                "Your individual stance on each question is visible to other users alongside your display identity.",
            },
          ]}
        />
      </SectionCard>

      {/* L1c: Comment visibility */}
      <SectionCard
        icon={MessageSquare}
        title="Comment identity"
        description="How your identity appears specifically on comments you post."
      >
        <RadioGroup
          value={local.comment_visibility}
          onChange={(v) => handleChange({ comment_visibility: v })}
          disabled={isPending}
          options={[
            {
              value: "display_mode",
              label: "Follow display identity setting",
              description:
                "Uses whatever you chose above — anonymous ID or username.",
            },
            {
              value: "always_anonymous",
              label: "Always anonymous on comments",
              description:
                "Even if your display identity is set to username, comments always show your anonymous ID.",
            },
          ]}
        />
      </SectionCard>

      {/* L1d: Profile visibility */}
      <SectionCard
        icon={Eye}
        title="Profile page"
        description="Whether your profile page is accessible to other users."
      >
        <RadioGroup
          value={local.profile_visibility}
          onChange={(v) => handleChange({ profile_visibility: v })}
          disabled={isPending}
          options={[
            {
              value: "private",
              label: "Private (recommended)",
              description:
                "Your profile page is not accessible. Only you can see your own profile.",
            },
            {
              value: "public",
              label: "Public",
              description:
                "Other users can view your profile page, including your display identity and public activity.",
            },
          ]}
        />
      </SectionCard>

      {/* W5: Social stance ingestion */}
      <SectionCard
        icon={Share2}
        title="Social stance ingestion"
        description="Whether replies you post on X (Twitter) to shared Stance Capture questions can be attributed to your account."
      >
        <RadioGroup
          value={local.allow_social_ingestion ? "on" : "off"}
          onChange={(v) => handleChange({ allow_social_ingestion: v === "on" })}
          disabled={isPending}
          options={[
            {
              value: "on",
              label: "Allow (default)",
              description:
                "If you reply to a question shared on X and your X account is connected, your reply may be captured as a stance on Stance Capture.",
            },
            {
              value: "off",
              label: "Do not attribute my X replies",
              description:
                "Replies you make on X will not be linked to your Stance Capture account. Your replies may still contribute anonymously to aggregate data.",
            },
          ]}
        />
        <p className="text-[11px] text-slate-400 pt-1">
          Only replies with a high confidence score are ever attributed. Manage your connected
          X account in{" "}
          <a href="/settings/account" className="underline hover:text-slate-600">
            Account settings
          </a>
          .
        </p>
      </SectionCard>

      {/* AA5: WhatsApp messages */}
      <SectionCard
        icon={MessageCircleOff}
        title="WhatsApp messages"
        description="Whether you receive Stance Capture questions via WhatsApp."
      >
        <RadioGroup
          value={local.whatsapp_flow_enabled ? "on" : "off"}
          onChange={(v) => handleWhatsAppToggle(v === "on")}
          disabled={isPending}
          options={[
            {
              value: "on",
              label: "Enabled (default)",
              description:
                "You may receive stance questions via WhatsApp when someone shares a question with you or an admin broadcasts to your number.",
            },
            {
              value: "off",
              label: "Disable WhatsApp messages",
              description:
                "You will no longer receive Stance Capture questions on WhatsApp. You can re-enable at any time, or reply START to any Stance Capture WhatsApp message.",
            },
          ]}
        />
        <p className="text-[11px] text-slate-400 pt-1">
          You can also opt out at any time by replying <span className="font-mono">STOP</span> to
          any Stance Capture WhatsApp message.
        </p>
      </SectionCard>

      {/* Info footer */}
      <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-500 leading-relaxed">
          Your stance data is always used in aggregate to power community insights — this cannot be
          turned off as it is core to how Stance Capture works. These settings control whether your
          individual responses are attributable to you.
        </p>
      </div>
    </div>
  );
}
