// src/pages/Signup.tsx
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import UsernameField from "../components/UsernameField";
// We keep your existing DobField but add an explicit visible label for clarity.
import { DobField } from "../components/DobField";

// ---------- Types ----------
type Gender =
  | "male"
  | "female"
  | "nonbinary"
  | "prefer_not_to_say"
  | "self_described";

type Country = { code: string; name: string };
type StateRow = { code: string; name: string; country_code: string };
type CountyRow = { code: string; name: string; state_code: string };
type CityRow = {
  id: string;
  name: string;
  state_code?: string;
  county_code?: string;
  country_code?: string;
};

// ---------- Geo data loader with safe fallbacks ----------
function useGeoData() {
  const sb = React.useMemo(getSupabase, []);
  const [ready, setReady] = React.useState(false);
  const [countries, setCountries] = React.useState<Country[]>([]);
  const [states, setStates] = React.useState<StateRow[]>([]);
  const [counties, setCounties] = React.useState<CountyRow[]>([]);
  const [cities, setCities] = React.useState<CityRow[]>([]);

  React.useEffect(() => {
    (async () => {
      try {
        if (sb) {
          const c = await sb.from("countries").select("code,name").order("name");
          if (c.data) setCountries(c.data);
        }
      } catch {
        /* no-op */
      } finally {
        // Minimal fallback sample if tables don't exist:
        setCountries((prev) =>
          prev.length ? prev : [{ code: "US", name: "United States" }]
        );
        setReady(true);
      }
    })();
  }, [sb]);

  const loadStates = React.useCallback(
    async (country_code: string) => {
      try {
        if (sb) {
          const r = await sb
            .from("states")
            .select("code,name,country_code")
            .eq("country_code", country_code)
            .order("name");
          if (r.data) setStates(r.data);
          else setStates([]);
        } else {
          setStates([{ code: "NJ", name: "New Jersey", country_code }]);
        }
      } catch {
        setStates([{ code: "NJ", name: "New Jersey", country_code }]);
      }
    },
    [sb]
  );

  const loadCounties = React.useCallback(
    async (state_code: string) => {
      try {
        if (sb) {
          const r = await sb
            .from("counties")
            .select("code,name,state_code")
            .eq("state_code", state_code)
            .order("name");
          if (r.data) setCounties(r.data);
          else setCounties([]);
        } else {
          setCounties([{ code: "34003", name: "Bergen County", state_code }]);
        }
      } catch {
        setCounties([{ code: "34003", name: "Bergen County", state_code }]);
      }
    },
    [sb]
  );

  const loadCities = React.useCallback(
    async (state_code: string, county_code?: string) => {
      try {
        if (sb) {
          let q = sb
            .from("cities")
            .select("id,name,state_code,county_code")
            .eq("state_code", state_code);
          if (county_code) q = q.eq("county_code", county_code);
          const r = await q.order("name");
          if (r.data) setCities(r.data);
          else setCities([]);
        } else {
          setCities([{ id: "paramus", name: "Paramus", state_code }]);
        }
      } catch {
        setCities([{ id: "paramus", name: "Paramus", state_code }]);
      }
    },
    [sb]
  );

  return { ready, countries, states, counties, cities, loadStates, loadCounties, loadCities };
}

