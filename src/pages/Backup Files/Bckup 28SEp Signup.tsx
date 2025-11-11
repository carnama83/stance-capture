// src/pages/Signup.tsx
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import UsernameField from "../components/UsernameField";
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

// Small helper
const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

// ---------- Geo data loader (uses geo_*_v views) ----------
function useGeoData() {
  const sb = React.useMemo(getSupabase, []);
  const [ready, setReady] = React.useState(false);

  const [countries, setCountries] = React.useState<Country[]>([]);
  const [states, setStates] = React.useState<StateRow[]>([]);
  const [counties, setCounties] = React.useState<CountyRow[]>([]);
  const [cities, setCities] = React.useState<CityRow[]>([]);

  const [loadingStates, setLoadingStates] = React.useState(false);
  const [loadingCounties, setLoadingCounties] = React.useState(false);
  const [loadingCities, setLoadingCities] = React.useState(false);

  // Countries
  React.useEffect(() => {
    (async () => {
      try {
        if (!sb) return;
        const r = await sb
          .from("geo_countries_v")
          .select("code,name")
          .order("name");
        if (r.error) {
          console.warn("[countries] error:", r.error.message);
        } else {
          console.info(`[countries] loaded ${r.data?.length ?? 0} row(s)`);
        }
        setCountries(r.data ?? []);
      } catch (e) {
        console.warn("[countries] exception:", e);
      } finally {
        setReady(true);
      }
    })();
  }, [sb]);

  const loadStates = React.useCallback(
    async (country_code: string) => {
      setLoadingStates(true);
      try {
        if (!sb) return;
        const r = await sb
          .from("geo_states_v")
          .select("code,name,country_code")
          .eq("country_code", country_code)
          .order("name");
        if (r.error) {
          console.warn("[states] error:", r.error.message);
          setStates([]);
        } else {
          console.info(
            `[states] ${country_code} -> ${(r.data ?? []).length} row(s)`
          );
          setStates(r.data ?? []);
        }
      } catch (e) {
        console.warn("[states] exception:", e);
        setStates([]);
      } finally {
        setLoadingStates(false);
      }
    },
    [sb]
  );

  const loadCounties = React.useCallback(
    async (state_code: string) => {
      setLoadingCounties(true);
      try {
        if (!sb) return;
        const r = await sb
          .from("geo_counties_v")
          .select("code,name,state_code")
          .eq("state_code", state_code)
          .order("name");
        if (r.error) {
          console.warn("[counties] error:", r.error.message);
          setCounties([]);
        } else {
          console.info(
            `[counties] ${state_code} -> ${(r.data ?? []).length} row(s)`
          );
          setCounties(r.data ?? []);
        }
      } catch (e) {
        console.warn("[counties] exception:", e);
        setCounties([]);
      } finally {
        setLoadingCounties(false);
      }
    },
    [sb]
  );

  const loadCities = React.useCallback(
    async (state_code: string, county_code?: string) => {
      setLoadingCities(true);
      try {
        if (!sb) return;
        let q = sb
          .from("geo_cities_v")
          .select("id,name,state_code,county_code")
          .eq("state_code", state_code);
        if (county_code) q = q.eq("county_code", county_code);
        const r = await q.order("name");
        if (r.error) {
          console.warn("[cities] error:", r.error.message);
          setCities([]);
        } else {
          console.info(
            `[cities] ${state_code}${county_code ? " / " + county_code : ""} -> ${
              (r.data ?? []).length
            } row(s)`
          );
          setCities(r.data ?? []);
        }
      } catch (e) {
        console.warn("[cities] exception:", e);
        setCities([]);
      } finally {
        setLoadingCities(false);
      }
    },
    [sb]
  );

  return {
    ready,
    countries,
    states,
    counties,
    cities,
    loadingStates,
    loadingCounties,
    loadingCities,
    loadStates,
    loadCounties,
    loadCities,
  };
}

