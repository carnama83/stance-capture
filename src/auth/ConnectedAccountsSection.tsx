// src/auth/ConnectedAccountsSection.tsx
// Epic V — Social Authentication (V4)
// Shows connected social providers and allows linking/unlinking.
// Rendered inside SettingsAccount.tsx
//
// CHANGES (Fix 2):
//   - Added 'twitter' as a supported provider type
//   - Added Twitter/X row with X branding and OAuth connect flow
//   - Twitter connect uses signInWithOAuth (not linkIdentity) with
//     provider_token scopes for tweet.write — this is the correct path
//     for getting a token that post-to-x can use
//   - useLinkedProviders already calls get_linked_providers RPC which reads
//     social_auth_tokens — will now return twitter rows after Fix 1 enum migration

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Link2, Unlink, CheckCircle2 } from "lucide-react";
import { getSupabase } from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────────────────────

type Provider = "google" | "facebook" | "apple" | "twitter";

interface LinkedProvider {
  provider: Provider;
  provider_user_id: string;
  connected_at: string;
  scopes: string[];
}

// ─── Provider display config ──────────────────────────────────────────────────

const PROVIDER_META: Record<
  Provider,
  { label: string; color: string; iconBg: string; description: string }
> = {
  google: {
    label: "Google",
    color: "text-slate-700",
    iconBg: "bg-white border border-slate-200",
    description: "Sign in with your Google account",
  },
  facebook: {
    label: "Facebook",
    color: "text-[#1877F2]",
    iconBg: "bg-[#1877F2]",
    description: "Sign in with your Facebook account",
  },
  apple: {
    label: "Apple",
    color: "text-slate-900",
    iconBg: "bg-black",
    description: "Sign in with your Apple ID",
  },
  twitter: {
    label: "X (Twitter)",
    color: "text-slate-900",
    iconBg: "bg-black",
    description: "Required for direct posting to X",
  },
};

function ProviderIcon({ provider }: { provider: Provider }) {
  if (provider === "google") {
    return (
      <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
      </svg>
    );
  }
  if (provider === "facebook") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="white" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
      </svg>
    );
  }
  if (provider === "twitter") {
    // X logo
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="white">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 814 1000" aria-hidden="true">
      <path fill="white" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.3-164-39.3c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 382.8-.3 261.3 0 148.9c.3-109.6 71.6-168.2 142.2-168.2 71.6 0 123.1 46.3 163 46.3 38.5 0 98.9-49.3 170.5-49.3 26.2 0 108.2 3.2 166.8 97.9zm-106.7-87.5c10.3-27.5 16.1-55.6 16.1-83.8 0-3.9-.3-7.7-.6-11.6-26.5 0-58 18.3-78.5 37.9-22.4 21.2-40.7 54.8-40.7 87.8 0 3.6.6 7.2 1 10.8 2.9.3 5.8.6 8.6.6 23.8 0 52.8-15.9 74.1-41.7z"/>
    </svg>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useLinkedProviders() {
  return useQuery<LinkedProvider[]>({
    queryKey: ["linked-social-providers"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_linked_providers");
      if (error) throw error;
      return (data ?? []) as LinkedProvider[];
    },
  });
}

function useDisconnectProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (provider: Provider) => {
      const { data, error } = await supabase.rpc("disconnect_social_provider", {
        p_provider: provider,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error ?? "Failed to disconnect.");
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["linked-social-providers"] });
    },
  });
}

// ─── Connect button ───────────────────────────────────────────────────────────

