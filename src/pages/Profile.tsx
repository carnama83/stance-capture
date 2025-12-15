// src/pages/Profile.tsx
import * as React from "react";
import { Link } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import { ROUTES } from "@/routes/paths";
import { Button } from "@/components/ui/button";

type ProfileRow = {
  user_id?: string;
  random_id: string | null;
  username: string | null;
  display_handle_mode?: "random_id" | "username" | null;
  bio?: string | null;
  avatar_url?: string | null;

  // Optional extras if you materialize/join them elsewhere:
  dob?: string | null;
  state_code?: string | null;
  country_code?: string | null;
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

  // Local UI state for handle-mode switch
  const [switchingHandle, setSwitchingHandle] = React.useState<
    false | "random_id" | "username"
  >(false);

  // Load session + subscribe to auth changes
  React.useEffect(() => {
    let unsub: undefined | (() => void);

    (async () => {
      try {
        const { data } = await sb.auth.getSession();
        setSession(data.session);

        const sub = sb.auth.onAuthStateChange((_evt, s) => setSession(s));
        unsub = sub?.data?.subscription?.unsubscribe;
      } catch (e: any) {
        // eslint-disable-next-line no-console
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
        // 1) Fetch current profile row
        const got = await sb
          .from("profiles")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();

        if (got.error) throw got.error;

        let profile = (got.data as ProfileRow) ?? null;

        // 2) If missing, bootstrap then re-fetch once
        if (!profile) {
          // ✅ Per public_schema.sql, this is the idempotent bootstrap function
          // that ensures public.users + public.profiles (with generate_random_id()).
          const boot = await sb.rpc("bootstrap_user_after_login");
          if (boot.error) {
            throw new Error(`Bootstrap failed: ${boot.error.message}`);
          }

          const got2 = await sb
            .from("profiles")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle();

          if (got2.error) throw got2.error;
          profile = (got2.data as ProfileRow) ?? null;
        }

        if (!cancelled) setRow(profile);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error(e);
        if (!cancelled) setMsg(e?.message ?? "Failed to load profile");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    if (session?.user?.id) {
      fetchOrInitProfile(session.user.id);
    } else {
      setRow(null);
    }

    return () => {
      cancelled = true;
    };
  }, [sb, session?.user?.id]);

  async function refreshProfile(userId: string) {
    const got = await sb
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!got.error) setRow((got.data as ProfileRow) ?? null);
  }

  // RPC to switch handle mode
  async function setHandleMode(mode: "random_id" | "username") {
    try {
      setSwitchingHandle(mode);
      setMsg(null);

      // Guard: username must exist before switching to 'username'
      if (mode === "username" && !row?.username) {
        setMsg("Set a username first before switching display to username.");
        return;
      }

      // Call wrapper RPC: set_my_display_handle(p_mode display_handle_mode_enum)
      const r = await sb.rpc("set_my_display_handle", { p_mode: mode });
      if (r.error) {
        throw new Error(r.error.message);
      }

      // Refresh
      const uid = session?.user?.id;
      if (uid) await refreshProfile(uid);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error(e);
      setMsg(e?.message ?? "Failed to switch handle mode.");
    } finally {
      setSwitchingHandle(false);
    }
  }

  // Derive handle (keeps original display logic)
  const handle =
    row?.display_handle_mode === "username"
      ? row?.username || row?.random_id || ""
      : row?.random_id || row?.username || "";

  // Render
  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      {/* Header with Home */}
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Profile</h1>
        <Button asChild variant="outline">
          <Link to={ROUTES.home}>Home</Link>
        </Button>
      </div>

      {session === undefined ? (
        <div className="text-slate-600">Loading session…</div>
      ) : !session ? (
        <div className="rounded border p-4">
          <div className="text-slate-700">You are not logged in.</div>
          <div className="mt-3 flex gap-2">
            <Button asChild>
              <Link to={ROUTES.login}>Log in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={ROUTES.signup}>Sign up</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded border p-4 space-y-3">
          {msg && (
            <div className="rounded bg-amber-50 border border-amber-200 p-3 text-amber-900 text-sm">
              {msg}
            </div>
          )}

          <div className="flex items-start gap-3">
            <div className="h-14 w-14 rounded bg-slate-200 overflow-hidden flex items-center justify-center">
              {row?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.avatar_url}
                  alt="avatar"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-slate-600 text-sm">No<br />Avatar</span>
              )}
            </div>

            <div className="flex-1">
              <div className="text-sm text-slate-600">Signed in as</div>
              <div className="font-medium">{session.user.email}</div>

              <div className="mt-2 text-sm">
                <span className="text-slate-600">Your handle: </span>
                <span className="font-medium">{handle}</span>
              </div>
              <div className="text-sm text-slate-600">{row?.bio || "No bio yet."}</div>
            </div>
          </div>

          {/* Handle mode controls */}
          {row && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-600">
                Display handle:&nbsp;
                <strong>{row.display_handle_mode ?? "random_id"}</strong>
              </span>

              <button
                type="button"
                onClick={() => setHandleMode("random_id")}
                className="rounded bg-slate-200 px-3 py-1 text-slate-900 text-sm disabled:opacity-60"
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
          )}

          {/* Optional details */}
          {(row?.dob ||
            row?.city_name ||
            row?.county_name ||
            row?.state_code ||
            row?.country_code) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {row?.dob && (
                <div>
                  <span className="text-slate-600">DOB: </span>
                  <span>{row.dob}</span>
                </div>
              )}
              {row?.city_name && (
                <div>
                  <span className="text-slate-600">City: </span>
                  <span>{row.city_name}</span>
                </div>
              )}
              {row?.county_name && (
                <div>
                  <span className="text-slate-600">County: </span>
                  <span>{row.county_name}</span>
                </div>
              )}
              {row?.state_code && (
                <div>
                  <span className="text-slate-600">State: </span>
                  <span>{row.state_code}</span>
                </div>
              )}
              {row?.country_code && (
                <div>
                  <span className="text-slate-600">Country: </span>
                  <span>{row.country_code}</span>
                </div>
              )}
            </div>
          )}

          <div className="pt-2 flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => session?.user?.id && refreshProfile(session.user.id)}
              disabled={busy}
            >
              {busy ? "Loading…" : "Refresh"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
