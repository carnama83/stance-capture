// src/pages/SettingsSessions.tsx
import * as React from "react";
import PageLayout from "../components/PageLayout";
import { getSupabase } from "../lib/supabaseClient";

type Session = import("@supabase/supabase-js").Session;

export default function SettingsSessions() {
  const sb = React.useMemo(getSupabase, []);
  const [ready, setReady] = React.useState(false);
  const [session, setSession] = React.useState<Session | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<null | "local" | "others" | "global">(null);

  // Initialize auth state safely
  React.useEffect(() => {
    let unsub: { unsubscribe?: () => void } | undefined;

    if (!sb) {
      // If Supabase client isn't available (env), don't blank the page
      setReady(true);
      return;
    }

    sb.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session ?? null);
        setReady(true);
      })
      .catch(() => setReady(true))
      .finally(() => {
        const sub = sb.auth.onAuthStateChange((_evt, s) => {
          setSession(s ?? null);
          setReady(true);
        });
        unsub = sub.data?.subscription;
      });

    return () => unsub?.unsubscribe?.();
  }, [sb]);

  async function signOutLocal() {
    if (!sb) return;
    setMsg(null);
    setBusy("local");
    try {
      const { error } = await sb.auth.signOut(); // this device only
      if (error) throw error;
      setMsg("Signed out on this device.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to sign out on this device.");
    } finally {
      setBusy(null);
    }
  }

  async function signOutOthers() {
    if (!sb) return;
    setMsg(null);
    setBusy("others");
    try {
      // Supabase JS v2 supports scoped sign-out:
      const { error } = await sb.auth.signOut({ scope: "others" as any });
      if (error) throw error;
      setMsg("Signed out on other devices.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to sign out on other devices.");
    } finally {
      setBusy(null);
    }
  }

  async function signOutGlobal() {
    if (!sb) return;
    setMsg(null);
    setBusy("global");
    try {
      const { error } = await sb.auth.signOut({ scope: "global" as any });
      if (error) throw error;
      setMsg("Signed out everywhere.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to sign out everywhere.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Sessions</h1>
          <p className="text-sm text-slate-600">
            Manage where you’re signed in. Use “Other devices” to invalidate sessions on phones,
            tablets, or laptops you’re not using anymore.
          </p>
        </header>

        {!ready ? (
          // Always render something while initializing
          <div className="text-sm text-slate-500">Loading sessions…</div>
        ) : !session ? (
          // Friendly unauth state (instead of returning null/blank)
          <div className="rounded border bg-slate-50 p-4 text-slate-700">
            You’re not logged in. Please sign in to manage sessions.
          </div>
        ) : (
          <>
            {/* Current session info (best-effort; client can't list all sessions) */}
            <section className="rounded-lg border p-4">
              <div className="font-medium mb-1">This device</div>
              <div className="text-sm text-slate-600">
                Signed in as <span className="font-medium">{session.user.email}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Session ID: <code className="break-all">{session.access_token?.slice(0, 32) || "(hidden)"}</code>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                  onClick={signOutLocal}
                  disabled={busy !== null}
                >
                  {busy === "local" ? "Signing out…" : "Sign out on this device"}
                </button>
              </div>
            </section>

            {/* Global controls */}
            <section className="rounded-lg border p-4">
              <div className="font-medium mb-1">Other devices</div>
              <p className="text-sm text-slate-600">
                You can invalidate sessions on other devices without signing out here.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                  onClick={signOutOthers}
                  disabled={busy !== null}
                  title="Keep this device signed in; log out everywhere else."
                >
                  {busy === "others" ? "Signing out…" : "Sign out on other devices"}
                </button>
                <button
                  className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                  onClick={signOutGlobal}
                  disabled={busy !== null}
                  title="Sign out on all devices including this one."
                >
                  {busy === "global" ? "Signing out…" : "Sign out everywhere"}
                </button>
              </div>
            </section>
          </>
        )}

        {msg && (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-emerald-700 text-sm">
            {msg}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
