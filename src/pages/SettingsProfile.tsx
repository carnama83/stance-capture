import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";
import UsernameField from "../components/UsernameField";
import AvatarUploader from "../components/AvatarUploader";

export default function SettingsProfile() {
  const sb = React.useMemo(getSupabase, []);
  const [uid, setUid] = React.useState<string>("");
  const [form, setForm] = React.useState({ username: "", display_handle_mode: "random_id", bio: "", avatar_url: "" });
  const [handle, setHandle] = React.useState<string>("");
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      if (!sb) return setMsg("Supabase is OFF");
      const u = await sb.auth.getUser(); const id = u.data.user?.id;
      if (!id) { setMsg("Please log in."); return; }
      setUid(id);
      const { data, error } = await sb.from("profiles").select("*").eq("user_id", id).maybeSingle();
      if (error) return setMsg(error.message);
      setForm({
        username: data?.username || "",
        display_handle_mode: data?.display_handle_mode || "random_id",
        bio: data?.bio || "",
        avatar_url: data?.avatar_url || ""
      });
      setHandle(data?.display_handle_mode === "username" ? (data?.username || data?.random_id) : data?.random_id);
    })();
  }, [sb]);

  async function saveProfile() {
    setMsg(null);
    try {
      await sb!.from("profiles").update({
        bio: form.bio || null,
        avatar_url: form.avatar_url || null
      }).eq("user_id", uid);
      setMsg("Profile saved.");
    } catch (e: any) { setMsg(e.message); }
  }
  async function saveUsername() {
    setMsg(null);
    try {
      await sb!.rpc("set_username", { p_user_id: uid, p_username: form.username });
      setMsg("Username updated.");
    } catch (e: any) { setMsg(e.message); }
  }
  async function setDisplay(mode: "random_id" | "username") {
    setMsg(null);
    try {
      await sb!.rpc("set_display_handle", { p_user_id: uid, p_mode: mode });
      setMsg("Display handle updated.");
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div className="mx-auto max-w-xl p-6 space-y-4">
      <h1 className="text-xl font-semibold">Profile settings</h1>
      <div className="text-sm text-slate-600">Random ID is read-only; Username is optional and limited.</div>

      <UsernameField value={form.username} onChange={(v) => setForm(f => ({ ...f, username: v }))} />
      <div className="flex gap-2">
        <button className="border rounded px-3 py-1" onClick={() => setDisplay("random_id")}>Use Random ID</button>
        <button className="border rounded px-3 py-1" onClick={() => setDisplay("username")}>Use Username</button>
        <button className="border rounded px-3 py-1" onClick={saveUsername}>Save Username</button>
      </div>

      <textarea className="w-full border rounded px-3 py-2" rows={3}
        value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />

      <AvatarUploader uid={uid} handle={handle} onChange={(url) => setForm(f => ({ ...f, avatar_url: url || "" }))} />
      <button className="rounded bg-slate-900 text-white px-4 py-2" onClick={saveProfile}>Save changes</button>

      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