function ConnectButton({ provider }: { provider: Provider }) {
  const sb = React.useMemo(getSupabase, []);
  const [loading, setLoading] = React.useState(false);
  const { toast } = useToast();

  async function handleConnect() {
    if (!sb) return;
    setLoading(true);

    // Twitter/X uses signInWithOAuth (not linkIdentity) because we need
    // provider_token with tweet.write scope — Supabase linkIdentity doesn't
    // pass through provider scopes reliably for Twitter.
    if (provider === "twitter") {
      // Store current path so callback can return here
      sessionStorage.setItem("return_to", window.location.hash || "/");
      const { error } = await sb.auth.signInWithOAuth({
        provider: "twitter",
        options: {
          redirectTo: `${window.location.origin}/#/auth/callback`,
          scopes: "tweet.read tweet.write users.read offline.access",
        },
      });
      if (error) {
        toast({ title: "Connection failed", description: error.message, variant: "destructive" });
        setLoading(false);
      }
      // On success: browser redirects to OAuth; setLoading stays true
      return;
    }

    // Google / Facebook / Apple use linkIdentity for account linking
    const { error } = await sb.auth.linkIdentity({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      toast({ title: "Connection failed", description: error.message, variant: "destructive" });
      setLoading(false);
    }
    // On success: browser redirects to OAuth; setLoading stays true
  }

  const meta = PROVIDER_META[provider];

  return (
    <button
      type="button"
      onClick={handleConnect}
      disabled={loading}
      className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
      Connect {meta.label}
    </button>
  );
}

// ─── Provider row ─────────────────────────────────────────────────────────────

function ProviderRow({
  provider,
  linked,
  onDisconnect,
  disconnecting,
  isLastMethod,
}: {
  provider: Provider;
  linked: LinkedProvider | undefined;
  onDisconnect: () => void;
  disconnecting: boolean;
  isLastMethod: boolean;
}) {
  const meta = PROVIDER_META[provider];

  return (
    <div className="flex items-center gap-4 py-3">
      {/* Icon */}
      <div
        className={[
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
          meta.iconBg,
        ].join(" ")}
      >
        <ProviderIcon provider={provider} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800">{meta.label}</p>
        {linked ? (
          <p className="text-xs text-slate-400 mt-0.5">
            Connected ·{" "}
            {new Date(linked.connected_at).toLocaleDateString(undefined, {
              dateStyle: "medium",
            })}
          </p>
        ) : (
          <p className="text-xs text-slate-400 mt-0.5">{meta.description}</p>
        )}
      </div>

      {/* Action */}
      {linked ? (
        <div className="flex items-center gap-2 shrink-0">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <button
            type="button"
            onClick={onDisconnect}
            disabled={disconnecting || isLastMethod}
            title={
              isLastMethod
                ? "Can't disconnect your only login method"
                : `Disconnect ${meta.label}`
            }
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {disconnecting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Unlink className="h-3 w-3" />
            )}
            Disconnect
          </button>
        </div>
      ) : (
        <ConnectButton provider={provider} />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// Twitter is listed separately at the bottom with a divider and explanation
// because its purpose (enabling direct X posting) differs from the others
// (login convenience). This avoids confusion about why it asks for tweet.write.
const LOGIN_PROVIDERS: Provider[] = ["google", "facebook", "apple"];

export default function ConnectedAccountsSection() {
  const { data: linked, isLoading } = useLinkedProviders();
  const { mutate: disconnect, isPending: disconnecting, variables: disconnectingProvider } =
    useDisconnectProvider();
  const { toast } = useToast();

  const linkedSet = new Set((linked ?? []).map((l) => l.provider));
  const linkedCount = linkedSet.size;

  // A provider is the "last method" only if it's the only connection AND
  // the user has no email/password (we approximate: if only 1 connected provider)
  function isLastMethod(provider: Provider): boolean {
    return linkedCount === 1 && linkedSet.has(provider);
  }

  function handleDisconnect(provider: Provider) {
    disconnect(provider, {
      onSuccess: () =>
        toast({ title: `${PROVIDER_META[provider].label} disconnected.` }),
      onError: (e: any) =>
        toast({
          title: "Couldn't disconnect",
          description: e?.message,
          variant: "destructive",
        }),
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-xs py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading connected accounts…
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-500 pb-2">
        Connect social accounts to sign in without a password. You can connect
        multiple providers to the same account.
      </p>

      <div className="divide-y divide-slate-100">
        {LOGIN_PROVIDERS.map((provider) => (
          <ProviderRow
            key={provider}
            provider={provider}
            linked={(linked ?? []).find((l) => l.provider === provider)}
            onDisconnect={() => handleDisconnect(provider)}
            disconnecting={disconnecting && disconnectingProvider === provider}
            isLastMethod={isLastMethod(provider)}
          />
        ))}
      </div>

      {/* X / Twitter — separate section, different purpose */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <p className="text-xs font-medium text-slate-600 mb-1">X (Twitter) for sharing</p>
        <p className="text-xs text-slate-400 mb-2">
          Connect X to post your stances directly from Stance Capture.
          Requires write permission to your X account.
        </p>
        <ProviderRow
          provider="twitter"
          linked={(linked ?? []).find((l) => l.provider === "twitter")}
          onDisconnect={() => handleDisconnect("twitter")}
          disconnecting={disconnecting && disconnectingProvider === "twitter"}
          isLastMethod={false} // Twitter is never a login method — can always disconnect
        />
      </div>
    </div>
  );
}
