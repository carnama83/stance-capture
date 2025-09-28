// src/pages/Profile.tsx
import * as React from "react";
import { Link } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";

type ProfileRow = {
  user_id?: string;
  random_id: string | null;
  username: string | null;
  display_handle_mode?: "random_id" | "username" | null;
  bio?: string | null;
  avatar_url?: string | null;
  // Optional extras if you join them elsewhere:
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

  // Local UI state for handle mode switch
  const [switchingHandle, setSwitchingHandle] = React.useState<
    false | "random_id" | "username"
  >(false);

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

  // Track session
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

  // Fetch or initialize profile
  React.useEffect(() => {
    let cancelled = false;

    async function fetchOrInitProfile(userId: string) {
      setBusy(true);
      setMsg(null);
      try {
        // 1) Try to fetch
        const got = await sb
          .from("profiles")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();
        if (got.error) throw got.error;

        let profile = (got.data as ProfileRow) ?? null;

        // 2) If missing, init then re-fetch
        if (!profile) {
          const init = await sb.rpc("init_user_after_signup");
          if (init.error) throw new Error(`Init profile failed: ${init.error.message}`);

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
        if (!cancelled) {
          const hint = /gen_random_bytes|pgcrypto/i.test(e?.message || "")
            ? " (DB: enable pgcrypto and/or set function search_path to include 'extensions')"
            : "";
          setMsg((e?.message ?? "Failed to load profile") + hint);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    const uid = session?.user?.id;
    if (uid) fetchOrInitProfile(uid);

    return () => {
      cancelled = true;
    };
  }, [sb, session?.user?.id]);

  // Helper to refresh current profile row
  const refreshProfile = React.useCallback(
    async (uid: string) => {
      const after = await sb
        .from("profiles")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();
      if (!after.error) setRow(after.data as ProfileRow);
      else setMsg(after.error.message);
    },
    [sb]
  );

  // Option #1: use enum-typed RPC to switch handle mode
  async function setHandleMode(mode: "random_id" | "username") {
    try {
      setSwitchingHandle(mode);
      setMsg(null);
      const { data: user } = await sb.auth.getUser();
      const uid = user?.user?.id;
      if (!uid) {
        setMsg("Not logged in");
        return;
      }

      // Server requires a username to exist before switching to 'username'
      if (mode === "username" && !row?.username) {
        setMsg("Set a username first before switching display to username.");
        return;
      }

      const r = await sb.rpc("set_display_handle", {
        p_user_id: uid,
        p_mode: mode, // enum labels: 'random_id' | 'username'
      });
      if (r.error) {
        setMsg(r.error.message);
        return;
      }

      await refreshProfile(uid);
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Failed to switch handle mode.");
    } finally {
      setSwitchingHandle(false);
    }
  }

  const handle =
    row?.display_handle_mode === "username"
      ? row?.username || row?.random_id || ""
      : row?.random_id || row?.username || "";

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
        <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-4">
          {/* Header */}
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
              <div className="text-sm text-slate-600">{row.bio || "No bio yet."}</div>
            </div>
          </div>

          {/* Handle mode controls (Option #1 applied) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">
              Display handle:&nbsp;
              <strong>{row.display_handle_mode ?? "random_id"}</strong>
            </span>

            <button
              type="button"
              onClick={() => setHandleMode("random_id")}
              className="rounded bg-slate-900 px-3 py-1 text-white text-sm disabled:opacity-60"
              disabled={switchingHandle === "random_id"}
            >
              {switchingHandle === "random_id" ? "Switching…" : "Use Random ID"}
            </button>

            <button
              type="button"
              onClick={() => setHandleMode("username")}
              className="rounded bg-slate-200 px-3 py-1 text-slate-900 text-sm disabled:opacity-60"
              disabled={switchingHandle === "username" || !row.username}
              title={!row.username ? "Set a username first" : ""}
            >
              {switchingHandle === "username" ? "Switching…" : "Use Username"}
            </button>
          </div>

          {/* Optional details */}
          {(row.dob ||
            row.city_name ||
            row.county_name ||
            row.state_code ||
            row.country_code) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
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

          <div className="text-sm">
            <Link to="/settings/profile" className="underline">
              Edit profile →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