// ---------- Location Picker V2 ----------
function LocationPickerV2(props: {
  country: string;
  setCountry: (v: string) => void;
  stateCode: string;
  setStateCode: (v: string) => void;
  countyCode: string;
  setCountyCode: (v: string) => void;
  cityId: string;
  setCityId: (v: string) => void;
}) {
  const { ready, countries, states, counties, cities, loadStates, loadCounties, loadCities } =
    useGeoData();

  // Parent→child resets
  React.useEffect(() => {
    if (props.country) loadStates(props.country);
    props.setStateCode("");
    props.setCountyCode("");
    props.setCityId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.country]);

  React.useEffect(() => {
    if (props.stateCode) {
      loadCounties(props.stateCode);
      loadCities(props.stateCode);
    }
    props.setCountyCode("");
    props.setCityId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.stateCode]);

  React.useEffect(() => {
    if (props.stateCode && props.countyCode) {
      loadCities(props.stateCode, props.countyCode);
    }
    props.setCityId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.countyCode]);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">Location</label>
      <p className="text-xs text-muted-foreground">
        Used to personalize regional trends. You can change this later.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Country */}
        <div>
          <label htmlFor="country" className="block text-xs font-medium">
            Country
          </label>
          <select
            id="country"
            className="mt-1 w-full rounded-lg border p-2"
            value={props.country}
            onChange={(e) => props.setCountry(e.target.value)}
            disabled={!ready}
          >
            <option value="">Select country</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>

        {/* State / Region */}
        <div>
          <label htmlFor="state" className="block text-xs font-medium">
            State / Region
          </label>
          <select
            id="state"
            className="mt-1 w-full rounded-lg border p-2"
            value={props.stateCode}
            onChange={(e) => props.setStateCode(e.target.value)}
            disabled={!props.country}
          >
            <option value="">Select state</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>

        {/* County (optional) */}
        <div>
          <label htmlFor="county" className="block text-xs font-medium">
            County (optional)
          </label>
          <select
            id="county"
            className="mt-1 w-full rounded-lg border p-2"
            value={props.countyCode}
            onChange={(e) => props.setCountyCode(e.target.value)}
            disabled={!props.stateCode}
          >
            <option value="">(None)</option>
            {counties.map((k) => (
              <option key={k.code} value={k.code}>
                {k.name}
              </option>
            ))}
          </select>
        </div>

        {/* City (optional, searchable) */}
        <div>
          <label htmlFor="city" className="block text-xs font-medium">
            City (optional)
          </label>
          <input
            id="city"
            list="city-options"
            className="mt-1 w-full rounded-lg border p-2"
            placeholder="Type to search…"
            value={props.cityId}
            onChange={(e) => props.setCityId(e.target.value)}
            disabled={!props.stateCode}
          />
          <datalist id="city-options">
            {cities.map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.name}
              </option>
            ))}
          </datalist>
        </div>
      </div>
    </div>
  );
}