// ---------- Location Picker V2 (with loading/disabled UI) ----------
function LocationPickerV2(props: {
  country: string;
  setCountry: (v: string) => void;
  stateCode: string;
  setStateCode: (v: string) => void;
  countyCode: string;
  setCountyCode: (v: string) => void;
  cityId: string;
  setCityId: (v: string) => void;
  errorCountry?: string;
  errorState?: string;
  errorCounty?: string;
  errorCity?: string;
}) {
  const {
    ready,
    countries,
    states,
    counties,
    cities,
    loadingStates,
    loadingCounties,
    loadingCities,
    loadStates,
    loadCounties,
    loadCities,
  } = useGeoData();

  // Show city NAME in the input, keep ID under the hood
  const [cityText, setCityText] = React.useState("");

  React.useEffect(() => {
    if (!props.cityId) {
      setCityText("");
      return;
    }
    const selected = cities.find((c) => String(c.id) === String(props.cityId));
    if (selected) setCityText(selected.name);
  }, [props.cityId, cities]);

  // Parent→child resets
  React.useEffect(() => {
    if (props.country) loadStates(props.country);
    props.setStateCode("");
    props.setCountyCode("");
    props.setCityId("");
    setCityText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.country]);

  React.useEffect(() => {
    if (props.stateCode) {
      loadCounties(props.stateCode);
      loadCities(props.stateCode);
    }
    props.setCountyCode("");
    props.setCityId("");
    setCityText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.stateCode]);

  React.useEffect(() => {
    if (props.stateCode && props.countyCode) {
      loadCities(props.stateCode, props.countyCode);
    }
    props.setCityId("");
    setCityText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.countyCode]);

  return (
    <div className="space-y-2" aria-live="polite">
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
              props.errorCountry && "border-rose-500"
            )}
            value={props.country}
            onChange={(e) => props.setCountry(e.target.value)}
            disabled={!ready}
            aria-busy={!ready}
            aria-invalid={!!props.errorCountry}
          >
            {!ready && <option value="">Loading countries…</option>}
            {ready && <option value="">Select country</option>}
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
          {props.errorCountry && (
            <p className="mt-1 text-xs text-rose-600">{props.errorCountry}</p>
          )}
        </div>

        {/* State / Region */}
        <div>
          <label htmlFor="state" className="block text-xs font-medium">
            State / Region
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
            aria-busy={loadingStates}
            aria-invalid={!!props.errorState}
          >
            {!props.country && <option value="">Select country first</option>}
            {props.country && loadingStates && (
              <option value="">Loading states…</option>
            )}
            {props.country && !loadingStates && <option value="">Select state</option>}
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
          {/* Gentle hint if DB has no states for the selected country */}
          {props.country && !loadingStates && states.length === 0 && (
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
            aria-busy={loadingCounties}
            aria-invalid={!!props.errorCounty}
          >
            {!props.stateCode && <option value="">Select state first</option>}
            {props.stateCode && loadingCounties && (
              <option value="">Loading counties…</option>
            )}
            {props.stateCode && !loadingCounties && <option value="">(None)</option>}
            {counties.map((k) => (
              <option key={k.code} value={k.code}>
                {k.name}
              </option>
            ))}
          </select>
          {props.errorCounty && (
            <p className="mt-1 text-xs text-rose-600">{props.errorCounty}</p>
          )}
        </div>

        {/* City (optional, searchable by name; stores ID) */}
        <div>
          <label htmlFor="city" className="block text-xs font-medium">
            City (optional)
          </label>
          <input
            id="city"
            list="city-options"
            className={cx(
              "mt-1 w-full rounded-lg border p-2",
              props.errorCity && "border-rose-500"
            )}
            placeholder={
              !props.stateCode
                ? "Select state first"
                : loadingCities
                ? "Loading cities…"
                : "Type to search…"
            }
            value={cityText}
            onChange={(e) => {
              const val = e.target.value;
              setCityText(val);
              // resolve typed name -> ID (UUID) if it matches
              const match = cities.find(
                (c) => c.name.toLowerCase() === val.toLowerCase()
              );
              props.setCityId(match ? String(match.id) : "");
            }}
            onBlur={() => {
              const match = cities.find(
                (c) => c.name.toLowerCase() === cityText.toLowerCase()
              );
              if (!match) {
                props.setCityId("");
                setCityText("");
              }
            }}
            disabled={!props.stateCode || loadingCities}
            aria-busy={loadingCities}
            aria-invalid={!!props.errorCity}
          />
          <datalist id="city-options">
            {cities.map((ct) => (
              <option key={ct.id} value={ct.name} />
            ))}
          </datalist>
          {props.errorCity && (
            <p className="mt-1 text-xs text-rose-600">{props.errorCity}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Page ----------
export default function Signup() {
  const sb = React.useMemo(getSupabase, []);
  const nav = useNavigate();

  // refs for autofocus/scroll-to-first-error
  const refEmail = React.useRef<HTMLInputElement>(null);
  const refPassword = React.useRef<HTMLInputElement>(null);
  const refDobContainer = React.useRef<HTMLDivElement>(null);
  const refCountry = React.useRef<HTMLSelectElement>(null);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [dob, setDob] = React.useState(""); // "YYYY-MM-DD"

  // Gender
  const [gender, setGender] = React.useState<Gender>("prefer_not_to_say");
  const [genderSelf, setGenderSelf] = React.useState("");

  // Location (codes/ids)
  const [country, setCountry] = React.useState<string>("");
  const [stateCode, setStateCode] = React.useState<string>("");
  const [countyCode, setCountyCode] = React.useState<string>("");
  const [cityId, setCityId] = React.useState<string>("");

  // Validation/errors
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  // Username availability (helper hint)
  type UStatus = "idle" | "invalid" | "checking" | "available" | "taken";
  const [uStatus, setUStatus] = React.useState<UStatus>("idle");
  const [uMessage, setUMessage] = React.useState<string>("");

  const usernameRegex = /^[a-z0-9_]{3,20}$/;

  // Live availability check (debounced)
  React.useEffect(() => {
    const u = username.trim().toLowerCase();
    if (!u) {
      setUStatus("idle");
      setUMessage("Optional. Use 3–20 chars: a–z, 0–9, _");
      return;
    }
    if (!usernameRegex.test(u)) {
      setUStatus("invalid");
      setUMessage("Use 3–20 chars: a–z, 0–9, _");
      return;
    }
    setUStatus("checking");
    setUMessage("Checking availability…");

    const handle = setTimeout(async () => {
      try {
        // Try RPC if you created one
        //const rpc = await sb?.rpc("check_username_available", { p_username: u });
        const rpc = await sb?.rpc("username_available", { p_username: u });
        if (rpc && !rpc.error && typeof rpc.data === "boolean") {
          setUStatus(rpc.data ? "available" : "taken");
          setUMessage(rpc.data ? "Available ✓" : "Taken ✗");
          return;
        }
      } catch {
        /* fall through */
      }
      // Fallback: direct equality
      try {
        const q = await sb
          ?.from("profiles")
          .select("username", { count: "exact", head: true })
          .eq("username", u);
        const taken = (q?.count ?? 0) > 0;
        setUStatus(taken ? "taken" : "available");
        setUMessage(taken ? "Taken ✗" : "Available ✓");
      } catch {
        setUStatus("idle");
        setUMessage("Optional. Use 3–20 chars: a–z, 0–9, _");
      }
    }, 500);

    return () => clearTimeout(handle);
  }, [username, sb]);

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

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!email) next.email = "Email is required.";
    if (!password) next.password = "Password is required.";
    if (!dob) next.dob = "Date of birth is required.";
    const age = calcAge(dob);
    if (dob && age !== null && age < 13) next.dob = "You must be at least 13 years old.";
    if (!country) next.country = "Please select your country.";
    if (username && !usernameRegex.test(username.trim().toLowerCase())) {
      next.username = "Use 3–20 chars: a–z, 0–9, _";
    }
    return next;
  }

  function focusFirstError(errs: Record<string, string>) {
    const order = ["email", "password", "dob", "country", "state", "county", "city", "username"];
    for (const key of order) {
      if (!errs[key]) continue;
      let el: HTMLElement | null = null;
      if (key === "email") el = refEmail.current;
      else if (key === "password") el = refPassword.current;
      else if (key === "dob")
        el = refDobContainer.current?.querySelector("input,select,textarea") as
          | HTMLElement
          | null;
      else if (key === "country") el = refCountry.current;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        (el as any).focus?.();
        break;
      }
    }
  }

  async function finalizeOnboarding() {
    const init = await sb.rpc("init_user_after_signup");
    if (init.error) throw init.error;

    if (username.trim()) {
      const u = await sb.rpc("set_username", {
        p_username: username.trim().toLowerCase(),
      });
      if (u.error && !`${u.error.message}`.toLowerCase().includes("limit")) {
        throw u.error;
      }
    }

    if (dob) {
      //const d = await sb.rpc("profile_set_dob_checked", { p_dob: dob });
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
        .select("user_id")
        .single();
    }

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

    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) {
      focusFirstError(next);
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

      // 3) Email confirm ON path
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
    <div className="mx-auto max-w-md p-6 space-y-5">
      <h1 className="text-2xl font-bold">Sign up</h1>

      <form className="space-y-4" onSubmit={onSignup} noValidate>
        {/* Email (required) */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email <span className="text-rose-600">*</span>
          </label>
          <input
            id="email"
            ref={refEmail}
            type="email"
            className={cx(
              "mt-1 w-full rounded border px-3 py-2",
              errors.email && "border-rose-500"
            )}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            required
          />
          {errors.email && (
            <p id="email-error" className="mt-1 text-xs text-rose-600">
              {errors.email}
            </p>
          )}
        </div>

        {/* Password (required) */}
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password <span className="text-rose-600">*</span>
          </label>
          <input
            id="password"
            ref={refPassword}
            type="password"
            className={cx(
              "mt-1 w-full rounded border px-3 py-2",
              errors.password && "border-rose-500"
            )}
            placeholder="Minimum 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            required
          />
          {errors.password && (
            <p id="password-error" className="mt-1 text-xs text-rose-600">
              {errors.password}
            </p>
          )}
        </div>

        {/* Optional username + rules + live availability */}
        <div>
          <div className="flex items-baseline justify-between">
            <label className="block text-sm font-medium">
              Username (optional)
            </label>
            <span
              className={cx(
                "text-xs",
                uStatus === "available" && "text-emerald-600",
                uStatus === "taken" && "text-rose-600",
                uStatus === "checking" && "text-slate-500",
                uStatus === "invalid" && "text-rose-600"
              )}
            >
              {uMessage || "Optional. Use 3–20 chars: a–z, 0–9, _"}
            </span>
          </div>
          <UsernameField value={username} onChange={setUsername} />
          {errors.username && (
            <p className="mt-1 text-xs text-rose-600">{errors.username}</p>
          )}
        </div>

        {/* Date of birth (required) */}
        <div ref={refDobContainer}>
          <label htmlFor="dob" className="block text-sm font-medium">
            Date of birth <span className="text-rose-600">*</span>
          </label>
          <DobField value={dob} setValue={setDob} />
          <p className="mt-1 text-xs text-muted-foreground">
            You must be 13 or older. This is not shown publicly.
          </p>
          {errors.dob && (
            <p className="mt-1 text-xs text-rose-600">{errors.dob}</p>
          )}
        </div>

        {/* Gender (optional) */}
        <fieldset>
          <legend className="block text-sm font-medium">
            Gender (optional)
          </legend>
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

        {/* Location Picker V2 (with errors + loading states) */}
        <div>
          <LocationPickerV2
            country={country}
            setCountry={(v) => {
              setCountry(v);
              setErrors((prev) => ({ ...prev, country: "" }));
            }}
            stateCode={stateCode}
            setStateCode={setStateCode}
            countyCode={countyCode}
            setCountyCode={setCountyCode}
            cityId={cityId}
            setCityId={setCityId}
            errorCountry={errors.country}
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="w-full rounded bg-slate-900 py-2 text-white disabled:opacity-60"
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
