// src/pages/SettingsProfile.tsx
import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";
import UsernameField from "../components/UsernameField";
import AvatarUploader from "../components/AvatarUploader";

type DisplayHandleMode = "random_id" | "username";

export default function SettingsProfile() {
  const sb = React.useMemo(getSupabase, []);
  const [uid, setUid] = React.useState<string>("");
  const [randomId, setRandomId] = React.useState<string>(""); // ✅ keep random_id for correct handle updates
  const [form, setForm] = React.useState({
    username: "",
    display_handle_mode: "random_id" as DisplayHandleMode,
    bio: "",
    avatar_url: "",
  });
  const [handle, setHandle] = React.useState<string>("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      if (!sb) return setMsg("Supabase is OFF (check env).");
      try {
        const u = await sb.auth.getUser();
        const id = u.data.user?.id;
        if (!id) {
          setMsg("Please log in.");
          return;
        }
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

        setHandle(mode === "username" ? (username || rid) : rid);
      } catch (e: any) {
        setMsg(e.message || "Failed to load profile");
      }
    })();
  }, [sb]);

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

  async function saveUsername() {
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    const desired = (form.username || "").trim().toLowerCase();
    if (!desired) {
      setMsg("Enter a username first.");
      return;
    }
    try {
      setBusy(true);
      const { error } = await sb.rpc("set_username", {
        p_username: desired, // server enforces format, reserved, uniqueness, 30-day cap
      });
      if (error) {
        // Friendly messages
        const msg = String(error.message || "");
        if (msg.startsWith("ERR_USERNAME_LIMIT")) {
          setMsg("You’ve hit the username change limit (30 days). Try again later.");
        } else if (msg.toLowerCase().includes("reserved")) {
          setMsg("That username is reserved. Please choose another.");
        } else if (msg.toLowerCase().includes("taken") || error.code === "23505") {
          setMsg("That username is already taken.");
        } else if (msg.toLowerCase().includes("invalid username")) {
          setMsg("Invalid username. Use 3–20 characters: a–z, 0–9, underscore.");
        } else {
          setMsg(msg || "Could not set username");
        }
        return;
      }

      // Success: update local state; if displaying as username, update handle too
      setForm((f) => ({ ...f, username: desired }));
      setMsg("Username updated.");
      if (form.display_handle_mode === "username") {
        setHandle(desired || randomId);
      }
    } catch (e: any) {
      setMsg(e.message || "Could not set username");
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

      // ✅ Use the same canonical RPC as the Profile toggle page
      const { error } = await sb.rpc("set_my_display_handle", {
        p_mode: mode,
      });
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

  return (
    <div className="mx-auto max-w-xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">Profile settings</h1>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}

      <div className="text-sm text-slate-600">
        Random ID is read-only; Username is optional and limited (max changes per 30 days).
      </div>

      <UsernameField
        value={form.username}
        onChange={(v) => setForm((f) => ({ ...f, username: v }))}
      />

      <div className="flex flex-wrap gap-2">
        <button
          className="border rounded px-3 py-1"
          onClick={() => setDisplay("random_id")}
          disabled={busy}
        >
          Use Random ID
        </button>
        <button
          className="border rounded px-3 py-1"
          onClick={() => setDisplay("username")}
          disabled={busy || !form.username}
          title={!form.username ? "Set a username first" : ""}
        >
          Use Username
        </button>
        <button
          className="border rounded px-3 py-1"
          onClick={saveUsername}
          disabled={busy || !form.username}
        >
          Save Username
        </button>
      </div>

      <textarea
        className="w-full border rounded px-3 py-2"
        rows={3}
        placeholder="Bio"
        value={form.bio}
        onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
      />

      <AvatarUploader
        uid={uid}
        handle={handle}
        onChange={(url) => setForm((f) => ({ ...f, avatar_url: url || "" }))}
      />

      <button
        className="rounded bg-slate-900 text-white px-4 py-2"
        onClick={saveProfile}
        disabled={busy}
      >
        {busy ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
