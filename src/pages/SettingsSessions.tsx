// src/pages/SettingsSessions.tsx
import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";

type Device = {
  id: string;
  user_id?: string;
  label?: string | null;
  user_agent?: string | null;
  ip?: string | null;
  created_at?: string | null;
  last_seen_at?: string | null;
};

type SessionRow = {
  id: string;
  user_id?: string;
  device_id?: string | null;
  ip?: string | null;
  created_at?: string | null;
  last_accessed_at?: string | null;
  revoked_at?: string | null;
};

export default function SettingsSessions() {
  const sb = React.useMemo(getSupabase, []);
  const [uid, setUid] = React.useState<string>("");
  const [devices, setDevices] = React.useState<Device[]>([]);
  const [sessions, setSessions] = React.useState<SessionRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      if (!sb) return setMsg("Supabase is OFF (check env).");
      const u = await sb.auth.getUser();
      if (!u.data.user) {
        setMsg("Please log in.");
        return;
      }
      setUid(u.data.user.id);
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb]);

  async function refresh() {
    setMsg(null);
    if (!sb || !uid) return;
    // fetch with graceful fallbacks (columns may differ slightly)
    const d = await sb
      .from("devices")
      .select("id, user_id, label, user_agent, ip, created_at, last_seen_at")
      .eq("user_id", uid)
      .order("last_seen_at", { ascending: false })
      .limit(50);
    if (d.error && d.error.code !== "42P01") setMsg(d.error.message); // ignore "table not found"

    const s = await sb
      .from("sessions")
      .select("id, user_id, device_id, ip, created_at, last_accessed_at, revoked_at")
      .eq("user_id", uid)
      .order("last_accessed_at", { ascending: false })
      .limit(50);
    if (s.error && s.error.code !== "42P01") setMsg(s.error.message);

    setDevices(Array.isArray(d.data) ? (d.data as Device[]) : []);
    setSessions(Array.isArray(s.data) ? (s.data as SessionRow[]) : []);
  }

  async function signOutHere() {
    if (!sb) return;
    setBusy(true);
    setMsg(null);
    try {
      await sb.auth.signOut({ scope: "local" }); // only this device
      setMsg("Signed out on this device.");
      // typically you’d redirect to /login here:
      // window.location.href = "#/login";
    } catch (e: any) {
      setMsg(e.message || "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function signOutOthers() {
    if (!sb) return;
    if (!confirm("Sign out on all OTHER devices?")) return;
    setBusy(true);
    setMsg(null);
    try {
      await sb.auth.signOut({ scope: "others" }); // leaves this device signed in
      setMsg("Signed out on other devices.");
      await refresh();
    } catch (e: any) {
      setMsg(e.message || "Could not sign out of other devices.");
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    if (!sb) return;
    if (!confirm("Sign out EVERYWHERE (all devices)?")) return;
    setBusy(true);
    setMsg(null);
    try {
      await sb.auth.signOut({ scope: "global" }); // all sessions (this one too)
      setMsg("Signed out everywhere.");
      // window.location.href = "#/login";
    } catch (e: any) {
      setMsg(e.message || "Could not sign out everywhere.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Sessions & Devices</h1>
      {msg && <div className="text-sm text-slate-700">{msg}</div>}

      <section className="rounded-xl border p-4">
        <div className="flex flex-wrap gap-2">
          <button className="border rounded px-3 py-2 text-sm" onClick={signOutHere} disabled={busy}>
            Sign out here
          </button>
          <button className="border rounded px-3 py-2 text-sm" onClick={signOutOthers} disabled={busy}>
            Sign out on other devices
          </button>
          <button className="border rounded px-3 py-2 text-sm" onClick={signOutEverywhere} disabled={busy}>
            Sign out everywhere
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          “Here / Others / Everywhere” uses Supabase Auth sign-out scopes.{" "}
          <a className="underline" href="https://supabase.com/docs/guides/auth/signout" target="_blank" rel="noreferrer">
            Learn more
          </a>
          .
        </p>
      </section>

      <section className="rounded-xl border p-4">
        <h2 className="font-medium mb-2">Your devices</h2>
        {devices.length === 0 ? (
          <div className="text-sm text-slate-500">No device records.</div>
        ) : (
          <ul className="divide-y">
            {devices.map((d) => (
              <li key={d.id} className="py-3">
                <div className="flex justify-between">
                  <div className="text-sm">
                    <div className="font-medium">{d.label || "Unnamed device"}</div>
                    <div className="text-slate-500">
                      {d.user_agent || "Unknown agent"} {d.ip ? `• ${d.ip}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 text-right">
                    <div>Created: {d.created_at ? new Date(d.created_at).toLocaleString() : "—"}</div>
                    <div>Last seen: {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "—"}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border p-4">
        <h2 className="font-medium mb-2">Recent sessions</h2>
        {sessions.length === 0 ? (
          <div className="text-sm text-slate-500">No session records.</div>
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => (
              <li key={s.id} className="py-3">
                <div className="flex justify-between">
                  <div className="text-sm">
                    <div className="font-medium">Session {s.id.slice(0, 8)}…</div>
                    <div className="text-slate-500">
                      {s.ip ? s.ip + " • " : ""}
                      {s.device_id ? `Device ${s.device_id.slice(0, 6)}…` : "Device —"}
                    </div>
                  </div>
                  <div className="text-xs text-right text-slate-500">
                    <div>Created: {s.created_at ? new Date(s.created_at).toLocaleString() : "—"}</div>
                    <div>Last used: {s.last_accessed_at ? new Date(s.last_accessed_at).toLocaleString() : "—"}</div>
                    <div>Revoked: {s.revoked_at ? new Date(s.revoked_at).toLocaleString() : "—"}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Note: This list is from your app tables and may lag. Per-device revoke of Supabase refresh tokens isn’t exposed to the browser SDK;
          use the **Others/Everywhere** actions above for real revocation. :contentReference[oaicite:1]{index=1}
        </p>
      </section>
    </div>
  );
}
