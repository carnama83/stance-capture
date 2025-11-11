// src/routes/paths.ts
/**
 * Central, typed route map for the app.
 * - Works with HashRouter or BrowserRouter (strings are the same).
 * - Keep ONLY absolute paths (leading slash).
 * - Add new routes here to avoid typos across the codebase.
 */

export const ROUTES = {
  // Public
  HOME: "/" as const,
  INDEX: "/index" as const, // optional alias → same component as HOME
  TOPICS: "/topics" as const,
  EXPLORE: "/explore" as const, // redirect → /topics (handled in router)
  LOGIN: "/login" as const,
  SIGNUP: "/signup" as const,
  RESET_PASSWORD: "/reset-password" as const,

  // Authed (user)
  PROFILE: "/profile" as const,
  SETTINGS_PROFILE: "/settings/profile" as const,
  SETTINGS_SECURITY: "/settings/security" as const,
  SETTINGS_SESSIONS: "/settings/sessions" as const,

  // Admin (Epic B)
  ADMIN_ROOT: "/admin" as const,               // mounts _layout + index
  ADMIN_SOURCES: "/admin/sources" as const,
  ADMIN_INGESTION: "/admin/ingestion" as const,
  ADMIN_DRAFTS: "/admin/drafts" as const,
  ADMIN_IDENTIFIERS: "/admin/identifiers" as const, // optional standalone page

  // Fallback
  NOT_FOUND: "/404" as const, // optional if you want a direct link
} as const;

/** Union of all known route string literals (great for props typing). */
export type RoutePath = typeof ROUTES[keyof typeof ROUTES];

/** Convenience groups (purely for ergonomics when importing). */
export const PUBLIC_ROUTES = {
  HOME: ROUTES.HOME,
  INDEX: ROUTES.INDEX,
  TOPICS: ROUTES.TOPICS,
  EXPLORE: ROUTES.EXPLORE,
  LOGIN: ROUTES.LOGIN,
  SIGNUP: ROUTES.SIGNUP,
  RESET_PASSWORD: ROUTES.RESET_PASSWORD,
} as const;

export const USER_ROUTES = {
  PROFILE: ROUTES.PROFILE,
  SETTINGS_PROFILE: ROUTES.SETTINGS_PROFILE,
  SETTINGS_SECURITY: ROUTES.SETTINGS_SECURITY,
  SETTINGS_SESSIONS: ROUTES.SETTINGS_SESSIONS,
} as const;

export const ADMIN_ROUTES = {
  ROOT: ROUTES.ADMIN_ROOT,
  SOURCES: ROUTES.ADMIN_SOURCES,
  INGESTION: ROUTES.ADMIN_INGESTION,
  DRAFTS: ROUTES.ADMIN_DRAFTS,
  IDENTIFIERS: ROUTES.ADMIN_IDENTIFIERS,
} as const;

/* ---------------------------
   Type-safe builders (future)
   --------------------------- */

/** Example: topic detail page like /topics/:id — adjust when you add the route. */
export const topicDetail = (id: string) => ensureLeadingSlash(`/topics/${encodeURIComponent(id)}`);

/** Example: admin source detail like /admin/sources/:id (if you add it later). */
export const adminSourceDetail = (id: string) =>
  ensureLeadingSlash(`/admin/sources/${encodeURIComponent(id)}`);

/* ---------------------------
   Small safe helpers
   --------------------------- */

/** Guarantee a leading slash (helps when composing). */
export function ensureLeadingSlash(path: string): `/${string}` {
  return (path.startsWith("/") ? path : `/${path}`) as `/${string}`;
}

/** Join path segments safely (keeps single slashes between parts). */
export function pathJoin(...parts: string[]): `/${string}` {
  const joined = parts
    .filter(Boolean)
    .map((p) => p.replace(/^\/+|\/+$/g, "")) // trim slashes
    .join("/");
  return ensureLeadingSlash(joined);
}
