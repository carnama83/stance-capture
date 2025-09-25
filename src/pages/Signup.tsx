// src/pages/Signup.tsx
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import UsernameField from "../components/UsernameField";
import { DobField } from "../components/DobField";
import LocationPicker from "../components/LocationPicker";

type ChosenLoc = any; // your LocationPicker's onConfirm payload

export default function Signup() {
  const sb = React.useMemo(getSupabase, []);
  const nav = useNavigate();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [dob, setDob] = React.useState(""); // "YYYY-MM-DD"
  const [detectedLoc] = React.useState<any>(null); // TODO: prefill via IP-geo if you add that later
  const [chosenLoc, setChosenLoc] = React.useState<ChosenLoc | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (!sb) {
    return (
      <div className="mx-auto max-w-md p-6 space-y-4">
        <h1 className="text-2xl font-bold">Sign up</h1>
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-rose-700">
          Supabase is OFF (check env).
        </div>
      </div>
    );
  }

  // ---- helpers -------------------------------------------------------------

  // try to normalize whatever LocationPicker returns into (country,state,county,city)
  function normalizeLoc(loc: any) {
    const pick = (...candidates: any[]) =>
      candidates.find((v) => typeof v === "string" && v.trim().length > 0) || "";

    const country = pick(
      loc?.country,
      loc?.country_code,
      loc?.countryCode,
      loc?.country_name
    );
    const state = pick(
      loc?.state,
      loc?.state_code,
      loc?.stateCode,
      loc?.region,
      loc?.region_code
    );
    const county = pick(loc?.county, loc?.county_name);
    const city = pick(loc?.city, loc?.city_name, loc?.locality);

    return { country, state, county, city };
  }

  function calcAge(d: string) {
    if (!d) return null;
    const parts = d.split("-").map((n) => parseInt(n, 10));
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
    const [y, m, day] = parts;
    const today = new Date();
    let age = today.getFullYear() - y;
    const mm = today.getMonth() + 1;
    const dd = today.getDate();
    if (m > mm || (m === mm && day > dd)) age--;
    return age;
  }

  async function finalizeOnboarding() {
    // all calls are idempotent; safe to retry
    const { error: iErr } = await sb.rpc("init_user_after_signup");
    if (iErr) throw iErr;

    if (username.trim()) {
      // set_username enforces format/reserved/uniqueness + 30-day cap
      const { error: uErr } = await sb.rpc("set_username", {
        p_username: username.trim().toLowerCase(),
      });
      if (uErr && !String(uErr.message || "").startsWith("ERR_USERNAME_LIMIT")) {
        // treat "limit" as a soft failure (user can change later)
        throw uErr;
      }
    }

    if (dob) {
      const { error: dErr } = await sb.rpc("profile_set_dob_checked", {
        p_dob: dob,
      });
      if (dErr) throw dErr;
    }

    if (chosenLoc) {
      const { country, state, county, city } = normalizeLoc(chosenLoc);
      const hasAny = country || state || county || city;
      if (hasAny) {
        const { error: lErr } = await sb.rpc("set_user_location", {
          p_country: country,
          p_state: state,
          p_county: county,
          p_city: city,
        });
        if (lErr) throw lErr;
      }
    }
  }

  function stashForFirstLogin() {
    try {
      const { country, state, county, city } = chosenLoc
        ? normalizeLoc(chosenLoc)
        : { country: "", state: "", county: "", city: "" };
      const payload = {
        dob: dob || null,
        loc: { country, state, county, city },
        username: username.trim().toLowerCase() || null,
      };
      localStorage.setItem("postSignupProfile", JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  // ---- submit --------------------------------------------------------------

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!email || !password) {
      setMsg("Enter email and password.");
      return;
    }
    if (!dob) {
      setMsg("Please provide your date of birth.");
      return;
    }
    const age = calcAge(dob);
    if (age !== null && age < 13) {
      setMsg("You must be at least 13 years old.");
      return;
    }
    if (!chosenLoc) {
      setMsg("Please confirm your location.");
      return;
    }

    try {
      setBusy(true);

      // 1) Auth sign-up
      const { error: signErr } = await sb.auth.signUp({ email, password });
      if (signErr) throw signErr;

      // 2) If we already have a session (email confirm OFF), finalize now
      const { data: sess } = await sb.auth.getSession();
      if (sess.session) {
        await finalizeOnboarding();
        setMsg("Account created!");
        nav("/profile");
        return;
      }

      // 3) If no session yet (email confirm ON), stash and guide the user
      stashForFirstLogin();
      setMsg(
        "Check your email to confirm your account. After you log in, we’ll finish setting up your profile automatically."
      );
    } catch (err: any) {
      setMsg(err.message || "Sign up failed.");
    } finally {
      setBusy(false);
    }
  }

  // ---- render --------------------------------------------------------------

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

        {/* Mandatory DOB (client check; server RPC will persist) */}
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
