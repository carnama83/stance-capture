// src/hooks/useLocationIds.ts
// React hook for accessing location IDs in components

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { locationService, LocationIds } from '@/services/locationService';

interface UseLocationIdsOptions {
  userId?: string | null;
  countryName?: string | null;
  enabled?: boolean;
}

interface UseLocationIdsResult {
  locationIds: LocationIds;
  globalId: string | null;
  countryId: string | null;
  stateId: string | null;
  cityId: string | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Hook to get location IDs for the current user or specific locations
 * 
 * @example
 * ```tsx
 * // Get location IDs for logged-in user
 * const { globalId, countryId, isLoading } = useLocationIds({ userId });
 * 
 * // Get location IDs for specific country
 * const { globalId, countryId } = useLocationIds({ countryName: 'United States' });
 * 
 * // Get just global ID (fastest, uses cache)
 * const { globalId } = useLocationIds();
 * ```
 */
export function useLocationIds(options: UseLocationIdsOptions = {}): UseLocationIdsResult {
  const { userId, countryName, enabled = true } = options;

  // Initialize the location service once
  const initQuery = useQuery({
    queryKey: ['location-service-init'],
    queryFn: async () => {
      await locationService.initialize();
      return true;
    },
    staleTime: Infinity, // Only initialize once
    cacheTime: Infinity,
    enabled,
  });

  // Query for user-specific location IDs if userId is provided
  const userLocationsQuery = useQuery({
    queryKey: ['user-location-ids', userId],
    queryFn: async () => {
      if (!userId) return null;
      return locationService.getUserLocationIds(userId);
    },
    enabled: enabled && !!userId && initQuery.isSuccess,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Query for country-specific location ID if countryName is provided
  const countryIdQuery = useQuery({
    queryKey: ['country-location-id', countryName],
    queryFn: async () => {
      if (!countryName) return null;
      return locationService.getCountryLocationId(countryName);
    },
    enabled: enabled && !!countryName && !userId && initQuery.isSuccess,
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  // Get global ID from cache (synchronous after initialization)
  const [globalId, setGlobalId] = useState<string | null>(null);

  useEffect(() => {
    if (initQuery.isSuccess) {
      const id = locationService.getGlobalLocationId();
      setGlobalId(id);
    }
  }, [initQuery.isSuccess]);

  // Determine loading state
  const isLoading = initQuery.isLoading || 
    (!!userId && userLocationsQuery.isLoading) ||
    (!!countryName && !userId && countryIdQuery.isLoading);

  // Determine error state
  const isError = initQuery.isError || 
    (!!userId && userLocationsQuery.isError) ||
    (!!countryName && !userId && countryIdQuery.isError);

  const error = initQuery.error || userLocationsQuery.error || countryIdQuery.error || null;

  // Build the result
  let locationIds: LocationIds;
  let countryId: string | null = null;
  let stateId: string | null = null;
  let cityId: string | null = null;

  if (userId && userLocationsQuery.data) {
    // User-specific locations
    locationIds = userLocationsQuery.data;
    countryId = locationIds.country;
    stateId = locationIds.state;
    cityId = locationIds.city;
  } else if (countryName && countryIdQuery.data) {
    // Country-specific (anonymous user or specific country)
    countryId = countryIdQuery.data;
    locationIds = {
      global: globalId,
      country: countryId,
      state: null,
      city: null,
    };
  } else {
    // Default: just global
    locationIds = {
      global: globalId,
      country: null,
      state: null,
      city: null,
    };
  }

  return {
    locationIds,
    globalId,
    countryId,
    stateId,
    cityId,
    isLoading,
    isError,
    error: error as Error | null,
  };
}

/**
 * Simpler hook that just returns global and country IDs
 * Useful for trending sections where you just need these two
 */
export function useGlobalAndCountryIds(countryName?: string | null) {
  const result = useLocationIds({ countryName: countryName ?? undefined });
  
  return {
    globalId: result.globalId,
    countryId: result.countryId,
    isLoading: result.isLoading,
    isError: result.isError,
  };
}