// ---------- Page ----------
export default function Signup() {
  const sb = React.useMemo(getSupabase, []);
  const nav = useNavigate();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [dob, setDob] = React.useState(""); // "YYYY-MM-DD"

  // #2 Gender fields
  const [gender, setGender] = React.useState<Gender>("prefer_not_to_say");
  const [genderSelf, setGenderSelf] = React.useState("");

  // #3 Location fields (codes/ids)
  const [country, setCountry] = React.useState<string>("");
  const [stateCode, setStateCode] = React.useState<string>("");
  const [countyCode, setCountyCode] = React.useState<string>("");
  const [cityId, setCityId] = React.useState<string>("");

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

  // ---------- helpers ----------
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
    // All calls are idempotent; safe to retry
    const init = await sb.rpc("init_user_after_signup");
    if (init.error) throw init.error;

    if (username.trim()) {
      const u = await sb.rpc("set_username", {
        p_username: username.trim().toLowerCase(),
      });
      // If change-cap error, surface but don't hard fail sign-up
      if (u.error && !`${u.error.message}`.toLowerCase().includes("limit")) {
        throw u.error;
      }
    }

    if (dob) {
      const d = await sb.rpc("profile_set_dob_checked", { p_dob: dob });
      if (d.error) throw d.error;
    }

    // Gender via RPC (falls back to direct profile update if RPC missing)
    const g = await sb.rpc("profile_set_gender", {
      p_gender: gender,
      p_gender_self: genderSelf || null,
    });
    if (g.error) {
      await sb
        .from("profiles")
        .update({
          gender,
          gender_self: gender === "self_described" ? genderSelf || null : null,
          updated_at: new Date().toISOString(),
        })
        .select("user_id")
        .single();
    }

    // Location: require at least a country for Epic A (per your design)
    const hasAny = country || stateCode || countyCode || cityId;
    if (hasAny) {
      const l = await sb.rpc("set_user_location", {
        p_country: country || null,
        p_state: stateCode || null,
        p_county: countyCode || null,
        p_city: cityId || null,
      });
      if (l.error) throw l.error;
    }
  }

  function stashForFirstLogin() {
    try {
      const payload = {
        dob: dob || null,
        username: username.trim().toLowerCase() || null,
        gender,
        gender_self: gender === "self_described" ? genderSelf || null : null,
        loc: {
          country: country || null,
          state: stateCode || null,
          county: countyCode || null,
          city: cityId || null,
        },
      };
      localStorage.setItem("postSignupProfile", JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  // ---------- submit ----------
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
    if (!country) {
      setMsg("Please select at least your country.");
      return;
    }

    try {
      setBusy(true);

      // 1) Auth sign-up
      const { error: signErr } = await sb.auth.signUp({ email, password });
      if (signErr) throw signErr;

      // 2) If session present (email confirm OFF), finalize now
      const { data: sess } = await sb.auth.getSession();
      if (sess.session) {
        await finalizeOnboarding();
        setMsg("Account created!");
        nav("/profile");
        return;
      }

      // 3) Email confirm ON: stash data and guide user
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

  // ---------- render ----------
  return (
    <div className="mx-auto max-w-md p-6 space-y-5">
      <h1 className="text-2xl font-bold">Sign up</h1>

      <form className="space-y-4" onSubmit={onSignup}>
        {/* Email */}
        <input
          type="email"
          className="w-full rounded border px-3 py-2"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        {/* Password */}
        <input
          type="password"
          className="w-full rounded border px-3 py-2"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />

        {/* Optional username with real-time availability */}
        <UsernameField value={username} onChange={setUsername} />

        {/* Explicit DOB label + your existing DobField */}
        <div>
          <label htmlFor="dob" className="block text-sm font-medium">
            Date of birth
          </label>
          {/* If your DobField renders its own input with id="dob", great.
              If not, it still sits under the visible label for clarity. */}
          <DobField value={dob} setValue={setDob} />
          <p className="mt-1 text-xs text-muted-foreground">
            You must be 13 or older. This is not shown publicly.
          </p>
        </div>

        {/* Gender (optional) */}
        <fieldset>
          <legend className="block text-sm font-medium">Gender (optional)</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
            {(
              [
                "male",
                "female",
                "nonbinary",
                "prefer_not_to_say",
                "self_described",
              ] as Gender[]
            ).map((g) => (
              <label
                key={g}
                className="inline-flex items-center gap-2 rounded-lg border p-2"
              >
                <input
                  type="radio"
                  name="gender"
                  value={g}
                  checked={gender === g}
                  onChange={() => setGender(g)}
                />
                <span className="text-sm capitalize">
                  {g.replaceAll("_", " ")}
                </span>
              </label>
            ))}
          </div>
          {gender === "self_described" && (
            <input
              type="text"
              className="mt-2 w-full rounded-lg border p-2"
              placeholder="Self-described (optional)"
              value={genderSelf}
              onChange={(e) => setGenderSelf(e.target.value)}
            />
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Used for aggregate analytics only; never shown with your identity.
          </p>
        </fieldset>

        {/* Location Picker V2 (Country → State → County → City) */}
        <LocationPickerV2
          country={country}
          setCountry={setCountry}
          stateCode={stateCode}
          setStateCode={setStateCode}
          countyCode={countyCode}
          setCountyCode={setCountyCode}
          cityId={cityId}
          setCityId={setCityId}
        />

        {/* Submit */}
        <button
          type="submit"
          className="w-full rounded bg-slate-900 py-2 text-white"
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
