// src/auth/SocialAuthButtons.tsx
// Epic V — Social Authentication
// Reusable OAuth sign-in buttons for Google, Facebook, and Apple.
// Used on both Login and Signup pages.

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Loader2 } from "lucide-react";

type Provider = "google" | "facebook" | "apple";

interface SocialAuthButtonsProps {
  mode: "login" | "signup";
  onError?: (msg: string) => void;
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 814 1000" aria-hidden="true">
      <path
        fill="currentColor"
        d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.3-164-39.3c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 382.8-.3 261.3 0 148.9c.3-109.6 71.6-168.2 142.2-168.2 71.6 0 123.1 46.3 163 46.3 38.5 0 98.9-49.3 170.5-49.3 26.2 0 108.2 3.2 166.8 97.9zm-106.7-87.5c10.3-27.5 16.1-55.6 16.1-83.8 0-3.9-.3-7.7-.6-11.6-26.5 0-58 18.3-78.5 37.9-22.4 21.2-40.7 54.8-40.7 87.8 0 3.6.6 7.2 1 10.8 2.9.3 5.8.6 8.6.6 23.8 0 52.8-15.9 74.1-41.7z"
      />
    </svg>
  );
}

// ─── Button config ─────────────────────────────────────────────────────────────

const PROVIDER_CONFIG: Record<
  Provider,
  { label: string; icon: React.ReactNode; bgClass: string; textClass: string; borderClass: string }
> = {
  google: {
    label: "Continue with Google",
    icon: <GoogleIcon />,
    bgClass: "bg-white hover:bg-gray-50",
    textClass: "text-gray-700",
    borderClass: "border-gray-300",
  },
  facebook: {
    label: "Continue with Facebook",
    icon: <FacebookIcon />,
    bgClass: "bg-[#1877F2] hover:bg-[#166FE5]",
    textClass: "text-white",
    borderClass: "border-transparent",
  },
  apple: {
    label: "Continue with Apple",
    icon: <AppleIcon />,
    bgClass: "bg-black hover:bg-gray-900",
    textClass: "text-white",
    borderClass: "border-transparent",
  },
};

// ─── OAuth redirect URL helper ─────────────────────────────────────────────────

function getRedirectUrl(): string {
  return window.location.origin;
}

// ─── Single provider button ────────────────────────────────────────────────────

function SocialButton({
  provider,
  loading,
  onClick,
}: {
  provider: Provider;
  loading: boolean;
  onClick: () => void;
}) {
  const cfg = PROVIDER_CONFIG[provider];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={[
        "w-full flex items-center justify-center gap-3 rounded-lg border px-4 py-2.5",
        "text-sm font-medium transition-colors disabled:opacity-60",
        cfg.bgClass,
        cfg.textClass,
        cfg.borderClass,
      ].join(" ")}
      aria-label={cfg.label}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        cfg.icon
      )}
      <span>{cfg.label}</span>
    </button>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function SocialAuthButtons({ mode, onError }: SocialAuthButtonsProps) {
  const sb = React.useMemo(getSupabase, []);
  const [loadingProvider, setLoadingProvider] = React.useState<Provider | null>(null);

  async function signInWith(provider: Provider) {
    if (!sb) {
      onError?.("Supabase is not configured.");
      return;
    }

    setLoadingProvider(provider);

    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: getRedirectUrl(),
          // Request scopes needed for profile + downstream Epic W use
          scopes:
            provider === "google"
              ? "openid email profile"
              : provider === "facebook"
              ? "email,public_profile"
              : undefined, // Apple scopes are set in the Apple Developer Portal
          queryParams:
            provider === "google"
              ? { access_type: "offline", prompt: "consent" }
              : undefined,
        },
      });

      if (error) {
        onError?.(error.message);
        setLoadingProvider(null);
      }
      // On success: Supabase redirects the browser — no further action needed here
    } catch (e: any) {
      onError?.(e?.message ?? "OAuth sign-in failed.");
      setLoadingProvider(null);
    }
  }

  const dividerText = mode === "signup" ? "or sign up with" : "or log in with";

  return (
    <div className="space-y-3">
      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-3 text-slate-400">{dividerText}</span>
        </div>
      </div>

      {/* Buttons */}
      <div className="space-y-2">
        <SocialButton
          provider="google"
          loading={loadingProvider === "google"}
          onClick={() => signInWith("google")}
        />
        <SocialButton
          provider="facebook"
          loading={loadingProvider === "facebook"}
          onClick={() => signInWith("facebook")}
        />
        <SocialButton
          provider="apple"
          loading={loadingProvider === "apple"}
          onClick={() => signInWith("apple")}
        />
      </div>

      {/* Apple legal note — required by Apple HIG */}
      <p className="text-center text-[11px] text-slate-400 leading-relaxed">
        By continuing, you agree to our{" "}
        <a href="/terms" className="underline">
          Terms
        </a>{" "}
        and{" "}
        <a href="/privacy" className="underline">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
