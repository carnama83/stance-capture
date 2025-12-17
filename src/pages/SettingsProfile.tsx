// src/pages/SettingsProfile.tsx
import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";
import UsernameField from "../components/UsernameField";
import AvatarUploader from "../components/AvatarUploader";

type DisplayHandleMode = "random_id" | "username";

export default function SettingsProfile() {
  const sb = React.useMemo(getSupabase, []);
  const [uid, setUid] = React.useState<string>("");

  // store random_id explicitly so we can display it + use it as fallback
  const [randomId, setRandomId] = React.useState<string>("");

  const [form, setForm] = React.useState({
    username: "",
    display_handle_mode: "random_id" as DisplayHandleMode,
    bio: "",
    avatar_url: "",
  });

  const [handle, setHandle] = React.useState<string>("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // track auth session more robustly across navigation
  const [sessionUserId, setSessionUserId] = React.useState<string | null>(null);

  // keep the username we loaded from DB so we can prevent no-op updates / double-click spam
  const [initialUsername, setInitialUsername] = React.useState<string>("");

  // ✅ NEW: show raw error payload when set_username fails
  const [lastUsernameError, setLastUsernameError] = React.useState<any>(null);

  React.useEffect(() => {
    if (!sb) return;

    let unsub: (() => void) | undefined;

    (async () => {
      try {
        // Prefer local session read first
        const sess = await sb.auth.getSession();
        const id = sess.data.session?.user?.id ?? null;
        setSessionUserId(id);

        const sub = sb.auth.onAuthStateChange((_evt, s) => {
          setSessionUserId(s?.user?.id ?? null);
        });
        unsub = sub?.data?.subscription?.unsubscribe;
      } catch (e) {
        // If session read fails, keep null; UI will show "Please log in."
        setSessionUserId(null);
      }
    })();

    return () => unsub?.();
  }, [sb]);

  // Fetch profile whenever session user id is present/changes
  React.useEffect(() => {
    (async () => {
      if (!sb) return setMsg("Supabase is OFF (check env).");

      // Clear any stale "Please log in" message when we do have a session
      if (!sessionUserId) {
        setUid("");
        setMsg("Please log in.");
        return;
      }

      try {
        setMsg(null);
        const id = sessionUserId;
        setUid(id);

        const { data, error } = await sb
          .from("profiles")
          .select("*")
          .eq("user_id", id)
          .maybeSingle();
        if (error) throw error;

        const username = data?.username || "";
        const mode: DisplayHandleMode =
          (data?.display_handle_mode as DisplayHandleMode) || "random_id";
        const bio = data?.bio || "";
        const avatar_url = data?.avatar_url || "";
        const rid = data?.random_id || "";

        setRandomId(rid);
        setForm({ username, display_handle_mode: mode, bio, avatar_url });

        // store baseline username for "no-op" comparison
        setInitialUsername(username);

        setHandle(mode === "username" ? (username || rid) : rid);
      } catch (e: any) {
        setMsg(e.message || "Failed to load profile");
      }
    })();
  }, [sb, sessionUserId]);

  async function saveProfile() {
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    try {
      setBusy(true);
      const { error } = await sb
        .from("profiles")
        .update({
          bio: form.bio || null,
          avatar_url: form.avatar_url || null,
        })
        .eq("user_id", uid);
      if (error) throw error;
      setMsg("Profile saved.");
    } catch (e: any) {
      setMsg(e.message || "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  async function updateUsername() {
    if (busy) return;

    setMsg(null);
    setLastUsernameError(null);

    if (!sb) return setMsg("Supabase is OFF (check env).");

    const desired = (form.username || "").trim().toLowerCase();
    const current = (initialUsername || "").trim().toLowerCase();

    if (!desired) {
      setMsg("Enter a username first.");
      return;
    }
    if (desired === current) {
      setMsg("That’s already your current username.");
      return;
    }

    try {
      setBusy(true);

      const res = await sb.rpc("set_username", { p_username: desired });

      if (res.error) {
        // ✅ capture full error payload so we can see the real reason behind 400
        setLastUsernameError({
          code: res.error.code,
          message: res.error.message,
          details: (res.error as any).details,
          hint: (res.error as any).hint,
        });

        const raw = String(res.error.message || "").trim();

        if (raw.startsWith("ERR_USERNAME_LIMIT")) {
          setMsg("You’ve hit the username change limit (30 days). Try again later.");
        } else if (raw.toLowerCase().includes("reserved")) {
          setMsg("That username is reserved. Please choose another.");
        } else if (raw.toLowerCase().includes("taken") || res.error.code === "23505") {
          setMsg("That username is already taken.");
        } else if (
          raw.toLowerCase().includes("invalid username") ||
          raw.toLowerCase().includes("3–20") ||
          raw.toLowerCase().includes("3-20")
        ) {
          setMsg("Invalid username. Use 3–20 characters: a–z, 0–9, underscore.");
        } else if (
          raw.toLowerCase().includes("not authenticated") ||
          raw.toLowerCase().includes("auth")
        ) {
          setMsg("Session not detected. Please refresh and try again.");
        } else {
          setMsg(`Username update failed: ${raw}`);
        }
        return;
      }

      // success
      setForm((f) => ({ ...f, username: desired }));
      setInitialUsername(desired);
      setMsg("Username updated.");

      if (form.display_handle_mode === "username") {
        setHandle(desired || randomId);
      }
    } catch (e: any) {
      setLastUsernameError({ message: e?.message ?? String(e) });
      setMsg(`Username update failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  async function setDisplay(mode: DisplayHandleMode) {
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");

    if (mode === "username" && !form.username) {
      setMsg('Set a username before choosing “username” display mode.');
      return;
    }

    try {
      setBusy(true);
      const { error } = await sb.rpc("set_my_display_handle", { p_mode: mode });
      if (error) throw error;

      setForm((f) => ({ ...f, display_handle_mode: mode }));
      setHandle(mode === "username" ? (form.username || randomId) : randomId);
      setMsg("Display handle updated.");
    } catch (e: any) {
      setMsg(e.message || "Could not update display mode");
    } finally {
      setBusy(false);
    }
  }

  const isUsernameSet = !!(form.username || "").trim();
  const isUsernameChanged =
    (form.username || "").trim().toLowerCase() !==
    (initialUsername || "").trim().toLowerCase();

  return (
    <div className="mx-auto max-w-xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">Profile settings</h1>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}

      {/* ✅ Debug panel (only shows when set_username fails) */}
      {lastUsernameError && (
        <div className="rounded border p-3 text-xs bg-white">
          <div className="font-medium mb-1">set_username error (debug)</div>
          <pre className="whitespace-pre-wrap break-words">
            {JSON.stringify(lastUsernameError, null, 2)}
          </pre>
        </div>
      )}

      {/* Random ID (read-only, always visible) */}
      <div className="rounded border p-3 space-y-1">
        <div className="text-sm font-medium">Your Random ID (read-only)</div>
        <div className="text-sm text-slate-700 break-all">
          {randomId ? randomId : <span className="text-slate-500">Loading…</span>}
        </div>
        <div className="text-xs text-slate-500">
          This is generated at registration and cannot be changed.
        </div>
      </div>

      {/* Username */}
      <div className="rounded border p-3 space-y-2">
        <div className="text-sm font-medium">Username</div>
        <div className="text-xs text-slate-500">
          You can update your username (subject to rules/limits enforced by the server).
        </div>

        <UsernameField
          value={form.username}
          onChange={(v) => setForm((f) => ({ ...f, username: v }))}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="border rounded px-3 py-1"
            onClick={updateUsername}
            disabled={busy || !isUsernameSet || !isUsernameChanged}
            title={
              !isUsernameSet
                ? "Enter a username first"
                : !isUsernameChanged
                ? "No changes to save"
                : ""
            }
          >
            {isUsernameSet ? "Update Username" : "Set Username"}
          </button>
        </div>
      </div>

      {/* Display choice */}
      <div className="rounded border p-3 space-y-2">
        <div className="text-sm font-medium">Public display</div>
        <div className="text-xs text-slate-500">
          Choose what other users see on your stances/comments/posts.
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="border rounded px-3 py-1"
            onClick={() => setDisplay("random_id")}
            disabled={busy}
            aria-pressed={form.display_handle_mode === "random_id"}
            title="Show Random ID across the app"
          >
            Use Random ID (default)
          </button>

          <button
            type="button"
            className="border rounded px-3 py-1"
            onClick={() => setDisplay("username")}
            disabled={busy || !isUsernameSet}
            aria-pressed={form.display_handle_mode === "username"}
            title={!isUsernameSet ? "Set a username first" : "Show Username across the app"}
          >
            Use Username
          </button>
        </div>

        <div className="text-xs text-slate-600">
          Currently showing: <span className="font-medium">{handle || "(unknown)"}</span>
        </div>
      </div>

      {/* Bio */}
      <textarea
        className="w-full border rounded px-3 py-2"
        rows={3}
        placeholder="Bio"
        value={form.bio}
        onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
      />

      {/* Avatar */}
      <AvatarUploader
        uid={uid}
        handle={handle}
        onChange={(url) => setForm((f) => ({ ...f, avatar_url: url || "" }))}
      />

      {/* Save bio/avatar */}
      <button
        type="button"
        className="rounded bg-slate-900 text-white px-4 py-2"
        onClick={saveProfile}
        disabled={busy}
      >
        {busy ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
