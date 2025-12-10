// src/pages/Signup.tsx
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import cx from "classnames";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const sb = createClient(supabaseUrl, supabaseAnonKey);

type Precision = "city" | "county" | "state" | "country" | "none";

type LocationOption = {
  code: string;
  name: string;
};

type SignupErrors = {
  email?: string;
  password?: string;
  username?: string;
  dob?: string;
  gender?: string;
  location?: string;
};

function focusFirstError(errors: SignupErrors) {
  const order = ["email", "password", "username", "dob", "gender", "location"] as const;
  for (const key of order) {
    if (errors[key]) {
      const el = document.querySelector<HTMLElement>(`[data-error="${key}"]`);
      if (el) {
        el.focus();
      }
      break;
    }
  }
}

function LocationSelect(props: {
  country: string;
  setCountry: (v: string) => void;
  stateCode: string;
  setStateCode: (v: string) => void;
  countyCode: string;
  setCountyCode: (v: string) => void;
  cityCode: string;
  setCityCode: (v: string) => void;
  errorLocation?: string;
  errorState?: string;
  errorCounty?: string;
  errorCity?: string;
}) {
  const [countries, setCountries] = React.useState<LocationOption[]>([]);
  const [states, setStates] = React.useState<LocationOption[]>([]);
  const [counties, setCounties] = React.useState<LocationOption[]>([]);
  const [cities, setCities] = React.useState<LocationOption[]>([]);
  const [loadingStates, setLoadingStates] = React.useState(false);
  const [loadingCounties, setLoadingCounties] = React.useState(false);
  const [loadingCities, setLoadingCities] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const { data, error } = await sb
        .from("locations")
        .select("iso_code, name")
        .eq("type", "country")
        .order("name");

      if (!error && data) {
        setCountries(
          data.map((row) => ({
            code: row.iso_code,
            name: row.name,
          }))
        );
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      if (!props.country) {
        setStates([]);
        props.setStateCode("");
        setCounties([]);
        props.setCountyCode("");
        setCities([]);
        props.setCityCode("");
        return;
      }

      setLoadingStates(true);
      setStates([]);
      props.setStateCode("");
      setCounties([]);
      props.setCountyCode("");
      setCities([]);
      props.setCityCode("");

      const { data, error } = await sb
        .from("locations")
        .select("iso_code, name")
        .eq("type", "state")
        .like("iso_code", `${props.country}-%`)
        .order("name");

      setLoadingStates(false);

      if (!error && data) {
        setStates(
          data.map((row) => ({
            code: row.iso_code.split("-")[1],
            name: row.name,
          }))
        );
      }
    })();
  }, [props.country]);

  React.useEffect(() => {
    (async () => {
      if (!props.stateCode) {
        setCounties([]);
        props.setCountyCode("");
        setCities([]);
        props.setCityCode("");
        return;
      }

      setLoadingCounties(true);
      setCounties([]);
      props.setCountyCode("");
      setCities([]);
      props.setCityCode("");

      const stateIso = `${props.country}-${props.stateCode}`;

      const { data, error } = await sb
        .from("locations")
        .select("iso_code, name")
        .eq("type", "county")
        .like("iso_code", `${stateIso}-%`)
        .order("name");

      setLoadingCounties(false);

      if (!error && data) {
        setCounties(
          data.map((row) => ({
            code: row.iso_code.split("-").slice(2).join("-"),
            name: row.name,
          }))
        );
      }
    })();
  }, [props.country, props.stateCode]);

  React.useEffect(() => {
    (async () => {
      if (!props.countyCode) {
        setCities([]);
        props.setCityCode("");
        return;
      }

      setLoadingCities(true);
      setCities([]);
      props.setCityCode("");

      const stateIso = `${props.country}-${props.stateCode}`;
      const countyIso = `${stateIso}-${props.countyCode}`;

      const { data, error } = await sb
        .from("locations")
        .select("iso_code, name")
        .eq("type", "city")
        .like("iso_code", `${countyIso}-%`)
        .order("name");

      setLoadingCities(false);

      if (!error && data) {
        setCities(
          data.map((row) => ({
            code: row.iso_code.split("-").slice(3).join("-"),
            name: row.name,
          }))
        );
      }
    })();
  }, [props.country, props.stateCode, props.countyCode]);

  return (
    <div aria-live="polite">
      <label className="block text-sm font-medium">
        Location <span className="text-rose-600">*</span>
      </label>
      <p className="text-xs text-muted-foreground">
        Used to personalize regional trends. You can change this later.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Country (required) */}
        <div>
          <label htmlFor="country" className="block text-xs font-medium">
            Country <span className="text-rose-600">*</span>
          </label>
          <select
            id="country"
            className={cx(
              "mt-1 w-full rounded-lg border p-2",
              props.errorLocation && "border-rose-500"
            )}
            value={props.country}
            onChange={(e) => props.setCountry(e.target.value)}
            data-error="location"
          >
            <option value="">Select country</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {props.errorLocation && (
            <p className="mt-1 text-xs text-rose-600">{props.errorLocation}</p>
          )}
        </div>

        {/* State (optional, but encouraged where present) */}
        <div>
          <label htmlFor="state" className="block text-xs font-medium">
            State / Region (optional)
          </label>
          <select
            id="state"
            className={cx(
              "mt-1 w-full rounded-lg border p-2",
              props.errorState && "border-rose-500"
            )}
            value={props.stateCode}
            onChange={(e) => props.setStateCode(e.target.value)}
            disabled={!props.country || loadingStates}
          >
            <option value="">Select state / region</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          {loadingStates && (
            <p className="mt-1 text-xs text-slate-500">Loading states…</p>
          )}
          {!loadingStates && props.country && states.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              No states found for this country.
            </p>
          )}
          {props.errorState && (
            <p className="mt-1 text-xs text-rose-600">{props.errorState}</p>
          )}
        </div>

        {/* County (optional) */}
        <div>
          <label htmlFor="county" className="block text-xs font-medium">
            County (optional)
          </label>
          <select
            id="county"
            className={cx(
              "mt-1 w-full rounded-lg border p-2",
              props.errorCounty && "border-rose-500"
            )}
            value={props.countyCode}
            onChange={(e) => props.setCountyCode(e.target.value)}
            disabled={!props.stateCode || loadingCounties}
          >
            <option value="">Select county</option>
            {counties.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {loadingCounties && (
            <p className="mt-1 text-xs text-slate-500">Loading counties…</p>
          )}
          {!loadingCounties && props.stateCode && counties.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              No counties found for this state.
            </p>
          )}
          {props.errorCounty && (
            <p className="mt-1 text-xs text-rose-600">{props.errorCounty}</p>
          )}
        </div>

        {/* City (optional) */}
        <div>
          <label htmlFor="city" className="block text-xs font-medium">
            City (optional)
          </label>
          <select
            id="city"
            className={cx(
              "mt-1 w-full rounded-lg border p-2",
              props.errorCity && "border-rose-500"
            )}
            value={props.cityCode}
            onChange={(e) => props.setCityCode(e.target.value)}
            disabled={!props.countyCode || loadingCities}
          >
            <option value="">Select city</option>
            {cities.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {loadingCities && (
            <p className="mt-1 text-xs text-slate-500">Loading cities…</p>
          )}
          {!loadingCities && props.countyCode && cities.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              No cities found for this county.
            </p>
          )}
          {props.errorCity && (
            <p className="mt-1 text-xs text-rose-600">{props.errorCity}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-10">{children}</div>
    </main>
  );
}

