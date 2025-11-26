// src/pages/SettingsLocation.tsx
import * as React from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";

type Session = import("@supabase/supabase-js").Session;

type RegionRow = {
  user_id: string;
  city_label: string | null;
  county_label: string | null;
  state_label: string | null;
  country_label: string | null;
};

type LocationOption = {
  iso_code: string;
  name: string;
  type: string;
};

function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  return session;
}

async function fetchMyRegion(userId: string): Promise<RegionRow | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("user_region_dimensions")
    .select("user_id, city_label, county_label, state_label, country_label")
    .eq("user_id", userId)
    .maybeSingle<RegionRow>();

  if (error) {
    console.error("Failed to load user region dimensions", error);
    return null;
  }

  return data ?? null;
}

async function searchByType(
  type: "country" | "state" | "county" | "city",
  query: string
): Promise<LocationOption[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");
  if (!query.trim()) return [];

  const { data, error } = await sb
    .from("locations")
    .select("iso_code, name, type")
    .eq("type", type)
    .ilike("name", `%${query.trim()}%`)
    .order("name")
    .limit(25);

  if (error) {
    console.error(`Failed to search ${type}s`, error);
    return [];
  }

  return (data ?? []) as LocationOption[];
}

async function setUserLocationByIso(
  isoCode: string,
  precision: "country" | "state" | "county" | "city"
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { error } = await sb.rpc("set_user_location_by_iso", {
    p_iso_code: isoCode,
    p_precision: precision,
  });

  if (error) {
    console.error("Failed to set user location", error);
    throw error;
  }
}

