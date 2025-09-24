import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import UsernameField from "../components/UsernameField";
import { DobField } from "../components/DobField";
import LocationPicker from "../components/LocationPicker";

export default function Signup() {
  const sb = React.useMemo(getSupabase, []);
  const nav = useNavigate();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [dob, setDob] = React.useState("");
  const [detectedLoc] = React.useState<any>(null); // TODO: call your IP-geo function to prefill
  const [chosenLoc, setChosenLoc] = React.useState<any>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    if (!chosenLoc) return setMsg("Please confirm your location.");

    try {
      setBusy(true);

      // 1) Auth sign-up
      const { error: signErr } = await sb.auth.signUp({ email, password });
      if (signErr) throw signErr;
      const uid = (await sb.auth.getUser()).data.user?.id;

      // 2) Minimal user initialization (your RPC must exist)
      await sb.rpc("init_user_after_signup", {
        p_email: email,
        p_random_id: null,
        p_username: username || null,
      });

      // 3) Enforced DOB (server will validate min-age + encrypt)
      await sb.rpc("profile_set_dob_checked", {
        p_user_id: uid,
        p_dob: dob,                // YYYY-MM-DD
        p_key: "<EDGE_PROVIDED_KEY>",
        p_min_years: 13,
      });

      // 4) Persist coarse location + audit
      await sb.rpc("set_user_location", {
        p_user_id: uid,
        p_location_id: chosenLoc.locationId,
        p_precision: chosenLoc.precision,
        p_override: chosenLoc.override,
        p_source: chosenLoc.source,
      });

      setMsg("Account created. You can now log in.");
      nav("/login");
    } catch (err: any) {
      setMsg(err.message || "Sign up failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-bold">Sign up</h1>

      <form className="space-y-4" onSubmit={onSignup}>
        <input
          type="email"
          className="w-full border rounded px-3 py-2"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          type="password"
          className="w-full border rounded px-3 py-2"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />

        {/* Optional username with real-time availability */}
        <UsernameField value={username} onChange={setUsername} />

        {/* Mandatory DOB (client check + server RPC will enforce) */}
        <DobField value={dob} setValue={setDob} />

        {/* Coarse location picker (confirm or override detection) */}
        <LocationPicker detected={detectedLoc} onConfirm={setChosenLoc} />

        <button
          type="submit"
          className="w-full rounded bg-slate-900 text-white py-2"
          disabled={busy}
        >
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>

      {msg && <p className="text-sm text-slate-700">{msg}</p>}
      <p className="text-sm">
        Already have an account?{" "}
        <Link to="/login" className="underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
