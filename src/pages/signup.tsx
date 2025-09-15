// pages/signup.tsx (Next.js) or src/pages/signup.tsx
import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import UsernameField from "@/components/UsernameField";
import { DobField } from "@/components/DobField";
import LocationPicker from "@/components/LocationPicker";

export default function SignupPage() {
  const sb = React.useMemo(getSupabase, []);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [dob, setDob] = React.useState("");
  const [detectedLoc, setDetectedLoc] = React.useState<any>(null); // fill via your Edge Function
  const [chosenLoc, setChosenLoc] = React.useState<any>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) { setMsg("Supabase is OFF"); return; }
    if (!chosenLoc) { setMsg("Please confirm your location"); return; }

    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) { setMsg(error.message); return; }
    const uid = (await sb.auth.getUser()).data.user?.id;

    await sb.rpc("init_user_after_signup", { p_email: email, p_random_id: null, p_username: username || null });
    // Enforced DOB (server-side min-age + encryption)
    await sb.rpc("profile_set_dob_checked", { p_user_id: uid, p_dob: dob, p_key: "<EDGE_KEY>", p_min_years: 13 });
    // Persist location + audit
    await sb.rpc("set_user_location", {
      p_user_id: uid, p_location_id: chosenLoc.locationId,
      p_precision: chosenLoc.precision, p_override: chosenLoc.override, p_source: chosenLoc.source
    });

    setMsg("Account created.");
  }

  return (
    <div className="mx-auto max-w-md p-6 space-y-3">
      <input className="w-full border rounded px-3 py-2" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
      <input className="w-full border rounded px-3 py-2" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
      <UsernameField value={username} onChange={setUsername} />
      <DobField value={dob} setValue={setDob} />
      <LocationPicker detected={detectedLoc} onConfirm={setChosenLoc} />
      <button className="rounded bg-slate-900 text-white px-4 py-2" onClick={(e:any)=>onSubmit(e)}>Sign up</button>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
