import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";
import UsernameField from "../components/UsernameField";
import AvatarUploader from "../components/AvatarUploader";

export default function SettingsProfile() {
  const sb = React.useMemo(getSupabase, []);
  const [uid, setUid] = React.useState<string>("");
  const [form, setForm] = React.useState({
    username: "",
    display_handle_mode: "random_id",
    bio: "",
    avatar_url: ""
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
        if (!id) { setMsg("Please log in."); return; }
        setUid(id);

        const { data, error } = await sb.from("profiles").select("*").eq("user_id", id).maybeSingle();
        if (error) throw error;

        setForm({
          username: data?.username || "",
          display_handle_mode: data?.display_handle_mode || "random_id",
          bio: data?.bio || "",
          avatar_url: data?.avatar_url || ""
        });

        setHandle(
          data?.display_handle_mode === "username"
            ? (data?.username || data?.random_id)
            : data?.random_id
        );
      } catch (e: any) {
        setMsg(e.message);
      }
    })();
  }, [sb]);

  async function saveProfile() {
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    try {
      setBusy(true);
      await sb.from("profiles").update({
        bio: form.bio || null,
        avatar_url: form.avatar_url || null
      }).eq("user_id", uid);
      setMsg("Profile saved.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveUsername() {
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    try {
      setBusy(true);
      await sb.rpc("set_username", { p_user_id: uid, p_username: form.username });
      setMsg("Username updated.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setDisplay(mode: "random_id" | "username") {
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    try {
      setBusy(true);
      await sb.rpc("set_display_handle", { p_user_id: uid, p_mode: mode });
      setForm((f) => ({ ...f, display_handle_mode: mode }));
      setMsg("Display handle updated.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">Profile settings</h1>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}

      <div className="text-sm text-slate-600">
        Random ID is read-only; Username is optional and limited.
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
          disabled={busy}
        >
          Use Username
        </button>
        <button
          className="border rounded px-3 py-1"
          onClick={saveUsername}
          disabled={busy}
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
