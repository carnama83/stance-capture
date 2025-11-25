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

async function searchLocations(
  query: string
): Promise<LocationOption[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  if (!query.trim()) return [];

  // Simple first version: search states (type = 'state')
  const { data, error } = await sb
    .from("locations")
    .select("iso_code, name, type")
    .eq("type", "state")
    .ilike("name", `%${query.trim()}%`)
    .order("name")
    .limit(25);

  if (error) {
    console.error("Failed to search locations", error);
    return [];
  }

  return (data ?? []) as LocationOption[];
}

async function setUserLocationByIso(isoCode: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { error } = await sb.rpc("set_user_location_by_iso", {
    p_iso_code: isoCode,
    p_precision: "state", // for now we choose state-level precision
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

  const [search, setSearch] = React.useState("");
  const [searchInput, setSearchInput] = React.useState("");
  const [searchTouched, setSearchTouched] = React.useState(false);

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
    data: results,
    isLoading: searchLoading,
  } = useQuery({
    enabled: search.trim().length >= 2,
    queryKey: ["location-search", search],
    queryFn: () => searchLocations(search),
    staleTime: 0,
  });

  const setLocationMutation = useMutation({
    mutationFn: (isoCode: string) => setUserLocationByIso(isoCode),
    onSuccess: () => {
      // Refresh region info + any region-based stats
      queryClient.invalidateQueries({ queryKey: ["my-region"] });
      queryClient.invalidateQueries({
        queryKey: ["question-region-stats"],
      });
    },
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchTouched(true);
    setSearch(searchInput);
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
                  No location set yet. Choose a state below to get started.
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

      <section className="rounded-lg border p-3 space-y-2">
        <h3 className="text-xs font-medium text-slate-900">
          Choose your state
        </h3>
        <form
          onSubmit={handleSearchSubmit}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
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
        {searchTouched && search.trim().length < 2 && (
          <p className="text-[11px] text-slate-500">
            Type at least 2 characters to search.
          </p>
        )}
        {searchLoading && search.trim().length >= 2 && (
          <p className="text-xs text-slate-500 mt-1">Searching…</p>
        )}
        {!searchLoading &&
          results &&
          results.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto border rounded">
              {results.map((loc) => (
                <button
                  key={loc.iso_code}
                  type="button"
                  disabled={setLocationMutation.isPending}
                  onClick={() =>
                    setLocationMutation.mutate(loc.iso_code)
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
        {!searchLoading &&
          search.trim().length >= 2 &&
          (!results || results.length === 0) && (
            <p className="text-xs text-slate-500 mt-1">
              No matching states found.
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
