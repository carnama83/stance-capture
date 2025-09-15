// src/components/AvatarUploader.tsx
import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";

export default function AvatarUploader({
  uid, handle, onChange
}: { uid: string; handle: string; onChange: (url: string | null) => void }) {
  const client = React.useMemo(getSupabase, []);
  const [msg, setMsg] = React.useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { setMsg("Use JPG/PNG/WebP"); return; }
    if (f.size > 5 * 1024 * 1024) { setMsg("Max 5MB"); return; }
    const img = new Image(); img.src = URL.createObjectURL(f);
    await new Promise(res => { img.onload = () => res(None); });
    if (img.width < 200 || img.height < 200) { setMsg("Min 200×200px"); return; }

    if (!client) { setMsg("Supabase OFF"); return; }
    const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
    const path = `avatars/${uid}/${Date.now()}.${ext}`;
    const { error } = await client.storage.from("avatars").upload(path, f, { upsert: true, contentType: f.type });
    if (error) { setMsg(error.message); return; }

    const { data } = client.storage.from("avatars").getPublicUrl(path);
    const url = data.publicUrl;
    const alt = `Avatar of @${handle}`;
    await client.from("avatars").insert({ user_id: uid, url, alt_text: alt }).catch(() => ({}));
    onChange(url);
    setMsg("Uploaded.");
  }

  async function remove() {
    onChange(null); setMsg("Removed (fallback in use).");
  }

  return (
    <div className="space-y-2">
      <input type="file" accept="image/*" onChange={onFile} />
      <button className="rounded border px-3 py-1" type="button" onClick={remove}>Remove avatar</button>
      {msg && <div className="text-xs">{msg}</div>}
    </div>
  );
}
