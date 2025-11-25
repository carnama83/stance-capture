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

async function searchStates(query: string): Promise<LocationOption[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");
  if (!query.trim()) return [];

  const { data, error } = await sb
    .from("locations")
    .select("iso_code, name, type")
    .eq("type", "state")
    .ilike("name", `%${query.trim()}%`)
    .order("name")
    .limit(25);

  if (error) {
    console.error("Failed to search states", error);
    return [];
  }

  return (data ?? []) as LocationOption[];
}

async function searchCities(query: string): Promise<LocationOption[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");
  if (!query.trim()) return [];

  const { data, error } = await sb
    .from("locations")
    .select("iso_code, name, type")
    .eq("type", "city")
    .ilike("name", `%${query.trim()}%`)
    .order("name")
    .limit(25);

  if (error) {
    console.error("Failed to search cities", error);
    return [];
  }

  return (data ?? []) as LocationOption[];
}

async function setUserLocationByIso(
  isoCode: string,
  precision: "city" | "state"
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

  // State search
  const [stateSearchInput, setStateSearchInput] = React.useState("");
  const [stateSearch, setStateSearch] = React.useState("");
  const [stateTouched, setStateTouched] = React.useState(false);

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
    data: stateResults,
    isLoading: stateLoading,
  } = useQuery({
    enabled: stateSearch.trim().length >= 2,
    queryKey: ["location-search-state", stateSearch],
    queryFn: () => searchStates(stateSearch),
    staleTime: 0,
  });

  const {
    data: cityResults,
    isLoading: cityLoading,
  } = useQuery({
    enabled: citySearch.trim().length >= 2,
    queryKey: ["location-search-city", citySearch],
    queryFn: () => searchCities(citySearch),
    staleTime: 0,
  });

  const setLocationMutation = useMutation({
    mutationFn: ({
      isoCode,
      precision,
    }: {
      isoCode: string;
      precision: "city" | "state";
    }) => setUserLocationByIso(isoCode, precision),
    onSuccess: () => {
      // Refresh region info + any region-based stats in question pages
      queryClient.invalidateQueries({ queryKey: ["my-region"] });
      queryClient.invalidateQueries({
        queryKey: ["question-region-stats"],
      });
    },
  });

  const handleStateSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStateTouched(true);
    setStateSearch(stateSearchInput);
  };

  const handleCitySearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCityTouched(true);
    setCitySearch(citySearchInput);
  };

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-base font-semibold text-slate-900">
          Location
        </h2>
        <p className="text-xs text-slate-600">
          Choose your location to see how people in your region think
          about each question.
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
                  No location set yet. Choose a state or city below to get
                  started.
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
        {!stateLoading &&
          stateResults &&
          stateResults.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto border rounded">
              {stateResults.map((loc) => (
                <button
                  key={loc.iso_code}
                  type="button"
                  disabled={setLocationMutation.isPending}
                  onClick={() =>
                    setLocationMutation.mutate({
                      isoCode: loc.iso_code,
                      precision: "state",
                    })
                  }
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

      {/* City selection */}
      <section className="rounded-lg border p-3 space-y-2">
        <h3 className="text-xs font-medium text-slate-900">
          Choose your city <span className="font-normal">(optional)</span>
        </h3>
        <p className="text-[11px] text-slate-500">
          Setting a city gives you more precise stats, when available.
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
        {!cityLoading &&
          cityResults &&
          cityResults.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto border rounded">
              {cityResults.map((loc) => (
                <button
                  key={loc.iso_code}
                  type="button"
                  disabled={setLocationMutation.isPending}
                  onClick={() =>
                    setLocationMutation.mutate({
                      isoCode: loc.iso_code,
                      precision: "city",
                    })
                  }
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
