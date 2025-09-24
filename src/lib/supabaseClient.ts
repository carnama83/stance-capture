// src/lib/supabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Vite expects env keys with the VITE_ prefix.
 * Required:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Replace your existing file with this one.
 */

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
      detectSessionInUrl: true,
    },
  });

  return cached;
}
