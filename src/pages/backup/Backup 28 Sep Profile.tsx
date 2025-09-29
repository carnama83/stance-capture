// src/pages/Profile.tsx
import * as React from "react";
import { Link } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";

type ProfileRow = {
  user_id?: string;
  random_id: string | null;
  username: string | null;
  display_handle_mode?: "random_id" | "username" | null; // your DB naming
  bio?: string | null;
  avatar_url?: string | null;
  // optional extras if present:
  dob?: string | null;
  country_code?: string | null;
  state_code?: string | null;
  county_name?: string | null;
  city_name?: string | null;
};

export default function Profile() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<
    import("@supabase/supabase-js").Session | null | undefined
  >(undefined);
  const [row, setRow] = React.useState<ProfileRow | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  // Guard: Supabase client present?
  if (!sb) {
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-4">
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">
          Supabase is OFF (check env).
        </p>
      </div>
    );
  }

  // Track session (prevents blank while restoring)
  React.useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const { data } = await sb.auth.getSession();
        setSession(data.session ?? null);
        const sub = sb.auth.onAuthStateChange((_evt, s) => setSession(s));
        unsub = sub?.data?.subscription?.unsubscribe;
      } catch (e: any) {
        console.error(e);
        setMsg(e?.message ?? "Failed to get session");
        setSession(null);
      }
    })();
    return () => unsub?.();
  }, [sb]);

  // Load or initialize profile for the logged-in user
  React.useEffect(() => {
    let cancelled = false;

    async function fetchOrInitProfile(userId: string) {
      setBusy(true);
      setMsg(null);
      try {
        // Try to fetch the profile row
        const { data, error } = await sb
          .from("profiles")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();

        if (error) throw error;

        let profile = (data as ProfileRow) ?? null;

        // If missing, initialize via RPC then re-fetch
        if (!profile) {
          const { error: initErr } = await sb.rpc("init_user_after_signup");
          if (initErr) throw initErr;

          const after = await sb
            .from("profiles")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle();
          if (after.error) throw after.error;
          profile = (after.data as ProfileRow) ?? null;
        }

        if (!cancelled) setRow(profile);
      } catch (e: any) {
        console.error(e);
        if (!cancelled) setMsg(e?.message ?? "Failed to load profile");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    const uid = session?.user?.id;
    if (uid) fetchOrInitProfile(uid);
  }, [sb, session?.user?.id]);

  // Derive handle (keeps your original display logic)
  const handle =
    row?.display_handle_mode === "username"
      ? row?.username || row?.random_id || ""
      : row?.random_id || row?.username || "";

  // Render states (no blank screen)
  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">My Profile</h1>

      {session === undefined && (
        <div className="text-sm text-slate-600">Restoring session…</div>
      )}

      {session === null && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800 text-sm">
          Not logged in. Please use the Login page and come back.
        </div>
      )}

      {busy && <div className="text-sm">Loading…</div>}

      {!!msg && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-700 text-sm">
          {msg}
        </div>
      )}

      {row && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <img
              src={row.avatar_url || "https://placehold.co/64x64"}
              className="h-16 w-16 rounded-full object-cover border"
              alt={handle ? `Avatar of @${handle}` : "Avatar"}
            />
            <div>
              <div className="text-lg font-semibold">
                {handle ? `@${handle}` : "unknown"}
              </div>
              <div className="text-sm text-slate-600">
                {row.bio || "No bio yet."}
              </div>
            </div>
          </div>

          {(row.dob ||
            row.city_name ||
            row.county_name ||
            row.state_code ||
            row.country_code) && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-500">DOB</div>
                <div>{row.dob ?? "—"}</div>
              </div>
              <div>
                <div className="text-slate-500">Location</div>
                <div>
                  {[row.city_name, row.county_name, row.state_code, row.country_code]
                    .filter(Boolean)
                    .join(" / ") || "—"}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 text-sm">
            <Link to="/settings/profile" className="underline">
              Edit profile →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
