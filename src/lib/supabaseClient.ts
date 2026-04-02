// src/lib/supabaseClient.ts
// Singleton Supabase client — only ONE instance must exist in the app.
// detectSessionInUrl is DISABLED because this app uses HashRouter, which
// produces /#/auth/callback#access_token=... — a double-hash that Supabase
// cannot auto-parse. OAuthCallbackPage handles token extraction manually.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

console.log("[ENV CHECK]", {
  url: import.meta.env.VITE_SUPABASE_URL,
  keyPresent: Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY),
});

let cached: SupabaseClient | null = null;
let warned = false;

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !anonKey) {
    if (!warned && import.meta.env.DEV) {
      console.warn(
        "[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Returning null."
      );
      warned = true;
    }
    return null;
  }

  cached = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // CRITICAL: must be false for HashRouter apps.
      // Supabase cannot parse /#/auth/callback#access_token=... (double-hash).
      // OAuthCallbackPage calls setSession() manually after extracting the token.
      detectSessionInUrl: false,
      flowType: "implicit",
    },
  });

  return cached;
}
