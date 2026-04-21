// src/pages/Signup.tsx
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import UsernameField from "../components/UsernameField";
import { DobField } from "../components/DobField";
import PageLayout from "../components/PageLayout";
import SocialAuthButtons from "../auth/SocialAuthButtons";

// ---------- Types ----------
type Gender =
  | "male"
  | "female"
  | "nonbinary"
  | "prefer_not_to_say"
  | "self_described";

type GenderState = {
  value: Gender | "";
  selfDescribe: string;
};

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

type Precision = "city" | "county" | "state" | "country" | "none";

// Small helper
const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

// ---------- Debug helpers ----------
type DebugEntry = {
  ts: string;
  ms: number;
  step: string;
  data?: any;
};

function safeErr(e: any) {
  if (!e) return e;
  const out: any = { message: e.message ?? String(e) };
  if (e.status) out.status = e.status;
  if (e.code) out.code = e.code;
  if (e.details) out.details = e.details;
  if (e.hint) out.hint = e.hint;
  return out;
}

function maskEmail(v: string) {
  const s = (v || "").trim();
  const at = s.indexOf("@");
  if (at <= 1) return s ? "***" : "";
  return `${s.slice(0, 1)}***${s.slice(at - 1)}`;
}

function getDebugFlag(): boolean {
  try {
    // Normal router: /signup?debug=1
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("debug") === "1") return true;

    // HashRouter: #/signup?debug=1
    const h = window.location.hash || "";
    const qIndex = h.indexOf("?");
    if (qIndex >= 0) {
      const hp = new URLSearchParams(h.slice(qIndex + 1));
      if (hp.get("debug") === "1") return true;
    }

    return window.localStorage.getItem("auth_debug") === "1";
  } catch {
    return false;
  }
}

// ---------- M-A01: IP geo-detection ----------------------------------------
// Uses ipapi.co/json (free, no key, ~150ms). Returns the detected ISO country
// code so Signup can pre-populate the country select and show a suggestion banner.
interface IpGeo {
  countryCode: string | null;  // ISO 3166-1 alpha-2, e.g. "US"
  countryName: string | null;
  loading: boolean;
  error: boolean;
}