export default function SignupPage() {
  const nav = useNavigate();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [dob, setDob] = React.useState("");
  const [gender, setGender] = React.useState("");
  const [genderSelf, setGenderSelf] = React.useState("");

  const [country, setCountry] = React.useState("");
  const [stateCode, setStateCode] = React.useState("");
  const [countyCode, setCountyCode] = React.useState("");
  const [cityCode, setCityCode] = React.useState("");

  const [errors, setErrors] = React.useState<SignupErrors>({});
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  function validate(): SignupErrors {
    const next: SignupErrors = {};

    if (!email.trim()) {
      next.email = "Email is required.";
    } else if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      next.email = "Enter a valid email address.";
    }

    if (!password) {
      next.password = "Password is required.";
    } else if (password.length < 8) {
      next.password = "Password must be at least 8 characters.";
    }

    if (!username.trim()) {
      next.username = "Username is required.";
    } else if (!/^[a-zA-Z0-9_.]+$/.test(username)) {
      next.username = "Only letters, numbers, underscore and dot allowed.";
    } else if (username.length < 3 || username.length > 20) {
      next.username = "Username must be 3–20 characters.";
    }

    if (dob) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        next.dob = "Use format YYYY-MM-DD.";
      }
    }

    if (!gender) {
      next.gender = "Please select a gender option.";
    } else if (
      gender === "self_described" &&
      (!genderSelf || !genderSelf.trim())
    ) {
      next.gender = "Please describe your gender.";
    }

    if (!country) {
      next.location = "Please select your country.";
    }

    return next;
  }

  async function resolveLocation(): Promise<
    | {
        locationId: string;
        precision: Precision;
      }
    | null
  > {
    if (cityCode) {
      const guesses = [
        `${country}-${stateCode}-${countyCode}-${cityCode}`,
        `${country}-${stateCode}-${cityCode}`,
      ];
      const r = await sb
        .from("locations")
        .select("id, iso_code")
        .eq("type", "city")
        .in("iso_code", guesses);
      const row = r.data?.[0];
      if (!r.error && row?.id) return { locationId: row.id, precision: "city" };
    }

    if (countyCode) {
      const guesses = [
        `${country}-${stateCode}-${countyCode}`,
        `${country}-${countyCode}`,
      ];
      const r = await sb
        .from("locations")
        .select("id, iso_code")
        .eq("type", "county")
        .in("iso_code", guesses);
      const row = r.data?.[0];
      if (!r.error && row?.id)
        return { locationId: row.id, precision: "county" };
    }

    if (stateCode) {
      const guesses = country
        ? [stateCode, `${country}-${stateCode}`]
        : [stateCode];
      const r = await sb
        .from("locations")
        .select("id, iso_code")
        .eq("type", "state")
        .in("iso_code", guesses);
      const row = r.data?.[0];
      if (!r.error && row?.id) return { locationId: row.id, precision: "state" };
    }

    if (country) {
      const r = await sb
        .from("locations")
        .select("id")
        .eq("type", "country")
        .eq("iso_code", country)
        .limit(1)
        .single();
      if (!r.error && r.data?.id)
        return { locationId: r.data.id, precision: "country" };
    }

    return null;
  }

  async function finalizeOnboarding() {
    // Let server-side helpers (set_username, profile_set_dob_checked, etc.)
    // create the profile row if needed. No direct init_user_after_signup call here.
    if (username.trim()) {
      const u = await sb.rpc("set_username", {
        p_username: username.trim().toLowerCase(),
      });
      if (u.error && !`${u.error.message}`.toLowerCase().includes("limit")) {
        throw u.error;
      }
    }

    if (dob) {
      const d = await sb.rpc("profile_set_dob_checked", { p_dob_text: dob });
      if (d.error) throw d.error;
    }

    const g = await sb.rpc("profile_set_gender", {
      p_gender: gender,
      p_gender_self: gender === "self_described" ? genderSelf || null : null,
    });
    if (g.error) {
      await sb
        .from("profiles")
        .update({
          gender,
          gender_self: gender === "self_described" ? genderSelf || null : null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", (await sb.auth.getUser()).data.user?.id ?? "")
        .limit(1);
    }

    const resolved = await resolveLocation();
    if (resolved) {
      const who = await sb.rpc("whoami");
      if (!who.error && who.data) {
        const l = await sb.rpc("set_user_location", {
          p_user_id: String(who.data),
          p_location_id: resolved.locationId,
          p_precision: resolved.precision,
          p_override: false,
          p_source: "signup",
        });
        if (l.error) throw l.error;
      }
    }
  }

  function stashForFirstLogin() {
    try {
      const payload = {
        username: username.trim(),
        dob,
        gender,
        genderSelf,
        country,
        stateCode,
        countyCode,
        cityCode,
      };
      window.localStorage.setItem(
        "signup_stash_v1",
        JSON.stringify(payload)
      );
    } catch {
      // ignore
    }
  }

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) {
      focusFirstError(next);
      return;
    }

    try {
      setBusy(true);

      const { error: signErr } = await sb.auth.signUp({ email, password });
      if (signErr) throw signErr;

      const { data: sess } = await sb.auth.getSession();
      if (sess.session) {
        await finalizeOnboarding();
        setMsg("Account created!");
        nav("/profile");
        return;
      }

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

  return (
    <PageLayout>
      <div className="mx-auto max-w-md p-6 space-y-5">
        <h1 className="text-2xl font-bold">Sign up</h1>

        <form className="space-y-4" onSubmit={onSignup} noValidate>
          {/* Email */}
          <div>
            <label className="block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              data-error="email"
              className={cx(
                "mt-1 w-full rounded-lg border p-2",
                errors.email && "border-rose-500"
              )}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-rose-600">{errors.email}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              data-error="password"
              className={cx(
                "mt-1 w-full rounded-lg border p-2",
                errors.password && "border-rose-500"
              )}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-rose-600">{errors.password}</p>
            )}
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              data-error="username"
              className={cx(
                "mt-1 w-full rounded-lg border p-2",
                errors.username && "border-rose-500"
              )}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            {errors.username && (
              <p className="mt-1 text-xs text-rose-600">{errors.username}</p>
            )}
          </div>

          {/* DOB */}
          <div>
            <label className="block text-sm font-medium" htmlFor="dob">
              Date of birth (optional)
            </label>
            <input
              id="dob"
              data-error="dob"
              className={cx(
                "mt-1 w-full rounded-lg border p-2",
                errors.dob && "border-rose-500"
              )}
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
            {errors.dob && (
              <p className="mt-1 text-xs text-rose-600">{errors.dob}</p>
            )}
          </div>

          {/* Gender */}
          <div>
            <label className="block text-sm font-medium" htmlFor="gender">
              Gender
            </label>
            <select
              id="gender"
              data-error="gender"
              className={cx(
                "mt-1 w-full rounded-lg border p-2",
                errors.gender && "border-rose-500"
              )}
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="">Select an option</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="nonbinary">Non-binary</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
              <option value="self_described">Self-described</option>
            </select>
            {gender === "self_described" && (
              <input
                className="mt-2 w-full rounded-lg border p-2"
                type="text"
                placeholder="Describe your gender"
                value={genderSelf}
                onChange={(e) => setGenderSelf(e.target.value)}
              />
            )}
            {errors.gender && (
              <p className="mt-1 text-xs text-rose-600">{errors.gender}</p>
            )}
          </div>

          {/* Location */}
          <LocationSelect
            country={country}
            setCountry={setCountry}
            stateCode={stateCode}
            setStateCode={setStateCode}
            countyCode={countyCode}
            setCountyCode={setCountyCode}
            cityCode={cityCode}
            setCityCode={setCityCode}
            errorLocation={errors.location}
          />

          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Creating account…" : "Sign up"}
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
    </PageLayout>
  );
}
