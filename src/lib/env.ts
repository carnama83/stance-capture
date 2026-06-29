// src/lib/env.ts
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for all environment configuration.
//
// ALL components must import from here — never read import.meta.env directly.
// This file is the only place that knows about environment variable names.
//
// Vite loads the right .env file automatically:
//   npm run dev              → loads .env + .env.development   (dev Supabase project)
//   npm run build:uat        → loads .env + .env.uat           (UAT Supabase project)
//   npm run build            → loads .env + .env.production    (prod Supabase project)
//   Vercel (Production)      → uses Vercel env vars for production
//   Vercel (Preview)         → uses Vercel env vars for preview/UAT
//
// To add a new environment variable:
//   1. Add it here with a typed export and a clear fallback/error
//   2. Add it to the relevant .env.* files
//   3. Add it to Vercel dashboard for deployed environments
//   Never scatter import.meta.env reads across component files.
// ─────────────────────────────────────────────────────────────────────────────

const env = import.meta.env;

// ── Supabase ──────────────────────────────────────────────────────────────────

/** Full Supabase project URL, e.g. https://abc123.supabase.co */
export const SUPABASE_URL: string = (
  env.VITE_SUPABASE_URL as string ?? ""
).replace(/\/+$/, "");

/** Supabase anon/public key */
export const SUPABASE_ANON_KEY: string =
  (env.VITE_SUPABASE_ANON_KEY as string) ??
  (env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ??  // legacy name — kept for compat
  (env.VITE_SUPABASE_KEY as string) ??               // legacy name — kept for compat
  "";

/**
 * Supabase project ref, derived from SUPABASE_URL.
 * Used for the auth localStorage key: sb-{PROJECT_REF}-auth-token
 * Never hardcode this — always derived so it tracks the active environment.
 */
export const SUPABASE_PROJECT_REF: string =
  SUPABASE_URL.replace("https://", "").split(".")[0];

/** The localStorage key where Supabase stores the session token */
export const SUPABASE_AUTH_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

// ── Feature flags ─────────────────────────────────────────────────────────────

/** Enable the trending debug panel in admin. Set to "true" to activate. */
export const ENABLE_TRENDING_DEBUG: boolean =
  env.VITE_ENABLE_TRENDING_DEBUG === "true";

// ── Environment identity ──────────────────────────────────────────────────────

/** Current Vite mode: "development" | "uat" | "production" */
export const APP_MODE: string = env.MODE as string ?? "production";

export const IS_DEV     = APP_MODE === "development";
export const IS_UAT     = APP_MODE === "uat";
export const IS_PROD    = APP_MODE === "production";

// ── JWT bypass helper (auth-mutex pattern) ────────────────────────────────────
//
// Supabase's getSession() acquires an async lock during token refresh, causing
// all SDK-based mutations to hang. Reading directly from localStorage is
// synchronous and lock-free. This is the established pattern across all pages.
// Import getJwt() from here instead of duplicating it in every file.

export function getJwt(): string {
  try {
    const raw = localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    return raw ? (JSON.parse(raw)?.access_token ?? "") : "";
  } catch {
    return "";
  }
}

/**
 * Standard headers for raw fetch() calls to Supabase REST / Edge Functions.
 * Use this instead of building headers inline in every component.
 *
 * @param jwt   - JWT from getJwt(). Pass "" to fall back to anon key.
 * @param extra - Any additional headers to merge in.
 */
export function supabaseHeaders(
  jwt: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${jwt || SUPABASE_ANON_KEY}`,
    ...extra,
  };
}