function useIpGeoDetection(): IpGeo {
  const [state, setState] = React.useState<IpGeo>({
    countryCode: null,
    countryName: null,
    loading: true,
    error: false,
  });

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000); // 4 s timeout

    (async () => {
      try {
        const res = await fetch("https://ipapi.co/json/", {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`ipapi ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const code = typeof json.country_code === "string" && json.country_code.length === 2
          ? json.country_code.toUpperCase()
          : null;
        setState({
          countryCode: code,
          countryName: json.country_name ?? null,
          loading: false,
          error: !code,
        });
      } catch {
        if (!cancelled) setState(s => ({ ...s, loading: false, error: true }));
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, []);

  return state;
}

// ---------- M-A01: Geo suggestion banner -----------------------------------

interface GeoSuggestionBannerProps {
  countryName: string;
  onAccept: () => void;
  onDismiss: () => void;
}

function GeoSuggestionBanner({ countryName, onAccept, onDismiss }: GeoSuggestionBannerProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
      <span className="text-sky-700 flex-1">
        📍 We detected your location as <span className="font-semibold">{countryName}</span>. Use this?
      </span>
      <button
        type="button"
        className="rounded border border-sky-300 bg-white px-2 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100"
        onClick={onAccept}
      >
        Yes, use this
      </button>
      <button
        type="button"
        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        onClick={onDismiss}
      >
        Enter manually
      </button>
    </div>
  );
}

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
            `[states] ${country_code} -> ${r.data?.length ?? 0} row(s)`
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
            `[counties] ${state_code} -> ${r.data?.length ?? 0} row(s)`
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

        // Primary attempt: if a county is selected, try county-specific cities first
        if (county_code) {
          const rCounty = await sb
            .from("geo_cities_v")
            .select("id,name,state_code,county_code")
            .eq("state_code", state_code)
            .eq("county_code", county_code)
            .order("name");

          if (rCounty.error) {
            console.warn("[cities] (county) error:", rCounty.error.message);
          } else if ((rCounty.data ?? []).length > 0) {
            console.info(
              `[cities] ${state_code} / ${county_code} -> ${
                rCounty.data?.length ?? 0
              } row(s)`
            );
            setCities(rCounty.data ?? []);
            return;
          }
          // Fallback below: no county-specific cities; fall through to state-level query
        }

        // Fallback / general case: load all cities for the state
        const rState = await sb
          .from("geo_cities_v")
          .select("id,name,state_code,county_code")
          .eq("state_code", state_code)
          .order("name");

        if (rState.error) {
          console.warn("[cities] (state) error:", rState.error.message);
          setCities([]);
        } else {
          console.info(
            `[cities] ${state_code}${
              county_code ? " (fallback state-only)" : ""
            } -> ${rState.data?.length ?? 0} row(s)`
          );
          setCities(rState.data ?? []);
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

// ---------- Location selection UI ----------
function LocationSelect(props: {
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
  /** M-A01: ISO code detected from IP — used to show "(auto-detected)" hint */
  detectedCountryCode?: string | null;
  /** M-A01: Called when user picks a different country than the detected one */
  onGeoOverride?: () => void;
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

  const [cityText, setCityText] = React.useState("");

  React.useEffect(() => {
    if (!props.cityId) {
      setCityText("");
      return;
    }
    const selected = cities.find((c) => String(c.id) === String(props.cityId));
    if (selected) setCityText(selected.name);
  }, [props.cityId, cities]);

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
      // will try county-specific, then fallback to state if none
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
            onChange={(e) => {
              props.setCountry(e.target.value);
              // M-A01: flag as override if user picks a different country than detected
              if (
                props.detectedCountryCode &&
                e.target.value &&
                e.target.value !== props.detectedCountryCode
              ) {
                props.onGeoOverride?.();
              }
            }}
            disabled={!ready}
            aria-busy={!ready}
            aria-invalid={!!props.errorCountry}
          >
            {!ready && <option value="">Loading countries…</option>}
            {ready && <option value="">Select country</option>}
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
                {props.detectedCountryCode === c.code ? " · auto-detected" : ""}
              </option>
            ))}
          </select>
          {/* M-A01: subtle hint when auto-detected country is currently selected */}
          {props.detectedCountryCode &&
            props.country === props.detectedCountryCode && (
              <p className="mt-1 text-xs text-sky-600">📍 Pre-filled from your IP address</p>
          )}
          {props.errorCountry && (
            <p className="mt-1 text-xs text-rose-600">{props.errorCountry}</p>
          )}
        </div>

        {/* State (optional) */}
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
            aria-busy={loadingStates}
            aria-invalid={!!props.errorState}
          >
            {!props.country && <option value="">Select country first</option>}
            {props.country && loadingStates && (
              <option value="">Loading states…</option>
            )}
            {props.country && !loadingStates && (
              <option value="">Select state</option>
            )}
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
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
            {props.stateCode && !loadingCounties && (
              <option value="">(None)</option>
            )}
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

        {/* City (optional; real select) */}
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
            value={props.cityId}
            onChange={(e) => props.setCityId(e.target.value)}
            disabled={!props.stateCode || loadingCities}
            aria-busy={loadingCities}
            aria-invalid={!!props.errorCity}
          >
            <option value="">
              {!props.stateCode
                ? "Select state first"
                : loadingCities
                ? "Loading cities…"
                : cities.length === 0
                ? "(No cities available)"
                : "Select city"}
            </option>
            {cities.map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.name}
              </option>
            ))}
          </select>
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

  // ---- Debug mode: supports HashRouter (#/signup?debug=1) ----
  const debugEnabled = React.useMemo(() => getDebugFlag(), []);
  const debugStartRef = React.useRef<number>(performance.now());
  const [debugLogs, setDebugLogs] = React.useState<DebugEntry[]>([]);

  const addLog = React.useCallback(
    (step: string, data?: any) => {
      if (!debugEnabled) return;
      const now = performance.now();
      const entry: DebugEntry = {
        ts: new Date().toISOString(),
        ms: Math.round(now - debugStartRef.current),
        step,
        data,
      };
      setDebugLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
      console.info(`[signup][${entry.ms}ms] ${step}`, data ?? "");
    },
    [debugEnabled]
  );

  React.useEffect(() => {
    if (!sb || !debugEnabled) return;
    addLog("auth.subscribe.start");
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      addLog("auth.state", {
        event,
        hasSession: !!session,
        userId: session?.user?.id ?? null,
        email: session?.user?.email ? maskEmail(session.user.email) : null,
      });
    });
    return () => {
      data.subscription.unsubscribe();
      addLog("auth.subscribe.stop");
    };
  }, [sb, debugEnabled, addLog]);

  async function copyDebug() {
    const payload = JSON.stringify(debugLogs, null, 2);
    await navigator.clipboard.writeText(payload);
    addLog("debug.copy.ok", { bytes: payload.length });
  }

  // refs for autofocus/scroll-to-first-error
  const refEmail = React.useRef<HTMLInputElement>(null);
  const refPassword = React.useRef<HTMLInputElement>(null);
  const refDobContainer = React.useRef<HTMLDivElement>(null);
  const refCountry = React.useRef<HTMLSelectElement>(null);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [username, setUsername] = React.useState("");

  const [dob, setDob] = React.useState<string>("");
  const [gender, setGender] = React.useState<GenderState>({
    value: "",
    selfDescribe: "",
  });

  // Location (codes/ids)
  const [country, setCountry] = React.useState<string>("");
  const [stateCode, setStateCode] = React.useState<string>("");
  const [countyCode, setCountyCode] = React.useState<string>("");
  const [cityId, setCityId] = React.useState<string>("");

  // M-A01: IP geo-detection
  const ipGeo = useIpGeoDetection();
  // "pending" = banner not yet acted on; "accepted" = user accepted; "dismissed" / "overridden" = user declined
  const [geoState, setGeoState] = React.useState<"pending" | "accepted" | "dismissed" | "overridden">("pending");
  // Track whether the final submitted location was an override of the detected one
  const [geoOverride, setGeoOverride] = React.useState(false);

  // Once IP detection resolves successfully and country is still empty, pre-populate

const geoData = useGeoData(); // hoist out of LocationSelect


React.useEffect(() => {
  if (ipGeo.loading || ipGeo.error || !ipGeo.countryCode) return;
  if (!geoData.ready) return; // ← WAIT for countries to load
  if (country) return;
  if (geoState !== "pending") return;
  setCountry(ipGeo.countryCode);
}, [ipGeo.loading, ipGeo.error, ipGeo.countryCode, geoData.ready]);
  // Validation/errors
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  // Username availability
  type UStatus = "idle" | "invalid" | "checking" | "available" | "taken";
  const [uStatus, setUStatus] = React.useState<UStatus>("idle");

  if (!sb) {
    return (
      <PageLayout>
        <div className="mx-auto max-w-md p-6 space-y-4">
          <h1 className="text-2xl font-bold">Sign up</h1>
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-rose-700">
            Supabase is OFF (check env).
          </div>
        </div>
      </PageLayout>
    );
  }

  // ---------- helpers ----------
  function calcAge(d: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return null;
    const [_, y, mm, dd] = m;
    const birth = new Date(Number(y), Number(mm) - 1, Number(dd));
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const hadBirthdayThisYear =
      today.getMonth() > birth.getMonth() ||
      (today.getMonth() === birth.getMonth() &&
        today.getDate() >= birth.getDate());
    if (!hadBirthdayThisYear) age -= 1;
    return age;
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};

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

    // DOB required
    if (!dob || !dob.trim()) {
      next.dob = "Date of birth is required.";
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      next.dob = "Use format YYYY-MM-DD.";
    } else {
      const age = calcAge(dob);
      if (age != null && age < 13) {
        next.dob = "You must be at least 13 to use this app.";
      }
    }

    if (!gender.value) {
      next.gender = "Please select a gender option.";
    } else if (
      gender.value === "self_described" &&
      !gender.selfDescribe.trim()
    ) {
      next.gender = "Please describe your gender.";
    }

    if (!country) {
      next.country = "Please select your country.";
    }

    return next;
  }

  // Scroll/focus first error
  React.useEffect(() => {
    const keys = Object.keys(errors);
    if (keys.length === 0) return;
    const first = keys[0];
    switch (first) {
      case "email":
        refEmail.current?.focus();
        break;
      case "password":
        refPassword.current?.focus();
        break;
      case "dob":
        refDobContainer.current?.scrollIntoView({ behavior: "smooth" });
        break;
      case "country":
        refCountry.current?.focus();
        break;
    }
  }, [errors]);

  async function resolveLocationForSelection(): Promise<
    { locationId: string; precision: Precision } | null
  > {
    if (cityId) return { locationId: cityId, precision: "city" };

    if (countyCode) {
      const r = await sb
        .from("locations")
        .select("id")
        .eq("type", "county")
        .eq("iso_code", countyCode)
        .limit(1)
        .single();
      if (!r.error && r.data?.id)
        return { locationId: r.data.id, precision: "county" };
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
      if (!r.error && row?.id)
        return { locationId: row.id, precision: "state" };
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

  // local helper used only here
  function getDeviceFingerprint(): string {
    const key = "device_fingerprint_v1";
    const existing = window.localStorage.getItem(key);
    if (existing && existing.length >= 16) return existing;

    const fp =
      globalThis.crypto?.randomUUID?.() ??
      `fp_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    window.localStorage.setItem(key, fp);
    return fp;
  }

  async function finalizeOnboarding() {
    addLog("onboarding.start");

    // 1) username via RPC
    if (username.trim()) {
      addLog("onboarding.set_username.start", { username: username.trim() });
      const u = await sb.rpc("set_username", {
        p_username: username.trim().toLowerCase(),
      });
      if (u.error && !`${u.error.message}`.toLowerCase().includes("limit")) {
        addLog("onboarding.set_username.error", safeErr(u.error));
        throw u.error;
      }
      addLog("onboarding.set_username.ok");
    }

    // 2) DOB REQUIRED via helper (always call)
    if (!dob || !dob.trim()) {
      addLog("onboarding.dob.missing");
      throw new Error("Date of birth is required.");
    }
    addLog("onboarding.set_dob.start", { dob });
    const d = await sb.rpc("profile_set_dob_checked", { p_dob_text: dob });
    if (d.error) {
      addLog("onboarding.set_dob.error", safeErr(d.error));
      throw d.error;
    }
    addLog("onboarding.set_dob.ok");

    // 3) Gender via helper, with fallback to direct update
    addLog("onboarding.set_gender.start", {
      gender: gender.value,
      hasSelf: gender.value === "self_described" ? !!gender.selfDescribe : false,
    });
    const g = await sb.rpc("profile_set_gender", {
      p_gender: gender.value || null,
      p_gender_self:
        gender.value === "self_described"
          ? gender.selfDescribe || null
          : null,
    });
    if (g.error) {
      addLog("onboarding.set_gender.rpc_error", safeErr(g.error));
      const current = await sb.auth.getUser();
      const uid = current.data.user?.id;
      if (uid) {
        addLog("onboarding.set_gender.fallback_update.start", { uid });
        await sb
          .from("profiles")
          .update({
            gender: gender.value || null,
            gender_self:
              gender.value === "self_described"
                ? gender.selfDescribe || null
                : null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", uid)
          .limit(1);
        addLog("onboarding.set_gender.fallback_update.ok");
      }
    } else {
      addLog("onboarding.set_gender.ok");
    }

    // 4) Location via set_user_location
    addLog("onboarding.location.resolve.start", {
      country,
      stateCode,
      countyCode,
      cityId,
    });
    const resolved = await resolveLocationForSelection();
    addLog("onboarding.location.resolve.result", resolved ?? null);

    if (resolved) {
      // ✅ Use auth.getUser() instead of whoami, so this always works when session exists
      const { data: u } = await sb.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        addLog("onboarding.location.no_uid");
        throw new Error("Not authenticated after signup.");
      }

      addLog("onboarding.location.set.start", {
        uid,
        precision: resolved.precision,
        locationId: resolved.locationId,
      });
      const l = await sb.rpc("set_user_location_cascade", {
        p_user_id: uid,
        p_location_id: resolved.locationId,
        p_precision: resolved.precision,
        p_override: geoOverride,
        p_source: geoOverride ? "signup_ip_override" : "signup",
      });
      if (l.error) {
        addLog("onboarding.location.set.error", safeErr(l.error));
        throw l.error;
      }
      addLog("onboarding.location.set.ok");
    }

    // ✅ 5) Session + Device tracking (so tables populate immediately on immediate-login path)
    addLog("onboarding.touch_session.start");
    const s = await sb.rpc("touch_session", { p_ua: navigator.userAgent });
    if (s.error) {
      addLog("onboarding.touch_session.error", safeErr(s.error));
      throw s.error;
    }
    addLog("onboarding.touch_session.ok");

    const fp = getDeviceFingerprint();
    addLog("onboarding.touch_device.start", { fp: fp.slice(0, 8) + "…" });
    const dev = await sb.rpc("touch_device", { p_device_fingerprint: fp });
    if (dev.error) {
      addLog("onboarding.touch_device.error", safeErr(dev.error));
      throw dev.error;
    }
    addLog("onboarding.touch_device.ok");

    addLog("onboarding.done");
  }

  function stashForFirstLogin() {
    try {
      const payload = {
        username: username.trim(),
        dob,
        gender: gender.value,
        genderSelf: gender.selfDescribe,
        country,
        stateCode,
        countyCode,
        cityId,
      };
      window.localStorage.setItem("signup_stash_v1", JSON.stringify(payload));
      addLog("stash.ok", { keys: Object.keys(payload) });
    } catch (e) {
      addLog("stash.error", safeErr(e));
      // ignore
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    debugStartRef.current = performance.now();
    if (debugEnabled) setDebugLogs([]);

    addLog("submit.start", {
      email: maskEmail(email),
      username: username.trim(),
      country,
      stateCode,
      countyCode,
      cityId,
    });

    const next = validate();
    setErrors(next);
    addLog("validate.result", {
      ok: Object.keys(next).length === 0,
      fields: Object.keys(next),
    });
    if (Object.keys(next).length > 0) {
      return;
    }

    try {
      setBusy(true);

      addLog("auth.signUp.start", { email: maskEmail(email) });
      const { error: signErr, data: signData } = await sb.auth.signUp({
        email,
        password, // NEVER log password
      });
      if (signErr) {
        addLog("auth.signUp.error", safeErr(signErr));
        throw signErr;
      }
      addLog("auth.signUp.ok", {
        hasUser: !!signData?.user,
        hasSession: !!signData?.session,
      });

      addLog("auth.getSession.start");
      const { data: sess, error: sessErr } = await sb.auth.getSession();
      if (sessErr) addLog("auth.getSession.error", safeErr(sessErr));
      addLog("auth.getSession.result", {
        hasSession: !!sess?.session,
        userId: sess?.session?.user?.id ?? null,
      });

      if (sess.session) {
        await finalizeOnboarding();

        // Epic T: Check for anonymous embedded stances to merge
        const fp = window.localStorage.getItem("sc_embed_fp_v1");
        if (fp && sb) {
          const { data: mergeCount } = await sb.rpc("get_pending_merge_count", { p_device_fingerprint: fp });
          if (mergeCount && mergeCount > 0) {
            // Store merge prompt flag — read by useBootstrapUser on first login
            window.localStorage.setItem("sc_pending_merge_fp", fp);
            window.localStorage.setItem("sc_pending_merge_count", String(mergeCount));
          }
        }

        setMsg("Account created!");
        addLog("nav.profile");
        nav("/profile");
        return;
      }

      // No session yet -> stash and rely on first-login bootstrap
      stashForFirstLogin();
      setMsg(
        "Check your email to confirm your account. After you log in, we’ll finish setting up your profile automatically."
      );
      addLog("confirm_email.notice_shown");
    } catch (err: any) {
      addLog("submit.error", safeErr(err));
      setMsg(err?.message || "Sign up failed.");
    } finally {
      setBusy(false);
      addLog("submit.done");
    }
  }

  return (
    <PageLayout>
      <div className="mx-auto max-w-md p-6 space-y-5">
        <h1 className="text-2xl font-bold">Sign up</h1>

        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {/* Email */}
          <div>
            <label className="block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              ref={refEmail}
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
              ref={refPassword}
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
          <UsernameField
            value={username}
            onChange={(v: any) => {
              // Support both: onChange(value: string) and onChange(event)
              if (typeof v === "string") setUsername(v);
              else setUsername(v?.target?.value ?? "");
            }}
            setValue={setUsername}
            error={errors.username}
            status={uStatus}
            setStatus={setUStatus}
          />

          {/* DOB */}
          <DobField
            value={dob}
            setValue={setDob}
            error={errors.dob}
            containerRef={refDobContainer}
          />

          {/* Gender */}
          <div>
            <label className="block text-sm font-medium" htmlFor="gender">
              Gender
            </label>
            <select
              id="gender"
              className={cx(
                "mt-1 w-full rounded-lg border p-2",
                errors.gender && "border-rose-500"
              )}
              value={gender.value}
              onChange={(e) =>
                setGender((prev) => ({
                  ...prev,
                  value: e.target.value as Gender,
                }))
              }
            >
              <option value="">Select an option</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="nonbinary">Non-binary</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
              <option value="self_described">Self-described</option>
            </select>
            {gender.value === "self_described" && (
              <input
                className="mt-2 w-full rounded-lg border p-2"
                type="text"
                placeholder="Describe your gender"
                value={gender.selfDescribe}
                onChange={(e) =>
                  setGender((prev) => ({
                    ...prev,
                    selfDescribe: e.target.value,
                  }))
                }
              />
            )}
            {errors.gender && (
              <p className="mt-1 text-xs text-rose-600">{errors.gender}</p>
            )}
          </div>

          {/* M-A01: IP geo-detection suggestion banner */}
          {ipGeo.countryCode &&
            ipGeo.countryName &&
            !ipGeo.loading &&
            geoState === "pending" && (
              <GeoSuggestionBanner
                countryName={ipGeo.countryName}
                onAccept={() => {
                  setCountry(ipGeo.countryCode!);
                  setGeoState("accepted");
                  setGeoOverride(false);
                }}
                onDismiss={() => {
                  setCountry("");
                  setGeoState("dismissed");
                }}
              />
          )}

          {/* Location */}
          <LocationSelect
            country={country}
            setCountry={(v) => {
              setCountry(v);
              // If user changes country after accepting geo, mark as overridden
              if (geoState === "accepted" && v !== ipGeo.countryCode) {
                setGeoState("overridden");
                setGeoOverride(true);
              }
            }}
            stateCode={stateCode}
            setStateCode={setStateCode}
            countyCode={countyCode}
            setCountyCode={setCountyCode}
            cityId={cityId}
            setCityId={setCityId}
            errorCountry={errors.country}
            detectedCountryCode={ipGeo.countryCode}
            onGeoOverride={() => { setGeoState("overridden"); setGeoOverride(true); }}
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

        {/* Debug panel */}
        {debugEnabled && (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Signup Debug</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-xs"
                  onClick={() => setDebugLogs([])}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-xs"
                  onClick={copyDebug}
                >
                  Copy logs
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Debug enabled via <code>?debug=1</code> (HashRouter supported) or{" "}
              <code>localStorage.auth_debug=1</code>. Password is never logged.
            </p>
            <div className="max-h-64 overflow-auto rounded border bg-slate-50 p-2">
              <pre className="text-[11px] leading-4 whitespace-pre-wrap">
                {debugLogs.length
                  ? debugLogs
                      .map(
                        (l) =>
                          `${l.ms}ms | ${l.step}${
                            l.data !== undefined
                              ? ` | ${JSON.stringify(l.data)}`
                              : ""
                          }`
                      )
                      .join("\n")
                  : "No logs yet."}
              </pre>
            </div>
          </div>
        )}

        {/* Social sign-up */}
        <SocialAuthButtons
          mode="signup"
          onError={(e) => setMsg(e)}
        />

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
