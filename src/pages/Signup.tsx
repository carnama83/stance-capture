import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";
import UsernameField from "../components/UsernameField";
import { DobField } from "../components/DobField";
import LocationPicker from "../components/LocationPicker";

export default function Signup() {
  const sb = React.useMemo(getSupabase, []);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [dob, setDob] = React.useState("");
  const [detectedLoc] = React.useState<any>(null); // TODO: call your edge function for IP-geo
  const [chosenLoc, setChosenLoc] = React.useState<any>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return setMsg("Supabase is OFF");
    if (!chosenLoc) return setMsg("Please confirm your location");

    try {
      setBusy(true);
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;

      const uid = (await sb.auth.getUser()).data.user?.id;
      await sb.rpc("init_user_after_signup", { p_email: email, p_random_id: null, p_username: username || null });

      // Enforced min-age + encryption on server
      await sb.rpc("profile_set_dob_checked", {
        p_user_id: uid, p_dob: dob, p_key: "<EDGE_PROVIDED_KEY>", p_min_years: 13
      });

      // Persist chosen location + audit
      await sb.rpc("set_user_location", {
        p_user_id: uid,
        p_location_id: chosenLoc.locationId,
        p_precision: chosenLoc.precision,
        p_override: chosenLoc.override,
        p_source: chosenLoc.source
      });

      setMsg("Account created. You can now log in.");
    } catch (err: any) {
      setMsg(err.message || "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6 space-y-3">
      <h1 className="text-xl font-semibold">Sign up</h1>
      <form onSubmit={onSignup} className="space-y-3">
        <input className="w-full border rounded px-3 py-2" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
        <input className="w-full border rounded px-3 py-2" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required />
        <UsernameField value={username} onChange={setUsername} />
        <DobField value={dob} setValue={setDob} />
        <LocationPicker detected={detectedLoc} onConfirm={setChosenLoc} />
        <button className="rounded bg-slate-900 text-white px-4 py-2" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}
    </div>
  );
}