export default function SettingsLocation() {
  const session = useSupabaseSession();
  const queryClient = useQueryClient();
  const userId = session?.user?.id ?? null;

  // Country search
  const [countrySearchInput, setCountrySearchInput] = React.useState("");
  const [countrySearch, setCountrySearch] = React.useState("");
  const [countryTouched, setCountryTouched] = React.useState(false);

  // State search
  const [stateSearchInput, setStateSearchInput] = React.useState("");
  const [stateSearch, setStateSearch] = React.useState("");
  const [stateTouched, setStateTouched] = React.useState(false);

  // County search
  const [countySearchInput, setCountySearchInput] = React.useState("");
  const [countySearch, setCountySearch] = React.useState("");
  const [countyTouched, setCountyTouched] = React.useState(false);

  // City search
  const [citySearchInput, setCitySearchInput] = React.useState("");
  const [citySearch, setCitySearch] = React.useState("");
  const [cityTouched, setCityTouched] = React.useState(false);

  const {
    data: region,
    isLoading: regionLoading,
  } = useQuery({
    enabled: !!userId,
    queryKey: ["my-region", userId],
    queryFn: () => fetchMyRegion(userId!),
    staleTime: 60_000,
  });

  const {
    data: countryResults,
    isLoading: countryLoading,
  } = useQuery({
    enabled: countrySearch.trim().length >= 2,
    queryKey: ["location-search-country", countrySearch],
    queryFn: () => searchByType("country", countrySearch),
    staleTime: 0,
  });

  const {
    data: stateResults,
    isLoading: stateLoading,
  } = useQuery({
    enabled: stateSearch.trim().length >= 2,
    queryKey: ["location-search-state", stateSearch],
    queryFn: () => searchByType("state", stateSearch),
    staleTime: 0,
  });

  const {
    data: countyResults,
    isLoading: countyLoading,
  } = useQuery({
    enabled: countySearch.trim().length >= 2,
    queryKey: ["location-search-county", countySearch],
    queryFn: () => searchByType("county", countySearch),
    staleTime: 0,
  });

  const {
    data: cityResults,
    isLoading: cityLoading,
  } = useQuery({
    enabled: citySearch.trim().length >= 2,
    queryKey: ["location-search-city", citySearch],
    queryFn: () => searchByType("city", citySearch),
    staleTime: 0,
  });

  const setLocationMutation = useMutation({
    mutationFn: ({
      isoCode,
      precision,
    }: {
      isoCode: string;
      precision: "country" | "state" | "county" | "city";
    }) => setUserLocationByIso(isoCode, precision),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-region"] });
      queryClient.invalidateQueries({
        queryKey: ["question-region-stats"],
      });
    },
  });

  const handleCountrySearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCountryTouched(true);
    setCountrySearch(countrySearchInput);
  };

  const handleStateSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStateTouched(true);
    setStateSearch(stateSearchInput);
  };

  const handleCountySearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCountyTouched(true);
    setCountySearch(countySearchInput);
  };

  const handleCitySearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCityTouched(true);
    setCitySearch(citySearchInput);
  };

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-base font-semibold text-slate-900">Location</h2>
        <p className="text-xs text-slate-600">
          Choose your country, state, county, or city to see how people in your
          region think about each question.
        </p>
      </header>

      {/* Current region */}
      <section className="rounded-lg border p-3 space-y-2">
        <h3 className="text-xs font-medium text-slate-900">
          Your current region
        </h3>
        {regionLoading && (
          <p className="text-xs text-slate-500">Loading…</p>
        )}
        {!regionLoading && region && (
          <div className="text-xs text-slate-700 space-y-0.5">
            {region.city_label && (
              <div>
                <span className="font-medium">City: </span>
                {region.city_label}
              </div>
            )}
            {region.county_label && (
              <div>
                <span className="font-medium">County: </span>
                {region.county_label}
              </div>
            )}
            {region.state_label && (
              <div>
                <span className="font-medium">State: </span>
                {region.state_label}
              </div>
            )}
            {region.country_label && (
              <div>
                <span className="font-medium">Country: </span>
                {region.country_label}
              </div>
            )}
            {!region.city_label &&
              !region.county_label &&
              !region.state_label &&
              !region.country_label && (
                <div className="text-xs text-slate-500">
                  No location set yet. Choose a country, state, county, or city
                  below to get started.
                </div>
              )}
          </div>
        )}
        {!regionLoading && !region && (
          <p className="text-xs text-slate-500">
            No location data available yet.
          </p>
        )}
      </section>

      {/* Country selection */}
      <section className="rounded-lg border p-3 space-y-2">
        <h3 className="text-xs font-medium text-slate-900">
          Choose your country
        </h3>
        <form
          onSubmit={handleCountrySearchSubmit}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={countrySearchInput}
            onChange={(e) => setCountrySearchInput(e.target.value)}
            placeholder="Search for a country (e.g., United States)"
            className="flex-1 rounded border px-2 py-1.5 text-xs"
          />
          <button
            type="submit"
            className="rounded bg-slate-900 text-white px-3 py-1.5 text-xs"
          >
            Search
          </button>
        </form>
        {countryTouched && countrySearch.trim().length < 2 && (
          <p className="text-[11px] text-slate-500">
            Type at least 2 characters to search.
          </p>
        )}
        {countryLoading && countrySearch.trim().length >= 2 && (
          <p className="text-xs text-slate-500 mt-1">Searching…</p>
        )}
        {!countryLoading && countryResults && countryResults.length > 0 && (
          <div className="mt-2 max-h-64 overflow-y-auto border rounded">
            {countryResults.map((loc) => (
              <button
                key={loc.iso_code}
                type="button"
                disabled={setLocationMutation.isPending}
                onClick={() => {
                  setLocationMutation.mutate({
                    isoCode: loc.iso_code,
                    precision: "country",
                  });
                  setCountrySearchInput("");
                  setCountrySearch("");
                  setCountryTouched(false);
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 border-b last:border-b-0 flex items-center justify-between"
              >
                <span>{loc.name}</span>
                <span className="text-[10px] text-slate-500">
                  {loc.iso_code}
                </span>
              </button>
            ))}
          </div>
        )}
        {!countryLoading &&
          countrySearch.trim().length >= 2 &&
          (!countryResults || countryResults.length === 0) && (
            <p className="text-xs text-slate-500 mt-1">
              No matching countries found.
            </p>
          )}
      </section>

      {/* State selection */}
      <section className="rounded-lg border p-3 space-y-2">
        <h3 className="text-xs font-medium text-slate-900">
          Choose your state
        </h3>
        <form
          onSubmit={handleStateSearchSubmit}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={stateSearchInput}
            onChange={(e) => setStateSearchInput(e.target.value)}
            placeholder="Search for a state (e.g., Massachusetts)"
            className="flex-1 rounded border px-2 py-1.5 text-xs"
          />
          <button
            type="submit"
            className="rounded bg-slate-900 text-white px-3 py-1.5 text-xs"
          >
            Search
          </button>
        </form>
        {stateTouched && stateSearch.trim().length < 2 && (
          <p className="text-[11px] text-slate-500">
            Type at least 2 characters to search.
          </p>
        )}
        {stateLoading && stateSearch.trim().length >= 2 && (
          <p className="text-xs text-slate-500 mt-1">Searching…</p>
        )}
        {!stateLoading && stateResults && stateResults.length > 0 && (
          <div className="mt-2 max-h-64 overflow-y-auto border rounded">
            {stateResults.map((loc) => (
              <button
                key={loc.iso_code}
                type="button"
                disabled={setLocationMutation.isPending}
                onClick={() => {
                  setLocationMutation.mutate({
                    isoCode: loc.iso_code,
                    precision: "state",
                  });
                  setStateSearchInput("");
                  setStateSearch("");
                  setStateTouched(false);
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 border-b last:border-b-0 flex items-center justify-between"
              >
                <span>{loc.name}</span>
                <span className="text-[10px] text-slate-500">
                  {loc.iso_code}
                </span>
              </button>
            ))}
          </div>
        )}
        {!stateLoading &&
          stateSearch.trim().length >= 2 &&
          (!stateResults || stateResults.length === 0) && (
            <p className="text-xs text-slate-500 mt-1">
              No matching states found.
            </p>
          )}
      </section>

      {/* County selection */}
      <section className="rounded-lg border p-3 space-y-2">
        <h3 className="text-xs font-medium text-slate-900">
          Choose your county <span className="font-normal">(optional)</span>
        </h3>
        <form
          onSubmit={handleCountySearchSubmit}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={countySearchInput}
            onChange={(e) => setCountySearchInput(e.target.value)}
            placeholder="Search for a county (e.g., Middlesex County)"
            className="flex-1 rounded border px-2 py-1.5 text-xs"
          />
          <button
            type="submit"
            className="rounded bg-slate-900 text-white px-3 py-1.5 text-xs"
          >
            Search
          </button>
        </form>
        {countyTouched && countySearch.trim().length < 2 && (
          <p className="text-[11px] text-slate-500">
            Type at least 2 characters to search.
          </p>
        )}
        {countyLoading && countySearch.trim().length >= 2 && (
          <p className="text-xs text-slate-500 mt-1">Searching…</p>
        )}
        {!countyLoading && countyResults && countyResults.length > 0 && (
          <div className="mt-2 max-h-64 overflow-y-auto border rounded">
            {countyResults.map((loc) => (
              <button
                key={loc.iso_code}
                type="button"
                disabled={setLocationMutation.isPending}
                onClick={() => {
                  setLocationMutation.mutate({
                    isoCode: loc.iso_code,
                    precision: "county",
                  });
                  setCountySearchInput("");
                  setCountySearch("");
                  setCountyTouched(false);
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 border-b last:border-b-0 flex items-center justify-between"
              >
                <span>{loc.name}</span>
                <span className="text-[10px] text-slate-500">
                  {loc.iso_code}
                </span>
              </button>
            ))}
          </div>
        )}
        {!countyLoading &&
          countySearch.trim().length >= 2 &&
          (!countyResults || countyResults.length === 0) && (
            <p className="text-xs text-slate-500 mt-1">
              No matching counties found.
            </p>
          )}
      </section>

      {/* City selection */}
      <section className="rounded-lg border p-3 space-y-2">
        <h3 className="text-xs font-medium text-slate-900">
          Choose your city <span className="font-normal">(optional)</span>
        </h3>
        <p className="text-[11px] text-slate-500">
          Setting a city or county gives you more precise stats, when available.
        </p>
        <form
          onSubmit={handleCitySearchSubmit}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={citySearchInput}
            onChange={(e) => setCitySearchInput(e.target.value)}
            placeholder="Search for a city (e.g., Boston)"
            className="flex-1 rounded border px-2 py-1.5 text-xs"
          />
          <button
            type="submit"
            className="rounded bg-slate-900 text-white px-3 py-1.5 text-xs"
          >
            Search
          </button>
        </form>
        {cityTouched && citySearch.trim().length < 2 && (
          <p className="text-[11px] text-slate-500">
            Type at least 2 characters to search.
          </p>
        )}
        {cityLoading && citySearch.trim().length >= 2 && (
          <p className="text-xs text-slate-500 mt-1">Searching…</p>
        )}
        {!cityLoading && cityResults && cityResults.length > 0 && (
          <div className="mt-2 max-h-64 overflow-y-auto border rounded">
            {cityResults.map((loc) => (
              <button
                key={loc.iso_code}
                type="button"
                disabled={setLocationMutation.isPending}
                onClick={() => {
                  setLocationMutation.mutate({
                    isoCode: loc.iso_code,
                    precision: "city",
                  });
                  setCitySearchInput("");
                  setCitySearch("");
                  setCityTouched(false);
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 border-b last:border-b-0 flex items-center justify-between"
              >
                <span>{loc.name}</span>
                <span className="text-[10px] text-slate-500">
                  {loc.iso_code}
                </span>
              </button>
            ))}
          </div>
        )}
        {!cityLoading &&
          citySearch.trim().length >= 2 &&
          (!cityResults || cityResults.length === 0) && (
            <p className="text-xs text-slate-500 mt-1">
              No matching cities found.
            </p>
          )}

        {setLocationMutation.isPending && (
          <p className="text-[11px] text-slate-500 mt-1">
            Saving your location…
          </p>
        )}
        {setLocationMutation.isSuccess && (
          <p className="text-[11px] text-emerald-600 mt-1">
            Location updated. Your regional stats will refresh shortly.
          </p>
        )}
      </section>
    </div>
  );
}
